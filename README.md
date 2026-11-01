# AVISPATE — V2.1 (Etapa 15)

Primera transformación del prototipo de Figma Make a una V1 funcional ejecutable como aplicación web local.

[![verificar](https://github.com/bustossebap/avispate-app/actions/workflows/verificar.yml/badge.svg)](https://github.com/bustossebap/avispate-app/actions/workflows/verificar.yml)

**Publicada en <https://avispate-app.vercel.app>**. El enlace anterior, `recuerdapapi.vercel.app`, sigue vivo y sirve la misma versión.

## Incluye

- Crear recordatorios reales.
- Editar recordatorios.
- Eliminar con confirmación.
- Marcar recordatorios como completados.
- Fecha y hora reales.
- Persistencia automática con `localStorage`.
- Calendario navegable por mes.
- Historial local de avisos.
- Motor local que revisa los recordatorios al abrir la app y cada minuto mientras está abierta.
- Notificaciones del navegador cuando el permiso está concedido.
- Selección de WhatsApp como canal, con envío real por la Cloud API de Meta (plantilla de utilidad) y correo por Resend.
- Número de WhatsApp con bandera y prefijo completo, incluido el 9 de celular (Chile 🇨🇱 +56 9 por defecto).
- Cada usuario del dispositivo con su nombre, su emoji (de la rejilla o de la lista completa de emojis), su foto, sus canales y sus calendarios.
- Categorías propias: agregar, reordenar y eliminar desde Inicio (o al crear un recordatorio), eligiendo al eliminar si sus recordatorios se borran o quedan sin categoría.
- Repeticiones por horas, días, semanas, meses o años (y personalizadas).
- Sección de tips con consejos de uso (Ajustes › Ver tips).
- Onboarding recordado entre sesiones.
- Interfaz responsive: teléfono completo en móvil y marco de teléfono en escritorio.
- Copia de seguridad: todo en un solo `.json` que se descarga y se restaura desde Ajustes › Datos.
- Avisos con la app cerrada: el teléfono calcula cuándo avisar y lo sube; Supabase guarda la cola y un cron cada minuto manda el push. Con la app cerrada, sin abrirla.
- Instalable en el teléfono (PWA): íconos propios, se abre sin la barra del navegador y avisa cuando hay una versión nueva.
- Búsqueda en Inicio: la lupa filtra por nombre, nota o categoría, sin exigir tildes ni mayúsculas y respetando la categoría elegida.
- Posponer desde la notificación: «Posponer 10 min» o «Posponer 1 hora» mueve el aviso en la nube sin abrir la app.
- Salud de la cola (Ajustes): cuántos avisos hay en este teléfono, qué tiene la nube y cuándo se subió por última vez, con «Revisar ahora».
- Entrega real (Ajustes): estado de WhatsApp y correo, botones «Probar», últimos envíos con canal y estado, y el motivo cuando el proveedor falla. Las filas de la cola viajan por canal con destino, usuario y zona horaria; los secretos viven solo en Supabase.
- Cuenta opcional (Etapa 15, fases 1–6): enlace mágico por correo, sesión que se recuerda en el teléfono, vínculo del dispositivo, sincronización de recordatorios, categorías, perfiles, ajustes y marcas entre teléfonos de la misma cuenta, adjuntos en Storage, Realtime y lista de dispositivos con renombre y cierre remoto. El modo invitado no cambia.
- Deshacer cualquier borrado: recordatorios, adjuntos, categorías (en sus dos salidas) y usuarios completos, desde el aviso que aparece abajo.
- Espacio en el dispositivo (Ajustes): cuánto ocupan los textos, las fotos y las notas de voz, y un botón para liberar los archivos que ya no usa ningún recordatorio.

## Ejecutar

Requisitos: Node.js 24 (lo que fija `.mise.toml`) y npm. Hay un solo lockfile, `package-lock.json`; `npm ci` reinstala exactamente lo que dice.

```bash
npm install
npm run dev
```

Luego abre la dirección que muestre Vite (el puerto lo fija `vite.config.ts`: **`http://localhost:8443`**).

Para producción:

```bash
npm run build
npm run preview
```

### Ver la app con Live Server

Si preferís mirar la app **ya construida** (y que el teléfono se refresque solo en cada guardado), en vez
del dev server de Vite:

```bash
npm run build:watch      # reconstruye dist/ en cada guardado (queda corriendo)
```

y en VS Code: clic derecho sobre `dist/index.html` → **«Open with Live Server»** (o el botón «Go Live»).
Ya viene configurado en `.vscode/settings.json`: raíz `dist/`, puerto **5500** y `host` en `0.0.0.0` para
poder abrirlo también desde el teléfono (`http://<IP-de-la-Mac>:5500`).

Esto funciona porque el `base` del build es relativo (`./assets/…`): `dist/` se puede servir desde
cualquier raíz. En Vercel, que sirve en la raíz, los `./assets/…` resuelven a `/assets/…` igual que antes.

Ojo con la cámara: en el teléfono el navegador solo la habilita en **contexto seguro** (https o
`localhost`), así que para probar «sacar la foto» conviene el puerto reenviado de VS Code (https) y no la
IP de la red.

## Pruebas y verificación

La batería E2E vive **dentro del proyecto** (`tests/`): monta el bundle real dentro de jsdom y recorre la
app como si alguien la tocara —onboarding, crear y editar recordatorios, calendarios, archivos, usuarios,
borrar y deshacer, Ajustes, tips, cuenta, dispositivos, adjuntos en Storage y Realtime—. Son **22
suites y 987 comprobaciones**.

```bash
npm run build        # la batería prueba dist/: si está viejo, se avisa y no corre
npm test             # todas las suites (o `npm test -- ui7` para una sola)
npm run verificar    # tipos → build → batería local (no publica)
npm run verificar -- --deploy   # además publica en Vercel y corre la batería en vivo
```

Cada push a `main` y cada pull request pasan además por el robot de GitHub
(`.github/workflows/verificar.yml`): `npm ci` desde cero, formato y la batería completa, **sin publicar**
(el despliegue es cosa de Vercel). El resultado se ve en la pestaña *Actions* del repositorio.

- `tests/harness.mjs` - el montaje jsdom y todas las ayudas (`montar`, `wait`, `byLabel`, `swipe`,
  `storage`, `reporter`…). Un arreglo se hace **una vez** y vale para todas las suites.
- `tests/e2e-*.mjs` - una suite por entrega. Cada una declara sus comprobaciones con `check(...)` y
  cierra con `process.exit(finish() ? 1 : 0)`.
- `tests/run.mjs` - el runner: corre las suites en orden, resume `OK/FALLA` por suite y **falla si `dist/`
  es más viejo que `src/`** (la trampa de probar una entrega anterior).
- `scripts/verificar.sh` - tipos → build → batería local (no publica); con `--deploy`, el bucle completo con el bundle publicado comparado byte a byte contra el local
  y la batería corrida **dos veces** (contra `dist/` y contra `https://avispate-app.vercel.app`). Los
  registros quedan en `tests/.logs/`.
- La batería en vivo, si hiciera falta, se pide a mano con `LIVE_BASE=https://avispate-app.vercel.app npm test`.

Dos detalles del entorno que conviene saber:

- **jsdom no resuelve selectores de atributo con emojis** (`[aria-label="Emoji 🦊 para X"]` no encuentra
  nada, aunque el valor sea idéntico). Por eso el harness busca por `aria-label` comparando el atributo a
  mano: usá `m.byLabel(...)` en vez de un selector.
- **`oxfmt` 0.2.0 rompe los tipos de TypeScript**: al formatear `src/` le saca los `;` que separan las
  propiedades de los tipos (`{ tab: string; name: string }` → `{ tab: string name: string }`) y el código
  deja de compilar. Por eso `npm run format` cubre `tests/` y `scripts/`, no `src/`. Si alguna vez hay que
  formatear `src/`, después hay que reparar los tipos (`npx tsc --noEmit` los marca uno por uno y basta con
  reponer el `;` en la columna que indica el error).

Nota sobre el lockfile: hay **uno solo**, `package-lock.json` (el que usan `npm install`, `npm ci` y Vercel).
El `pnpm-lock.yaml` que venía con el template de Figma Make se borró junto con el pnpm de `.mise.toml`:
estaba desactualizado —le faltaba `jsdom`, la dependencia de la batería— y tener dos lockfiles era una
trampa (instalar con pnpm dejaba las pruebas rotas). Si algún día vuelve pnpm, regenerá el lockfile con
`pnpm install --lockfile-only` **antes** de usarlo.

## Nota importante sobre WhatsApp

WhatsApp y el correo ya salen de verdad desde la Etapa 14: la app encola una fila por canal y la nube entrega con la Cloud API de Meta o con Resend. Para que funcione en producción hay que configurar la cuenta de Meta Business, la plantilla aprobada, el webhook y los secretos de las funciones; sin esa configuración, Ajustes lo explica y los avisos locales siguen funcionando. La guía paso a paso está en `supabase/README.md`.

## Datos

Los recordatorios se guardan en el navegador mediante `localStorage`; las fotos y notas de voz, en
`IndexedDB`. El botón «Restaurar datos de demostración» vuelve a cargar los ejemplos iniciales.

Desde la Etapa 9, **Ajustes › Datos › Copia de seguridad** descarga un `avispate-AAAA-MM-DD.json` con
los recordatorios, usuarios, categorías, preferencias e historial de avisos —más las fotos y notas de
voz en base64— y **Restaurar desde archivo** lo devuelve: antes de reemplazar nada muestra qué trae el
archivo. Las marcas de «ya avisado», la última visita y el aviso de inactividad no viajan (son del
momento); al restaurar, las de «ya avisado» se borran para que lo recuperado pueda volver a avisar.


## V1.2
- Los recordatorios completados ya no desaparecen de la pantalla principal.
- Se muestran en la sección “Completados”.
- Desde el detalle se pueden volver a marcar como pendientes.
- Editar un recordatorio completado conserva su estado.


### V1.2
- La sección "Completados" ahora se puede colapsar y expandir desde la pantalla principal.


## AVISPATE V1.3

V1.3 agrega repeticiones personalizadas. Un recordatorio puede repetirse cada N días, semanas, meses o años. Al completar un recordatorio repetitivo, AVISPATE calcula y programa automáticamente la siguiente fecha. También se mantienen las opciones rápidas de semana, mes, año, 2, 5 y 10 años.

## AVISPATE V1.4

V1.4 mejora la pantalla Inicio y permite enriquecer los recordatorios.

- Los títulos largos pueden ocupar hasta dos líneas sin ocultar el nivel de urgencia.
- Filtro por categoría en carrusel horizontal desde Inicio.
- Notas libres dentro de cada recordatorio.
- Adjuntar imágenes y archivos de audio.
- Capturar una foto directamente desde dispositivos compatibles.
- Los archivos se guardan localmente en IndexedDB y los metadatos del recordatorio en localStorage.
- Los archivos adjuntos pueden visualizarse/reproducirse desde el detalle y eliminarse individualmente.


## V1.5
- Avisos múltiples: se mantienen los avisos rápidos y ahora se pueden agregar varios avisos personalizados con días, semanas o meses de anticipación.
- Notas de voz: grabación desde el micrófono del navegador mediante MediaRecorder.
- Cámara: captura de foto mediante la cámara del dispositivo cuando el navegador lo permite y con solicitud de permisos.
- Las fotos y notas de voz siguen guardándose localmente en IndexedDB en esta versión.

## Etapa 1: cada usuario con lo suyo

Los recordatorios ya eran de cada usuario; ahora **también lo son su contacto, sus canales y su Google Calendar**.

- **Contacto por usuario**: número de WhatsApp y correo de cada usuario, editables en Ajustes › «Contacto de …».
- **Canales por usuario**: interruptores de notificaciones push, WhatsApp y correo por usuario (antes eran solo de la pantalla, sin guardarse).
- **Google Calendar por usuario**: conexión, «Todos los avisos» y última sincronización son de cada usuario, no del dispositivo.
- **Avisos coherentes**: el motor entrega cada aviso por los canales que el **dueño** del recordatorio tiene listos. Si a ese usuario todavía no le configuraron WhatsApp o correo (o el canal está apagado), el aviso sale por notificación; si no tiene ningún canal, no se envía ni se marca como enviado.
- **Formulario de Crear**: al elegir «Recordar para» avisa qué canales de ese usuario no están configurados.
- **Migración automática**: el contacto y Google Calendar globales de la V1.5 se mudan al usuario «yo» al abrir la app y las claves viejas (`recuerda.contacto.v1`, `recuerda.gcal.v1`) se borran, sin perder nada.

En esa etapa el envío real todavía quedaba pendiente; la Etapa 14 lo cerró con la Cloud API de Meta y Resend. El OAuth de Google por usuario sigue pendiente y llega con los calendarios de ida y vuelta de la Etapa 16.

## Etapa 2: hora propia, secciones más claras y logos reales

Ajustes de interfaz pedidos después de la Etapa 1.

- **Hora de los avisos en 24 h o a.m./p.m.** (Ajustes › Apariencia): se elige con dos botones, se guarda en el dispositivo (igual que el modo oscuro) y se aplica al campo de hora del recordatorio, a las tarjetas y al detalle; por dentro los datos siguen guardándose como `HH:MM` de 24 h, así que Google Calendar y el archivo `.ics` no cambian. Si nunca se eligió, se respeta la preferencia del sistema.
- **Campo de hora propio**: los `<input type="time">` del navegador siguen el idioma del sistema y no se pueden forzar a 12 h, así que la hora se elige con listas (hora, minutos y, en formato de 12 h, a.m./p.m.).
- **Nuevo recordatorio**: la fila Fecha - Hora queda más separada de Archivos y Fecha se acorta (flexible, mínimo 136 px) para que Hora se vea entera, con su a.m./p.m.; si la pantalla es muy angosta, Hora baja a otra línea en vez de recortarse.
- **Onboarding**: nueva descripción del slide 4 («Agrega notas, audio, documentos y fotos para recordar cada detalle…»), el slide 5 junta sus dos párrafos en uno y tanto ese slide como el último paso usan el **logo real de WhatsApp** (glifo oficial en SVG, en vez del emoji de burbuja).

## Etapa 3: onboarding que se desliza, canales a la vista y ticket de contacto

Ajustes pedidos después de la Etapa 2.

- **Onboarding: tocar o deslizar**. Los slides se pasan tocando la pantalla (como antes) o deslizando el dedo hacia la izquierda; hacia la derecha se retrocede. El gesto se mide con `touchstart/touchend` para el dedo y `pointerdown/pointerup` para el mouse o el lápiz (cada camino por separado, para no contarlo dos veces), solo cuenta si es claramente horizontal —si manda lo vertical es scroll— y se ignora si empieza sobre un campo o un botón. En los pasos de formulario deslizar hacia la izquierda no avanza (hay que llenar los datos), pero hacia la derecha sí se vuelve; lo escrito se conserva.
- **«Bzzt… escribe un nombre primero»**: en el paso del nombre, «Siguiente» ya no queda deshabilitado: al apretarlo sin nombre (o con solo espacios) aparece un aviso chico en rojo y no se avanza; el aviso se va al primer tecleo. El campo queda marcado con `aria-invalid` y el rojo es `role="alert"`. «Saltar por ahora» sigue sin pedir nombre.
- **Sin teclado automático**: los pasos del nombre y del contacto ya no usan `autoFocus`, así en el teléfono el teclado no se abre solo al llegar al penúltimo slide (el foco se queda donde estaba y el usuario decide cuándo escribir).
- **Slide 5**: la descripción pasa a «Recordar también es cuidar. Crea recordatorios para la familia, tus amigos o incluso para tu empresa.»
- **Canales de contacto a la vista** (Ajustes › Usuarios de este dispositivo): cada usuario muestra los canales por los que puede recibir avisos —**logo real de WhatsApp** y correo— encendidos si están listos y apagados (en gris) si le faltan. Cada insignia dice de quién es y en qué estado está.
- **Ticket para aceptar el contacto** (Ajustes › Contacto): cuando el usuario deja su número o su correo aparece un ticket («Acepto que AVISPATE use estos datos…») que hay que marcar. Mientras falte, los datos figuran como «Por confirmar», los avisos por WhatsApp y correo quedan **en pausa** (el motor cae en notificación, y Crear lo avisa) y la lista de usuarios muestra el canal apagado. Al cambiar un dato el ticket se destilda solo, para volver a aceptarlo. Los contactos guardados antes de esta etapa se toman como aceptados, así nadie pierde sus avisos. En la Etapa 15 el ticket se reemplazó por el botón **Confirmar datos** / **Editar datos**; los datos guardados siguen tomándose como aceptados y la pausa por datos sin confirmar se mantiene.
- **«Eliminar» de usuarios ya borra**: el botón pedía confirmación pero solo limpiaba recordatorios y avisos; el perfil quedaba en la lista. Ahora el segundo toque borra también el perfil (su nombre, su emoji, su contacto, sus canales y su Google Calendar) y, si era el usuario activo, el mando pasa al que queda. El último usuario no se puede borrar.

## Etapa 4: hora que no se mueve, Google por usuario y aviso de inactividad

Ajustes finos pedidos después de la Etapa 3.

- **Hora de los avisos rediseñada** (Ajustes › Apariencia): antes el ajuste tenía una ayuda que cambiaba de largo («Se muestra como 22:30» / «Se muestra como 10:30 p.m.») y, en pantallas angostas, la fila se reacomodaba al elegir. Ahora el título va arriba y el control abajo, ocupando el ancho de la tarjeta con **dos mitades iguales**, y cada botón lleva su propio ejemplo dentro (`24 h · 22:30` y `a.m./p.m. · 10:30 p.m.`). Al cambiar de formato solo cambia el color del botón elegido: ni el texto ni el tamaño de nada se mueve. Por dentro todo sigue siendo `HH:MM` de 24 h.
- **Google Calendar a la vista por usuario** (Ajustes › Usuarios de este dispositivo): cada fila suma el **logo real de Google** junto a los de WhatsApp y correo. Se enciende si ese usuario tiene su cuenta conectada y queda en gris si no, y el globito/etiqueta dice de quién es, en qué estado está y si tiene encendido «Todos los avisos» o solo los que elige.
- **Nuevo recordatorio sin teclado automático**: el campo «¿Qué quieres recordar?» ya no usa `autoFocus`, así al abrir el formulario en el teléfono no se levanta el teclado solo ni queda elegido el espacio del nombre. Lo mismo con el nombre al abrir «＋ Nuevo usuario» en Inicio. El foco se queda donde estaba y el usuario decide cuándo escribir.
- **Abeja en la repetición personalizada**: la opción «Personalizada» de «¿Se repite?» ahora dice **🐝 Personalizada**. El dato guardado no cambia (`recurrence: "Personalizada"` con su intervalo y su unidad).
- **Permiso de notificaciones explicado y pedido a tiempo**: la tarjeta de Ajustes cuenta el estado real (pendiente, activado o bloqueado) y por qué el navegador no puede concederlo por defecto; el botón «Activar» solo aparece cuando todavía se puede pedir, y ahora **también se pide al guardar un recordatorio** que incluye el canal Notificación (dentro del mismo toque, que es lo que el navegador exige). Si el permiso se bloqueó, se indica que hay que desbloquearlo desde el candado de la barra de direcciones. El estado se vuelve a leer cada vez que Ajustes aparece o la app recupera el foco.
- **Aviso de inactividad «Bzzt… ¡avíspate!»**: al abrir AVISPATE se compara la última visita con la de ahora y, si pasó **una semana o más**, queda en el historial de avisos (y sale como notificación del navegador si el permiso está concedido) el mensaje «Bzzt… no te olvides de no olvidarte, ¡avíspate!» con los días que pasaron. Se muestra **una sola vez por hueco** (no se repite dentro de la misma semana), solo para quien ya terminó el onboarding, y la visita se marca también cuando la app pasa a segundo plano. Con la app cerrada todavía no se puede avisar: eso necesita el push real (servicio de notificaciones + servidor).
- **Versión en un solo lugar**: el pie de Ajustes y la tarjeta del perfil ahora dicen **AVISPATE · V1.5 · Etapa 4**, tomados de dos constantes (`APP_VERSION` y `APP_STAGE`) para que la pantalla y este README no se contradigan. (La tarjeta del perfil repetía ese dato; desde la Etapa 5 la versión se dice solo al pie de Ajustes.)

## Etapa 5: deslizar en el teléfono, emoji propio y Apple Calendar + Outlook

Ajustes de interfaz y de sincronización pedidos después de la Etapa 4.

- **Deslizar en el teléfono**: la superficie de los slides declara `touch-action: pan-y` (el scroll vertical sigue siendo del navegador y lo horizontal queda para la app) y el gesto se mide también en cada `touchmove`, no solo al soltar. Eso cubre lo que fallaba en el teléfono: cuando el navegador se queda con el gesto, cierra la secuencia con un `touchcancel` sin decir dónde terminó, y antes ese deslizar se perdía. Además, deslizar ya no puede contar como toque: el clic que algunos navegadores mandan al terminar el gesto se ignora durante 350 ms, así el onboarding no salta dos pasos de una vez.
- **Emoji de cada usuario en una rejilla**: el mismo selector (🐝 👨 👩 👧 👦 👴 👵 🧑 👶 🏢 🙂 —la **abeja primero**, porque es la cara por defecto de un usuario nuevo: la mascota de AVISPATE—) se usa en el onboarding («Tu emoji»), al crear un usuario desde Inicio —antes había que escribirlo a mano y ahora arranca en la abeja— y en **Ajustes › Mi perfil**, donde se cambia el del usuario activo sin tocar a los demás. Cada botón dice a quién le cambia el emoji (`Emoji 🐝 para Abuela`), para poder tocarlo sin adivinar de quién es.
- **La versión en un solo lugar, de verdad**: la tarjeta «Mi perfil · …» ya no repite la versión; queda solo al pie de Ajustes (**AVISPATE · V1.5 · Etapa 5**).
- **Adjuntar sin cámara**: la casilla «Imagen o documento» ahora lleva **📂🖼️** y abre el **selector de archivos del sistema** (`showOpenFilePicker`), que es un explorador de archivos y no ofrece la cámara —para la cámara ya está el botón «Sacar foto»—. Donde ese selector no existe (Safari de iPhone, Firefox) se usa el `<input type="file">` de siempre, que en el teléfono sí puede ofrecer la cámara desde el sistema operativo: eso lo decide el navegador y la página no puede quitar esa opción (ver la pregunta al final).
- **Apple Calendar y Outlook, por recordatorio**: la sección **Calendario** de Nuevo recordatorio (y la tarjeta **Calendario** del detalle) tiene tres filas: Google Calendar (enlace que abre el evento rellenado), **Apple Calendar** (descarga el `.ics`, que el iPhone o el Mac abren en la app Calendario) y **Outlook** (enlace `outlook.live.com/calendar/0/deeplink/compose` con `subject`, `startdt`, `enddt`, `body` y `allday`, el mismo formato que usa su botón «Agregar al calendario»). Cada uno se enciende por separado y el recordatorio guarda su propia marca (`gcalAddedAt`, `appleAddedAt`, `outlookAddedAt`), así el mismo recordatorio puede estar en los tres. La fila suelta «Descargar archivo .ics» desapareció: eso ahora es la fila de Apple Calendar.
- **Sincronizar todos los recordatorios desde Ajustes** (Ajustes › **Calendarios de …**, el desplegable que reúne los tres): Apple Calendar y Outlook tienen su propia tarjeta, con las mismas piezas que Google Calendar —conectar/desconectar, «Sincronizar ahora» y «Todos los avisos»— guardadas **dentro de cada usuario**. «Sincronizar ahora» descarga **un solo `.ics`** con todos los recordatorios de ese usuario (solo los suyos) y anota cuándo y cuántos fueron; «Todos los avisos» decide si los recordatorios nuevos vienen con ese calendario ya marcado.
- **Slide 2 del onboarding**: la ilustración ya no muestra un solo mini calendario de Google; el recordatorio cae en los tres (**Google, Apple y Outlook**), cada uno con su logo real y su visto bueno, y el remate dice «También en Google Calendar, Apple Calendar y Outlook».

### Etapa 5 · revisión de interfaz (los seis ajustes pedidos sobre la entrega anterior)

- **El emoji, en burbuja**: en **Ajustes › Mi perfil** el emoji ya no ocupa una tarjeta con las once caras siempre a la vista. Ahora es una **burbuja cerrada** con la cara actual y una flecha; al tocarla baja la rejilla completa (con la cara en uso marcada) y al elegir una la burbuja se vuelve a cerrar, ya con la cara nueva. Se cambia igual que antes, solo el del usuario activo.
- **WhatsApp con su logo, no con el emoji**: en todos los sitios donde se nombra el canal —los chips de **Canales** al crear o editar, el aviso de canal sin configurar, los canales del detalle, el resumen del perfil, la tabla de canales de Ajustes y el campo del número— el 💬 dejó de existir y en su lugar va el **logotipo real de WhatsApp** (el mismo verde `#25D366` del resto de la app).
- **Los tres calendarios en cada fila de usuario** (Ajustes › Usuarios de este dispositivo): a las insignias de WhatsApp, correo y Google Calendar se suman **Apple** y **Outlook**. Cada una se enciende solo si *ese* usuario tiene su calendario conectado, y su globito dice de quién es, en qué estado está y si tiene encendido «Todos los avisos»; en gris mientras no.
- **Los calendarios, en un desplegable**: la tarjeta «Calendario de …» pasó a un botón plegable **«Calendarios de …»**, con los tres logos en su burbuja y una flecha hacia abajo. Arranca cerrado —Ajustes deja de ser una lista larguísima— y al tocarlo baja el contenido: la tarjeta de Google Calendar y las de Apple Calendar y Outlook. Cerrado, su segundo renglón resume lo que hay dentro: «Google, Apple y Outlook · sin conectar», «Conectados: Apple Calendar» o «Google, Apple y Outlook · los tres conectados».
- **Tres líneas, tres calendarios** (slide 2 del onboarding): la animación ya no dibuja una sola línea del recordatorio al calendario. Ahora bajan **tres líneas punteadas**, una hacia cada tarjeta —Google, Apple y Outlook—, escalonadas 120 ms y cada una con su visto bueno al llegar.
- **Texto del slide 5**: el remate dice «Correo, WhatsApp y **Calendarios** totalmente independientes.» (antes nombraba solo Google Calendar y arrastraba una coma de más).

## Etapa 6: la campana de Inicio, tu emoji o tu foto, repetir por horas y los tips

Los once ajustes pedidos después de la Etapa 5 —ocho correcciones de interfaz y tres cosas nuevas—, después los tres ajustes de la primera revisión de esta entrega (**campana simple** de vuelta en Inicio, **cualquier emoji** escrito a mano como cara del usuario y la tarjeta de **Mi perfil** reducida a ícono, nombre y «Editar») y, después, los cinco de la segunda revisión: la **lista completa de emojis** en el botón «+», la **vista previa de la foto** con ✓ y ✕, la **campana fuera de los canales**, la **extensión de país en bandera** y la sección de **Tips reducida a su botón**. Al final, un ajuste más: **agregar usuarios desde Ajustes**.

- **Onboarding › último paso con «Sincronizar con Calendarios»**: donde antes había una sola fila de Google Calendar ahora hay una **burbuja blanca desplegable** con los tres logos, que cerrada resume qué hay conectado («Google, Apple y Outlook · sin conectar», «Conectados: Google Calendar y Apple Calendar»…) y al abrirla muestra **los tres calendarios**, cada uno con su interruptor. Encenderlos deja ese calendario conectado en el usuario «yo» al instante —es el mismo ajuste que después se ve en Ajustes—, así el onboarding y Ajustes nunca se contradicen.
- **Ajustes › los tres calendarios en una sola burbuja**: el desplegable «Calendarios de …» es **una sola burbuja blanca** y no una tarjeta con otra tarjeta suelta debajo: el encabezado (los tres logos + el resumen de qué hay conectado) y el contenido —Google Calendar, Apple Calendar y Outlook, cada uno en su sección y separados por líneas— viven **dentro de la misma burbuja**, que se abre y se cierra con su encabezado. Al fondo del contenido hay además una **flecha para cerrarla**, el mismo gesto que la burbuja del onboarding, así no hace falta volver arriba para plegarla.
- **Ajustes empieza por «Mi perfil»**: las dos primeras secciones quedaron ordenadas como se pidió —**1) Mi perfil** (la tarjeta del usuario activo, con «Editar») y **2) Apariencia** (modo oscuro y formato de hora de los avisos)—, así lo primero que se ve al entrar en Ajustes es de quién son los datos que se editan ahí.
- **Agregar desde una categoría vacía**: al mirar una categoría sin recordatorios y tocar «Agregar recordatorio», el formulario abre con **esa categoría ya elegida** (y se guarda así). El «+» de la barra inferior sigue siendo neutro, como antes.
- **Extensión de país en el número de WhatsApp**: el número se escribe en dos campos, un **menú de extensión de país** (21 países, **Chile `+56 9` por defecto**) y el número local. El menú muestra **bandera y prefijo completo** (🇨🇱 +56 9) y el nombre del país se lee al abrir la lista o al pasar el dedo. El **9 de celular** de Chile —y el de Argentina, Ecuador, Paraguay, Perú, Portugal y Uruguay— va en el prefijo, no se escribe a mano; si alguien lo vuelve a escribir, se quita sin duplicarlo. Se guarda completo (`+56 9 1234 5678`) dentro del contacto del usuario, así valen igual los avisos y lo que ya estaba guardado; al abrir el editor, la extensión se lee del número guardado. Está en el último paso del onboarding y en **Ajustes › Contacto**.
- **Contacto de Ajustes, más simple**: los íconos de WhatsApp y correo pasaron a ser **chiquitos, a la izquierda de cada título**, y se fueron los cuadros grandes que robaban ancho. El estado («✓ Conectado» / «Por confirmar») sigue a la derecha del título. La aceptación ya no es un ticket: debajo de los datos hay un **botón grande «Confirmar datos»** y el consentimiento como texto; al confirmar, los campos quedan **grises y bloqueados** y el botón pasa a **«Editar datos»**. Editar sin confirmar deja los avisos por WhatsApp y correo en pausa hasta que se confirme otra vez.
- **Las seis insignias de cada usuario, en una sola línea**: cada fila («Usuarios de este dispositivo» en Ajustes y **Usuarios locales** en Inicio) muestra su **campana de notificaciones**, sus **dos canales de contacto** (WhatsApp y correo) **y sus tres calendarios**, todas juntas y **sin envolverse**: en Ajustes van en **su propia línea a todo lo ancho de la tarjeta**, alineadas con el nombre y por fuera del botón de eliminar (la fila de arriba es angosta: avatar + nombre + «Eliminar»), y en el desplegable de Inicio van en la misma fila del nombre, chicas. Cada insignia dice de quién es y si está encendida, con el mismo criterio con el que la app manda avisos (canal encendido y, en WhatsApp y correo, el dato y el ticket de contacto); como Inicio y Ajustes usan la misma función, las dos listas dicen exactamente lo mismo de cada persona.
- **Categorías propias: agregar, ordenar y eliminar**: al final del carrusel de categorías de Inicio hay dos chips —**「＋ Nueva」** y **「✎ Editar」**, punteados y en ámbar para leerse como acciones y no como categorías— y en **Nuevo recordatorio** aparece el mismo **«＋ Nueva»**.
  - La lista vive en el dispositivo con su propia clave (`avispate.categorias.v1`); sin nada guardado se usan las de siempre (**Auto, Documentos, Hogar, Finanzas, Trabajo, Personal, Mantención y Otros**), así nadie pierde lo suyo al actualizar.
  - **Crear** pide nombre y el emoji se elige con un **«+»**: para las categorías **no** se muestra la rejilla de once caras (no son caras), sino un solo botón «+» que abre la **lista completa de emojis**, y el elegido se ve junto al título de la hoja. No deja el nombre en blanco ni repetido —aunque cambien mayúsculas— y, al crearla, queda **elegida**: como filtro en Inicio y como categoría del recordatorio que estás armando.
  - **Editar** mueve las categorías **arrastrándolas** desde su agarradera (`⠿`): el gesto se sigue con Pointer Events —el arrastre nativo de HTML no existe en el navegador del teléfono, que es donde de verdad se usa— y cada media fila recorrida intercambia una posición, así una categoría puede subir o bajar varias de una vez. Mientras se arrastra, la fila se levanta con sombra y fondo ámbar; con el teclado (flechas arriba/abajo sobre la agarradera) se mueve igual, sin botones de flechas a la vista. Cada fila dice cuántos recordatorios tiene esa categoría.
  - **Eliminar** pregunta qué hacer con ellos, con el número real: **«Dejarlos sin categoría»** (siguen existiendo, se ven sólo en «Todas» y su detalle dice «Sin categoría») o **«Borrar sus recordatorios»** (se van con la categoría, con sus adjuntos y sus avisos del historial). El recordatorio guarda su propia categoría y su emoji, así que uno “huérfano” se sigue viendo igual que siempre.
