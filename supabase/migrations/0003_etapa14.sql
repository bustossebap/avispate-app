-- AVISPATE · Etapa 14 — entrega real por WhatsApp y correo.
--
-- Se corre DESPUÉS de 0001_etapa10.sql y 0002_etapa11.sql, en el SQL Editor de Supabase. Es
-- idempotente: se puede volver a correr sin duplicar nada ni romper lo que ya estaba.
--
-- Qué cambia:
--
--   1. Cada fila de `avisos` pasa a ser un ENVÍO de un canal: `canal` ('push', 'whatsapp' o
--      'email'), `destino` (número en dígitos o correo), `perfil_id`, `zona` (para escribir la
--      fecha en la hora de la persona) y `estado` ('en_cola', 'enviado', 'entregado', 'fallido').
--      La clave primaria pasa a (dispositivo, id, canal): el mismo recordatorio puede salir por
--      los tres canales y cada uno se entrega (y se reintenta) por separado.
--
--   2. `sincronizar_avisos` sube la cola ya separada por canal. La cola que llega sigue siendo la
--      verdad: lo pendiente que ya no está se borra, pero ahora se compara id + canal.
--
--   3. `probar_canal` encola una prueba de WhatsApp o correo; `ultimos_envios` devuelve las últimas
--      filas con su estado para Ajustes; `resumen_cola` suma el desglose por canal.
--
--   4. Reintentos con espera creciente: `proximo_intento` evita que un fallo se reintente en cada
--      pasada del cron. La Edge Function lo actualiza; acá solo se crea la columna.
--
-- Nada de esto guarda secretos: el token de WhatsApp, la clave de Resend y los de los webhooks
-- viven en los secretos de la función (ver supabase/README.md).

-- ---------------------------------------------------------------------------------------------
-- 1. Columnas del envío
-- ---------------------------------------------------------------------------------------------
alter table public.avisos add column if not exists canal text not null default 'push';
alter table public.avisos add column if not exists destino text;
alter table public.avisos add column if not exists perfil_id text;
alter table public.avisos add column if not exists zona text not null default 'UTC';
alter table public.avisos add column if not exists estado text not null default 'en_cola';
alter table public.avisos add column if not exists entregado_en timestamptz;
alter table public.avisos add column if not exists proveedor_id text;
alter table public.avisos add column if not exists proximo_intento timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.avisos'::regclass and conname = 'avisos_canal_check'
  ) then
    alter table public.avisos
      add constraint avisos_canal_check check (canal in ('push', 'whatsapp', 'email'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.avisos'::regclass and conname = 'avisos_estado_check'
  ) then
    alter table public.avisos
      add constraint avisos_estado_check
      check (estado in ('en_cola', 'enviado', 'entregado', 'fallido'));
  end if;
end;
$$;

-- Las filas anteriores a esta migración ya son «push» por el valor por defecto. El estado se deduce
-- de las marcas que dejó la Etapa 11, para que el historial no arranque todo en «En cola».
update public.avisos a
   set estado = case
     when a.entregado_en is not null then 'entregado'
     when a.enviado_en is not null then 'enviado'
     when a.intentos >= 5 then 'fallido'
     else 'en_cola'
   end
 where a.estado = 'en_cola';

-- La clave de la Etapa 10 era (dispositivo, id). Ahora el mismo aviso puede tener una fila por canal.
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid)
    into v_def
    from pg_constraint c
   where c.conrelid = 'public.avisos'::regclass and c.contype = 'p';
  if v_def is not null and position('canal' in v_def) = 0 then
    alter table public.avisos drop constraint avisos_pkey;
    alter table public.avisos
      add constraint avisos_pkey primary key (dispositivo_id, id, canal);
  end if;
end;
$$;

-- El cron busca pendientes por fecha y canal; el webhook busca por el id que devolvió el proveedor.
create index if not exists avisos_canal_pendientes_idx
  on public.avisos (canal, cuando)
  where enviado_en is null;
create index if not exists avisos_proveedor_idx
  on public.avisos (proveedor_id)
  where proveedor_id is not null;

-- Una vista con el nombre que usa la documentación. No cambia nada por dentro: es la misma cola.
create or replace view public.envios as
  select dispositivo_id, id, recordatorio_id, canal, destino, perfil_id, zona,
         cuando, titulo, cuerpo, emoji, estado, enviado_en, entregado_en,
         proveedor_id, intentos, ultimo_error, proximo_intento, creado_en
    from public.avisos;
