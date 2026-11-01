# Nube de AVISPATE · Etapas 10 a 16 (avisos, entrega real, cuenta, sincronización y calendarios)

Supabase guarda la suscripción de cada teléfono y la cola de avisos que el teléfono calculó. Cada
minuto, un cron llama a una función que entrega lo que ya venció por el canal de cada fila: **push**
(notificación del navegador), **WhatsApp** (Cloud API de Meta) o **correo** (Resend). El servidor
**no** calcula fechas: las repeticiones y la zona horaria viven en el teléfono.

```
teléfono (calcula {cuando, titulo, cuerpo, canal, destino, zona})
      │  POST /rest/v1/rpc/sincronizar_avisos
      ▼
Supabase · dispositivos + avisos  ◀── cron cada minuto ──▶ Edge Function enviar-avisos
      │                                                          │
      │                          ┌──────── push (VAPID) ◀────────┤
      │                          ├──────── WhatsApp Cloud API ◀──┤
      │                          └──────── Resend ◀───────────────┤
      │                                                          ▼
      └──────────── webhook de estados ◀──── enviar-avisos / webhooks-envio
```

## Puesta en marcha (una sola vez)

1. **Tablas y cron.** En Supabase → *SQL Editor*, pegá
   `supabase/migrations/0001_etapa10.sql` con `<ANON_KEY>` cambiada por la anon key del proyecto
   (*Project Settings → API keys → anon public*). Es la misma clave pública que usa la app, así que no
   hay ningún secreto nuevo en la base. Después, *Run*. El archivo del repo conserva el marcador a
   propósito: si lo corrés tal cual, el editor avisa *«Falta la anon key en v_anon»* y el cron queda
   sin autorización.
   Al final, esta consulta debe devolver dos filas (`avispate-avisos` y `avispate-limpieza`):

   ```sql
   select jobname, schedule, active from cron.job where jobname like 'avispate-%';
   ```

   Si el editor dice que no existe `net.http_post`, habilitá las extensiones **pg_cron** y **pg_net**
   en *Database → Extensions* y volvé a correr el bloque del cron.

   **Etapa 11.** Después de la 0001, corré también `supabase/migrations/0002_etapa11.sql` (esa no lleva
   ningún marcador que cambiar). Agrega `pospuesto_en` —la marca que evita que la sincronización borre un
   aviso pospuesto—, las funciones `posponer_aviso` y `resumen_cola`, y vuelve a crear
   `sincronizar_avisos` para respetar esa marca. Es idempotente. Al final, esto debe devolver dos filas:

   ```sql
   select proname from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('posponer_aviso', 'resumen_cola');
   ```

   **Etapa 14.** Por último, `supabase/migrations/0003_etapa14.sql` (tampoco lleva marcadores). Agrega
   `canal`, `destino`, `perfil_id`, `zona`, `estado`, `entregado_en`, `proveedor_id` y
   `proximo_intento`; cambia la clave de `avisos` a `(dispositivo_id, id, canal)`; crea `probar_canal`,
   `ultimos_envios` y la vista `envios`; y vuelve a crear `sincronizar_avisos` y `resumen_cola`. Al
   final, estas dos consultas deben devolver las funciones nuevas y una clave que incluya `canal`:

   ```sql
   select proname from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('probar_canal', 'ultimos_envios', 'sincronizar_avisos', 'resumen_cola');
   select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.avisos'::regclass and contype = 'p';
   ```

   **Etapa 15.** Después de la 0003, corré `supabase/migrations/0004_etapa15.sql`. Crea
   `perfiles_cuenta` y `dispositivos_cuenta` con RLS de solo lectura por usuario, el disparador que
   crea el perfil al nacer una cuenta y las funciones `reclamar_dispositivo`,
   `desvincular_dispositivo` y `mis_dispositivos`, ejecutables **solo** por `authenticated`. Al final,
   esto debe devolver las tres funciones:

   ```sql
   select proname from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('reclamar_dispositivo', 'desvincular_dispositivo', 'mis_dispositivos');
   ```

   Después, `supabase/migrations/0005_etapa15_datos.sql` (tampoco lleva marcadores). Crea las cinco
   tablas por entidad (`recordatorios`, `categorias`, `perfiles`, `ajustes`, `marcas`), el índice de
   borrados `tumbas`, la secuencia `sync_seq` y las funciones `subir_cambios`, `bajar_cambios` y
   `purgar_tumbas`. Es idempotente y no toca las tablas de avisos. Al final, estas consultas deben
   devolver las cinco tablas y las tres funciones:

   ```sql
   select tablename from pg_tables
    where schemaname = 'public'
      and tablename in ('recordatorios','categorias','perfiles','ajustes','marcas','tumbas')
    order by tablename;
   select proname from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('subir_cambios','bajar_cambios','purgar_tumbas');
   ```

   Después, `supabase/migrations/0006_etapa15_dispositivos.sql` agrega el nombre propio por cuenta y
   las funciones `renombrar_dispositivo` y `desvincular_todos_dispositivos`; vuelve a crear
   `mis_dispositivos` para devolver ese nombre. Es idempotente:

   ```sql
   select proname from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('renombrar_dispositivo','desvincular_todos_dispositivos','mis_dispositivos');
   ```

   Luego, `supabase/migrations/0007_etapa15_adjuntos.sql` crea el bucket **privado** `adjuntos`
   (10 MB y tipos permitidos) y sus cuatro políticas por dueño. La primera carpeta de la ruta es el
   `auth.uid()`: cada cuenta solo ve y toca lo suyo. Comprobación:

   ```sql
   select id, public, file_size_limit from storage.buckets where id = 'adjuntos';
   select policyname, cmd from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'adjuntos:%';
   ```

   Por último, `supabase/migrations/0008_etapa15_realtime.sql` agrega las cinco tablas del motor a la
   publicación `supabase_realtime`. Sin esa publicación el WebSocket se une pero no recibe cambios;
   el sondeo de 45 s sigue funcionando igual. Comprobación:

   ```sql
   select tablename from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
    order by tablename;
   ```

   **Etapa 16.** Después de la 0008, corré `supabase/migrations/0009_etapa16_calendarios.sql`. Crea
   `calendarios_cuenta` (tokens cifrados), `eventos_calendario` (enlace antiduplicados) y
   `oauth_estado` (PKCE de un solo uso), con RLS. El navegador no tiene `select` sobre las tablas:
   la app lee por `calendarios-oauth /estado`, que devuelve solo columnas públicas y nunca tokens.
   `mis_calendarios()` sigue disponible para consultas autenticadas. `completar_oauth()` solo la
   puede ejecutar `service_role`. Comprobación:

   ```sql
   select tablename from pg_tables
    where schemaname = 'public'
      and tablename in ('calendarios_cuenta','eventos_calendario','oauth_estado')
    order by tablename;
   select proname from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('mis_calendarios','completar_oauth','purgar_oauth_estado');
   -- Debe devolver false: la app no puede leer la tabla de tokens.
   select has_table_privilege('authenticated', 'public.calendarios_cuenta', 'select');
   ```

   Las migraciones de la Etapa 15 no llevan marcadores que cambiar. Las pruebas negativas
   `supabase/tests/0005_negativo.sql` y `0006_negativo.sql` se corren al final, contra el proyecto y
   dentro de una transacción que termina en `rollback`.