- **El nombre del usuario, con su pista**: en Inicio, el selector de usuario lleva un **chevron ámbar dentro de una pastilla translúcida** (`bg-amber-500/15`) que **gira cuando el desplegable está abierto**, y nada más: **sin texto** y **sin** burbuja blanca (se leería igual que los chips de categoría de abajo). El ámbar es el color de todo lo accionable en la app; el ancho del nombre se recortó a 150 px para que la fila entre en un teléfono de 360 px.
- **Mi perfil, al mínimo**: la tarjeta del usuario activo quedó con el **ícono del usuario en un cuadrado**, a su derecha «Mi perfil · nombre» y el botón **Editar**, nada más. Antes enumeraba **un párrafo por canal y por calendario** («Notificaciones push · activadas», «WhatsApp conectado», «Google Calendar · conectado · Todos los avisos»…): eso se ve ahora donde corresponde —en «Notificaciones» y en el desplegable de Calendarios— para no repetir el mismo estado dos veces en la misma pantalla. **Editar** abre el nombre y la cara —emoji de la rejilla, cualquier otro escrito a mano o foto— y se guarda con «Guardar» (o se descarta con «Cancelar»), siempre solo para el usuario activo. Las insignias de cada fila de «Usuarios de este dispositivo» siguen ahí: son las que dejan comparar a dos usuarios de un vistazo.
- **Agregar usuarios también desde Ajustes**: la tarjeta «Usuarios de este dispositivo» estrena **＋ Nuevo usuario** al final de la lista —el mismo alta que Inicio, para no tener que volver a la pantalla de Inicio solo para sumar a alguien—: pide el **nombre** y **su cara** (rejilla de emoji, la lista completa del «+» o su foto con cámara/galería) y se confirma con **Agregar**, o se descarta con **×**. Al agregarlo aparece en la lista y queda como **usuario activo**, igual que cuando se agrega desde Inicio; arranca con **0 recordatorios**, sin contacto y sin canales configurados, porque cada usuario tiene lo suyo.
- **Inicio: la campana, simple otra vez**: el botón de avisos enviados vuelve a ser el **🔔 de siempre** —se fue la avispa dibujada con sus ondas de zumbido— y sigue **sin burbuja blanca**: es un control libre sobre el fondo miel, para que no se lea como las categorías que están justo abajo. El historial de avisos se sigue abriendo (y cerrando) desde ahí. La avispa dibujada se fue del todo en la segunda revisión (ver «Ver tips» abajo): la mascota de AVISPATE es la **abeja del saludo «¡Avíspate! 🐝»**, que es un emoji.
- **Nuevo recordatorio: «¿Cuándo te aviso?»**: la sección «Avísame» cambia de nombre y, sobre todo, **los avisos elegidos se destacan** con fondo ámbar, sombra y anillo (y `aria-pressed`), así de un vistazo se ve qué está encendido y qué no. La misma etiqueta nueva va en la ilustración del onboarding.
- **Emoji o foto en cada alta de usuario**: además de la rejilla de emoji, todas las altas (el paso del nombre del onboarding, «＋ Nuevo usuario» en Inicio y Mi perfil › Editar) traen un **botón de cámara de verdad** (ícono SVG, no emoji) que abre la **cámara del dispositivo** para sacarse la foto —con botón para cambiar de cámara— o **subir una foto** de la galería. La cara por defecto de un usuario nuevo es **la abeja 🐝** (la mascota de AVISPATE, y la primera de la rejilla): si a alguien se lo agrega de apuro, con el nombre alcanza y queda con esa cara; el smiley, en cambio, quedó al final con las demás. La foto se recorta y reduce a 256×256 JPEG antes de guardarse (unos pocos KB) dentro del usuario (`photo`), y si existe manda ella en toda la app; si no, el emoji de siempre. Se puede quitar con «Quitar». En la segunda revisión, lo que se toma o se sube **no se guarda solo**: aparece en una **vista previa** —con la cámara ya apagada, así nunca queda el cuadro negro— y hay que aceptarla con el **✓ «Usar esta foto»** o descartarla con la **✕ «Cancelar»**, que no deja nada a medias. Antes se entregaba al instante y, al apagarse la cámara con la ventana abierta, lo único que se veía era un rectángulo negro sin saber qué había pasado con la foto.
- **Todos los emojis en una hoja a pantalla completa**: al final de la rejilla de once hay un botón **«+»** que abre la **lista completa** —9 temas (Caras, Personas, Animales, Comida, Actividades, Viajes, Objetos, Símbolos y Banderas) con **943 emojis**— en una **hoja a pantalla completa**: pestañas de tema que envuelven en dos filas cuando el ancho no da, la lista con **su propio scroll** (el único de la hoja), el emoji en uso marcado, y **«Listo»** para cerrar sin cambiar. Al tocar un emoji, la cara cambia y la hoja se cierra, así se ve cómo quedó en el formulario. Cuando la cara en uso no es de los once, ese botón queda marcado y muestra dentro la cara propia, así se ve de dónde salió; su signo **+** está centrado en el cuadro. Funciona igual en las tres altas (onboarding, «＋ Nuevo usuario» y Mi perfil › Editar).
  - **Por qué una hoja y no un despliegue dentro del formulario**: el formulario del alta desde Inicio vive dentro de un desplegable de **254 px útiles**, sin tope de alto y recortado por el borde de la app (que tiene `overflow-hidden`), así que la lista quedaba descuadrada —las 9 pestañas necesitan 320 px— y no había forma de bajar hasta el final. La hoja es una capa con un solo scroll, y por eso se comporta igual en las tres altas.
  - **Y por qué se dibuja en el marco de la app**: la hoja (y el modal de la foto) se pintan con un **portal dentro de `#app-frame`**, no dentro del formulario que las abre. Cualquier ancestro con `transform` convierte a un modal `fixed` en un hijo suyo y lo encoge a esa porción de la pantalla: en el onboarding los pasos van con **animaciones de entrada** (`animate-slide-in` termina en `translateY(0)`, que ya cuenta como `transform`), y por eso la hoja sólo tomaba un pedazo del slide. Dentro del marco, `absolute inset-0` cubre toda la pantalla del teléfono y nada la recorta.
  - **Ya no se escribe el emoji a mano**: el campo «¿No está en la lista?» se fue con este cambio (los 943 de la lista cubren lo que se usaba escribir). Los emojis propios que ya estén guardados en algún usuario siguen funcionando y se siguen viendo.
  - **El desplegable de usuarios de Inicio, con tope**: era el único desplegable de la app sin `max-h` —ahora es `max-h-[calc(100dvh-140px)] overflow-y-auto overscroll-contain`, como el de la campana— y su lista de usuarios dejó de tener scroll propio, así queda **un solo scroll** y nada se recorta contra el borde.
