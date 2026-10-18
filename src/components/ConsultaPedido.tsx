'use client';

import { useState } from 'react';
import { clienteNavegador } from '@/lib/supabase/cliente';
import { soles } from '@/lib/dinero';
import { Roncito } from '@/components/Roncito';
import type { EstadoPedido } from '@/lib/tipos';

type Pedido = {
  codigo: string;
  estado: EstadoPedido;
  cliente_nombre: string;
  total_centimos: number;
  punto_recojo: string;
  creado_en: string;
  items: { nombre: string; cantidad: number; subtotal_centimos: number }[];
};

/** Cada estado explicado para el cliente, no con la jerga del sistema. */
const EXPLICACION: Record<EstadoPedido, { titulo: string; detalle: string; clase: string; animo: 'normal' | 'contento' | 'alerta' | 'dormido' }> = {
  pendiente_pago: {
    titulo: 'Esperando tu pago',
    detalle:
      'Guardamos tus productos por 48 horas desde que hiciste el pedido. Coordina el pago por WhatsApp para confirmarlo.',
    clase: 'etiqueta-espera',
    animo: 'alerta',
  },
  pagado: {
    titulo: 'Pago recibido',
    detalle: 'Estamos preparando tu pedido.',
    clase: 'etiqueta-listo',
    animo: 'contento',
  },
  listo_recojo: {
    titulo: '¡Listo para recoger!',
    detalle: 'Verificamos tu pago y tu pedido está separado. Pasa cuando quieras.',
    clase: 'etiqueta-listo',
    animo: 'contento',
  },
  entregado: {
    titulo: 'Entregado',
    detalle: 'Ya lo recogiste. ¡Gracias por comprarnos!',
    clase: 'etiqueta-entregado',
    animo: 'contento',
  },
  cancelado: {
    titulo: 'Cancelado',
    detalle: 'Este pedido fue cancelado. Si crees que es un error, escríbenos.',
    clase: 'etiqueta-cancelado',
    animo: 'dormido',
  },
};

export function ConsultaPedido() {
  const [codigo, setCodigo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPedido(null);
    setBuscando(true);

    try {
      // La función de la base exige código + teléfono coincidentes:
      // nadie puede listar pedidos ajenos probando códigos al azar.
      const supabase = clienteNavegador();
      const { data, error: errorRpc } = await supabase.rpc('consultar_pedido', {
        p_codigo: codigo,
        p_telefono: telefono,
      });

      if (errorRpc) throw new Error(errorRpc.message);
      setPedido(data as Pedido);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No encontramos ese pedido. Revisa el código y el teléfono.',
      );
    } finally {
      setBuscando(false);
    }
  }

  if (pedido) {
    const info = EXPLICACION[pedido.estado];

    return (
      <div className="tarjeta overflow-hidden">
        <div className="border-b-[3px] border-ron-negro bg-ron-amarillo px-5 py-6 text-center">
          <Roncito tamano={72} animo={info.animo} className="mx-auto text-ron-negro" />
          <p className="display mt-2 text-2xl">{pedido.codigo}</p>
          <span className={`etiqueta mt-2 ${info.clase}`}>{info.titulo}</span>
        </div>

        <div className="p-5">
          <p className="text-sm">{info.detalle}</p>

          <ul className="mt-4 space-y-1 border-t-2 border-dashed border-ron-negro/25 pt-3 text-sm">
            {pedido.items.map((i) => (
              <li key={i.nombre} className="flex justify-between gap-2">
                <span>
                  <strong>{i.cantidad}×</strong> {i.nombre}
                </span>
                <span className="texto-tenue">{soles(i.subtotal_centimos)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between border-t-2 border-ron-negro pt-2">
            <span className="display">Total</span>
            <span className="display text-xl">{soles(pedido.total_centimos)}</span>
          </div>

          <p className="mt-3 text-xs texto-tenue">Recojo en {pedido.punto_recojo}</p>

          <button
            onClick={() => {
              setPedido(null);
              setCodigo('');
              setTelefono('');
            }}
            className="boton boton-claro mt-5 w-full"
          >
            Consultar otro pedido
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={buscar} className="tarjeta space-y-3 p-5">
      <div>
        <label className="etiqueta-campo" htmlFor="codigo">
          Código del pedido
        </label>
        <input
          id="codigo"
          className="campo uppercase"
          required
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="RCC-1234"
        />
      </div>

      <div>
        <label className="etiqueta-campo" htmlFor="telefono">
          Teléfono con el que compraste
        </label>
        <input
          id="telefono"
          className="campo"
          required
          inputMode="tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="9XX XXX XXX"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="tarjeta-sutil border-ron-peligro bg-red-50 p-3 text-sm font-bold text-ron-peligro"
        >
          {error}
        </p>
      )}

      <button type="submit" disabled={buscando} className="boton boton-primario w-full">
        {buscando ? 'Buscando…' : 'Ver mi pedido'}
      </button>
    </form>
  );
}
