-- AVISPATE · Etapa 15 — Realtime para los cambios entre teléfonos (fase 6).
--
-- Se corre DESPUÉS de 0007_etapa15_adjuntos.sql, en el SQL Editor de Supabase o con
--   npx supabase db query --linked --file supabase/migrations/0008_etapa15_realtime.sql
-- Es idempotente: se puede volver a correr sin duplicar nada.
--
-- Qué hace:
--
--   1. Se asegura de que exista la publicación `supabase_realtime` (la crea Supabase en los
--      proyectos nuevos).
--   2. Agrega las cinco tablas del motor —recordatorios, categorias, perfiles, ajustes y marcas— a
--      esa publicación, una sola vez. Con eso el servidor manda un aviso cuando otro teléfono
--      escribe.
--   3. Deja la identidad de réplica por defecto (la clave primaria incluye `user_id`): alcanza para
--      que el filtro `user_id=eq.{id}` y las políticas RLS se apliquen también en los borrados.
--
-- La app NO usa el SDK de Supabase: se conecta al WebSocket con el JWT de la cuenta, se une al canal
-- `realtime:avispate` y escucha cambios de esas tablas. Si Realtime no está disponible, el sondeo de
-- 45 segundos sigue funcionando igual.

do $$
declare
  v_tabla text;
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  foreach v_tabla in array array[
    'recordatorios', 'categorias', 'perfiles', 'ajustes', 'marcas'
  ] loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_tabla
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        v_tabla
      );
    end if;
  end loop;
end
$$;

-- Comprobación rápida después de correr esto: deben aparecer las cinco tablas.
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public'
--    order by tablename;
