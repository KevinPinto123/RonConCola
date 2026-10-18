'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clienteServidor, perfilActual } from '@/lib/supabase/servidor';

/**
 * Acciones del panel.
 *
 * Todas son delgadas a propósito: validan lo mínimo, llaman a la función
 * correspondiente en Postgres y devuelven el mensaje. Las reglas de verdad
 * (quién puede, cuánto stock hay, si ya se descontó) viven en la base, que
 * es el único lugar donde no se pueden saltar.
 */

export type Resultado = { ok: boolean; mensaje: string };

/** Traduce los errores de Postgres a algo que una persona pueda leer. */
function traducirError(mensaje: string): string {
  if (mensaje.includes('chk_reserva_no_excede_stock')) {
    return 'No se puede: hay unidades reservadas en pedidos abiertos.';
  }
  if (mensaje.includes('uq_mov_venta_online_por_pedido')) {
    return 'Ese pedido ya había descontado inventario. No se descuenta dos veces.';
  }
  if (mensaje.includes('violates check constraint') && mensaje.includes('cantidad')) {
    return 'La operación dejaría el stock en negativo.';
  }
  if (mensaje.includes('duplicate key') && mensaje.includes('sku')) {
    return 'Ya existe un producto con ese SKU.';
  }
  if (mensaje.includes('JWT') || mensaje.includes('not authenticated')) {
    return 'Tu sesión venció. Vuelve a entrar.';
  }
  return mensaje;
}

/** Ejecuta una función de la base y normaliza la respuesta. */
async function llamar(
  funcion: string,
  parametros: Record<string, unknown>,
  rutas: string[] = ['/panel'],
  exito = 'Listo.',
): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc(funcion, parametros);

  if (error) {
    return { ok: false, mensaje: traducirError(error.message) };
  }

  rutas.forEach((r) => revalidatePath(r));
  return { ok: true, mensaje: exito };
}

// ===============================================================
// Sesión
// ===============================================================

export async function iniciarSesion(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  const correo = String(datos.get('correo') ?? '').trim();
  const clave = String(datos.get('clave') ?? '');

  if (!correo || !clave) {
    return { ok: false, mensaje: 'Escribe tu correo y tu contraseña.' };
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: correo, password: clave });

  if (error) {
    // Mensaje deliberadamente vago: no confirmamos si el correo existe.
    return { ok: false, mensaje: 'Correo o contraseña incorrectos.' };
  }

  // Tener sesión en Supabase no basta: hay que tener perfil en el equipo.
  const perfil = await perfilActual();
  if (!perfil) {
    await supabase.auth.signOut();
    return {
      ok: false,
      mensaje: 'Tu usuario no está dado de alta en el equipo de Ron con Cola.',
    };
  }

  redirect('/panel');
}

export async function cerrarSesion(): Promise<void> {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  redirect('/ingresar');
}

// ===============================================================
// Pedidos
// ===============================================================

export async function confirmarPago(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  const pedidoId = String(datos.get('pedido_id') ?? '');
  const referencia = String(datos.get('referencia') ?? '').trim();

  if (!pedidoId) return { ok: false, mensaje: 'Falta indicar el pedido.' };
  if (!referencia) {
    return {
      ok: false,
      mensaje: 'Anota la referencia del pago (operación de Yape, voucher…) antes de confirmar.',
    };
  }

  return llamar(
    'confirmar_pago',
    { p_pedido_id: pedidoId, p_referencia: referencia },
    ['/panel', '/panel/pedidos', '/panel/inventario', '/'],
    'Pago verificado. El inventario quedó descontado y el pedido está listo para recojo.',
  );
}

export async function cancelarPedido(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  const pedidoId = String(datos.get('pedido_id') ?? '');
  const motivo = String(datos.get('motivo') ?? '').trim();

  if (!motivo) return { ok: false, mensaje: 'Indica por qué se cancela el pedido.' };

  return llamar(
    'cancelar_pedido',
    { p_pedido_id: pedidoId, p_motivo: motivo },
    ['/panel', '/panel/pedidos', '/panel/inventario', '/'],
    'Pedido cancelado. El stock volvió a quedar disponible.',
  );
}

export async function registrarRecojo(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  const pedidoId = String(datos.get('pedido_id') ?? '');
  return llamar(
    'registrar_recojo',
    { p_pedido_id: pedidoId },
    ['/panel', '/panel/pedidos'],
    'Recojo registrado. Pedido entregado.',
  );
}