2. **Secretos de las funciones.** El proyecto ya tiene las claves VAPID en `.env.local` (que no se
   versiona). Se suben a Supabase así:

   ```bash
   npx --yes supabase@latest login
   npx --yes supabase@latest link --project-ref vmctsurhswayrrwrkggj
   npx --yes supabase@latest secrets set --env-file supabase/.env.functions
   ```

   El `--yes` evita que `npx` se quede esperando un «Ok to proceed?» que nadie ve. Para la Etapa 14,
   `supabase/.env.functions` suma (con los valores de las cuentas, nunca en el repo):

   | Secreto | Para qué |
   | --- | --- |
   | `WHATSAPP_TOKEN` | token permanente de la app de Meta (System User) |
   | `WHATSAPP_PHONE_ID` | id del número verificado en WhatsApp Business |
   | `WHATSAPP_TEMPLATE` | nombre de la plantilla de utilidad aprobada (por defecto `avispate_recordatorio`) |
   | `WHATSAPP_TEMPLATE_LANG` | idioma de la plantilla (`es` por defecto) |
   | `WHATSAPP_API_VERSION` | opcional; `v21.0` por defecto |
   | `RESEND_API_KEY` | clave de Resend con permiso de envío |
   | `EMAIL_FROM` | remitente verificado, por ejemplo `AVISPATE <avisos@avispate.app>` |
   | `WHATSAPP_VERIFY_TOKEN` | palabra que se pega en la consola de Meta para verificar el webhook |
   | `WHATSAPP_APP_SECRET` | App Secret de Meta, para validar `x-hub-signature-256` |
   | `RESEND_WEBHOOK_SECRET` | secreto `whsec_…` del webhook de Resend (Svix) |
   | `WEBHOOK_TOKEN` | respaldo simple para probar el webhook con `?secreto=…` |
   | `GOOGLE_CLIENT_ID` | client id **Web application** de Google Cloud (Etapa 16) |
   | `GOOGLE_CLIENT_SECRET` | client secret de esa credencial |
   | `CALENDARIOS_MODO` | `simulado` (por defecto) o `real` |
   | `CALENDARIOS_TOKEN_KEY` | clave AES-256 de 32 bytes en base64: `openssl rand -base64 32` |
   | `CALENDARIOS_APP_URL` | a dónde vuelve el callback; por defecto `https://avispate-app.vercel.app` |
   | `CALENDARIOS_APP_URLS` | opcional; orígenes extra separados por coma (por ejemplo `http://localhost:8443`) |

   Si falta un grupo de secretos, ese canal queda «Falta configurar en la nube» en Ajustes y la
   función falla solo esas filas; el push y los avisos locales siguen funcionando. Sin
   `CALENDARIOS_MODO=real`, los calendarios usan el adaptador simulado y **no** llaman a Google.

