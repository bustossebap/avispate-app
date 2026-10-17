-- AVISPATE · Etapa 10 — avisos con la app cerrada, en Supabase.
--
-- El reparto es a propósito: el teléfono calcula las fechas concretas de cada aviso (con sus
-- repeticiones y su zona horaria) y las sube; acá solo se guardan y un cron las entrega cuando llega
-- la hora. Nada de repetir la lógica de «cada 6 meses» ni de adivinar zonas horarias en el servidor.
--
-- Cómo se corre: Supabase → SQL Editor → pegar este archivo (con la anon key puesta, ver el final) →
-- Run. Es idempotente: se puede volver a correr sin duplicar nada. Después, las funciones se publican
-- con `npx supabase functions deploy enviar-avisos` (ver supabase/README.md).
--
-- Seguridad: las tablas quedan con RLS encendido y SIN políticas para `anon`, así que la clave
-- pública que viaja en el navegador no puede leer ni escribir nada directamente. Lo único que puede
-- hacer son las cuatro funciones de abajo, y cada una exige el token del dispositivo.

-- ---------------------------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------------------------
create table if not exists public.dispositivos (
  id uuid primary key,
  -- Secreto del teléfono (32 bytes en hexadecimal). No se muestra en ninguna pantalla: es lo que
  -- prueba que quien pide tocar la cola es el mismo dispositivo que la creó.
  token text not null,
  nombre text,
  -- Suscripción push del navegador. Si está vacía, el dispositivo existe pero no recibe nada.
  endpoint text,
  p256dh text,
  auth text,
  creado_en timestamptz not null default now(),
  visto_en timestamptz not null default now()
);

create table if not exists public.avisos (
  dispositivo_id uuid not null references public.dispositivos (id) on delete cascade,
  -- Id que arma el teléfono: recordatorio + ocurrencia + aviso. Es estable, así que volver a subir la
  -- misma cola no duplica nada. Va junto al dispositivo en la clave porque dos teléfonos pueden tener
  -- el mismo recordatorio restaurado desde una copia.
  id text not null,
  recordatorio_id text not null,
  cuando timestamptz not null,
  titulo text not null,
  cuerpo text not null default '',
  emoji text,
  enviado_en timestamptz,
  intentos integer not null default 0,
  ultimo_error text,
  creado_en timestamptz not null default now(),
  primary key (dispositivo_id, id)
);

-- El cron busca «pendientes y ya vencidos»: este índice es el que hace que esa consulta no crezca.
create index if not exists avisos_pendientes_idx
  on public.avisos (cuando)
  where enviado_en is null;
create index if not exists avisos_dispositivo_idx
  on public.avisos (dispositivo_id);

alter table public.dispositivos enable row level security;
alter table public.avisos enable row level security;
-- Sin políticas: `anon` no toca las tablas. Las funciones de abajo son la única puerta.
revoke all on public.dispositivos from anon, authenticated;
revoke all on public.avisos from anon, authenticated;


