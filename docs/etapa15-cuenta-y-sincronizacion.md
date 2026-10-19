# Etapa 15 · Cuenta y sincronización entre teléfonos (V2.1)

Estado: **Etapa 15 terminada (fases 1 a 6)**. La cuenta, el esquema por entidad, el motor de
sincronización, la lista de dispositivos con cierre remoto, los adjuntos en Storage y Realtime ya
funcionan. El motor sigue siendo opcional: sin cuenta, AVISPATE funciona igual que siempre.

## Objetivo

Que la misma persona vea lo mismo en el teléfono y en la computadora, y que cambiar de teléfono no
dependa de acordarse de descargar una copia. Sin romper la promesa de siempre: **sin nube, AVISPATE
sigue funcionando sola**, y el modo invitado sigue existiendo.

## Decisiones que sostienen la etapa

1. **La cuenta es opcional.** El onboarding no la pide. Quien no quiera cuenta sigue usando la app
   como hoy: todo en `localStorage`, con copias de seguridad.
2. **Enlace mágico, sin contraseña.** Supabase Auth manda un correo; el enlace vuelve a la app con
   los tokens en el hash. No hay pantalla de contraseña que olvidar ni secreto extra en el bundle.
3. **Invitado → cuenta sin duplicar.** «Vincular este teléfono» reclama el dispositivo y la primera
   pasada sube lo que ya hay con ids estables: los recordatorios, las categorías y los perfiles
   conservan su id, así que no se duplica nada. Antes de subir, esa primera pasada baja lo remoto para
   que los valores de fábrica de un teléfono nuevo no pisen una cuenta que ya tiene datos.
4. **La identidad no es permiso.** Saber un `user_id` no alcanza: las escrituras pasan por funciones
   que comprueban `auth.uid()` y, para el alta, el token del dispositivo. Las tablas tienen RLS.
5. **La sesión es del dispositivo, no del respaldo.** `avispate.cuenta.v1` no entra en las copias de
   seguridad: una copia compartida no debe llevarse la llave de nadie.

## Modelo de identidad (Fase 1)

| Tabla | Qué guarda | Quién escribe |
| --- | --- | --- |
| `auth.users` | Correo, id y metadatos de la cuenta (Supabase Auth) | Supabase Auth |
| `perfiles_cuenta` | `user_id`, nombre visible, fechas | Disparador al crear la cuenta |
| `dispositivos_cuenta` | `(user_id, dispositivo_id)`, `nombre` propio de la cuenta, `reclamado_en`, `ultima_conexion` | `reclamar_dispositivo` / `renombrar_dispositivo` / `desvincular_dispositivo` / `desvincular_todos_dispositivos` |
| `storage.objects` (bucket `adjuntos`) | `{user_id}/{id}`, privado, tope de 10 MB y tipos permitidos | La app con el JWT de la cuenta; políticas por carpeta |
| `dispositivos` (Etapa 10) | Id, token, nombre y push del teléfono | `registrar_dispositivo` |
| `recordatorios`, `categorias`, `perfiles`, `ajustes`, `marcas` | `(user_id, id)` + el contenido en `payload` + `updated_at`, `deleted_at`, `revision`, `dispositivo_id`, `seq` | Solo `subir_cambios` |
| `tumbas` | Índice de borrados por entidad, para no bajar la tabla entera | Solo `subir_cambios`; se limpia con `purgar_tumbas` |

Reglas:

- Una cuenta puede tener varios teléfonos; un teléfono puede usarse con más de una cuenta (equipo
  compartido), pero no puede repetir el mismo par.
- `auth.uid()` es la única fuente del `user_id` en las funciones; nunca se acepta como parámetro.
- `anon` no puede ejecutar `reclamar_dispositivo`, `desvincular_dispositivo` ni `mis_dispositivos`.
- El perfil se crea solo con un disparador en `auth.users`; el nombre sale de los metadatos o del
  correo, no de un dato arbitrario del navegador.