- **Repetir por horas**: «¿Se repite?» estrena sus opciones —**No se repite, Cada 8 horas, Cada semana, Cada 2 semanas, Cada mes, Cada 6 meses, Cada año y Personalizada**— y la repetición personalizada suma **horas** a sus unidades. Como estas repeticiones mueven el reloj, la próxima vuelta devuelve **fecha y hora** (un recordatorio de las 09:00 que se repite cada 8 horas vuelve a las 17:00), y el `.ics`/RRULE sale como `FREQ=HOURLY;INTERVAL=n`. Las repeticiones de plazos larguísimos ya no se ofrecen, pero **siguen entendiéndose** al editar algo guardado antes.
- **«Ver tips» al fondo de Ajustes**: lleva a una sección de **seis slides con consejos** (avisos, repeticiones por horas, los tres calendarios, adjuntos, usuarios y contacto) con la misma navegación del onboarding —tocar, deslizar y puntos— pero sobre un **fondo propio azul profundo** (`.tips-bg`), para que no se confundan con la introducción. Se sale con la × o con «¡Listo!» y se vuelve a Ajustes. En la segunda revisión la sección se quedó **solo en su botón**, al fondo de Ajustes y después de Datos: se fue la tarjeta con el título **Tips**, el resumen de consejos y la **avispa dibujada** con su zumbido (también salieron su SVG y sus animaciones del código y del CSS), porque era una sección de más para llegar al mismo lado. El botón abre los mismos seis slides y sigue diciendo **Ver tips**.

