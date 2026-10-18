'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  registrarIngreso,
  registrarVentaFisica,
  registrarDevolucion,
  ajustarStock,
  trasladarStock,
  type Resultado,
} from '@/app/panel/acciones';
import type { Ubicacion } from '@/lib/tipos';

type VarianteOpcion = { variante_id: string; etiqueta: string };

type Props = {
  variantes: VarianteOpcion[];
  ubicaciones: Ubicacion[];
  esAdmin: boolean;
};

const OPERACIONES = [
  { clave: 'venta', etiqueta: 'Venta en tienda', icono: '💵', soloAdmin: false },
  { clave: 'ingreso', etiqueta: 'Ingreso', icono: '📦', soloAdmin: false },
  { clave: 'devolucion', etiqueta: 'Devolución', icono: '↩️', soloAdmin: false },
  { clave: 'traslado', etiqueta: 'Traslado', icono: '🚚', soloAdmin: false },
  { clave: 'ajuste', etiqueta: 'Ajuste por conteo', icono: '🔢', soloAdmin: true },
] as const;

function Enviar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="boton boton-primario w-full sm:w-auto">
      {pending ? 'Registrando…' : texto}
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

/** Selector de producto, compartido por todas las operaciones. */
function SelectorVariante({ variantes, id }: { variantes: VarianteOpcion[]; id: string }) {
  return (
    <div>
      <label className="etiqueta-campo" htmlFor={id}>
        Producto
      </label>
      <select id={id} name="variante_id" required className="campo text-sm" defaultValue="">
        <option value="" disabled>
          Elige un producto…
        </option>
        {variantes.map((v) => (
          <option key={v.variante_id} value={v.variante_id}>
            {v.etiqueta}
          </option>
        ))}
      </select>
    </div>
  );
}

