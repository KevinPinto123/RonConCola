import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { clienteServidor, perfilActual } from '@/lib/supabase/servidor';

/**
 * POST /api/importar/aplicar
 *
 * Guarda las decisiones que tomó la persona sobre cada fila y recién
 * entonces llama a aplicar_importacion(), que crea los productos.
 *
 * La función de la base vuelve a validar todo y además es idempotente:
 * si alguien reenvía esto, la segunda vez es rechazada.
 */
export async function POST(peticion: Request) {
  const perfil = await perfilActual();
  if (!perfil) {
    return NextResponse.json({ error: 'Necesitas iniciar sesión.' }, { status: 401 });
  }
  if (perfil.rol !== 'admin') {
    return NextResponse.json(
      { error: 'Sólo la administración puede aplicar una importación.' },
      { status: 403 },
    );
  }

  let cuerpo: {
    importacion_id?: string;
    decisiones?: { fila_num: number; decision: string; categoria?: string }[];
  };

  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: 'El cuerpo no es JSON válido.' }, { status: 400 });
  }

  const importacionId = String(cuerpo.importacion_id ?? '');
  if (!importacionId) {
    return NextResponse.json({ error: 'Falta el identificador de la importación.' }, { status: 400 });
  }

  const supabase = await clienteServidor();
  const permitidas = new Set(['crear', 'omitir', 'fusionar', 'pendiente']);

  // Se guardan las decisiones fila por fila. Son pocas y así cada una
  // conserva su categoría revisada.
  for (const d of cuerpo.decisiones ?? []) {
    if (!permitidas.has(d.decision)) continue;

    const { error } = await supabase
      .from('importacion_filas')
      .update({
        decision: d.decision,
        categoria_sugerida: d.categoria?.trim() || null,
      })
      .eq('importacion_id', importacionId)
      .eq('fila_num', d.fila_num);

    if (error) {
      return NextResponse.json(
        { error: `No pudimos guardar la fila ${d.fila_num}: ${error.message}` },
        { status: 500 },
      );
    }
  }

  const { data, error } = await supabase.rpc('aplicar_importacion', {
    p_importacion_id: importacionId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  revalidatePath('/panel/inventario');
  revalidatePath('/panel');
  revalidatePath('/');

  return NextResponse.json(data);
}
