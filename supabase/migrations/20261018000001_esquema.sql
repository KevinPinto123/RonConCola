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
