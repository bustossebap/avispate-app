# Etapa 16 · Calendarios de ida y vuelta

Estado: **cerrada en código — Google real conectado, push verificado y bajada implementada**. La app
cierra el OAuth con PKCE + state, guarda los tokens cifrados en la Edge Function y crea/actualiza/borra
eventos en Google Calendar. La bajada trae a los recordatorios locales los cambios hechos en Google:
se aplica en el cliente con regla de último cambio, se apoya en el `syncToken` de Google y no duplica
los ecos del push de la misma pasada. Está cubierta por la suite; falta la pasada manual de ida y
vuelta con dos cuentas. El adaptador simulado sigue disponible para probar el circuito sin
credenciales. Apple y Outlook conservan su exportación `.ics` y su enlace manual: no se promete una
conexión que el navegador no puede hacer.

## 1. Qué problema resuelve

Hoy «Agregar a Google Calendar» abre una pestaña con el evento rellenado y «Sincronizar ahora» baja
un `.ics`. Eso funciona, pero no es de ida y vuelta: un cambio posterior en AVISPATE no llega al
calendario, y uno hecho en el calendario no vuelve. La Etapa 16 agrega un puente real:

```
Recordatorio local ──► calendarios-sync ──► adaptador (Google | simulado) ──► calendario
        ▲                    │                                                 │
        └──── cambios ◄──────┴──────────── bajar(cursor) ◄─────────────────────┘
```

- **Local primero.** Sin sesión, sin red o sin `VITE_SUPABASE_URL`, nada cambia: se siguen usando el
  enlace de Google y el `.ics`.
- **Servidor con la llave.** El access token y el refresh token viven en Supabase, cifrados, y solo
  los lee la Edge Function con `service_role`. El navegador recibe únicamente el estado del
  calendario (proveedor, cuenta, última sincronización, error).
- **Un adaptador por proveedor.** `calendarios-sync` no conoce la API de Google: llama a
  `crear`, `actualizar`, `borrar` y `bajar`. El adaptador simulado implementa lo mismo sin red, así
  la batería prueba el circuito entero.

## 2. Flujo OAuth (Google)

Se usa **authorization code + PKCE S256 + state**. El client secret nunca sale de Supabase; el
`code_verifier` tampoco.

1. La app, con sesión, hace `POST /functions/v1/calendarios-oauth/iniciar` con
   `{ "proveedor": "google", "perfilId": "<perfil local>" }` y
   `Authorization: Bearer <access token>`.
2. La función comprueba el usuario con `auth.getUser(token)`, genera `state` y `code_verifier`
   (32 bytes aleatorios cada uno), calcula el `code_challenge` y guarda en `oauth_estado`:
   `user_id`, `perfil_id`, `proveedor`, `redirect_uri`, `origen`, `expira_en` (10 minutos).
3. Devuelve la URL de consentimiento de Google. La app navega allí.
4. Google vuelve a
   `https://vmctsurhswayrrwrkggj.supabase.co/functions/v1/calendarios-oauth/callback/google?code=…&state=…`.
   Es una función publicada **sin verificación JWT** porque Google no manda un JWT de Supabase; se
   protege con el `state` de un solo uso y con el intercambio del código.
5. La función busca el state, intercambia `code` + `code_verifier` por tokens en
   `https://oauth2.googleapis.com/token`, obtiene el correo del `id_token` (o de userinfo) y llama a
   `completar_oauth`, que **borra el state y guarda la conexión en una sola transacción**.
6. Redirige a `CALENDARIOS_APP_URL/?calendario=google&estado=conectado` (o `estado=error&motivo=…`).
   La app limpia la query con `history.replaceState`, muestra el aviso en Ajustes y recarga el estado.

Scopes: `openid email https://www.googleapis.com/auth/calendar.events`. No se pide acceso completo
al calendario ni a contactos.

### Dónde vive cada token

| Dato | Dónde | Quién lo lee |
| --- | --- | --- |
| Access / refresh token | `calendarios_cuenta.token_*_cifrado` (AES-GCM 256) | `calendarios-sync` y `calendarios-oauth` con `service_role` |
| IV de AES-GCM | `calendarios_cuenta.token_iv` y `token_renovacion_iv` (uno por token) | las mismas funciones |
| `state` + `code_verifier` | `oauth_estado`, borrado al completar | `calendarios-oauth` |
| Sesión de Supabase | localStorage de la app (Etapa 15) | la app |
| Estado visible | Columnas públicas de `calendarios_cuenta` filtradas por `user_id` | `calendarios-oauth` con `service_role` |

