'use client';

import { useState } from 'react';
import { leerCsv, COLUMNAS_CONOCIDAS, type FilaCsv } from '@/lib/csv';
import { soles, aCentimos } from '@/lib/dinero';
import { GloboRoncito } from '@/components/Roncito';

type FilaRevision = {
  fila_num: number;
  datos: FilaCsv;
  categoria_sugerida: string | null;
  categoria_confianza: number | null;
  motivo_ia: string | null;
  duplicado: { variante_id: string; producto: string; score: number } | null;
  decision: string;
  error: string | null;
};

type Analisis = {
  importacion_id: string;
  motor: 'claude' | 'heuristica-local';
  total: number;
  filas: FilaRevision[];
  categorias: string[];
};

type Etapa = 'subir' | 'revisar' | 'listo';

export function ImportadorCsv({ iaActiva }: { iaActiva: boolean }) {
  const [etapa, setEtapa] = useState<Etapa>('subir');
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [filas, setFilas] = useState<FilaRevision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resumen, setResumen] = useState<{ creadas: number; omitidas: number; fallidas: number } | null>(
    null,
  );

  async function procesarArchivo(archivo: File) {
    setError(null);
    setOcupado(true);

    try {
      const texto = await archivo.text();
      const { filas: crudas, columnasFaltantes, advertencias } = leerCsv(texto);

      if (columnasFaltantes.length > 0) {
        throw new Error(
          `Al archivo le faltan columnas obligatorias: ${columnasFaltantes.join(', ')}. ` +
            `Las columnas que se leen son: ${COLUMNAS_CONOCIDAS.join(', ')}.`,
        );
      }
      if (crudas.length === 0) throw new Error('El archivo no tiene filas de datos.');

      const respuesta = await fetch('/api/importar/analizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre_archivo: archivo.name, filas: crudas }),
      });

      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? 'No pudimos analizar el archivo.');

      setAnalisis(datos);
      setFilas(datos.filas);
      setEtapa('revisar');
      if (advertencias.length) setError(advertencias.join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo salió mal al leer el archivo.');
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    if (!analisis) return;
    setOcupado(true);
    setError(null);

    try {
      const respuesta = await fetch('/api/importar/aplicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importacion_id: analisis.importacion_id,
          decisiones: filas.map((f) => ({
            fila_num: f.fila_num,
            decision: f.decision,
            categoria: f.categoria_sugerida ?? '',
          })),
        }),
      });

      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? 'No pudimos aplicar la importación.');

      setResumen(datos);
      setEtapa('listo');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo salió mal al aplicar.');
    } finally {
      setOcupado(false);
    }
  }

  function cambiar(fila_num: number, cambios: Partial<FilaRevision>) {
    setFilas((prev) => prev.map((f) => (f.fila_num === fila_num ? { ...f, ...cambios } : f)));
  }

  // ---------------------------------------------------------------

  if (etapa === 'listo' && resumen) {
    return (
      <div className="tarjeta p-6">
        <GloboRoncito animo="contento" tamano={64}>
          Listo. {resumen.creadas} productos nuevos en el catálogo.
        </GloboRoncito>

        <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
          <div className="tarjeta-sutil p-3">
            <dt className="text-xs texto-tenue">Creados</dt>
            <dd className="display text-2xl text-ron-exito">{resumen.creadas}</dd>
          </div>
          <div className="tarjeta-sutil p-3">
            <dt className="text-xs texto-tenue">Omitidos</dt>
            <dd className="display text-2xl">{resumen.omitidas}</dd>
          </div>
          <div className="tarjeta-sutil p-3">
            <dt className="text-xs texto-tenue">Con error</dt>
            <dd className={`display text-2xl ${resumen.fallidas ? 'text-ron-peligro' : ''}`}>
              {resumen.fallidas}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          <a href="/panel/inventario" className="boton boton-primario">
            Ver el inventario
          </a>
          <button
            onClick={() => {
              setEtapa('subir');
              setAnalisis(null);
              setFilas([]);
              setResumen(null);
            }}
            className="boton boton-claro"
          >
            Importar otro archivo
          </button>
        </div>
      </div>
    );
  }

  if (etapa === 'revisar' && analisis) {
    const aCrear = filas.filter((f) => f.decision === 'crear').length;
    const conError = filas.filter((f) => f.error).length;

    return (
      <div className="space-y-4">
        <div className="tarjeta p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="display text-lg">Revisa antes de guardar</h2>
              <p className="text-sm texto-tenue">
                {analisis.total} filas leídas · {aCrear} se crearán ·{' '}
                {filas.length - aCrear} se omitirán
                {conError > 0 && ` · ${conError} con error`}
              </p>
            </div>

            <span
              className={`etiqueta ${analisis.motor === 'claude' ? 'etiqueta-listo' : 'etiqueta-espera'}`}
            >
              {analisis.motor === 'claude'
                ? '🤖 Analizado con Claude'
                : '⚙️ Reglas locales (modo demostración)'}
            </span>
          </div>

          {analisis.motor === 'heuristica-local' && (
            <p className="mt-2 tarjeta-sutil bg-ron-amarillo-claro p-2.5 text-xs">
              Las categorías se propusieron con reglas de palabras clave y los duplicados
              con similitud de texto en la base. Para que las proponga Claude, configura{' '}
              <code className="font-mono">ANTHROPIC_API_KEY</code>. La detección de
              duplicados funciona igual en ambos casos.
            </p>
          )}

          {error && (
            <p className="mt-2 tarjeta-sutil bg-ron-amarillo-claro p-2.5 text-xs font-bold">
              {error}
            </p>
          )}
        </div>

        <ul className="space-y-2">
          {filas.map((f) => (
            <li
              key={f.fila_num}
              className={`tarjeta p-3 ${f.error ? 'border-ron-peligro' : ''} ${
                f.decision === 'omitir' ? 'opacity-60' : ''
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    <span className="texto-tenue">#{f.fila_num}</span>{' '}
                    {f.datos.nombre || <em className="text-ron-peligro">sin nombre</em>}
                  </p>
                  <p className="text-xs texto-tenue">
                    {f.datos.sku || '—'}
                    {f.datos.variante ? ` · ${f.datos.variante}` : ''}
                    {' · '}
                    {aCentimos(f.datos.precio) !== null
                      ? soles(aCentimos(f.datos.precio)!)
                      : 'precio inválido'}
                    {f.datos.stock ? ` · stock ${f.datos.stock}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  {(['crear', 'omitir'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => cambiar(f.fila_num, { decision: d })}
                      disabled={Boolean(f.error) && d === 'crear'}
                      aria-pressed={f.decision === d}
                      className={`boton boton-chico ${
                        f.decision === d ? (d === 'crear' ? 'boton-primario' : 'boton-oscuro') : 'boton-claro'
                      }`}
                    >
                      {d === 'crear' ? 'Crear' : 'Omitir'}
                    </button>
                  ))}
                </div>
              </div>

              {f.error && (
                <p className="mt-2 text-xs font-bold text-ron-peligro">⚠ {f.error}</p>
              )}

              {!f.error && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="etiqueta-campo text-xs" htmlFor={`cat-${f.fila_num}`}>
                      Categoría
                      {f.categoria_confianza !== null && (
                        <span className="ml-1 font-normal texto-tenue">
                          (confianza {Math.round(f.categoria_confianza * 100)}%)
                        </span>
                      )}
                    </label>
                    <select
                      id={`cat-${f.fila_num}`}
                      className="campo !min-h-0 !py-1.5 text-sm"
                      value={f.categoria_sugerida ?? ''}
                      onChange={(e) => cambiar(f.fila_num, { categoria_sugerida: e.target.value })}
                    >
                      <option value="">Sin categoría</option>
                      {analisis.categorias.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      {f.categoria_sugerida &&
                        !analisis.categorias.includes(f.categoria_sugerida) && (
                          <option value={f.categoria_sugerida}>
                            {f.categoria_sugerida} (nueva)
                          </option>
                        )}
                    </select>
                    {f.motivo_ia && (
                      <p className="mt-1 text-[0.7rem] texto-tenue">{f.motivo_ia}</p>
                    )}
                  </div>

                  {f.duplicado && (
                    <div className="tarjeta-sutil bg-ron-amarillo-claro p-2">
                      <p className="text-xs font-bold">
                        ⚠ Posible duplicado ({Math.round(f.duplicado.score * 100)}% de parecido)
                      </p>
                      <p className="mt-0.5 text-xs">
                        Ya existe: <strong>{f.duplicado.producto}</strong>
                      </p>
                      <p className="mt-0.5 text-[0.7rem] texto-tenue">
                        Si es el mismo producto, déjalo en &ldquo;Omitir&rdquo;.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="tarjeta sticky bottom-3 flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-sm">
            <strong className="display">{aCrear}</strong> productos se crearán
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setEtapa('subir');
                setAnalisis(null);
                setFilas([]);
              }}
              className="boton boton-claro boton-chico"
            >
              Descartar
            </button>
            <button
              onClick={aplicar}
              disabled={ocupado || aCrear === 0}
              className="boton boton-primario"
            >
              {ocupado ? 'Guardando…' : `Guardar ${aCrear} productos`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Etapa de subida ---
  return (
    <div className="space-y-4">
      <div className="tarjeta p-6">
        <GloboRoncito animo="normal" tamano={56}>
          Súbeme el CSV y te digo qué categoría le pongo a cada cosa. Tú decides.
        </GloboRoncito>

        <label
          htmlFor="archivo-csv"
          className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-[1.1rem] border-[3px] border-dashed border-ron-negro p-8 text-center transition hover:bg-ron-amarillo-claro"
        >
          <span className="display text-lg">
            {ocupado ? 'Analizando…' : 'Elige tu archivo CSV'}
          </span>
          <span className="mt-1 text-sm texto-tenue">
            o arrástralo aquí · máximo 500 filas
          </span>
          <input
            id="archivo-csv"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={ocupado}
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              if (archivo) procesarArchivo(archivo);
              e.target.value = '';
            }}
          />
        </label>

        {error && (
          <p className="mt-3 tarjeta-sutil border-ron-peligro bg-red-50 p-3 text-sm font-bold text-ron-peligro">
            {error}
          </p>
        )}

        {!iaActiva && (
          <p className="mt-3 tarjeta-sutil bg-ron-amarillo-claro p-3 text-xs">
            <strong>Modo demostración:</strong> sin{' '}
            <code className="font-mono">ANTHROPIC_API_KEY</code> las categorías se
            proponen con reglas de palabras clave en vez de Claude. Los duplicados se
            detectan igual, con similitud de texto en la base de datos.
          </p>
        )}
      </div>

      <div className="tarjeta p-4">
        <h2 className="display text-base">Cómo debe verse el archivo</h2>
        <p className="mt-1 text-sm texto-tenue">
          La primera fila son los nombres de columna. Obligatorias:{' '}
          <strong>sku, nombre, precio</strong>.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b-2 border-ron-negro text-left">
              <tr className="display">
                {COLUMNAS_CONOCIDAS.map((c) => (
                  <th key={c} className="whitespace-nowrap px-2 py-1.5">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="texto-tenue">
                <td className="whitespace-nowrap px-2 py-1.5">RCC-STK-010</td>
                <td className="whitespace-nowrap px-2 py-1.5">Pack stickers michis</td>
                <td className="whitespace-nowrap px-2 py-1.5">8 stickers</td>
                <td className="whitespace-nowrap px-2 py-1.5">Única</td>
                <td className="whitespace-nowrap px-2 py-1.5">15.00</td>
                <td className="whitespace-nowrap px-2 py-1.5">4.50</td>
                <td className="whitespace-nowrap px-2 py-1.5">20</td>
                <td className="whitespace-nowrap px-2 py-1.5">ALMACEN</td>
                <td className="whitespace-nowrap px-2 py-1.5">Stickers</td>
                <td className="whitespace-nowrap px-2 py-1.5">https://…</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs texto-tenue">
          Los precios van en soles con punto decimal (15.00). El{' '}
          <code className="font-mono">stock</code> entra como ingreso inicial en la{' '}
          <code className="font-mono">ubicacion</code> indicada (por defecto, ALMACEN).
          Hay un archivo de ejemplo en{' '}
          <code className="font-mono">supabase/datos-demo/catalogo-ejemplo.csv</code>.
        </p>
      </div>
    </div>
  );
}