## Etapa 7: el renombre a AVISPATE

La app se llama **AVISPATE** —«avíspate», que ya era el saludo del onboarding y el mensaje del aviso de
inactividad— y todo lo que decía RECUERDA pasó a decir AVISPATE: el pie de Ajustes, la cabecera de los
tips, el aviso del permiso de notificaciones, el ticket de contacto por WhatsApp, el aviso de
inactividad, los títulos de las notificaciones del navegador, la descripción de los eventos que se
agregan a Google Calendar y Outlook, el `PRODID`/`X-WR-CALNAME` de los archivos `.ics` y el título de la
pestaña (`.figma/make/site.json` → `"title": "AVISPATE"`).

**Lo guardado no se pierde: se muda.** Las claves del navegador cambiaron de nombre
(`recuerda.events.v1` → `avispate.events.v1`, y así las once) y al abrir la app se copian **una sola vez**
a las nuevas y se borran las viejas —solo si la copia quedó idéntica, para no perder nada por una cuota
llena—, incluidos los avisos ya enviados (`recuerda.sent.*`) y la marca de la inactividad. Los adjuntos
de IndexedDB también: la base vieja (`recuerda.attachments.v1`) se sigue leyendo y cada archivo que se
pide se copia a la nueva en ese momento (*copia perezosa*: copiar fotos y audios en bloque al arrancar
bloquearía la app). Las dos claves históricas de la V1.5 (`recuerda.contacto.v1` y `recuerda.gcal.v1`)
conservan su nombre viejo a propósito —son el nombre de una versión pasada, no la marca— y su migración
al usuario «yo» sigue igual.

