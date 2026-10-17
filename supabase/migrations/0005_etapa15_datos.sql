-- AVISPATE · Etapa 15 — datos por entidad y motor de sincronización (fase 2).
--
-- Se corre DESPUÉS de 0004_etapa15.sql, en el SQL Editor de Supabase o con
--   npx supabase db query --linked --file supabase/migrations/0005_etapa15_datos.sql
-- Es idempotente: se puede volver a correr sin duplicar nada.
--
-- Qué agrega:
--
--   1. Una tabla por entidad —`recordatorios`, `categorias`, `perfiles`, `ajustes`, `marcas`— con la
--      misma forma: `(user_id, id)` como clave, el contenido en `payload`, y la metadata que el motor
--      necesita para resolver conflictos (`updated_at`, `deleted_at`, `revision`, `dispositivo_id`) y
--      para paginar (`seq`).
--   2. `tumbas`: el índice de borrados de los últimos 90 días, para que un teléfono que estuvo sin
--      red se entere de lo que se borró sin bajar la tabla entera.
--   3. RLS de solo lectura por usuario. La escritura directa queda revocada: todo pasa por
--      `subir_cambios`, que exige sesión (`auth.uid()`), el token del dispositivo y el vínculo.
--   4. `bajar_cambios`: la lectura paginada por `seq` que usa el cursor de cada teléfono.
--   5. `purgar_tumbas`: limpieza de los borrados viejos (90 días por defecto). No se expone al
--      navegador; la puede llamar el servicio o un cron.
--
-- Los ids son los que ya genera el teléfono: reclamar un dispositivo con datos no duplica nada, y una
-- copia de la Etapa 13/14 se puede subir tal cual porque el contenido viaja como JSON.

-- ---------------------------------------------------------------------------------------------
-- 1. Secuencia y tablas
-- ---------------------------------------------------------------------------------------------
-- Un solo contador para las cinco entidades: el cursor de bajada es un número y no una fecha, así
-- que dos cambios en el mismo milisegundo no se pisan ni se saltean.
create sequence if not exists public.sync_seq;

create table if not exists public.recordatorios (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  -- `updated_at` lo manda el teléfono que editó: es la hora del cambio, no la de llegada. `seq` es
  -- del servidor y solo sirve para el cursor.
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision integer not null default 1,
  dispositivo_id text,
  seq bigint not null default nextval('public.sync_seq'::regclass),
  primary key (user_id, id)
);

create table if not exists public.categorias (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision integer not null default 1,
  dispositivo_id text,
  seq bigint not null default nextval('public.sync_seq'::regclass),
  primary key (user_id, id)
);

create table if not exists public.perfiles (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision integer not null default 1,
  dispositivo_id text,
  seq bigint not null default nextval('public.sync_seq'::regclass),
  primary key (user_id, id)
);

create table if not exists public.ajustes (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision integer not null default 1,
  dispositivo_id text,
  seq bigint not null default nextval('public.sync_seq'::regclass),
  primary key (user_id, id)
);

create table if not exists public.marcas (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision integer not null default 1,
  dispositivo_id text,
  seq bigint not null default nextval('public.sync_seq'::regclass),
  primary key (user_id, id)
);

-- El índice de borrados. La fila de la entidad conserva el `deleted_at` (es la tumba que baja el
-- motor); esta tabla permite limpiar por fecha y deja una lista corta para auditoría.
create table if not exists public.tumbas (
  user_id uuid not null references auth.users (id) on delete cascade,
  entidad text not null check (entidad in ('recordatorios', 'categorias', 'perfiles', 'ajustes', 'marcas')),
  id text not null,
  deleted_at timestamptz not null default now(),
  seq bigint not null default nextval('public.sync_seq'::regclass),
  primary key (user_id, entidad, id)
);

-- La consulta del cursor siempre es «lo mío, desde tal número»: este índice la mantiene chica.
create index if not exists recordatorios_cursor_idx on public.recordatorios (user_id, seq);
create index if not exists categorias_cursor_idx on public.categorias (user_id, seq);
create index if not exists perfiles_cursor_idx on public.perfiles (user_id, seq);
create index if not exists ajustes_cursor_idx on public.ajustes (user_id, seq);
create index if not exists marcas_cursor_idx on public.marcas (user_id, seq);
create index if not exists tumbas_cursor_idx on public.tumbas (user_id, seq);