`CALENDARIOS_TOKEN_KEY` es una clave de 32 bytes en base64 guardada en los secretos de Supabase. Sin
esa clave, el modo real se niega a guardar tokens. La tabla tiene RLS y no concede `select` a
`anon` ni a `authenticated`: el navegador no puede pedir las columnas de tokens ni con PostgREST.

## 3. Modelo de datos (`0009_etapa16_calendarios.sql`)

| Tabla | Para qué |
| --- | --- |
| `calendarios_cuenta` | Una fila por cuenta + **perfil local** + proveedor + calendario. Guarda tokens cifrados, `modo` (`oauth`/`simulado`), `cursor_sync`, última sincronización y último error. |
| `eventos_calendario` | Enlace estable `recordatorio_id ↔ evento_externo_id`, con `etag`, `payload`, `estado` (`pendiente`, `sincronizado`, `error`, `borrado`) y fechas. |
| `oauth_estado` | State de un solo uso, PKCE y origen de retorno. TTL 10 minutos. |

Reglas:

- `user_id` sale siempre de `auth.uid()` o del state; nunca de un parámetro del navegador.
- `perfil_id` es el perfil local (Yo, Abuela, Empresa) y forma parte de la clave única: conectar
  Google en un perfil no enciende el calendario de otro.
- La clave foránea compuesta `(calendario_id, user_id)` impide colgar un evento del calendario de
  otra cuenta.
- `on delete cascade` desde `auth.users`: borrar la cuenta borra conexiones, eventos y states.
- RPC `mis_calendarios()` devuelve solo columnas públicas y exige sesión. `GET /estado` no la usa:
  la `service_role` no tiene `auth.uid()`, así que la Edge Function filtra `calendarios_cuenta` por
  el `user_id` que ya comprobó con `getUser`.
- RPC `completar_oauth()` está revocada para `anon`/`authenticated` y solo la puede ejecutar
  `service_role`.
## 4. Contrato de las Edge Functions

### `calendarios-oauth`

| Ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /estado` | sesión | Lista las columnas públicas de `calendarios_cuenta` del usuario autenticado y el modo (`simulado`/`real`). |
| `POST /iniciar` | sesión | En modo real devuelve `{ url }`; en simulado crea una conexión de prueba y devuelve `{ modo: "simulado", calendario }`. |
| `GET /callback/google` | Google | Intercambia el código, cifra y guarda tokens y vuelve a la app. |
| `POST /desconectar` | sesión | Revoca el token en Google si se puede y borra la conexión y sus enlaces. |

### `calendarios-sync`

`POST /` con `{ accion: "sincronizar", calendarioId, eventos, completo }`.

- `eventos` es una lista acotada a 200: `recordatorioId`, `titulo`, `inicio`, `fin`, `todoElDia`,
  `notas`, `actualizadoEn`, `zona`.
- `completo: true` significa «esta es la foto entera» (lo manda «Todos los avisos»): los enlaces que
  ya no aparecen se borran también del calendario. Con `false` solo se empuja lo marcado y no se
  reconcilia nada.
- El servidor mantiene el `evento_externo_id`; dos sincronizaciones seguidas actualizan, no duplican.
- Devuelve `{ subidos, borrados, bajados, cursor, cambios, calendario }`. `cambios` describe lo que
  cambió en el calendario externo (`recordatorioId`, `titulo`, `inicio`, `fin`, `todoElDia`, `notas`,
  `eliminado`, `actualizadoEn`, `zona`). El adaptador simulado devuelve la lista vacía; el de Google
  recorre todas las páginas (`nextPageToken`), limita la primera pasada a 90 días, deduplica las
  ocurrencias repetidas por `avispate_id` y guarda el `nextSyncToken` para la siguiente.
- La app aplica esos `cambios` en el cliente con `aplicarCambiosCalendario`: los recordatorios
  locales se actualizan o se quitan sin depender de la tabla `recordatorios` de la Etapa 15. Los
  eventos sin `recordatorioId` o de otro perfil se ignoran.

### Adaptador simulado

Se activa con `CALENDARIOS_MODO=simulado` (valor por defecto mientras no haya credenciales). Crea
ids `sim-…`, guarda los enlaces en `eventos_calendario` y devuelve la misma forma que Google. La UI
lo dice sin ambigüedad: **«Modo de prueba»**. No hay llamadas a Google y no se guardan tokens.

## 5. Conflictos, duplicados y borrados

- **Duplicados:** la clave `(calendario_id, recordatorio_id)` y el `evento_externo_id` guardado
  hacen que la segunda pasada sea un `PATCH`, no un `POST`.
- **Borrado local:** la foto completa del cliente no incluye el recordatorio; el servidor marca el
  enlace como `borrado` y llama a `borrar` en el proveedor. Si el borrado remoto falla, el enlace
  queda en `error` y se reintenta en la próxima pasada.
- **Borrado remoto:** `bajar()` devuelve el `recordatorioId` de `extendedProperties.private` y
  `eliminado: true`. La app lo quita de la lista local, sin volver a subirlo en la misma pasada.
- **Edición simultánea:** gana el `updatedAt` más nuevo. Cada guardado del formulario y cada
  postergación local estampan esa hora; si la copia local es más nueva, el cambio de Google no se
  aplica, se cuenta como conflicto y la próxima pasada lo vuelve a subir. Si la de Google es más
  nueva, se aplica título, fecha, hora y notas, y se conserva el resto de los datos locales.
- **Ecos del push:** los eventos que la app acaba de enviar en la misma pasada se reconocen por id,
  título, inicio, fin y notas, y no se vuelven a aplicar aunque Google devuelva un `updatedAt` nuevo.
  Así una sincronización no pisa la edición local que se acaba de subir.
- **Recurrencia:** se envía `RRULE` igual que el `.ics`; las excepciones de una ocurrencia quedan
  para una fase posterior, porque Google las modela como eventos separados.

## 6. Revocación y seguridad

- «Desconectar» llama a `https://oauth2.googleapis.com/revoke` con el refresh token (o el access
  token), ignora el resultado y borra la fila local. Aunque Google no conteste, la app deja de tener
  la llave.
