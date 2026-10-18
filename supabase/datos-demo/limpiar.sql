-- ============================================================
-- Borra TODO lo que creó semilla.sql y cualquier operación de prueba.
--
-- Deja el esquema y las funciones intactos: sólo vacía los datos.
-- Úsalo antes de cargar el catálogo real.
-- ============================================================

begin;

truncate
  movimientos_inventario,
  pedido_items,
  pedidos,
  venta_items,
  ventas,
  importacion_filas,
  importaciones,
  inventario,
  variantes,
  productos,
  categorias
restart identity cascade;

-- Las ubicaciones se conservan: describen la operación real
-- (tienda, almacén, ferias), no datos de demostración.
-- Para borrarlas también, descomenta:
-- truncate ubicaciones restart identity cascade;

alter sequence seq_codigo_pedido restart with 1000;
alter sequence seq_codigo_venta  restart with 1000;

commit;