3. **Publicar las funciones.** La de entrega y la de estados:

   ```bash
   npx --yes supabase@latest functions deploy enviar-avisos --project-ref vmctsurhswayrrwrkggj
   npx --yes supabase@latest functions deploy webhooks-envio --project-ref vmctsurhswayrrwrkggj --no-verify-jwt
   npx --yes supabase@latest functions deploy calendarios-oauth --project-ref vmctsurhswayrrwrkggj --no-verify-jwt
   npx --yes supabase@latest functions deploy calendarios-sync --project-ref vmctsurhswayrrwrkggj
   ```

   `enviar-avisos` queda con la verificación de JWT activada (la de por defecto): el cron y la app
   mandan la anon key, que es un JWT válido del proyecto y ya es pública. `webhooks-envio` y
   `calendarios-oauth` se publican **sin** esa verificación porque Meta, Resend y Google no mandan un
   JWT de Supabase: se protegen con la firma del proveedor, el `state` de un solo uso y la
   comprobación manual del Bearer en las rutas autenticadas. `calendarios-sync` conserva la
   verificación por defecto.

   Desde la Etapa 14 la entrega también manda WhatsApp y correo: si venís de la Etapa 11, **volvé a
   publicar `enviar-avisos`** con este mismo comando. Las dos funciones de calendarios no se publican
   hasta que la 0009 esté aplicada; el modo simulado funciona sin credenciales de Google.

4. **Probar a mano.** El GET dice qué canales están configurados (solo booleanos); el POST entrega lo
   vencido:

   ```bash
   source .env.local
   curl -s "https://vmctsurhswayrrwrkggj.supabase.co/functions/v1/enviar-avisos" \
     -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
   # {"ok":true,"canales":{"push":true,"whatsapp":true,"email":true,"plantilla":"avispate_recordatorio"}}

   curl -s -X POST "https://vmctsurhswayrrwrkggj.supabase.co/functions/v1/enviar-avisos" \
     -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{}'
   ```

5. **La app.** `.env.local` ya tiene la URL, la anon key y la VAPID pública. Compilá y abrí el preview:

   ```bash
   npm run build && npm run preview   # https://localhost:8443
   ```

   En Ajustes → *Avisos con la app cerrada* → *Activar avisos* → *Probar aviso*. La prueba llega en
   menos de un minuto, con la app cerrada. Para WhatsApp y correo, la tarjeta **«Entrega real»** dice
   si falta el dato, el ticket o la configuración de la nube, y tiene su propio «Probar» por canal.

## Cuenta con enlace mágico (Etapa 15)

La cuenta es opcional: el onboarding no la pide y el modo invitado sigue funcionando. Quien la crea
entra desde **Ajustes → Cuenta** con un enlace mágico; no hay contraseñas ni un backend propio.

### Configurar Auth (una sola vez)

1. **URL Configuration** en Supabase → *Authentication → URL Configuration*. Ya quedó configurado y
   aplicado al proyecto desde `supabase/config.toml`:
   - *Site URL*: `https://avispate-app.vercel.app`
   - *Redirect URLs*: el alias nuevo, el anterior (`recuerdapapi.vercel.app`), y `localhost`/`127.0.0.1`
     en los puertos 8443 y 5173 para desarrollo.

   El enlace del correo vuelve con los tokens en el hash; si la dirección no está en la lista,
   Supabase manda al *Site URL* y la app no puede cerrar el círculo. No hace falta permitir todos los
   previews de Vercel: cada despliegue de producción usa el alias. Si cambia el dominio, editá
   `supabase/config.toml` y corré `supabase config diff` y `supabase config push`; el archivo no
   contiene secretos.
2. **Email provider** (*Authentication → Providers → Email*): alcanza con el proveedor por defecto.
   Supabase manda el enlace con su plantilla; el remitente y el límite de envíos se cambian en
   *Authentication → Rate Limits* si hace falta. Para producción conviene configurar un SMTP propio
   (Resend, por ejemplo), porque el correo compartido de Supabase tiene un tope bajo.
3. **Usuarios**: no hay que crearlos a mano. `enviarEnlace` manda `create_user: true` y el primer
   enlace crea la cuenta; el disparador de la 0004 crea su fila en `perfiles_cuenta`.

### Cómo funciona

- `src/lib/cuenta.ts` pide el enlace a `POST /auth/v1/otp` con `redirect_to` y, cuando el correo
  vuelve, pide `GET /auth/v1/user` con el token del hash, guarda la sesión en `avispate.cuenta.v1` y
  limpia el hash. La sesión se renueva con el refresh token un minuto antes de vencer.
- «Vincular este teléfono» llama a `reclamar_dispositivo` con el id y el **token** del dispositivo.
  La función exige `auth.uid()` y comprueba el token; el `user_id` nunca viaja como parámetro.
