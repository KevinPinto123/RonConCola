-- ============================================================
-- Sustituto local de lo que Supabase provee de fábrica.
--
-- SÓLO PARA PRUEBAS. En Supabase este esquema ya existe y este
-- archivo no se ejecuta nunca. Sirve para levantar un Postgres
-- limpio en Docker y comprobar que las migraciones y las reglas
-- de negocio funcionan de verdad antes de tocar producción.
-- ============================================================

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);

-- En Supabase, auth.uid() lee el JWT de la petición.
-- Aquí lo simulamos con una variable de sesión, para poder actuar
-- como visitante anónimo, como vendedor o como administradora.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('pruebas.usuario_id', true), '')::uuid;
$$;

-- Los roles que Supabase expone a través de PostgREST.
do $$ begin create role anon          nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin bypassrls; exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;
