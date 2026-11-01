-- AVISPATE · Etapa 16 — calendarios de ida y vuelta (esqueleto con Google + simulado).
--
-- Se corre DESPUÉS de 0008_etapa15_realtime.sql, en el SQL Editor de Supabase o con
--   npx supabase db query --linked --file supabase/migrations/0009_etapa16_calendarios.sql
-- Es idempotente: se puede volver a correr sin duplicar nada.
--
-- Qué agrega:
--
--   1. `calendarios_cuenta`: la conexión de cada usuario con Google (o el adaptador simulado),
--      incluidos los tokens cifrados. El navegador no tiene privilegios sobre esta tabla.
--   2. `eventos_calendario`: el enlace estable entre un recordatorio local y su evento externo.
--      Evita duplicados y permite borrar lo que ya no está en la foto completa.
--   3. `oauth_estado`: state + PKCE de un solo uso, con vencimiento a 10 minutos.
--   4. `mis_calendarios()`: la única lectura del navegador, sin tokens.
--   5. `completar_oauth()`: canje atómico del state por una conexión. Solo `service_role`.
--
-- Los tokens se guardan cifrados con AES-GCM desde la Edge Function. Esta migración no conoce la
-- clave: si el modo real no tiene `CALENDARIOS_TOKEN_KEY`, la función se niega a guardar secretos.
-- En modo simulado no hay tokens y la fila queda con `modo = 'simulado'`.

-- ---------------------------------------------------------------------------------------------
-- 1. Conexiones por usuario
-- ---------------------------------------------------------------------------------------------
create table if not exists public.calendarios_cuenta (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Perfil local de AVISPATE (Yo, Abuela, Empresa…). La misma cuenta de Supabase puede tener
  -- varios perfiles, y cada uno conecta su propio Google.
  perfil_id text not null default 'yo',
  proveedor text not null,
  cuenta_email text,
  calendario_externo text not null default 'primary',
  nombre text,
  activo boolean not null default true,
  modo text not null default 'oauth',
  token_acceso_cifrado text,
  token_renovacion_cifrado text,
  -- Cada token se cifra con su propio IV aleatorio: no se reutiliza el de acceso para el refresh.
  token_iv text,
  token_renovacion_iv text,
  token_expira_en timestamptz,
  scope text,
  cursor_sync text,
  ultima_sincronizacion timestamptz,
  ultimo_error text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint calendarios_cuenta_proveedor_valido
    check (proveedor in ('google', 'outlook', 'apple')),
  constraint calendarios_cuenta_modo_valido
    check (modo in ('oauth', 'simulado')),
  constraint calendarios_cuenta_email_largo
    check (cuenta_email is null or char_length(cuenta_email) <= 320),
  constraint calendarios_cuenta_externo_largo
    check (char_length(calendario_externo) between 1 and 200),
  constraint calendarios_cuenta_nombre_largo
    check (nombre is null or char_length(nombre) <= 120),
  constraint calendarios_cuenta_perfil_largo
    check (char_length(perfil_id) between 1 and 120),
  -- Dentro de un perfil puede haber varios calendarios del mismo proveedor, pero no el mismo dos
  -- veces; dos perfiles distintos sí pueden conectar cada uno su Google.
  constraint calendarios_cuenta_unico
    unique (user_id, perfil_id, proveedor, calendario_externo),
  -- Permite que `eventos_calendario` compruebe el dueño con una clave foránea compuesta.
  constraint calendarios_cuenta_id_user_unico
    unique (id, user_id)
);

-- Por si la tabla ya existía de una versión anterior del esqueleto sin el IV del refresh o sin el
-- perfil local. No cambia datos: las filas viejas quedan en el perfil «yo».
alter table public.calendarios_cuenta
  add column if not exists perfil_id text not null default 'yo';
alter table public.calendarios_cuenta
  add column if not exists token_renovacion_iv text;

create index if not exists calendarios_cuenta_user_idx
  on public.calendarios_cuenta (user_id, perfil_id, activo);

-- ---------------------------------------------------------------------------------------------
-- 2. Enlaces recordatorio ↔ evento externo
-- ---------------------------------------------------------------------------------------------
create table if not exists public.eventos_calendario (
  calendario_id uuid not null,
  user_id uuid not null,
  recordatorio_id text not null,
  evento_externo_id text,
  etag text,
  estado text not null default 'pendiente',
  payload jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  sincronizado_en timestamptz,
  ultimo_error text,
  primary key (calendario_id, recordatorio_id),
  constraint eventos_calendario_estado_valido
    check (estado in ('pendiente', 'sincronizado', 'error', 'borrado')),
  constraint eventos_calendario_recordatorio_largo
    check (char_length(recordatorio_id) between 1 and 200),
  constraint eventos_calendario_externo_largo
    check (evento_externo_id is null or char_length(evento_externo_id) <= 1024),
  -- El calendario y el usuario tienen que ser el mismo par: no se puede colgar un evento del
  -- calendario de otra cuenta ni cambiando el `user_id` a mano.
  constraint eventos_calendario_calendario_fk
    foreign key (calendario_id, user_id)
    references public.calendarios_cuenta (id, user_id)
    on delete cascade
);

