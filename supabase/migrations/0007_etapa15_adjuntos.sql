-- AVISPATE · Etapa 15 — adjuntos en Storage (fase 5).
--
-- Se corre DESPUÉS de 0006_etapa15_dispositivos.sql, en el SQL Editor de Supabase o con
--   npx supabase db query --linked --file supabase/migrations/0007_etapa15_adjuntos.sql
-- Es idempotente: se puede volver a correr sin duplicar nada.
--
-- Qué agrega:
--
--   1. Un bucket PRIVADO `adjuntos`, con tope de 10 MB y una lista corta de tipos permitidos. La app
--      guarda el archivo original en IndexedDB y esta es la copia que ven los otros teléfonos.
--   2. Políticas de Storage por dueño: la ruta es `{auth.uid()}/{id}` y cada política compara la
--      primera carpeta con `auth.uid()`. Una cuenta no puede leer, subir ni borrar en la carpeta de
--      otra aunque conozca la ruta.
--
-- La app sube por la API REST de Storage con su access token (sin SDK), pide URLs firmadas para
-- mostrar el archivo y borra la copia remota cuando se quita el adjunto. Si no hay sesión o red, el
-- adjunto sigue viviendo solo en el teléfono.

-- ---------------------------------------------------------------------------------------------
-- 1. Bucket privado
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adjuntos',
  'adjuntos',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm',
    'application/pdf', 'text/plain'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------------------------
-- 2. Políticas por dueño
-- ---------------------------------------------------------------------------------------------
-- `storage.foldername(name)` devuelve las carpetas de la ruta; la primera es el id de la cuenta.
drop policy if exists "adjuntos: cada uno ve los suyos" on storage.objects;
create policy "adjuntos: cada uno ve los suyos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "adjuntos: cada uno sube en su carpeta" on storage.objects;
create policy "adjuntos: cada uno sube en su carpeta"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "adjuntos: cada uno actualiza los suyos" on storage.objects;
create policy "adjuntos: cada uno actualiza los suyos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "adjuntos: cada uno borra los suyos" on storage.objects;
create policy "adjuntos: cada uno borra los suyos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'adjuntos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Comprobación rápida después de correr esto:
--   select id, public, file_size_limit from storage.buckets where id = 'adjuntos';
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'adjuntos:%';
