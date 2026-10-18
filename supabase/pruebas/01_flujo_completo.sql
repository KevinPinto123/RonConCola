-- ============================================================
-- Ron con Cola — Prueba del flujo completo
--
-- Comprueba, contra un Postgres real, que el sistema cumple lo
-- prometido: importación, compra, confirmación, inventario,
-- cancelación, permisos y analítica.
--
-- Cada bloque falla con un grito si algo no cuadra. Si el archivo
-- llega hasta el final, es que todo pasó.
--
-- Cómo correrlo:  ver supabase/pruebas/LEEME.md
-- ============================================================

\set ON_ERROR_STOP on
\timing off

create or replace function pruebas_afirmar(p_condicion boolean, p_mensaje text)
returns void language plpgsql as $$
begin
  if not p_condicion then
    raise exception '✗ FALLÓ: %', p_mensaje;
  end if;
  raise notice '  ✓ %', p_mensaje;
end;
$$;

-- Ejecuta algo que DEBE fallar. Si no falla, la prueba falla.
create or replace function pruebas_debe_fallar(p_sql text, p_mensaje text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  ✓ % → bloqueado: %', p_mensaje, left(SQLERRM, 70);
    return;
  end;
  raise exception '✗ FALLÓ: % → se permitió una operación que debía bloquearse', p_mensaje;
end;
$$;

-- ------------------------------------------------------------
-- Personas de prueba
-- ------------------------------------------------------------
do $$
declare v_admin uuid; v_vendedor uuid;
begin
  delete from auth.users where email in ('cecilia@prueba.pe', 'abu@prueba.pe');

  insert into auth.users (email, raw_user_meta_data)
  values ('cecilia@prueba.pe', '{"nombre":"Cecilia","rol":"admin"}')
  returning id into v_admin;

  insert into auth.users (email, raw_user_meta_data)
  values ('abu@prueba.pe', '{"nombre":"El Abu","rol":"vendedor"}')
  returning id into v_vendedor;

  -- El trigger de la 001 debe haberles creado el perfil solo.
  perform pruebas_afirmar(
    (select rol from perfiles where id = v_admin) = 'admin',
    'El trigger crea el perfil de administración automáticamente');
  perform pruebas_afirmar(
    (select rol from perfiles where id = v_vendedor) = 'vendedor',
    'El trigger crea el perfil de vendedor automáticamente');
end $$;

\echo ''
\echo '════════ 1. CATÁLOGO PÚBLICO ════════'

do $$
declare v_n int; v_disp int;
begin
  select count(*), sum(disponible) into v_n, v_disp from v_catalogo_publico;
  perform pruebas_afirmar(v_n > 0, 'El catálogo público devuelve productos ('||v_n||' variantes)');
  perform pruebas_afirmar(v_disp > 0, 'Hay stock disponible publicado ('||v_disp||' unidades)');

  perform pruebas_afirmar(
    (select count(*) from v_catalogo_publico where disponible < 0) = 0,
    'Ningún producto muestra disponibilidad negativa');
end $$;

\echo ''
\echo '════════ 2. COMPRA: el pedido se guarda y reserva stock ════════'

do $$
declare
  v_variante uuid; v_sku text;
  v_antes_cant int; v_antes_res int;
  v_despues_cant int; v_despues_res int;
  v_precio int; v_resultado jsonb; v_codigo text;
begin
  select v.id, v.sku, v.precio_centimos into v_variante, v_sku, v_precio
  from variantes v
  join inventario i on i.variante_id = v.id
  join ubicaciones u on u.id = i.ubicacion_id and u.codigo = 'TIENDA40'
  where i.cantidad - i.reservado >= 4
  order by v.sku limit 1;

  select cantidad, reservado into v_antes_cant, v_antes_res
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  -- El cliente compra sin iniciar sesión.
  set local role anon;
  perform set_config('pruebas.usuario_id', '', true);

  v_resultado := crear_pedido(
    'Cliente de Prueba', '987654321', 'TIENDA40',
    jsonb_build_array(jsonb_build_object('variante_id', v_variante, 'cantidad', 3)),
    'Paso por la tienda el sábado'
  );

  reset role;

  v_codigo := v_resultado ->> 'codigo';

  perform pruebas_afirmar(v_codigo like 'RCC-%',
    'El pedido recibe un identificador legible: '||v_codigo);
  perform pruebas_afirmar(
    (v_resultado ->> 'total_centimos')::int = v_precio * 3,
    'El total lo calcula el servidor con el precio real de la base');
  perform pruebas_afirmar(
    (select estado from pedidos where codigo = v_codigo) = 'pendiente_pago',
    'El pedido queda guardado ANTES de abrir WhatsApp, en pendiente_pago');

  select cantidad, reservado into v_despues_cant, v_despues_res
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  perform pruebas_afirmar(v_despues_cant = v_antes_cant,
    'Crear el pedido NO descuenta stock físico todavía');
  perform pruebas_afirmar(v_despues_res = v_antes_res + 3,
    'Crear el pedido reserva 3 unidades (contra sobreventa)');

  -- Guardamos el código para los siguientes bloques.
  create temporary table if not exists t_pedido (codigo text, variante uuid);
  delete from t_pedido;
  insert into t_pedido values (v_codigo, v_variante);
end $$;

\echo ''
\echo '════════ 3. EL SERVIDOR NO CONFÍA EN EL NAVEGADOR ════════'

do $$
declare v_variante uuid; v_precio_real int; v_resultado jsonb;
begin
  select variante from t_pedido into v_variante;
  select precio_centimos into v_precio_real from variantes where id = v_variante;

  set local role anon;
  perform set_config('pruebas.usuario_id', '', true);

  -- El cliente manda un precio de 1 céntimo. Debe ser ignorado.
  v_resultado := crear_pedido(
    'Vivo Vivísimo', '999111222', 'TIENDA40',
    jsonb_build_array(jsonb_build_object(
      'variante_id', v_variante, 'cantidad', 1,
      'precio_centimos', 1, 'precio', 0.01, 'total', 0.01
    ))
  );
  reset role;

  perform pruebas_afirmar(
    (v_resultado ->> 'total_centimos')::int = v_precio_real,
    'Un precio falso enviado desde el navegador se ignora (cobra S/ '||
      round(v_precio_real/100.0, 2)||', no S/ 0.01)');

  -- Limpiamos ese pedido para no ensuciar los indicadores.
  perform set_config('pruebas.usuario_id', '', true);
end $$;

do $$
declare v_variante uuid; v_disponible int;
begin
  select variante from t_pedido into v_variante;
  select cantidad - reservado into v_disponible
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  set local role anon;
  perform pruebas_debe_fallar(
    format($f$ select crear_pedido('Acaparador','900000000','TIENDA40',
             jsonb_build_array(jsonb_build_object('variante_id','%s','cantidad',%s))) $f$,
           v_variante, v_disponible + 50),
    'Pedir más unidades de las disponibles');
  reset role;

  perform pruebas_debe_fallar(
    $f$ select crear_pedido('Sin Nombre','','TIENDA40',
          jsonb_build_array(jsonb_build_object('variante_id',gen_random_uuid(),'cantidad',1))) $f$,
    'Pedido sin teléfono válido');

  perform pruebas_debe_fallar(
    $f$ select crear_pedido('Carrito Vacío','987654321','TIENDA40','[]'::jsonb) $f$,
    'Pedido con carrito vacío');

  perform pruebas_debe_fallar(
    format($f$ select crear_pedido('Negativo','987654321','TIENDA40',
             jsonb_build_array(jsonb_build_object('variante_id','%s','cantidad',-5))) $f$, v_variante),
    'Pedido con cantidad negativa');
end $$;

\echo ''
\echo '════════ 4. PERMISOS: el panel está protegido ════════'

do $$
declare v_pedido_id uuid;
begin
  select id into v_pedido_id from pedidos where codigo = (select codigo from t_pedido);

  -- Visitante anónimo
  set local role anon;
  perform set_config('pruebas.usuario_id', '', true);
  perform pruebas_debe_fallar(
    format('select confirmar_pago(''%s'')', v_pedido_id),
    'Un visitante anónimo confirma un pago');
  perform pruebas_debe_fallar(
    'select kpis_resumen(30)',
    'Un visitante anónimo consulta los indicadores');
  perform pruebas_debe_fallar(
    'select * from pedidos',
    'Un visitante anónimo lee la tabla de pedidos');
  reset role;

  -- Vendedor: puede operar, pero no ajustar inventario
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'abu@prueba.pe'), true);
  perform pruebas_afirmar(es_equipo(), 'El vendedor es reconocido como equipo');
  perform pruebas_afirmar(not es_admin(), 'El vendedor NO es administrador');

  perform pruebas_debe_fallar(
    format($f$ select ajustar_stock('%s','TIENDA40',99,'intento') $f$,
           (select variante from t_pedido)),
    'Un vendedor ajusta inventario a mano (sólo administración)');