-- ---------------------------------------------------------------------------------------------
-- 2. RLS: leer lo propio, escribir solo por las funciones
-- ---------------------------------------------------------------------------------------------
alter table public.recordatorios enable row level security;
alter table public.categorias enable row level security;
alter table public.perfiles enable row level security;
alter table public.ajustes enable row level security;
alter table public.marcas enable row level security;
alter table public.tumbas enable row level security;

-- Sin `insert`, `update` ni `delete` directos: aunque alguien tenga la anon key y un JWT válido, la
-- única puerta de escritura es `subir_cambios`, que también comprueba el token del teléfono.
revoke all on public.recordatorios from anon, authenticated;
revoke all on public.categorias from anon, authenticated;
revoke all on public.perfiles from anon, authenticated;
revoke all on public.ajustes from anon, authenticated;
revoke all on public.marcas from anon, authenticated;
revoke all on public.tumbas from anon, authenticated;

grant select on public.recordatorios to authenticated;
grant select on public.categorias to authenticated;
grant select on public.perfiles to authenticated;
grant select on public.ajustes to authenticated;
grant select on public.marcas to authenticated;
grant select on public.tumbas to authenticated;

-- La secuencia solo la usa el dueño de las funciones (`security definer`); el navegador no la toca.
revoke all on sequence public.sync_seq from public, anon, authenticated;

drop policy if exists "cada uno ve sus recordatorios" on public.recordatorios;
create policy "cada uno ve sus recordatorios"
  on public.recordatorios for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "cada uno ve sus categorias" on public.categorias;
create policy "cada uno ve sus categorias"
  on public.categorias for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "cada uno ve sus perfiles" on public.perfiles;
create policy "cada uno ve sus perfiles"
  on public.perfiles for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "cada uno ve sus ajustes" on public.ajustes;
create policy "cada uno ve sus ajustes"
  on public.ajustes for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "cada uno ve sus marcas" on public.marcas;
create policy "cada uno ve sus marcas"
  on public.marcas for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- 3. Subir cambios: la única puerta de escritura
