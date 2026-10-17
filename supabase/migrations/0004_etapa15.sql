-- AVISPATE · Etapa 15 — cuentas y vínculo del dispositivo.
--
-- Se corre DESPUÉS de 0003_etapa14.sql, en el SQL Editor de Supabase o con
--   npx supabase db query --linked --file supabase/migrations/0004_etapa15.sql
-- Es idempotente: se puede volver a correr sin duplicar nada.
--
-- Qué agrega (primera entrega de la Etapa 15):
--
--   1. `perfiles_cuenta`: una fila por persona, colgada de `auth.users`. El nombre es solo para
--      mostrar; la identidad de verdad es el id de Supabase Auth.
--   2. `dispositivos_cuenta`: qué teléfonos pertenecen a qué cuenta, con la fecha del vínculo y la
--      última conexión. El alta la hace `reclamar_dispositivo`, que exige sesión y el token del
--      dispositivo.
--   3. RLS por usuario: cada persona ve su perfil y sus dispositivos, y nada más. Las tablas quedan
--      sin políticas de escritura: se escribe solo por las funciones de abajo.
--   4. `reclamar_dispositivo`, `desvincular_dispositivo` y `mis_dispositivos`, las tres para
--      `authenticated` (nunca para `anon`).
--
-- Lo que todavía NO hace: los recordatorios, las categorías y los adjuntos siguen viviendo solo en el
-- teléfono. El esquema por entidad, el motor de sincronización y las tumbas son las fases siguientes
-- (ver docs/etapa15-cuenta-y-sincronizacion.md). Esta migración deja la identidad y el vínculo listos
-- para que esas fases tengan a quién pertenecer.

-- ---------------------------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------------------------
create table if not exists public.perfiles_cuenta (
  -- El mismo id de `auth.users`: una cuenta, un perfil. Al borrar la cuenta, se va el perfil.
  user_id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.dispositivos_cuenta (
  user_id uuid not null references auth.users (id) on delete cascade,
  dispositivo_id uuid not null references public.dispositivos (id) on delete cascade,
  reclamado_en timestamptz not null default now(),
  ultima_conexion timestamptz not null default now(),
  -- Una cuenta puede tener varios teléfonos y un teléfono puede usarse con más de una cuenta
  -- (una computadora compartida, por ejemplo). Lo que no puede es repetir el mismo par.
  primary key (user_id, dispositivo_id)
);

-- La lista de dispositivos se pide por cuenta; este índice mantiene esa consulta chica.
create index if not exists dispositivos_cuenta_dispositivo_idx
  on public.dispositivos_cuenta (dispositivo_id);

-- ---------------------------------------------------------------------------------------------
-- 2. RLS: cada uno ve lo suyo y nada más
-- ---------------------------------------------------------------------------------------------
alter table public.perfiles_cuenta enable row level security;
alter table public.dispositivos_cuenta enable row level security;

-- Sin escritura directa: el alta y la baja pasan por las funciones, que comprueban el dispositivo.
revoke all on public.perfiles_cuenta from anon, authenticated;
revoke all on public.dispositivos_cuenta from anon, authenticated;
grant select on public.perfiles_cuenta to authenticated;
grant select on public.dispositivos_cuenta to authenticated;

drop policy if exists "cada uno ve su perfil" on public.perfiles_cuenta;
create policy "cada uno ve su perfil"
  on public.perfiles_cuenta
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "cada uno ve sus dispositivos" on public.dispositivos_cuenta;
create policy "cada uno ve sus dispositivos"
  on public.dispositivos_cuenta
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------------
-- 3. Perfil automático al crear la cuenta
--    Supabase Auth crea la fila en `auth.users`; este disparador crea la fila de `perfiles_cuenta`
--    para que ninguna cuenta quede sin perfil. El nombre sale de `nombre` en los metadatos o del
--    correo, nunca de un dato que mande el navegador sin pasar por Auth.
-- ---------------------------------------------------------------------------------------------
create or replace function public.crear_perfil_cuenta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.perfiles_cuenta (user_id, nombre)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'nombre', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Tu cuenta'
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists crear_perfil_cuenta on auth.users;
create trigger crear_perfil_cuenta
  after insert on auth.users
  for each row execute function public.crear_perfil_cuenta();

-- Las cuentas que ya existían (por ejemplo, de una prueba anterior) también tienen perfil.
insert into public.perfiles_cuenta (user_id, nombre)
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data ->> 'nombre', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Tu cuenta'
  )
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 4. Funciones de la cuenta. Las tres exigen sesión (`auth.uid()`); la de alta también exige el
--    token del dispositivo, para que nadie pueda reclamar un teléfono ajeno con solo conocer su id.
-- ---------------------------------------------------------------------------------------------
create or replace function public.reclamar_dispositivo(
  p_dispositivo uuid,
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if v_usuario is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  if p_dispositivo is null or not exists (
    select 1 from public.dispositivos d
     where d.id = p_dispositivo and d.token = p_token
  ) then
    raise exception 'token incorrecto' using errcode = '42501';
  end if;

  insert into public.dispositivos_cuenta (
    user_id, dispositivo_id, reclamado_en, ultima_conexion
  )
  values (v_usuario, p_dispositivo, now(), now())
  on conflict (user_id, dispositivo_id) do update
    set ultima_conexion = now();

  return jsonb_build_object('ok', true, 'dispositivo', p_dispositivo);
end;
$$;

create or replace function public.desvincular_dispositivo(
  p_dispositivo uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if v_usuario is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  -- Solo borra el vínculo de quien llama: el `user_id` sale de la sesión, nunca de un parámetro.
  delete from public.dispositivos_cuenta dc
   where dc.user_id = v_usuario
     and dc.dispositivo_id = p_dispositivo;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mis_dispositivos()
returns table (
  dispositivo_id uuid,
  nombre text,
  reclamado_en timestamptz,
  ultima_conexion timestamptz
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    dc.dispositivo_id,
    coalesce(d.nombre, 'Este dispositivo') as nombre,
    dc.reclamado_en,
    dc.ultima_conexion
  from public.dispositivos_cuenta dc
  join public.dispositivos d on d.id = dc.dispositivo_id
  where dc.user_id = auth.uid()
  order by dc.ultima_conexion desc;
$$;

-- `anon` no puede ni intentarlo: sin sesión no hay `auth.uid()` y estas funciones no tienen sentido
-- para el modo invitado. `authenticated` es el rol que Supabase le da a una sesión con JWT.
revoke all on function public.reclamar_dispositivo(uuid, text) from public, anon;
revoke all on function public.desvincular_dispositivo(uuid) from public, anon;
revoke all on function public.mis_dispositivos() from public, anon;

grant execute on function public.reclamar_dispositivo(uuid, text) to authenticated;
grant execute on function public.desvincular_dispositivo(uuid) to authenticated;
grant execute on function public.mis_dispositivos() to authenticated;

-- Comprobación rápida después de correr esto (deberían salir las tres, más las de las etapas
-- anteriores):
--   select proname, proacl from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('reclamar_dispositivo', 'desvincular_dispositivo', 'mis_dispositivos');
--
-- Y las políticas:
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename like '%cuenta%';