- La tarjeta muestra la cuenta, el estado del vínculo y los teléfonos vinculados, con su última
  conexión real. Cada teléfono se puede renombrar o cerrar desde otro equipo; «Cerrar sesión en
  todos» llama a `desvincular_todos_dispositivos` y después a `/auth/v1/logout?scope=global`.
- Al salir, la app pregunta si conservar o borrar la copia local. Borrar vacía localStorage (salvo
  la identidad del dispositivo) y las bases de adjuntos; el modo invitado sigue funcionando.
- La sesión **no** entra en las copias de seguridad: `CLAVES_COPIA` no la incluye.

### Probar

1. En Ajustes → Cuenta, escribí un correo y tocá **Enviar enlace mágico**.
2. Abrí el correo en el mismo teléfono y tocá el enlace. La app vuelve, muestra «Cuenta de …» y deja
   el hash limpio.
3. Tocá **Vincular este teléfono**. En la base, `dispositivos_cuenta` debe tener una fila con el
   `user_id` de la cuenta y el `dispositivo_id` del teléfono.
4. Cerrá sesión y volvé a entrar: la sesión se guarda entre arranques; los datos locales no se tocan.

### RLS: la prueba negativa

La 0004 deja las dos tablas con `enable row level security` y una sola política `select` para
`authenticated` (`auth.uid() = user_id`). `anon` no tiene `select`, `insert`, `update` ni `delete`, y
las funciones están revocadas de `public`/`anon` y concedidas solo a `authenticated`.

La prueba que se corrió contra el proyecto (en una transacción que se revierte) crea dos cuentas y
dos dispositivos, se pone en el rol `authenticated` con el `sub` de la primera y comprueba que:

- ve su perfil y su dispositivo, y **no** ve los de la segunda;
- `reclamar_dispositivo` vincula su teléfono con su token y rechaza un token ajeno (`42501`);
- un `insert` directo en `perfiles_cuenta` o `dispositivos_cuenta` como `authenticated` falla por
  permisos.

Para repetirla, usá el mismo enfoque con `npx supabase db query --linked --file <archivo.sql>` y
cerrá siempre con `rollback`. Si querés una comprobación rápida de las políticas:

```sql
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public' and tablename like '%cuenta%';
```

### Sincronización (fases 2 y 3)

Con la cuenta vinculada, la app sube y baja las cinco entidades. La verdad sigue en el teléfono: el
servidor guarda el `payload` completo y aplica la misma regla de conflicto que el cliente.

- **Subida:** `subir_cambios(dispositivo, token, cambios)` recibe un lote de hasta 200 cambios
  `{entidad, id, payload, actualizadoEn, eliminadoEn?}`. Exige la sesión (`auth.uid()`), el token del
  dispositivo y que ese dispositivo esté vinculado a la cuenta. Un cambio inválido o ajeno se cuenta
  como `ignorados`; no rompe el lote entero.
- **Bajada:** `bajar_cambios(dispositivo, token, desde, limite)` devuelve las filas con `seq` mayor
  que el cursor, ordenadas. El `seq` sale de una secuencia compartida y se actualiza en cada alta,
  edición o borrado. Las filas borradas también vuelven (`deleted_at`), para que el otro teléfono
  borre su copia.
- **Conflicto:** `updated_at` mayor gana; si empatan, `dispositivo_id` mayor; si también empatan,
  `md5(payload)` mayor. Una hora futura se acota a «ahora» y una anterior al año 2000 se descarta.
- **Tumbas:** `tumbas` guarda el índice de borrados para no bajar la tabla entera; `purgar_tumbas(90)`
  borra las filas y las marcas viejas. Esa función **no** se expone a `authenticated`: se llama desde
  el SQL Editor o un cron interno.
- **Prueba negativa:** `supabase/tests/0005_negativo.sql` crea dos cuentas y dos dispositivos dentro
  de una transacción y comprueba RLS, token incorrecto, dispositivo no vinculado, `anon`, borrado
  lógico y el desempate por dispositivo. `supabase/tests/0006_negativo.sql` suma renombre, cierre de
  todos los vínculos, el rechazo del motor para un equipo desvinculado, el bucket privado y las cinco
  tablas de Realtime. Las dos se corren después de aplicar todas las migraciones y se revierten.

### Adjuntos en Storage (fase 5)

El bucket `adjuntos` es privado y la app lo usa por la API REST, sin SDK. La ruta de cada archivo es
`{auth.uid()}/{id}` y las cuatro políticas de `storage.objects` comparan la primera carpeta con
`auth.uid()`: una cuenta no puede leer ni borrar la carpeta de otra. Los archivos se suben con
`POST /storage/v1/object/adjuntos/{ruta}` y `x-upsert: true`; para mostrarlos se pide
`POST /storage/v1/object/sign/adjuntos/{ruta}` y se usa la URL firmada (una hora). El borrado es
`DELETE /storage/v1/object/adjuntos/{ruta}`. Si el bucket o la red fallan, el archivo sigue en
IndexedDB y en la cola `avispate.adjuntos.cola.v1`.

### Realtime (fase 6)