function SelectorUbicacion({
  ubicaciones,
  id,
  nombre = 'ubicacion',
  etiqueta = 'Ubicación',
}: {
  ubicaciones: Ubicacion[];
  id: string;
  nombre?: string;
  etiqueta?: string;
}) {
  return (
    <div>
      <label className="etiqueta-campo" htmlFor={id}>
        {etiqueta}
      </label>
      <select id={id} name={nombre} required className="campo text-sm">
        {ubicaciones.map((u) => (
          <option key={u.codigo} value={u.codigo}>
            {u.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}

export function OperacionesInventario({ variantes, ubicaciones, esAdmin }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [operacion, setOperacion] = useState<string>('venta');

  const [eVenta, aVenta] = useActionState<Resultado | null, FormData>(registrarVentaFisica, null);
  const [eIngreso, aIngreso] = useActionState<Resultado | null, FormData>(registrarIngreso, null);
  const [eDevolucion, aDevolucion] = useActionState<Resultado | null, FormData>(
    registrarDevolucion,
    null,
  );
  const [eTraslado, aTraslado] = useActionState<Resultado | null, FormData>(trasladarStock, null);
  const [eAjuste, aAjuste] = useActionState<Resultado | null, FormData>(ajustarStock, null);

  const disponibles = OPERACIONES.filter((o) => !o.soloAdmin || esAdmin);

  if (variantes.length === 0) {
    return (
      <section className="tarjeta border-dashed p-4">
        <p className="text-sm texto-tenue">
          Todavía no hay productos cargados. Importa un CSV o crea productos para
          empezar a mover inventario.
        </p>
      </section>
    );
  }

  return (
    <section className="tarjeta overflow-hidden">
      <button
        onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-2 border-b-[3px] border-ron-negro bg-ron-amarillo px-4 py-2.5 text-left"
      >
        <span className="display text-lg">Registrar un movimiento</span>
        <span className="display text-xl">{abierto ? '−' : '+'}</span>
      </button>

      {abierto && (
        <div className="p-4">
          <div className="sin-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4">
            {disponibles.map((o) => (
              <button
                key={o.clave}
                onClick={() => setOperacion(o.clave)}
                aria-pressed={operacion === o.clave}
                className={`boton boton-chico shrink-0 ${
                  operacion === o.clave ? 'boton-oscuro' : 'boton-claro'
                }`}
              >
                <span aria-hidden>{o.icono}</span> {o.etiqueta}
              </button>
            ))}
          </div>

          {/* --- Venta presencial --- */}
          {operacion === 'venta' && (
            <>
              <form action={aVenta} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SelectorVariante variantes={variantes} id="venta-variante" />
                </div>
                <SelectorUbicacion ubicaciones={ubicaciones} id="venta-ubicacion" />
                <div>
                  <label className="etiqueta-campo" htmlFor="venta-cantidad">
                    Cantidad
                  </label>
                  <input
                    id="venta-cantidad"
                    name="cantidad"
                    type="number"
                    min={1}
                    defaultValue={1}
                    required
                    className="campo text-sm"
                  />
                </div>
                <div>
                  <label className="etiqueta-campo" htmlFor="venta-metodo">
                    Método de pago
                  </label>
                  <select id="venta-metodo" name="metodo_pago" className="campo text-sm">
                    <option value="efectivo">Efectivo</option>
                    <option value="yape">Yape</option>
                    <option value="plin">Plin</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </div>
                <div>
                  <label className="etiqueta-campo" htmlFor="venta-nota">
                    Nota <span className="texto-tenue">(opcional)</span>
                  </label>
                  <input id="venta-nota" name="nota" className="campo text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <Enviar texto="Registrar venta" />
                  <p className="mt-1.5 text-xs texto-tenue">
                    El stock se descuenta en el momento. El precio se toma del catálogo.
                  </p>
                </div>
              </form>
              <Aviso estado={eVenta} />
            </>
          )}

          {/* --- Ingreso --- */}
          {operacion === 'ingreso' && (
            <>
              <form action={aIngreso} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SelectorVariante variantes={variantes} id="ingreso-variante" />
                </div>
                <SelectorUbicacion ubicaciones={ubicaciones} id="ingreso-ubicacion" />
                <div>
                  <label className="etiqueta-campo" htmlFor="ingreso-cantidad">
                    Cantidad que entra
                  </label>
                  <input
                    id="ingreso-cantidad"
                    name="cantidad"
                    type="number"
                    min={1}
                    required
                    className="campo text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="etiqueta-campo" htmlFor="ingreso-nota">
                    De dónde viene <span className="texto-tenue">(opcional)</span>
                  </label>
                  <input
                    id="ingreso-nota"
                    name="nota"
                    className="campo text-sm"
                    placeholder="Producción de la semana, compra a proveedor…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Enviar texto="Registrar ingreso" />
                </div>
              </form>
              <Aviso estado={eIngreso} />
            </>
          )}

          {/* --- Devolución --- */}
          {operacion === 'devolucion' && (
            <>
              <form action={aDevolucion} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SelectorVariante variantes={variantes} id="dev-variante" />
                </div>
                <SelectorUbicacion ubicaciones={ubicaciones} id="dev-ubicacion" />
                <div>
                  <label className="etiqueta-campo" htmlFor="dev-cantidad">
                    Cantidad devuelta
                  </label>
                  <input
                    id="dev-cantidad"
                    name="cantidad"
                    type="number"
                    min={1}
                    defaultValue={1}
                    required
                    className="campo text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="etiqueta-campo" htmlFor="dev-motivo">
                    Motivo <span className="text-ron-peligro">*</span>
                  </label>
                  <input
                    id="dev-motivo"
                    name="motivo"
                    required
                    className="campo text-sm"
                    placeholder="Producto con falla, cliente cambió de opinión…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Enviar texto="Registrar devolución" />
                  <p className="mt-1.5 text-xs texto-tenue">
                    Las unidades vuelven al stock de esa ubicación.
                  </p>
                </div>
              </form>
              <Aviso estado={eDevolucion} />
            </>
          )}

          {/* --- Traslado --- */}
          {operacion === 'traslado' && (
            <>
              <form action={aTraslado} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SelectorVariante variantes={variantes} id="tras-variante" />
                </div>
                <SelectorUbicacion
                  ubicaciones={ubicaciones}
                  id="tras-origen"
                  nombre="origen"
                  etiqueta="Desde"
                />
                <SelectorUbicacion
                  ubicaciones={ubicaciones}
                  id="tras-destino"
                  nombre="destino"
                  etiqueta="Hacia"
                />
                <div>
                  <label className="etiqueta-campo" htmlFor="tras-cantidad">
                    Cantidad
                  </label>
                  <input
                    id="tras-cantidad"
                    name="cantidad"
                    type="number"
                    min={1}
                    required
                    className="campo text-sm"
                  />
                </div>
                <div>
                  <label className="etiqueta-campo" htmlFor="tras-nota">
                    Nota <span className="texto-tenue">(opcional)</span>
                  </label>
                  <input
                    id="tras-nota"
                    name="nota"
                    className="campo text-sm"
                    placeholder="Para la feria del sábado…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Enviar texto="Registrar traslado" />
                  <p className="mt-1.5 text-xs texto-tenue">
                    Sale de un lado y entra al otro en la misma operación. Si no hay
                    stock suficiente, no se mueve nada.
                  </p>
                </div>
              </form>
              <Aviso estado={eTraslado} />
            </>
          )}

          {/* --- Ajuste (sólo administración) --- */}
          {operacion === 'ajuste' && esAdmin && (
            <>
              <form action={aAjuste} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SelectorVariante variantes={variantes} id="aj-variante" />
                </div>
                <SelectorUbicacion ubicaciones={ubicaciones} id="aj-ubicacion" />
                <div>
                  <label className="etiqueta-campo" htmlFor="aj-cantidad">
                    Cantidad contada en físico
                  </label>
                  <input
                    id="aj-cantidad"
                    name="cantidad_real"
                    type="number"
                    min={0}
                    required
                    className="campo text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="etiqueta-campo" htmlFor="aj-motivo">
                    Motivo <span className="text-ron-peligro">*</span>
                  </label>
                  <input
                    id="aj-motivo"
                    name="motivo"
                    required
                    className="campo text-sm"
                    placeholder="Conteo del lunes, merma, error de registro…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Enviar texto="Ajustar al conteo" />
                  <p className="mt-1.5 text-xs texto-tenue">
                    El sistema calcula la diferencia contra lo registrado y la guarda
                    en la bitácora con tu nombre.
                  </p>
                </div>
              </form>
              <Aviso estado={eAjuste} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
