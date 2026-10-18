import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';
import { WHATSAPP_NUMERO } from '@/lib/entorno';
import { mensajeWhatsapp, enlaceWhatsapp } from '@/lib/whatsapp';

/**
 * POST /api/pedidos — crea un pedido desde la tienda.
 *
 * Orden de los hechos, que importa:
 *   1. Se llama a crear_pedido() en Postgres, que valida precios,
 *      cantidades y disponibilidad, y reserva el stock.
 *   2. Recién con el pedido YA guardado se arma el enlace de WhatsApp.
 *
 * Así el mensaje siempre apunta a un pedido que existe. Si el navegador
 * se cierra antes de enviar el WhatsApp, el pedido igual está en el panel.
 */
export async function POST(peticion: Request) {
  let cuerpo: unknown;

  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: 'El cuerpo de la petición no es JSON válido.' }, { status: 400 });
  }

  const datos = cuerpo as {
    cliente_nombre?: string;
    cliente_telefono?: string;
    cliente_nota?: string;
    ubicacion_codigo?: string;
    items?: { variante_id?: string; cantidad?: number }[];
  };

  // Validación de forma. La de negocio (precios, stock) la hace Postgres.
  if (!Array.isArray(datos.items) || datos.items.length === 0) {
    return NextResponse.json({ error: 'Tu carrito está vacío.' }, { status: 400 });
  }
  if (datos.items.length > 50) {
    return NextResponse.json({ error: 'Máximo 50 productos distintos por pedido.' }, { status: 400 });
  }

  const items = datos.items.map((i) => ({
    variante_id: String(i?.variante_id ?? ''),
    cantidad: Math.floor(Number(i?.cantidad ?? 0)),
  }));

  if (items.some((i) => !i.variante_id || !Number.isFinite(i.cantidad) || i.cantidad < 1)) {
    return NextResponse.json(
      { error: 'Hay un producto con cantidad inválida en tu carrito.' },
      { status: 400 },
    );
  }

  const supabase = await clienteServidor();

  // Nótese que NO se envía ningún precio: el servidor los lee de la base.
  const { data, error } = await supabase.rpc('crear_pedido', {
    p_cliente_nombre: datos.cliente_nombre ?? '',
    p_cliente_telefono: datos.cliente_telefono ?? '',
    p_ubicacion_codigo: datos.ubicacion_codigo ?? '',
    p_items: items,
    p_cliente_nota: datos.cliente_nota ?? null,
  });

  if (error) {
    // Los mensajes de las funciones están escritos para que el cliente
    // los entienda ("quedan 2 disponibles"), así que se devuelven tal cual.
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  const pedido = data as {
    codigo: string;
    total_centimos: number;
    punto_recojo: string;
    items: { nombre: string; cantidad: number; subtotal_centimos: number }[];
  };

  const mensaje = mensajeWhatsapp({
    codigo: pedido.codigo,
    clienteNombre: datos.cliente_nombre ?? '',
    items: pedido.items,
    totalCentimos: pedido.total_centimos,
    puntoRecojo: pedido.punto_recojo,
  });

  return NextResponse.json({
    codigo: pedido.codigo,
    total_centimos: pedido.total_centimos,
    punto_recojo: pedido.punto_recojo,
    mensaje,
    enlace_whatsapp: enlaceWhatsapp(WHATSAPP_NUMERO, mensaje),
  });
}
