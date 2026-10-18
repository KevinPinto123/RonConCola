'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { soles, solesPlano } from '@/lib/dinero';
import {
  crearProducto,
  cambiarEstadoProducto,
  actualizarPrecio,
} from '@/app/panel/productos/acciones';
import type { Resultado } from '@/app/panel/acciones';
import type { ProductoAdmin } from '@/app/panel/productos/page';
import type { Ubicacion } from '@/lib/tipos';

function Enviar({ texto, clase = 'boton-primario' }: { texto: string; clase?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`boton boton-chico ${clase}`}>
      {pending ? 'Guardando…' : texto}
    </button>
  );
}

function Aviso({ estado }: { estado: Resultado | null }) {
  if (!estado) return null;
  return (
    <p
      role="status"
      className={`tarjeta-sutil mt-2 p-2.5 text-sm font-bold ${
        estado.ok
          ? 'border-ron-exito bg-green-50 text-ron-exito'
          : 'border-ron-peligro bg-red-50 text-ron-peligro'
      }`}
    >
      {estado.mensaje}
    </p>
  );
}

export function GestorProductos({
  productos,
  categorias,
  ubicaciones,
}: {
  productos: ProductoAdmin[];
  categorias: { id: string; nombre: string }[];
  ubicaciones: Ubicacion[];
}) {
  const [abierto, setAbierto] = useState(productos.length === 0);
  const [busqueda, setBusqueda] = useState('');

  const [eCrear, aCrear] = useActionState<Resultado | null, FormData>(crearProducto, null);
  const [eEstado, aEstado] = useActionState<Resultado | null, FormData>(
    cambiarEstadoProducto,
    null,
  );
  const [ePrecio, aPrecio] = useActionState<Resultado | null, FormData>(actualizarPrecio, null);

  const visibles = productos.filter((p) => {
    const t = busqueda.toLowerCase().trim();
    if (!t) return true;
    return `${p.nombre} ${p.sku_base} ${p.categorias?.nombre ?? ''}`.toLowerCase().includes(t);
  });

  return (
    <div className="space-y-5">
      {/* --- Alta de producto --- */}
      <section className="tarjeta overflow-hidden">
        <button
          onClick={() => setAbierto(!abierto)}
          aria-expanded={abierto}
          className="flex w-full items-center justify-between border-b-[3px] border-ron-negro bg-ron-amarillo px-4 py-2.5 text-left"
        >
          <span className="display text-lg">Nuevo producto</span>
          <span className="display text-xl">{abierto ? '−' : '+'}</span>
        </button>

        {abierto && (
          <div className="p-4">
            <form action={aCrear} className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="etiqueta-campo" htmlFor="p-sku">
                  SKU <span className="text-ron-peligro">*</span>
                </label>
                <input
                  id="p-sku"
                  name="sku"
                  required
                  className="campo text-sm uppercase"
                  placeholder="RCC-STK-020"
                />
                <p className="mt-1 text-[0.7rem] texto-tenue">
                  Si el SKU ya existe, se agrega como variante nueva.
                </p>
              </div>

              <div>
                <label className="etiqueta-campo" htmlFor="p-nombre">
                  Nombre <span className="text-ron-peligro">*</span>
                </label>
                <input
                  id="p-nombre"
                  name="nombre"
                  required
                  className="campo text-sm"
                  placeholder="Pack stickers michis"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="etiqueta-campo" htmlFor="p-desc">
                  Descripción
                </label>
                <input id="p-desc" name="descripcion" className="campo text-sm" />
              </div>

              <div>
                <label className="etiqueta-campo" htmlFor="p-cat">
                  Categoría
                </label>
                <select id="p-cat" name="categoria_id" className="campo text-sm" defaultValue="">
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="etiqueta-campo" htmlFor="p-variante">
                  Variante
                </label>
                <input
                  id="p-variante"
                  name="variante"
                  className="campo text-sm"
                  placeholder="Única, A4, Talla M…"
                />
              </div>

              <div>
                <label className="etiqueta-campo" htmlFor="p-precio">
                  Precio de venta (S/) <span className="text-ron-peligro">*</span>
                </label>
                <input
                  id="p-precio"
                  name="precio"
                  required
                  inputMode="decimal"
                  className="campo text-sm"
                  placeholder="35.00"
                />
              </div>

              <div>
                <label className="etiqueta-campo" htmlFor="p-costo">
                  Costo (S/)
                </label>
                <input
                  id="p-costo"
                  name="costo"
                  inputMode="decimal"
                  className="campo text-sm"
                  placeholder="12.00"
                />
                <p className="mt-1 text-[0.7rem] texto-tenue">
                  Sirve para calcular el valor del inventario.
                </p>
              </div>

              <div>
                <label className="etiqueta-campo" htmlFor="p-stock">
                  Stock inicial
                </label>
                <input
                  id="p-stock"
                  name="stock"
                  type="number"
                  min={0}
                  defaultValue={0}
                  className="campo text-sm"
                />
              </div>

              <div>
                <label className="etiqueta-campo" htmlFor="p-ubi">
                  ¿Dónde está ese stock?
                </label>
                <select id="p-ubi" name="ubicacion" className="campo text-sm">
                  {ubicaciones.map((u) => (
                    <option key={u.codigo} value={u.codigo}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="etiqueta-campo" htmlFor="p-img">
                  URL de la imagen
                </label>
                <input
                  id="p-img"
                  name="imagen_url"
                  className="campo text-sm"
                  placeholder="https://… (opcional)"
                />
              </div>

              <div className="sm:col-span-2">
                <Enviar texto="Crear producto" />
              </div>
            </form>

            <Aviso estado={eCrear} />
          </div>
        )}
      </section>

      {/* --- Catálogo --- */}
      <section className="tarjeta overflow-hidden">
        <div className="border-b-[3px] border-ron-negro bg-ron-amarillo px-4 py-2.5">
          <h2 className="display text-lg">Catálogo ({productos.length})</h2>
        </div>

        <div className="border-b-2 border-ron-negro/15 p-3">
          <input
            type="search"
            className="campo !min-h-0 !py-1.5 text-sm sm:max-w-sm"
            placeholder="Buscar por nombre, SKU o categoría…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar productos"
          />
        </div>

        <Aviso estado={eEstado} />
        <Aviso estado={ePrecio} />

        {visibles.length === 0 ? (
          <p className="p-5 text-sm texto-tenue">
            {productos.length === 0
              ? 'Todavía no hay productos. Crea el primero arriba o importa un CSV.'
              : 'No hay resultados para esa búsqueda.'}
          </p>
        ) : (
          <ul className="divide-y-2 divide-ron-negro/10">
            {visibles.map((p) => (
              <li key={p.id} className={`p-4 ${p.activo ? '' : 'bg-ron-gris/40'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {p.nombre}{' '}
                      {!p.activo && <span className="etiqueta etiqueta-cancelado">Oculto</span>}
                    </p>
                    <p className="text-xs texto-tenue">
                      {p.sku_base}
                      {p.categorias?.nombre ? ` · ${p.categorias.nombre}` : ' · sin categoría'}
                      {` · ${p.variantes.length} ${p.variantes.length === 1 ? 'variante' : 'variantes'}`}
                    </p>
                  </div>

                  <form action={aEstado}>
                    <input type="hidden" name="producto_id" value={p.id} />
                    <input type="hidden" name="activar" value={p.activo ? 'no' : 'si'} />
                    <Enviar
                      texto={p.activo ? 'Ocultar de la tienda' : 'Mostrar en la tienda'}
                      clase="boton-claro"
                    />
                  </form>
                </div>

                <ul className="mt-2 space-y-1.5">
                  {p.variantes.map((v) => (
                    <li
                      key={v.id}
                      className="tarjeta-sutil flex flex-wrap items-center justify-between gap-2 p-2"
                    >
                      <span className="text-sm">
                        {v.nombre === 'Única' ? 'Presentación única' : v.nombre}{' '}
                        <span className="text-xs texto-tenue">· {v.sku}</span>
                      </span>

                      <form action={aPrecio} className="flex items-center gap-1.5">
                        <input type="hidden" name="variante_id" value={v.id} />
                        <span className="text-xs texto-tenue">S/</span>
                        <input
                          name="precio"
                          inputMode="decimal"
                          defaultValue={solesPlano(v.precio_centimos)}
                          className="campo !min-h-0 !w-24 !py-1 text-sm"
                          aria-label={`Precio de ${v.nombre}`}
                        />
                        <Enviar texto="Guardar" clase="boton-claro" />
                      </form>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <p className="border-t-2 border-ron-negro/15 px-4 py-2 text-xs texto-tenue">
          Ocultar un producto no borra su stock ni sus ventas pasadas: sólo deja de
          mostrarse en la tienda. Cambiar un precio no altera los pedidos ya hechos.
        </p>
      </section>
    </div>
  );
}