La entrega sube a **Etapa 7** (el pie de Ajustes dice `AVISPATE · V1.5 · Etapa 7`) y la batería estrena
su novena suite, `tests/e2e-marca.mjs`: comprueba la marca nueva en el bundle y en pantalla, y —lo que
más importa— que la migración de las claves deja los recordatorios, usuarios, categorías, ajustes y el
contacto en su sitio, sin pisar los datos que ya estuvieran en las claves nuevas.

## Etapa 8: publicada en avispate-app.vercel.app

La app dejó de ser solo local: está publicada en <https://avispate-app.vercel.app> (los alias
`recuerdapapi.vercel.app` y `recuerdaapp-bustossebap.vercel.app` siguen sirviendo la misma versión).

- **El nombre**: `avispate.vercel.app` estaba ocupado por otra app, así que el proyecto pasó a
  `avispate-app` conservando su id y su historial de despliegues.
- **El bug que la batería en vivo tapaba**: con `base: "./"`, `index.html` pide `./assets/…`, pero el
  harness buscaba `/assets/…`; la corrida contra la URL publicada devolvía 0/0 sin explicar nada desde
  el cambio de `base`. Ahora resuelve cada `src` contra esa dirección y la batería en vivo vuelve a
  correr de verdad (604/604 en su momento).
- **La protección de despliegues**: Vercel protegía los alias nuevos con su cartel de inicio de sesión
  (*Deployment Protection* con SSO). Se desactivó para que la app publicada se abra sin cuenta.
- **El robot de pruebas**: `.github/workflows/verificar.yml` corre en cada push a `main` y en cada pull
  request (`npm ci` desde cero → formato → tipos → build → batería completa) y no publica nada.

## Etapa 9: copia de seguridad

Los datos viven solo en este navegador, así que hasta ahora limpiar los datos del sitio —o cambiar de
equipo— se los llevaba sin aviso. **Ajustes › Datos › Copia de seguridad** ahora los saca y los devuelve
en un solo archivo:

- **Descargar copia** arma `avispate-AAAA-MM-DD.json` con las claves de `localStorage` (recordatorios,
  usuarios, categorías, introducción, usuario activo, formato de hora, modo oscuro e historial de avisos)
  tal cual están, más las fotos y notas de voz de `IndexedDB` convertidas a base64. Al terminar dice
  cuántos recordatorios y adjuntos salieron y cuánto pesa el archivo.
- **Restaurar desde archivo** lee el `.json` y, **antes de reemplazar nada**, muestra qué trae («trae 3
  recordatorios, 2 usuarios, 5 categorías y 1 adjunto») para confirmar o cancelar. Restaurar no recarga
  la app: se relee lo restaurado y la pantalla lo muestra en el acto.
- **Lo que no viaja**: las marcas `avispate.sent.*` de «ya avisado», la última visita y el aviso de
  inactividad son del momento, no del respaldo. Al restaurar, las marcas de «ya avisado» se borran para
  que lo recuperado pueda volver a avisar.
- **Un archivo equivocado no toca nada**: si no es JSON, si no es de AVISPATE, si está vacío o si viene
  de una versión más nueva (`version` mayor que 1), se rechaza con un mensaje claro y los datos quedan
  como estaban.

El formato y sus comprobaciones viven en `src/lib/copia.ts` —la primera pieza sacada de `App.tsx`— y la
suite nueva es `tests/e2e-copia.mjs` (23 comprobaciones: descarga, contenido, confirmación, cancelación,
restauración en pantalla y archivos que no sirven). La app sube a **V1.6** y el pie de Ajustes dice
`AVISPATE · V1.6 · Etapa 9`.

## Etapa 10: avisos con la app cerrada (y la app instalable)

Hasta acá AVISPATE avisaba **mientras estaba abierta**: el motor local revisa cada minuto, pero si el
teléfono estaba en el bolsillo y la app cerrada, no había quién avisara. Esta entrega cierra esa
brecha sin servidor propio y sin costo:

- **AVISPATE instalable.** `public/manifest.webmanifest` con los íconos de la abeja (192, 512 y
  maskable, generados desde `public/icono.svg`), `theme-color`, `apple-touch-icon` y
  `viewport-fit=cover`. En Android es *menú ⋮ → Instalar aplicación*; en iPhone, *Compartir → Agregar
  a pantalla de inicio* (iOS 16.4 o más nuevo; sin App Store ni cuenta de Apple).
- **El teléfono calcula, el servidor entrega.** Esto es lo importante del diseño: las repeticiones
  («cada 8 horas», «cada 6 meses») y la zona horaria viven donde ya vivían, en `src/lib/repeticion.ts`.
  El teléfono arma una **cola de instantes concretos** (`src/lib/cola.ts`) y la sube; Supabase solo
  mira la hora y manda. Así no hay dos versiones de la misma regla que se contradigan, y no aparece
  el clásico aviso a las 3 de la mañana al cambiar de país.
- **La cola cubre 45 días** (hasta 120 avisos por recordatorio y 600 en total). Se recalcula al abrir
  la app y cada vez que cambian los recordatorios; si alguien no la abre en más de un mes, los avisos
  de ese hueco no existen (el aviso local sigue igual).
- **Un service worker propio** (`src/pwa/service-worker.js`, 4 kB, sin Workbox): guarda el armado para
  abrir sin red, recibe el push y abre la app al tocar la notificación. `vite.config.ts` lo publica
  como `sw.js` con el sello de la entrega; una versión nueva **espera** —píldora «Hay una versión
  nueva · Actualizar»— en vez de recargar en medio de un formulario.
- **Ajustes › Avisos con la app cerrada** muestra el estado real (activado, listo para activar, falta
  conectar la nube, iPhone sin instalar, navegador sin soporte) y tiene *Activar avisos* y *Probar
  aviso*; la prueba llega en menos de un minuto con la app cerrada.

Del lado del servidor hay una migración (`supabase/migrations/0001_etapa10.sql`) y una Edge Function
(`supabase/functions/enviar-avisos/`). Las tablas (`dispositivos`, `avisos`) tienen RLS **sin
políticas**: la clave pública que viaja al navegador no las toca. Solo puede llamar a cuatro funciones
que exigen el **token del dispositivo** (32 bytes al azar, guardados en ese teléfono). El cron corre
cada minuto y la función es idempotente: lo enviado no se repite y las suscripciones muertas se borran
solas. De paso, ese cron mantiene el proyecto gratuito despierto (Supabase pausa tras una semana sin
actividad).

La puesta en marcha son cinco pasos, una sola vez: **`supabase/README.md`**. Las claves VAPID se
generan con `node scripts/generar-vapid.mjs`; la privada queda en `.env.local` y en los secretos de
Supabase, nunca en el repo (no lleva prefijo `VITE_`, así que Vite no la mete en el bundle).

Las suites nuevas son `tests/e2e-cola.mjs` (26 comprobaciones: fechas al minuto, repeticiones, topes,
orden, ids estables entre aperturas y el `sw.js` publicado) y `tests/e2e-pwa.mjs` (29: manifest, PNG
del tamaño que dicen, HTML, service worker y la tarjeta de Ajustes). La batería pasa de 627 a **682**.
La app sube a **V1.7** y el pie de Ajustes dice `AVISPATE · V1.7 · Etapa 10`.

## Etapa 11: buscar, posponer y saber si la cola está sana

Tres cosas chicas que se notan todos los días:

- **Buscar en Inicio.** La lupa de la cabecera abre un campo que filtra lo que ya se está mirando. Se
  compara sin tildes ni mayúsculas (`normalize("NFD")` en `src/lib/buscar.ts`), así «jardin» encuentra
  «Podar el jardín» y «ano» encuentra «Año nuevo». Mira el nombre, las notas y la categoría; las
  palabras se pueden escribir en cualquier orden («marzo luz») y tienen que aparecer todas. Con texto,
  la pantalla deja una sola lista de resultados —sin las secciones «Próximamente» / «Más adelante»— y
  lo vencido que coincide queda arriba; si no hay nada, aparece la abeja con «Nada por acá» y el botón
  para limpiar. Respeta la categoría elegida y no deja filtros invisibles: al cambiar de pestaña y
  volver, el campo arranca cerrado.
- **Posponer desde la notificación.** El push ahora lleva el id del aviso y la notificación ofrece
  «Posponer 10 min» y «Posponer 1 hora». Al tocarlos, el service worker llama a `posponer_aviso` con el
  id y el token del dispositivo —que guarda en IndexedDB la primera vez que la app se registra— y el
  aviso vuelve a quedar pendiente a la hora nueva, sin abrir la app. Lo pospuesto se marca con
  `pospuesto_en` para que la próxima sincronización no lo borre. Si no hay credenciales o no hay red,
  abre la app como siempre.
- **Salud de la cola.** Ajustes muestra, en una tarjeta, cuántos avisos calculó este teléfono, cuál es
  el próximo, qué tiene la nube (`resumen_cola`: pendientes, enviados, con error) y hace cuánto fue la
  última subida (se anota también cuando falla). «Revisar ahora» recalcula, sube y vuelve a leer.

Del lado del servidor se suma `supabase/migrations/0002_etapa11.sql` (la columna, las dos funciones y
la sincronización con la excepción de los pospuestos) y la Edge Function se vuelve a publicar con el
`aviso` en el payload. La guía sigue en `supabase/README.md`.

Las suites nuevas son `tests/e2e-busca.mjs` (26 comprobaciones: tildes, ñ, mayúsculas, notas,
categoría, dos palabras en cualquier orden, «sin resultados», limpiar y Escape) y `tests/e2e-salud.mjs`
(22: la tarjeta de Ajustes, el último intento anotado, el service worker con sus acciones y la
migración). La batería pasa de 682 a **730**. La app sube a **V1.8** y el pie de Ajustes dice
`AVISPATE · V1.8 · Etapa 11`.

## Etapa 12: la copia que se suma, se deshace y se comparte

La copia de la Etapa 9 servía para cambiar de navegador, pero solo de una manera: reemplazar todo. Esta
entrega la vuelve algo que se usa sin miedo:

- **Sumar lo que falta.** Al elegir un archivo, Ajustes ya no pregunta solo «¿reemplazo?»: ofrece
  «Sumar lo que falta» y «Sí, reemplazar todo». Sumar agrega los recordatorios, usuarios, categorías y
  avisos cuyo id no existe (las categorías se reconocen por su nombre) y deja intacto todo lo demás: lo
  que ya está no se pisa ni se borra, el usuario activo, el reloj y el modo oscuro de este teléfono no
  cambian, y una categoría con el mismo nombre conserva su emoji. El final lo cuenta: «Copia combinada:
  se sumaron 1 recordatorio, 1 usuario…».