La app abre `wss://<proyecto>.supabase.co/realtime/v1/websocket?apikey=…&vsn=1.0.0`, se une al canal
`realtime:avispate` con el access token de la cuenta y pide `postgres_changes` de `recordatorios`,
`categorias`, `perfiles`, `ajustes` y `marcas`, filtrados por `user_id=eq.{id}`. Las políticas
`select` son las que deciden qué filas viajan. Un aviso dispara una pasada del motor; si el canal se
cae, se reconecta con espera creciente y el sondeo de 45 s sigue siendo la red de seguridad.

### Lo que todavía no hace la cuenta

La sincronización lleva las cinco entidades, los adjuntos y los avisos de Realtime entre teléfonos de
la misma cuenta. Queda el historial de versiones para un conflicto, la descarga masiva de adjuntos y
la restauración completa cuando un teléfono estuvo más de 90 días sin abrir. Los detalles están en
[`docs/etapa15-cuenta-y-sincronizacion.md`](../docs/etapa15-cuenta-y-sincronizacion.md).

## Calendarios de ida y vuelta (Etapa 16)

### Cómo funciona

- `src/lib/calendarios.ts` pide el estado a `GET /functions/v1/calendarios-oauth/estado` y, al tocar
  **Conectar con Google Calendar**, hace `POST /iniciar` con el Bearer de la sesión y el `perfilId`
  del usuario local activo. La función crea un `state` + PKCE S256 de un solo uso y devuelve la URL
  de consentimiento. Cada perfil (Yo, Abuela, Empresa) tiene su propia conexión.
- Google vuelve a `.../functions/v1/calendarios-oauth/callback/google?code=…&state=…`. La función
  cambia el código por tokens, los cifra con AES-256-GCM (`CALENDARIOS_TOKEN_KEY`) y llama a
  `completar_oauth()`; después redirige a la app con `?calendario=google&estado=conectado`.
- **Sincronizar ahora** manda `POST /functions/v1/calendarios-sync` con la foto de recordatorios y
  `completo: true` si «Todos los avisos» está encendido. El servidor guarda el id externo en
  `eventos_calendario` (la segunda pasada actualiza, no duplica) y, con la foto completa, borra lo
  que ya no está. Después baja los cambios con el `syncToken` de Google.
- **Desconectar** revoca el token en Google y borra la conexión y sus enlaces.
- `CALENDARIOS_MODO=simulado` (por defecto) usa un adaptador sin red: el circuito completo se puede
  probar hoy y la UI lo muestra como **«Modo de prueba»**. No hay tokens ni llamadas a Google.

### Configurar Google (cuando estén las credenciales)

1. En **Google Cloud Console** creá un proyecto, habilitá **Google Calendar API** y configurá la
   pantalla de consentimiento. Scope:
   `https://www.googleapis.com/auth/calendar.events` (la función además pide `openid email` para
   mostrar la cuenta).
2. Creá credenciales **OAuth client ID → Web application** con el redirect URI exacto:
   `https://vmctsurhswayrrwrkggj.supabase.co/functions/v1/calendarios-oauth/callback/google`.
3. Guardá en Supabase `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDARIOS_MODO=real` y una
   `CALENDARIOS_TOKEN_KEY` de 32 bytes en base64 (`openssl rand -base64 32`). Para desarrollo agregá
   el origen local a `CALENDARIOS_APP_URLS`.
4. Aplicá la 0009 y publicá las dos funciones (los comandos están arriba). En modo real, sin la clave
   o sin las credenciales, la conexión devuelve un error claro y no guarda nada.

### Probar

1. En Ajustes → Calendarios → Google Calendar, tocá **Conectar con Google Calendar**. En modo
   simulado la tarjeta queda en «✓ Modo de prueba»; en modo real vuelve de Google con
   «Google Calendar conectado».
2. Tocá **Sincronizar ahora**. La tarjeta cuenta cuántos recordatorios subieron y `eventos_calendario`
   debe tener una fila por cada uno. Repetí: no debe haber duplicados.
3. Borrá un recordatorio con «Todos los avisos» encendido y sincronizá: el evento externo se borra y
   el enlace queda `borrado`.
4. Tocá **Desconectar**: la conexión y sus enlaces desaparecen y el token se revoca en Google.

## WhatsApp y correo (Etapa 14)

### WhatsApp Cloud API

1. En **Meta for Developers**, creá (o abrí) la app de AVISPATE y agregá el producto **WhatsApp**. En
   *WhatsApp → API Setup* copiá el **Phone number ID** (`WHATSAPP_PHONE_ID`).
2. Generá un **token permanente** desde un System User de Meta Business (`WHATSAPP_TOKEN`) con los
   permisos `whatsapp_business_messaging` y `whatsapp_business_management`. El token temporal del panel
   vence en 24 h y no sirve para producción.
