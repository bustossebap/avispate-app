// E2E de la Etapa 5 (ajustes pedidos sobre la V1.5 local): el onboarding también se desliza con el
// dedo en el teléfono (touchmove y touchcancel incluidos, y sin saltar dos pasos por el clic del
// gesto), el emoji del usuario se elige en una rejilla al crearlo y en Ajustes › Mi perfil (que ya no
// repite la versión de la app), la casilla de archivos usa el explorador del sistema para no ofrecer
// la cámara y muestra carpeta e imagen, y la sincronización con Apple Calendar y Outlook se puede
// elegir por recordatorio (Nuevo recordatorio y detalle) o para todos los recordatorios (Ajustes).
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
// El día de mañana tal como lo calcula la app para la fecha por defecto: a partir del ISO en UTC.
const hoy = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const evento = (id, ownerId, name) => ({
  id,
  ownerId,
  name,
  date: tomorrow,
  time: "12:00",
  category: "Otros",
  categoryEmoji: "📦",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels: ["Notificación"],
})
const YO = {
  id: "yo",
  name: "Yo",
  emoji: "🙂",
  contact: { phone: "", email: "" },
  channels: { push: true, whatsapp: true, email: true },
  gcal: { connected: false },
}
const ABUELA = { id: "abuela", name: "Abuela", emoji: "👵" }
const seedBase = (extra) => ({
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([YO]),
  "avispate.activeProfile.v1": "yo",
  "avispate.reloj.v1": "24",
  ...extra,
})

const mount = (seed) => montar(bundle, seed, { descargas: true })

const { check, finish } = reporter()

