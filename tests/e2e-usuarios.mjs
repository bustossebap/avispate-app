// E2E de la Etapa 1: cada usuario del dispositivo tiene su contacto (WhatsApp y correo), sus
// canales y su cuenta de Google Calendar. Recorre Ajustes con dos usuarios, el formulario de Crear,
// el motor de avisos (que debe entregar por los canales del DUEÑO) y la migración de las claves
// globales de la V1.5 (recuerda.contacto.v1 / recuerda.gcal.v1).
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const tomorrow = dayKey(new Date(Date.now() + 86400000))

const YO = {
  id: "yo",
  name: "Yo",
  emoji: "🙂",
  contact: { phone: "+56 9 1111 2222", email: "yo@ejemplo.com" },
  channels: { push: true, whatsapp: true, email: true },
  gcal: { connected: true, syncAll: true },
}
const ABUELA = { id: "abuela", name: "Abuela", emoji: "👵" }
const reminderFor = (id, ownerId, name) => ({
  id,
  ownerId,
  name,
  date: tomorrow,
  time: "12:00",
  category: "Otros",
  categoryEmoji: "📦",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels: ["WhatsApp"],
})

// Ayudas propias de esta suite: el número de WhatsApp tal como se ve en la pantalla (extensión + número)
// y el interruptor de un canal del usuario activo.
const ampliar = (sesion) =>
  Object.assign(sesion, {
    phoneValue: () =>
      `${sesion.doc.querySelector('#root select[aria-label="Extensión de país"]')?.value || ""} ${sesion.doc.querySelector("#profile-phone")?.value || ""}`.trim(),
    channelSw: (label) =>
      sesion.doc.querySelector(`[aria-label="Canal ${label} de este usuario"]`),
  })
const mount = (seed) => ampliar(montar(bundle, seed))

const { check, finish } = reporter()

