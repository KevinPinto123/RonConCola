/**
 * Todo el dinero viaja en céntimos de sol, como entero.
 *
 * Motivo: 0.1 + 0.2 no da 0.3 en coma flotante, y en una tienda eso
 * termina en un total que no cuadra con la boleta. Los céntimos se
 * convierten a texto sólo al momento de mostrarlos.
 */

const formateador = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
});

/** 3500 → "S/ 35.00" */
export function soles(centimos: number): string {
  return formateador.format((centimos ?? 0) / 100).replace(/ /g, ' ');
}

/** 3500 → "35.00" (sin símbolo, para campos de formulario) */
export function solesPlano(centimos: number): string {
  return ((centimos ?? 0) / 100).toFixed(2);
}

/** "35.00" → 3500. Devuelve null si no es un número usable. */
export function aCentimos(texto: string | number | null | undefined): number | null {
  if (texto === null || texto === undefined || texto === '') return null;
  const limpio = String(texto).replace(/[^0-9.,-]/g, '').replace(',', '.');
  const valor = Number(limpio);
  if (!Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

/** Separador de miles para cantidades (unidades, pedidos…) */
export function numero(valor: number): string {
  return new Intl.NumberFormat('es-PE').format(valor ?? 0);
}

/** Variación porcentual, protegida contra la división entre cero. */
export function variacion(actual: number, previo: number): number | null {
  if (!previo) return null;
  return ((actual - previo) / previo) * 100;
}

export function porcentaje(valor: number | null, decimales = 0): string {
  if (valor === null || !Number.isFinite(valor)) return '—';
  return `${valor > 0 ? '+' : ''}${valor.toFixed(decimales)}%`;
}
