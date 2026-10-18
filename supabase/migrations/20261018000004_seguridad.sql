-- ============================================================
-- Ron con Cola — Migración 004: seguridad (RLS y permisos)
--
-- Principio: el navegador NUNCA escribe directamente en las tablas
-- de stock o pedidos. Sólo puede:
--   · leer el catálogo público,
--   · llamar a las funciones que validan todo del lado del servidor.
--
-- Así, aunque la llave publicable queda expuesta en el navegador
-- (como es normal en Supabase), nadie puede cambiar un precio,
-- regalarse stock ni leer los pedidos de otra persona.
-- ============================================================

alter table perfiles               enable row level security;
alter table ubicaciones            enable row level security;
alter table categorias             enable row level security;
alter table productos              enable row level security;
alter table variantes              enable row level security;
alter table inventario             enable row level security;
alter table movimientos_inventario enable row level security;
alter table pedidos                enable row level security;
alter table pedido_items           enable row level security;
alter table ventas                 enable row level security;
alter table venta_items            enable row level security;
alter table importaciones          enable row level security;
alter table importacion_filas      enable row level security;

-- ------------------------------------------------------------
-- Punto de partida: nadie tiene nada.
-- ------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ============================================================
-- LECTURA PÚBLICA (la tienda, sin iniciar sesión)
-- ============================================================
grant select on v_catalogo_publico         to anon, authenticated;
grant select on v_disponibilidad_por_punto to anon, authenticated;

-- Las vistas pertenecen al dueño del esquema, así que leen las tablas
-- base sin que el visitante necesite permiso sobre ellas.

grant select on categorias  to anon, authenticated;
grant select on ubicaciones to anon, authenticated;

drop policy if exists pol_categorias_lectura on categorias;
create policy pol_categorias_lectura on categorias
  for select to anon, authenticated using (true);

-- El público sólo ve los puntos donde realmente puede recoger.
drop policy if exists pol_ubicaciones_lectura_publica on ubicaciones;
create policy pol_ubicaciones_lectura_publica on ubicaciones
  for select to anon using (activa and es_punto_recojo);

drop policy if exists pol_ubicaciones_lectura_equipo on ubicaciones;
create policy pol_ubicaciones_lectura_equipo on ubicaciones
  for select to authenticated using (es_equipo());

-- ============================================================
-- EL EQUIPO (sesión iniciada en el panel)
-- ============================================================

-- Perfiles: cada quien ve el suyo; la administración ve a todos.
grant select on perfiles to authenticated;
drop policy if exists pol_perfiles_propio on perfiles;
create policy pol_perfiles_propio on perfiles
  for select to authenticated using (id = auth.uid() or es_admin());

-- Catálogo: lectura para el equipo, escritura sólo administración.
grant select on productos, variantes, inventario, movimientos_inventario to authenticated;
grant select on pedidos, pedido_items, ventas, venta_items to authenticated;
grant select on importaciones, importacion_filas to authenticated;
grant select on v_stock_actual to authenticated;

drop policy if exists pol_productos_equipo on productos;
create policy pol_productos_equipo on productos
  for select to authenticated using (es_equipo());

drop policy if exists pol_variantes_equipo on variantes;
create policy pol_variantes_equipo on variantes
  for select to authenticated using (es_equipo());

drop policy if exists pol_inventario_equipo on inventario;
create policy pol_inventario_equipo on inventario
  for select to authenticated using (es_equipo());

drop policy if exists pol_movimientos_equipo on movimientos_inventario;
create policy pol_movimientos_equipo on movimientos_inventario
  for select to authenticated using (es_equipo());

drop policy if exists pol_pedidos_equipo on pedidos;
create policy pol_pedidos_equipo on pedidos
  for select to authenticated using (es_equipo());

drop policy if exists pol_pedido_items_equipo on pedido_items;
create policy pol_pedido_items_equipo on pedido_items
  for select to authenticated using (es_equipo());

drop policy if exists pol_ventas_equipo on ventas;
create policy pol_ventas_equipo on ventas
  for select to authenticated using (es_equipo());

drop policy if exists pol_venta_items_equipo on venta_items;
create policy pol_venta_items_equipo on venta_items
  for select to authenticated using (es_equipo());

