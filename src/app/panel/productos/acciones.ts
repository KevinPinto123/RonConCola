'use server';

import { revalidatePath } from 'next/cache';
import { clienteServidor } from '@/lib/supabase/servidor';
import { aCentimos } from '@/lib/dinero';
import type { Resultado } from '@/app/panel/acciones';

/**
 * Alta y edición de productos a mano.
 *
 * Complementa la importación por CSV: para un producto suelto no vale la
 * pena armar un archivo. Las políticas RLS de la migración 004 sólo
 * permiten estas escrituras a administración, así que no hace falta
 * revisar el rol aquí: la base lo rechaza igual.
 */

export async function crearProducto(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  const sku = String(datos.get('sku') ?? '').trim().toUpperCase();
  const nombre = String(datos.get('nombre') ?? '').trim();
  const descripcion = String(datos.get('descripcion') ?? '').trim();
  const categoriaId = String(datos.get('categoria_id') ?? '');
  const imagenUrl = String(datos.get('imagen_url') ?? '').trim();
  const variante = String(datos.get('variante') ?? '').trim() || 'Única';
  const precio = aCentimos(String(datos.get('precio') ?? ''));
  const costo = aCentimos(String(datos.get('costo') ?? '')) ?? 0;
  const stock = Math.floor(Number(datos.get('stock') ?? 0));
  const ubicacion = String(datos.get('ubicacion') ?? 'ALMACEN');

  if (!sku) return { ok: false, mensaje: 'El SKU es obligatorio.' };
  if (!nombre) return { ok: false, mensaje: 'El nombre es obligatorio.' };
  if (precio === null || precio <= 0) {
    return { ok: false, mensaje: 'El precio debe ser mayor a cero.' };
  }
  if (costo < 0) return { ok: false, mensaje: 'El costo no puede ser negativo.' };
  if (!Number.isFinite(stock) || stock < 0) {
    return { ok: false, mensaje: 'El stock inicial no puede ser negativo.' };
  }

  const supabase = await clienteServidor();

  // Si el SKU base ya existe, se le agrega una variante en vez de
  // crear un producto duplicado.
  const { data: existente } = await supabase
    .from('productos')
    .select('id')
    .eq('sku_base', sku)
    .maybeSingle();

  let productoId = existente?.id as string | undefined;

  if (!productoId) {
    const { data: creado, error } = await supabase
      .from('productos')
      .insert({
        sku_base: sku,
        nombre,
        descripcion: descripcion || null,
        categoria_id: categoriaId || null,
        imagen_url: imagenUrl || null,
      })
      .select('id')
      .single();

    if (error) {
      return {
        ok: false,
        mensaje: error.message.includes('row-level security')
          ? 'Sólo la administración puede crear productos.'
          : error.message,
      };
    }
    productoId = creado.id as string;
  }

  const skuVariante =
    variante === 'Única'
      ? sku
      : `${sku}-${variante.replace(/[^a-zA-Z0-9]+/g, '').toUpperCase()}`;

  const { data: varianteCreada, error: errorVariante } = await supabase
    .from('variantes')
    .insert({
      producto_id: productoId,
      sku: skuVariante,
      nombre: variante,
      precio_centimos: precio,
      costo_centimos: costo,
    })
    .select('id')
    .single();

  if (errorVariante) {
    return {
      ok: false,
      mensaje: errorVariante.message.includes('duplicate key')
        ? `Ya existe una variante con el SKU ${skuVariante}.`
        : errorVariante.message,
    };
  }

  // El stock inicial entra como movimiento, para que quede en la bitácora.
  if (stock > 0) {
    const { error: errorStock } = await supabase.rpc('registrar_ingreso', {
      p_variante_id: varianteCreada.id,
      p_ubicacion_codigo: ubicacion,
      p_cantidad: stock,
      p_nota: 'Stock inicial al crear el producto',
    });

    if (errorStock) {
      return {
        ok: true,
        mensaje: `Producto creado, pero el stock inicial no se cargó: ${errorStock.message}`,
      };
    }
  }

  revalidatePath('/panel/productos');
  revalidatePath('/panel/inventario');
  revalidatePath('/');

  return {
    ok: true,
    mensaje: `"${nombre}" quedó en el catálogo${stock > 0 ? ` con ${stock} unidades` : ''}.`,
  };
}

export async function cambiarEstadoProducto(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  const id = String(datos.get('producto_id') ?? '');
  const activar = String(datos.get('activar') ?? '') === 'si';

  const supabase = await clienteServidor();
  const { error } = await supabase.from('productos').update({ activo: activar }).eq('id', id);

  if (error) {
    return {
      ok: false,
      mensaje: error.message.includes('row-level security')
        ? 'Sólo la administración puede cambiar esto.'
        : error.message,
    };
  }

  revalidatePath('/panel/productos');
  revalidatePath('/');

  return {
    ok: true,
    mensaje: activar
      ? 'El producto volvió al catálogo.'
      : 'El producto ya no se muestra en la tienda. Su stock se conserva.',
  };
}

export async function actualizarPrecio(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  const varianteId = String(datos.get('variante_id') ?? '');
  const precio = aCentimos(String(datos.get('precio') ?? ''));

  if (precio === null || precio <= 0) {
    return { ok: false, mensaje: 'El precio debe ser mayor a cero.' };
  }

  const supabase = await clienteServidor();
  const { error } = await supabase
    .from('variantes')
    .update({ precio_centimos: precio })
    .eq('id', varianteId);

  if (error) {
    return {
      ok: false,
      mensaje: error.message.includes('row-level security')
        ? 'Sólo la administración puede cambiar precios.'
        : error.message,
    };
  }

  revalidatePath('/panel/productos');
  revalidatePath('/');

  // Los pedidos ya creados conservan el precio que el cliente aceptó:
  // pedido_items guarda una copia del precio al momento de la compra.
  return { ok: true, mensaje: 'Precio actualizado. Los pedidos ya hechos no cambian.' };
}