## Fases

### Fase 1 · Identidad y vínculo (terminada)

- `src/lib/cuenta.ts`: pedir el enlace, procesar el hash, guardar/renovar/cerrar sesión, reclamar y
  desvincular el teléfono, listar dispositivos. Sin SDK y sin excepciones: siempre `{ ok }`.
- Tarjeta **Cuenta** en Ajustes: correo, «Enviar enlace mágico», estado de la sesión, «Vincular este
  teléfono», lista de dispositivos vinculados y «Cerrar sesión».
- `0004_etapa15.sql`: `perfiles_cuenta`, `dispositivos_cuenta`, RLS de solo lectura por usuario,
  disparador de perfil y las tres funciones autenticadas.
- Suite `tests/e2e-cuenta.mjs`: enlace feliz y vencido, correo inválido, modo sin red, sesión
  persistida, vínculo, desvínculo, cierre de sesión y las comprobaciones estáticas de la migración.

### Fase 2 · Esquema por entidad y RLS (terminada)

- `0005_etapa15_datos.sql`: `recordatorios`, `categorias`, `perfiles`, `ajustes`, `marcas` y el índice
  de borrados `tumbas`, con `(user_id, id)`, `payload` completo, `updated_at`, `deleted_at`,
  `revision`, `dispositivo_id` y `seq`.
- `seq` sale de una secuencia compartida: el cursor es un número y no una fecha, así que dos cambios
  en el mismo milisegundo no se pisan.
- RLS por usuario en todas las tablas; `anon` no puede leer ni escribir. Las funciones del motor
  exigen además el token del dispositivo vinculado.
- Las copias de la Etapa 13/14 se pueden subir con sus ids: una fila con el mismo id se actualiza, no
  se duplica.

### Fase 3 · Motor de sincronización (terminada)

- `src/lib/sync.ts` guarda una **cola de salida por cuenta y dispositivo** en
  `localStorage` (`avispate.sync.v1`): operación con entidad, id, payload y hora. Es deliberado: el
  resto de AVISPATE ya persiste ahí y así la cola sobrevive recargas sin abrir otra base. El costo es
  que el tamaño lo limita el navegador; para adjuntos habrá que moverlos a Storage, no a la cola.
- La cola se sube en **tandas de 200** (el máximo del servidor) y como máximo 10 tandas por pasada:
  una cola enorme no bloquea la app para siempre; la siguiente pasada sigue donde quedó.
- **Cursor de bajada** por cuenta y dispositivo: `bajar_cambios` devuelve las filas con `seq` mayor
  que el cursor, ordenadas y paginadas de 200 en 200. Si una página llega llena, el cliente pide la
  siguiente; el cursor solo avanza hasta el mayor `seq` aplicado.
- **Primera pasada:** baja antes de subir. Así un teléfono nuevo no manda los valores de fábrica
  encima de una cuenta que ya tiene datos. En las demás pasadas se sube y después se baja.
- **Tumbas:** borrar deja `deleted_at`; el cliente guarda la marca para no volver a subir la fila
  como viva. El «Deshacer» local funciona antes de que la tumba salga del teléfono.
- **Conflictos:** gana el `updated_at` más nuevo; si empatan, el `dispositivo_id` mayor; si también
  empatan, el `md5(payload)` mayor. La regla vive igual en el cliente y en el `on conflict` del
  servidor, así que dos teléfonos convergen al mismo resultado.
- **Disparadores:** 1,2 s después de un cambio local, cada 45 s mientras hay cuenta, y al volver la
  conexión (`online`). El botón «Sincronizar ahora» fuerza una pasada y muestra el resultado en la
  tarjeta **Sincronización**. Una pasada a la vez por pestaña.
- **Adjuntos:** el contenido no viaja en el payload de sincronización; viaja a Storage y el
  recordatorio guarda la ruta en `attachments[].remoto`. Si la subida falla, el archivo sigue en
  IndexedDB y queda en la cola local (`avispate.adjuntos.cola.v1`).

