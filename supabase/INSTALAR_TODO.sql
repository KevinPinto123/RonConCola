-- ============================================================
-- Ron con Cola — TODAS LAS MIGRACIONES EN UN SOLO ARCHIVO
--
-- Pega este archivo completo en Supabase → SQL Editor y ejecútalo.
-- Equivale a correr los 4 archivos de supabase/migrations/ en orden.
-- Se puede volver a ejecutar sin romper nada (los NOTICE son normales).
--
-- NO incluye datos de demostración: eso está en
-- supabase/datos-demo/semilla.sql y es opcional.
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║  20261018000001_esquema.sql                              ║
-- ╚══════════════════════════════════════════════════════════╝

-- ============================================================
-- Ron con Cola — El Bazar de mi Pata E.I.R.L.
-- Migración 001: esquema base, tipos, tablas e índices.
--
-- Una sola base de datos sirve a la tienda pública y al panel.
-- Las reglas de negocio viven en la base (constraints + funciones),
-- no en la interfaz: así un cliente malicioso no puede romperlas.
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ------------------------------------------------------------
-- Tipos
-- ------------------------------------------------------------
do $$ begin
  create type rol_usuario as enum ('admin', 'vendedor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_ubicacion as enum ('tienda', 'almacen', 'feria');
exception when duplicate_object then null; end $$;

-- Ciclo de vida del pedido online:
-- pendiente_pago -> pagado -> listo_recojo -> entregado
--                \-> cancelado (libera la reserva o repone el stock)
do $$ begin
  create type estado_pedido as enum (
    'pendiente_pago', 'pagado', 'listo_recojo', 'entregado', 'cancelado'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_movimiento as enum (
    'ingreso',           -- compra o producción que entra
    'venta_online',      -- descuento por pedido web confirmado
    'venta_fisica',      -- descuento por venta en tienda/feria
    'devolucion',        -- el cliente devuelve, vuelve al stock
    'ajuste',            -- conteo físico / merma
    'traslado_salida',
    'traslado_entrada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type decision_importacion as enum ('pendiente', 'crear', 'omitir', 'fusionar');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_importacion as enum ('borrador', 'aplicada', 'descartada');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- Personas del equipo (se enlaza con auth.users de Supabase)
-- ------------------------------------------------------------
create table if not exists perfiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text        not null default 'Humano sin nombre',
  rol         rol_usuario not null default 'vendedor',
  creado_en   timestamptz not null default now()
);

comment on table perfiles is
  'Equipo de Ron con Cola. El rol decide qué operaciones administrativas puede ejecutar.';

-- Alta automática de perfil al registrarse en Supabase Auth.
create or replace function fn_crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'rol')::rol_usuario, 'vendedor')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_crear_perfil on auth.users;
create trigger trg_crear_perfil
  after insert on auth.users
  for each row execute function fn_crear_perfil_nuevo_usuario();

