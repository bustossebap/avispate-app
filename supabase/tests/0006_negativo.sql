-- AVISPATE · Etapa 15, fases 4 a 6 — prueba negativa de dispositivos, Storage y Realtime.
--
-- Se corre contra el proyecto vinculado, DESPUÉS de aplicar 0006, 0007 y 0008, y SIEMPRE termina en
-- `rollback`:
--   npx supabase db query --linked --file supabase/tests/0006_negativo.sql
--
-- Comprueba que:
--   * renombrar exige sesión y que el teléfono esté vinculado a esa cuenta;
--   * `desvincular_todos_dispositivos` no toca los vínculos de otra cuenta;
--   * un teléfono desvinculado ya no puede subir cambios;
--   * el bucket `adjuntos` es privado, con tope y cuatro políticas por dueño;
--   * las cinco tablas están en la publicación `supabase_realtime`.
begin;

-- Cuenta A: 11111111-… · Cuenta B: 22222222-…
-- Equipo A: aaaaaaaa-… · Equipo B: bbbbbbbb-…
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'disp-a@avispate.local', '',
   now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'disp-b@avispate.local', '',
   now(), now(), now());

insert into public.dispositivos (id, token, nombre)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('a', 64), 'Equipo A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', repeat('b', 64), 'Equipo B');

insert into public.dispositivos_cuenta (user_id, dispositivo_id, nombre)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A de A'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B de B');

-- ---------------------------------------------------------------------------------------------
-- Cuenta A: renombrar lo propio, no lo ajeno; después cerrar todos sus vínculos
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}';

do $$
declare
  v_total integer;
  v_nombre text;
begin
  perform public.renombrar_dispositivo(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Teléfono de A'
  );
  select nombre into v_nombre
    from public.dispositivos_cuenta
   where user_id = auth.uid()
     and dispositivo_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if v_nombre <> 'Teléfono de A' then
    raise exception 'el renombre no se guardó: %', v_nombre;
  end if;

  begin
    perform public.renombrar_dispositivo(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Robado'
    );
    raise exception 'A pudo renombrar el equipo de B';
  exception when insufficient_privilege then null;
  end;

  select count(*) into v_total from public.mis_dispositivos();
  if v_total <> 1 then
    raise exception 'A debería ver 1 dispositivo y ve %', v_total;
  end if;

  perform public.desvincular_todos_dispositivos();

  select count(*) into v_total from public.dispositivos_cuenta
   where user_id = auth.uid();
  if v_total <> 0 then
    raise exception 'A todavía tiene % vínculos', v_total;
  end if;

  -- Sin vínculo, el motor no puede escribir aunque tenga el token correcto.
  begin
    perform public.subir_cambios(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('a', 64),
      '[{"entidad":"recordatorios","id":"x","payload":{},"actualizadoEn":"2026-10-17T12:00:00.000Z"}]'::jsonb
    );
    raise exception 'el equipo desvinculado pudo subir';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Cuenta B: su vínculo sigue intacto
-- ---------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aud":"authenticated"}';

do $$
declare
  v_total integer;
begin
  select count(*) into v_total from public.dispositivos_cuenta
   where user_id = auth.uid();
  if v_total <> 1 then
    raise exception 'el cierre de A tocó los vínculos de B: %', v_total;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Storage y Realtime (se consultan como dueño de la base)
-- ---------------------------------------------------------------------------------------------
reset role;

do $$
declare
  v_total integer;
  v_public boolean;
  v_limite bigint;
  v_tablas integer;
begin
  select b."public", b.file_size_limit into v_public, v_limite
    from storage.buckets b where b.id = 'adjuntos';
  if v_public is distinct from false or v_limite <> 10485760 then
    raise exception 'el bucket adjuntos no es privado o no tiene el tope de 10 MB';
  end if;

  select count(*) into v_total from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'adjuntos:%';
  if v_total <> 4 then
    raise exception 'faltan políticas de Storage: %', v_total;
  end if;

  select count(*) into v_tablas from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('recordatorios','categorias','perfiles','ajustes','marcas');
  if v_tablas <> 5 then
    raise exception 'faltan tablas en Realtime: %', v_tablas;
  end if;
end;
$$;

reset role;
select 'OK · dispositivos, Storage y Realtime verificados' as resultado;

rollback;
