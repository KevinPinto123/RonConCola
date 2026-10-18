'use client';

import { useMemo, useState } from 'react';
import { soles } from '@/lib/dinero';
import type { FilaStock } from '@/lib/tipos';

/**
 * Stock por producto y ubicación.
 *
 * En pantallas chicas la tabla se vuelve tarjetas: el equipo revisa
 * inventario desde el celular mientras cuenta cajas, y una tabla de
 * siete columnas ahí no se lee.
 */
export function TablaStock({ filas, soloBajas }: { filas: FilaStock[]; soloBajas: boolean }) {
  const [busqueda, setBusqueda] = useState('');

  const visibles = useMemo(() => {
    const t = busqueda.toLowerCase().trim();
    return filas.filter((f) => {
      if (soloBajas && !f.bajo_stock) return false;
      if (!t) return true;
      return `${f.producto} ${f.variante} ${f.sku} ${f.ubicacion} ${f.categoria ?? ''}`
        .toLowerCase()
        .includes(t);
    });
  }, [filas, soloBajas, busqueda]);

  return (
    <div>
      <div className="border-b-2 border-ron-negro/15 p-3">
        <input
          type="search"
          className="campo !min-h-0 !py-1.5 text-sm sm:max-w-sm"
          placeholder="Buscar por producto, SKU o ubicación…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar en el inventario"
        />
      </div>

      {visibles.length === 0 ? (
        <p className="p-5 text-sm texto-tenue">
          {soloBajas
            ? 'Ningún producto está bajo su mínimo. Buenas noticias.'
            : 'No hay resultados para esa búsqueda.'}
        </p>
      ) : (
        <>
          {/* --- Tabla, de tablet hacia arriba --- */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b-2 border-ron-negro text-left">
                <tr className="display text-xs uppercase tracking-wide">
                  <th className="px-4 py-2">Producto</th>
                  <th className="px-3 py-2">Ubicación</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2 text-right">Reservado</th>
                  <th className="px-3 py-2 text-right">Disponible</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-4 py-2 text-right">Valor costo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ron-negro/10">
                {visibles.map((f) => (
                  <tr
                    key={`${f.variante_id}-${f.ubicacion_codigo}`}
                    className={f.bajo_stock ? 'bg-ron-amarillo-claro/50' : ''}
                  >
                    <td className="px-4 py-2">
                      <p className="font-bold">{f.producto}</p>
                      <p className="text-xs texto-tenue">
                        {f.variante !== 'Única' ? `${f.variante} · ` : ''}
                        {f.sku}
                      </p>
                    </td>
                    <td className="px-3 py-2">{f.ubicacion}</td>
                    <td className="px-3 py-2 text-right">{f.cantidad}</td>
                    <td className="px-3 py-2 text-right texto-tenue">{f.reservado || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`etiqueta ${claseDisponible(f)}`}>{f.disponible}</span>
                    </td>
                    <td className="px-3 py-2 text-right">{soles(f.precio_centimos)}</td>
                    <td className="px-4 py-2 text-right texto-tenue">
                      {soles(f.valor_costo_centimos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* --- Tarjetas, en el celular --- */}
          <ul className="divide-y-2 divide-ron-negro/10 md:hidden">
            {visibles.map((f) => (
              <li
                key={`${f.variante_id}-${f.ubicacion_codigo}`}
                className={`px-4 py-3 ${f.bajo_stock ? 'bg-ron-amarillo-claro/50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{f.producto}</p>
                    <p className="text-xs texto-tenue">
                      {f.variante !== 'Única' ? `${f.variante} · ` : ''}
                      {f.ubicacion}
                    </p>
                  </div>
                  <span className={`etiqueta shrink-0 ${claseDisponible(f)}`}>
                    {f.disponible} disp.
                  </span>
                </div>
                <p className="mt-1 text-xs texto-tenue">
                  {f.cantidad} en stock
                  {f.reservado > 0 ? ` · ${f.reservado} reservadas` : ''} ·{' '}
                  {soles(f.precio_centimos)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="border-t-2 border-ron-negro/15 px-4 py-2 text-xs texto-tenue">
        {visibles.length} de {filas.length} registros · Disponible = stock − reservado
      </p>
    </div>
  );
}

function claseDisponible(f: FilaStock): string {
  if (f.disponible <= 0) return 'etiqueta-cancelado';
  if (f.bajo_stock) return 'etiqueta-alerta';
  return 'etiqueta-listo';
}
