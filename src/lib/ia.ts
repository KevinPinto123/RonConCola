import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, MODELO_IA, iaConfigurada } from '@/lib/entorno';
import { soles, numero } from '@/lib/dinero';
import type { Kpis } from '@/lib/tipos';

/**
 * La IA de Ron con Cola.
 *
 * Dos encargos, y ninguno incluye inventar datos:
 *   1. Proponer la categoría de un producto nuevo y señalar posibles
 *      duplicados → siempre pasa por revisión humana antes de guardarse.
 *   2. Explicar en palabras los indicadores que YA calculó Postgres.
 *
 * Si no hay ANTHROPIC_API_KEY, nada se rompe: se usan reglas locales
 * deterministas y la pantalla avisa que está en modo demostración.
 */

export type MotorIA = 'claude' | 'heuristica-local';

export type SugerenciaFila = {
  fila_num: number;
  categoria: string;
  confianza: number;
  motivo: string;
};

function cliente() {
  if (!ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

// ===============================================================
// 1. Categorías sugeridas
// ===============================================================

/**
 * Reglas locales: palabras clave → categoría.
 * Cubre el catálogo real de Ron con Cola (bazar de productos de gatos).
 */
const PALABRAS_CLAVE: { categoria: string; palabras: string[] }[] = [
  { categoria: 'Stickers', palabras: ['sticker', 'calcomania', 'pegatina', 'stickers'] },
  { categoria: 'Láminas y cuadros', palabras: ['lamina', 'lámina', 'cuadro', 'poster', 'print', 'ilustracion', 'ilustración'] },
  { categoria: 'Peluches', palabras: ['peluche', 'muñeco', 'plush', 'almohada'] },
  { categoria: 'Tazas', palabras: ['taza', 'mug', 'vaso', 'termo'] },
  { categoria: 'Llaveros y pines', palabras: ['llavero', 'pin', 'prendedor', 'broche'] },
  { categoria: 'Textiles', palabras: ['polo', 'camiseta', 'tote', 'bolsa', 'gorro', 'medias', 'textil', 'cojin', 'cojín'] },
  { categoria: 'Papelería', palabras: ['libreta', 'cuaderno', 'postal', 'agenda', 'bloc', 'marcador', 'papeleria', 'papelería'] },
];

/** "1 operación" / "3 operaciones": evita el clásico "1 operaciones". */
function plural(cantidad: number, singular: string, plural_: string): string {
  return `${numero(cantidad)} ${cantidad === 1 ? singular : plural_}`;
}

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function categoriaPorReglas(nombre: string, descripcion = ''): { categoria: string; confianza: number; motivo: string } {
  const texto = sinTildes(`${nombre} ${descripcion}`);

  for (const grupo of PALABRAS_CLAVE) {
    const encontrada = grupo.palabras.find((p) => texto.includes(sinTildes(p)));
    if (encontrada) {
      return {
        categoria: grupo.categoria,
        confianza: 0.8,
        motivo: `Regla local: el nombre contiene "${encontrada}".`,
      };
    }
  }

  return {
    categoria: 'Sin categoría',
    confianza: 0.2,
    motivo: 'Ninguna regla local coincidió. Necesita que una persona la asigne.',
  };
}

/**
 * Pide a Claude que clasifique las filas de un CSV.
 * Devuelve también qué motor respondió, para mostrarlo en pantalla.
 */
export async function sugerirCategorias(
  filas: { fila_num: number; nombre: string; descripcion?: string }[],
  categoriasExistentes: string[],
): Promise<{ motor: MotorIA; sugerencias: SugerenciaFila[] }> {
  const porReglas = (): SugerenciaFila[] =>
    filas.map((f) => ({ fila_num: f.fila_num, ...categoriaPorReglas(f.nombre, f.descripcion) }));

  const api = cliente();
  if (!api || filas.length === 0) {
    return { motor: 'heuristica-local', sugerencias: porReglas() };
  }

  const instruccion = [
    'Eres el asistente de catálogo de "Ron con Cola", un bazar peruano de productos con temática de gatos.',
    '',
    'Clasifica cada producto en UNA de estas categorías existentes:',
    categoriasExistentes.map((c) => `- ${c}`).join('\n'),
    '',
    'Reglas estrictas:',
    '- Usa SOLO las categorías de la lista. Si ninguna encaja, responde "Sin categoría".',
    '- No inventes productos, precios ni cantidades. Sólo clasificas.',
    '- "confianza" es un número entre 0 y 1.',
    '- "motivo" es una frase corta en español explicando por qué.',
    '',
    'Responde ÚNICAMENTE con un arreglo JSON, sin texto alrededor, con esta forma:',
    '[{"fila_num": 1, "categoria": "Stickers", "confianza": 0.9, "motivo": "..."}]',
  ].join('\n');

  const listado = filas
    .map((f) => `Fila ${f.fila_num}: ${f.nombre}${f.descripcion ? ` — ${f.descripcion}` : ''}`)
    .join('\n');

  try {
    const respuesta = await api.messages.create({
      model: MODELO_IA,
      max_tokens: 2000,
      system: instruccion,
      messages: [{ role: 'user', content: listado }],
    });

    const texto = respuesta.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // El modelo a veces envuelve el JSON en ```json … ```
    const json = texto.replace(/```json?/gi, '').replace(/```/g, '').trim();
    const crudo = JSON.parse(json) as SugerenciaFila[];

    // Red de seguridad: si Claude devuelve una categoría que no existe,
    // la descartamos y caemos a las reglas locales para esa fila.
    const validas = new Set([...categoriasExistentes, 'Sin categoría']);
    const sugerencias = filas.map((f) => {
      const s = crudo.find((c) => Number(c.fila_num) === f.fila_num);
      if (!s || !validas.has(s.categoria)) {
        return { fila_num: f.fila_num, ...categoriaPorReglas(f.nombre, f.descripcion) };
      }
      return {
        fila_num: f.fila_num,
        categoria: s.categoria,
        confianza: Math.max(0, Math.min(1, Number(s.confianza) || 0.5)),
        motivo: String(s.motivo ?? '').slice(0, 300),
      };
    });

    return { motor: 'claude', sugerencias };
  } catch {
    // Si la API falla (cuota, red, formato), la importación sigue su curso.
    return { motor: 'heuristica-local', sugerencias: porReglas() };
  }
}

// ===============================================================
// 2. Asistente comercial
// ===============================================================

/**
 * Convierte los indicadores en un texto compacto para el modelo.
 * Es la ÚNICA fuente de datos que recibe: si algo no está aquí,
 * la respuesta correcta es "no tengo ese dato".
 */
function contextoKpis(k: Kpis): string {
  const lineas: string[] = [
    `Periodo analizado: últimos ${k.periodo_dias} días.`,
    `Ventas totales: ${soles(k.ventas_totales_centimos)} en ${numero(k.operaciones)} operaciones.`,
    `Ticket promedio: ${soles(k.ticket_promedio_centimos)}.`,
    `Unidades vendidas: ${numero(k.unidades_vendidas)}.`,
    '',
    'Ventas por canal:',
    ...(k.ventas_por_canal.length
      ? k.ventas_por_canal.map(
          (c) => `- ${c.canal}: ${soles(c.total_centimos)} (${c.operaciones} operaciones)`,
        )
      : ['- Sin ventas registradas en el periodo.']),
    '',
    'Productos más vendidos:',
    ...(k.top_productos.length
      ? k.top_productos.map(
          (p) => `- ${p.producto}: ${p.unidades} unidades, ${soles(p.ingreso_centimos)}`,
        )
      : ['- Sin ventas registradas en el periodo.']),
    '',
    'Inventario:',
    `- Unidades en stock: ${numero(k.inventario.unidades_en_stock)}`,
    `- Unidades reservadas por pedidos abiertos: ${numero(k.inventario.unidades_reservadas)}`,
    `- Valor del inventario a costo: ${soles(k.inventario.valor_costo_centimos)}`,
    '',
    'Productos bajo stock mínimo:',
    ...(k.stock_bajo.length
      ? k.stock_bajo.map(
          (s) =>
            `- ${s.producto} (${s.variante}) en ${s.ubicacion}: quedan ${s.disponible}, mínimo ${s.stock_minimo}`,
        )
      : ['- Ninguno. Todo por encima del mínimo.']),
    '',
    'Pedidos:',
    `- Por verificar pago: ${k.pedidos.por_verificar} (${soles(k.pedidos.monto_por_verificar)})`,
    `- Pagados, esperando recojo: ${k.pedidos.por_entregar}`,
    `- Reservas vencidas sin liberar: ${k.pedidos.reservas_vencidas}`,
    `- Creados en el periodo: ${k.conversion.pedidos_creados}`,
    `- Concretados: ${k.conversion.pedidos_concretados}`,
    `- Cancelados: ${k.conversion.pedidos_cancelados}`,
    '',
    'Ventas por día:',
    ...(k.ventas_por_dia.length
      ? k.ventas_por_dia.map((d) => `- ${d.dia}: ${soles(d.total_centimos)}`)
      : ['- Sin datos.']),
  ];
  return lineas.join('\n');
}

/** Respuesta sin IA: resume los mismos datos con plantillas. */
function respuestaLocal(pregunta: string, k: Kpis): string {
  const p = sinTildes(pregunta);
  const partes: string[] = [];

  if (/vend|venta|factur|ingreso|plata|dinero/.test(p)) {
    partes.push(
      `En los últimos ${k.periodo_dias} días vendimos ${soles(k.ventas_totales_centimos)} ` +
        `en ${plural(k.operaciones, 'operación', 'operaciones')}, ` +
        `con un ticket promedio de ${soles(k.ticket_promedio_centimos)}.`,
    );
  }
  if (/top|mas vendido|más vendido|mejor|estrella|popular/.test(p) && k.top_productos.length) {
    const t = k.top_productos[0];
    partes.push(
      `Lo que más sale: ${t.producto}, con ${plural(t.unidades, 'unidad', 'unidades')} ` +
        `(${soles(t.ingreso_centimos)}).`,
    );
  }
  if (/stock|inventario|falta|reponer|quiebre|agot/.test(p)) {
    partes.push(
      k.stock_bajo.length
        ? `Ojo con el stock: ${plural(k.stock_bajo.length, 'producto está', 'productos están')} ` +
            `en o bajo su mínimo. El más crítico es ${k.stock_bajo[0].producto} en ` +
            `${k.stock_bajo[0].ubicacion}, con ${plural(k.stock_bajo[0].disponible, 'unidad', 'unidades')}.`
        : 'El inventario está sano: ningún producto por debajo de su mínimo.',
    );
  }
  if (/pedido|pendiente|pago|verificar|recojo/.test(p)) {
    partes.push(
      `Hay ${plural(k.pedidos.por_verificar, 'pedido esperando', 'pedidos esperando')} ` +
        `que verifiques el pago (${soles(k.pedidos.monto_por_verificar)}) y ` +
        `${plural(k.pedidos.por_entregar, 'listo', 'listos')} para recojo.`,
    );
  }

  if (!partes.length) {
    partes.push(
      `Resumen de los últimos ${k.periodo_dias} días: ${soles(k.ventas_totales_centimos)} vendidos en ` +
        `${plural(k.operaciones, 'operación', 'operaciones')}, ` +
        `${plural(k.inventario.unidades_en_stock, 'unidad', 'unidades')} en stock y ` +
        `${plural(k.pedidos.por_verificar, 'pedido', 'pedidos')} por verificar.`,
    );
  }

  return partes.join(' ');
}

export async function responderPregunta(
  pregunta: string,
  kpis: Kpis,
): Promise<{ motor: MotorIA; respuesta: string }> {
  const api = cliente();
  if (!api) {
    return { motor: 'heuristica-local', respuesta: respuestaLocal(pregunta, kpis) };
  }

  const instruccion = [
    'Eres Roncito, el gato negro que manda en "Ron con Cola", un bazar peruano de productos con',
    'temática de gatos (tienda en Miraflores, almacén y ferias). Le hablas al equipo que administra el negocio.',
    '',
    'PERSONALIDAD: directo, con humor gatuno y algo de soberbia cariñosa. Llamas "humana/humano" al',
    'equipo de vez en cuando. Pero primero sos útil: el chiste nunca reemplaza el dato.',
    '',
    'REGLA INQUEBRANTABLE SOBRE LOS NÚMEROS:',
    'Abajo tienes los indicadores del sistema, ya calculados con consultas SQL sobre la base de datos real.',
    '- Usa EXACTAMENTE esas cifras. Cópialas tal cual, sin redondear ni recalcular.',
    '- Si te preguntan algo que no está en esos datos, dilo claramente: "ese dato no lo tengo en el tablero".',
    '- NUNCA estimes, proyectes ni inventes ventas, precios, stock o porcentajes que no estén listados.',
    '- Puedes comparar y ordenar los datos que sí tienes, y recomendar acciones concretas.',
    '',
    'FORMATO: respuesta breve (máximo 5 frases), en español peruano, montos en soles (S/).',
    '',
    '=== INDICADORES DEL SISTEMA ===',
    contextoKpis(kpis),
    '=== FIN DE LOS INDICADORES ===',
  ].join('\n');

  try {
    const respuesta = await api.messages.create({
      model: MODELO_IA,
      max_tokens: 700,
      system: instruccion,
      messages: [{ role: 'user', content: pregunta }],
    });

    const texto = respuesta.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return { motor: 'claude', respuesta: texto || respuestaLocal(pregunta, kpis) };
  } catch {
    return { motor: 'heuristica-local', respuesta: respuestaLocal(pregunta, kpis) };
  }
}

export { iaConfigurada };