-- ---------------------------------------------------------------------------------------------
-- El `user_id` sale de `auth.uid()` y nunca de un parámetro. Además del JWT se exige el token del
-- dispositivo y que ese teléfono esté vinculado a la cuenta: ni con una sesión robada se puede
-- escribir en nombre de otro teléfono.
--
-- La regla de conflicto se aplica también en el servidor: un cambio más viejo se ignora. Si las
-- horas empatan, decide el `dispositivo_id` mayor; si también empatan, el hash del contenido. Es la
-- misma regla que usa el cliente al aplicar la bajada, así los dos teléfonos llegan al mismo lado.
-- El cliente recibe cuántos entraron y cuántos quedaron atrás; la cola local conserva la verdad de
-- este teléfono hasta que gane.
create or replace function public.subir_cambios(
  p_dispositivo uuid,
  p_token text,
  p_cambios jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_item jsonb;
  v_entidad text;
  v_id text;
  v_payload jsonb;
  v_actualizado timestamptz;
  v_eliminado timestamptz;
  v_texto text;
  v_tabla text;
  v_filas integer;
  v_subidos integer := 0;
  v_ignorados integer := 0;
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

  if not exists (
    select 1 from public.dispositivos_cuenta dc
     where dc.user_id = v_usuario and dc.dispositivo_id = p_dispositivo
  ) then
    raise exception 'dispositivo no vinculado' using errcode = '42501';
  end if;

  if p_cambios is null or jsonb_typeof(p_cambios) <> 'array' then
    raise exception 'cambios inválidos' using errcode = '22023';
  end if;

  if jsonb_array_length(p_cambios) > 200 then
    raise exception 'demasiados cambios en un lote' using errcode = '22023';
  end if;

  -- La última conexión de la lista de dispositivos se actualiza con cada pasada real, no con el
  -- momento en que se vinculó.
  update public.dispositivos_cuenta
     set ultima_conexion = now()
   where user_id = v_usuario and dispositivo_id = p_dispositivo;

  for v_item in select * from jsonb_array_elements(p_cambios)
  loop
    v_entidad := case
      when jsonb_typeof(v_item) = 'object' then v_item->>'entidad'
      else null
    end;
    v_id := left(coalesce(v_item->>'id', ''), 200);

    if v_entidad is null or v_id = '' then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;

    v_tabla := case v_entidad
      when 'recordatorios' then 'recordatorios'
      when 'categorias' then 'categorias'
      when 'perfiles' then 'perfiles'
      when 'ajustes' then 'ajustes'
      when 'marcas' then 'marcas'
      else null
    end;

    if v_tabla is null then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;

    v_payload := case
      when jsonb_typeof(v_item->'payload') = 'object' then v_item->'payload'
      else '{}'::jsonb
    end;

    if pg_column_size(v_payload) > 262144 then
      raise exception 'cambio demasiado grande' using errcode = '22023';
    end if;

    -- Las fechas vienen del teléfono. Se aceptan solo las que parecen ISO; una hora futura por un
    -- reloj mal puesto se acota a «ahora» para que no gane siempre, y una anterior a 2000 se descarta.
    v_texto := v_item->>'actualizadoEn';
    v_actualizado := case
      when v_texto ~ '^\d{4}-\d{2}-\d{2}T' then v_texto::timestamptz
      else now()
    end;
    if v_actualizado > now() + interval '5 minutes' then
      v_actualizado := now();
    elsif v_actualizado < timestamptz '2000-01-01' then
      v_actualizado := now();
    end if;

    v_texto := v_item->>'eliminadoEn';
    v_eliminado := case
      when v_texto ~ '^\d{4}-\d{2}-\d{2}T' then v_texto::timestamptz
      else null
    end;

    -- El nombre de la tabla sale de la lista blanca de arriba; el formato `%I` lo cita igual, así que
    -- no hay forma de colar SQL por la entidad. El `where` del `on conflict` es la regla de conflicto
    -- del servidor: un cambio viejo no pisa uno nuevo.
    execute format($sql$
      insert into public.%1$I as t
        (user_id, id, payload, updated_at, deleted_at, dispositivo_id, revision, seq)
      values
        ($1, $2, $3, $4, $5, $6, 1, nextval('public.sync_seq'))
      on conflict (user_id, id) do update
        set payload = case
              when excluded.payload = '{}'::jsonb and t.deleted_at is not null then t.payload
              else excluded.payload
            end,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            dispositivo_id = excluded.dispositivo_id,
            revision = t.revision + 1,
            seq = nextval('public.sync_seq')
        where excluded.updated_at > t.updated_at
           or (
             excluded.updated_at = t.updated_at
             and coalesce(excluded.dispositivo_id, '') > coalesce(t.dispositivo_id, '')
           )
           or (
             excluded.updated_at = t.updated_at
             and coalesce(excluded.dispositivo_id, '') = coalesce(t.dispositivo_id, '')
             and md5(excluded.payload::text) > md5(t.payload::text)
           )
    $sql$, v_tabla)
    using v_usuario, v_id, v_payload, v_actualizado, v_eliminado, p_dispositivo::text;

    get diagnostics v_filas = row_count;

    if v_filas > 0 then
      v_subidos := v_subidos + 1;
      if v_eliminado is not null then
        insert into public.tumbas (user_id, entidad, id, deleted_at, seq)
        values (v_usuario, v_entidad, v_id, v_eliminado, nextval('public.sync_seq'))
        on conflict (user_id, entidad, id) do update
          set deleted_at = excluded.deleted_at,
              seq = excluded.seq;
      else
        -- Si la fila revive (deshacer un borrado), la tumba deja de existir.
        delete from public.tumbas
         where user_id = v_usuario and entidad = v_entidad and id = v_id;
      end if;
    else
      v_ignorados := v_ignorados + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'subidos', v_subidos,
    'ignorados', v_ignorados
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Bajar cambios: el cursor por dispositivo
-- ---------------------------------------------------------------------------------------------
-- Devuelve las filas de las cinco entidades con `seq` mayor que el cursor, en orden. Incluye las
-- tumbas (`deleted_at` no nulo): el cliente borra la fila local y anota la marca para no volver a
-- subirla. `p_limite` se acota para que una primera bajada grande no arme una respuesta enorme.
create or replace function public.bajar_cambios(
  p_dispositivo uuid,
  p_token text,
  p_desde bigint default 0,
  p_limite integer default 200
) returns table (
  entidad text,
  id text,
  payload jsonb,
  updated_at timestamptz,
  deleted_at timestamptz,
  revision integer,
  dispositivo_id text,
  seq bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_desde bigint := greatest(coalesce(p_desde, 0), 0);
  v_limite integer := least(greatest(coalesce(p_limite, 200), 1), 500);
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

  if not exists (
    select 1 from public.dispositivos_cuenta dc
     where dc.user_id = v_usuario and dc.dispositivo_id = p_dispositivo
  ) then
    raise exception 'dispositivo no vinculado' using errcode = '42501';
  end if;

  -- La bajada exitosa también es una conexión: la lista de Ajustes muestra una hora real.
  update public.dispositivos_cuenta dc
     set ultima_conexion = now()
   where dc.user_id = v_usuario and dc.dispositivo_id = p_dispositivo;

  return query
  select s.entidad, s.id, s.payload, s.updated_at, s.deleted_at,
         s.revision, s.dispositivo_id, s.seq
  from (
    select 'recordatorios'::text as entidad, r.id, r.payload, r.updated_at,
           r.deleted_at, r.revision, r.dispositivo_id, r.seq
      from public.recordatorios r
     where r.user_id = v_usuario and r.seq > v_desde
    union all
    select 'categorias'::text, c.id, c.payload, c.updated_at,
           c.deleted_at, c.revision, c.dispositivo_id, c.seq
      from public.categorias c
     where c.user_id = v_usuario and c.seq > v_desde
    union all
    select 'perfiles'::text, p.id, p.payload, p.updated_at,
           p.deleted_at, p.revision, p.dispositivo_id, p.seq
      from public.perfiles p
     where p.user_id = v_usuario and p.seq > v_desde
    union all
    select 'ajustes'::text, a.id, a.payload, a.updated_at,
           a.deleted_at, a.revision, a.dispositivo_id, a.seq
      from public.ajustes a
     where a.user_id = v_usuario and a.seq > v_desde
    union all
    select 'marcas'::text, m.id, m.payload, m.updated_at,
           m.deleted_at, m.revision, m.dispositivo_id, m.seq
      from public.marcas m
     where m.user_id = v_usuario and m.seq > v_desde
  ) s
  order by s.seq
  limit v_limite;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Limpieza de tumbas
-- ---------------------------------------------------------------------------------------------
-- Un teléfono que estuvo más de 90 días sin abrir puede tener un cursor anterior a las filas que se
-- purgan: los borrados de ese hueco ya no viajan y el teléfono necesita una restauración completa
-- (pendiente en la app). La purga borra las filas ya borradas y sus marcas.
create or replace function public.purgar_tumbas(p_dias integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias integer := greatest(coalesce(p_dias, 90), 1);
  v_corte timestamptz := now() - make_interval(days => v_dias);
  v_total bigint := 0;
  v_filas bigint;
begin
  delete from public.recordatorios where deleted_at is not null and deleted_at < v_corte;
  get diagnostics v_filas = row_count; v_total := v_total + v_filas;

  delete from public.categorias where deleted_at is not null and deleted_at < v_corte;
  get diagnostics v_filas = row_count; v_total := v_total + v_filas;

  delete from public.perfiles where deleted_at is not null and deleted_at < v_corte;
  get diagnostics v_filas = row_count; v_total := v_total + v_filas;

  delete from public.ajustes where deleted_at is not null and deleted_at < v_corte;
  get diagnostics v_filas = row_count; v_total := v_total + v_filas;

  delete from public.marcas where deleted_at is not null and deleted_at < v_corte;
  get diagnostics v_filas = row_count; v_total := v_total + v_filas;

  delete from public.tumbas where deleted_at < v_corte;
  get diagnostics v_filas = row_count; v_total := v_total + v_filas;

  return jsonb_build_object('ok', true, 'borradas', v_total);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Permisos: `authenticated` puede llamar a las dos del motor; nadie más
-- ---------------------------------------------------------------------------------------------
revoke all on function public.subir_cambios(uuid, text, jsonb) from public, anon;
revoke all on function public.bajar_cambios(uuid, text, bigint, integer) from public, anon;
revoke all on function public.purgar_tumbas(integer) from public, anon, authenticated;

grant execute on function public.subir_cambios(uuid, text, jsonb) to authenticated;
grant execute on function public.bajar_cambios(uuid, text, bigint, integer) to authenticated;

-- Comprobación rápida después de correr esto:
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename in
--      ('recordatorios','categorias','perfiles','ajustes','marcas','tumbas');
--
--   select proname, proacl from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('subir_cambios', 'bajar_cambios', 'purgar_tumbas');
--
-- La prueba negativa con dos cuentas y dos dispositivos está en
-- supabase/tests/0005_negativo.sql.