// ------------------------------------------------ U1) Ajustes con dos usuarios (independencia)
{
  const m = mount({
    "recuerda.onboarding.v1": "1",
    "recuerda.profiles.v1": JSON.stringify([YO, ABUELA]),
    "recuerda.activeProfile.v1": "yo",
  })
  await wait(150)
  m.clickText("button", "Ajustes")
  await wait(60)

  check(
    "U1 · Ajustes muestra el contacto del usuario activo",
    m.txt().includes("Contacto de Yo") &&
      m.phoneValue() === "+56 9 1111 2222" &&
      m.input("profile-email")?.value === "yo@ejemplo.com",
    m.phoneValue(),
  )
  // La tarjeta de Mi perfil quedó en lo mínimo —el ícono, el nombre y «Editar»—: los canales y su estado
  // se ven en sus propias secciones de Ajustes, no ahí.
  const perfilCard = () =>
    [...m.doc.querySelectorAll("#root p")].find((el) =>
      (el.textContent || "").startsWith("Mi perfil ·"),
    )?.parentElement?.parentElement
  check(
    "U1 · la tarjeta de perfil ya no repite los canales: solo ícono, nombre y «Editar»",
    !!perfilCard() &&
      (perfilCard().textContent || "").includes("Mi perfil · Yo") &&
      !/Notificaciones|WhatsApp|Correo/.test(perfilCard().textContent || "") &&
      !perfilCard().querySelector("svg") &&
      [...m.doc.querySelectorAll("#root button")].some(
        (b) => (b.textContent || "").trim() === "Editar",
      ),
    JSON.stringify(perfilCard()?.textContent),
  )
  const abrirCal = () =>
    m.click(m.doc.querySelector('#root [aria-label^="Calendarios de"]'))
  check(
    "U1 · los calendarios viven en un desplegable, y dice de quién son",
    m.txt().includes("Calendarios de Yo") &&
      !m.doc.querySelector(
        '#root [aria-label="Sincronizar todos los avisos con Google Calendar"]',
      ),
  )
  abrirCal()
  await wait(60)
  check(
    "U1 · al abrirlo aparece su Google Calendar con «Todos los avisos»",
    m.txt().includes("Todos los avisos") &&
      !!m.doc.querySelector(
        '#root [aria-label="Sincronizar todos los avisos con Google Calendar"]',
      ),
  )
  check(
    "U1 · sus canales arrancan como los dejó",
    m.channelSw("WhatsApp")?.getAttribute("aria-checked") === "true" &&
      m.channelSw("Correo electrónico")?.getAttribute("aria-checked") ===
        "true",
  )

  m.clickText("button", "Abuela")
  await wait(60)
  check(
    "U1 · al cambiar de usuario Ajustes muestra lo suyo",
    m.txt().includes("Contacto de Abuela") &&
      m.input("profile-phone")?.value === "" &&
      m.input("profile-email")?.value === "",
    JSON.stringify(m.txt().slice(-260)),
  )
  check(
    "U1 · el perfil de Abuela tampoco lista canales y sus calendarios siguen sin conectar",
    m.txt().includes("Mi perfil · Abuela") &&
      !m.txt().includes("Notificaciones push · ") &&
      m.txt().includes("Google, Apple y Outlook · sin conectar"),
  )
  check(
    "U1 · Abuela no tiene la opción «Todos los avisos»: su cuenta no está conectada",
    !m.doc.querySelector(
      '[aria-label="Sincronizar todos los avisos con Google Calendar"]',
    ),
  )
  check(
    "U1 · sus canales arrancan por defecto: push y WhatsApp sí, correo no",
    m.channelSw("WhatsApp")?.getAttribute("aria-checked") === "true" &&
      m.channelSw("Correo electrónico")?.getAttribute("aria-checked") ===
        "false",
  )

  m.type(m.input("profile-phone"), "9 3333 4444")
  await wait(30)
  check(
    "U1 · el teléfono de Abuela se guarda en Abuela",
    m.profileOf("abuela")?.contact?.phone === "+56 9 3333 4444",
    JSON.stringify(m.profileOf("abuela")),
  )
  check(
    "U1 · y no toca el de Yo",
    m.profileOf("yo")?.contact?.phone === "+56 9 1111 2222",
  )
  m.click(m.channelSw("WhatsApp"))
  await wait(30)
  check(
    "U1 · apagar WhatsApp es solo de Abuela",
    m.profileOf("abuela")?.channels?.whatsapp === false &&
      m.profileOf("yo")?.channels?.whatsapp === true,
    JSON.stringify(m.profileOf("abuela")),
  )
  check(
    "U1 · escribir en Abuela no le conecta el calendario",
    m.profileOf("abuela")?.gcal === undefined,
    JSON.stringify(m.profileOf("abuela")),
  )
  check(
    "U1 · la app no escribe en las claves viejas",
    m.storage("recuerda.contacto.v1") === null &&
      m.storage("recuerda.gcal.v1") === null,
  )

  m.clickText("button", "Yo")
  await wait(60)
  check(
    "U1 · al volver a Yo siguen sus datos, canales y calendario",
    m.phoneValue() === "+56 9 1111 2222" &&
      m.channelSw("WhatsApp")?.getAttribute("aria-checked") === "true" &&
      m.txt().includes("Todos los avisos") &&
      m.txt().includes("Mi perfil · Yo"),
  )
  check(
    "U1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------------ U1b) Agregar un usuario desde Ajustes
{
  const m = mount({
    "recuerda.onboarding.v1": "1",
    "recuerda.profiles.v1": JSON.stringify([YO]),
    "recuerda.activeProfile.v1": "yo",
    // Yo tiene un recordatorio: así se ve que el usuario nuevo arranca vacío y no hereda lo ajeno.
    "recuerda.events.v1": JSON.stringify([
      reminderFor("u-yo", "yo", "Cita Yo"),
    ]),
  })
  await wait(150)
  m.clickText("button", "Ajustes")
  await wait(80)
  // `byLabel` viene del harness (compara el atributo a mano, porque jsdom falla con los emojis).
  const byLabel = m.byLabel
  const nuevo = () => m.find("#root button", "＋ Nuevo usuario")
  const agregar = () => m.find("#root button", "Agregar")
  const nombre = () =>
    m.doc.querySelector('#root input[placeholder="Nombre (ej. Abuela)"]')
  const activo = () =>
    m.window.localStorage.getItem("recuerda.activeProfile.v1")

  check(
    "U1b · «Usuarios de este dispositivo» trae «＋ Nuevo usuario»",
    m.txt().includes("Usuarios de este dispositivo") && !!nuevo() && !nombre(),
    JSON.stringify(m.txt().slice(-200)),
  )
  check(
    "U1b · el botón va al final de la misma tarjeta de usuarios",
    (nuevo()?.parentElement?.className || "").includes("bg-white") &&
      m.txt().indexOf("＋ Nuevo usuario") >
        m.txt().indexOf("Usuarios de este dispositivo"),
  )
  m.click(nuevo())
  await wait(60)
  check(
    "U1b · al presionarlo se pide el nombre y su cara, como en Inicio",
    !!nombre() &&
      !!byLabel("Emoji de el usuario nuevo") &&
      !!byLabel("Tomar o subir la foto de el usuario nuevo") &&
      !!agregar(),
  )
  check(
    "U1b · con la rejilla de emoji y el botón «+» de la lista completa",
    (byLabel("Emoji de el usuario nuevo")?.querySelectorAll("button").length ||
      0) === 12 && !!byLabel("Ver todos los emojis para el usuario nuevo"),
  )
  m.click(agregar())
  await wait(40)
  check(
    "U1b · sin nombre no agrega nada (el formulario sigue abierto)",
    (m.storage("recuerda.profiles.v1") || []).length === 1 && !!nombre(),
  )

  m.type(nombre(), "Taller")
  await wait(40)
  check(
    "U1b · el nombre que se escribe es el del usuario que se está creando",
    !!byLabel("Emoji de Taller") &&
      !!byLabel("Tomar o subir la foto de Taller"),
  )
  m.click(byLabel("Ver todos los emojis para Taller"))
  await wait(40)
  check(
    "U1b · la lista completa de emojis también está en esta alta",
    !!m.doc.querySelector('[role="tablist"]') &&
      !!byLabel("Emojis de Animales para Taller") &&
      (m.doc.querySelectorAll('[role="tab"]').length || 0) === 9,
  )
  m.click(byLabel("Emojis de Animales para Taller"))
  await wait(40)
  check(
    "U1b · y se puede elegir uno de la lista, no solo de la rejilla",
    !!byLabel("Emoji 🦊 para Taller"),
  )
  m.click(byLabel("Emoji 🦊 para Taller"))
  await wait(40)
  // Su foto, con la cámara o la galería y la vista previa de siempre.
  m.click(byLabel("Tomar o subir la foto de Taller"))
  await wait(60)
  const selector = m.doc.querySelector('input[type="file"][accept="image/*"]')
  const file = new m.window.File(["foto-de-taller"], "taller.png", {
    type: "image/png",
  })
  Object.defineProperty(selector, "files", {
    value: [file],
    configurable: true,
  })
  selector.dispatchEvent(new m.window.Event("change", { bubbles: true }))
  await wait(1300)
  check(
    "U1b · la foto se ve en la vista previa, con el ✓ y la ✕",
    !!m.doc.querySelector('img[alt="Vista previa de la foto de Taller"]') &&
      !!byLabel("Usar esta foto de Taller") &&
      !!byLabel("Cancelar esta foto de Taller"),
  )
  m.click(byLabel("Usar esta foto de Taller"))
  await wait(80)
  check(
    "U1b · el ✓ la deja en el editor del usuario nuevo",
    !!m.doc.querySelector('#root img[alt="Foto de Taller"]'),
  )

  m.click(agregar())
  await wait(90)
  const creado = (m.storage("recuerda.profiles.v1") || []).find(
    (p) => p.name === "Taller",
  )
  check(
    "U1b · al agregar queda en la lista, con su emoji y su foto",
    !!creado &&
      creado.emoji === "🦊" &&
      String(creado.photo || "").startsWith("data:image/") &&
      (m.storage("recuerda.profiles.v1") || []).length === 2,
    JSON.stringify(creado),
  )
  check(
    "U1b · y pasa a ser el usuario activo, como cuando se agrega desde Inicio",
    activo() === creado?.id &&
      m.txt().includes("Contacto de Taller") &&
      m.txt().includes("Mi perfil · Taller"),
    activo(),
  )
  check(
    "U1b · arranca sin recordatorios ni contacto propios",
    m.txt().includes("0 recordatorios") &&
      m.txt().includes("1 recordatorio") &&
      m.input("profile-phone")?.value === "" &&
      m.input("profile-email")?.value === "",
  )
  check(
    "U1b · el formulario se cierra y el botón vuelve a estar",
    !nombre() && !!nuevo(),
  )
  m.click(nuevo())
  await wait(60)
  m.type(nombre(), "A medias")
  await wait(40)
  m.click(byLabel("Cancelar el usuario nuevo"))
  await wait(60)
  check(
    "U1b · «×» cancela el alta sin dejar nada a medias",
    (m.storage("recuerda.profiles.v1") || []).length === 2 && !nombre(),
    JSON.stringify(
      (m.storage("recuerda.profiles.v1") || []).map((p) => p.name),
    ),
  )
  check(
    "U1b · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------------ U3) Crear: canales y calendario por usuario
{
  const m = mount({
    "recuerda.onboarding.v1": "1",
    "recuerda.profiles.v1": JSON.stringify([YO, ABUELA]),
    "recuerda.activeProfile.v1": "yo",
  })
  await wait(150)
  m.click(m.doc.querySelector('[aria-label="Nuevo recordatorio"]'))
  await wait(80)
  check(
    "U2 · Crear abre con el usuario activo",
    m.txt().includes("Nuevo recordatorio") && m.txt().includes("Recordar para"),
    JSON.stringify(m.txt().slice(0, 80)),
  )
  check(
    "U2 · el calendario del usuario conectado viene activado (Todos los avisos)",
    m.doc
      .querySelector('[aria-label="Agregar a Google Calendar"]')
      ?.getAttribute("aria-pressed") === "true" &&
      m.txt().includes("Google Calendar está conectado en Ajustes"),
  )

  m.clickText("button", "WhatsApp")
  await wait(30)
  check(
    "U2 · para Yo no hay aviso de canal sin configurar",
    !m.txt().includes("todavía no tiene configurado"),
  )
  m.clickText("button", "Abuela")
  await wait(30)
  // El aviso de canal sin configurar ya no lleva el emoji de burbuja: WhatsApp va con su logo real.
  const falta = () =>
    [...m.doc.querySelectorAll("#root p")].find((p) =>
      (p.textContent || "").includes("todavía no tiene configurado"),
    )
  check(
    "U2 · para Abuela avisa que WhatsApp no está configurado, con su logo",
    m.txt().includes("Abuela todavía no tiene configurado") &&
      (falta()?.textContent || "").includes("WhatsApp") &&
      !!falta()?.querySelector('svg path[fill="#25D366"]') &&
      !m.txt().includes("💬"),
    JSON.stringify(falta()?.textContent),
  )
  check(
    "U2 · y que ese aviso saldrá por notificación",
    m
      .txt()
      .includes(
        "ese aviso saldrá por notificación. Puedes configurarlo en Ajustes › Contacto",
      ),
  )
  check(
    "U2 · el calendario de Abuela no está conectado: desaparece la nota de Ajustes",
    !m.txt().includes("Google Calendar está conectado en Ajustes"),
  )
  check(
    "U2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------------ U3) el motor avisa por los canales del dueño
{
  const m = mount({
    "recuerda.onboarding.v1": "1",
    "recuerda.profiles.v1": JSON.stringify([YO, ABUELA]),
    "recuerda.activeProfile.v1": "yo",
    "recuerda.events.v1": JSON.stringify([
      reminderFor("u-yo", "yo", "Cita Yo"),
      reminderFor("u-ab", "abuela", "Cita Abuela"),
    ]),
  })
  await wait(150)
  check(
    "U3 · el aviso del usuario con WhatsApp sale por WhatsApp (simulado)",
    m.notifOf("Cita Yo")?.channel === "WhatsApp (simulado en V1)",
    JSON.stringify(m.notifOf("Cita Yo")),
  )
  check(
    "U3 · el del usuario sin WhatsApp cae en notificación",
    m.notifOf("Cita Abuela")?.channel === "Notificación",
    JSON.stringify(m.notifOf("Cita Abuela")),
  )
  check(
    "U3 · cada aviso queda a nombre de su usuario",
    m.notifOf("Cita Yo")?.ownerId === "yo" &&
      m.notifOf("Cita Abuela")?.ownerId === "abuela",
  )
  check(
    "U3 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------------ U4) sin ningún canal listo no se envía nada
{
  const m = mount({
    "recuerda.onboarding.v1": "1",
    "recuerda.profiles.v1": JSON.stringify([
      YO,
      { ...ABUELA, channels: { push: false, whatsapp: true, email: false } },
    ]),
    "recuerda.activeProfile.v1": "abuela",
    "recuerda.events.v1": JSON.stringify([
      reminderFor("u-ab", "abuela", "Cita Abuela"),
    ]),
  })
  await wait(150)
  check(
    "U4 · sin canales listos no se envía nada (apagó notificaciones y no tiene WhatsApp)",
    m.notifOf("Cita Abuela") === undefined,
    JSON.stringify(m.notifications()),
  )
  check(
    "U4 · y no se marca como enviado, así lo recibe al configurar su canal",
    m.window.localStorage.getItem(`recuerda.sent.u-ab:preset-1:${dayKey()}`) ===
      null,
  )
  check(
    "U4 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------------ U5) migración de la V1.5
{
  const m = mount({
    "recuerda.onboarding.v1": "1",
    "recuerda.contacto.v1": JSON.stringify({
      phone: "+56 9 5555 6666",
      email: "viejo@ejemplo.com",
    }),
    "recuerda.gcal.v1": JSON.stringify({
      connected: true,
      syncAll: false,
      lastSync: "2026-09-18T10:00:00.000Z",
    }),
  })
  await wait(150)
  check(
    "U5 · el contacto global se mudó al usuario «yo»",
    m.profileOf("yo")?.contact?.phone === "+56 9 5555 6666" &&
      m.profileOf("yo")?.contact?.email === "viejo@ejemplo.com",
    JSON.stringify(m.profileOf("yo")),
  )
  check(
    "U5 · y su Google Calendar también, con la fecha de sincronización",
    m.profileOf("yo")?.gcal?.connected === true &&
      m.profileOf("yo")?.gcal?.syncAll === false &&
      m.profileOf("yo")?.gcal?.lastSync === "2026-09-18T10:00:00.000Z",
    JSON.stringify(m.profileOf("yo")),
  )
  check(
    "U5 · las claves viejas se borran (una sola fuente de verdad)",
    m.storage("recuerda.contacto.v1") === null &&
      m.storage("recuerda.gcal.v1") === null,
  )
  m.clickText("button", "Ajustes")
  await wait(60)
  m.click(m.doc.querySelector('#root [aria-label^="Calendarios de"]'))
  await wait(60)
  check(
    "U5 · Ajustes ya lo muestra como datos del usuario",
    m.phoneValue() === "+56 9 5555 6666" &&
      m.input("profile-email")?.value === "viejo@ejemplo.com" &&
      m.txt().includes("Todos los avisos"),
  )
  check(
    "U5 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------------ U6) estáticos del bundle
check(
  "U6 · el bundle trae el contacto y los canales por usuario",
  bundle.includes("Contacto de") &&
    bundle.includes("de este usuario") &&
    bundle.includes("todavía no tiene configurado"),
)
// El alta de usuarios vive en las dos pantallas: Inicio y la tarjeta «Usuarios de este dispositivo».
check(
  "U6 · el bundle trae el alta de usuarios de Ajustes (y su «×» para descartarla)",
  bundle.includes("Cancelar el usuario nuevo") &&
    bundle.includes("Usuario nuevo") &&
    bundle.includes("＋ Nuevo usuario"),
)
check(
  "U6 · el bundle sigue leyendo las claves de la V1.5 solo para migrar",
  bundle.includes("recuerda.contacto.v1") &&
    bundle.includes("recuerda.gcal.v1"),
)

process.exit(finish() ? 1 : 0)
