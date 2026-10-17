-- AVISPATE · Etapa 15, fases 2 y 3 — prueba negativa de RLS y del motor.
--
-- Se corre contra el proyecto vinculado y SIEMPRE termina en `rollback`:
--   npx supabase db query --linked --file supabase/tests/0005_negativo.sql
--
-- Crea dos cuentas y dos dispositivos, escribe una fila de cada una como el dueño de la base y
-- después se pone en el rol `authenticated` con el `sub` de cada cuenta para comprobar que:
--
--   * cada uno ve solo lo suyo;
--   * `subir_cambios` y `bajar_cambios` exigen el token y el vínculo del dispositivo;
--   * no se puede escribir directo en las tablas;
--   * una subida vieja no pisa una nueva.
begin;

-- UUIDs fijos para que la prueba sea legible y repetible.
--   cuenta A: 11111111-1111-1111-1111-111111111111
--   cuenta B: 22222222-2222-2222-2222-222222222222
--   equipo A: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
--   equipo B: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-a@avispate.local', '',
   now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-b@avispate.local', '',
   now(), now(), now());

insert into public.dispositivos (id, token, nombre)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('a', 64), 'Equipo A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', repeat('b', 64), 'Equipo B'),
  -- Equipo C: existe y tiene token, pero no está vinculado a la cuenta A.
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', repeat('c', 64), 'Equipo C');

-- El vínculo lo haría `reclamar_dispositivo`; acá se inserta como dueño de la base para no depender
-- de una sesión real de Auth.
insert into public.dispositivos_cuenta (user_id, dispositivo_id)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  -- El equipo B también está vinculado a la cuenta A: sirve para probar el desempate por dispositivo.
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Dos filas de la entidad, una por cuenta, escritas como dueño (sin RLS).
insert into public.recordatorios (user_id, id, payload, updated_at, dispositivo_id)
values
  ('11111111-1111-1111-1111-111111111111', 'a-1', '{"name":"De A"}'::jsonb,
   now() - interval '2 minutes', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'b-1', '{"name":"De B"}'::jsonb,
   now() - interval '2 minutes', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- ---------------------------------------------------------------------------------------------
-- Cuenta A
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}';

do $$
declare
  v_total integer;
begin
  select count(*) into v_total from public.recordatorios;
  if v_total <> 1 then
    raise exception 'A debería ver 1 recordatorio y ve %', v_total;
  end if;

  select count(*) into v_total from public.recordatorios where id = 'b-1';
  if v_total <> 0 then
    raise exception 'A está viendo la fila de B';
  end if;

  -- La función acepta el token propio y el vínculo propio.
  perform public.subir_cambios(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    repeat('a', 64),
    '[{"entidad":"recordatorios","id":"a-2","payload":{"name":"Nuevo"},"actualizadoEn":"2026-10-17T12:00:00.000Z"}]'::jsonb
  );

  if not exists (select 1 from public.recordatorios where id = 'a-2') then
    raise exception 'A no pudo subir su propio cambio';
  end if;

  -- Un dispositivo real con su token, pero no vinculado a esta cuenta, no entra.
  begin
    perform public.subir_cambios(
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      repeat('c', 64),
      '[]'::jsonb
    );
    raise exception 'el dispositivo no vinculado fue aceptado' using errcode = 'P0001';
  exception when insufficient_privilege then null;
  end;

  -- Escritura directa: no hay grant, así que ni siquiera llega a la RLS.
  begin
    insert into public.recordatorios (user_id, id, payload)
    values ('11111111-1111-1111-1111-111111111111', 'a-directo', '{}'::jsonb);
    raise exception 'el insert directo fue aceptado';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.recordatorios set payload = '{}'::jsonb where id = 'a-1';
    raise exception 'el update directo fue aceptado';
  exception when insufficient_privilege then null;
  end;
end;
$$;


-- Una subida con hora vieja no pisa la fila que ya existe.
do $$
declare
  v_payload jsonb;
begin
  perform public.subir_cambios(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    repeat('a', 64),
    '[{"entidad":"recordatorios","id":"a-1","payload":{"name":"Viejo"},"actualizadoEn":"2020-01-01T00:00:00.000Z"}]'::jsonb
  );

  select payload into v_payload from public.recordatorios where id = 'a-1';
  if v_payload->>'name' <> 'De A' then
    raise exception 'un cambio viejo pisó el nuevo: %', v_payload;
  end if;

  -- La bajada devuelve solo lo de A y avanza el cursor.
  perform public.bajar_cambios(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    repeat('a', 64),
    0,
    100
  );
end;
$$;

-- A igual hora, el servidor desempata por el id del dispositivo: el equipo B (id mayor) gana y el
-- equipo A no puede pisarlo con la misma marca de tiempo.
reset role;
insert into public.recordatorios (user_id, id, payload, updated_at, dispositivo_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'a-3',
  '{"name":"Empate inicial"}'::jsonb,
  now() - interval '1 minute',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);

set local role authenticated;
do $$
declare
  v_hora timestamptz;
  v_payload jsonb;
begin
  select updated_at into v_hora from public.recordatorios where id = 'a-3';

  perform public.subir_cambios(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object(
      'entidad', 'recordatorios',
      'id', 'a-3',
      'payload', jsonb_build_object('name', 'Gana B'),
      'actualizadoEn', v_hora
    ))
  );

  select payload into v_payload from public.recordatorios where id = 'a-3';
  if v_payload->>'name' <> 'Gana B' then
    raise exception 'el desempate por dispositivo no eligió a B: %', v_payload;
  end if;

  perform public.subir_cambios(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    repeat('a', 64),
    jsonb_build_array(jsonb_build_object(
      'entidad', 'recordatorios',
      'id', 'a-3',
      'payload', jsonb_build_object('name', 'Gana A'),
      'actualizadoEn', v_hora
    ))
  );

  select payload into v_payload from public.recordatorios where id = 'a-3';
  if v_payload->>'name' <> 'Gana B' then
    raise exception 'un dispositivo menor pisó el empate: %', v_payload;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Cuenta B: no ve lo de A ni puede usar el dispositivo de A
-- ---------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aud":"authenticated"}';

do $$
declare
  v_total integer;
begin
  select count(*) into v_total from public.recordatorios;
  if v_total <> 1 then
    raise exception 'B debería ver 1 recordatorio y ve %', v_total;
  end if;

  select count(*) into v_total from public.recordatorios where id like 'a-%';
  if v_total <> 0 then
    raise exception 'B está viendo filas de A';
  end if;

  begin
    perform public.bajar_cambios(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      repeat('a', 64),
      0,
      100
    );
    raise exception 'B pudo bajar con el dispositivo de A';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select 'OK · RLS y motor de las fases 2 y 3 verificados' as resultado;

rollback;