- El refresh token se renueva en `calendarios-sync` cuando faltan menos de 60 segundos; el nuevo se
  vuelve a cifrar y a guardar.
- Los errores que se muestran están limpios: nunca incluyen tokens, códigos ni cuerpos completos de
  Google. El detalle queda en `ultimo_error` con un texto corto.
- El callback valida que el `state` exista, no esté vencido, no se haya usado y corresponda al
  proveedor. Un state inválido no crea ninguna conexión.
- CORS: solo las cabeceras necesarias. La función no acepta `user_id` en el cuerpo.

## 7. Puesta en marcha y verificación manual

La cuenta real ya está configurada y el push está verificado. Para cerrar la ida y vuelta falta esta
pasada manual con dos cuentas:

1. Conectar Google en el perfil A, crear un recordatorio con hora y tocarlo en «Todos los avisos».
2. Abrir Google Calendar, cambiar el título y la hora de ese evento, y volver a AVISPATE. Al
   sincronizar, el recordatorio local debe mostrar el título y la hora nuevos.
3. Editar el mismo recordatorio en AVISPATE sin sincronizar y, antes de que pase el sondeo, cambiar
   el evento en Google. Gana la copia con `updatedAt` más nuevo; la otra se informa como conflicto.
4. Borrar el evento en Google y sincronizar: el recordatorio local desaparece. Borrarlo en AVISPATE y
   sincronizar: desaparece de Google.
5. Repetir con una segunda cuenta para confirmar que cada perfil usa su propia conexión y que no se
   cruzan los eventos.

Si cambian las credenciales, la puesta en marcha sigue siendo: proyecto en Google Cloud con **Google
Calendar API**, pantalla de consentimiento y credenciales **Web application** con el redirect URI de
arriba; secretos `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDARIOS_MODO=real`,
`CALENDARIOS_TOKEN_KEY` (32 bytes base64) y `CALENDARIOS_APP_URL`; migración `0009` aplicada y
funciones `calendarios-oauth --no-verify-jwt` y `calendarios-sync` publicadas. Revisar el
video/permiso de la pantalla de consentimiento si Google lo exige para producción.

Apple y Outlook mantienen su ruta actual: `.ics` para Apple y enlace `outlook.live.com` para Outlook.
Cuando existan credenciales de Microsoft Graph se reutiliza la misma tabla y el mismo contrato,
cambiando solo el adaptador. Apple necesitará CalDAV o una app nativa (EventKit); no se puede
prometer en la web pura.

## 8. Pruebas

- `tests/e2e-calendarios.mjs` monta la app con una sesión, un `fetch` de mentira y comprueba:
  conectar en modo simulado, el `Bearer`, el cuerpo del push, «Todos los avisos» filtrado, la bajada
  de cambios (aplicar, borrar y conflicto a favor de lo local), desconectar, el aviso de vuelta del
  callback y que sin sesión no se llama a la red. Son 48 comprobaciones.
- La misma suite lee `0009` y las dos Edge Functions para verificar que las tablas tienen RLS, que
  los tokens no se conceden al navegador, que el flujo usa PKCE/state, que la bajada pagina con
  `nextPageToken` y guarda `nextSyncToken`, y que `service_role` no aparece en `src/`.
- La verificación con Google real es la lista manual de la sección 7.