end $$;

\echo ''
\echo '════════ 5. CONFIRMACIÓN DE PAGO: descuenta UNA sola vez ════════'

do $$
declare
  v_pedido_id uuid; v_variante uuid;
  v_antes_cant int; v_antes_res int;
  v_post_cant int; v_post_res int;
  v_movs int;
begin
  select id into v_pedido_id from pedidos where codigo = (select codigo from t_pedido);
  select variante into v_variante from t_pedido;

  select cantidad, reservado into v_antes_cant, v_antes_res
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'cecilia@prueba.pe'), true);

  perform confirmar_pago(v_pedido_id, 'Yape 0012345');

  select cantidad, reservado into v_post_cant, v_post_res
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  perform pruebas_afirmar(v_post_cant = v_antes_cant - 3,
    'Al verificar el pago se descuentan las 3 unidades del stock físico');
  perform pruebas_afirmar(v_post_res = v_antes_res - 3,
    'La reserva se libera al convertirse en venta');
  perform pruebas_afirmar(
    (select estado from pedidos where id = v_pedido_id) = 'listo_recojo',
    'El pedido pasa a "listo para recojo"');

  -- Segundo clic en el mismo botón: debe rebotar.
  perform pruebas_debe_fallar(
    format('select confirmar_pago(''%s'')', v_pedido_id),
    'Confirmar el pago por segunda vez (descuento duplicado)');

  select count(*) into v_movs from movimientos_inventario
  where referencia_id = v_pedido_id and tipo = 'venta_online';
  perform pruebas_afirmar(v_movs = 1,
    'La bitácora registra exactamente 1 movimiento de venta para ese pedido');

  select cantidad into v_post_cant
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';
  perform pruebas_afirmar(v_post_cant = v_antes_cant - 3,
    'Tras el intento duplicado, el stock sigue descontado una sola vez');