-- ------------------------------------------------------------
-- Dónde vive la mercadería: tienda, almacén y ferias
-- ------------------------------------------------------------
create table if not exists ubicaciones (
  id               uuid primary key default gen_random_uuid(),
  codigo           text unique not null,
  nombre           text not null,
  tipo             tipo_ubicacion not null,
  direccion        text,
  es_punto_recojo  boolean not null default false,
  activa           boolean not null default true,
  creado_en        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Catálogo
-- ------------------------------------------------------------
create table if not exists categorias (
  id        uuid primary key default gen_random_uuid(),
  nombre    text unique not null,
  slug      text unique not null,
  emoji     text not null default '🐈',
  orden     int  not null default 100,
  creado_en timestamptz not null default now()
);

create table if not exists productos (
  id           uuid primary key default gen_random_uuid(),
  sku_base     text unique not null,
  nombre       text not null,
  descripcion  text,
  categoria_id uuid references categorias (id) on delete set null,
  imagen_url   text,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_productos_categoria on productos (categoria_id);
-- Búsqueda difusa para el buscador de la tienda y la detección de duplicados.
create index if not exists idx_productos_nombre_trgm on productos using gin (nombre gin_trgm_ops);

create table if not exists variantes (
  id                uuid primary key default gen_random_uuid(),
  producto_id       uuid not null references productos (id) on delete cascade,
  sku               text unique not null,
  nombre            text not null default 'Única',
  precio_centimos   int  not null check (precio_centimos > 0),
  costo_centimos    int  not null default 0 check (costo_centimos >= 0),
  codigo_barras     text unique,
  activa            boolean not null default true,
  creado_en         timestamptz not null default now()
);

comment on column variantes.precio_centimos is
  'Precio en céntimos de sol (S/). Entero para evitar errores de redondeo con decimales.';

create index if not exists idx_variantes_producto on variantes (producto_id);

-- ------------------------------------------------------------
-- Inventario por ubicación
--
-- `cantidad`  = unidades físicamente presentes.
-- `reservado` = unidades comprometidas por pedidos aún no pagados.
-- disponible para vender = cantidad - reservado
--
-- Los CHECK son la última línea de defensa: aunque alguien llame a las
-- funciones de forma concurrente, la base nunca aceptará stock negativo
-- ni más reservas que unidades existentes.
-- ------------------------------------------------------------
create table if not exists inventario (
  id            uuid primary key default gen_random_uuid(),
  variante_id   uuid not null references variantes (id) on delete cascade,
  ubicacion_id  uuid not null references ubicaciones (id) on delete cascade,
  cantidad      int  not null default 0 check (cantidad  >= 0),
  reservado     int  not null default 0 check (reservado >= 0),
  stock_minimo  int  not null default 3 check (stock_minimo >= 0),
  actualizado_en timestamptz not null default now(),
  unique (variante_id, ubicacion_id),
  constraint chk_reserva_no_excede_stock check (reservado <= cantidad)
);

create index if not exists idx_inventario_ubicacion on inventario (ubicacion_id);

-- Bitácora inmutable: toda unidad que entra o sale deja rastro.
create table if not exists movimientos_inventario (
  id              uuid primary key default gen_random_uuid(),
  variante_id     uuid not null references variantes (id) on delete cascade,
  ubicacion_id    uuid not null references ubicaciones (id) on delete cascade,
  tipo            tipo_movimiento not null,
  delta           int not null check (delta <> 0),
  cantidad_previa int not null,
  cantidad_nueva  int not null,
  referencia_tipo text,
  referencia_id   uuid,
  usuario_id      uuid references auth.users (id) on delete set null,
  nota            text,
  creado_en       timestamptz not null default now()
);

comment on column movimientos_inventario.delta is
  'Positivo = entra stock. Negativo = sale stock.';

create index if not exists idx_mov_creado    on movimientos_inventario (creado_en desc);
create index if not exists idx_mov_variante  on movimientos_inventario (variante_id);
create index if not exists idx_mov_referencia on movimientos_inventario (referencia_tipo, referencia_id);

-- Un pedido online sólo puede descontar stock UNA vez.
-- Este índice único lo garantiza a nivel de base de datos: si una segunda
-- confirmación intenta escribir el mismo movimiento, Postgres la rechaza.
create unique index if not exists uq_mov_venta_online_por_pedido
  on movimientos_inventario (referencia_id, variante_id, ubicacion_id)
  where tipo = 'venta_online';

-- ------------------------------------------------------------
-- Pedidos de la tienda online
-- ------------------------------------------------------------
create sequence if not exists seq_codigo_pedido start 1000;

create table if not exists pedidos (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text unique not null default 'RCC-' || nextval('seq_codigo_pedido')::text,
  cliente_nombre      text not null,
  cliente_telefono    text not null,
  cliente_nota        text,
  estado              estado_pedido not null default 'pendiente_pago',
  subtotal_centimos   int not null check (subtotal_centimos >= 0),
  total_centimos      int not null check (total_centimos >= 0),
  ubicacion_id        uuid not null references ubicaciones (id),
  referencia_pago     text,
  motivo_cancelacion  text,
  usuario_confirmo    uuid references auth.users (id) on delete set null,
  usuario_entrego     uuid references auth.users (id) on delete set null,
  creado_en           timestamptz not null default now(),
  expira_en           timestamptz not null default now() + interval '48 hours',
  pagado_en           timestamptz,
  entregado_en        timestamptz,
  cancelado_en        timestamptz
);

comment on column pedidos.expira_en is
  'Si no se verifica el pago antes de esta fecha, la reserva se libera para no bloquear stock vendible.';

create index if not exists idx_pedidos_estado on pedidos (estado, creado_en desc);
create index if not exists idx_pedidos_telefono on pedidos (cliente_telefono);

create table if not exists pedido_items (
  id                      uuid primary key default gen_random_uuid(),
  pedido_id               uuid not null references pedidos (id) on delete cascade,
  variante_id             uuid not null references variantes (id),
  -- Copias del momento de la compra: si el precio cambia mañana,
  -- el pedido de hoy conserva lo que el cliente realmente aceptó.
  nombre_snapshot         text not null,
  sku_snapshot            text not null,
  cantidad                int  not null check (cantidad > 0),
  precio_unitario_centimos int not null check (precio_unitario_centimos > 0),
  subtotal_centimos       int  not null check (subtotal_centimos > 0),
  unique (pedido_id, variante_id)
);

create index if not exists idx_pedido_items_pedido on pedido_items (pedido_id);

-- ------------------------------------------------------------
-- Ventas presenciales (tienda y ferias)
-- ------------------------------------------------------------
create sequence if not exists seq_codigo_venta start 1000;

create table if not exists ventas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text unique not null default 'VF-' || nextval('seq_codigo_venta')::text,
  ubicacion_id    uuid not null references ubicaciones (id),
  usuario_id      uuid references auth.users (id) on delete set null,
  total_centimos  int not null check (total_centimos >= 0),
  metodo_pago     text not null default 'efectivo',
  nota            text,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_ventas_creado on ventas (creado_en desc);

create table if not exists venta_items (
  id                      uuid primary key default gen_random_uuid(),
  venta_id                uuid not null references ventas (id) on delete cascade,
  variante_id             uuid not null references variantes (id),
  nombre_snapshot         text not null,
  cantidad                int not null check (cantidad > 0),
  precio_unitario_centimos int not null check (precio_unitario_centimos > 0),
  subtotal_centimos       int not null check (subtotal_centimos > 0)
);

create index if not exists idx_venta_items_venta on venta_items (venta_id);

-- ------------------------------------------------------------
-- Importación por CSV con revisión asistida
--
-- Nada entra al catálogo directamente: el CSV cae aquí, la IA propone
-- categoría y posibles duplicados, y recién cuando una persona aprueba
-- se crean los productos reales.
-- ------------------------------------------------------------
create table if not exists importaciones (
  id             uuid primary key default gen_random_uuid(),
  nombre_archivo text not null,
  usuario_id     uuid references auth.users (id) on delete set null,
  estado         estado_importacion not null default 'borrador',
  total_filas    int not null default 0,
  filas_creadas  int not null default 0,
  filas_omitidas int not null default 0,
  analizado_por  text,
  creado_en      timestamptz not null default now(),
  aplicada_en    timestamptz
);

comment on column importaciones.analizado_por is
  'Qué motor sugirió categorías y duplicados: "claude" o "heuristica-local" (modo demostración).';

create table if not exists importacion_filas (
  id                   uuid primary key default gen_random_uuid(),
  importacion_id       uuid not null references importaciones (id) on delete cascade,
  fila_num             int not null,
  datos                jsonb not null,
  categoria_sugerida   text,
  categoria_confianza  numeric(3,2),
  motivo_ia            text,
  duplicado_variante_id uuid references variantes (id) on delete set null,
  duplicado_score      numeric(3,2),
  decision             decision_importacion not null default 'pendiente',
  error                text,
  unique (importacion_id, fila_num)
);

create index if not exists idx_importacion_filas on importacion_filas (importacion_id, fila_num);

-- ------------------------------------------------------------
-- Mantener actualizado_en al día
-- ------------------------------------------------------------
create or replace function fn_tocar_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

drop trigger if exists trg_productos_actualizado on productos;
create trigger trg_productos_actualizado before update on productos
  for each row execute function fn_tocar_actualizado_en();

drop trigger if exists trg_inventario_actualizado on inventario;
create trigger trg_inventario_actualizado before update on inventario
  for each row execute function fn_tocar_actualizado_en();


-- ╔══════════════════════════════════════════════════════════╗
-- ║  20261018000002_funciones.sql                            ║
-- ╚══════════════════════════════════════════════════════════╝

-- ============================================================
-- Ron con Cola — Migración 002: reglas de negocio
--
-- Toda escritura de stock pasa por estas funciones. Son SECURITY DEFINER,
-- así que la aplicación nunca necesita permisos directos de escritura
-- sobre las tablas: aunque alguien robe la llave pública del navegador,
-- sólo puede pedir estas operaciones, con estas validaciones.
--
-- Contra la sobreventa usamos bloqueo de fila (FOR UPDATE) ordenado por
-- variante, de modo que dos compras simultáneas se serializan en vez de
-- leer el mismo stock y venderlo dos veces.
-- ============================================================

-- ------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------
create or replace function es_equipo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid());
$$;

create or replace function es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'admin');
$$;

create or replace function fn_exige_equipo()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not es_equipo() then
    raise exception 'Alto ahí, humano: esta operación es sólo para el equipo de Ron con Cola.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function fn_exige_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then
    raise exception 'Sólo la administración puede hacer esto. Roncito supervisa.'
      using errcode = '42501';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Motor de movimientos de stock