export async function liberarReservasVencidas(): Promise<Resultado> {
  return llamar(
    'liberar_reservas_vencidas',
    {},
    ['/panel', '/panel/pedidos', '/panel/inventario', '/'],
    'Reservas vencidas liberadas.',
  );
}

// ===============================================================
// Inventario
// ===============================================================

export async function registrarIngreso(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  const cantidad = Number(datos.get('cantidad'));
  if (!Number.isFinite(cantidad) || cantidad < 1) {
    return { ok: false, mensaje: 'La cantidad debe ser al menos 1.' };
  }

  return llamar(
    'registrar_ingreso',
    {
      p_variante_id: String(datos.get('variante_id') ?? ''),
      p_ubicacion_codigo: String(datos.get('ubicacion') ?? ''),
      p_cantidad: Math.floor(cantidad),
      p_nota: String(datos.get('nota') ?? '').trim() || null,
    },
    ['/panel', '/panel/inventario', '/'],
    `Ingresaron ${Math.floor(cantidad)} unidades.`,
  );
}

export async function ajustarStock(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  const cantidad = Number(datos.get('cantidad_real'));
  const motivo = String(datos.get('motivo') ?? '').trim();

  if (!Number.isFinite(cantidad) || cantidad < 0) {
    return { ok: false, mensaje: 'La cantidad contada no puede ser negativa.' };
  }
  if (!motivo) {
    return { ok: false, mensaje: 'Todo ajuste necesita un motivo (conteo, merma, error…).' };
  }

  return llamar(
    'ajustar_stock',
    {
      p_variante_id: String(datos.get('variante_id') ?? ''),
      p_ubicacion_codigo: String(datos.get('ubicacion') ?? ''),
      p_cantidad_real: Math.floor(cantidad),
      p_motivo: motivo,
    },
    ['/panel', '/panel/inventario', '/'],
    'Stock ajustado al conteo real.',
  );
}

export async function trasladarStock(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  const cantidad = Number(datos.get('cantidad'));
  if (!Number.isFinite(cantidad) || cantidad < 1) {
    return { ok: false, mensaje: 'La cantidad a trasladar debe ser al menos 1.' };
  }

  return llamar(
    'trasladar_stock',
    {
      p_variante_id: String(datos.get('variante_id') ?? ''),
      p_origen_codigo: String(datos.get('origen') ?? ''),
      p_destino_codigo: String(datos.get('destino') ?? ''),
      p_cantidad: Math.floor(cantidad),
      p_nota: String(datos.get('nota') ?? '').trim() || null,
    },
    ['/panel', '/panel/inventario', '/'],
    'Traslado registrado.',
  );
}

export async function registrarVentaFisica(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  const cantidad = Number(datos.get('cantidad'));
  if (!Number.isFinite(cantidad) || cantidad < 1) {
    return { ok: false, mensaje: 'La cantidad debe ser al menos 1.' };
  }

  return llamar(
    'registrar_venta_fisica',
    {
      p_ubicacion_codigo: String(datos.get('ubicacion') ?? ''),
      p_items: [
        { variante_id: String(datos.get('variante_id') ?? ''), cantidad: Math.floor(cantidad) },
      ],
      p_metodo_pago: String(datos.get('metodo_pago') ?? 'efectivo'),
      p_nota: String(datos.get('nota') ?? '').trim() || null,
    },
    ['/panel', '/panel/inventario', '/'],
    'Venta registrada y stock descontado.',
  );
}

export async function registrarDevolucion(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  const cantidad = Number(datos.get('cantidad'));
  const motivo = String(datos.get('motivo') ?? '').trim();

  if (!Number.isFinite(cantidad) || cantidad < 1) {
    return { ok: false, mensaje: 'La cantidad debe ser al menos 1.' };
  }
  if (!motivo) return { ok: false, mensaje: 'Toda devolución necesita un motivo.' };

  return llamar(
    'registrar_devolucion',
    {
      p_ubicacion_codigo: String(datos.get('ubicacion') ?? ''),
      p_items: [
        { variante_id: String(datos.get('variante_id') ?? ''), cantidad: Math.floor(cantidad) },
      ],
      p_motivo: motivo,
    },
    ['/panel', '/panel/inventario', '/'],
    'Devolución registrada. El stock volvió al inventario.',
  );
}