drop policy if exists pol_importaciones_equipo on importaciones;
create policy pol_importaciones_equipo on importaciones
  for select to authenticated using (es_equipo());

drop policy if exists pol_importacion_filas_equipo on importacion_filas;
create policy pol_importacion_filas_equipo on importacion_filas
  for select to authenticated using (es_equipo());

-- ------------------------------------------------------------
-- Altas y ediciones del catálogo: administración.
-- El stock queda fuera: se mueve sólo con las funciones de la 002.
-- ------------------------------------------------------------
grant insert, update on productos, variantes, categorias to authenticated;

drop policy if exists pol_productos_admin_insert on productos;
create policy pol_productos_admin_insert on productos
  for insert to authenticated with check (es_admin());

drop policy if exists pol_productos_admin_update on productos;
create policy pol_productos_admin_update on productos
  for update to authenticated using (es_admin()) with check (es_admin());

drop policy if exists pol_variantes_admin_insert on variantes;
create policy pol_variantes_admin_insert on variantes
  for insert to authenticated with check (es_admin());

drop policy if exists pol_variantes_admin_update on variantes;
create policy pol_variantes_admin_update on variantes
  for update to authenticated using (es_admin()) with check (es_admin());

drop policy if exists pol_categorias_admin_insert on categorias;
create policy pol_categorias_admin_insert on categorias
  for insert to authenticated with check (es_admin());

drop policy if exists pol_categorias_admin_update on categorias;
create policy pol_categorias_admin_update on categorias
  for update to authenticated using (es_admin()) with check (es_admin());

-- ------------------------------------------------------------
-- Importaciones: el equipo prepara y revisa el borrador.
-- Aplicarlo al catálogo sigue siendo cosa de administración
-- (lo exige aplicar_importacion con fn_exige_admin).
-- ------------------------------------------------------------
grant insert, update on importaciones, importacion_filas to authenticated;

drop policy if exists pol_importaciones_crear on importaciones;
create policy pol_importaciones_crear on importaciones
  for insert to authenticated with check (es_equipo());

drop policy if exists pol_importaciones_editar on importaciones;
create policy pol_importaciones_editar on importaciones
  for update to authenticated using (es_equipo()) with check (es_equipo());

drop policy if exists pol_importacion_filas_crear on importacion_filas;
create policy pol_importacion_filas_crear on importacion_filas
  for insert to authenticated with check (es_equipo());

drop policy if exists pol_importacion_filas_editar on importacion_filas;
create policy pol_importacion_filas_editar on importacion_filas
  for update to authenticated using (es_equipo()) with check (es_equipo());

-- ============================================================
-- FUNCIONES: quién puede llamar a qué
-- ============================================================

-- Público: sólo comprar y consultar el propio pedido.
grant execute on function crear_pedido(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function consultar_pedido(text, text)                to anon, authenticated;

-- Equipo autenticado: la operación del día a día.
grant execute on function confirmar_pago(uuid, text)                        to authenticated;
grant execute on function cancelar_pedido(uuid, text)                       to authenticated;
grant execute on function registrar_recojo(uuid)                            to authenticated;
grant execute on function liberar_reservas_vencidas()                       to authenticated;
grant execute on function registrar_venta_fisica(text, jsonb, text, text)   to authenticated;
grant execute on function registrar_devolucion(text, jsonb, text)           to authenticated;
grant execute on function registrar_ingreso(uuid, text, int, text)          to authenticated;
grant execute on function trasladar_stock(uuid, text, text, int, text)      to authenticated;
grant execute on function ajustar_stock(uuid, text, int, text)              to authenticated;
grant execute on function aplicar_importacion(uuid)                         to authenticated;
grant execute on function kpis_resumen(int)                                 to authenticated;
grant execute on function movimientos_recientes(int)                        to authenticated;
grant execute on function buscar_similares(text, numeric)                   to authenticated;
grant execute on function es_equipo()                                       to authenticated;
grant execute on function es_admin()                                        to authenticated;

-- El motor de stock NO se expone: sólo lo usan las funciones de arriba.
revoke all on function fn_mover_stock(uuid, uuid, tipo_movimiento, int, text, uuid, text)
  from anon, authenticated;

-- Las secuencias de códigos tampoco: los códigos los asigna la base.
revoke all on sequence seq_codigo_pedido, seq_codigo_venta from anon, authenticated;