-- ---------------------------------------------------------------------------------------------
-- 2. Funciones que usa la app (RPC). Corren como dueño de las tablas y por eso pueden escribir,
--    pero antes de tocar nada comprueban el token del dispositivo: el id solo no alcanza.
-- ---------------------------------------------------------------------------------------------
create or replace function public.registrar_dispositivo(
  p_dispositivo uuid,
  p_token text,
  p_nombre text default null,
  p_push jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_dispositivo is null or coalesce(length(p_token), 0) < 32 then
    raise exception 'dispositivo inválido' using errcode = '22023';
  end if;

  insert into public.dispositivos (id, token, nombre)
  values (p_dispositivo, p_token, p_nombre)
  on conflict (id) do update
    set nombre = coalesce(excluded.nombre, public.dispositivos.nombre),
        visto_en = now()
    where public.dispositivos.token = excluded.token;

  -- La suscripción push se toca solo si viene (null = no cambiarla, {} = borrarla).
  if p_push is not null then
    update public.dispositivos
       set endpoint = nullif(p_push ->> 'endpoint', ''),
           p256dh = nullif(p_push ->> 'p256dh', ''),
           auth = nullif(p_push ->> 'auth', ''),
           visto_en = now()
     where id = p_dispositivo and token = p_token;
  end if;

  if not exists (
    select 1 from public.dispositivos d
     where d.id = p_dispositivo and d.token = p_token
  ) then
    raise exception 'token incorrecto' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.olvidar_push(
  p_dispositivo uuid,
  p_token text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.dispositivos
     set endpoint = null, p256dh = null, auth = null, visto_en = now()
   where id = p_dispositivo and token = p_token;
  -- Lo pendiente ya no tiene a quién llegar: se borra para que el cron no lo siga mirando.
  delete from public.avisos
   where dispositivo_id = p_dispositivo and enviado_en is null;
end;
$$;

create or replace function public.sincronizar_avisos(
  p_dispositivo uuid,
  p_token text,
  p_avisos jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer := 0;
begin
  if not exists (
    select 1 from public.dispositivos d
     where d.id = p_dispositivo and d.token = p_token
  ) then
    raise exception 'token incorrecto' using errcode = '42501';
  end if;
  if p_avisos is null or jsonb_typeof(p_avisos) <> 'array' then
    raise exception 'p_avisos debe ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_avisos) > 1000 then
    raise exception 'demasiados avisos' using errcode = '22023';
  end if;

  -- La cola que llega es la verdad: lo pendiente que ya no está (se borró el recordatorio, se cambió
  -- la repetición) deja de existir. Lo ya enviado no se toca: es historial.
  delete from public.avisos a
   where a.dispositivo_id = p_dispositivo
     and a.enviado_en is null
     and not exists (
       select 1 from jsonb_array_elements(p_avisos) x where x ->> 'id' = a.id
     );

  insert into public.avisos (dispositivo_id, id, recordatorio_id, cuando, titulo, cuerpo, emoji)
  select p_dispositivo,
         x ->> 'id',
         coalesce(x ->> 'recordatorioId', 'sin-recordatorio'),
         (x ->> 'cuando')::timestamptz,
         coalesce(nullif(x ->> 'titulo', ''), 'Recordatorio'),
         coalesce(x ->> 'cuerpo', ''),
         nullif(x ->> 'emoji', '')
    from jsonb_array_elements(p_avisos) x
   where coalesce(x ->> 'id', '') <> ''
     and coalesce(x ->> 'cuando', '') <> ''
  on conflict (dispositivo_id, id) do update
     set cuando = excluded.cuando,
         titulo = excluded.titulo,
         cuerpo = excluded.cuerpo,
         emoji = excluded.emoji
   where public.avisos.enviado_en is null;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;


-- Un aviso de prueba que vence ya: lo manda la próxima pasada del cron (menos de un minuto).
create or replace function public.probar_aviso(
  p_dispositivo uuid,
  p_token text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.dispositivos d
     where d.id = p_dispositivo and d.token = p_token
  ) then
    raise exception 'token incorrecto' using errcode = '42501';
  end if;

  insert into public.avisos (dispositivo_id, id, recordatorio_id, cuando, titulo, cuerpo, emoji)
  values (
    p_dispositivo,
    'prueba-' || replace(gen_random_uuid()::text, '-', ''),
    'prueba',
    now(),
    'AVISPATE · Prueba',
    'Si ves esto, los avisos con la app cerrada funcionan. 🐝',
    '🐝'
  );
end;
$$;

grant execute on function public.registrar_dispositivo(uuid, text, text, jsonb) to anon;
grant execute on function public.olvidar_push(uuid, text) to anon;
grant execute on function public.sincronizar_avisos(uuid, text, jsonb) to anon;
grant execute on function public.probar_aviso(uuid, text) to anon;

-- ---------------------------------------------------------------------------------------------
-- 3. El reloj: cada minuto se llama a la función que entrega los avisos vencidos.
--    La clave que viaja acá es la anon key, la misma pública que usa la app: no hay ningún secreto
--    nuevo en la base. Si alguien la usara para disparar la función de más, no logra nada raro: solo
--    se entregan los avisos que ya vencieron, y una vez enviados no se repiten.
-- ---------------------------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  -- ⇩⇩⇩  Reemplazar por la anon key del proyecto (Settings → API → anon public).  ⇩⇩⇩
  v_anon text := '<ANON_KEY>';
  v_url text := 'https://vmctsurhswayrrkggj.supabase.co/functions/v1/enviar-avisos';
begin
  if v_anon like '<%' then
    raise notice 'Falta reemplazar <ANON_KEY>: el cron quedó sin autorización. Volvé a correr esta parte.';
  end if;

  if exists (select 1 from cron.job where jobname = 'avispate-avisos') then
    perform cron.unschedule('avispate-avisos');
  end if;
  perform cron.schedule(
    'avispate-avisos',
    '* * * * *',
    format(
      $cron$select net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );$cron$,
      v_url,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      )::text
    )
  );

  -- Limpieza diaria: lo que ya se envió (o venció hace más de un mes) no se guarda para siempre.
  if exists (select 1 from cron.job where jobname = 'avispate-limpieza') then
    perform cron.unschedule('avispate-limpieza');
  end if;
  perform cron.schedule(
    'avispate-limpieza',
    '17 4 * * *',
    $limpieza$delete from public.avisos
      where cuando < now() - interval '30 days'
         or (enviado_en is not null and enviado_en < now() - interval '30 days');$limpieza$
  );
end;
$$;

-- Comprobación rápida después de correr esto (debería devolver dos filas: avisos y limpieza):
--   select jobname, schedule, active from cron.job where jobname like 'avispate-%';
