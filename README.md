# AVISPATE — V1.5 local (Etapa 7)

Primera transformación del prototipo de Figma Make a una V1 funcional ejecutable como aplicación web local.

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
- Selección de WhatsApp como canal, con simulación local en esta V1.
- Número de WhatsApp con extensión de país en bandera (Chile 🇨🇱 por defecto).
- Cada usuario del dispositivo con su nombre, su emoji (de la rejilla o de la lista completa de emojis), su foto, sus canales y sus calendarios.
- Categorías propias: agregar, reordenar y eliminar desde Inicio (o al crear un recordatorio), eligiendo al eliminar si sus recordatorios se borran o quedan sin categoría.
- Repeticiones por horas, días, semanas, meses o años (y personalizadas).
- Sección de tips con consejos de uso (Ajustes › Ver tips).
- Onboarding recordado entre sesiones.
- Interfaz responsive: teléfono completo en móvil y marco de teléfono en escritorio.

## Ejecutar

Requisitos: Node.js 20+ recomendado.

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
Ajustes, tips—. Son **9 suites y 604 comprobaciones**.

```bash
npm run build        # la batería prueba dist/: si está viejo, se avisa y no corre
npm test             # todas las suites (o `npm test -- ui7` para una sola)
npm run verificar    # tipos → build → batería local (no publica)
npm run verificar -- --deploy   # además publica en Vercel y corre la batería en vivo
```

- `tests/harness.mjs` - el montaje jsdom y todas las ayudas (`montar`, `wait`, `byLabel`, `swipe`,
  `storage`, `reporter`…). Un arreglo se hace **una vez** y vale para las nueve suites.
- `tests/e2e-*.mjs` - una suite por entrega. Cada una declara sus comprobaciones con `check(...)` y
  cierra con `process.exit(finish() ? 1 : 0)`.
- `tests/run.mjs` - el runner: corre las suites en orden, resume `OK/FALLA` por suite y **falla si `dist/`
  es más viejo que `src/`** (la trampa de probar una entrega anterior).
- `scripts/verificar.sh` - tipos → build → batería local (no publica); con `--deploy`, el bucle completo con el bundle publicado comparado byte a byte contra el local
  y la batería corrida **dos veces** (contra `dist/` y contra `https://recuerdapapi.vercel.app`). Los
  registros quedan en `tests/.logs/`.
- La batería en vivo, si hiciera falta, se pide a mano con `LIVE_BASE=https://recuerdapapi.vercel.app npm test`.

Dos detalles del entorno que conviene saber:

- **jsdom no resuelve selectores de atributo con emojis** (`[aria-label="Emoji 🦊 para X"]` no encuentra
  nada, aunque el valor sea idéntico). Por eso el harness busca por `aria-label` comparando el atributo a
  mano: usá `m.byLabel(...)` en vez de un selector.
- **`oxfmt` 0.2.0 rompe los tipos de TypeScript**: al formatear `src/` le saca los `;` que separan las
  propiedades de los tipos (`{ tab: string; name: string }` → `{ tab: string name: string }`) y el código
  deja de compilar. Por eso `npm run format` cubre `tests/` y `scripts/`, no `src/`. Si alguna vez hay que
  formatear `src/`, después hay que reparar los tipos (`npx tsc --noEmit` los marca uno por uno y basta con
  reponer el `;` en la columna que indica el error).

Nota sobre los lockfiles: el proyecto trae `package-lock.json` (npm, el que usan `npm install` y Vercel) y
`pnpm-lock.yaml` (el toolchain de `.mise.toml`). Si vas a instalar con pnpm, corré antes
`pnpm install --lockfile-only` para que su lockfile incluya `jsdom`, que es la dependencia de la batería.

## Nota importante sobre WhatsApp

La opción WhatsApp está preparada a nivel de UX y modelo de datos, pero **no envía mensajes reales todavía**. Para eso la siguiente etapa requiere backend + base de datos + integración oficial de WhatsApp Business Platform/Meta.

## Datos

Los recordatorios se guardan en el navegador mediante `localStorage`. El botón “Restaurar datos de demostración” vuelve a cargar los ejemplos iniciales.


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

