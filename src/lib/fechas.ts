/**
 * Fechas en hora de Lima, formateadas igual en el servidor y en el navegador.
 *
 * `toLocaleString` no sirve aquí por dos motivos:
 *
 *   1. Inserta espacios especiales (U+202F antes de "a. m.") que Node y el
 *      navegador no escriben igual. React lo detecta como diferencia entre
 *      lo renderizado en el servidor y en el cliente, y tira un error de
 *      hidratación aunque en pantalla se vea idéntico.
 *   2. Usa la zona horaria de quien mira. El servidor corre en UTC, así que
 *      un pedido de las 8 p.m. aparecía al día siguiente.
 *
 * Por eso pedimos sólo las partes numéricas, fijamos la zona de Lima y
 * armamos el texto nosotros.
 */

const ZONA = 'America/Lima';

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

function partes(iso: string) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;

  const formato = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const encontradas: Record<string, string> = {};
  for (const parte of formato.formatToParts(fecha)) {
    if (parte.type !== 'literal') encontradas[parte.type] = parte.value;
  }

  return {
    dia: encontradas.day,
    mes: MESES[Number(encontradas.month) - 1] ?? '—',
    anio: encontradas.year,
    // A medianoche, en-GB con hour12:false devuelve "24" en vez de "00".
    hora: encontradas.hour === '24' ? '00' : encontradas.hour,
    minuto: encontradas.minute,
  };
}

/** "18 oct · 11:28" */
export function fechaHora(iso: string): string {
  const p = partes(iso);
  if (!p) return '—';
  return `${p.dia} ${p.mes} · ${p.hora}:${p.minuto}`;
}

/** "18 oct" */
export function fechaCorta(iso: string): string {
  const p = partes(iso);
  if (!p) return '—';
  return `${p.dia} ${p.mes}`;
}

/** "18 oct 2026" */
export function fechaLarga(iso: string): string {
  const p = partes(iso);
  if (!p) return '—';
  return `${p.dia} ${p.mes} ${p.anio}`;
}