revoke all on public.envios from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. La sincronización, ahora por canal
-- ---------------------------------------------------------------------------------------------
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

  -- Lo pendiente que ya no está (se borró el recordatorio, se cambió la repetición o se apagó un
  -- canal) deja de existir. Lo ya enviado no se toca: es historial. Lo pospuesto tampoco: el teléfono
  -- no lo conoce y borrarlo sería perder el «avisame de nuevo».
  delete from public.avisos a
   where a.dispositivo_id = p_dispositivo
     and a.enviado_en is null
     and a.pospuesto_en is null
     and not exists (
       select 1 from jsonb_array_elements(p_avisos) x
        where x ->> 'id' = a.id
          and coalesce(nullif(x ->> 'canal', ''), 'push') = a.canal
     );

  insert into public.avisos (
    dispositivo_id, id, recordatorio_id, cuando, titulo, cuerpo, emoji,
    canal, destino, perfil_id, zona
  )
  select p_dispositivo,
         x ->> 'id',
         coalesce(x ->> 'recordatorioId', 'sin-recordatorio'),
         (x ->> 'cuando')::timestamptz,
         coalesce(nullif(x ->> 'titulo', ''), 'Recordatorio'),
         coalesce(x ->> 'cuerpo', ''),
         nullif(x ->> 'emoji', ''),
         case when x ->> 'canal' in ('push', 'whatsapp', 'email')
              then x ->> 'canal' else 'push' end,
         nullif(x ->> 'destino', ''),
         nullif(x ->> 'perfilId', ''),
         coalesce(nullif(x ->> 'zona', ''), 'UTC')
    from jsonb_array_elements(p_avisos) x
   where coalesce(x ->> 'id', '') <> ''
     and coalesce(x ->> 'cuando', '') <> ''
  on conflict (dispositivo_id, id, canal) do update
     set cuando = excluded.cuando,
         titulo = excluded.titulo,
         cuerpo = excluded.cuerpo,
         emoji = excluded.emoji,
         destino = excluded.destino,
         perfil_id = excluded.perfil_id,
         zona = excluded.zona,
         -- Re-armar una fila pendiente: si había fallado (o el dispositivo perdió el push y volvió),
         -- la próxima pasada la reintenta. Lo ya enviado no entra acá (el where de abajo lo excluye).
         estado = 'en_cola',
         intentos = 0,
         ultimo_error = null,
         entregado_en = null,
         proveedor_id = null,
         proximo_intento = now()
   -- Lo pospuesto desde la notificación no se pisa: el teléfono no conoce esa hora nueva y, si el
   -- upsert la reemplazara por la original, el «Posponer 10 min» se perdería en la próxima subida.
   where public.avisos.enviado_en is null
     and public.avisos.pospuesto_en is null;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2-bis. Posponer desde la notificación, ahora sin tocar los canales ya entregados