### Fase 4 · Dispositivos y sesiones (terminada)

- `0006_etapa15_dispositivos.sql`: nombre propio del teléfono dentro de la cuenta
  (`dispositivos_cuenta.nombre`), `renombrar_dispositivo` y `desvincular_todos_dispositivos`. El
  cierre de UN teléfono reutiliza `desvincular_dispositivo`; la siguiente pasada de ese equipo recibe
  «dispositivo no vinculado» y el motor se apaga.
- La tarjeta **Cuenta** muestra el nombre editable, la última conexión real y el botón de cerrar
  sesión por teléfono. «Cerrar sesión en todos» desvincula todos los equipos y después pide
  `/auth/v1/logout?scope=global`.
- Al salir, la app pregunta una vez: **Conservar mis datos** o **Borrar la copia local**. Borrar
  vacía localStorage (salvo la identidad del dispositivo), las dos bases de adjuntos y vuelve a los
  valores de fábrica.
- Si la nube rechaza este teléfono porque otro lo desvinculó, `sync.ts` devuelve `revocado: true`:
  la sesión sigue abierta, el vínculo local se olvida y Ajustes ofrece «Vincular este teléfono» otra
  vez.

### Fase 5 · Adjuntos en Storage (terminada)

- `0007_etapa15_adjuntos.sql`: bucket privado `adjuntos`, tope de 10 MB, lista de tipos permitidos y
  cuatro políticas (`select`, `insert`, `update`, `delete`) que comparan la primera carpeta con
  `auth.uid()`.
- `src/lib/adjuntos.ts` habla con la API REST de Storage sin SDK: sube con `x-upsert`, pide URLs
  firmadas de una hora, descarga, borra y lista. La cola local guarda los ids que no pudieron subir.
- Al guardar un recordatorio con archivos, primero se guardan en IndexedDB y después se suben (si hay
  sesión). Al abrir un adjunto que no está en el teléfono, se baja con URL firmada y se cachea.
- El detalle dice **En la nube** o **Solo en este teléfono**. Ajustes cuenta los pendientes y permite
  borrar copias huérfanas de Storage sin tocar las referenciadas.

### Fase 6 · Realtime (terminada)

- `0008_etapa15_realtime.sql` agrega las cinco tablas a la publicación `supabase_realtime` (idempotente).
- `src/lib/tiempo-real.ts` abre un WebSocket directo (`/realtime/v1/websocket?vsn=1.0.0`), se une con
  el JWT de la cuenta y pide `postgres_changes` de las cinco tablas filtrados por
  `user_id=eq.{id}`. Tiene latido cada 25 s y reconexión con espera creciente.
- Un aviso del socket dispara una pasada del motor con un respiro de 400 ms. El sondeo de 45 s sigue
  como red de seguridad. La tarjeta de Sincronización muestra el estado del canal y la última tabla
  que avisó.

## Reglas de conflicto (implementadas en la Fase 3)

| Caso | Resultado |
| --- | --- |
| Edición en A y edición en B sin red | Gana el `updated_at` mayor. El perdedor se sobrescribe: todavía no hay historial de versiones; para no perder trabajo, conviene no editar el mismo recordatorio en dos teléfonos a la vez. |
| Borrado en A, edición en B | Gana la operación más nueva. Si gana la edición, la fila revive; si gana el borrado, queda la tumba. |
| Mismo `updated_at` | Desempate por `dispositivo_id` y luego por `md5(payload)`: da el mismo resultado en los dos teléfonos. |
| Reclamar un teléfono que ya tenía datos | Los ids son los mismos: `upsert`, no copia. Las filas idénticas no generan operaciones. |
| Cerrar sesión y volver a entrar | La sesión nueva baja desde el cursor guardado de esa cuenta y ese dispositivo; si el cursor se perdió, bajada completa y merge por ids. |