- **Volver a como estaba.** Antes de restaurar se guarda el estado anterior —las claves de la copia y las
  marcas de «ya avisado», que un reemplazo borra—. Después de cualquier restauración, sumar o
  reemplazar, Ajustes ofrece «Volver a como estaba», sin recargar la app.
- **Compartir, no solo descargar.** Donde el navegador sabe compartir archivos (Chrome de Android,
  Safari de iOS), «Compartir copia» abre el menú del sistema para dejarla en Drive, en WhatsApp o en el
  correo, que es donde el archivo sobrevive a un «limpiar datos». Cancelar el menú no es un error.
- **La copia que no se olvida.** Descargar o compartir anota la fecha, el tamaño y cuántos recordatorios
  llevaba, y Ajustes lo dice en palabras: «Último respaldo: hoy · 12 recordatorios (48 KB)». A los 30
  días aparece un aviso discreto para bajar una nueva.

La lógica pura vive en `src/lib/copia.ts` (`combinarDatos`, `haceCuanto`) y la pantalla en
`SettingsScreen` (`src/App.tsx`); las dos claves nuevas —`avispate.copia.ultima.v1` y
`avispate.copia.deshacer.v1`— son del dispositivo y no viajan dentro de la copia. La suite nueva es
`tests/e2e-copia2.mjs` (30 comprobaciones: sumar sin pisar, deshacer en los dos modos, las marcas de «ya
avisado», la fecha del último respaldo, el aviso de los 30 días, compartir y cancelar). La batería pasa
de 730 a **760**. La app sube a **V1.9** y el pie de Ajustes dice `AVISPATE · V1.9 · Etapa 12`.

## Etapa 13: borrar sin miedo

Hasta acá, eliminar era la única acción sin vuelta: un toque de más en «Eliminar recordatorio» se
llevaba la nota, la categoría y los archivos, y borrar un usuario se llevaba todo lo suyo sin preguntar
dos veces. Esta entrega hace que el borrado se pueda deshacer y que el espacio guardado se pueda ver:

- **Un aviso con «Deshacer».** Al eliminar un recordatorio aparece abajo, sobre la barra, ««Pagar la
  luz» eliminado» con un botón «Deshacer» que lo devuelve con su id, su lugar en la lista, su nota, su
  categoría y sus adjuntos. El aviso se va solo a los 12 segundos; uno nuevo reemplaza al anterior (el
  que ya no tiene vuelta suelta sus archivos), y una persona que usa lector de pantalla lo escucha.
- **También los adjuntos.** Quitar una foto o una nota de voz desde el detalle ya no es definitivo:
  «Adjunto quitado de «…»» lo devuelve en su misma posición dentro del recordatorio.
- **Categorías, en sus dos salidas.** Si al eliminar una categoría se eligen «Dejarlos sin categoría»,
  deshacer devuelve la categoría a su lugar en el carrusel y a cada recordatorio su categoría y su
  emoji. Si se eligen «Borrar sus recordatorios», vuelven la categoría, sus recordatorios y sus avisos
  del historial, en el mismo orden.
- **Usuarios completos.** Borrar un usuario se lleva su perfil, sus recordatorios, sus avisos, sus
  marcas de «ya avisado» y —si era el activo— el mando. Deshacer lo devuelve todo: el perfil en su
  lugar, los recordatorios en el suyo, el historial y las marcas, y el mando si lo tenía.
- **Los archivos no se borran al borrar.** La foto o la nota de voz siguen en IndexedDB hasta que el
  aviso se va; recién ahí se sueltan, y solo si ningún recordatorio vivo las sigue usando. Así
  «Deshacer» funciona siempre, incluso si la app se había quedado sin red o sin IndexedDB.
- **Espacio en este dispositivo.** Ajustes › Datos suma una tarjeta que dice cuánto ocupan los textos
  (UTF-16, como los guarda el navegador) y cuántos archivos hay entre fotos y notas de voz, con su
  tamaño. Si alguno no lo usa ningún recordatorio —un borrado cuya app se cerró antes del aviso, o una
  copia restaurada—, lo marca y ofrece «Liberar X»; si no hay IndexedDB, lo dice sin romper la pantalla.

La lógica vive en `src/App.tsx` (`Borrado`, `reinsertar`, `ofrecerDeshacer`, `deshacerBorrado`,
`inventarioAdjuntos`); no hay claves nuevas: el aviso es del momento y no se guarda. La suite nueva es
`tests/e2e-borrar.mjs` (39 comprobaciones: el aviso y su reemplazo, las cuatro clases de borrado con su
deshacer, el orden y los archivos, y la tarjeta de espacio). La batería pasa de 760 a **799**. La app
sigue en **V1.9** y el pie de Ajustes dice `AVISPATE · V1.9 · Etapa 13`.

## Etapas anteriores y numeración

La app dijo **V1.5** desde la entrega de avisos múltiples, notas de voz y cámara hasta la Etapa 8. Sobre esa versión se fueron sumando entregas de trabajo que no cambiaban el número; la Etapa 9 —la copia de seguridad, la primera función nueva después de la V1.5— lo sube a **V1.6**:

| Entrega | Qué trajo |
| --- | --- |
| V1.5 | Avisos múltiples, notas de voz, cámara, archivos en IndexedDB |
| Etapa 1 | Cada usuario con sus recordatorios, su contacto, sus canales y su Google Calendar |
| Etapa 2 | Hora propia (24 h o a.m./p.m.), secciones más claras y logos reales |
| Etapa 3 | Onboarding que se desliza, canales a la vista y ticket de contacto |
| Etapa 4 | Hora que no se mueve, Google por usuario, sin teclado automático, abeja, permiso por contexto y aviso de inactividad |
| Etapa 5 | Deslizar que sí funciona en el teléfono, emoji propio en todas partes, sincronización con Apple Calendar y Outlook, y su revisión de interfaz (logo real de WhatsApp, emoji en burbuja, calendarios plegables y tres líneas en el onboarding) |
| Etapa 6 | Campana simple de Inicio (la avispa queda solo de mascota), emoji de la rejilla o de la lista completa (hoja a pantalla completa, sin campo de escribir) más foto de usuario (cámara o galería), Mi perfil al mínimo (ícono, nombre y «Editar»), repetir por horas, extensión de país en el WhatsApp, canales por usuario en las dos listas, sincronizar con Calendarios en el onboarding, los tres calendarios en una sola burbuja, categoría preseleccionada, «¿Cuándo te aviso?» con las opciones destacadas y «Ver tips» — más la segunda revisión (lista completa de emojis por temas, vista previa de la foto con ✓ y ✕, la campana fuera de los canales, la extensión de país en bandera con el número a todo lo ancho y la sección de Tips reducida a su botón), el alta de usuarios desde Ajustes, los estados de contacto alineados con su título, la campana de vuelta entre las insignias de cada usuario con las seis en una sola línea, Ajustes ordenado con «Mi perfil» primero, los tres calendarios unidos a su burbuja desplegable con flecha al fondo para cerrarla, y la hoja de emojis y el modal de la foto dibujados en el marco de la app (para que no los encoja ninguna animación), el selector de usuario con su pista (chevron ámbar que gira, sin texto) y las categorías propias (crear con el «+» para el emoji, ordenar arrastrando y eliminar, decidiendo qué pasa con sus recordatorios) |
| Etapa 7 | El renombre RECUERDA → AVISPATE: la marca en toda la app y en la pestaña del navegador, las claves guardadas renombradas con su migración (recordatorios, usuarios, categorías, ajustes, avisos enviados y contacto intactos) y la copia perezosa de los adjuntos de IndexedDB |
| Etapa 8 | Publicación en `avispate-app.vercel.app` (sin protección de despliegues), el arreglo de la batería en vivo con `base: "./"` y el robot de GitHub Actions |
| Etapa 9 | Copia de seguridad: descargar todo en un `.json` —fotos y notas de voz en base64— y restaurarlo desde Ajustes › Datos, con resumen antes de reemplazar |
| Etapa 10 | Avisos con la app cerrada (cola calculada en el teléfono + Supabase + cron + Edge Function), AVISPATE instalable con service worker propio y píldora de versión nueva |
| Etapa 11 | Búsqueda en Inicio (sin tildes, por nombre, nota o categoría), posponer desde la notificación y salud de la cola en Ajustes |
| Etapa 12 | Copia de seguridad que se suma a lo que hay o reemplaza todo, «Volver a como estaba», compartir por el menú del teléfono y recordatorio de la última copia a los 30 días |
| Etapa 13 | Deshacer los borrados (recordatorio, adjunto, categoría y usuario completo) y ver y liberar el espacio que ocupan los archivos en el dispositivo |

Desde la Etapa 12 la app decía **V1.9**; la Etapa 14 sube a **V2.0** (el pie de Ajustes:
`AVISPATE · V2.0 · Etapa 14`) porque cierra lo que hasta acá era una simulación: WhatsApp y correo
salen de verdad.

## Etapa 14: entrega real por WhatsApp y correo

Hasta acá WhatsApp y correo existían en la interfaz, en el ticket de Contacto y en la cola, pero el
envío se quedaba en el teléfono. Esta entrega cierra esa simulación:

- **Una fila por canal.** `programarAvisos` decide, para cada ocurrencia, qué canales puede recibir su
  dueño (`src/lib/entrega.ts`) y emite una fila por cada uno: `push`, `whatsapp` o `email`, con el
  mismo id y distinto `canal`. La clave de la tabla pasa a `(dispositivo, id, canal)`; WhatsApp viaja
  en dígitos y el correo en minúsculas, junto al `perfilId` y la zona horaria del teléfono.
