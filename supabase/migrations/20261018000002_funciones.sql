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
