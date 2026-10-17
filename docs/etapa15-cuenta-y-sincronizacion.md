# Etapa 15 · Cuenta y sincronización entre teléfonos (V2.1)

Estado: **en curso**. Esta entrega (Fase 1) deja la identidad, el vínculo del dispositivo y la RLS.
El motor de sincronización, los adjuntos y la lista de dispositivos con cierre remoto son las fases
siguientes.

## Objetivo

Que la misma persona vea lo mismo en el teléfono y en la computadora, y que cambiar de teléfono no
dependa de acordarse de descargar una copia. Sin romper la promesa de siempre: **sin nube, AVISPATE
sigue funcionando sola**, y el modo invitado sigue existiendo.

## Decisiones que sostienen la etapa

1. **La cuenta es opcional.** El onboarding no la pide. Quien no quiera cuenta sigue usando la app
   como hoy: todo en `localStorage`, con copias de seguridad.
2. **Enlace mágico, sin contraseña.** Supabase Auth manda un correo; el enlace vuelve a la app con
   los tokens en el hash. No hay pantalla de contraseña que olvidar ni secreto extra en el bundle.
3. **Invitado → cuenta sin duplicar.** «Reclamar este teléfono» vincula el dispositivo y —cuando
   exista el motor— sube lo que ya hay con ids estables, así no se duplica nada.
4. **La identidad no es permiso.** Saber un `user_id` no alcanza: las escrituras pasan por funciones
   que comprueban `auth.uid()` y, para el alta, el token del dispositivo. Las tablas tienen RLS.
5. **La sesión es del dispositivo, no del respaldo.** `avispate.cuenta.v1` no entra en las copias de
   seguridad: una copia compartida no debe llevarse la llave de nadie.

## Modelo de identidad (Fase 1)

| Tabla | Qué guarda | Quién escribe |
| --- | --- | --- |
| `auth.users` | Correo, id y metadatos de la cuenta (Supabase Auth) | Supabase Auth |
| `perfiles_cuenta` | `user_id`, nombre visible, fechas | Disparador al crear la cuenta |
| `dispositivos_cuenta` | `(user_id, dispositivo_id)`, `reclamado_en`, `ultima_conexion` | `reclamar_dispositivo` / `desvincular_dispositivo` |
| `dispositivos` (Etapa 10) | Id, token, nombre y push del teléfono | `registrar_dispositivo` |

Reglas:

- Una cuenta puede tener varios teléfonos; un teléfono puede usarse con más de una cuenta (equipo
  compartido), pero no puede repetir el mismo par.
- `auth.uid()` es la única fuente del `user_id` en las funciones; nunca se acepta como parámetro.
- `anon` no puede ejecutar `reclamar_dispositivo`, `desvincular_dispositivo` ni `mis_dispositivos`.
- El perfil se crea solo con un disparador en `auth.users`; el nombre sale de los metadatos o del
  correo, no de un dato arbitrario del navegador.

## Fases

### Fase 1 · Identidad y vínculo (esta entrega)

- `src/lib/cuenta.ts`: pedir el enlace, procesar el hash, guardar/renovar/cerrar sesión, reclamar y
  desvincular el teléfono, listar dispositivos. Sin SDK y sin excepciones: siempre `{ ok }`.
- Tarjeta **Cuenta** en Ajustes: correo, «Enviar enlace mágico», estado de la sesión, «Vincular este
  teléfono», lista de dispositivos vinculados y «Cerrar sesión».
- `0004_etapa15.sql`: `perfiles_cuenta`, `dispositivos_cuenta`, RLS de solo lectura por usuario,
  disparador de perfil y las tres funciones autenticadas.
- Suite `tests/e2e-cuenta.mjs`: enlace feliz y vencido, correo inválido, modo sin red, sesión
  persistida, vínculo, desvínculo, cierre de sesión y las comprobaciones estáticas de la migración.

**Terminada cuando:** una persona puede crear la cuenta desde Ajustes, volver con el enlace, ver su
cuenta en otro arranque, vincular el teléfono y cerrar sesión; y un usuario no puede leer ni escribir
lo de otro (prueba SQL negativa).