end $$;

\echo ''
\echo '════════ 6. RECOJO ════════'

do $$
declare v_pedido_id uuid;
begin
  select id into v_pedido_id from pedidos where codigo = (select codigo from t_pedido);
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'abu@prueba.pe'), true);

  perform registrar_recojo(v_pedido_id);
  perform pruebas_afirmar(
    (select estado from pedidos where id = v_pedido_id) = 'entregado',
    'El vendedor registra el recojo y el pedido queda entregado');

  perform pruebas_debe_fallar(
    format('select registrar_recojo(''%s'')', v_pedido_id),
    'Registrar el recojo dos veces');
  perform pruebas_debe_fallar(
    format('select cancelar_pedido(''%s'',''tarde'')', v_pedido_id),
    'Cancelar un pedido ya entregado');
end $$;

\echo ''
\echo '════════ 7. CANCELACIÓN: libera la reserva ════════'

do $$
declare
  v_variante uuid; v_pedido_id uuid; v_res_antes int; v_res_post int;
  v_cant_antes int; v_cant_post int; v_r jsonb;
begin
  select variante into v_variante from t_pedido;

  select cantidad, reservado into v_cant_antes, v_res_antes
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  set local role anon;
  v_r := crear_pedido('Se Arrepintió', '955443322', 'TIENDA40',
         jsonb_build_array(jsonb_build_object('variante_id', v_variante, 'cantidad', 2)));
  reset role;

  select reservado into v_res_post
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';
  perform pruebas_afirmar(v_res_post = v_res_antes + 2, 'El nuevo pedido reserva 2 unidades');

  select id into v_pedido_id from pedidos where codigo = v_r ->> 'codigo';
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'cecilia@prueba.pe'), true);
  perform cancelar_pedido(v_pedido_id, 'El cliente ya no lo quiere');

  select cantidad, reservado into v_cant_post, v_res_post
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  perform pruebas_afirmar(v_res_post = v_res_antes,
    'Cancelar un pedido no pagado devuelve la reserva');
  perform pruebas_afirmar(v_cant_post = v_cant_antes,
    'Cancelar un pedido no pagado no toca el stock físico');
end $$;

