/**
 * Lector de CSV sin dependencias externas.
 *
 * Maneja comillas, comas dentro de comillas, comillas escapadas ("")
 * y saltos de línea de Windows y Unix. Suficiente para los archivos
 * que exporta Excel o Google Sheets, que es de donde salen los
 * catálogos de Ron con Cola.
 */

export type FilaCsv = Record<string, string>;

/** Columnas que el importador entiende. El resto se ignora. */
export const COLUMNAS_CONOCIDAS = [
  'sku',
  'nombre',
  'descripcion',
  'variante',
  'precio',
  'costo',
  'stock',
  'ubicacion',
  'categoria',
  'imagen_url',
] as const;

export const COLUMNAS_OBLIGATORIAS = ['sku', 'nombre', 'precio'] as const;

function dividirLinea(linea: string, separador: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let enComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];

    if (enComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"'; // comilla escapada
          i++;
        } else {
          enComillas = false;
        }
      } else {
        actual += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === separador) {
      celdas.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  celdas.push(actual);
  return celdas.map((c) => c.trim());
}

/** Excel en español suele exportar con punto y coma. Lo detectamos solos. */
function detectarSeparador(encabezado: string): string {
  const comas = (encabezado.match(/,/g) ?? []).length;
  const puntoYComa = (encabezado.match(/;/g) ?? []).length;
  const tabs = (encabezado.match(/\t/g) ?? []).length;
  if (tabs > comas && tabs > puntoYComa) return '\t';
  return puntoYComa > comas ? ';' : ',';
}

function normalizarEncabezado(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
}

export type ResultadoCsv = {
  filas: FilaCsv[];
  columnas: string[];
  columnasFaltantes: string[];
  advertencias: string[];
};

export function leerCsv(contenido: string): ResultadoCsv {
  // Quita el BOM que Excel pone al inicio y unifica saltos de línea.
  const limpio = contenido.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lineas = limpio.split('\n').filter((l) => l.trim() !== '');

  if (lineas.length === 0) {
    return { filas: [], columnas: [], columnasFaltantes: [...COLUMNAS_OBLIGATORIAS], advertencias: ['El archivo está vacío.'] };
  }

  const separador = detectarSeparador(lineas[0]);
  const columnas = dividirLinea(lineas[0], separador).map(normalizarEncabezado);

  const columnasFaltantes = COLUMNAS_OBLIGATORIAS.filter((c) => !columnas.includes(c));
  const advertencias: string[] = [];

  const desconocidas = columnas.filter(
    (c) => c !== '' && !COLUMNAS_CONOCIDAS.includes(c as (typeof COLUMNAS_CONOCIDAS)[number]),
  );
  if (desconocidas.length) {
    advertencias.push(`Columnas que se ignorarán: ${desconocidas.join(', ')}.`);
  }

  const filas: FilaCsv[] = [];
  for (let i = 1; i < lineas.length; i++) {
    const celdas = dividirLinea(lineas[i], separador);
    const fila: FilaCsv = {};
    columnas.forEach((col, idx) => {
      if (col) fila[col] = celdas[idx] ?? '';
    });
    // Descarta filas totalmente vacías.
    if (Object.values(fila).some((v) => v !== '')) filas.push(fila);
  }

  return { filas, columnas, columnasFaltantes, advertencias };
}

export type ValidacionFila = { valida: boolean; error: string | null };

/**
 * Valida una fila antes de siquiera mostrarla en la revisión.
 * La base vuelve a validar al aplicar: esto es sólo para dar
 * retroalimentación temprana y legible.
 */
export function validarFila(fila: FilaCsv): ValidacionFila {
  if (!fila.sku?.trim()) return { valida: false, error: 'Falta el SKU' };
  if (!fila.nombre?.trim()) return { valida: false, error: 'Falta el nombre' };

  const precio = Number(String(fila.precio ?? '').replace(',', '.'));
  if (!Number.isFinite(precio) || precio <= 0) {
    return { valida: false, error: 'El precio debe ser un número mayor a cero' };
  }

  if (fila.stock?.trim()) {
    const stock = Number(String(fila.stock).replace(',', '.'));
    if (!Number.isFinite(stock) || stock < 0) {
      return { valida: false, error: 'El stock no puede ser negativo' };
    }
  }

  if (fila.costo?.trim()) {
    const costo = Number(String(fila.costo).replace(',', '.'));
    if (!Number.isFinite(costo) || costo < 0) {
      return { valida: false, error: 'El costo no puede ser negativo' };
    }
  }

  return { valida: true, error: null };
}

/**
 * Parecido entre dos nombres, de 0 a 1 (coeficiente de Dice sobre bigramas).
 *
 * Postgres ya detecta duplicados contra el catálogo existente, pero no ve
 * las filas del propio archivo: si el CSV trae dos veces el mismo producto
 * con el nombre apenas distinto, ambas pasarían. Esto cubre ese caso.
 */
export function similitudNombres(a: string, b: string): number {
  const normalizar = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9ñ ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const x = normalizar(a);
  const y = normalizar(b);

  if (!x || !y) return 0;
  if (x === y) return 1;

  const bigramas = (t: string) => {
    const pares = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const par = t.slice(i, i + 2);
      pares.set(par, (pares.get(par) ?? 0) + 1);
    }
    return pares;
  };

  const bx = bigramas(x);
  const by = bigramas(y);

  let comunes = 0;
  let totalX = 0;
  bx.forEach((n, par) => {
    totalX += n;
    comunes += Math.min(n, by.get(par) ?? 0);
  });

  let totalY = 0;
  by.forEach((n) => { totalY += n; });

  if (totalX + totalY === 0) return 0;
  return (2 * comunes) / (totalX + totalY);
}
