'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { soles } from '@/lib/dinero';
import {
  confirmarPago,
  cancelarPedido,
  registrarRecojo,
  type Resultado,
} from '@/app/panel/acciones';
import type { PedidoResumen, EstadoPedido } from '@/lib/tipos';

const ESTILO_ESTADO: Record<EstadoPedido, { clase: string; texto: string }> = {
  pendiente_pago: { clase: 'etiqueta-espera', texto: 'Esperando pago' },
  pagado: { clase: 'etiqueta-listo', texto: 'Pagado' },
  listo_recojo: { clase: 'etiqueta-listo', texto: 'Listo para recojo' },
  entregado: { clase: 'etiqueta-entregado', texto: 'Entregado' },
  cancelado: { clase: 'etiqueta-cancelado', texto: 'Cancelado' },
};

function Enviar({ texto, cargando, clase }: { texto: string; cargando: string; clase: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`boton boton-chico ${clase}`}>
      {pending ? cargando : texto}
    </button>
  );
}

function Aviso({ estado }: { estado: Resultado | null }) {
  if (!estado) return null;
  return (
    <p
      role="status"
      className={`mt-2 text-xs font-bold ${estado.ok ? 'text-ron-exito' : 'text-ron-peligro'}`}
    >
      {estado.mensaje}
    </p>
  );
}

export function TarjetaPedido({ pedido }: { pedido: PedidoResumen }) {
  const [verCancelar, setVerCancelar] = useState(false);

  const [estadoPago, accionPago] = useActionState<Resultado | null, FormData>(confirmarPago, null);
  const [estadoCancelar, accionCancelar] = useActionState<Resultado | null, FormData>(
    cancelarPedido,
    null,
  );
  const [estadoRecojo, accionRecojo] = useActionState<Resultado | null, FormData>(
    registrarRecojo,
    null,
  );

  const estilo = ESTILO_ESTADO[pedido.estado];
  const vencido =
    pedido.estado === 'pendiente_pago' && new Date(pedido.expira_en).getTime() < Date.now();

  const fecha = new Date(pedido.creado_en).toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // El teléfono tal cual lo dejó el cliente, listo para abrir el chat.
  const telefonoLimpio = pedido.cliente_telefono.replace(/[^0-9]/g, '');

  return (
    <article className="tarjeta flex h-full flex-col p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="display text-lg leading-tight">{pedido.codigo}</p>
          <p className="truncate text-sm font-bold">{pedido.cliente_nombre}</p>
          <p className="text-xs texto-tenue">
            {fecha} · {pedido.ubicaciones?.nombre ?? 'Sin punto de recojo'}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`etiqueta ${estilo.clase}`}>{estilo.texto}</span>
          {vencido && <span className="etiqueta etiqueta-alerta">Reserva vencida</span>}
        </div>
      </header>

      <ul className="mt-3 space-y-1 border-t-2 border-dashed border-ron-negro/25 pt-3 text-sm">
        {pedido.pedido_items.map((i) => (
          <li key={i.sku_snapshot} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              <strong>{i.cantidad}×</strong> {i.nombre_snapshot}
            </span>
            <span className="shrink-0 texto-tenue">{soles(i.subtotal_centimos)}</span>
          </li>
        ))}
      </ul>

      {pedido.cliente_nota && (
        <p className="mt-2 tarjeta-sutil bg-ron-amarillo-claro p-2 text-xs">
          <strong>Nota:</strong> {pedido.cliente_nota}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t-2 border-ron-negro pt-2">
        <a
          href={`https://wa.me/${telefonoLimpio}`}
          target="_blank"
          rel="noopener noreferrer"
          className="enlace-ron text-sm"
        >
          {pedido.cliente_telefono}
        </a>
        <span className="display text-xl">{soles(pedido.total_centimos)}</span>
      </div>

      {pedido.referencia_pago && (
        <p className="mt-1 text-xs texto-tenue">Pago: {pedido.referencia_pago}</p>
      )}

      {/* --- Acciones según el estado --- */}
      <div className="mt-3 space-y-2">
        {pedido.estado === 'pendiente_pago' && (
          <>
            <form action={accionPago} className="space-y-2">
              <input type="hidden" name="pedido_id" value={pedido.id} />
              <label className="etiqueta-campo" htmlFor={`ref-${pedido.id}`}>
                Referencia del pago verificado
              </label>
              <div className="flex gap-2">
                <input
                  id={`ref-${pedido.id}`}
                  name="referencia"
                  required
                  className="campo !min-h-0 !py-1.5 text-sm"
                  placeholder="N° de operación Yape / voucher"
                />
                <Enviar texto="Confirmar" cargando="Confirmando…" clase="boton-primario" />
              </div>
              <p className="text-[0.7rem] texto-tenue">
                Al confirmar se descuenta el inventario. Esto ocurre una sola vez.
              </p>
            </form>
            <Aviso estado={estadoPago} />
          </>
        )}

        {pedido.estado === 'listo_recojo' && (
          <>
            <form action={accionRecojo}>
              <input type="hidden" name="pedido_id" value={pedido.id} />
              <Enviar texto="Registrar recojo" cargando="Registrando…" clase="boton-primario" />
            </form>
            <Aviso estado={estadoRecojo} />
          </>
        )}

        {(pedido.estado === 'pendiente_pago' || pedido.estado === 'listo_recojo') && (
          <div>
            {!verCancelar ? (
              <button
                onClick={() => setVerCancelar(true)}
                className="text-xs texto-tenue underline"
              >
                Cancelar este pedido
              </button>
            ) : (
              <form action={accionCancelar} className="space-y-2">
                <input type="hidden" name="pedido_id" value={pedido.id} />
                <div className="flex gap-2">
                  <input
                    name="motivo"
                    required
                    className="campo !min-h-0 !py-1.5 text-sm"
                    placeholder="Motivo de la cancelación"
                  />
                  <Enviar texto="Cancelar" cargando="Cancelando…" clase="boton-peligro" />
                </div>
                <p className="text-[0.7rem] texto-tenue">
                  {pedido.estado === 'listo_recojo'
                    ? 'El stock ya descontado volverá al inventario.'
                    : 'Se liberará la reserva y el stock volverá a estar disponible.'}
                </p>
                <button
                  type="button"
                  onClick={() => setVerCancelar(false)}
                  className="text-xs texto-tenue underline"
                >
                  Mejor no
                </button>
              </form>
            )}
            <Aviso estado={estadoCancelar} />
          </div>
        )}
      </div>
    </article>
  );
}
