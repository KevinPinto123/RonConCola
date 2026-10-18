import Link from 'next/link';
import { clienteServidor, perfilActual } from '@/lib/supabase/servidor';
import { soles, numero } from '@/lib/dinero';
import { fechaCorta } from '@/lib/fechas';
import { OperacionesInventario } from '@/components/OperacionesInventario';
import { TablaStock } from '@/components/TablaStock';
import type { FilaStock, Ubicacion } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

type Movimiento = {
  creado_en: string;
  tipo: string;
  delta: number;
  producto: string;
  sku: string;
  ubicacion: string;
  cantidad_nueva: number;
  nota: string | null;
  responsable: string;
};

export default async function PaginaInventario({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; q?: string }>;
}) {
  const params = await searchParams;
  const supabase = await clienteServidor();
  const perfil = await perfilActual();

  const [{ data: stock, error }, { data: ubicaciones }, { data: movimientos }] = await Promise.all([
    supabase.from('v_stock_actual').select('*').order('producto'),
    supabase
      .from('ubicaciones')
      .select('id, codigo, nombre, tipo, es_punto_recojo')
      .eq('activa', true)
      .order('nombre'),
    supabase.rpc('movimientos_recientes', { p_limite: 40 }),
  ]);

  if (error) {
    return (
      <div className="tarjeta border-ron-peligro p-5">
        <p className="display text-lg text-ron-peligro">No pudimos cargar el inventario</p>
        <p className="mt-1 text-sm">{error.message}</p>
      </div>
    );
  }

  const filas = (stock ?? []) as FilaStock[];
  const puntos = (ubicaciones ?? []) as Ubicacion[];
  const bitacora = (movimientos ?? []) as Movimiento[];

  // Totales de la cabecera: se calculan sobre lo que devolvió la base.
  const unidades = filas.reduce((t, f) => t + f.cantidad, 0);
  const reservadas = filas.reduce((t, f) => t + f.reservado, 0);
  const valor = filas.reduce((t, f) => t + f.valor_costo_centimos, 0);
  const bajas = filas.filter((f) => f.bajo_stock).length;

  // Lista de variantes sin repetir, para los selectores de operación.
  const variantes = [...new Map(filas.map((f) => [f.variante_id, f])).values()].sort((a, b) =>
    `${a.producto} ${a.variante}`.localeCompare(`${b.producto} ${b.variante}`),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-2xl sm:text-3xl">
            <span className="titulo-subrayado">Inventario</span>
          </h1>
          <p className="mt-1 text-sm texto-tenue">
            Qué tenemos, dónde está y qué se movió.
          </p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Dato etiqueta="Unidades en stock" valor={numero(unidades)} />
        <Dato etiqueta="Reservadas" valor={numero(reservadas)} detalle="en pedidos abiertos" />
        <Dato etiqueta="Valor a costo" valor={soles(valor)} />
        <Dato
          etiqueta="Bajo mínimo"
          valor={numero(bajas)}
          detalle={bajas > 0 ? 'necesitan reposición' : 'todo en orden'}
          alerta={bajas > 0}
        />
      </section>

      <OperacionesInventario
        variantes={variantes.map((v) => ({
          variante_id: v.variante_id,
          etiqueta: `${v.producto}${v.variante !== 'Única' ? ` (${v.variante})` : ''} · ${v.sku}`,
        }))}
        ubicaciones={puntos}
        esAdmin={perfil?.rol === 'admin'}
      />

      <section className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-ron-negro bg-ron-amarillo px-4 py-2.5">
          <h2 className="display text-lg">Stock por ubicación</h2>
          <div className="flex gap-1.5">
            <Link
              href="/panel/inventario"
              className={`boton boton-chico ${params.filtro !== 'bajo' ? 'boton-oscuro' : 'boton-claro'}`}
            >
              Todo
            </Link>
            <Link
              href="/panel/inventario?filtro=bajo"
              className={`boton boton-chico ${params.filtro === 'bajo' ? 'boton-oscuro' : 'boton-claro'}`}
            >
              Sólo bajo mínimo
            </Link>
          </div>
        </div>

        <TablaStock filas={filas} soloBajas={params.filtro === 'bajo'} />
      </section>

      <section className="tarjeta overflow-hidden">
        <div className="border-b-[3px] border-ron-negro bg-ron-amarillo px-4 py-2.5">
          <h2 className="display text-lg">Últimos movimientos</h2>
          <p className="text-xs opacity-70">
            Cada unidad que entra o sale queda registrada con responsable y motivo.
          </p>
        </div>

        {bitacora.length === 0 ? (
          <p className="p-5 text-sm texto-tenue">Todavía no hay movimientos registrados.</p>
        ) : (
          <ul className="divide-y-2 divide-ron-negro/10">
            {bitacora.map((m, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span
                  className={`display shrink-0 text-base ${
                    m.delta > 0 ? 'text-ron-exito' : 'text-ron-peligro'
                  }`}
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{m.producto}</p>
                  <p className="text-xs texto-tenue">
                    {etiquetaMovimiento(m.tipo)} · {m.ubicacion} · queda {m.cantidad_nueva}
                    {m.nota ? ` · ${m.nota}` : ''}
                  </p>
                </div>

                <div className="shrink-0 text-right text-xs texto-tenue">
                  <p>{fechaCorta(m.creado_en)}</p>
                  <p>{m.responsable}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function etiquetaMovimiento(tipo: string): string {
  const mapa: Record<string, string> = {
    ingreso: 'Ingreso',
    venta_online: 'Venta web',
    venta_fisica: 'Venta en tienda',
    devolucion: 'Devolución',
    ajuste: 'Ajuste',
    traslado_salida: 'Traslado (salida)',
    traslado_entrada: 'Traslado (entrada)',
  };
  return mapa[tipo] ?? tipo;
}

function Dato({
  etiqueta,
  valor,
  detalle,
  alerta = false,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  alerta?: boolean;
}) {
  return (
    <div className={`tarjeta p-3.5 ${alerta ? 'bg-ron-amarillo' : ''}`}>
      <p className="text-[0.7rem] font-bold uppercase tracking-wider opacity-70">{etiqueta}</p>
      <p className="display mt-1 text-xl sm:text-2xl">{valor}</p>
      {detalle && <p className="mt-0.5 text-xs opacity-65">{detalle}</p>}
    </div>
  );
}