do $$
declare v_variante uuid; v_pedido_id uuid; v_cant_antes int; v_cant_post int; v_r jsonb;
begin
  select variante into v_variante from t_pedido;
  select cantidad into v_cant_antes
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  set local role anon;
  v_r := crear_pedido('Pagó y se arrepintió', '955000111', 'TIENDA40',
         jsonb_build_array(jsonb_build_object('variante_id', v_variante, 'cantidad', 2)));
  reset role;

  select id into v_pedido_id from pedidos where codigo = v_r ->> 'codigo';
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'cecilia@prueba.pe'), true);

  perform confirmar_pago(v_pedido_id, 'Yape 999');
  perform cancelar_pedido(v_pedido_id, 'Devolución del dinero');

  select cantidad into v_cant_post
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  perform pruebas_afirmar(v_cant_post = v_cant_antes,
    'Cancelar un pedido YA pagado repone el stock que había salido');
end $$;

\echo ''
\echo '════════ 8. INVENTARIO: ventas, devoluciones, ajustes, traslados ════════'

do $$
declare
  v_variante uuid; v_cant int; v_nuevo int;
  v_tienda int; v_almacen int; v_total_antes int; v_total_post int;
begin
  select variante into v_variante from t_pedido;
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'abu@prueba.pe'), true);

  -- Venta presencial: descuenta en el acto, sin reserva previa.
  select cantidad into v_cant
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';

  perform registrar_venta_fisica('TIENDA40',
    jsonb_build_array(jsonb_build_object('variante_id', v_variante, 'cantidad', 1)),
    'efectivo', 'Venta de mostrador');

  select cantidad into v_nuevo
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';
  perform pruebas_afirmar(v_nuevo = v_cant - 1, 'La venta presencial descuenta stock de inmediato');

  -- Devolución
  perform registrar_devolucion('TIENDA40',
    jsonb_build_array(jsonb_build_object('variante_id', v_variante, 'cantidad', 1)),
    'Producto con falla');
  select cantidad into v_nuevo
  from inventario i join ubicaciones u on u.id = i.ubicacion_id
  where i.variante_id = v_variante and u.codigo = 'TIENDA40';
  perform pruebas_afirmar(v_nuevo = v_cant, 'La devolución repone el stock');

  perform pruebas_debe_fallar(
    format($f$ select registrar_devolucion('TIENDA40',
             jsonb_build_array(jsonb_build_object('variante_id','%s','cantidad',1)), '') $f$, v_variante),
    'Devolución sin motivo registrado');

  -- Traslado almacén → tienda: el total no puede cambiar
  select cantidad into v_tienda from inventario i join ubicaciones u on u.id=i.ubicacion_id
   where i.variante_id = v_variante and u.codigo='TIENDA40';
  select cantidad into v_almacen from inventario i join ubicaciones u on u.id=i.ubicacion_id
   where i.variante_id = v_variante and u.codigo='ALMACEN';
  v_total_antes := v_tienda + v_almacen;

  perform trasladar_stock(v_variante, 'ALMACEN', 'TIENDA40', 3, 'Reposición de vitrina');

  select cantidad into v_tienda from inventario i join ubicaciones u on u.id=i.ubicacion_id
   where i.variante_id = v_variante and u.codigo='TIENDA40';
  select cantidad into v_almacen from inventario i join ubicaciones u on u.id=i.ubicacion_id
   where i.variante_id = v_variante and u.codigo='ALMACEN';
  v_total_post := v_tienda + v_almacen;

  perform pruebas_afirmar(v_total_post = v_total_antes,
    'El traslado mueve unidades sin crearlas ni destruirlas ('||v_total_antes||' antes y después)');

  perform pruebas_debe_fallar(
    format($f$ select trasladar_stock('%s','ALMACEN','ALMACEN',1) $f$, v_variante),
    'Traslado al mismo lugar de origen');
  perform pruebas_debe_fallar(
    format($f$ select trasladar_stock('%s','ALMACEN','TIENDA40',99999) $f$, v_variante),
    'Traslado de más unidades de las que hay');
end $$;

