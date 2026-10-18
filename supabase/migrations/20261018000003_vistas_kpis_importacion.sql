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
  por_dia as (
    select
      to_char(date_trunc('day', fecha), 'YYYY-MM-DD') as dia,
      sum(total_centimos)::int as total_centimos,
      count(*)::int as operaciones
    from todas
    group by 1
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