--
-- Punto único por donde pasa cada unidad. Bloquea la fila de inventario,
-- valida que el resultado no sea negativo y deja el rastro en la bitácora.
-- ------------------------------------------------------------
create or replace function fn_mover_stock(
  p_variante_id    uuid,
  p_ubicacion_id   uuid,
  p_tipo           tipo_movimiento,
  p_delta          int,
  p_referencia_tipo text default null,
  p_referencia_id  uuid default null,
  p_nota           text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previa int;
  v_nueva  int;
  v_reservado int;
  v_nombre text;
begin
  if p_delta = 0 then
    raise exception 'Un movimiento de cero unidades no tiene sentido.';
  end if;

  -- Crea la fila de inventario si esa variante aún no existía en la ubicación.
  insert into inventario (variante_id, ubicacion_id, cantidad, reservado)
  values (p_variante_id, p_ubicacion_id, 0, 0)
  on conflict (variante_id, ubicacion_id) do nothing;

  select cantidad, reservado into v_previa, v_reservado
  from inventario
  where variante_id = p_variante_id and ubicacion_id = p_ubicacion_id
  for update;

  v_nueva := v_previa + p_delta;

  if v_nueva < 0 then
    select v.sku || ' · ' || p.nombre into v_nombre
    from variantes v join productos p on p.id = v.producto_id
    where v.id = p_variante_id;

    raise exception
      'Stock insuficiente de % en esa ubicación: hay % y se intentó mover %.',
      coalesce(v_nombre, p_variante_id::text), v_previa, p_delta
      using errcode = 'check_violation';
  end if;

  -- Nunca se puede bajar el stock por debajo de lo ya reservado:
  -- esas unidades están comprometidas con pedidos abiertos.
  if v_nueva < v_reservado then
    raise exception
      'No se puede dejar el stock en % porque hay % unidades reservadas en pedidos abiertos.',
      v_nueva, v_reservado
      using errcode = 'check_violation';
  end if;

  update inventario
     set cantidad = v_nueva
   where variante_id = p_variante_id and ubicacion_id = p_ubicacion_id;

  insert into movimientos_inventario (
    variante_id, ubicacion_id, tipo, delta,
    cantidad_previa, cantidad_nueva,
    referencia_tipo, referencia_id, usuario_id, nota
  ) values (
    p_variante_id, p_ubicacion_id, p_tipo, p_delta,
    v_previa, v_nueva,
    p_referencia_tipo, p_referencia_id, auth.uid(), p_nota
  );
end;
$$;

-- ------------------------------------------------------------
-- Normaliza y valida la lista de items que manda el navegador.
-- Devuelve variante, cantidad y el precio REAL leído de la base.
-- El precio que envíe el cliente se ignora por completo.
-- ------------------------------------------------------------
create or replace function fn_normalizar_items(p_items jsonb)
returns table (
  variante_id uuid,
  cantidad    int,
  nombre      text,
  sku         text,
  precio_centimos int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total_lineas int;
  v_pedidas int;
  v_encontradas int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío. Roncito no despacha cajas de aire.';
  end if;

  v_total_lineas := jsonb_array_length(p_items);
  if v_total_lineas > 50 then
    raise exception 'Máximo 50 productos distintos por pedido.';
  end if;

  -- Si el navegador manda una variante que no existe o fue desactivada,
  -- el JOIN la descartaría en silencio y el cliente pagaría de menos.
  -- Preferimos fallar con un mensaje claro.
  select count(distinct (e ->> 'variante_id')::uuid) into v_pedidas
  from jsonb_array_elements(p_items) as e;

  select count(*) into v_encontradas
  from variantes v
  join productos p on p.id = v.producto_id
  where v.activa and p.activo
    and v.id in (
      select (e ->> 'variante_id')::uuid from jsonb_array_elements(p_items) as e
    );

  if v_encontradas <> v_pedidas then
    raise exception
      'Uno o más productos de tu carrito ya no están disponibles. Vuelve a cargar el catálogo.'
      using errcode = 'check_violation';
  end if;

  return query
  with entrada as (
    select
      (e ->> 'variante_id')::uuid as v_id,
      -- floor() evita que manden 1.9 y se cuele como 2
      floor((e ->> 'cantidad')::numeric)::int as cant
    from jsonb_array_elements(p_items) as e
  ),
  agrupado as (
    -- Si repiten la misma variante en dos líneas, se suma una sola vez.
    select v_id, sum(cant)::int as cant
    from entrada
    group by v_id
  )
  select
    a.v_id,
    a.cant,
    p.nombre || case when v.nombre = 'Única' then '' else ' (' || v.nombre || ')' end,
    v.sku,
    v.precio_centimos
  from agrupado a
  join variantes v on v.id = a.v_id
  join productos p on p.id = v.producto_id
  where v.activa and p.activo
  order by a.v_id;  -- orden estable = sin interbloqueos entre pedidos simultáneos
end;
$$;

-- ============================================================
-- PEDIDOS DE LA TIENDA ONLINE
-- ============================================================

-- ------------------------------------------------------------
-- crear_pedido: lo llama el cliente desde la web (sin iniciar sesión).
--
-- El pedido se guarda ANTES de abrir WhatsApp, por eso devuelve el código:
-- el mensaje de WhatsApp lleva un identificador que ya existe en la base.
-- Reserva el stock para que dos clientes no compren la última unidad.
-- ------------------------------------------------------------
create or replace function crear_pedido(
  p_cliente_nombre   text,
  p_cliente_telefono text,
  p_ubicacion_codigo text,
  p_items            jsonb,
  p_cliente_nota     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido_id   uuid;
  v_codigo      text;
  v_ubicacion   ubicaciones%rowtype;
  v_total       int := 0;
  r             record;
  v_disponible  int;
  v_items_out   jsonb := '[]'::jsonb;
begin
  -- Datos de contacto: sin teléfono no hay forma de coordinar el recojo.
  p_cliente_nombre := nullif(btrim(p_cliente_nombre), '');
  p_cliente_telefono := nullif(regexp_replace(coalesce(p_cliente_telefono,''), '[^0-9+]', '', 'g'), '');

  if p_cliente_nombre is null or length(p_cliente_nombre) < 2 then
    raise exception 'Necesitamos tu nombre para preparar el pedido.';
  end if;
  if p_cliente_telefono is null or length(p_cliente_telefono) < 6 then
    raise exception 'Necesitamos un teléfono válido para coordinar por WhatsApp.';
  end if;

  select * into v_ubicacion
  from ubicaciones
  where codigo = p_ubicacion_codigo and activa and es_punto_recojo;

  if not found then
    raise exception 'Ese punto de recojo no existe o no está disponible.';
  end if;

  insert into pedidos (
    cliente_nombre, cliente_telefono, cliente_nota,
    subtotal_centimos, total_centimos, ubicacion_id
  ) values (
    p_cliente_nombre, p_cliente_telefono, nullif(btrim(p_cliente_nota), ''),
    0, 0, v_ubicacion.id
  )
  returning id, codigo into v_pedido_id, v_codigo;

  -- Recorre en orden de variante: dos pedidos concurrentes toman los
  -- bloqueos en la misma secuencia y nunca se quedan trabados entre sí.
  for r in select * from fn_normalizar_items(p_items) order by variante_id loop

    if r.cantidad <= 0 then
      raise exception 'La cantidad de "%" debe ser al menos 1.', r.nombre;
    end if;
    if r.cantidad > 99 then
      raise exception 'Máximo 99 unidades por producto. Para pedidos mayores, escríbenos.';
    end if;

    insert into inventario (variante_id, ubicacion_id, cantidad, reservado)
    values (r.variante_id, v_ubicacion.id, 0, 0)
    on conflict (variante_id, ubicacion_id) do nothing;

    select cantidad - reservado into v_disponible
    from inventario
    where variante_id = r.variante_id and ubicacion_id = v_ubicacion.id
    for update;

    if v_disponible < r.cantidad then
      raise exception
        'Nos quedamos cortos de "%": quedan % disponibles en %.',
        r.nombre, greatest(v_disponible, 0), v_ubicacion.nombre
        using errcode = 'check_violation';
    end if;

    -- Reserva: el stock sigue físicamente ahí, pero ya no es vendible.
    update inventario
       set reservado = reservado + r.cantidad
     where variante_id = r.variante_id and ubicacion_id = v_ubicacion.id;

    insert into pedido_items (
      pedido_id, variante_id, nombre_snapshot, sku_snapshot,
      cantidad, precio_unitario_centimos, subtotal_centimos
    ) values (
      v_pedido_id, r.variante_id, r.nombre, r.sku,
      r.cantidad, r.precio_centimos, r.precio_centimos * r.cantidad
    );

    v_total := v_total + (r.precio_centimos * r.cantidad);

    v_items_out := v_items_out || jsonb_build_object(
      'nombre', r.nombre,
      'sku', r.sku,
      'cantidad', r.cantidad,
      'precio_centimos', r.precio_centimos,
      'subtotal_centimos', r.precio_centimos * r.cantidad
    );
  end loop;

  if v_total <= 0 then
    raise exception 'No pudimos armar el pedido: ninguno de los productos está disponible.';
  end if;

  update pedidos
     set subtotal_centimos = v_total,
         total_centimos    = v_total
   where id = v_pedido_id;

  return jsonb_build_object(
    'pedido_id',       v_pedido_id,
    'codigo',          v_codigo,
    'total_centimos',  v_total,
    'estado',          'pendiente_pago',
    'punto_recojo',    v_ubicacion.nombre,
    'expira_en',       (now() + interval '48 hours'),
    'items',           v_items_out
  );
end;
$$;

-- ------------------------------------------------------------
-- consultar_pedido: el cliente revisa su pedido con código + teléfono.
-- No exponemos la tabla de pedidos: sólo se devuelve el que coincide.
-- ------------------------------------------------------------
create or replace function consultar_pedido(p_codigo text, p_telefono text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'codigo', p.codigo,
    'estado', p.estado,
    'cliente_nombre', p.cliente_nombre,
    'total_centimos', p.total_centimos,
    'punto_recojo', u.nombre,
    'creado_en', p.creado_en,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nombre', i.nombre_snapshot,
        'cantidad', i.cantidad,
        'subtotal_centimos', i.subtotal_centimos
      ) order by i.nombre_snapshot), '[]'::jsonb)
      from pedido_items i where i.pedido_id = p.id
    )
  ) into v
  from pedidos p
  join ubicaciones u on u.id = p.ubicacion_id
  where p.codigo = upper(btrim(p_codigo))
    and regexp_replace(p.cliente_telefono, '[^0-9]', '', 'g')
        = regexp_replace(coalesce(p_telefono,''), '[^0-9]', '', 'g');

  if v is null then
    raise exception 'No encontramos un pedido con ese código y teléfono.';
  end if;
  return v;
