/** Tipos compartidos entre la tienda y el panel. */

export type Rol = 'admin' | 'vendedor';

export type EstadoPedido =
  | 'pendiente_pago'
  | 'pagado'
  | 'listo_recojo'
  | 'entregado'
  | 'cancelado';

export type TipoMovimiento =
  | 'ingreso'
  | 'venta_online'
  | 'venta_fisica'
  | 'devolucion'
  | 'ajuste'
  | 'traslado_salida'
  | 'traslado_entrada';

export type ProductoCatalogo = {
  variante_id: string;
  producto_id: string;
  producto: string;
  descripcion: string | null;
  imagen_url: string | null;
  variante: string;
  sku: string;
  precio_centimos: number;
  categoria: string;
  categoria_slug: string;
  categoria_emoji: string;
  disponible: number;
};

export type LineaCarrito = {
  variante_id: string;
  producto: string;
  variante: string;
  sku: string;
  precio_centimos: number;
  cantidad: number;
  disponible: number;
  imagen_url: string | null;
};

export type Ubicacion = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: 'tienda' | 'almacen' | 'feria';
  es_punto_recojo: boolean;
};

export type PedidoResumen = {
  id: string;
  codigo: string;
  cliente_nombre: string;
  cliente_telefono: string;
  cliente_nota: string | null;
  estado: EstadoPedido;
  total_centimos: number;
  creado_en: string;
  expira_en: string;
  pagado_en: string | null;
  referencia_pago: string | null;
  ubicaciones: { nombre: string; codigo: string } | null;
  pedido_items: {
    nombre_snapshot: string;
    sku_snapshot: string;
    cantidad: number;
    precio_unitario_centimos: number;
    subtotal_centimos: number;
  }[];
};

export type FilaStock = {
  variante_id: string;
  sku: string;
  producto: string;
  variante: string;
  categoria: string | null;
  ubicacion: string;
  ubicacion_codigo: string;
  cantidad: number;
  reservado: number;
  disponible: number;
  stock_minimo: number;
  bajo_stock: boolean;
  precio_centimos: number;
  costo_centimos: number;
  valor_costo_centimos: number;
};

/** Lo que devuelve kpis_resumen(). Todo calculado en SQL. */
export type Kpis = {
  periodo_dias: number;
  desde: string;
  hasta: string;
  ventas_totales_centimos: number;
  operaciones: number;
  ticket_promedio_centimos: number;
  unidades_vendidas: number;
  ventas_por_dia: { dia: string; total_centimos: number; operaciones: number }[];
  ventas_por_canal: { canal: string; total_centimos: number; operaciones: number }[];
  top_productos: { producto: string; unidades: number; ingreso_centimos: number }[];
  stock_bajo: {
    producto: string;
    variante: string;
    ubicacion: string;
    disponible: number;
    stock_minimo: number;
  }[];
  inventario: {
    valor_costo_centimos: number;
    unidades_en_stock: number;
    unidades_reservadas: number;
  };
  pedidos: {
    por_verificar: number;
    por_entregar: number;
    reservas_vencidas: number;
    monto_por_verificar: number;
  };
  conversion: {
    pedidos_creados: number;
    pedidos_concretados: number;
    pedidos_cancelados: number;
  };
};

/** Una fila del CSV ya revisada por la IA (o por las reglas locales). */
export type FilaImportacion = {
  id: string;
  fila_num: number;
  datos: Record<string, string>;
  categoria_sugerida: string | null;
  categoria_confianza: number | null;
  motivo_ia: string | null;
  duplicado_variante_id: string | null;
  duplicado_score: number | null;
  decision: 'pendiente' | 'crear' | 'omitir' | 'fusionar';
  error: string | null;
};