do $$
declare v_variante uuid; v_cant int;
begin
  select variante into v_variante from t_pedido;

  -- Stock negativo: imposible por diseño.
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'abu@prueba.pe'), true);
  select cantidad into v_cant from inventario i join ubicaciones u on u.id=i.ubicacion_id
   where i.variante_id = v_variante and u.codigo='TIENDA40';

  perform pruebas_debe_fallar(
    format($f$ select registrar_venta_fisica('TIENDA40',
             jsonb_build_array(jsonb_build_object('variante_id','%s','cantidad',%s))) $f$,
           v_variante, v_cant + 10),
    'Vender más unidades de las que existen (stock negativo)');

  perform pruebas_afirmar(
    (select count(*) from inventario where cantidad < 0) = 0,
    'No existe ni una sola fila de inventario con stock negativo');
  perform pruebas_afirmar(
    (select count(*) from inventario where reservado > cantidad) = 0,
    'Nunca hay más unidades reservadas que unidades existentes');

  -- Ajuste por conteo físico: sólo administración.
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'cecilia@prueba.pe'), true);
  perform ajustar_stock(v_variante, 'TIENDA40', 7, 'Conteo físico del lunes');
  select cantidad into v_cant from inventario i join ubicaciones u on u.id=i.ubicacion_id
   where i.variante_id = v_variante and u.codigo='TIENDA40';
  perform pruebas_afirmar(v_cant = 7, 'La administración ajusta el stock al conteo real');

  perform pruebas_debe_fallar(
    format($f$ select ajustar_stock('%s','TIENDA40',5,'') $f$, v_variante),
    'Ajuste sin motivo');
  perform pruebas_debe_fallar(
    format($f$ select ajustar_stock('%s','TIENDA40',-3,'negativo') $f$, v_variante),
    'Ajuste a una cantidad negativa');
end $$;

\echo ''
\echo '════════ 9. IMPORTACIÓN POR CSV CON REVISIÓN ════════'

do $$
declare
  v_imp uuid; v_resultado jsonb; v_productos_antes int; v_productos_post int;
begin
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'cecilia@prueba.pe'), true);
  select count(*) into v_productos_antes from productos;

  insert into importaciones (nombre_archivo, usuario_id, total_filas, analizado_por)
  values ('prueba.csv', auth.uid(), 3, 'heuristica-local')
  returning id into v_imp;

  -- Dos filas aprobadas y una que la persona decidió omitir.
  insert into importacion_filas (importacion_id, fila_num, datos, categoria_sugerida, decision) values
    (v_imp, 1, '{"sku":"RCC-TEST-01","nombre":"Michi de prueba","precio":"25.00","stock":"10","ubicacion":"ALMACEN"}'::jsonb, 'Stickers', 'crear'),
    (v_imp, 2, '{"sku":"RCC-TEST-02","nombre":"Otro michi","precio":"30.00","stock":"5","ubicacion":"ALMACEN"}'::jsonb, 'Stickers', 'crear'),
    (v_imp, 3, '{"sku":"RCC-TEST-03","nombre":"Duplicado","precio":"30.00","stock":"5"}'::jsonb, 'Stickers', 'omitir');

  v_resultado := aplicar_importacion(v_imp);

  select count(*) into v_productos_post from productos;
  perform pruebas_afirmar((v_resultado ->> 'creadas')::int = 2,
    'Se crean sólo las 2 filas aprobadas por una persona');
  perform pruebas_afirmar(v_productos_post = v_productos_antes + 2,
    'El catálogo crece exactamente en 2 productos');
  perform pruebas_afirmar(
    (select count(*) from productos where sku_base = 'RCC-TEST-03') = 0,
    'La fila marcada como "omitir" NO entra al catálogo');

  perform pruebas_afirmar(
    (select cantidad from inventario i
      join variantes v on v.id = i.variante_id
      join ubicaciones u on u.id = i.ubicacion_id
     where v.sku = 'RCC-TEST-01' and u.codigo = 'ALMACEN') = 10,
    'El stock inicial importado queda cargado en el almacén');

  perform pruebas_afirmar(
    (select count(*) from movimientos_inventario
      where referencia_tipo = 'importacion' and referencia_id = v_imp) = 2,
    'El stock importado deja rastro en la bitácora');

  perform pruebas_debe_fallar(
    format('select aplicar_importacion(''%s'')', v_imp),
    'Aplicar dos veces la misma importación (catálogo duplicado)');
end $$;

do $$
declare v_dup jsonb;
begin
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'cecilia@prueba.pe'), true);
  v_dup := buscar_similares('Lamina Roncito CEO', 0.3);
  perform pruebas_afirmar(jsonb_array_length(v_dup) > 0,
    'La detección de duplicados encuentra parecidos sin necesitar IA ('||
     jsonb_array_length(v_dup)||' coincidencias)');
end $$;

\echo ''
\echo '════════ 10. CONSULTA DEL CLIENTE ════════'