### Fase 2 · Esquema por entidad y RLS

- Tablas `recordatorios`, `categorias`, `perfiles`, `ajustes`, `marcas` y `tumbas` con `user_id`,
  `id` estable, `updated_at`, `deleted_at` y `revision`.
- Claves compuestas `(user_id, id)`; los ids que ya genera el teléfono se conservan.
- RLS por usuario en todas; pruebas negativas con dos cuentas y dos dispositivos.
- Compatibilidad con las copias de la Etapa 13/14: una cuenta nueva se puede crear desde un `.json`
  sin perder datos.

### Fase 3 · Motor de sincronización

- **Cola de salida por dispositivo**: cada cambio local entra como operación con id propio y se
  reintenta con espera creciente. La cola sobrevive a recargas (IndexedDB, no `localStorage`).
- **Cursor de bajada** por dispositivo: el servidor asigna un `seq` creciente y el cliente pide
  «dame lo nuevo desde `seq`». Realtime se usa para lo urgente; el cursor sigue siendo la verdad.
- **Tumbas**: borrar deja `deleted_at` y `revision`; se purgan a los 90 días. El «Deshacer» local
  sigue funcionando antes de que la tumba salga del teléfono.
- **Conflictos por campo**: gana el `updated_at` más nuevo; si empatan, el `dispositivo_id` mayor;
  si también empatan, el hash del valor. Nunca se pierde un cambio por orden de llegada.
- **Adjuntos** en Supabase Storage con límite de tamaño, URL firmada y limpieza al borrar la última
  referencia. Los archivos viajan después de la fila que los referencia.

### Fase 4 · Dispositivos y sesiones

- «Última conexión» real (no solo el momento del vínculo), nombre editable y botón para cerrar
  sesión en uno o en todos.
- Al cerrar sesión: conservar o borrar la copia local, con una explicación clara.
- Realtime para que la lista se actualice cuando entra otro teléfono.

## Reglas de conflicto (borrador para la Fase 3)

| Caso | Resultado |
| --- | --- |
| Edición en A y edición en B sin red | Gana el `updated_at` mayor; el perdedor queda en el historial local de la app, no se descarta en silencio. |
| Borrado en A, edición en B | Gana la operación más nueva. Si gana la edición, la fila revive; si gana el borrado, queda la tumba. |
| Mismo `updated_at` | Desempate por `dispositivo_id` y luego por hash del contenido: determinista en los dos teléfonos. |
| Reclamar un teléfono que ya tenía datos | Los ids son los mismos: `upsert`, no copia. Las filas idénticas no generan operaciones. |
| Cerrar sesión y volver a entrar | La sesión nueva baja desde el cursor guardado; si el cursor se perdió, bajada completa y merge por ids. |

## Seguridad

- RLS en todas las tablas de cuenta; `anon` sin acceso.
- Funciones `security definer` con `search_path = public, pg_temp`, y `revoke` explícito de `public`.
- El token del dispositivo se sigue guardando en el teléfono y se exige en el alta del vínculo.
- La sesión (access + refresh) vive en `localStorage`; es el compromiso habitual de una SPA sin
  backend propio. Si más adelante se quiere cookie `HttpOnly`, hace falta un backend intermedio.
- Los secretos de proveedores siguen solo en Supabase; el bundle únicamente lleva la anon key.

## Lo que falta decidir

- ¿Una cuenta puede tener varios «usuarios del dispositivo» (los perfiles de hoy) o cada perfil se
  convierte en una cuenta? La Fase 2 propone que los perfiles sigan siendo del dispositivo y que la
  cuenta sea la persona dueña; los espacios compartidos llegan en la Etapa 17.
- ¿La cuenta se puede borrar desde la app? Hace falta una función con `service_role` y una política
  de retención; por ahora se borra desde el panel de Supabase.
- ¿Qué pasa con los datos locales al cerrar sesión? La Fase 4 propone preguntar una vez y recordar
  la elección por dispositivo.

