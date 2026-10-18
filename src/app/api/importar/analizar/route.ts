import { NextResponse } from 'next/server';
import { clienteServidor, perfilActual } from '@/lib/supabase/servidor';
import { sugerirCategorias } from '@/lib/ia';
import { validarFila, similitudNombres, type FilaCsv } from '@/lib/csv';

/**
 * POST /api/importar/analizar
 *
 * Recibe las filas de un CSV ya leído en el navegador y prepara un
 * BORRADOR de importación. No toca el catálogo: crea la importación y
 * sus filas en estado "pendiente", con la categoría que propone la IA y
 * los posibles duplicados que encuentra Postgres.
 *
 * Nada se publica hasta que una persona revisa y aprueba.
 */
export async function POST(peticion: Request) {
  const perfil = await perfilActual();
  if (!perfil) {
    return NextResponse.json({ error: 'Necesitas iniciar sesión.' }, { status: 401 });
  }
  if (perfil.rol !== 'admin') {
    return NextResponse.json(
      { error: 'Sólo la administración puede importar catálogo.' },
      { status: 403 },
    );
  }

  let cuerpo: { nombre_archivo?: string; filas?: FilaCsv[] };
  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: 'El cuerpo no es JSON válido.' }, { status: 400 });
  }

  const filas = Array.isArray(cuerpo.filas) ? cuerpo.filas : [];
  if (filas.length === 0) {
    return NextResponse.json({ error: 'El archivo no tiene filas.' }, { status: 400 });
  }
  if (filas.length > 500) {
    return NextResponse.json(
      { error: 'Máximo 500 filas por importación. Divide el archivo.' },
      { status: 400 },
    );
  }

  const supabase = await clienteServidor();

  // Las categorías que ya existen: la IA elige entre ellas, no inventa nuevas.
  const { data: categorias } = await supabase.from('categorias').select('nombre').order('nombre');
  const nombresCategorias = (categorias ?? []).map((c) => c.nombre as string);

  // --- Validación previa, legible ---
  const validadas = filas.map((fila, i) => ({
    fila_num: i + 1,
    datos: fila,
    ...validarFila(fila),
  }));

  // Sólo se mandan a clasificar las filas que al menos tienen forma válida.
  const aClasificar = validadas
    .filter((f) => f.valida)
    .map((f) => ({
      fila_num: f.fila_num,
      nombre: f.datos.nombre ?? '',
      descripcion: f.datos.descripcion ?? '',
    }));

  const { motor, sugerencias } = await sugerirCategorias(aClasificar, nombresCategorias);

  // --- Duplicados: similitud de texto calculada en Postgres ---
  const duplicados = new Map<number, { variante_id: string; producto: string; score: number }>();

  await Promise.all(
    aClasificar.map(async (f) => {
      const { data } = await supabase.rpc('buscar_similares', {
        p_nombre: f.nombre,
        p_umbral: 0.45,
      });
      const encontrados = (data ?? []) as { variante_id: string; producto: string; score: number }[];
      if (encontrados.length > 0) duplicados.set(f.fila_num, encontrados[0]);
    }),
  );

  // --- Se guarda el borrador ---
  const { data: importacion, error: errorImp } = await supabase
    .from('importaciones')
    .insert({
      nombre_archivo: String(cuerpo.nombre_archivo ?? 'catalogo.csv').slice(0, 200),
      usuario_id: perfil.id,
      total_filas: filas.length,
      analizado_por: motor,
    })
    .select('id')
    .single();

  if (errorImp || !importacion) {
    return NextResponse.json(
      { error: errorImp?.message ?? 'No pudimos crear la importación.' },
      { status: 500 },
    );
  }

  // --- Duplicados dentro del propio archivo ---
  // Postgres compara contra el catálogo ya guardado, pero no ve las otras
  // filas del CSV. Si alguien pegó dos veces el mismo producto con el
  // nombre apenas cambiado, aquí se detecta.
  const repetidaEnArchivo = new Map<number, { fila: number; nombre: string; score: number }>();

  // Un mismo SKU repetido NO es un error: así se declaran las variantes
  // (una lámina en A4 y en A3 comparten SKU base). Lo sospechoso es que
  // se repitan SKU y variante, o que dos nombres casi iguales compartan
  // la misma presentación.
  const clave = (fila_num: number) => {
    const d = validadas.find((v) => v.fila_num === fila_num)?.datos ?? {};
    return {
      sku: (d.sku ?? '').trim().toUpperCase(),
      variante: (d.variante ?? '').trim().toLowerCase() || 'única',
    };
  };

  for (let i = 0; i < aClasificar.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = aClasificar[i];
      const b = aClasificar[j];
      const ka = clave(a.fila_num);
      const kb = clave(b.fila_num);

      const mismaVariante = ka.variante === kb.variante;
      let score = 0;

      if (ka.sku === kb.sku && mismaVariante) {
        score = 1; // exactamente la misma fila dos veces
      } else if (mismaVariante) {
        score = similitudNombres(a.nombre, b.nombre);
      }

      if (score >= 0.82) {
        const previo = repetidaEnArchivo.get(a.fila_num);
        if (!previo || score > previo.score) {
          repetidaEnArchivo.set(a.fila_num, { fila: b.fila_num, nombre: b.nombre, score });
        }
      }
    }
  }

  const aInsertar = validadas.map((f) => {
    const sugerencia = sugerencias.find((s) => s.fila_num === f.fila_num);
    const duplicado = duplicados.get(f.fila_num);
    const repetida = repetidaEnArchivo.get(f.fila_num);

    return {
      importacion_id: importacion.id,
      fila_num: f.fila_num,
      datos: f.datos,
      categoria_sugerida:
        sugerencia?.categoria ?? (f.datos.categoria?.trim() || null),
      categoria_confianza: sugerencia?.confianza ?? null,
      motivo_ia: sugerencia?.motivo ?? null,
      duplicado_variante_id: duplicado?.variante_id ?? null,
      duplicado_score: duplicado?.score ?? null,
      // Propuesta inicial, siempre modificable por la persona que revisa:
      // lo inválido se omite, lo muy parecido a algo existente también.
      decision:
        !f.valida || repetida || (duplicado && duplicado.score >= 0.8) ? 'omitir' : 'crear',
      error: f.error,
    };
  });

  const { error: errorFilas } = await supabase.from('importacion_filas').insert(aInsertar);

  if (errorFilas) {
    return NextResponse.json({ error: errorFilas.message }, { status: 500 });
  }

  return NextResponse.json({
    importacion_id: importacion.id,
    motor,
    total: filas.length,
    filas: aInsertar.map((f) => ({
      fila_num: f.fila_num,
      datos: f.datos,
      categoria_sugerida: f.categoria_sugerida,
      categoria_confianza: f.categoria_confianza,
      motivo_ia: f.motivo_ia,
      duplicado: duplicados.get(f.fila_num) ?? null,
      repetida_en_archivo: repetidaEnArchivo.get(f.fila_num) ?? null,
      decision: f.decision,
      error: f.error,
    })),
    categorias: nombresCategorias,
  });
}