3. Creá la **plantilla de utilidad** en *WhatsApp Manager → Message templates*. Nombre:
   `avispate_recordatorio` (o el que pongas en `WHATSAPP_TEMPLATE`), idioma `es`, categoría
   *Utility*, cuerpo con tres variables (el texto fijo al principio es obligatorio: Meta no acepta
   una plantilla que empiece o termine con una variable):

   ```
   Hola. Este es un recordatorio de AVISPATE: {{1}}
   {{2}}
   Fecha y hora: {{3}}
   Abrí AVISPATE para ver el detalle, marcarlo como hecho o posponerlo.
   ```

   AVISPATE manda en `{{1}}` el título con emoji, en `{{2}}` el mensaje («… vence en 2 días») y en
   `{{3}}` la fecha en la zona horaria del teléfono. Los valores de ejemplo de la plantilla deben
   respetar ese orden; Meta los revisa y puede tardar unas horas. El texto fijo de la plantilla es
   solo de la plantilla: la función no lo manda. Hace falta ese texto de contexto porque Meta rechaza
   las plantillas con demasiadas variables en relación con su longitud (`2388293`).
4. **Webhook.** En *WhatsApp → Configuration*, URL de callback:
   `https://vmctsurhswayrrwrkggj.supabase.co/functions/v1/webhooks-envio` y verify token
   `WHATSAPP_VERIFY_TOKEN`. Suscribí el campo `messages` (ahí llegan los estados `sent`, `delivered`,
   `read` y `failed`). La función responde el `hub.challenge` y valida `x-hub-signature-256` con
   `WHATSAPP_APP_SECRET`.

   El **App Secret** no está en WhatsApp Manager: se copia en *Meta for Developers → tu app →
   Configuración de la app → Básica → Clave secreta de la app*. No es el token de WhatsApp. Para
   registrar la callback por API, Meta exige un **app access token** (`{app-id}|{app-secret}`); el
   token de System User no sirve para `POST /{app-id}/subscriptions`. También se puede registrar a
   mano desde *WhatsApp → Configuration*, sin App Secret. En ese caso la función acepta los eventos
   con `?secreto=WEBHOOK_TOKEN` hasta que cargues el secreto y pueda validar la firma.

#### Estado de esta instalación (19-10-2026)

- La WABA activa es la **de prueba**: «Test WhatsApp Business Account» (`2206008886998029`), con el
  número `+1 555-197-5017` (`WHATSAPP_PHONE_ID=1442076502314919`).
- La app **Avispate** (`1096911179875557`) ya está suscrita a esa WABA (`subscribed_apps`) y el
  webhook a nivel app está registrado y activo con el campo `messages`.
- `WHATSAPP_APP_SECRET` está cargado y la función valida `x-hub-signature-256`: una firma correcta
  devuelve `200`; una firma ausente o incorrecta, `401`.
- El `WHATSAPP_TOKEN` actual es el **temporal de API Setup** y vence el **19-10-2026 a las 02:00
  -03** (05:00 UTC). Para producción hay que asignar una WABA real al System User `AVISPATE API`,
  generar el token permanente, recrear la plantilla y volver a cargar los secretos. Las WABAs de
  prueba no se pueden asignar a un System User.
- Los secretos de WhatsApp de esta instalación se cargan desde `supabase/.env.whatsapp.local` (no
  versionado); `supabase/.env.whatsapp.secrets` quedó obsoleto y no se usa.
- `enviar-avisos` incluye las cabeceras CORS (`Access-Control-Allow-Origin: *`, `-Headers` y
  `-Methods`): la PWA puede consultar el estado de los canales desde el celular. Verificado el
  19-10-2026: `OPTIONS` y `GET` responden `200` con `whatsapp: true`.
- Para la prueba desde el celular, el número guardado en **Contacto** debe estar en *Meta → WhatsApp
  → API Setup → To → Manage phone number list* (WABA de prueba). Si falta, Meta responde `131030`
  y el error queda en «Últimos envíos».

### Correo con Resend

1. Agregá el dominio en **Resend → Domains** y copiá los registros DNS que indica: **SPF**, **DKIM** y
   un **DMARC** mínimo (`v=DMARC1; p=none; rua=mailto:…`) para empezar a mirar rebotes. Sin DKIM
   verificado, Resend rechaza el envío desde ese dominio.
2. Creá una **API key** de envío (`RESEND_API_KEY`) y poné el remitente verificado en `EMAIL_FROM`
   (`"AVISPATE <avisos@avispate.app>"`, entre comillas en `.env.functions`).
3. **Webhook.** En *Resend → Webhooks*, URL
   `https://vmctsurhswayrrwrkggj.supabase.co/functions/v1/webhooks-envio`, eventos `email.sent`,
   `email.delivered`, `email.bounced`, `email.complained` y `email.failed`. Copiá el secreto
   `whsec_…` a `RESEND_WEBHOOK_SECRET`; la función valida la firma Svix con cinco minutos de
   tolerancia.

### Cómo se entrega y qué pasa si falla

- El cron llama a `enviar-avisos` cada minuto. Cada fila se **reclama** antes de mandarse
  (`proximo_intento` pasa a +5 min), así dos pasadas cruzadas no duplican un envío.
- Un fallo incrementa `intentos`, guarda `ultimo_error` y deja `proximo_intento` con espera creciente
  (1, 2, 4, 8… minutos, tope 1 h). A los 5 intentos la fila queda `fallido` y se explica en Ajustes.
