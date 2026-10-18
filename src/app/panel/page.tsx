import Link from 'next/link';
import { clienteServidor, perfilActual } from '@/lib/supabase/servidor';
import { soles, numero } from '@/lib/dinero';
import { estadoIntegraciones } from '@/lib/entorno';
import { GraficoVentas } from '@/components/GraficoVentas';
import { GloboRoncito } from '@/components/Roncito';
import { BotonAccion } from '@/components/BotonAccion';
import { liberarReservasVencidas } from '@/app/panel/acciones';
import type { Kpis } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function PaginaIndicadores({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const params = await searchParams;
  const dias = Math.min(Math.max(Number(params.dias) || 30, 1), 365);

  const supabase = await clienteServidor();
  const perfil = await perfilActual();

  // Todos estos números los calcula Postgres. Aquí sólo se muestran.
  const { data, error } = await supabase.rpc('kpis_resumen', { p_dias: dias });

  if (error) {
    return (
      <div className="tarjeta border-ron-peligro p-5">
        <p className="display text-lg text-ron-peligro">No pudimos cargar los indicadores</p>
        <p className="mt-1 text-sm">{error.message}</p>
        <p className="mt-3 text-xs texto-tenue">
          Revisa que las migraciones de <code className="font-mono">supabase/migraciones/</code>{' '}
          estén aplicadas en el proyecto.
        </p>
      </div>
    );
  }

  const k = data as Kpis;
  const pendientes = estadoIntegraciones().filter((i) => !i.listo);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-2xl sm:text-3xl">
            <span className="titulo-subrayado">Indicadores</span>
          </h1>
          <p className="mt-1 text-sm texto-tenue">
            Hola, {perfil?.nombre}. Últimos {k.periodo_dias} días.
          </p>
        </div>

        <nav className="flex gap-1.5" aria-label="Periodo">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/panel?dias=${d}`}
              className={`boton boton-chico ${d === dias ? 'boton-oscuro' : 'boton-claro'}`}
            >
              {d} días
            </Link>
          ))}
        </nav>
      </div>

      {/* --- Lo que necesita atención hoy --- */}
      {(k.pedidos.por_verificar > 0 ||
        k.pedidos.reservas_vencidas > 0 ||
        k.stock_bajo.length > 0) && (
        <section className="tarjeta border-ron-alerta bg-ron-amarillo-claro p-4">
          <h2 className="display mb-2 text-base">Pendiente para hoy</h2>
          <ul className="space-y-1.5 text-sm">
            {k.pedidos.por_verificar > 0 && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="etiqueta etiqueta-espera">{k.pedidos.por_verificar}</span>
                pedidos esperando que verifiques el pago ({soles(k.pedidos.monto_por_verificar)}).
                <Link href="/panel/pedidos" className="enlace-ron font-bold">
                  Revisar
                </Link>
              </li>
            )}
            {k.pedidos.por_entregar > 0 && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="etiqueta etiqueta-listo">{k.pedidos.por_entregar}</span>
                pedidos pagados esperando que el cliente los recoja.
              </li>
            )}
            {k.pedidos.reservas_vencidas > 0 && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="etiqueta etiqueta-alerta">{k.pedidos.reservas_vencidas}</span>
                reservas vencidas están bloqueando stock vendible.
                <BotonAccion
                  accion={liberarReservasVencidas}
                  etiqueta="Liberar ahora"
                  cargando="Liberando…"
                />
              </li>
            )}
            {k.stock_bajo.length > 0 && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="etiqueta etiqueta-alerta">{k.stock_bajo.length}</span>
                productos en o bajo su stock mínimo.
                <Link href="/panel/inventario?filtro=bajo" className="enlace-ron font-bold">
                  Ver cuáles
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* --- Cifras principales --- */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          etiqueta="Ventas del periodo"
          valor={soles(k.ventas_totales_centimos)}
          detalle={`${numero(k.operaciones)} operaciones`}
          destacado
        />
        <Indicador
          etiqueta="Ticket promedio"
          valor={soles(k.ticket_promedio_centimos)}
          detalle="por operación"
        />
        <Indicador
          etiqueta="Unidades vendidas"
          valor={numero(k.unidades_vendidas)}
          detalle="piezas que salieron"
        />
        <Indicador
          etiqueta="Valor del inventario"
          valor={soles(k.inventario.valor_costo_centimos)}
          detalle={`${numero(k.inventario.unidades_en_stock)} unidades a costo`}
        />
      </section>

      {/* --- Evolución --- */}
      <section className="tarjeta p-4 sm:p-5">
        <h2 className="display text-lg">Ventas por día</h2>
        <p className="mb-2 text-xs texto-tenue">
          Incluye pedidos web con pago verificado y ventas presenciales.
        </p>
        <GraficoVentas datos={k.ventas_por_dia} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- Top productos --- */}
        <section className="tarjeta p-4 sm:p-5">
          <h2 className="display text-lg">Lo que más sale</h2>
          {k.top_productos.length === 0 ? (
            <p className="mt-3 text-sm texto-tenue">Sin ventas en el periodo.</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {k.top_productos.map((p, i) => {
                const tope = k.top_productos[0].unidades || 1;
                return (
                  <li key={p.producto} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-bold">
                        <span className="texto-tenue">{i + 1}.</span> {p.producto}
                      </span>
                      <span className="display shrink-0">{p.unidades} u.</span>
                    </div>
                    {/* Barra proporcional: compara de un vistazo sin leer cifras */}
                    <div className="mt-1 h-2 overflow-hidden rounded-full border-2 border-ron-negro bg-white">
                      <div
                        className="h-full bg-ron-amarillo"
                        style={{ width: `${(p.unidades / tope) * 100}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-xs texto-tenue">{soles(p.ingreso_centimos)}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* --- Stock bajo --- */}
        <section className="tarjeta p-4 sm:p-5">
          <h2 className="display text-lg">Hay que reponer</h2>
          {k.stock_bajo.length === 0 ? (
            <div className="mt-4">
              <GloboRoncito animo="contento" tamano={48}>
                Todo por encima del mínimo. Por esta vez, bien hecho.
              </GloboRoncito>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {k.stock_bajo.map((s, i) => (
                <li
                  key={`${s.producto}-${s.ubicacion}-${i}`}
                  className="tarjeta-sutil flex items-center justify-between gap-3 p-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold">{s.producto}</p>
                    <p className="text-xs texto-tenue">
                      {s.variante !== 'Única' ? `${s.variante} · ` : ''}
                      {s.ubicacion}
                    </p>
                  </div>
                  <span
                    className={`etiqueta shrink-0 ${s.disponible <= 0 ? 'etiqueta-cancelado' : 'etiqueta-alerta'}`}
                  >
                    {s.disponible} / mín {s.stock_minimo}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* --- Canales y conversión --- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="tarjeta p-4 sm:p-5">
          <h2 className="display text-lg">Por canal</h2>
          {k.ventas_por_canal.length === 0 ? (
            <p className="mt-3 text-sm texto-tenue">Sin ventas en el periodo.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {k.ventas_por_canal.map((c) => (
                <li key={c.canal} className="flex items-center justify-between text-sm">
                  <span className="font-bold capitalize">
                    {c.canal === 'online' ? '🌐 Tienda web' : '🏪 Presencial'}
                  </span>
                  <span>
                    <span className="display">{soles(c.total_centimos)}</span>
                    <span className="ml-2 text-xs texto-tenue">({c.operaciones})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tarjeta p-4 sm:p-5">
          <h2 className="display text-lg">Pedidos del periodo</h2>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Fila etiqueta="Creados" valor={numero(k.conversion.pedidos_creados)} />
            <Fila etiqueta="Concretados" valor={numero(k.conversion.pedidos_concretados)} />
            <Fila etiqueta="Cancelados" valor={numero(k.conversion.pedidos_cancelados)} />
            <Fila
              etiqueta="Unidades reservadas ahora"
              valor={numero(k.inventario.unidades_reservadas)}
            />
          </dl>
          {k.conversion.pedidos_creados > 0 && (
            <p className="mt-3 text-xs texto-tenue">
              {Math.round(
                (k.conversion.pedidos_concretados / k.conversion.pedidos_creados) * 100,
              )}
              % de los pedidos creados terminaron en venta.
            </p>
          )}
        </section>
      </div>

      {/* --- Credenciales que faltan --- */}
      {pendientes.length > 0 && (
        <section className="tarjeta border-dashed p-4">
          <h2 className="display text-base">Integraciones por configurar</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {pendientes.map((i) => (
              <li key={i.nombre}>
                <span className="font-bold">{i.nombre}</span>{' '}
                <span className="etiqueta etiqueta-espera">Modo demostración</span>
                <p className="mt-0.5 text-xs texto-tenue">{i.sinCredencial}</p>
                <p className="mt-0.5 text-xs">
                  Falta:{' '}
                  {i.faltan.map((v) => (
                    <code key={v} className="mr-1 rounded bg-ron-gris px-1 py-0.5 font-mono text-[0.7rem] text-ron-negro">
                      {v}
                    </code>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Indicador({
  etiqueta,
  valor,
  detalle,
  destacado = false,
}: {
  etiqueta: string;
  valor: string;
  detalle: string;
  destacado?: boolean;
}) {
  return (
    <div className={`tarjeta p-3.5 ${destacado ? 'bg-ron-amarillo' : ''}`}>
      <p className="text-[0.7rem] font-bold uppercase tracking-wider opacity-70">{etiqueta}</p>
      <p className="display mt-1 text-xl leading-tight sm:text-2xl">{valor}</p>
      <p className="mt-0.5 text-xs opacity-65">{detalle}</p>
    </div>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="texto-tenue">{etiqueta}</dt>
      <dd className="display">{valor}</dd>
    </div>
  );
}