--    La Etapa 11 movía todas las filas con ese id. Desde la Etapa 14 el mismo aviso puede tener una
--    fila de WhatsApp o correo ya enviada: revivirla mandaría un mensaje duplicado. El «Posponer» de
--    la notificación mueve solo la fila del push, que es la que el service worker conoce.
-- ---------------------------------------------------------------------------------------------
create or replace function public.posponer_aviso(
  p_dispositivo uuid,
  p_token text,
  p_aviso_id text,
  p_minutos integer default 10
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_minutos integer := least(greatest(coalesce(p_minutos, 10), 1), 1440);
begin
  if not exists (
    select 1 from public.dispositivos d
     where d.id = p_dispositivo and d.token = p_token
  ) then
    raise exception 'token incorrecto' using errcode = '42501';
  end if;

  update public.avisos a
     set cuando = now() + make_interval(mins => v_minutos),
         enviado_en = null,
         intentos = 0,
         ultimo_error = null,
         pospuesto_en = now(),
         estado = 'en_cola',
         entregado_en = null,
         proveedor_id = null,
         proximo_intento = now()
   where a.dispositivo_id = p_dispositivo
     and a.id = p_aviso_id
     and a.canal = 'push'
     and a.cuando > now() - interval '7 days';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2-ter. Apagar el push no borra WhatsApp ni correo
--    `olvidar_push` nació cuando todo era push y borraba todo lo pendiente. Desde la Etapa 14 eso
--    apagaría también los envíos reales que la persona quiere conservar: se borran solo las filas
--    de push (las de WhatsApp y correo siguen su curso). El resto de la función no cambia.
-- ---------------------------------------------------------------------------------------------
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

  delete from public.avisos
   where dispositivo_id = p_dispositivo
     and enviado_en is null
     and canal = 'push';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Una prueba de WhatsApp o correo
-- ---------------------------------------------------------------------------------------------
create or replace function public.probar_canal(
  p_dispositivo uuid,
  p_token text,
  p_canal text,
  p_destino text,
  p_zona text default 'UTC'
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre text;
  v_cuerpo text;
begin
  if not exists (
    select 1 from public.dispositivos d
     where d.id = p_dispositivo and d.token = p_token
  ) then
    raise exception 'token incorrecto' using errcode = '42501';
  end if;
  if p_canal is null or p_canal not in ('whatsapp', 'email') then
    raise exception 'canal de prueba inválido' using errcode = '22023';
  end if;
  if coalesce(trim(p_destino), '') = '' then
    raise exception 'falta el destino de la prueba' using errcode = '22023';
  end if;

  if p_canal = 'whatsapp' then
    v_nombre := 'AVISPATE · Prueba por WhatsApp';
    v_cuerpo := 'Si ves esto, los avisos por WhatsApp funcionan. 🐝';
  else
    v_nombre := 'AVISPATE · Prueba por correo';
    v_cuerpo := 'Si ves esto, los avisos por correo funcionan. 🐝';
  end if;

  insert into public.avisos (
    dispositivo_id, id, recordatorio_id, cuando, titulo, cuerpo, emoji,
    canal, destino, perfil_id, zona, estado, pospuesto_en
  )
  values (
    p_dispositivo,
    'prueba-' || replace(gen_random_uuid()::text, '-', ''),
    'prueba',
    now(),
    v_nombre,
    v_cuerpo,
    '🐝',
    p_canal,
    trim(p_destino),
    'prueba',
    coalesce(nullif(p_zona, ''), 'UTC'),
    'en_cola',
    -- La marca de «no vino de un recordatorio» evita que la próxima sincronización del teléfono
    -- borre la prueba antes de que el cron la entregue.
    now()
  );
end;
$$;

-- El aviso de prueba del push también se protege de la sincronización (misma razón que arriba).
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

  insert into public.avisos (
    dispositivo_id, id, recordatorio_id, cuando, titulo, cuerpo, emoji,
    canal, estado, pospuesto_en
  )
  values (
    p_dispositivo,
    'prueba-' || replace(gen_random_uuid()::text, '-', ''),
    'prueba',
    now(),
    'AVISPATE · Prueba',
    'Si ves esto, los avisos con la app cerrada funcionan. 🐝',
    '🐝',
    'push',
    'en_cola',
    now()
  );
end;
$$;



-- ---------------------------------------------------------------------------------------------
-- 4. El historial y el resumen para Ajustes
-- ---------------------------------------------------------------------------------------------
create or replace function public.ultimos_envios(
  p_dispositivo uuid,
  p_token text,
  p_limite integer default 5
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lista jsonb;
  v_limite integer := least(greatest(coalesce(p_limite, 5), 1), 20);
begin
  if not exists (
    select 1 from public.dispositivos d
     where d.id = p_dispositivo and d.token = p_token
  ) then
    raise exception 'token incorrecto' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'canal', a.canal,
           'titulo', a.titulo,
           'cuando', a.cuando,
           'estado', a.estado,
           'enviadoEn', a.enviado_en,
           'entregadoEn', a.entregado_en,
           'error', a.ultimo_error
         ) order by a.orden desc), '[]'::jsonb)
    into v_lista
    from (
      select a.*, coalesce(a.enviado_en, a.entregado_en, a.cuando) as orden
        from public.avisos a
       where a.dispositivo_id = p_dispositivo
         and a.canal in ('whatsapp', 'email')
       order by orden desc
       limit v_limite
    ) a;

  return v_lista;
end;
$$;

create or replace function public.resumen_cola(
  p_dispositivo uuid,
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resumen jsonb;
begin
  if not exists (
    select 1 from public.dispositivos d
     where d.id = p_dispositivo and d.token = p_token
  ) then
    raise exception 'token incorrecto' using errcode = '42501';
  end if;

  select jsonb_build_object(
    -- Todo lo que hay para este dispositivo (lo enviado se conserva 30 días, ver la limpieza).
    'programados', count(*),
    'pendientes', count(*) filter (where a.enviado_en is null),
    'enviados', count(*) filter (where a.enviado_en is not null),
    'conError', count(*) filter (where a.enviado_en is null and a.intentos >= 5),
    'proximo', min(a.cuando) filter (where a.enviado_en is null),
    'ultimoEnviado', max(a.enviado_en),
    -- Desglose por canal: dice de un vistazo si lo que falta es push o entrega real.
    'porCanal', jsonb_build_object(
      'push', count(*) filter (where a.canal = 'push' and a.enviado_en is null),
      'whatsapp', count(*) filter (where a.canal = 'whatsapp' and a.enviado_en is null),
      'email', count(*) filter (where a.canal = 'email' and a.enviado_en is null)
    )
  )
  into v_resumen
  from public.avisos a
  where a.dispositivo_id = p_dispositivo;

  return v_resumen;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Permisos: las mismas puertas de siempre, con dos funciones nuevas
-- ---------------------------------------------------------------------------------------------
grant execute on function public.probar_canal(uuid, text, text, text, text) to anon;
grant execute on function public.ultimos_envios(uuid, text, integer) to anon;
-- `posponer_aviso` conserva la firma de la Etapa 11: el permiso ya existía, pero repetirlo deja la
-- migración autosuficiente si alguna vez se corre sobre una base donde faltaba.
grant execute on function public.posponer_aviso(uuid, text, text, integer) to anon;

-- Comprobación rápida después de correr esto (deberían salir las dos nuevas y la clave con canal):
--   select proname from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('probar_canal', 'ultimos_envios', 'sincronizar_avisos', 'resumen_cola');
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.avisos'::regclass and contype = 'p';

