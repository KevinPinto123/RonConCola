-- ============================================================
-- Ron con Cola — DATOS DE DEMOSTRACIÓN
--
-- ⚠️  TODO LO DE ESTE ARCHIVO ES FICTICIO.
--
-- Los productos, precios, costos y cantidades son inventados para que
-- el prototipo se pueda probar de punta a punta. NO corresponden al
-- catálogo ni a las ventas reales de Ron con Cola.
--
-- Este archivo es OPCIONAL y vive aparte de las migraciones: un
-- despliegue de producción corre 001–004 y nunca este archivo.
--
-- Para borrar todo lo de demostración más adelante:
--     \i supabase/datos-demo/limpiar.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Ubicaciones  (estas sí reflejan la operación descrita en el pitch:
-- tienda en Miraflores, almacén y ferias)
-- ------------------------------------------------------------
insert into ubicaciones (codigo, nombre, tipo, direccion, es_punto_recojo, activa) values
  ('TIENDA40', 'Tienda 40 — Miraflores', 'tienda',  'Miraflores, Lima', true,  true),
  ('ALMACEN',  'Almacén central',        'almacen', null,              false, true),
  ('FERIA',    'Feria / Expo',           'feria',   'Según evento',    true,  true)
on conflict (codigo) do nothing;

-- ------------------------------------------------------------
-- Categorías
-- ------------------------------------------------------------
insert into categorias (nombre, slug, emoji, orden) values
  ('Láminas y cuadros', 'laminas-y-cuadros', '🖼️', 10),
  ('Stickers',          'stickers',          '✨', 20),
  ('Peluches',          'peluches',          '🧸', 30),
  ('Tazas',             'tazas',             '☕', 40),
  ('Llaveros y pines',  'llaveros-y-pines',  '🔑', 50),
  ('Textiles',          'textiles',          '👕', 60),
  ('Papelería',         'papeleria',         '📓', 70)
on conflict (nombre) do nothing;

-- ------------------------------------------------------------
-- Productos y variantes (ficticios)
-- ------------------------------------------------------------
create temporary table tmp_datos_demo (
  sku text, nombre text, descripcion text, categoria text,
  variante text, precio numeric, costo numeric
) on commit drop;

insert into tmp_datos_demo (sku, nombre, descripcion, categoria, variante, precio, costo) values
  ('RCC-LAM-001', 'Lámina "Roncito CEO"',            'Lámina del michi jefe en su escritorio, impresión giclée.', 'Láminas y cuadros', 'A4',      35.00, 12.00),
  ('RCC-LAM-001', 'Lámina "Roncito CEO"',            'Lámina del michi jefe en su escritorio, impresión giclée.', 'Láminas y cuadros', 'A3',      55.00, 19.00),
  ('RCC-LAM-002', 'Lámina "Miauchiverso"',           'El universo según los gatos. Papel mate 250g.',             'Láminas y cuadros', 'A4',      35.00, 12.00),
  ('RCC-STK-001', 'Pack stickers "Gatos de oficina"','10 stickers resistentes al agua.',                          'Stickers',          'Única',   15.00,  4.50),
  ('RCC-STK-002', 'Pack stickers "Michis peruanos"', '8 stickers con michis con chullo.',                         'Stickers',          'Única',   15.00,  4.50),
  ('RCC-PEL-001', 'Peluche Ron grande',              'Peluche del michi negro, 30cm, superabrazable.',            'Peluches',          'Única',   89.00, 38.00),
  ('RCC-PEL-002', 'Peluche Ron mini',                'Versión bolsillo del jefe, 15cm.',                          'Peluches',          'Única',   45.00, 18.00),
  ('RCC-TAZ-001', 'Taza "No me dejes mal"',          'Cerámica 330ml con Roncito impaciente.',                     'Tazas',             'Única',   42.00, 16.00),
  ('RCC-TAZ-002', 'Taza "CAT-álogo"',                'Cerámica 330ml, chiste incluido.',                          'Tazas',             'Única',   42.00, 16.00),
  ('RCC-LLA-001', 'Llavero Roncito acrílico',        'Acrílico doble cara 6cm.',                                  'Llaveros y pines',  'Única',   18.00,  5.00),
  ('RCC-LLA-002', 'Pin esmaltado "Michi CEO"',       'Pin metálico con esmalte duro.',                            'Llaveros y pines',  'Única',   25.00,  8.00),
  ('RCC-TEX-001', 'Tote bag "Más que una gato tienda"','Tela cruda, serigrafía a 1 color.',                       'Textiles',          'Única',   49.00, 20.00),
  ('RCC-TEX-002', 'Polo "Humano entrenado"',         'Algodón pima, estampado frontal.',                          'Textiles',          'S',       69.00, 28.00),
  ('RCC-TEX-002', 'Polo "Humano entrenado"',         'Algodón pima, estampado frontal.',                          'Textiles',          'M',       69.00, 28.00),
  ('RCC-TEX-002', 'Polo "Humano entrenado"',         'Algodón pima, estampado frontal.',                          'Textiles',          'L',       69.00, 28.00),
  ('RCC-PAP-001', 'Libreta "Agenda del michi"',      'Libreta cosida 80 hojas, rayada.',                          'Papelería',         'Única',   32.00, 11.00),
  ('RCC-PAP-002', 'Set de postales Ron con Cola',    '6 postales ilustradas.',                                    'Papelería',         'Única',   22.00,  7.00);