create index if not exists eventos_calendario_user_idx
  on public.eventos_calendario (user_id, estado);

-- ---------------------------------------------------------------------------------------------
-- 3. State + PKCE de un solo uso
-- ---------------------------------------------------------------------------------------------
create table if not exists public.oauth_estado (
  estado text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  perfil_id text not null default 'yo',
  proveedor text not null,
  code_verifier text not null,
  redirect_uri text not null,
  origen text not null,
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null,
  constraint oauth_estado_proveedor_valido
    check (proveedor in ('google', 'outlook', 'apple')),
  constraint oauth_estado_perfil_largo
    check (char_length(perfil_id) between 1 and 120),
  constraint oauth_estado_estado_largo
    check (char_length(estado) between 32 and 200)
);

alter table public.oauth_estado
  add column if not exists perfil_id text not null default 'yo';

create index if not exists oauth_estado_vencimiento_idx
  on public.oauth_estado (expira_en);

-- ---------------------------------------------------------------------------------------------
-- 4. RLS y privilegios: el navegador no lee tokens ni escribe conexiones
-- ---------------------------------------------------------------------------------------------
alter table public.calendarios_cuenta enable row level security;
alter table public.eventos_calendario enable row level security;
alter table public.oauth_estado enable row level security;

-- Sin `select` ni escritura directa. `service_role` no necesita estos grants porque salta RLS y
-- conserva sus privilegios de superusuario del proyecto. La app lee con `mis_calendarios()`.
revoke all on public.calendarios_cuenta from public, anon, authenticated;
revoke all on public.eventos_calendario from public, anon, authenticated;
revoke all on public.oauth_estado from public, anon, authenticated;

-- Política de defensa en profundidad: aunque mañana alguien conceda `select`, cada fila solo se ve
-- si es de `auth.uid()`. No hay políticas de escritura.
drop policy if exists "cada uno ve sus calendarios" on public.calendarios_cuenta;
create policy "cada uno ve sus calendarios"
  on public.calendarios_cuenta
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "cada uno ve sus enlaces de calendario" on public.eventos_calendario;
create policy "cada uno ve sus enlaces de calendario"
  on public.eventos_calendario
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- `oauth_estado` no tiene políticas: es material efímero del servidor.

-- ---------------------------------------------------------------------------------------------
-- 5. Lo que ve el navegador: estado del calendario, nunca tokens
-- ---------------------------------------------------------------------------------------------
drop function if exists public.mis_calendarios();

