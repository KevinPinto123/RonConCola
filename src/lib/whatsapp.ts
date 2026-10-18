import { soles } from '@/lib/dinero';

export type ItemMensaje = {
  nombre: string;
  cantidad: number;
  subtotal_centimos: number;
};

/**
 * Arma el mensaje que el cliente envía por WhatsApp.
 *
 * Lleva el identificador del pedido, los productos con sus cantidades y
 * el total. Así, cuando llega el mensaje, el equipo busca el código en el
 * panel y ve exactamente el mismo pedido: no hay que reconstruirlo a
 * partir de capturas de pantalla.
 */
export function mensajeWhatsapp(datos: {
  codigo: string;
  clienteNombre: string;
  items: ItemMensaje[];
  totalCentimos: number;
  puntoRecojo: string;
}): string {
  const lineas = datos.items
    .map((i) => `• ${i.cantidad} × ${i.nombre} — ${soles(i.subtotal_centimos)}`)
    .join('\n');

  return [
    `¡Hola Ron con Cola! 🐈‍⬛`,
    ``,
    `Acabo de hacer un pedido en la tienda web.`,
    ``,
    `*Pedido:* ${datos.codigo}`,
    `*A nombre de:* ${datos.clienteNombre}`,
    `*Recojo en:* ${datos.puntoRecojo}`,
    ``,
    `*Lo que pedí:*`,
    lineas,
    ``,
    `*Total: ${soles(datos.totalCentimos)}*`,
    ``,
    `Quedo atento/a para coordinar el pago. ¡Gracias!`,
  ].join('\n');
}

/**
 * Link de WhatsApp. Devuelve null si no hay número configurado:
 * preferimos desactivar el botón antes que mandar el pedido
 * a un número inventado.
 */
export function enlaceWhatsapp(numero: string | undefined, mensaje: string): string | null {
  if (!numero) return null;
  const limpio = numero.replace(/[^0-9]/g, '');
  if (limpio.length < 8) return null;
  return `https://wa.me/${limpio}?text=${encodeURIComponent(mensaje)}`;
}
