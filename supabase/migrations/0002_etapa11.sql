-- AVISPATE · Etapa 11 — posponer desde la notificación y salud de la cola.
--
-- Se corre DESPUÉS de 0001_etapa10.sql, en el SQL Editor de Supabase. Es idempotente: se puede volver a
-- correr sin duplicar nada ni romper lo que ya estaba.
--
-- Qué agrega:
--
--   1. `pospuesto_en` en `avisos`: la marca de un aviso que se pospuso desde la notificación. Sirve para
--      una sola cosa, pero importante: `sincronizar_avisos` borra lo pendiente que no venga en la cola
--      que sube el teléfono, y un aviso pospuesto no viene (nació de una notificación, no de un
--      recordatorio). Sin la marca, la próxima sincronización lo borraría antes de que suene.
--
--   2. `posponer_aviso`: el «Posponer 10 min» / «Posponer 1 hora» de la notificación. Mueve el aviso que
--      ya salió y lo deja pendiente otra vez a la hora nueva. El service worker la llama directo, sin
--      abrir la app, con el token del dispositivo guardado en IndexedDB.
--
--   3. `resumen_cola`: los números de Ajustes › Salud de la cola (programados, pendientes, enviados, con
--      error, el próximo y el último enviado). Es solo lectura.
--
-- Nada de esto cambia el reparto de la Etapa 10: el teléfono sigue calculando las fechas y el servidor
-- sigue limitándose a mirar la hora y mandar.

-- ---------------------------------------------------------------------------------------------
-- 1. La marca de pospuesto
-- ---------------------------------------------------------------------------------------------
alter table public.avisos
  add column if not exists pospuesto_en timestamptz;

-- ---------------------------------------------------------------------------------------------
-- 2. Posponer un aviso desde la notificación
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
  -- Entre 1 minuto y un día: el botón manda 10 o 60, pero el tope evita que un error de tipeo programe
  -- un aviso para dentro de un año (o para el pasado, que saldría en la próxima pasada del cron).
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
         pospuesto_en = now()
   where a.dispositivo_id = p_dispositivo
     and a.id = p_aviso_id
     -- Solo lo que sonó hace poco: una notificación vieja que quedó en la bandeja no debería volver a
     -- la vida una semana después.
     and a.cuando > now() - interval '7 days';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. La salud de la cola, para Ajustes
-- ---------------------------------------------------------------------------------------------
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
    -- Los que la Edge Function ya dio por vencidos: 5 intentos fallidos la hacen saltar el aviso.
    'conError', count(*) filter (where a.enviado_en is null and a.intentos >= 5),
    'proximo', min(a.cuando) filter (where a.enviado_en is null),
    'ultimoEnviado', max(a.enviado_en)
  )
  into v_resumen
  from public.avisos a
  where a.dispositivo_id = p_dispositivo;

  return v_resumen;
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- 4. La sincronización, con la excepción de los pospuestos
--    Es la misma de 0001 con una línea más (`pospuesto_en is null` en el borrado). Se repite entera
--    porque `create or replace function` no permite cambiar el cuerpo por partes.
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

  -- La cola que llega es la verdad: lo pendiente que ya no está (se borró el recordatorio, se cambió
  -- la repetición) deja de existir. Lo ya enviado no se toca: es historial. Lo pospuesto tampoco: el
  -- teléfono no lo conoce (nació de la notificación) y borrarlo sería perder el «avisame de nuevo».
  delete from public.avisos a
   where a.dispositivo_id = p_dispositivo
     and a.enviado_en is null
     and a.pospuesto_en is null
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

grant execute on function public.posponer_aviso(uuid, text, text, integer) to anon;
grant execute on function public.resumen_cola(uuid, text) to anon;

-- Comprobación rápida después de correr esto (deberían salir las cuatro, más las cuatro de la Etapa 10):
--   select proname from pg_proc
--    where pronamespace = 'public'::regnamespace and proname in
--          ('posponer_aviso', 'resumen_cola', 'sincronizar_avisos', 'registrar_dispositivo');

