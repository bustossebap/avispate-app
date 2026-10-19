-- AVISPATE · Etapa 15 — dispositivos y sesiones (fase 4).
--
-- Se corre DESPUÉS de 0005_etapa15_datos.sql, en el SQL Editor de Supabase o con
--   npx supabase db query --linked --file supabase/migrations/0006_etapa15_dispositivos.sql
-- Es idempotente: se puede volver a correr sin duplicar nada.
--
-- Qué agrega:
--
--   1. Un nombre propio por cuenta y teléfono (`dispositivos_cuenta.nombre`). Renombrar el teléfono
--      desde una cuenta no cambia el nombre que ve otra cuenta que use el mismo equipo.
--   2. `renombrar_dispositivo`: cambia ese nombre. Exige sesión y que el teléfono esté vinculado a
--      quien llama; nunca acepta un `user_id` como parámetro.
--   3. `desvincular_todos_dispositivos`: cierra la lista entera de esta cuenta. Es la base de
--      «Cerrar sesión en todos los teléfonos».
--   4. `mis_dispositivos` devuelve también el nombre propio. Se vuelve a crear porque cambia la
--      forma de la respuesta (Postgres no deja cambiarla con `create or replace`).
--
-- El cierre remoto de UN teléfono reutiliza `desvincular_dispositivo` de la 0004: al borrar el
-- vínculo, la siguiente pasada de ese equipo recibe «dispositivo no vinculado» y deja de subir y
-- bajar. No hace falta una tabla de revocados para eso: el vínculo ES el permiso.

-- ---------------------------------------------------------------------------------------------
-- 1. Nombre propio del teléfono dentro de la cuenta
-- ---------------------------------------------------------------------------------------------
alter table public.dispositivos_cuenta
  add column if not exists nombre text;

-- Regla de tamaño: el nombre es para reconocer el equipo en una lista, no un campo libre enorme.
-- Se usa un check suave (solo si no existe) para no romper filas antiguas con nombres largos.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.dispositivos_cuenta'::regclass
       and conname = 'dispositivos_cuenta_nombre_largo'
  ) then
    alter table public.dispositivos_cuenta
      add constraint dispositivos_cuenta_nombre_largo
      check (nombre is null or char_length(nombre) between 1 and 40);
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Renombrar este teléfono (o cualquier teléfono vinculado a la cuenta)
-- ---------------------------------------------------------------------------------------------
create or replace function public.renombrar_dispositivo(
  p_dispositivo uuid,
  p_nombre text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_nombre text := btrim(coalesce(p_nombre, ''));
begin
  if v_usuario is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  if v_nombre = '' or char_length(v_nombre) > 40 then
    raise exception 'nombre inválido' using errcode = '22023';
  end if;

  update public.dispositivos_cuenta dc
     set nombre = v_nombre
   where dc.user_id = v_usuario
     and dc.dispositivo_id = p_dispositivo;

  if not found then
    raise exception 'dispositivo no vinculado' using errcode = '42501';
  end if;

  return jsonb_build_object('ok', true, 'nombre', v_nombre);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Cerrar la sesión de todos los teléfonos de esta cuenta
-- ---------------------------------------------------------------------------------------------
create or replace function public.desvincular_todos_dispositivos()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_total integer := 0;
begin
  if v_usuario is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  delete from public.dispositivos_cuenta dc
   where dc.user_id = v_usuario;
  get diagnostics v_total = row_count;

  return jsonb_build_object('ok', true, 'desvinculados', v_total);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. La lista, ahora con el nombre propio
-- ---------------------------------------------------------------------------------------------
drop function if exists public.mis_dispositivos();

create function public.mis_dispositivos()
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
    coalesce(dc.nombre, d.nombre, 'Este dispositivo') as nombre,
    dc.reclamado_en,
    dc.ultima_conexion
  from public.dispositivos_cuenta dc
  join public.dispositivos d on d.id = dc.dispositivo_id
  where dc.user_id = auth.uid()
  order by dc.ultima_conexion desc;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Permisos: solo una sesión autenticada
-- ---------------------------------------------------------------------------------------------
revoke all on function public.renombrar_dispositivo(uuid, text) from public, anon;
revoke all on function public.desvincular_todos_dispositivos() from public, anon;
revoke all on function public.mis_dispositivos() from public, anon;

grant execute on function public.renombrar_dispositivo(uuid, text) to authenticated;
grant execute on function public.desvincular_todos_dispositivos() to authenticated;
grant execute on function public.mis_dispositivos() to authenticated;

-- Comprobación rápida después de correr esto:
--   select proname from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('renombrar_dispositivo', 'desvincular_todos_dispositivos', 'mis_dispositivos');