-- Primero los productos (un SKU base puede tener varias variantes)...
insert into productos (sku_base, nombre, descripcion, categoria_id)
select distinct on (d.sku)
  d.sku, d.nombre, d.descripcion, c.id
from tmp_datos_demo d
left join categorias c on c.nombre = d.categoria
order by d.sku
on conflict (sku_base) do nothing;

-- ...y recién después las variantes, ya con los productos visibles.
insert into variantes (producto_id, sku, nombre, precio_centimos, costo_centimos)
select
  p.id,
  d.sku || case when d.variante = 'Única' then '' else '-' || upper(d.variante) end,
  d.variante,
  round(d.precio * 100)::int,
  round(d.costo  * 100)::int
from tmp_datos_demo d
join productos p on p.sku_base = d.sku
on conflict (sku) do nothing;

-- ------------------------------------------------------------
-- Stock inicial ficticio, repartido entre tienda y almacén.
--
-- Se escribe directo en `inventario` (no por fn_mover_stock) porque
-- esto es el punto de partida del entorno de prueba, no una operación
-- real del negocio que deba quedar en la bitácora.
-- ------------------------------------------------------------
insert into inventario (variante_id, ubicacion_id, cantidad, reservado, stock_minimo)
select
  v.id,
  u.id,
  case u.codigo
    when 'TIENDA40' then (3 + (abs(hashtext(v.sku)) % 12))
    when 'ALMACEN'  then (5 + (abs(hashtext(v.sku || 'alm')) % 25))
    else 0
  end,
  0,
  case u.codigo when 'TIENDA40' then 3 else 5 end
from variantes v
cross join ubicaciones u
where u.codigo in ('TIENDA40', 'ALMACEN', 'FERIA')
on conflict (variante_id, ubicacion_id) do nothing;

-- Deja dos productos en rojo a propósito, para que el panel de
-- indicadores tenga algo que avisar apenas se abre.
update inventario i
   set cantidad = 1, stock_minimo = 3
  from variantes v, ubicaciones u
 where i.variante_id = v.id
   and i.ubicacion_id = u.id
   and u.codigo = 'TIENDA40'
   and v.sku in ('RCC-PEL-001', 'RCC-TAZ-001');

commit;

-- ============================================================
-- Después de correr esto:
--   1. Crea tu usuario en Supabase → Authentication → Add user.
--   2. Conviértelo en administrador:
--
--      update perfiles set rol = 'admin', nombre = 'Cecilia'
--      where id = (select id from auth.users where email = 'tu@correo.com');
--
--   3. Entra al panel en /panel con ese correo y contraseña.
-- ============================================================