Sigue pendiente el envío real (backend + WhatsApp Business Platform/Meta + OAuth de Google por usuario): en esta etapa la independencia es de datos y de UX, y los avisos por WhatsApp/correo siguen simulados.

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
- **Ticket para aceptar el contacto** (Ajustes › Contacto): cuando el usuario deja su número o su correo aparece un ticket («Acepto que AVISPATE use estos datos…») que hay que marcar. Mientras falte, los datos figuran como «Por confirmar», los avisos por WhatsApp y correo quedan **en pausa** (el motor cae en notificación, y Crear lo avisa) y la lista de usuarios muestra el canal apagado. Al cambiar un dato el ticket se destilda solo, para volver a aceptarlo. Los contactos guardados antes de esta etapa se toman como aceptados, así nadie pierde sus avisos.
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
- **Extensión de país en el número de WhatsApp**: el número se escribe en dos campos, un **menú de extensión de país** (21 países, **Chile `+56` por defecto**) y el número local. Se sigue guardando completo (`+56 9 1234 5678`) dentro del contacto del usuario, así valen igual el ticket, los avisos y lo que ya estaba guardado; al abrir el editor, la extensión se lee del número guardado. Está en el último paso del onboarding y en **Ajustes › Contacto**. En la segunda revisión ese menú quedó **chico y con la bandera sola** (🇨🇱, 🇦🇷, 🇺🇸…): el nombre del país no se gasta en la pantalla —se lee al abrir la lista y en el texto que aparece al pasar el dedo— y **el número se queda con todo el ancho**, así se ve completo (`+56 9 1234 5678`) junto con su estado («✓ Conectado» / «Por confirmar»), que vive en la línea del título —igual que el del correo electrónico, en la línea de «Correo electrónico»— para no robarle lugar al dato.
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

## Etapas anteriores y numeración

La app dice **V1.5** desde la entrega de avisos múltiples, notas de voz y cámara. Sobre esa versión se fueron sumando entregas de trabajo que no cambiaban el número:

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

Si se prefiere numerar cada entrega como versión, el número de hoy sería **V1.6** (una por etapa después de la V1.5); basta cambiar `APP_VERSION` y el título de este archivo. Lo razonable es mantener V1.5 durante la beta privada y subir a **V2.0** cuando llegue el backend con el envío real por WhatsApp y correo.

## Preguntas sobre el permiso de notificaciones y el aviso de inactividad

**¿Se puede dejar el permiso de notificaciones activado por defecto?** No. Quien decide es el navegador, no la app: el permiso empieza en `default` (pendiente) y solo pasa a `granted` cuando la persona acepta *su* cartel, que además tiene que venir de un toque del usuario (Chrome, Safari y Firefox ignoran o bloquean las peticiones que no nacen de un gesto). Lo que sí se puede —y ya está hecho— es pedirlo en el mejor momento: al guardar un recordatorio que incluye el canal Notificación, y desde el botón «Activar» de Ajustes. Ojo con iPhone: Safari solo admite avisos si AVISPATE se agregó antes a la pantalla de inicio.

**¿Se puede avisar «llevas una semana sin usar la app»?** En esta versión local sí, pero al abrir la app: al volver después de 7 días o más aparece el aviso «Bzzt… no te olvides de no olvidarte, ¡avíspate!» con los días que pasaron, en el historial de avisos y como notificación del navegador si el permiso está concedido (una sola vez por hueco). Lo que **no** se puede hacer todavía es avisar con la app cerrada: para eso hace falta *push* de verdad, que necesita (1) un servicio de notificaciones en el navegador —permiso, `service worker` y suscripción con llaves VAPID—, (2) un servidor que guarde las suscripciones y (3) algo que despierte ese servidor, por ejemplo un cron. Ese es el paso natural cuando llegue el backend (Supabase —tabla de suscripciones + Edge Function programada— es el camino más corto: el día que haga falta se instala `@supabase/supabase-js`).

## Preguntas sobre los calendarios y el selector de archivos

**¿La sincronización con Apple Calendar y Outlook es automática?** Todavía no, y conviene decirlo claro: en el navegador no hay una cuenta que conectar, así que la app hace lo que sí puede hacer sin backend — bajar el `.ics` (Apple Calendar lo abre en el iPhone o el Mac; Outlook lo importa desde el escritorio) y abrir el enlace de Outlook con el evento ya rellenado, el mismo que usa su botón «Agregar al calendario». «Sincronizar ahora» baja **todos** los recordatorios de ese usuario en un solo archivo, no uno por uno. Una sincronización de verdad —que un cambio hecho en la app aparezca solo en el calendario y al revés— necesita permisos de la cuenta: OAuth de Google, CalDAV/iCloud de Apple y Microsoft Graph para Outlook, o una suscripción a una URL `webcal://` que sirva el `.ics` desde un servidor. Eso llega con el backend, junto con el envío real de WhatsApp y correo.

**¿Se puede evitar que el teléfono ofrezca la cámara al adjuntar una imagen?** Depende del navegador. Donde existe el selector de archivos del sistema (`showOpenFilePicker`: Chrome de escritorio y de Android) la app lo usa y la cámara no aparece como opción, porque ese selector es el explorador de archivos. Donde no existe (Safari de iPhone, Firefox) se cae al `<input type="file">` de siempre, y ahí la cámara la agrega el sistema operativo a *su* menú porque el campo acepta imágenes: iOS y Android muestran «Tomar foto» y una página web no puede quitar esa entrada (lo único que la haría desaparecer es dejar de aceptar imágenes, lo que también dejaría fuera la galería y las fotos ya guardadas). Por eso el botón **«Sacar foto»** sigue siendo la cámara de la app, con encuadre y cambio de cámara frontal/trasera, y la casilla «Imagen o documento» sirve para lo que ya está en el teléfono o en la nube.