// ------------------------------------------- S) deslizar con el dedo (y con el gesto cortado)
{
  const m = mount()
  await wait(150)
  check(
    "S1 · arranca en la intro de la abeja",
    m.txt().includes("Bzzzt") && m.dots().length === 0,
    JSON.stringify(m.txt().slice(0, 90)),
  )
  m.tap()
  await wait(60)
  check(
    "S1 · el toque abre el pitch (sigue en el paso 1/7)",
    m.txt().includes("Anota lo importante") && m.stepAt() === 0,
  )

  await m.swipe(-120)
  check(
    "S1 · el dedo desliza al paso 2/7",
    m.stepAt() === 1 && m.txt().includes("Recibe recordatorios"),
    `${m.stepAt()} · ${m.txt().slice(0, 90)}`,
  )

  // Los navegadores de teléfono mandan un clic al terminar el gesto: no puede contar como toque.
  m.tap()
  await wait(40)
  check(
    "S1 · el clic que sigue al gesto no avanza otra vez",
    m.stepAt() === 1,
    String(m.stepAt()),
  )
  await wait(400)

  // Y cuando el navegador se queda con el gesto, cierra la secuencia con touchcancel y sin decir
  // dónde terminó: la app usa el último punto del touchmove y avanza igual.
  await m.swipe(-130, 0, "touchcancel")
  check(
    "S1 · un gesto cortado (touchcancel) también avanza",
    m.stepAt() === 2,
    String(m.stepAt()),
  )

  await m.swipe(140)
  check(
    "S1 · deslizar hacia la derecha vuelve al paso 2/7",
    m.stepAt() === 1,
    String(m.stepAt()),
  )

  await m.swipe(10, -150)
  check(
    "S1 · el gesto vertical sigue siendo scroll (no cambia de paso)",
    m.stepAt() === 1,
    String(m.stepAt()),
  )
  await m.swipe(20)
  check(
    "S1 · el gesto corto tampoco cambia de paso",
    m.stepAt() === 1,
    String(m.stepAt()),
  )

  const zona = m.tapEl()
  check(
    "S1 · la zona de deslizar deja el scroll vertical al navegador",
    zona?.style.touchAction === "pan-y",
    zona?.getAttribute("style") || "",
  )
  check(
    "S1 · y sigue siendo la misma superficie de toque de siempre",
    (zona?.className || "").includes("select-none"),
    zona?.className || "",
  )
  check(
    "S1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- E) el emoji de cada usuario
{
  const m = mount(seedBase())
  await wait(150)

  // a) crear un usuario desde Inicio: el emoji se elige en la rejilla, ya no se escribe.
  m.click(m.doc.querySelector('[aria-label="Cambiar usuario"]'))
  await wait(60)
  m.clickText("button", "＋ Nuevo usuario")
  await wait(60)
  const rejilla = () =>
    m.doc.querySelector('#root [role="group"][aria-label^="Emoji de"]')
  check(
    "E1 · «＋ Nuevo usuario» trae la rejilla de emoji (con el botón «Otro»)",
    !!rejilla() &&
      rejilla().querySelectorAll("button").length === 12 &&
      !!m.byLabel("Ver todos los emojis para el usuario nuevo"),
    rejilla()?.getAttribute("aria-label"),
  )
  check(
    "E1 · y ya no hay un campo de texto para el emoji",
    !m.doc.querySelector('input[placeholder="🙂"]') &&
      !m.doc.querySelector('input[maxlength="4"]'),
  )
  m.type(
    m.doc.querySelector('input[placeholder="Nombre (ej. Abuela)"]'),
    "Taller",
  )
  await wait(40)
  check(
    "E1 · la rejilla dice de quién es el emoji",
    rejilla()?.getAttribute("aria-label") === "Emoji de Taller",
    rejilla()?.getAttribute("aria-label"),
  )
  m.press(m.byLabel("Emoji 🐝 para Taller"))
  await wait(40)
  check(
    "E1 · el emoji elegido queda marcado",
    m.byLabel("Emoji 🐝 para Taller")?.getAttribute("aria-pressed") ===
      "true" &&
      rejilla().querySelectorAll('[aria-pressed="true"]').length === 1,
  )
  m.clickText("button", "Agregar")
  await wait(60)
  const taller = () =>
    (m.storage("avispate.profiles.v1") || []).find((p) => p.name === "Taller")
  check(
    "E1 · el usuario nuevo se guarda con su emoji",
    taller()?.emoji === "🐝",
    JSON.stringify(taller()),
  )
  check(
    "E1 · y queda activo en el inicio",
    m.txt().includes("Taller"),
    JSON.stringify(
      (m.storage("avispate.profiles.v1") || []).map((p) => p.name),
    ),
  )

  // b) cambiarlo después, en Ajustes › Mi perfil, sin tocar a los demás. El nombre y la cara (emoji o
  //    foto) se editan con el botón «Editar» y recién se guardan al apretar «Guardar».
  await m.irAjustes()
  const tallerId = (m.storage("avispate.profiles.v1") || []).find(
    (p) => p.name === "Taller",
  )?.id
  const tallerAhora = () => m.profileOf(tallerId)
  const editar = () =>
    [...m.doc.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Editar",
    )
  const delActivo = () => m.byLabel("Emoji de Taller")
  check(
    "E2 · la tarjeta de Mi perfil es la del usuario activo",
    m.txt().includes("Mi perfil · Taller") &&
      m.txt().includes("Usuarios de este dispositivo"),
  )
  check(
    "E2 · la cara no está siempre a la vista: se edita desde «Editar»",
    !!editar() && !delActivo() && !m.doc.getElementById("profile-name"),
  )
  m.press(editar())
  await wait(60)
  check(
    "E2 · al abrirlo aparece el nombre del usuario",
    m.doc.getElementById("profile-name")?.value === "Taller",
    m.doc.getElementById("profile-name")?.value,
  )
  check(
    "E2 · y la rejilla de emoji, con el suyo marcado",
    !!delActivo() &&
      delActivo().querySelectorAll("button").length === 12 &&
      delActivo()
        .querySelector('[aria-pressed="true"]')
        ?.getAttribute("aria-label") === "Emoji 🐝 para Taller",
    delActivo()
      ?.querySelector('[aria-pressed="true"]')
      ?.getAttribute("aria-label"),
  )
  check(
    "E2 · con el botón de cámara para tomar o subir su foto",
    !!m.byLabel("Tomar o subir la foto de Taller") &&
      !!m.doc.querySelector(
        '#root button[aria-label="Tomar o subir la foto de Taller"] svg',
      ),
  )
  m.press(m.byLabel("Emoji 👵 para Taller"))
  await wait(60)
  check(
    "E2 · el emoji nuevo todavía no se guarda: falta apretar Guardar",
    tallerAhora()?.emoji === "🐝",
    JSON.stringify(tallerAhora()),
  )
  m.type(m.doc.getElementById("profile-name"), "Taller de Papá")
  await wait(40)
  m.clickText("button", "Guardar")
  await wait(60)
  check(
    "E2 · al guardar quedan el emoji y el nombre nuevos en ese usuario",
    tallerAhora()?.emoji === "👵" && tallerAhora()?.name === "Taller de Papá",
    JSON.stringify(tallerAhora()),
  )
  check(
    "E2 · y no toca el de los demás",
    m.profileOf("yo")?.emoji === "🙂",
    JSON.stringify(m.profileOf("yo")),
  )
  check(
    "E2 · el editor se cierra al guardar",
    !m.doc.getElementById("profile-name") && !!editar(),
  )
  check(
    "E2 · la tarjeta de Mi perfil ya no repite la versión de la app",
    !(m.cardOf("Mi perfil · Taller de Papá")?.outerHTML || "").includes("V1.5"),
    (m.cardOf("Mi perfil · Taller de Papá")?.className || "").slice(0, 60),
  )
  check(
    "E2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )

  // c) el onboarding sigue pidiendo el emoji con la misma rejilla.
  const onb = mount()
  await wait(150)
  onb.tap()
  await wait(40)
  for (let i = 0; i < 5; i++) {
    onb.tap()
    await wait(40)
  }
  check(
    "E3 · el paso del nombre sigue con su rejilla (y la abeja es la cara por defecto)",
    !!onb.doc.getElementById("onboarding-name") &&
      !!onb.byLabel("Emoji de ti") &&
      onb.byLabel("Emoji 🐝 para ti")?.getAttribute("aria-pressed") === "true",
    onb.txt().slice(0, 90),
  )
  check(
    "E3 · sin errores de ejecución",
    onb.errors.length === 0,
    onb.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- F) archivos: sin cámara y con el emoji de imagen
{
  const m = mount(seedBase())
  await wait(150)
  await m.crearNuevo()
  const casilla = () =>
    [...m.doc.querySelectorAll("#root button")].find((b) =>
      (b.textContent || "").includes("Imagen o documento"),
    )
  const entrada = () => m.doc.querySelector('#root input[type="file"]')
  check(
    "F1 · la casilla lleva la carpeta y la imagen",
    (casilla()?.textContent || "").includes("📂") &&
      (casilla()?.textContent || "").includes("🖼️"),
    casilla()?.textContent,
  )
  check(
    "F1 · la cámara sigue en su propio botón «Sacar foto»",
    !!m.find("#root button", "Sacar foto") &&
      !(casilla()?.textContent || "").includes("📷"),
  )
  check(
    "F1 · el respaldo escondido acepta imágenes y documentos, sin captura forzada",
    !!entrada() &&
      (entrada().className || "").includes("hidden") &&
      entrada().hasAttribute("multiple") &&
      !entrada().hasAttribute("capture") &&
      (entrada().getAttribute("accept") || "").includes("image/*") &&
      (entrada().getAttribute("accept") || "").includes(".pdf"),
    entrada()?.outerHTML.slice(0, 150),
  )

  // a) Con selector del sistema (Chrome de escritorio y de Android): abre el explorador de archivos,
  // que no ofrece la cámara, y el input de siempre ni se toca.
  const llamadas = []
  m.window.showOpenFilePicker = async (options) => {
    llamadas.push(options)
    return [
      {
        getFile: async () =>
          new m.window.File(["x"], "foto.png", { type: "image/png" }),
      },
    ]
  }
  let respaldo = 0
  entrada().addEventListener("click", () => {
    respaldo += 1
  })
  m.press(casilla())
  await wait(80)
  check(
    "F1 · con selector del sistema se abre el explorador y no el input",
    llamadas.length === 1 && respaldo === 0,
    `${llamadas.length} llamadas · ${respaldo} respaldos`,
  )
  check(
    "F1 · el selector no pide cámara: pide tipos de archivo y varios a la vez",
    llamadas[0]?.multiple === true &&
      JSON.stringify(llamadas[0]?.types || []).includes("image/*") &&
      !JSON.stringify(llamadas[0] || {}).includes("capture"),
    JSON.stringify(llamadas[0] || "sin llamadas").slice(0, 170),
  )
  check(
    "F1 · y el archivo elegido queda en la lista",
    m.txt().includes("foto.png"),
    JSON.stringify(m.txt().slice(-140)),
  )

  // b) Sin selector del sistema (Safari de iPhone, Firefox): se cae al input de siempre para no dejar
  // a nadie sin manera de adjuntar.
  const m2 = mount(seedBase())
  await wait(150)
  await m2.crearNuevo()
  const casilla2 = () =>
    [...m2.doc.querySelectorAll("#root button")].find((b) =>
      (b.textContent || "").includes("Imagen o documento"),
    )
  const entrada2 = () => m2.doc.querySelector('#root input[type="file"]')
  let abierto = 0
  entrada2().addEventListener("click", () => {
    abierto += 1
  })
  m2.press(casilla2())
  await wait(80)
  check(
    "F1 · sin selector del sistema se usa el input de siempre",
    abierto === 1,
    String(abierto),
  )
  check(
    "F1 · sin errores de ejecución",
    m.errors.length === 0 && m2.errors.length === 0,
    [...m.errors, ...m2.errors].join(" | ").slice(0, 200),
  )

  // ------------------------------------------- C) Apple Calendar y Outlook por recordatorio
  {
    const m = mount(seedBase({ "avispate.profiles.v1": JSON.stringify([YO]) }))
    await wait(150)
    await m.crearNuevo()
    const sw = (app) =>
      m.doc.querySelector(`#root [aria-label="Agregar a ${app}"]`)
    check(
      "C1 · Nuevo recordatorio trae los tres calendarios",
      !!sw("Google Calendar") && !!sw("Apple Calendar") && !!sw("Outlook"),
    )
    check(
      "C1 · con los tres logos reales",
      !!m.doc.querySelector('#root svg path[fill="#4285F4"]') &&
        !!m.doc.querySelector('#root svg path[fill="#1D1D1F"]') &&
        !!m.doc.querySelector('#root svg path[fill="#0F6CBD"]'),
    )
    check(
      "C1 · sin cuentas conectadas los tres arrancan apagados",
      ["Google Calendar", "Apple Calendar", "Outlook"].every(
        (app) => sw(app)?.getAttribute("aria-pressed") === "false",
      ),
      ["Google Calendar", "Apple Calendar", "Outlook"]
        .map((app) => sw(app)?.getAttribute("aria-pressed"))
        .join(","),
    )
    check(
      "C1 · ya no queda la fila suelta de «Descargar archivo .ics»",
      !m.txt().includes("Descargar archivo .ics"),
    )

    m.type(m.nombreInput(), "Cambio de aceite")
    await wait(30)
    m.press(sw("Apple Calendar"))
    m.press(sw("Outlook"))
    await wait(40)
    check(
      "C1 · se pueden encender por separado",
      sw("Apple Calendar")?.getAttribute("aria-pressed") === "true" &&
        sw("Outlook")?.getAttribute("aria-pressed") === "true" &&
        sw("Google Calendar")?.getAttribute("aria-pressed") === "false",
      ["Google Calendar", "Apple Calendar", "Outlook"]
        .map((app) => sw(app)?.getAttribute("aria-pressed"))
        .join(","),
    )
    m.pressText("button", "Guardar recordatorio")
    await wait(140)
    const guardado = m.events()[0]
    check(
      "C1 · el recordatorio queda marcado solo en los calendarios elegidos",
      !!guardado?.appleAddedAt &&
        !!guardado?.outlookAddedAt &&
        !guardado?.gcalAddedAt,
      JSON.stringify({
        apple: !!guardado?.appleAddedAt,
        outlook: !!guardado?.outlookAddedAt,
        google: !!guardado?.gcalAddedAt,
      }),
    )
    const ics = await m.download(0)
    check(
      "C1 · Apple Calendar recibe su archivo .ics",
      ics.includes("BEGIN:VCALENDAR") &&
        ics.includes("SUMMARY:Cambio de aceite") &&
        ics.includes("END:VEVENT"),
      ics.slice(0, 90),
    )
    const enlace = decodeURIComponent(m.opened[0] || "").replace(/\+/g, " ")
    check(
      "C1 · y Outlook recibe su enlace con el evento ya rellenado",
      m.opened.length === 1 &&
        enlace.startsWith(
          "https://outlook.live.com/calendar/0/deeplink/compose?",
        ) &&
        enlace.includes("rru=addevent") &&
        enlace.includes("subject=Cambio de aceite") &&
        enlace.includes(`startdt=${hoy}T12:00:00`) &&
        enlace.includes(`enddt=${hoy}T13:00:00`),
      enlace.slice(0, 210),
    )
    check(
      "C1 · sin errores de ejecución",
      m.errors.length === 0,
      m.errors.join(" | ").slice(0, 200),
    )

    // Con «Todos los avisos» encendido en Ajustes, los recordatorios nuevos ya vienen marcados.
    const conectado = {
      ...YO,
      apple: { connected: true, syncAll: true },
      outlook: { connected: true, syncAll: true },
    }
    const m2 = mount(
      seedBase({ "avispate.profiles.v1": JSON.stringify([conectado]) }),
    )
    await wait(150)
    await m2.crearNuevo()
    const sw2 = (app) =>
      m2.doc.querySelector(`#root [aria-label="Agregar a ${app}"]`)
    check(
      "C2 · con Apple y Outlook conectados, los nuevos vienen marcados",
      sw2("Apple Calendar")?.getAttribute("aria-pressed") === "true" &&
        sw2("Outlook")?.getAttribute("aria-pressed") === "true" &&
        sw2("Google Calendar")?.getAttribute("aria-pressed") === "false",
    )
    check(
      "C2 · y el formulario dice de dónde sale ese ajuste",
      m2.txt().includes("Apple Calendar está conectado en Ajustes") &&
        m2.txt().includes("Outlook está conectado en Ajustes"),
    )

    const soloApple = { ...YO, apple: { connected: true, syncAll: false } }
    const m3 = mount(
      seedBase({ "avispate.profiles.v1": JSON.stringify([soloApple]) }),
    )
    await wait(150)
    await m3.crearNuevo()
    check(
      "C2 · con «Todos los avisos» apagado el nuevo se crea sin marcar",
      m3.doc
        .querySelector('#root [aria-label="Agregar a Apple Calendar"]')
        ?.getAttribute("aria-pressed") === "false" &&
        m3.doc
          .querySelector('#root [aria-label="Agregar a Outlook"]')
          ?.getAttribute("aria-pressed") === "false",
    )
  }

  // El detalle del recordatorio ofrece los tres calendarios y marca cada uno por separado.
  const d = mount(
    seedBase({
      "avispate.events.v1": JSON.stringify([
        evento("e1", "yo", "Renovar licencia"),
      ]),
    }),
  )
  await wait(150)
  d.clickText("p", "Renovar licencia")
  await wait(80)
  check(
    "C3 · el detalle trae la tarjeta Calendario con los tres",
    !!d.doc.querySelector('#root [aria-label="Añadir a Google Calendar"]') &&
      !!d.doc.querySelector('#root [aria-label="Añadir a Apple Calendar"]') &&
      !!d.doc.querySelector('#root [aria-label="Añadir a Outlook"]') &&
      d.txt().includes("Aún no está en tu calendario"),
    JSON.stringify(d.txt().slice(-300)),
  )
  d.pressText("button", "Apple .ics")
  await wait(80)
  const icsDetalle = await d.download(0)
  check(
    "C3 · desde el detalle, Apple se marca y se descarga su .ics",
    !!d.events()[0]?.appleAddedAt &&
      icsDetalle.includes("SUMMARY:Renovar licencia"),
    JSON.stringify({
      apple: !!d.events()[0]?.appleAddedAt,
      descargas: d.downloads.length,
    }),
  )
  check(
    "C3 · y el detalle lo muestra como añadido",
    d.txt().includes("✓ Añadido") && d.txt().includes("Añadido el "),
    JSON.stringify(d.txt().slice(-200)),
  )
  check(
    "C3 · y Outlook sigue sin marcar",
    !d.events()[0]?.outlookAddedAt && !d.events()[0]?.gcalAddedAt,
  )
  check(
    "C3 · sin errores de ejecución",
    d.errors.length === 0,
    d.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- A) sincronizar todo desde Ajustes
{
  const eventos = [
    evento("a1", "yo", "Cambio de aceite"),
    evento("a2", "yo", "Renovar licencia"),
    evento("b1", "abuela", "Comprar pan"),
  ]
  const m = mount({
    ...seedBase({
      "avispate.profiles.v1": JSON.stringify([YO, ABUELA]),
      "avispate.events.v1": JSON.stringify(eventos),
    }),
  })
  await wait(150)
  await m.irAjustes()
  // Los tres calendarios viven en un desplegable: arranca cerrado, baja al presionar la burbuja y los
  // tres quedan DENTRO de la misma burbuja blanca (cada uno en su sección data-calendar, separados por
  // una línea: ya no son tres burbujas blancas sueltas).
  const abreCal = () => m.byLabel("Calendarios de Yo")
  const calCard = (app) => m.doc.querySelector(`#root [data-calendar="${app}"]`)
  check(
    "A0 · el desplegable arranca cerrado, con los tres logos en su burbuja",
    !!abreCal() &&
      abreCal().getAttribute("aria-expanded") === "false" &&
      !!abreCal().querySelector('svg path[fill="#4285F4"]') &&
      !!abreCal().querySelector('svg path[fill="#1D1D1F"]') &&
      !!abreCal().querySelector('svg path[fill="#0F6CBD"]') &&
      m.txt().includes("Calendarios de Yo"),
    abreCal()?.textContent,
  )
  check(
    "A0 · y su flecha hacia abajo invita a bajarlo",
    !!abreCal().querySelector('svg path[d="M1 1l4 4 4-4"]') &&
      !calCard("apple") &&
      !calCard("google"),
  )
  m.press(abreCal())
  await wait(80)
  check(
    "A0 · al presionarlo baja el contenido y la flecha gira",
    abreCal().getAttribute("aria-expanded") === "true" &&
      !!abreCal().querySelector('[class*="rotate-180"]') &&
      !!calCard("apple") &&
      !!calCard("google") &&
      !!calCard("outlook"),
  )
  check(
    "A0 · los tres calendarios van dentro de la misma burbuja que el encabezado, separados por líneas",
    calCard("google")?.parentElement === calCard("apple")?.parentElement &&
      calCard("apple")?.parentElement === calCard("outlook")?.parentElement &&
      (calCard("apple")?.className || "").includes("border-t") &&
      (calCard("outlook")?.className || "").includes("border-t") &&
      // La burbuja blanca (rounded-3xl + overflow-hidden) es su ancestro y ahora también contiene al
      // encabezado: el desplegable y los tres calendarios son una sola burbuja.
      (() => {
        const burbuja = calCard("google")?.closest('div[class*="rounded-3xl"]')
        return (
          !!burbuja &&
          (burbuja.className || "").includes("overflow-hidden") &&
          burbuja.contains(abreCal()) &&
          !(burbuja.className || "").includes("p-5")
        )
      })(),
    calCard("google")?.closest('div[class*="rounded-3xl"]')?.className,
  )
  check(
    "A0 · y trae su flecha al fondo de la burbuja para cerrarla, como la del onboarding",
    !!m.byLabel("Cerrar los calendarios de Yo"),
  )
  m.press(m.byLabel("Cerrar los calendarios de Yo"))
  await wait(60)
  check(
    "A0 · esa flecha cierra los calendarios y deja la burbuja como estaba",
    abreCal().getAttribute("aria-expanded") === "false" &&
      !calCard("google") &&
      !m.byLabel("Cerrar los calendarios de Yo"),
  )
  m.press(abreCal())
  await wait(60)
  check(
    "A1 · Ajustes trae las tarjetas de Apple Calendar y Outlook",
    !!m.find("#root button", "Conectar con Apple Calendar") &&
      !!m.find("#root button", "Conectar con Outlook") &&
      !!calCard("apple") &&
      !!calCard("outlook"),
  )
  check(
    "A1 · las dos arrancan sin conectar y sin «Todos los avisos»",
    (calCard("apple")?.textContent || "").includes("Sin conectar") &&
      (calCard("outlook")?.textContent || "").includes("Sin conectar") &&
      !m.doc.querySelector(
        '#root [aria-label="Sincronizar todos los avisos con Apple Calendar"]',
      ),
  )
  check(
    "A1 · cada calendario dice cuántos recordatorios hay para sincronizar",
    (calCard("apple")?.textContent || "").includes(
      "2 recordatorios de Yo: «Sincronizar ahora» baja un solo archivo con todos.",
    ),
    JSON.stringify((calCard("apple")?.textContent || "").slice(-180)),
  )
  check(
    "A1 · y explica cómo funciona, sin prometer una cuenta conectada",
    (calCard("apple")?.textContent || "").includes(
      "Sin cuenta que conectar en el navegador",
    ) &&
      (calCard("outlook")?.textContent || "").includes(
        "Sin cuenta que conectar en el navegador",
      ),
  )

  m.pressText("button", "Conectar con Apple Calendar")
  await wait(1400)
  const yo = () => m.profileOf("yo")
  check(
    "A1 · conectar Apple Calendar lo guarda en ese usuario",
    yo()?.apple?.connected === true && yo()?.apple?.syncAll === true,
    JSON.stringify(yo()?.apple),
  )
  check(
    "A1 · aparece su «Todos los avisos», encendido",
    m.doc
      .querySelector(
        '#root [aria-label="Sincronizar todos los avisos con Apple Calendar"]',
      )
      ?.getAttribute("aria-pressed") === "true" &&
      (calCard("apple")?.textContent || "").includes("✓ Conectado"),
  )
  check(
    "A1 · y la sección avisa del cambio",
    (calCard("apple")?.textContent || "").includes(
      "Apple Calendar queda listo",
    ),
  )

  m.pressText("button", "Sincronizar ahora")
  await wait(1700)
  check(
    "A1 · sincronizar guarda la fecha y cuántos fueron",
    !!yo()?.apple?.lastSync && yo()?.apple?.lastCount === 2,
    JSON.stringify(yo()?.apple),
  )
  const todos = await m.download(0)
  check(
    "A1 · el archivo lleva solo los recordatorios de ese usuario",
    (todos.match(/BEGIN:VEVENT/g) || []).length === 2 &&
      todos.includes("SUMMARY:Cambio de aceite") &&
      !todos.includes("Comprar pan"),
    `${(todos.match(/BEGIN:VEVENT/g) || []).length} eventos`,
  )
  check(
    "A1 · y la sección lo cuenta",
    (calCard("apple")?.textContent || "").includes(
      "2 recordatorios listos para Apple Calendar",
    ),
  )

  m.press(
    m.doc.querySelector(
      '#root [aria-label="Sincronizar todos los avisos con Apple Calendar"]',
    ),
  )
  await wait(60)
  check(
    "A1 · apagar «Todos los avisos» queda en ese usuario",
    yo()?.apple?.syncAll === false &&
      (calCard("apple")?.textContent || "").includes(
        "se crean sin Apple Calendar",
      ),
  )
  m.pressText("button", "Desconectar")
  await wait(60)
  check(
    "A1 · desconectar apaga la conexión de ese calendario",
    yo()?.apple?.connected === false &&
      !m.doc.querySelector(
        '#root [aria-label="Sincronizar todos los avisos con Apple Calendar"]',
      ),
  )
  check(
    "A1 · y Outlook sigue intacto",
    yo()?.outlook === undefined &&
      (calCard("outlook")?.textContent || "").includes("Sin conectar"),
  )

  // Otro usuario del dispositivo: sus calendarios son los suyos.
  m.pressText("button", "Abuela")
  await wait(80)
  check(
    "A2 · en Abuela las dos secciones arrancan sin conectar",
    (calCard("apple")?.textContent || "").includes("Sin conectar") &&
      (calCard("outlook")?.textContent || "").includes("Sin conectar"),
  )
  check(
    "A2 · y no hay «Todos los avisos» que mostrar",
    !m.doc.querySelector(
      '#root [aria-label="Sincronizar todos los avisos con Apple Calendar"]',
    ) &&
      !m.doc.querySelector(
        '#root [aria-label="Sincronizar todos los avisos con Outlook"]',
      ),
  )
  check(
    "A2 · su sección cuenta SUS recordatorios",
    (calCard("outlook")?.textContent || "").includes(
      "1 recordatorio de Abuela",
    ),
    JSON.stringify((calCard("outlook")?.textContent || "").slice(-150)),
  )
  check(
    "A2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- O) el slide 2 ilustra Apple y Outlook
{
  const m = mount()
  await wait(150)
  m.tap()
  await wait(60) // abre el pitch de la abeja
  m.tap()
  await wait(80) // slide 2: recibe recordatorios
  check(
    "O1 · el slide 2 sigue siendo el paso 2/7",
    m.stepAt() === 1 && m.txt().includes("Recibe recordatorios"),
    `${m.stepAt()} · ${m.txt().slice(0, 100)}`,
  )
  check(
    "O1 · el remate nombra los tres calendarios",
    m.txt().includes("También en Google Calendar, Apple Calendar y Outlook"),
    JSON.stringify(m.txt().slice(-160)),
  )
  const escena = [...m.doc.querySelectorAll("#root div")]
    .filter(
      (el) =>
        (el.className || "").includes("items-center") &&
        (el.textContent || "").includes("Cambio de aceite"),
    )
    .pop()
  check(
    "O1 · la escena muestra los tres calendarios con su nombre",
    !!escena &&
      (escena.textContent || "").includes("Google") &&
      (escena.textContent || "").includes("Apple") &&
      (escena.textContent || "").includes("Outlook"),
    JSON.stringify(escena?.textContent),
  )
  check(
    "O1 · y los tres logos reales, uno por calendario",
    !!escena?.querySelector('svg path[fill="#4285F4"]') &&
      !!escena.querySelector('svg path[fill="#1D1D1F"]') &&
      !!escena.querySelector('svg path[fill="#0F6CBD"]'),
  )
  check(
    "O1 · cada calendario recibe su visto bueno",
    escena?.querySelectorAll("span.rounded-full").length === 3,
    String(escena?.querySelectorAll("span.rounded-full").length),
  )
  // Del recordatorio bajan TRES líneas punteadas, una hacia cada calendario (la fila de abajo mide
  // 234 px: los centros de las tarjetas caen en 37, 117 y 197), y la línea única de antes ya no está.
  const trazos = [...(escena?.querySelectorAll("svg path") || [])].map(
    (p) => p.getAttribute("d") || "",
  )
  check(
    "O1 · del recordatorio bajan tres líneas, una por calendario",
    trazos.filter((d) => d.startsWith("M117 6L")).length === 3 &&
      trazos.includes("M117 0V6"),
    JSON.stringify(trazos),
  )
  check(
    "O1 · y cada línea termina en el centro de su calendario",
    ["M117 6L37 23", "M117 6L117 23", "M117 6L197 23"].every((d) =>
      trazos.includes(d),
    ),
    JSON.stringify(trazos),
  )
  check(
    "O1 · ya no queda la línea única de antes",
    !escena?.querySelector("svg line"),
  )
  check(
    "O1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------- G) el emoji de mensaje ya no existe y los tres calendarios por usuario
{
  const m = mount(
    seedBase({
      "avispate.profiles.v1": JSON.stringify([YO, ABUELA]),
      "avispate.events.v1": JSON.stringify([
        evento("g1", "yo", "Cambio de aceite"),
      ]),
    }),
  )
  await wait(150)

  // a) El emoji de burbuja ya no está en ninguna parte de la app.
  check(
    "G1 · la app no dibuja el emoji de mensaje en ningún lado",
    !m.html().includes("💬") && !bundle.includes("💬"),
  )

  // b) Ajustes: la tarjeta de Mi perfil ya no repite los canales —solo el ícono, el nombre y «Editar»—;
  //    el WhatsApp con su logo real vive en su fila de canales y en las insignias de la lista de usuarios.
  await m.irAjustes()
  const perfilCard = () =>
    [...m.doc.querySelectorAll("#root p")].find((p) =>
      (p.textContent || "").startsWith("Mi perfil ·"),
    )?.parentElement
  check(
    "G2 · la tarjeta de Mi perfil ya no lista canales ni calendarios",
    !!perfilCard() &&
      (perfilCard().textContent || "").includes("Mi perfil · Yo") &&
      !/Notificaciones|WhatsApp|Correo|Calendar|Outlook/.test(
        perfilCard().textContent || "",
      ) &&
      !perfilCard().querySelector("svg"),
    perfilCard()?.textContent,
  )
  const filaWA = () =>
    m.byLabel("Canal WhatsApp de este usuario")?.parentElement
  check(
    "G2 · y la fila de canales de WhatsApp también",
    !!filaWA()?.querySelector('svg path[fill="#25D366"]') &&
      (filaWA()?.textContent || "").includes("WhatsApp"),
    filaWA()?.textContent,
  )

  // c) Cada fila de usuario lleva las insignias de los tres calendarios, con su logo y su estado.
  const insig = (label) => m.doc.querySelector(`#root [aria-label="${label}"]`)
  check(
    "G3 · cada usuario lleva las insignias de Google, Apple y Outlook",
    !!insig("Google Calendar sin conectar (Yo)") &&
      !!insig("Apple Calendar sin conectar (Yo)") &&
      !!insig("Outlook sin conectar (Yo)") &&
      !!insig("Apple Calendar sin conectar (Abuela)") &&
      !!insig("Outlook sin conectar (Abuela)"),
  )
  check(
    "G3 · con su logo real y apagadas mientras no estén conectadas",
    !!insig("Apple Calendar sin conectar (Yo)")?.querySelector(
      'svg path[fill="#1D1D1F"]',
    ) &&
      !!insig("Outlook sin conectar (Yo)")?.querySelector(
        'svg path[fill="#0F6CBD"]',
      ) &&
      (insig("Apple Calendar sin conectar (Yo)")?.className || "").includes(
        "grayscale",
      ),
  )

  // d) El desplegable: al conectar Apple, la insignia de esa fila se enciende y el resumen lo dice.
  m.press(m.byLabel("Calendarios de Yo"))
  await wait(80)
  m.pressText("button", "Conectar con Apple Calendar")
  // El guardado del calendario tarda un momento: se espera a que la fila del usuario lo refleje.
  for (
    let i = 0;
    i < 40 && !insig("Apple Calendar conectado (Yo) · Todos los avisos");
    i++
  )
    await wait(100)
  check(
    "G3 · conectar Apple enciende su insignia en la fila del usuario",
    !insig("Apple Calendar sin conectar (Yo)") &&
      !!insig("Apple Calendar conectado (Yo) · Todos los avisos"),
  )
  m.press(m.byLabel("Calendarios de Yo"))
  await wait(80)
  check(
    "G3 · y el desplegable cerrado resume qué calendario está conectado",
    (m.byLabel("Calendarios de Yo")?.textContent || "").includes(
      "Conectados: Apple Calendar",
    ),
    m.byLabel("Calendarios de Yo")?.textContent,
  )
  check(
    "G3 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )

  // e) Crear: el chip del canal y el aviso de canal sin configurar lo nombran con su logo real.
  const m2 = mount(
    seedBase({ "avispate.profiles.v1": JSON.stringify([YO, ABUELA]) }),
  )
  await wait(150)
  await m2.crearNuevo()
  const chipWA = () =>
    [...m2.doc.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "WhatsApp",
    )
  check(
    "G4 · el chip del canal WhatsApp trae el logo real",
    !!chipWA()?.querySelector('svg path[fill="#25D366"]') &&
      !(chipWA()?.textContent || "").includes("💬"),
    chipWA()?.outerHTML.slice(0, 130),
  )
  m2.pressText("button", "WhatsApp")
  await wait(40) // se enciende ese canal
  m2.pressText("button", "Abuela")
  await wait(40) // el recordatorio pasa a ser de Abuela
  const falta = () =>
    [...m2.doc.querySelectorAll("#root p")].find((p) =>
      (p.textContent || "").includes("todavía no tiene configurado"),
    )
  check(
    "G4 · y el aviso de canal sin configurar lo nombra con su logo",
    !!falta() &&
      !!falta().querySelector('svg path[fill="#25D366"]') &&
      (falta().textContent || "").includes("WhatsApp"),
    falta()?.textContent,
  )

  // f) El detalle del recordatorio: los canales también con el logo en vez del emoji.
  const d = mount(
    seedBase({
      "avispate.events.v1": JSON.stringify([
        {
          ...evento("g2", "yo", "Renovar licencia"),
          channels: ["Notificación", "WhatsApp", "Correo"],
        },
      ]),
    }),
  )
  await wait(150)
  d.clickText("p", "Renovar licencia")
  await wait(80)
  const canales = () =>
    [...d.doc.querySelectorAll("#root div")].find(
      (el) => (el.querySelector("p")?.textContent || "") === "Canales",
    )
  check(
    "G5 · el detalle muestra el canal de WhatsApp con su logo real",
    !!canales()?.querySelector('svg path[fill="#25D366"]') &&
      (canales()?.textContent || "").includes("WhatsApp") &&
      !(canales()?.textContent || "").includes("💬"),
    canales()?.textContent,
  )
  check(
    "G5 · sin errores de ejecución",
    d.errors.length === 0,
    d.errors.join(" | ").slice(0, 200),
  )
}

// ---------------------------------------------------------------- D) estáticos del bundle
check(
  "D · el bundle trae los logos y los textos nuevos",
  bundle.includes("#1D1D1F") &&
    bundle.includes("#0F6CBD") &&
    bundle.includes("outlook.live.com/calendar/0/deeplink/compose") &&
    bundle.includes("También en Google Calendar, Apple Calendar y Outlook") &&
    bundle.includes("showOpenFilePicker"),
)
check(
  "D · el bundle ya no trae los textos que se fueron",
  !bundle.includes("También en tu Google Calendar") &&
    !bundle.includes("Descargar archivo .ics") &&
    !bundle.includes("no irá a tu calendario."),
)
check("D · la entrega en curso es la Etapa 11", bundle.includes("Etapa 11"))

process.exit(finish() ? 1 : 0)