- Hay un **tope diario** de 60 WhatsApp + correo por dispositivo en 24 h; al alcanzarlo, las filas
  esperan 12 h. Es un seguro contra bucles, no un límite de producto.
- El **push** se marca `entregado` cuando el servicio lo acepta (no tiene webhook). WhatsApp y correo
  pasan a `entregado` solo cuando el proveedor lo confirma.
- Los estados nunca retroceden: un `delivered` atrasado no pisa un `entregado`, y un `sent` solo
  asciende desde `en_cola`.
- Meta solo permite plantillas fuera de la ventana de 24 h; por eso todos los avisos usan la
  plantilla aprobada y no texto libre. Si la plantilla cambia de nombre o de idioma, se actualizan
  `WHATSAPP_TEMPLATE` y `WHATSAPP_TEMPLATE_LANG` y se vuelve a publicar la función (los secretos se
  leen en cada invocación, así que no hace falta tocar el código).

### Probar sin esperar al cron

En Ajustes → *Avisos con la app cerrada* → **Entrega real** → «Probar». La prueba se encola como
cualquier aviso y sale en la próxima pasada (menos de un minuto). El estado aparece en «Últimos
envíos» al tocar «Revisar ahora» en la tarjeta de salud o al volver a Ajustes.

## Cómo está protegido

- Las tablas tienen RLS **sin políticas**: la clave pública que viaja al navegador no puede leer ni
  escribir nada directamente.
- Las cuatro funciones de la Etapa 10 (`registrar_dispositivo`, `olvidar_push`, `sincronizar_avisos`,
  `probar_aviso`), las dos de la Etapa 11 (`posponer_aviso`, `resumen_cola`) y las dos de la Etapa 14
  (`probar_canal`, `ultimos_envios`) son `security definer` y exigen el **token** del dispositivo
  (32 bytes al azar, guardados solo en ese teléfono). El id del dispositivo solo no alcanza.
- La función de entrega usa la `service_role` (secreta, la pone Supabase sola) y no acepta datos: solo
  lee lo vencido y manda. El webhook también usa `service_role`, pero solo actualiza filas cuyo
  `proveedor_id` coincide con el id que devolvió el proveedor; no puede crear envíos nuevos.
- `destino` (número o correo) es un dato personal y vive en la base igual que el contacto del usuario:
  no se muestra en ninguna tabla pública, y la vista `envios` está revocada para `anon`. Sigue colgada
  del dispositivo; el motor de sincronización de la Etapa 15 no lleva `avisos`, así que esa columna
  todavía no tiene una política por usuario.
- La cuenta (Etapa 15) suma sus propias reglas: `perfiles_cuenta` y `dispositivos_cuenta` tienen RLS
  y una política de `select` por usuario; `anon` no puede leerlas ni escribir directamente. Las
  funciones `reclamar_dispositivo`, `renombrar_dispositivo`, `desvincular_dispositivo`,
  `desvincular_todos_dispositivos` y `mis_dispositivos` están revocadas de `public`/`anon` y solo las
  puede ejecutar `authenticated`. El alta, además de la sesión, exige el token del dispositivo.
- El bucket `adjuntos` y sus cuatro políticas viven en el esquema `storage`; `anon` no tiene acceso y
  cada política comprueba `(storage.foldername(name))[1] = auth.uid()::text`.
- Realtime usa las mismas políticas `select`: la unión al canal no concede permisos por sí sola.
- Las cinco tablas de datos de la 0005 tienen RLS y una política de `select` para `authenticated`
  (`auth.uid() = user_id`); no hay escritura directa, solo `subir_cambios`. `anon` no tiene acceso.
  `subir_cambios` y `bajar_cambios` son `security definer`, exigen sesión, token y vínculo, y revocan
  `public`/`anon`; `purgar_tumbas` no está expuesta a `authenticated`.
- Los secretos de WhatsApp y correo (`WHATSAPP_TOKEN`, `RESEND_API_KEY`, etc.) solo existen como
  variables de entorno de la función: el GET de estado devuelve booleanos y el nombre de la plantilla,
  nunca sus valores. La `VAPID_PRIVATE_KEY` tampoco entra al bundle porque no lleva el prefijo `VITE_`.

## Posponer desde la notificación (Etapa 11)

La notificación ofrece «Posponer 10 min» y «Posponer 1 hora». Al tocarlas no se abre la app: el service
worker llama a `posponer_aviso` con el id del aviso y el token del dispositivo, y la fila vuelve a quedar
pendiente a la hora nueva (`cuando = now() + N minutos`, `enviado_en = null`). La próxima pasada del cron
la entrega.

Para que eso funcione con la app cerrada, el worker necesita dos cosas: la URL y la anon key de Supabase
—se las inyecta el build en `sw.js`, son las mismas que ya viajan en el bundle— y el par id/token del
dispositivo, que la app le manda por mensaje la primera vez y él guarda en IndexedDB (el localStorage de
la página no existe del lado del worker). Si falta cualquiera de las dos, el toque abre la app.

