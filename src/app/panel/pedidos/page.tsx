import Link from 'next/link';
import { clienteServidor } from '@/lib/supabase/servidor';
import { soles } from '@/lib/dinero';
import { TarjetaPedido } from '@/components/TarjetaPedido';
import { GloboRoncito } from '@/components/Roncito';
import type { PedidoResumen, EstadoPedido } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

const FILTROS: { clave: string; etiqueta: string; estados: EstadoPedido[] | null }[] = [
  { clave: 'por_verificar', etiqueta: 'Por verificar', estados: ['pendiente_pago'] },
  { clave: 'por_entregar', etiqueta: 'Por entregar', estados: ['listo_recojo'] },
  { clave: 'entregados', etiqueta: 'Entregados', estados: ['entregado'] },
  { clave: 'cancelados', etiqueta: 'Cancelados', estados: ['cancelado'] },
  { clave: 'todos', etiqueta: 'Todos', estados: null },
];

export default async function PaginaPedidos({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const params = await searchParams;
  const claveFiltro = params.estado ?? 'por_verificar';
  const filtro = FILTROS.find((f) => f.clave === claveFiltro) ?? FILTROS[0];

  const supabase = await clienteServidor();

  let consulta = supabase
    .from('pedidos')
    .select(
      `id, codigo, cliente_nombre, cliente_telefono, cliente_nota, estado,
       total_centimos, creado_en, expira_en, pagado_en, referencia_pago,
       ubicaciones ( nombre, codigo ),
       pedido_items ( nombre_snapshot, sku_snapshot, cantidad,
                      precio_unitario_centimos, subtotal_centimos )`,
    )
    .order('creado_en', { ascending: false })
    .limit(100);

  if (filtro.estados) consulta = consulta.in('estado', filtro.estados);

  const { data, error } = await consulta;

  if (error) {
    return (
      <div className="tarjeta border-ron-peligro p-5">
        <p className="display text-lg text-ron-peligro">No pudimos cargar los pedidos</p>
        <p className="mt-1 text-sm">{error.message}</p>
      </div>
    );
  }

  const pedidos = (data ?? []) as unknown as PedidoResumen[];
  const totalPeriodo = pedidos.reduce((t, p) => t + p.total_centimos, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-2xl sm:text-3xl">
          <span className="titulo-subrayado">Pedidos</span>
        </h1>
        <p className="mt-1 text-sm texto-tenue">
          Verifica el pago, confirma y registra el recojo.
        </p>
      </div>

      <nav className="sin-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" aria-label="Filtrar pedidos">
        {FILTROS.map((f) => (
          <Link
            key={f.clave}
            href={`/panel/pedidos?estado=${f.clave}`}
            className={`boton boton-chico shrink-0 ${
              f.clave === filtro.clave ? 'boton-oscuro' : 'boton-claro'
            }`}
          >
            {f.etiqueta}
          </Link>
        ))}
      </nav>

      {pedidos.length > 0 && (
        <p className="text-sm texto-tenue">
          {pedidos.length} {pedidos.length === 1 ? 'pedido' : 'pedidos'} ·{' '}
          <strong className="display">{soles(totalPeriodo)}</strong>
        </p>
      )}

      {pedidos.length === 0 ? (
        <div className="tarjeta p-6">
          <GloboRoncito animo="dormido" tamano={56}>
            Nada por aquí. Aprovecha y toma agua, humana.
          </GloboRoncito>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {pedidos.map((p) => (
            <li key={p.id}>
              <TarjetaPedido pedido={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