## Seguridad

- RLS en todas las tablas de cuenta; `anon` sin acceso.
- Funciones `security definer` con `search_path = public, pg_temp`, y `revoke` explícito de `public`.
- El token del dispositivo se sigue guardando en el teléfono y se exige en el alta del vínculo.
- La sesión (access + refresh) vive en `localStorage`; es el compromiso habitual de una SPA sin
  backend propio. Si más adelante se quiere cookie `HttpOnly`, hace falta un backend intermedio.
- Storage replica la misma idea: bucket privado y políticas por carpeta (`auth.uid()`). El teléfono
  pide URLs firmadas de una hora para mostrar un archivo; no hay URLs públicas permanentes.
- Realtime no cambia los permisos: el canal se une con el JWT y las políticas `select` de las tablas
  deciden qué filas pueden viajar.
- Los secretos de proveedores siguen solo en Supabase; el bundle únicamente lleva la anon key.

## Pruebas

- `tests/e2e-sync.mjs`: subida inicial, bajada remota, mismo `updated_at` con desempate por
  dispositivo, tumba remota, caída de red, borrado local y una cola de 205 recordatorios que se parte
  en tandas y se vuelve a bajar paginada.
- `tests/e2e-dispositivos.mjs`: lista con última conexión, renombre, cierre remoto, cierre global,
  conservar/borrar la copia local y el motor apagado cuando la nube rechaza el vínculo.
- `tests/e2e-adjuntos.mjs`: bucket privado y políticas, estado «En la nube»/«Solo en este teléfono»,
  descarga con URL firmada, cola de pendientes y limpieza de huérfanos.
- `tests/e2e-tiempo-real.mjs`: join con JWT, cinco tablas filtradas por usuario, estado en Ajustes,
  aviso que dispara una pasada y reconexión.
- `supabase/tests/0005_negativo.sql` y `supabase/tests/0006_negativo.sql`: RLS, motor, dispositivos,
  Storage y Realtime. Se ejecutan a mano con `psql`/el SQL Editor y terminan en `rollback`.
- `npx tsc --noEmit` y `npm run build` tienen que quedar limpios; la batería usa el `dist/` recién
  construido y avisa si está viejo.

## Limitaciones conocidas

- **Adjuntos entre teléfonos:** el archivo se copia a Storage, pero la descarga se hace al abrir el
  detalle; no hay una descarga masiva ni un botón para «guardar todo offline».
- **Realtime:** si el WebSocket no está disponible, la app sigue con el sondeo de 45 s. El canal no
  reemplaza al motor: solo lo despierta antes.
- **Historial:** el conflicto perdedor no se guarda. Gana la regla LWW y el otro valor se sobrescribe.
- **Purga de tumbas:** `purgar_tumbas` borra las filas y las marcas con más de 90 días. Un teléfono
  que estuvo más de 90 días sin abrir puede perder la noticia de un borrado antiguo y necesita una
  restauración completa; todavía no hay un botón que la dispare.
- **Tamaño:** la cola y los payloads viven en `localStorage`; un cambio se rechaza en el servidor si
  supera 256 KB. Los recordatorios normales entran de sobra, pero no es el lugar para archivos.

## Lo que falta decidir

- ¿Una cuenta puede tener varios «usuarios del dispositivo» (los perfiles de hoy) o cada perfil se
  convierte en una cuenta? La Fase 2 propone que los perfiles sigan siendo del dispositivo y que la
  cuenta sea la persona dueña; los espacios compartidos llegan en la Etapa 17.
- ¿La cuenta se puede borrar desde la app? Hace falta una función con `service_role` y una política
  de retención; por ahora se borra desde el panel de Supabase.
- ¿Qué pasa con los datos locales al cerrar sesión? La Fase 4 ya pregunta **Conservar** o **Borrar**
  después de salir; la elección no se recuerda: se vuelve a preguntar la próxima vez.