Los avisos pospuestos llevan `pospuesto_en` para que `sincronizar_avisos` no los borre: la cola que sube
el teléfono no los incluye, y sin esa marca se perderían en la próxima sincronización.

## Por qué no se pausa el plan gratuito

Supabase pausa los proyectos gratuitos tras una semana sin actividad. El cron corre **cada minuto**,
así que el proyecto está activo mientras exista: es, de paso, la razón por la que el cron es la pieza
central y no un lujo.

## Si algo no llega

| Síntoma | Qué mirar |
| --- | --- |
| La app dice «Falta conectar la nube» | Falta `VITE_SUPABASE_ANON_KEY` en `.env.local`; hay que recompilar. |
| «Faltan las tablas en Supabase» | No se corrió la migración (paso 1) o se corrió en otro proyecto. |
| La prueba no llega y `enviados` es 0 | La suscripción está vacía: en Ajustes, *Apagar* y *Activar avisos* de nuevo. |
| `401` al llamar la función | Se publicó con `--no-verify-jwt` y el cron manda la anon key, o la anon key del SQL es de otro proyecto. |
| `403` al entregar el push | Las dos claves VAPID públicas tienen que ser la misma: el teléfono se suscribe con `VITE_VAPID_PUBLIC_KEY` y el servidor firma con `VAPID_PUBLIC_KEY`. Se generan juntas, con `node scripts/generar-vapid.mjs`. |
| `ultimo_error` en `avisos` | Ahí queda el motivo que devolvió el servicio de push (claves VAPID distintas, por ejemplo). |
| «Posponer» abre la app en vez de posponer | Falta correr la `0002_etapa11.sql`, o el teléfono no tiene guardadas sus credenciales: *Apagar* y *Activar avisos* de nuevo. |
| La notificación no muestra los botones | El teléfono o el navegador no permiten acciones en las notificaciones (iOS viejo, por ejemplo): tocarla abre la app, que es el camino de siempre. |
| Ajustes dice «Falta configurar en la nube» en WhatsApp | Faltan `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_ID` en los secretos, o el token temporal venció (24 h). Usá el token permanente del System User. |
| Graph responde `190` «Session has expired» | El token no era permanente. En Meta Business → Usuarios → Usuarios del sistema, generá uno nuevo con expiración **Nunca** y los permisos `whatsapp_business_messaging` + `whatsapp_business_management`; guardalo en `WHATSAPP_TOKEN` y volvé a subir los secretos. |
| Meta responde `(#15)` al registrar el webhook | `POST /{app-id}/subscriptions` exige un app access token (`APP_ID|APP_SECRET`); el token de System User no sirve. Cargá `WHATSAPP_APP_SECRET` o registrá la callback a mano desde *WhatsApp → Configuration*. |
| Meta responde `132000` o «template not found» | `WHATSAPP_TEMPLATE` / `WHATSAPP_TEMPLATE_LANG` no coinciden con la plantilla aprobada, o la plantilla todavía está en revisión. |
| WhatsApp falla con `131047` (re-engagement) | Pasaron más de 24 h desde el último mensaje de la persona y la plantilla no está aprobada como *Utility*. Revisá la categoría en WhatsApp Manager. |
| El correo no sale y Resend dice `403` | El dominio no está verificado (SPF/DKIM) o `EMAIL_FROM` usa otro remitente. Revisá *Domains* en Resend. |
| Los correos llegan a spam | Falta DMARC o el dominio es nuevo: publicá `_dmarc`, calentá el dominio y revisá las quejas en Resend. |
| «Entregado» nunca aparece | El webhook no está configurado o la firma falla. Mirá los logs de `webhooks-envio`; el estado queda en `enviado`. |
| `401` en el webhook | La firma no coincide (secreto equivocado) o falta `?secreto=WEBHOOK_TOKEN`. Meta y Resend firman distinto: cada uno tiene su secreto. |
| Ajustes muestra «Falló» con el motivo | Ese es el `ultimo_error` real del proveedor. Después de corregir la causa, la próxima sincronización repone las filas futuras; una prueba manual confirma el arreglo. |
| El enlace de la cuenta no llega | Revisá *Authentication → Rate Limits* y la carpeta de spam. El correo compartido de Supabase tiene un tope bajo; para producción conviene un SMTP propio. |
| El enlace vuelve a otra dirección | La URL de la app no está en *Authentication → URL Configuration → Redirect URLs*. Agregá el alias y, para desarrollo, `localhost`. |
| «La sesión venció» al vincular | El access token expiró y el refresh falló (o se usó en otro dispositivo). Pedí un enlace nuevo desde Ajustes → Cuenta. |
| `403` al reclamar el teléfono | El token del dispositivo no coincide con el de la nube. Recargá la app; si sigue, *Apagar* y *Activar avisos* vuelve a registrar el dispositivo. |
| `42501` en las pruebas de RLS | Es lo esperado: `anon` y `authenticated` no tienen escritura directa. Las altas van por `reclamar_dispositivo`. |