create or replace function public.mis_calendarios()
returns table (
  id uuid,
  perfil_id text,
  proveedor text,
  cuenta_email text,
  calendario_externo text,
  nombre text,
  activo boolean,
  modo text,
  ultima_sincronizacion timestamptz,
  ultimo_error text,
  creado_en timestamptz
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    c.id,
    c.perfil_id,
    c.proveedor,
    c.cuenta_email,
    c.calendario_externo,
    c.nombre,
    c.activo,
    c.modo,
    c.ultima_sincronizacion,
    c.ultimo_error,
    c.creado_en
  from public.calendarios_cuenta c
  where c.user_id = auth.uid()
  order by c.proveedor, c.creado_en;
$$;

revoke all on function public.mis_calendarios() from public, anon;
grant execute on function public.mis_calendarios() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Canje atómico del state por la conexión. Solo `service_role`.
-- ---------------------------------------------------------------------------------------------
-- La Edge Function ya cambió el código por los tokens. Esta función:
--   * borra el state (un solo uso, aunque el insert falle después);
--   * comprueba que el proveedor coincida;
--   * guarda o actualiza la conexión sin devolver nunca los tokens.
-- El refresh token puede venir vacío en una reconexión: en ese caso se conserva el anterior.
-- El `drop` permite volver a correr la migración si una versión anterior ya había creado la función
-- con menos parámetros (Postgres no cambia la firma con `create or replace`).
drop function if exists public.completar_oauth(
  text, text, text, text, text, text, text, text, timestamptz, text, text
);
drop function if exists public.completar_oauth(
  text, text, text, text, text, text, text, text, text, timestamptz, text, text
);
drop function if exists public.completar_oauth(
  text, text, text, text, text, text, text, text, text, text, timestamptz, text, text
);

create or replace function public.completar_oauth(
  p_estado text,
  p_proveedor text,
  p_cuenta_email text,
  p_calendario_externo text,
  p_nombre text,
  p_token_acceso_cifrado text,
  p_token_renovacion_cifrado text,
  p_token_iv text,
  p_token_renovacion_iv text,
  p_token_expira_en timestamptz,
  p_scope text,
  p_modo text default 'oauth'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid;
  v_proveedor text;
  v_calendario public.calendarios_cuenta%rowtype;
  v_modo text := coalesce(nullif(p_modo, ''), 'oauth');
  v_perfil text;
begin
  if p_estado is null or btrim(p_estado) = '' then
    raise exception 'state inválido' using errcode = '22023';
  end if;

  if v_modo not in ('oauth', 'simulado') then
    raise exception 'modo inválido' using errcode = '22023';
  end if;

  delete from public.oauth_estado o
   where o.estado = p_estado
     and o.expira_en > now()
  returning o.user_id, o.perfil_id, o.proveedor
    into v_usuario, v_perfil, v_proveedor;

  if v_usuario is null then
    raise exception 'state inválido o vencido' using errcode = '22023';
  end if;

  if v_proveedor <> p_proveedor then
    raise exception 'el state no corresponde al proveedor' using errcode = '22023';
  end if;

  if v_perfil is null or char_length(v_perfil) > 120 then
    raise exception 'perfil inválido' using errcode = '22023';
  end if;

  if v_modo = 'oauth'
     and (
       p_token_acceso_cifrado is null
       or p_token_iv is null
       or (p_token_renovacion_cifrado is not null and p_token_renovacion_iv is null)
     ) then
    raise exception 'faltan los tokens cifrados' using errcode = '22023';
  end if;

  insert into public.calendarios_cuenta (
    user_id, perfil_id, proveedor, cuenta_email, calendario_externo, nombre, activo, modo,
    token_acceso_cifrado, token_renovacion_cifrado, token_iv, token_renovacion_iv,
    token_expira_en, scope, ultimo_error, actualizado_en
  )
  values (
    v_usuario,
    v_perfil,
    p_proveedor,
    nullif(btrim(coalesce(p_cuenta_email, '')), ''),
    coalesce(nullif(btrim(coalesce(p_calendario_externo, '')), ''), 'primary'),
    nullif(btrim(coalesce(p_nombre, '')), ''),
    true,
    v_modo,
    p_token_acceso_cifrado,
    p_token_renovacion_cifrado,
    p_token_iv,
    p_token_renovacion_iv,
    p_token_expira_en,
    nullif(btrim(coalesce(p_scope, '')), ''),
    null,
    now()
  )
  on conflict (user_id, perfil_id, proveedor, calendario_externo) do update
    set cuenta_email = excluded.cuenta_email,
        nombre = excluded.nombre,
        activo = true,
        modo = excluded.modo,
        token_acceso_cifrado = excluded.token_acceso_cifrado,
        -- Google solo manda refresh token la primera vez (o con prompt=consent). Si no vino,
        -- el que ya estaba sigue siendo válido.
        token_renovacion_cifrado = coalesce(
          excluded.token_renovacion_cifrado,
          public.calendarios_cuenta.token_renovacion_cifrado
        ),
        token_iv = excluded.token_iv,
        token_renovacion_iv = coalesce(
          excluded.token_renovacion_iv,
          public.calendarios_cuenta.token_renovacion_iv
        ),
        token_expira_en = excluded.token_expira_en,
        scope = excluded.scope,
        ultimo_error = null,
        actualizado_en = now()
  returning * into v_calendario;

  return jsonb_build_object(
    'ok', true,
    'calendario', jsonb_build_object(
      'id', v_calendario.id,
      'perfil_id', v_calendario.perfil_id,
      'proveedor', v_calendario.proveedor,
      'cuenta_email', v_calendario.cuenta_email,
      'calendario_externo', v_calendario.calendario_externo,
      'nombre', v_calendario.nombre,
      'activo', v_calendario.activo,
      'modo', v_calendario.modo,
      'ultima_sincronizacion', v_calendario.ultima_sincronizacion,
      'ultimo_error', v_calendario.ultimo_error,
      'creado_en', v_calendario.creado_en
    )
  );
end;
$$;

revoke all on function public.completar_oauth(
  text, text, text, text, text, text, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.completar_oauth(
  text, text, text, text, text, text, text, text, text, timestamptz, text, text
) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 7. Limpieza de states vencidos (la llama el cron o una pasada de la función)
-- ---------------------------------------------------------------------------------------------
create or replace function public.purgar_oauth_estado()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer := 0;
begin
  delete from public.oauth_estado where expira_en <= now();
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke all on function public.purgar_oauth_estado() from public, anon, authenticated;
grant execute on function public.purgar_oauth_estado() to service_role;

-- Comprobación rápida después de correr esto:
--   select tablename from pg_tables
--    where schemaname = 'public'
--      and tablename in ('calendarios_cuenta','eventos_calendario','oauth_estado');
--   select proname from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('mis_calendarios','completar_oauth','purgar_oauth_estado');
--   select has_table_privilege('authenticated', 'public.calendarios_cuenta', 'select');
--     -- debe ser false: el navegador lee por mis_calendarios()

