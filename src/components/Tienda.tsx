'use client';

import { useEffect, useMemo, useState } from 'react';
import { soles } from '@/lib/dinero';
import { Roncito, GloboRoncito } from '@/components/Roncito';
import type { LineaCarrito, ProductoCatalogo, Ubicacion } from '@/lib/tipos';

const CLAVE_CARRITO = 'roncito:carrito';

type Props = {
  productos: ProductoCatalogo[];
  puntosRecojo: Ubicacion[];
  whatsappListo: boolean;
};

type PedidoCreado = {
  codigo: string;
  total_centimos: number;
  punto_recojo: string;
  enlace_whatsapp: string | null;
  mensaje: string;
};

export function Tienda({ productos, puntosRecojo, whatsappListo }: Props) {
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [categoria, setCategoria] = useState<string>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [pedidoCreado, setPedidoCreado] = useState<PedidoCreado | null>(null);

  // El carrito sobrevive a recargas, pero vive sólo en este navegador.
  // Nada de esto es la fuente de verdad: el precio real lo pone el servidor.
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(CLAVE_CARRITO);
      if (guardado) setCarrito(JSON.parse(guardado));
    } catch {
      // Navegación privada o almacenamiento bloqueado: seguimos sin carrito guardado.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
    } catch {
      /* ignorado a propósito */
    }
  }, [carrito]);

  const categorias = useMemo(() => {
    const mapa = new Map<string, { nombre: string; emoji: string; slug: string }>();
    productos.forEach((p) =>
      mapa.set(p.categoria_slug, {
        nombre: p.categoria,
        emoji: p.categoria_emoji,
        slug: p.categoria_slug,
      }),
    );
    return [...mapa.values()];
  }, [productos]);

  const visibles = useMemo(() => {
    const termino = busqueda
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();

    return productos.filter((p) => {
      if (categoria !== 'todas' && p.categoria_slug !== categoria) return false;
      if (!termino) return true;
      const texto = `${p.producto} ${p.variante} ${p.sku} ${p.categoria} ${p.descripcion ?? ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      return texto.includes(termino);
    });
  }, [productos, categoria, busqueda]);

  const unidades = carrito.reduce((t, l) => t + l.cantidad, 0);
  const total = carrito.reduce((t, l) => t + l.cantidad * l.precio_centimos, 0);

  function agregar(p: ProductoCatalogo) {
    setCarrito((prev) => {
      const existente = prev.find((l) => l.variante_id === p.variante_id);
      if (existente) {
        // No dejamos pasar del stock disponible: el servidor lo rechazaría
        // igual, pero es mejor avisarlo antes de llegar al final.
        if (existente.cantidad >= p.disponible) return prev;
        return prev.map((l) =>
          l.variante_id === p.variante_id ? { ...l, cantidad: l.cantidad + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          variante_id: p.variante_id,
          producto: p.producto,
          variante: p.variante,
          sku: p.sku,
          precio_centimos: p.precio_centimos,
          cantidad: 1,
          disponible: p.disponible,
          imagen_url: p.imagen_url,
        },
      ];
    });
    setCarritoAbierto(true);
  }

  function cambiarCantidad(varianteId: string, delta: number) {
    setCarrito((prev) =>
      prev
        .map((l) =>
          l.variante_id === varianteId
            ? { ...l, cantidad: Math.min(Math.max(l.cantidad + delta, 0), l.disponible) }
            : l,
        )
        .filter((l) => l.cantidad > 0),
    );
  }

  function quitar(varianteId: string) {
    setCarrito((prev) => prev.filter((l) => l.variante_id !== varianteId));
  }

  if (pedidoCreado) {
    return (
      <PedidoListo
        pedido={pedidoCreado}
        whatsappListo={whatsappListo}
        alVolver={() => {
          setPedidoCreado(null);
          setCarrito([]);
          setCarritoAbierto(false);
        }}
      />
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-28">
      <Portada />

      {/* --- Buscador y categorías --- */}
      <section className="mt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            className="campo sm:max-w-sm"
            placeholder="Busca un michi… (taza, sticker, peluche)"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar productos"
          />
          <p className="text-sm texto-tenue">
            {visibles.length} {visibles.length === 1 ? 'producto' : 'productos'}
          </p>
        </div>

        <div className="sin-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <ChipCategoria
            activa={categoria === 'todas'}
            onClick={() => setCategoria('todas')}
            emoji="🐾"
            nombre="Todo"
          />
          {categorias.map((c) => (
            <ChipCategoria
              key={c.slug}
              activa={categoria === c.slug}
              onClick={() => setCategoria(c.slug)}
              emoji={c.emoji}
              nombre={c.nombre}
            />
          ))}
        </div>
      </section>

      {/* --- Catálogo --- */}
      <section className="mt-6">
        {visibles.length === 0 ? (
          <div className="tarjeta mt-6 p-8 text-center">
            <Roncito tamano={70} animo="dormido" className="mx-auto text-ron-negro" />
            <p className="display mt-3 text-xl">Aquí no hay nada, humana</p>
            <p className="mt-1 text-sm texto-tenue">
              Prueba con otra palabra o mira todas las categorías.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {visibles.map((p) => {
              const enCarrito = carrito.find((l) => l.variante_id === p.variante_id);
              return (
                <TarjetaProducto
                  key={p.variante_id}
                  producto={p}
                  cantidadEnCarrito={enCarrito?.cantidad ?? 0}
                  onAgregar={() => agregar(p)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* --- Botón flotante del carrito --- */}
      {unidades > 0 && !carritoAbierto && (
        <button
          onClick={() => setCarritoAbierto(true)}
          className="boton boton-primario fixed bottom-4 left-1/2 z-40 -translate-x-1/2 shadow-[5px_5px_0_#141210]"
        >
          🛒 Ver pedido · {unidades} {unidades === 1 ? 'ítem' : 'ítems'} · {soles(total)}
        </button>
      )}

      {carritoAbierto && (
        <PanelCarrito
          carrito={carrito}
          puntosRecojo={puntosRecojo}
          whatsappListo={whatsappListo}
          onCerrar={() => setCarritoAbierto(false)}
          onCambiarCantidad={cambiarCantidad}
          onQuitar={quitar}
          onPedidoCreado={setPedidoCreado}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------

function Portada() {
  return (
    <section className="relative mt-6 overflow-hidden rounded-[1.4rem] border-[3px] border-ron-negro bg-ron-amarillo px-5 py-8 shadow-[6px_6px_0_#141210] sm:px-10 sm:py-12">
      {/* Marca de agua tras el texto, como en el pitch */}
      <div className="pointer-events-none absolute -right-8 -top-10 opacity-[0.07]">
        <Roncito tamano={260} className="text-ron-negro" />
      </div>

      <div className="relative max-w-2xl">
        <p className="cintillo inline-block rounded-full px-3 py-1 text-[0.68rem]">
          Tienda oficial · Lima, Perú
        </p>
        <h1 className="display mt-3 text-4xl leading-[0.95] text-ron-negro sm:text-6xl">
          Tienda para
          <br />
          humanos entrenados
        </h1>
        <p className="mt-4 max-w-md text-base font-bold text-ron-negro/80 sm:text-lg">
          Lo que ves es lo que hay: el stock de esta página sale del inventario
          real de la tienda. Eliges, pides y recoges.
        </p>

        <div className="mt-6 inline-block">
          <GloboRoncito animo="alerta" tamano={54}>
            ¡Humana! Ya no mandes capturas por el chat. Agrega al carrito y listo.
          </GloboRoncito>
        </div>
      </div>
    </section>
  );
}

function ChipCategoria({
  activa,
  onClick,
  emoji,
  nombre,
}: {
  activa: boolean;
  onClick: () => void;
  emoji: string;
  nombre: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activa}
      className={`boton boton-chico shrink-0 ${activa ? 'boton-oscuro' : 'boton-claro'}`}
    >
      <span aria-hidden>{emoji}</span> {nombre}
    </button>
  );
}

function TarjetaProducto({
  producto,
  cantidadEnCarrito,
  onAgregar,
}: {
  producto: ProductoCatalogo;
  cantidadEnCarrito: number;
  onAgregar: () => void;
}) {
  const agotado = producto.disponible <= 0;
  const ultimas = producto.disponible > 0 && producto.disponible <= 3;
  const tope = cantidadEnCarrito >= producto.disponible;

  return (
    <article className="tarjeta tarjeta-producto flex flex-col overflow-hidden">
      <div className="relative flex aspect-square items-center justify-center border-b-[3px] border-ron-negro bg-ron-amarillo-claro">
        {producto.imagen_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={producto.imagen_url}
            alt={producto.producto}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          // Sin foto cargada mostramos al michi, no un cuadro gris roto.
          <Roncito tamano={88} animo={agotado ? 'dormido' : 'normal'} className="text-ron-negro/85" />
        )}

        <span className="absolute left-2 top-2 etiqueta bg-white text-[0.62rem]">
          {producto.categoria_emoji} {producto.categoria}
        </span>

        {agotado && (
          <span className="absolute right-2 top-2 etiqueta etiqueta-cancelado">Agotado</span>
        )}
        {ultimas && (
          <span className="absolute right-2 top-2 etiqueta etiqueta-alerta">
            ¡Últimas {producto.disponible}!
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="display text-[0.95rem] leading-tight">{producto.producto}</h3>
        {producto.variante !== 'Única' && (
          <p className="mt-0.5 text-xs texto-tenue">Presentación: {producto.variante}</p>
        )}

        <p className="display mt-auto pt-2 text-xl">{soles(producto.precio_centimos)}</p>

        <button
          onClick={onAgregar}
          disabled={agotado || tope}
          className={`boton boton-chico mt-2 w-full ${agotado || tope ? 'boton-claro' : 'boton-primario'}`}
        >
          {agotado
            ? 'Sin stock'
            : tope
              ? `Ya llevas ${cantidadEnCarrito}`
              : cantidadEnCarrito > 0
                ? `Agregar otro (${cantidadEnCarrito})`
                : 'Agregar'}
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------
// Carrito y datos del cliente
// ---------------------------------------------------------------

function PanelCarrito({
  carrito,
  puntosRecojo,
  whatsappListo,
  onCerrar,
  onCambiarCantidad,
  onQuitar,
  onPedidoCreado,
}: {
  carrito: LineaCarrito[];
  puntosRecojo: Ubicacion[];
  whatsappListo: boolean;
  onCerrar: () => void;
  onCambiarCantidad: (id: string, delta: number) => void;
  onQuitar: (id: string) => void;
  onPedidoCreado: (p: PedidoCreado) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [nota, setNota] = useState('');
  const [punto, setPunto] = useState(puntosRecojo[0]?.codigo ?? '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = carrito.reduce((t, l) => t + l.cantidad * l.precio_centimos, 0);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      // El pedido se guarda en la base ANTES de abrir WhatsApp.
      const respuesta = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_nombre: nombre,
          cliente_telefono: telefono,
          cliente_nota: nota,
          ubicacion_codigo: punto,
          items: carrito.map((l) => ({ variante_id: l.variante_id, cantidad: l.cantidad })),
        }),
      });

      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? 'No pudimos registrar el pedido.');

      onPedidoCreado(datos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo salió mal.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        className="absolute inset-0 bg-black/55"
        onClick={onCerrar}
        aria-label="Cerrar el pedido"
      />

      <div className="tarjeta relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none sm:rounded-b-[1.1rem]">
        <div className="sticky top-0 flex items-center justify-between border-b-[3px] border-ron-negro bg-ron-amarillo px-4 py-3">
          <h2 className="display text-lg">Tu pedido</h2>
          <button onClick={onCerrar} className="boton boton-claro boton-chico" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="p-4">
          {carrito.length === 0 ? (
            <div className="py-10 text-center">
              <Roncito tamano={80} animo="dormido" className="mx-auto text-ron-negro" />
              <p className="display mt-3 text-lg">El carrito está vacío</p>
              <p className="mt-1 text-sm texto-tenue">Roncito no despacha cajas de aire.</p>
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {carrito.map((l) => (
                  <li
                    key={l.variante_id}
                    className="tarjeta-sutil flex items-center gap-3 p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{l.producto}</p>
                      <p className="text-xs texto-tenue">
                        {l.variante !== 'Única' ? `${l.variante} · ` : ''}
                        {soles(l.precio_centimos)} c/u
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onCambiarCantidad(l.variante_id, -1)}
                        className="boton boton-claro boton-chico !min-h-0 !px-2.5 !py-1"
                        aria-label={`Quitar una unidad de ${l.producto}`}
                      >
                        −
                      </button>
                      <span className="display w-6 text-center text-base">{l.cantidad}</span>
                      <button
                        onClick={() => onCambiarCantidad(l.variante_id, 1)}
                        disabled={l.cantidad >= l.disponible}
                        className="boton boton-claro boton-chico !min-h-0 !px-2.5 !py-1"
                        aria-label={`Agregar una unidad de ${l.producto}`}
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => onQuitar(l.variante_id)}
                      className="text-xs texto-tenue underline"
                      aria-label={`Quitar ${l.producto} del pedido`}
                    >
                      quitar
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center justify-between border-t-[3px] border-dashed border-ron-negro pt-3">
                <span className="display text-lg">Total</span>
                <span className="display text-2xl">{soles(total)}</span>
              </div>

              <form onSubmit={confirmar} className="mt-5 space-y-3">
                <div>
                  <label className="etiqueta-campo" htmlFor="nombre">
                    Tu nombre
                  </label>
                  <input
                    id="nombre"
                    className="campo"
                    required
                    minLength={2}
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Cómo te llamamos"
                  />
                </div>

                <div>
                  <label className="etiqueta-campo" htmlFor="telefono">
                    WhatsApp
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

                <div>
                  <label className="etiqueta-campo" htmlFor="punto">
                    ¿Dónde lo recoges?
                  </label>
                  <select
                    id="punto"
                    className="campo"
                    value={punto}
                    onChange={(e) => setPunto(e.target.value)}
                    required
                  >
                    {puntosRecojo.map((u) => (
                      <option key={u.codigo} value={u.codigo}>
                        {u.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="etiqueta-campo" htmlFor="nota">
                    Algo que debamos saber <span className="texto-tenue">(opcional)</span>
                  </label>
                  <textarea
                    id="nota"
                    className="campo"
                    rows={2}
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Paso el sábado por la tarde…"
                  />
                </div>

                {error && (
                  <p className="tarjeta-sutil border-ron-peligro bg-red-50 p-3 text-sm font-bold text-ron-peligro">
                    {error}
                  </p>
                )}

                {!whatsappListo && (
                  <p className="tarjeta-sutil bg-ron-amarillo-claro p-3 text-xs font-semibold">
                    Tu pedido se guardará con su código igual. El botón de WhatsApp
                    está desactivado porque falta configurar el número del negocio.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={enviando || carrito.length === 0}
                  className="boton boton-primario w-full"
                >
                  {enviando ? 'Guardando tu pedido…' : `Confirmar pedido · ${soles(total)}`}
                </button>

                <p className="text-center text-xs texto-tenue">
                  Guardamos el pedido y te damos un código. El pago lo coordinas
                  por WhatsApp.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------

function PedidoListo({
  pedido,
  whatsappListo,
  alVolver,
}: {
  pedido: PedidoCreado;
  whatsappListo: boolean;
  alVolver: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="tarjeta overflow-hidden">
        <div className="border-b-[3px] border-ron-negro bg-ron-amarillo px-5 py-6 text-center">
          <Roncito tamano={86} animo="contento" className="mx-auto text-ron-negro" />
          <h1 className="display mt-2 text-2xl">¡Pedido guardado!</h1>
          <p className="mt-1 text-sm font-bold opacity-75">
            Ya está en nuestro sistema. No se te va a perder.
          </p>
        </div>

        <div className="p-5">
          <div className="tarjeta-sutil bg-ron-amarillo-claro p-4 text-center">
            <p className="text-xs font-bold uppercase tracking-wider opacity-70">
              Tu código de pedido
            </p>
            <p className="display mt-1 text-3xl tracking-wide">{pedido.codigo}</p>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(pedido.codigo);
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              }}
              className="boton boton-claro boton-chico mt-3"
            >
              {copiado ? '¡Copiado!' : 'Copiar código'}
            </button>
          </div>

          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="texto-tenue">Total</dt>
              <dd className="display text-base">{soles(pedido.total_centimos)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="texto-tenue">Recojo en</dt>
              <dd className="font-bold">{pedido.punto_recojo}</dd>
            </div>
          </dl>

          {whatsappListo && pedido.enlace_whatsapp ? (
            <a
              href={pedido.enlace_whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="boton boton-whatsapp mt-5 w-full"
            >
              Coordinar el pago por WhatsApp
            </a>
          ) : (
            <div className="tarjeta-sutil mt-5 bg-ron-amarillo-claro p-3">
              <p className="text-sm font-bold">WhatsApp aún no está configurado</p>
              <p className="mt-1 text-xs">
                Tu pedido <strong>{pedido.codigo}</strong> ya quedó guardado. Falta
                cargar la variable <code className="font-mono">NEXT_PUBLIC_WHATSAPP_NUMERO</code>{' '}
                para activar el botón. Mientras tanto, pásale este código al equipo.
              </p>
            </div>
          )}

          <div className="mt-5 tarjeta-sutil p-3">
            <p className="text-xs font-bold">¿Qué sigue?</p>
            <ol className="mt-1.5 space-y-1 text-xs texto-tenue">
              <li>1. Coordinas el pago por WhatsApp.</li>
              <li>2. Verificamos el depósito y confirmamos tu pedido.</li>
              <li>3. Te avisamos y pasas a recogerlo. Guardamos tus productos 48 horas.</li>
            </ol>
          </div>

          <button onClick={alVolver} className="boton boton-oscuro mt-5 w-full">
            Seguir viendo el catálogo
          </button>
        </div>
      </div>
    </main>
  );
}