do $$
declare v_r jsonb; v_codigo text;
begin
  -- Leemos el código antes de cambiar de rol: como visitante anónimo
  -- no hay permiso sobre la tabla temporal de la prueba.
  select codigo into v_codigo from t_pedido;

  set local role anon;
  perform set_config('pruebas.usuario_id', '', true);

  v_r := consultar_pedido(v_codigo, '987654321');
  perform pruebas_afirmar(v_r ->> 'codigo' = v_codigo,
    'El cliente consulta su pedido con código + teléfono');

  perform pruebas_debe_fallar(
    format($f$ select consultar_pedido('%s','000000000') $f$, v_codigo),
    'Consultar el pedido de otra persona con el teléfono equivocado');
  reset role;
end $$;

\echo ''
\echo '════════ 11. ANALÍTICA ════════'

do $$
declare
  v_k jsonb; v_online int; v_fisicas int; v_esperado int;
begin
  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'cecilia@prueba.pe'), true);
  v_k := kpis_resumen(30);

  -- Recalculamos a mano y comparamos: los indicadores salen de SQL,
  -- no de una estimación.
  select coalesce(sum(total_centimos),0) into v_online from pedidos
   where estado in ('listo_recojo','entregado') and pagado_en >= now() - interval '30 days';
  select coalesce(sum(total_centimos),0) into v_fisicas from ventas
   where creado_en >= now() - interval '30 days';
  v_esperado := v_online + v_fisicas;

  perform pruebas_afirmar(
    (v_k ->> 'ventas_totales_centimos')::int = v_esperado,
    'Las ventas del tablero coinciden con el cálculo manual (S/ '||
      round(v_esperado/100.0,2)||')');

  perform pruebas_afirmar(
    (v_k -> 'inventario' ->> 'unidades_en_stock')::int =
      (select sum(cantidad) from inventario),
    'Las unidades en stock del tablero coinciden con el inventario real');

  perform pruebas_afirmar(
    jsonb_array_length(v_k -> 'ventas_por_dia') > 0,
    'El tablero entrega la serie de ventas por día');
  perform pruebas_afirmar(
    (v_k -> 'pedidos' ->> 'por_verificar')::int =
      (select count(*) from pedidos where estado = 'pendiente_pago'),
    'El tablero cuenta bien los pedidos por verificar');
  perform pruebas_afirmar(
    (v_k ->> 'ticket_promedio_centimos')::int >= 0,
    'El ticket promedio se calcula sin dividir entre cero');

  perform pruebas_afirmar(
    jsonb_array_length(movimientos_recientes(10)) > 0,
    'La bitácora de movimientos recientes responde');
end $$;

\echo ''
\echo '════════ 12. RESERVAS VENCIDAS ════════'

do $$
declare v_variante uuid; v_r jsonb; v_pedido_id uuid; v_res_antes int; v_res_post int;
begin
  select variante into v_variante from t_pedido;
  select reservado into v_res_antes from inventario i join ubicaciones u on u.id=i.ubicacion_id
   where i.variante_id = v_variante and u.codigo='TIENDA40';

  set local role anon;
  v_r := crear_pedido('Fantasma', '900111222', 'TIENDA40',
         jsonb_build_array(jsonb_build_object('variante_id', v_variante, 'cantidad', 1)));
  reset role;

  select id into v_pedido_id from pedidos where codigo = v_r ->> 'codigo';
  -- Simulamos que pasaron los 2 días sin verificar el pago.
  update pedidos set expira_en = now() - interval '1 hour' where id = v_pedido_id;

  perform set_config('pruebas.usuario_id', (select id::text from auth.users where email = 'cecilia@prueba.pe'), true);
  perform liberar_reservas_vencidas();

  select reservado into v_res_post from inventario i join ubicaciones u on u.id=i.ubicacion_id
   where i.variante_id = v_variante and u.codigo='TIENDA40';

  perform pruebas_afirmar(
    (select estado from pedidos where id = v_pedido_id) = 'cancelado',
    'Un pedido sin pago verificado se cancela al vencer');
  perform pruebas_afirmar(v_res_post = v_res_antes,
    'La reserva vencida se libera y el stock vuelve a ser vendible');
end $$;

\echo ''
\echo '╔══════════════════════════════════════════════════════╗'
\echo '║  ✓ TODAS LAS PRUEBAS PASARON                         ║'
\echo '║    Roncito aprueba. Puedes desplegar.                ║'
\echo '╚══════════════════════════════════════════════════════╝'