- **La nube entrega.** La Edge Function `enviar-avisos` conserva el push (VAPID) y suma dos
  adaptadores: la **Cloud API de Meta** con una plantilla de utilidad de tres variables (recordatorio,
  mensaje y fecha) y **Resend** con correo HTML + texto. Los secretos (`WHATSAPP_TOKEN`,
  `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, `RESEND_API_KEY`, `EMAIL_FROM`) viven en Supabase y nunca
  entran al bundle; el teléfono solo pide un GET con booleanos para saber qué está configurado.
- **Estado, no solo «enviado».** `avisos` gana `estado` (`en_cola`, `enviado`, `entregado`,
  `fallido`), `entregado_en`, `proveedor_id` y `proximo_intento`. La función reclama la fila antes de
  mandarla (dos pasadas del cron no duplican), reintenta con espera creciente (1, 2, 4… minutos, tope
  1 h), respeta un tope diario por dispositivo y explica el último error.
- **Webhook autenticado.** `webhooks-envio` verifica la firma de Meta (`x-hub-signature-256`) y la de
  Resend (Svix), o un `WEBHOOK_TOKEN` compartido como respaldo, y pasa la fila a «Entregado» o
  «Falló». Un estado atrasado nunca hace retroceder otro.
- **Ajustes cuenta la verdad.** La tarjeta «Entrega real» muestra, por canal, si falta el dato, el
  ticket o la configuración de la nube; ofrece «Probar» solo cuando se puede; y lista los últimos
  envíos con canal, estado y motivo del fallo. Una cuenta sin push también sube su cola: el
  dispositivo se registra igual para que WhatsApp y correo tengan dueño.
- **Sin nube, nada se rompe.** Sin configuración, sin red o sin las migraciones, la app sigue con los
  avisos locales y la tarjeta lo explica en vez de fallar.

La cuenta de Meta Business, la plantilla aprobada y el dominio con SPF/DKIM/DMARC siguen siendo
trámites externos que tardan unos días; el código queda listo para el día que existan y la guía de
`supabase/README.md` explica el alta paso a paso. La suite nueva es `tests/e2e-envio.mjs` (41
comprobaciones: separación por canal, consentimiento, destinos, lo que sube a la nube, la tarjeta, los
botones de prueba, el modo sin red, la migración y las dos Edge Functions). La batería pasa de 799 a
**840**.

## Etapa 15: cuenta y sincronización (V2.1)

La Etapa 15 es la más grande del roadmap —cuenta, sincronización, adjuntos en la nube y lista de
dispositivos— y quedó **terminada en sus seis fases**: la cuenta, el esquema por entidad, el motor de
sincronización, la lista de dispositivos con cierre remoto, los adjuntos en Storage y Realtime.

- **Enlace mágico, sin contraseña.** `src/lib/cuenta.ts` pide el enlace a Supabase Auth, procesa la
  vuelta con los tokens en el hash, pide la cuenta con `GET /auth/v1/user`, guarda la sesión en el
  teléfono y limpia el hash. Si el enlace venció, lo explica; si no hay red, no rompe nada. La sesión
  se renueva sola un minuto antes de vencer y **no** viaja dentro de las copias de seguridad.
- **La cuenta es opcional.** El onboarding no la pide. Ajustes → *Cuenta* muestra el correo, el
  estado del vínculo y los teléfonos vinculados, con su última conexión. Cada uno se puede renombrar o
  cerrar desde otro equipo; «Cerrar sesión en todos» desvincula la lista y cierra la sesión global de
  Supabase. Al salir, la app pregunta si conservar o borrar la copia local.
- **Vincular este teléfono.** `reclamar_dispositivo` exige `auth.uid()` y el token del dispositivo (el
  id solo no alcanza), y `desvincular_dispositivo` borra únicamente el vínculo de quien llama.
- **RLS de verdad.** `perfiles_cuenta`, `dispositivos_cuenta` y las cinco entidades sincronizadas
  tienen RLS por usuario; `anon` no las toca y las escrituras pasan solo por `security definer`. La
  prueba negativa con dos cuentas y dos dispositivos se corre contra el proyecto en una transacción
  que se revierte: cada cuenta ve lo suyo, no ve lo ajeno y las escrituras directas fallan por permisos.
- **Motor de sincronización.** `src/lib/sync.ts` mantiene una cola de salida por dispositivo en
  `localStorage` (`avispate.sync.v1`) y sube recordatorios, categorías, perfiles, ajustes y marcas con
  `subir_cambios`, en lotes de hasta 200 cambios. La primera pasada baja antes de subir para que los
  valores de fábrica de un teléfono nuevo no pisen una cuenta que ya tiene datos.
- **Bajada y conflictos.** `bajar_cambios` devuelve las filas con `seq` mayor que el cursor, incluidas
  las tumbas. La regla es la misma en cliente y servidor: gana `updated_at`; si empatan,
  `dispositivo_id`; si también empatan, `md5(payload)`. Una hora futura se acota a «ahora».
- **Cuándo sincroniza.** 1,2 s después de un cambio local, cada 45 s mientras hay cuenta, al volver
  la conexión y cuando Realtime avisa que otro teléfono escribió. «Sincronizar ahora» fuerza una
  pasada y muestra el resultado en la tarjeta **Sincronización**. Sin cuenta o sin red, la app sigue
  siendo local y no se rompe nada.
- **Adjuntos.** `src/lib/adjuntos.ts` usa la API REST de Storage sin SDK: sube a
  `{user_id}/{id}`, pide URLs firmadas de una hora para mostrarlos y borra la copia remota cuando se
  quita el adjunto. El bucket es privado, de 10 MB y con tipos permitidos. Si no hay red, el archivo
  queda en IndexedDB y en la cola local; el detalle dice **En la nube** o **Solo en este teléfono**.
- **Realtime.** `src/lib/tiempo-real.ts` abre un WebSocket directo al Realtime de Supabase, se une con
  el JWT de la cuenta y escucha las cinco tablas filtradas por `user_id`. El sondeo de 45 s sigue como
  red de seguridad y la tarjeta muestra si el canal está conectado o reconectando.

Las migraciones nuevas son `0004` a `0009` (las de la Etapa 15 ya están aplicadas al proyecto; la
0009 se corre antes de publicar las funciones de calendarios) y la guía de Auth, RLS, Storage,
Realtime y calendarios está en `supabase/README.md`. Las suites de la etapa son `tests/e2e-cuenta.mjs`
(54 comprobaciones de identidad, vínculo y sesión), `tests/e2e-sync.mjs` (36: subida inicial, bajada
remota, desempate por dispositivo, tumbas, caída de red y un lote de 205 cambios),
`tests/e2e-dispositivos.mjs` (27: renombre, cierre remoto/global y copia local),
`tests/e2e-adjuntos.mjs` (14: Storage, URLs firmadas y huérfanos), `tests/e2e-tiempo-real.mjs` (14:
join, aviso y reconexión) y `tests/e2e-calendarios.mjs` (48: OAuth simulado, RLS, PKCE, push
completo/parcial, bajada de cambios, conexión por perfil, desconexión y callback). Las pruebas
negativas `supabase/tests/0005_negativo.sql` y `0006_negativo.sql` se corren contra el proyecto y se
revierten.
La batería pasa de 930 a **1035**.

La Etapa 16 ya conecta una cuenta real de Google con OAuth (PKCE + state), guarda los tokens
cifrados en la Edge Function y tiene el **push verificado con una cuenta real**. La bajada ya está
implementada y cubierta por la suite: los cambios hechos en Google se aplican a los recordatorios
locales con regla de último cambio, sin duplicar los ecos del push de la misma pasada. Falta la
pasada manual de ida y vuelta con dos cuentas. El adaptador simulado (`CALENDARIOS_MODO=simulado`,
«Modo de prueba» en Ajustes) sigue disponible para probar el circuito sin credenciales. Los detalles,
los contratos y la lista de verificación están en
[`docs/etapa16-calendarios.md`](docs/etapa16-calendarios.md).

## Roadmap: de la V2.1 a la V3.1

Esto es un plan, no una promesa: los esfuerzos son semanas de una persona y se ajustan al ritmo real. El
orden no es casual. Con el envío real ya cerrado, sigue la cuenta, porque sin cuenta no hay
sincronización ni colaboración; recién con esa base estable se conectan los calendarios y las listas
compartidas. Al final se pule la captura, la accesibilidad y la operación, y la app se empaqueta para
las tiendas. La regla de oro no cambia: **sin nube configurada AVISPATE sigue funcionando sola**, y
ninguna entrega se publica sin `npm run verificar` en verde y su suite nueva.

| Etapa | Versión | Qué agrega | Esfuerzo |
| --- | --- | --- | --- |
| 15 | V2.1 | Cuenta y sincronización entre teléfonos | 6–8 semanas |
| 16 | V2.2 | Calendarios de ida y vuelta (Google, Outlook, Apple) | 4–6 semanas |
| 17 | V2.3 | Listas y espacios compartidos | 4–6 semanas |
| 18 | V2.4 | Captura rápida, plantillas y edición en lote | 2–3 semanas |
| 19 | V2.5 | Accesibilidad AA e idiomas | 2–3 semanas |
| 20 | V2.6 | Operación, datos y confianza | 3–4 semanas |
| 21 | V3.0 | Apps nativas iOS y Android | 5–7 semanas |
| 22 | V3.1 | Lanzamiento público y soporte | 2–3 semanas |

En total, entre **28 y 40 semanas** de trabajo de una persona, sin contar los tiempos de revisión de las
tiendas. Las etapas 18 y 19 pueden correr en paralelo con la 16 o la 17 si hay más de una persona; las
demás tienen dependencias duras y no conviene adelantarlas.

**Reglas que no cambian en ninguna etapa.** Cada etapa trae su suite en `tests/`, su entrada en este
README y el pie de Ajustes actualizado; las migraciones de datos se prueban con archivos de la versión
anterior y nunca rompen una copia de seguridad; los secretos viven en Supabase, jamás en el bundle; y
publicar sigue siendo un paso aparte (`npm run verificar -- --deploy`) que se hace solo cuando se pide.

### Etapa 15 · Cuenta y sincronización entre teléfonos (V2.1)

**Objetivo:** que la misma persona vea lo mismo en el teléfono y en la computadora, y que cambiar de
teléfono no dependa de acordarse de descargar una copia. Es la etapa más grande y la que habilita el
resto.

- **Supabase Auth** con enlace mágico por correo (y Google/Apple más adelante). El modo invitado sigue
  existiendo: al crear la cuenta se ofrece «reclamar este teléfono», que sube lo que ya hay sin duplicar.
- Esquema en la nube con `user_id` en recordatorios, categorías, perfiles, avisos, ajustes y marcas, con
  **RLS por usuario** y pruebas negativas (un usuario no puede leer ni escribir lo ajeno).
- Adjuntos en Supabase Storage, con límites de tamaño, URLs firmadas y limpieza al borrar.
- Motor de sincronización: cola de salida por dispositivo, cursor de bajada, Realtime para lo urgente y
  resolución de conflictos por campo (`updatedAt` + tumbas para los borrados, desempate determinista).
  La Etapa 13 ayuda: un borrado ya puede viajar como tumba sin perder el «Deshacer» local.
- Lista de dispositivos con última conexión y botón para cerrar sesión en uno o en todos; al salir se
  puede conservar o borrar la copia local.

**Terminada cuando:** dos dispositivos convergen en segundos después de reconectar; editar sin red en
los dos no duplica ni pierde nada; cerrar sesión y volver a entrar deja todo igual; las pruebas de RLS
fallan como deben; y una cuenta nueva se puede crear desde una copia de la Etapa 13 sin perder datos.

### Etapa 16 · Calendarios de ida y vuelta (V2.2)

**Objetivo:** que un cambio hecho en AVISPATE aparezca solo en el calendario y al revés, sin bajar
archivos ni volver a cargar el evento a mano.

- Google con OAuth (PKCE) y Calendar API; Outlook con Microsoft Graph; Apple con CalDAV y contraseña de
  aplicación, o —como mínimo— una suscripción `webcal://` firmada por usuario. Los tokens se guardan
  cifrados en el servidor y se pueden revocar desde Ajustes.
- Cada ocurrencia se enlaza con su evento externo (`calendar_id` + `event_id`): crear, editar, completar
  y borrar se propagan en los dos sentidos. Los eventos externos que no son de AVISPATE se muestran, pero
  no se tocan.
- Sincronización con webhooks donde existan y sondeo donde no; «Sincronizar ahora» queda como botón de
  emergencia y el `.ics` sigue disponible para exportar.
- Política de conflictos explícita (gana el último cambio, con aviso cuando se pisa una edición ajena) y
  estado de la última sincronización por calendario.

**Terminada cuando:** crear, editar y borrar dan la vuelta completa en Google y en Outlook; un token
revocado desconecta sin romper nada; dos ciclos seguidos no duplican eventos; y hay suite con proveedores
simulados más una lista de verificación manual con cuentas reales.

### Etapa 17 · Listas y espacios compartidos (V2.3)

**Objetivo:** que dos o más personas puedan llevar juntas una lista —la casa, el trabajo, el club— sin
mandarse capturas por chat.

- Espacios con roles (dueño, administrador, miembro) e invitación por enlace, correo o teléfono.
- Se comparte una categoría o una lista completa; cada recordatorio puede asignarse a una persona, con
  comentarios y un registro de actividad («Ana completó “Pagar la luz”»).
- Avisos de cambios para los miembros, silenciables por espacio; salir de un espacio, quitar a alguien y
  transferir la propiedad.
- Todo el permiso se aplica en el servidor (RLS y funciones), no en la interfaz: la app solo muestra lo
  que la política ya permite.

**Terminada cuando:** dos cuentas ven la misma lista en tiempo real; un miembro sin permiso no puede
leer ni borrar lo ajeno (probado en negativo); al quitar a alguien sus registros históricos se conservan;
y cada espacio tiene su registro de actividad.

### Etapa 18 · Captura rápida, plantillas y edición en lote (V2.4)

**Objetivo:** cargar un recordatorio en menos de cinco segundos y tocar menos cuando hay varios.

- Frases en español en el campo rápido: «mañana 9», «cada 2 semanas», «el último viernes», «todos los
  lunes y jueves», con vista previa de lo que entendió y opción de corregir.
- Plantillas propias («Pagar servicios», «Control médico») y duplicar un recordatorio con o sin historial.
- Selección múltiple para completar, mover de categoría, posponer o borrar en lote, con el mismo
  «Deshacer» de la Etapa 13.
- Posponer desde la app (no solo desde la notificación), atajos de la PWA y «Compartir hacia AVISPATE»
  como destino del menú del teléfono.

**Terminada cuando:** las frases más comunes se interpretan bien en la suite; las acciones en lote se
deshacen completas; compartir algo desde otra app abre AVISPATE con el texto cargado; y nada de esto
rompe el modo sin conexión.


### Etapa 19 · Accesibilidad AA e idiomas (V2.5)

**Objetivo:** que AVISPATE se pueda usar con lector de pantalla, con teclado, con poco contraste o con el
texto al 200 %, y que deje de estar atada al español.

- Auditoría WCAG 2.2 AA: foco que entra y vuelve de los modales, etiquetas y nombres accesibles, contraste,
  blancos de 44 px, movimiento reducido, zoom de texto y navegación completa por teclado.
- Prueba con VoiceOver y TalkBack en los flujos principales (alta, completar, borrar y deshacer).
- Textos a diccionarios (`es` y `en`; portugués si hay demanda), fechas, números y plurales con `Intl`,
  selector de idioma y manifiesto de la PWA por idioma.

**Terminada cuando:** no queda texto fijo en los componentes; las dos lenguas pasan la batería; axe no
reporta errores graves; y la auditoría manual queda firmada en el README con lo que falta.

### Etapa 20 · Operación, datos y confianza (V2.6)

**Objetivo:** que la app aguante años de datos, versiones y usuarios sin sustos, y que se pueda operar.

- Migraciones versionadas de localStorage, IndexedDB y la nube, probadas con archivos de cada versión
  anterior; detección de cuota y limpieza guiada (la tarjeta de la Etapa 13 crece hasta aquí).
- Límite de errores y reporte **opt-in**, métricas de activación sin datos personales, y un panel para la
  cola de envíos y la sincronización.
- Exportar y borrar la cuenta de verdad (GDPR): qué se borra, cuándo y qué queda en los registros.
- Revisión de seguridad: RLS, límites de tasa, rotación de secretos, dependencias y respaldo de la base.
- Playwright en CI con capturas de las pantallas clave, presupuesto de rendimiento y alertas.

**Terminada cuando:** una instalación de cada versión migra sin perder nada; exportar y borrar deja la
cuenta limpia; una cuota llena se recupera sin corromper datos; y hay alertas para envíos y cola.

### Etapa 21 · Apps nativas iOS y Android (V3.0)

**Objetivo:** estar en las tiendas con lo que la web no puede dar: avisos nativos, widgets y bloqueo.

- Envoltura con Capacitor para iOS y Android, reutilizando la app; recursos y navegación sin parpadeos.
- Push nativo (APNs y FCM) cuando corre en la app, y el push web actual cuando corre en el navegador;
  notificaciones locales para posponer y repetir sin red.
- Widgets con los próximos recordatorios, extensión para compartir, enlaces profundos y bloqueo con
  biometría opcional.
- Fichas de tienda, etiquetas de privacidad, versión beta en TestFlight y pista interna de Play.

**Terminada cuando:** la beta está en las dos tiendas; el aviso llega con la app cerrada en iOS y Android;
los widgets muestran lo que deben; la biometría se puede activar y desactivar; y las dos revisiones
pasaron.

### Etapa 22 · Lanzamiento público y soporte (V3.1)

**Objetivo:** abrir de verdad, con red debajo.

- Beta cerrada → abierta, embudo de alta medido y ajustes de onboarding con datos, no con opiniones.
- Centro de ayuda, bandeja de soporte, página de estado y plan de respuesta.
- Términos, privacidad y encargado de tratamiento; decisión de precio o plan gratuito con límites, si
  corresponde.
- Matriz final de dispositivos y navegadores, plan de vuelta atrás del despliegue y cadencia de
  mantenimiento (una entrega por mes, con su suite).

**Terminada cuando:** la app es pública, el monitoreo lleva dos semanas en verde, el soporte tiene tiempos
documentados y queda el informe de lanzamiento con lo aprendido y el roadmap de la V3.2.

### Qué queda fuera (a propósito)

Apps de escritorio nativas, SSO empresarial y consola de administración, un asistente con IA que invente
recordatorios, publicidad y un mercado de plantillas. Si alguna entra, será una etapa nueva con su propio
número: este roadmap termina en la V3.1, con AVISPATE instalable, sincronizada, colaborativa y en las
tiendas. La Etapa 15 ya está completa: cuenta, esquema por entidad, motor de sincronización,
dispositivos y sesiones, adjuntos en Storage y Realtime. La Etapa 16 (calendarios) necesita
credenciales OAuth de Google, Apple y Microsoft; conviene iniciar ya esas verificaciones externas
—y las de Meta Business, dominio y proveedor de correo— para que no frenen el código.

## Preguntas sobre el permiso de notificaciones y el aviso de inactividad

**¿Se puede dejar el permiso de notificaciones activado por defecto?** No. Quien decide es el navegador, no la app: el permiso empieza en `default` (pendiente) y solo pasa a `granted` cuando la persona acepta *su* cartel, que además tiene que venir de un toque del usuario (Chrome, Safari y Firefox ignoran o bloquean las peticiones que no nacen de un gesto). Lo que sí se puede —y ya está hecho— es pedirlo en el mejor momento: al guardar un recordatorio que incluye el canal Notificación, y desde el botón «Activar» de Ajustes. Ojo con iPhone: Safari solo admite avisos si AVISPATE se agregó antes a la pantalla de inicio.

**¿Se puede avisar «llevas una semana sin usar la app»?** En esta versión sí, y de las dos maneras: al abrir la app después de 7 días o más aparece el aviso «Bzzt… no te olvides de no olvidarte, ¡avíspate!» con los días que pasaron, en el historial de avisos y como notificación del navegador si el permiso está concedido (una sola vez por hueco). Y desde la Etapa 10 los recordatorios avisan **con la app cerrada**: el teléfono calcula los instantes (`src/lib/cola.ts`), los sube a Supabase y un cron cada minuto llama a la Edge Function que manda el push. Para eso hace falta el service worker, el permiso del navegador, una suscripción con llaves VAPID y la nube configurada una sola vez (`supabase/README.md`); sin esa configuración la app funciona igual, pero solo avisa mientras está abierta.

## Preguntas sobre los calendarios y el selector de archivos

**¿La sincronización con Apple Calendar y Outlook es automática?** Todavía no, y conviene decirlo claro: en el navegador no hay una cuenta que conectar, así que la app hace lo que sí puede hacer sin backend — bajar el `.ics` (Apple Calendar lo abre en el iPhone o el Mac; Outlook lo importa desde el escritorio) y abrir el enlace de Outlook con el evento ya rellenado, el mismo que usa su botón «Agregar al calendario». «Sincronizar ahora» baja **todos** los recordatorios de ese usuario en un solo archivo, no uno por uno. Una sincronización de verdad —que un cambio hecho en la app aparezca solo en el calendario y al revés— necesita permisos de la cuenta: OAuth de Google, CalDAV/iCloud de Apple y Microsoft Graph para Outlook, o una suscripción a una URL `webcal://` que sirva el `.ics` desde un servidor. Eso llega en la Etapa 16 del roadmap, después de la cuenta y la sincronización entre teléfonos.

**¿Se puede evitar que el teléfono ofrezca la cámara al adjuntar una imagen?** Depende del navegador. Donde existe el selector de archivos del sistema (`showOpenFilePicker`: Chrome de escritorio y de Android) la app lo usa y la cámara no aparece como opción, porque ese selector es el explorador de archivos. Donde no existe (Safari de iPhone, Firefox) se cae al `<input type="file">` de siempre, y ahí la cámara la agrega el sistema operativo a *su* menú porque el campo acepta imágenes: iOS y Android muestran «Tomar foto» y una página web no puede quitar esa entrada (lo único que la haría desaparecer es dejar de aceptar imágenes, lo que también dejaría fuera la galería y las fotos ya guardadas). Por eso el botón **«Sacar foto»** sigue siendo la cámara de la app, con encuadre y cambio de cámara frontal/trasera, y la casilla «Imagen o documento» sirve para lo que ya está en el teléfono o en la nube.