end;
$$;

-- ------------------------------------------------------------
-- confirmar_pago: el administrador verificó el depósito.
--
-- Aquí es donde el stock baja de verdad, y sólo una vez:
--   1. Bloquea el pedido (FOR UPDATE) para serializar clics simultáneos.
--   2. Exige que el estado sea 'pendiente_pago'; cualquier segundo intento
--      encuentra 'listo_recojo' y es rechazado.
--   3. El índice único uq_mov_venta_online_por_pedido es la red de
--      seguridad final a nivel de base de datos.
-- ------------------------------------------------------------
create or replace function confirmar_pago(p_pedido_id uuid, p_referencia text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido pedidos%rowtype;
  r record;
begin
  perform fn_exige_equipo();

  select * into v_pedido from pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'Ese pedido no existe.';
  end if;

  if v_pedido.estado = 'listo_recojo' or v_pedido.estado = 'entregado' then
    raise exception 'El pedido % ya fue confirmado antes. No se descuenta inventario dos veces.', v_pedido.codigo
      using errcode = '55000';
  end if;
  if v_pedido.estado = 'cancelado' then
    raise exception 'El pedido % está cancelado; no se puede confirmar.', v_pedido.codigo
      using errcode = '55000';
  end if;
  if v_pedido.estado <> 'pendiente_pago' then
    raise exception 'El pedido % no está esperando pago.', v_pedido.codigo
      using errcode = '55000';
  end if;

  for r in
    select variante_id, cantidad, nombre_snapshot
    from pedido_items
    where pedido_id = p_pedido_id
    order by variante_id
  loop
    -- Libera la reserva y descuenta la unidad física en un solo paso.
    update inventario
       set reservado = reservado - r.cantidad
     where variante_id = r.variante_id
       and ubicacion_id = v_pedido.ubicacion_id;

    perform fn_mover_stock(
      r.variante_id, v_pedido.ubicacion_id, 'venta_online', -r.cantidad,
      'pedido', p_pedido_id,
      'Pago verificado del pedido ' || v_pedido.codigo
    );
  end loop;

  update pedidos
     set estado = 'listo_recojo',
         pagado_en = now(),
         usuario_confirmo = auth.uid(),
         referencia_pago = nullif(btrim(p_referencia), '')
   where id = p_pedido_id;

  return jsonb_build_object(
    'codigo', v_pedido.codigo,
    'estado', 'listo_recojo',
    'mensaje', 'Pago verificado. El pedido está listo para recojo.'
  );
end;
$$;

-- ------------------------------------------------------------
-- cancelar_pedido
-- Si aún no se pagó, basta con soltar la reserva.
-- Si ya se había confirmado, el stock salió: hay que reponerlo.
-- ------------------------------------------------------------
create or replace function cancelar_pedido(p_pedido_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido pedidos%rowtype;
  r record;
begin
  perform fn_exige_equipo();

  select * into v_pedido from pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'Ese pedido no existe.';
  end if;

  if v_pedido.estado = 'cancelado' then
    raise exception 'El pedido % ya estaba cancelado.', v_pedido.codigo using errcode = '55000';
  end if;
  if v_pedido.estado = 'entregado' then
    raise exception 'El pedido % ya fue entregado; registra una devolución en su lugar.', v_pedido.codigo
      using errcode = '55000';
  end if;

  for r in
    select variante_id, cantidad from pedido_items
    where pedido_id = p_pedido_id order by variante_id
  loop
    if v_pedido.estado = 'pendiente_pago' then
      update inventario
         set reservado = reservado - r.cantidad
       where variante_id = r.variante_id and ubicacion_id = v_pedido.ubicacion_id;
    else
      -- Ya estaba descontado: vuelve al stock.
      perform fn_mover_stock(
        r.variante_id, v_pedido.ubicacion_id, 'devolucion', r.cantidad,
        'pedido', p_pedido_id,
        'Cancelación del pedido ' || v_pedido.codigo
      );
    end if;
  end loop;

  update pedidos
     set estado = 'cancelado',
         cancelado_en = now(),
         motivo_cancelacion = coalesce(nullif(btrim(p_motivo), ''), 'Sin motivo registrado')
   where id = p_pedido_id;

  return jsonb_build_object('codigo', v_pedido.codigo, 'estado', 'cancelado');
end;
$$;

-- ------------------------------------------------------------
-- registrar_recojo: el cliente pasó por su pedido.
-- ------------------------------------------------------------
create or replace function registrar_recojo(p_pedido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido pedidos%rowtype;
begin
  perform fn_exige_equipo();

  select * into v_pedido from pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'Ese pedido no existe.';
  end if;
  if v_pedido.estado <> 'listo_recojo' then
    raise exception 'Sólo se puede registrar el recojo de un pedido pagado y listo. Estado actual: %.', v_pedido.estado
      using errcode = '55000';
  end if;

  update pedidos
     set estado = 'entregado', entregado_en = now(), usuario_entrego = auth.uid()
   where id = p_pedido_id;

  return jsonb_build_object('codigo', v_pedido.codigo, 'estado', 'entregado');
end;
$$;

-- ------------------------------------------------------------
-- liberar_reservas_vencidas
-- Un pedido sin pago verificado no puede bloquear stock para siempre.
-- ------------------------------------------------------------
create or replace function liberar_reservas_vencidas()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido record;
  v_contador int := 0;
begin
  perform fn_exige_equipo();

  for v_pedido in
    select id from pedidos
    where estado = 'pendiente_pago' and expira_en < now()
    order by creado_en
  loop
    perform cancelar_pedido(v_pedido.id, 'Reserva vencida: no se verificó el pago a tiempo.');
    v_contador := v_contador + 1;
  end loop;

  return jsonb_build_object('pedidos_liberados', v_contador);
end;
$$;

-- ============================================================
-- OPERACIÓN DIARIA: ventas presenciales, devoluciones, ajustes, traslados
-- ============================================================

-- ------------------------------------------------------------
-- registrar_venta_fisica: mostrador de tienda o feria.
-- A diferencia del pedido web, aquí el cliente se lleva el producto
-- en el momento, así que el descuento es inmediato (sin reserva).
-- ------------------------------------------------------------
create or replace function registrar_venta_fisica(
  p_ubicacion_codigo text,
  p_items            jsonb,
  p_metodo_pago      text default 'efectivo',
  p_nota             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ubicacion ubicaciones%rowtype;
  v_venta_id uuid;
  v_codigo text;
  v_total int := 0;
  r record;
begin
  perform fn_exige_equipo();

  select * into v_ubicacion from ubicaciones where codigo = p_ubicacion_codigo and activa;
  if not found then
    raise exception 'Esa ubicación no existe o está inactiva.';
  end if;

  if p_metodo_pago not in ('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia') then
    raise exception 'Método de pago no reconocido: %', p_metodo_pago;
  end if;

  insert into ventas (ubicacion_id, usuario_id, total_centimos, metodo_pago, nota)
  values (v_ubicacion.id, auth.uid(), 0, p_metodo_pago, nullif(btrim(p_nota), ''))
  returning id, codigo into v_venta_id, v_codigo;

  for r in select * from fn_normalizar_items(p_items) order by variante_id loop
    if r.cantidad <= 0 then
      raise exception 'La cantidad de "%" debe ser al menos 1.', r.nombre;
    end if;

    perform fn_mover_stock(
      r.variante_id, v_ubicacion.id, 'venta_fisica', -r.cantidad,
      'venta', v_venta_id, 'Venta ' || v_codigo || ' en ' || v_ubicacion.nombre
    );

    insert into venta_items (
      venta_id, variante_id, nombre_snapshot, cantidad,
      precio_unitario_centimos, subtotal_centimos
    ) values (
      v_venta_id, r.variante_id, r.nombre, r.cantidad,
      r.precio_centimos, r.precio_centimos * r.cantidad
    );

    v_total := v_total + (r.precio_centimos * r.cantidad);
  end loop;

  update ventas set total_centimos = v_total where id = v_venta_id;

  return jsonb_build_object('venta_id', v_venta_id, 'codigo', v_codigo, 'total_centimos', v_total);
end;
$$;

-- ------------------------------------------------------------
-- registrar_devolucion: la mercadería vuelve al stock.
-- ------------------------------------------------------------
create or replace function registrar_devolucion(
  p_ubicacion_codigo text,
  p_items            jsonb,
  p_motivo           text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ubicacion ubicaciones%rowtype;
  r record;
  v_unidades int := 0;
begin
  perform fn_exige_equipo();

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'Toda devolución necesita un motivo registrado.';
  end if;

  select * into v_ubicacion from ubicaciones where codigo = p_ubicacion_codigo and activa;
  if not found then
    raise exception 'Esa ubicación no existe o está inactiva.';
  end if;

  for r in select * from fn_normalizar_items(p_items) order by variante_id loop
    perform fn_mover_stock(
      r.variante_id, v_ubicacion.id, 'devolucion', r.cantidad,
      'devolucion', null, p_motivo
    );
    v_unidades := v_unidades + r.cantidad;
  end loop;

  return jsonb_build_object('unidades_devueltas', v_unidades, 'ubicacion', v_ubicacion.nombre);
end;
$$;

-- ------------------------------------------------------------
-- ajustar_stock: conteo físico o merma. Sólo administración.
-- Se guarda la diferencia contra lo que decía el sistema.
-- ------------------------------------------------------------
create or replace function ajustar_stock(
  p_variante_id      uuid,
  p_ubicacion_codigo text,
  p_cantidad_real    int,
  p_motivo           text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ubicacion ubicaciones%rowtype;
  v_actual int;
  v_delta  int;
begin
  perform fn_exige_admin();

  if p_cantidad_real < 0 then
    raise exception 'La cantidad contada no puede ser negativa.';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'Todo ajuste necesita un motivo (conteo, merma, error de registro...).';
  end if;

  select * into v_ubicacion from ubicaciones where codigo = p_ubicacion_codigo and activa;
  if not found then
    raise exception 'Esa ubicación no existe o está inactiva.';
  end if;

  insert into inventario (variante_id, ubicacion_id) values (p_variante_id, v_ubicacion.id)
  on conflict (variante_id, ubicacion_id) do nothing;

  select cantidad into v_actual from inventario
  where variante_id = p_variante_id and ubicacion_id = v_ubicacion.id for update;

  v_delta := p_cantidad_real - v_actual;

  if v_delta = 0 then
    return jsonb_build_object('sin_cambios', true, 'cantidad', v_actual);
  end if;

  perform fn_mover_stock(
    p_variante_id, v_ubicacion.id, 'ajuste', v_delta,
    'ajuste', null, p_motivo
  );

  return jsonb_build_object('cantidad_previa', v_actual, 'cantidad_nueva', p_cantidad_real, 'delta', v_delta);
end;
$$;

-- ------------------------------------------------------------
-- trasladar_stock: mover mercadería entre almacén, tienda y ferias.
-- Sale de un lado y entra al otro en la misma transacción: si la salida
-- falla por falta de stock, la entrada tampoco ocurre.
-- ------------------------------------------------------------
create or replace function trasladar_stock(
  p_variante_id     uuid,
  p_origen_codigo   text,
  p_destino_codigo  text,
  p_cantidad        int,
  p_nota            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen  ubicaciones%rowtype;
  v_destino ubicaciones%rowtype;
begin
  perform fn_exige_equipo();

  if p_cantidad <= 0 then
    raise exception 'La cantidad a trasladar debe ser mayor a cero.';
  end if;
  if p_origen_codigo = p_destino_codigo then
    raise exception 'El origen y el destino no pueden ser la misma ubicación.';
  end if;

  select * into v_origen from ubicaciones where codigo = p_origen_codigo and activa;
  if not found then raise exception 'La ubicación de origen no existe o está inactiva.'; end if;

  select * into v_destino from ubicaciones where codigo = p_destino_codigo and activa;
  if not found then raise exception 'La ubicación de destino no existe o está inactiva.'; end if;

  perform fn_mover_stock(
    p_variante_id, v_origen.id, 'traslado_salida', -p_cantidad,
    'traslado', null, coalesce(p_nota, 'Traslado hacia ' || v_destino.nombre)
  );
  perform fn_mover_stock(
    p_variante_id, v_destino.id, 'traslado_entrada', p_cantidad,
    'traslado', null, coalesce(p_nota, 'Traslado desde ' || v_origen.nombre)
  );

  return jsonb_build_object(
    'trasladado', p_cantidad,
    'origen', v_origen.nombre,
    'destino', v_destino.nombre
  );
end;
$$;

-- ------------------------------------------------------------
-- registrar_ingreso: producción terminada o compra que entra al stock.
-- ------------------------------------------------------------
create or replace function registrar_ingreso(
  p_variante_id      uuid,
  p_ubicacion_codigo text,
  p_cantidad         int,
  p_nota             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ubicacion ubicaciones%rowtype;
begin
  perform fn_exige_equipo();

  if p_cantidad <= 0 then
    raise exception 'El ingreso debe ser de al menos una unidad.';
  end if;

  select * into v_ubicacion from ubicaciones where codigo = p_ubicacion_codigo and activa;
  if not found then
    raise exception 'Esa ubicación no existe o está inactiva.';
  end if;

  perform fn_mover_stock(
    p_variante_id, v_ubicacion.id, 'ingreso', p_cantidad,
    'ingreso', null, coalesce(nullif(btrim(p_nota), ''), 'Ingreso de mercadería')
  );

  return jsonb_build_object('ingresado', p_cantidad, 'ubicacion', v_ubicacion.nombre);
end;
$$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  20261018000003_vistas_kpis_importacion.sql              ║
-- ╚══════════════════════════════════════════════════════════╝

-- ============================================================
-- Ron con Cola — Migración 003: vistas, indicadores e importación
--
-- Todos los indicadores se calculan aquí, con SQL. La IA del asistente
-- recibe estos números ya calculados y sólo los explica en palabras:
-- nunca estima, promedia ni inventa cifras por su cuenta.
-- ============================================================

-- Quita tildes sin depender de la extensión unaccent (que no siempre
-- está habilitada en proyectos Supabase nuevos).
create or replace function unaccent_simple(p_texto text)
returns text language sql immutable as $$
  select translate(
    p_texto,
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
  );
$$;

-- ------------------------------------------------------------
-- Stock consolidado, legible para el panel
-- ------------------------------------------------------------
create or replace view v_stock_actual as
select
  i.id                as inventario_id,
  v.id                as variante_id,
  v.sku,
  p.id                as producto_id,
  p.nombre            as producto,
  v.nombre            as variante,
  c.nombre            as categoria,
  u.id                as ubicacion_id,
  u.codigo            as ubicacion_codigo,
  u.nombre            as ubicacion,
  u.tipo              as ubicacion_tipo,
  i.cantidad,
  i.reservado,
  i.cantidad - i.reservado as disponible,
  i.stock_minimo,
  (i.cantidad - i.reservado) <= i.stock_minimo as bajo_stock,
  v.precio_centimos,
  v.costo_centimos,
  i.cantidad * v.costo_centimos as valor_costo_centimos
from inventario i
join variantes   v on v.id = i.variante_id
join productos   p on p.id = v.producto_id
left join categorias c on c.id = p.categoria_id
join ubicaciones u on u.id = i.ubicacion_id;

-- ------------------------------------------------------------
-- Catálogo que ve el cliente: sólo lo activo y lo que se puede
-- recoger, con la disponibilidad real sumada entre puntos de recojo.
-- ------------------------------------------------------------
create or replace view v_catalogo_publico as
select
  v.id                as variante_id,
  p.id                as producto_id,
  p.nombre            as producto,
  p.descripcion,
  p.imagen_url,
  v.nombre            as variante,
  v.sku,
  v.precio_centimos,
  coalesce(c.nombre, 'Sin categoría') as categoria,
  coalesce(c.slug,   'sin-categoria') as categoria_slug,
  coalesce(c.emoji,  '🐈')            as categoria_emoji,
  coalesce(sum(i.cantidad - i.reservado) filter (where u.es_punto_recojo and u.activa), 0)::int as disponible
from variantes v
join productos p on p.id = v.producto_id
left join categorias c  on c.id = p.categoria_id
left join inventario  i on i.variante_id = v.id
left join ubicaciones u on u.id = i.ubicacion_id
where v.activa and p.activo
group by v.id, p.id, p.nombre, p.descripcion, p.imagen_url,
         v.nombre, v.sku, v.precio_centimos, c.nombre, c.slug, c.emoji;

-- ------------------------------------------------------------
-- Disponibilidad por punto de recojo (para elegir dónde retirar)
-- ------------------------------------------------------------
create or replace view v_disponibilidad_por_punto as
select
  v.id as variante_id,
  u.codigo as ubicacion_codigo,
  u.nombre as ubicacion,
  (i.cantidad - i.reservado)::int as disponible
from variantes v
join inventario  i on i.variante_id = v.id
join ubicaciones u on u.id = i.ubicacion_id
where u.es_punto_recojo and u.activa and v.activa;

-- ------------------------------------------------------------
-- kpis_resumen: el tablero de indicadores en una sola consulta.
--
-- "Venta" = pedido online con pago verificado + venta presencial.
-- Un pedido pendiente de pago NO cuenta como venta: todavía puede caerse.
-- ------------------------------------------------------------
create or replace function kpis_resumen(p_dias int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_desde timestamptz;
  v_resultado jsonb;
begin
  perform fn_exige_equipo();

  if p_dias is null or p_dias < 1 or p_dias > 365 then
    p_dias := 30;
  end if;
  v_desde := date_trunc('day', now()) - make_interval(days => p_dias - 1);

  with online as (
    select p.id, p.total_centimos, coalesce(p.pagado_en, p.creado_en) as fecha
    from pedidos p
    where p.estado in ('listo_recojo', 'entregado')
      and p.pagado_en >= v_desde
  ),
  fisicas as (
    select v.id, v.total_centimos, v.creado_en as fecha
    from ventas v
    where v.creado_en >= v_desde
  ),
  todas as (
    select total_centimos, fecha, 'online' as canal from online
    union all
    select total_centimos, fecha, 'presencial' as canal from fisicas
  ),
  -- Serie completa de días, incluidos los que no tuvieron ventas.
  -- Sin esto, un periodo con un solo día vendido se dibujaría como una
  -- única barra ocupando todo el ancho, y no se vería la evolución real.
  por_dia as (
    select
      to_char(d.dia, 'YYYY-MM-DD') as dia,
      coalesce(sum(t.total_centimos), 0)::int as total_centimos,
      count(t.fecha)::int as operaciones
    from generate_series(
           v_desde::date,
           date_trunc('day', now())::date,
           interval '1 day'
         ) as d(dia)
    left join todas t
      on date_trunc('day', t.fecha)::date = d.dia::date
    group by d.dia
  ),
  unidades as (
    select coalesce(sum(-m.delta), 0)::int as total
    from movimientos_inventario m
    where m.tipo in ('venta_online', 'venta_fisica')
      and m.creado_en >= v_desde
  ),
  top as (
    select
      pr.nombre || case when vr.nombre = 'Única' then '' else ' (' || vr.nombre || ')' end as producto,
      sum(-m.delta)::int as unidades,
      sum(-m.delta * vr.precio_centimos)::int as ingreso_centimos
    from movimientos_inventario m
    join variantes vr on vr.id = m.variante_id
    join productos pr on pr.id = vr.producto_id
    where m.tipo in ('venta_online', 'venta_fisica') and m.creado_en >= v_desde
    group by 1
    order by 2 desc
    limit 8
  ),
  canal as (
    select canal, sum(total_centimos)::int as total_centimos, count(*)::int as operaciones
    from todas group by canal
  ),
  bajo as (
    select producto, variante, ubicacion, disponible, stock_minimo
    from v_stock_actual
    where bajo_stock
    order by disponible asc
    limit 12
  ),
  inventario_valor as (
    select
      coalesce(sum(valor_costo_centimos), 0)::int as valor_costo_centimos,
      coalesce(sum(cantidad), 0)::int as unidades_en_stock,
      coalesce(sum(reservado), 0)::int as unidades_reservadas
    from v_stock_actual
  ),
  pendientes as (
    select
      count(*) filter (where estado = 'pendiente_pago')::int as por_verificar,
      count(*) filter (where estado = 'listo_recojo')::int   as por_entregar,
      count(*) filter (where estado = 'pendiente_pago' and expira_en < now())::int as reservas_vencidas,
      coalesce(sum(total_centimos) filter (where estado = 'pendiente_pago'), 0)::int as monto_por_verificar
    from pedidos
  ),
  conversion as (
    select
      count(*)::int as pedidos_creados,
      count(*) filter (where estado in ('listo_recojo','entregado'))::int as pedidos_concretados,
      count(*) filter (where estado = 'cancelado')::int as pedidos_cancelados
    from pedidos
    where creado_en >= v_desde
  )
  select jsonb_build_object(
    'periodo_dias', p_dias,
    'desde', v_desde,
    'hasta', now(),
    'ventas_totales_centimos', (select coalesce(sum(total_centimos), 0)::int from todas),
    'operaciones',             (select count(*)::int from todas),
    'ticket_promedio_centimos',
        (select case when count(*) = 0 then 0
                else (sum(total_centimos) / count(*))::int end from todas),
    'unidades_vendidas',       (select total from unidades),
    'ventas_por_dia',          (select coalesce(jsonb_agg(jsonb_build_object(
                                  'dia', dia, 'total_centimos', total_centimos, 'operaciones', operaciones
                                ) order by dia), '[]'::jsonb) from por_dia),
    'ventas_por_canal',        (select coalesce(jsonb_agg(jsonb_build_object(
                                  'canal', canal, 'total_centimos', total_centimos, 'operaciones', operaciones
                                )), '[]'::jsonb) from canal),
    'top_productos',           (select coalesce(jsonb_agg(jsonb_build_object(
                                  'producto', producto, 'unidades', unidades, 'ingreso_centimos', ingreso_centimos
                                )), '[]'::jsonb) from top),
    'stock_bajo',              (select coalesce(jsonb_agg(jsonb_build_object(
                                  'producto', producto, 'variante', variante, 'ubicacion', ubicacion,
                                  'disponible', disponible, 'stock_minimo', stock_minimo
                                )), '[]'::jsonb) from bajo),
    'inventario',              (select to_jsonb(iv) from inventario_valor iv),
    'pedidos',                 (select to_jsonb(pe) from pendientes pe),
    'conversion',              (select to_jsonb(co) from conversion co)
  ) into v_resultado;

  return v_resultado;
end;
$$;

-- ------------------------------------------------------------
-- Movimientos recientes, para auditar qué pasó con el inventario
-- ------------------------------------------------------------
create or replace function movimientos_recientes(p_limite int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform fn_exige_equipo();
  p_limite := least(greatest(coalesce(p_limite, 50), 1), 200);

  select coalesce(jsonb_agg(x order by x ->> 'creado_en' desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'creado_en', m.creado_en,
      'tipo', m.tipo,
      'delta', m.delta,
      'producto', pr.nombre || case when vr.nombre = 'Única' then '' else ' (' || vr.nombre || ')' end,
      'sku', vr.sku,
      'ubicacion', u.nombre,
      'cantidad_nueva', m.cantidad_nueva,
      'nota', m.nota,
      'responsable', coalesce(pf.nombre, 'Sistema')
    ) as x
    from movimientos_inventario m
    join variantes vr on vr.id = m.variante_id
    join productos pr on pr.id = vr.producto_id
    join ubicaciones u on u.id = m.ubicacion_id
    left join perfiles pf on pf.id = m.usuario_id
    order by m.creado_en desc
    limit p_limite
  ) t;

  return v;
end;
$$;

-- ============================================================
-- IMPORTACIÓN CSV
-- ============================================================

-- ------------------------------------------------------------
-- buscar_similares: apoyo para detectar duplicados.
-- Usa similitud de texto de Postgres (pg_trgm). Es determinista
-- y no depende de ninguna IA: si no hay credenciales de IA, el
-- sistema igual detecta duplicados con esto.
-- ------------------------------------------------------------
create or replace function buscar_similares(p_nombre text, p_umbral numeric default 0.45)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform fn_exige_equipo();

  select coalesce(jsonb_agg(jsonb_build_object(
    'variante_id', t.variante_id,
    'producto', t.producto,
    'sku', t.sku,
    'score', round(t.score::numeric, 2)
  ) order by t.score desc), '[]'::jsonb) into v
  from (
    select v.id as variante_id, p.nombre as producto, v.sku,
           similarity(p.nombre, p_nombre) as score
    from variantes v
    join productos p on p.id = v.producto_id
    where similarity(p.nombre, p_nombre) >= p_umbral
    order by score desc
    limit 5
  ) t;

  return v;
end;
$$;

-- ------------------------------------------------------------
-- aplicar_importacion
--
-- Crea en el catálogo sólo las filas que una persona marcó como 'crear'.
-- Las marcadas 'omitir' o 'fusionar' no generan productos nuevos.
-- Es idempotente: una importación ya aplicada no se vuelve a aplicar.
-- ------------------------------------------------------------
create or replace function aplicar_importacion(p_importacion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_imp importaciones%rowtype;
  r record;
  v_categoria_id uuid;
  v_producto_id uuid;
  v_variante_id uuid;
  v_ubicacion_id uuid;
  v_creadas int := 0;
  v_omitidas int := 0;
  v_fallidas int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_sku text;
  v_precio int;
  v_stock int;
begin
  perform fn_exige_admin();

  select * into v_imp from importaciones where id = p_importacion_id for update;
  if not found then
    raise exception 'Esa importación no existe.';
  end if;
  if v_imp.estado = 'aplicada' then
    raise exception 'Esta importación ya fue aplicada el %. No se duplica el catálogo.', v_imp.aplicada_en
      using errcode = '55000';
  end if;
  if v_imp.estado = 'descartada' then
    raise exception 'Esta importación fue descartada.' using errcode = '55000';
  end if;

  for r in
    select * from importacion_filas
    where importacion_id = p_importacion_id and decision = 'crear'
    order by fila_num
  loop
    begin
      v_sku := upper(btrim(r.datos ->> 'sku'));
      v_precio := round((nullif(btrim(r.datos ->> 'precio'), ''))::numeric * 100)::int;
      v_stock  := coalesce(floor((nullif(btrim(r.datos ->> 'stock'), ''))::numeric)::int, 0);

      if v_sku is null or v_sku = '' then
        raise exception 'Falta el SKU';
      end if;
      if v_precio is null or v_precio <= 0 then
        raise exception 'Precio inválido';
      end if;
      if v_stock < 0 then
        raise exception 'El stock no puede ser negativo';
      end if;

      -- Categoría: la sugerida y aprobada en la revisión.
      if coalesce(btrim(r.categoria_sugerida), '') <> '' then
        select id into v_categoria_id from categorias
        where lower(nombre) = lower(btrim(r.categoria_sugerida));

        if v_categoria_id is null then
          insert into categorias (nombre, slug)
          values (
            btrim(r.categoria_sugerida),
            regexp_replace(lower(unaccent_simple(btrim(r.categoria_sugerida))), '[^a-z0-9]+', '-', 'g')
          )
          returning id into v_categoria_id;
        end if;
      else
        v_categoria_id := null;
      end if;

      -- Si el SKU base ya existe, se reutiliza el producto (no se duplica).
      select id into v_producto_id from productos where sku_base = v_sku;
      if v_producto_id is null then
        insert into productos (sku_base, nombre, descripcion, categoria_id, imagen_url)
        values (
          v_sku,
          btrim(r.datos ->> 'nombre'),
          nullif(btrim(r.datos ->> 'descripcion'), ''),
          v_categoria_id,
          nullif(btrim(r.datos ->> 'imagen_url'), '')
        )
        returning id into v_producto_id;
      end if;

      insert into variantes (producto_id, sku, nombre, precio_centimos, costo_centimos)
      values (
        v_producto_id,
        v_sku || case when coalesce(btrim(r.datos ->> 'variante'), '') = '' then ''
                      else '-' || upper(regexp_replace(btrim(r.datos ->> 'variante'), '[^a-zA-Z0-9]+', '', 'g')) end,
        coalesce(nullif(btrim(r.datos ->> 'variante'), ''), 'Única'),
        v_precio,
        coalesce(round((nullif(btrim(r.datos ->> 'costo'), ''))::numeric * 100)::int, 0)
      )
      returning id into v_variante_id;

      -- Stock inicial: entra como movimiento de ingreso, con su rastro.
      if v_stock > 0 then
        select id into v_ubicacion_id from ubicaciones
        where codigo = coalesce(nullif(btrim(r.datos ->> 'ubicacion'), ''), 'ALMACEN') and activa;

        if v_ubicacion_id is null then
          raise exception 'La ubicación "%" no existe', r.datos ->> 'ubicacion';
        end if;

        perform fn_mover_stock(
          v_variante_id, v_ubicacion_id, 'ingreso', v_stock,
          'importacion', p_importacion_id,
          'Stock inicial importado de ' || v_imp.nombre_archivo
        );
      end if;

      v_creadas := v_creadas + 1;

    exception when others then
      -- Una fila mala no bota toda la importación: se registra y se sigue.
      v_fallidas := v_fallidas + 1;
      update importacion_filas set error = SQLERRM where id = r.id;
      v_errores := v_errores || jsonb_build_object('fila', r.fila_num, 'error', SQLERRM);
    end;
  end loop;

  -- Omitidas = las que la persona decidió no crear, más las que fallaron.
  select count(*) into v_omitidas from importacion_filas
  where importacion_id = p_importacion_id and decision <> 'crear';
  v_omitidas := v_omitidas + v_fallidas;

  update importaciones
     set estado = 'aplicada',
         aplicada_en = now(),
         filas_creadas = v_creadas,
         filas_omitidas = v_omitidas
   where id = p_importacion_id;

  return jsonb_build_object(
    'creadas', v_creadas,
    'omitidas', v_omitidas,
    'fallidas', v_fallidas,
    'errores', v_errores
  );
end;
$$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  20261018000004_seguridad.sql                            ║
-- ╚══════════════════════════════════════════════════════════╝

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

