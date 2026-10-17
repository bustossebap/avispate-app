// E2E de la Etapa 4: hora de los avisos que no se mueve al elegir a.m./p.m., insignia de Google
// Calendar por usuario en «Usuarios de este dispositivo», Nuevo recordatorio sin teclado automático,
// abeja en la opción «Personalizada», tarjeta de permiso de notificaciones explicada (y pedida en el
// momento de guardar), aviso de inactividad «Bzzt…» y versión visible en un solo lugar.
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const tomorrow = dayKey(new Date(Date.now() + 86400000))
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString()
const evento = (id, name, time) => ({
  id,
  ownerId: "yo",
  name,
  date: tomorrow,
  time,
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
// Ayudas propias de esta suite (el control de hora de Ajustes, las insignias de Google y el
// historial): se cuelgan de cada sesión al montarla, así el cuerpo de las comprobaciones sigue igual.
const ampliar = (sesion) =>
  Object.assign(sesion, {
    clockGroup: () =>
      sesion.doc.querySelector('[aria-label="Formato de hora"]'),
    gcalBadges: () => [
      ...sesion.doc.querySelectorAll('#root [aria-label^="Google Calendar"]'),
    ],
    abrirHistorial: async () => {
      sesion.click(
        sesion.doc.querySelector('[aria-label="Historial de avisos enviados"]'),
      )
      await wait(60)
    },
  })
const mount = (seed, notif = {}) =>
  ampliar(montar(bundle, seed, { notificaciones: notif }))

const { check, finish } = reporter()
const seedBase = (extra) => ({
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([YO]),
  "avispate.activeProfile.v1": "yo",
  "avispate.reloj.v1": "24",
  ...extra,
})

const LOGO_G = 'svg path[fill="#4285F4"]'
// Para comparar dos estados del control de hora ignorando lo que sí cambia a propósito: qué botón está
// elegido (aria-pressed) y su color. Si el resto del HTML es idéntico, nada se movió de lugar.
const plano = (el) =>
  el
    ? el.outerHTML
        .replace(/ aria-pressed="[^"]*"/g, "")
        .replace(
          /(bg-amber-600|text-white|bg-white|dark:bg-stone-900|text-stone-500|dark:text-stone-300)\s?/g,
          "",
        )
    : ""

// ------------------------------------------- H1) la hora de los avisos ya no se mueve
{
  const m = mount(
    seedBase({
      "avispate.events.v1": JSON.stringify([
        evento("e1", "Renovar licencia", "14:30"),
      ]),
    }),
  )
  await wait(150)
  await m.irAjustes()
  const group = m.clockGroup()
  check(
    "H1 · Ajustes › Apariencia trae «Hora de los avisos» y su control",
    m.txt().includes("Hora de los avisos") && !!group,
    JSON.stringify(m.txt().slice(0, 200)),
  )
  check(
    "H1 · el control son dos botones mitad y mitad, cada uno con su ejemplo",
    group?.children.length === 2 &&
      [...group.children].every((c) => c.tagName === "BUTTON") &&
      group.textContent.includes("24 h") &&
      group.textContent.includes("22:30") &&
      group.textContent.includes("a.m./p.m.") &&
      group.textContent.includes("10:30 p.m."),
    JSON.stringify(group?.textContent),
  )
  check(
    "H1 · ya no existe la ayuda que cambiaba de largo («Se muestra como…»)",
    !m.txt().includes("Se muestra como"),
    JSON.stringify(m.txt().slice(0, 240)),
  )
  check(
    "H1 · arranca en 24 h según lo guardado",
    group?.querySelectorAll("button")[0].getAttribute("aria-pressed") ===
      "true" &&
      group.querySelectorAll("button")[1].getAttribute("aria-pressed") ===
        "false",
  )

  // Lo que se compara es la fila entera (título + control): si algo se moviera de tamaño, aquí se ve.
  const antes = plano(group.parentElement)
  m.clickText("button", "a.m./p.m.")
  await wait(60)
  const despues = m.clockGroup()
  check(
    "H1 · elegir a.m./p.m. se guarda en el dispositivo",
    m.raw("avispate.reloj.v1") === "12",
    String(m.raw("avispate.reloj.v1")),
  )
  check(
    "H1 · el control no se mueve: misma fila, mismos botones y mismos textos",
    plano(despues?.parentElement) === antes,
    `${antes.slice(0, 120)} | ${plano(despues?.parentElement).slice(0, 120)}`,
  )
  check(
    "H1 · y ahora el elegido es a.m./p.m.",
    despues?.querySelectorAll("button")[1].getAttribute("aria-pressed") ===
      "true" &&
      despues.querySelectorAll("button")[0].getAttribute("aria-pressed") ===
        "false",
  )

  const antesDeVolver = plano(despues?.parentElement)
  m.clickText("button", "24 h")
  await wait(60)
  check(
    "H1 · volver a 24 h tampoco mueve nada",
    m.raw("avispate.reloj.v1") === "24" &&
      plano(m.clockGroup()?.parentElement) === antesDeVolver,
    String(m.raw("avispate.reloj.v1")),
  )
  m.clickText("button", "Inicio")
  await wait(80)
  check(
    "H1 · el formato elegido sigue mandando en las tarjetas",
    m.txt().includes("· 14:30") && !m.txt().includes("2:30 p.m."),
    JSON.stringify(m.txt().slice(-160)),
  )
  check(
    "H1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- G1) insignia de Google Calendar por usuario
{
  const perfiles = [
    {
      id: "yo",
      name: "Yo",
      emoji: "🙂",
      contact: {
        phone: "+56 9 1111 1111",
        email: "yo@correo.cl",
        accepted: true,
      },
      channels: { push: true, whatsapp: true, email: true },
      gcal: {
        connected: true,
        syncAll: true,
        lastSync: new Date().toISOString(),
        lastCount: 2,
      },
    },
    {
      id: "empresa",
      name: "Empresa",
      emoji: "💼",
      contact: { phone: "", email: "" },
      channels: { push: true, whatsapp: true, email: false },
      gcal: { connected: true, syncAll: false },
    },
    {
      id: "abuela",
      name: "Abuela",
      emoji: "👵",
      contact: { phone: "", email: "" },
      channels: { push: true, whatsapp: true, email: false },
    },
  ]
  const m = mount(
    seedBase({ "avispate.profiles.v1": JSON.stringify(perfiles) }),
  )
  await wait(150)
  await m.irAjustes()
  const badges = m.gcalBadges()
  check(
    "G1 · cada usuario de este dispositivo trae su insignia de Google",
    badges.length === 3,
    String(badges.length),
  )
  const de = (nombre) =>
    badges.find((b) => (b.getAttribute("title") || "").includes(`(${nombre})`))
  check(
    "G1 · la insignia dice de quién es y si está conectada",
    (de("Yo")?.getAttribute("title") || "").startsWith(
      "Google Calendar conectado (Yo)",
    ) &&
      (de("Abuela")?.getAttribute("title") || "").startsWith(
        "Google Calendar sin conectar (Abuela)",
      ),
    badges.map((b) => b.getAttribute("title")).join(" | "),
  )
  check(
    "G1 · y si «Todos los avisos» está encendido",
    (de("Yo")?.getAttribute("title") || "").includes("Todos los avisos") &&
      (de("Empresa")?.getAttribute("title") || "").includes(
        "Solo los que eliges",
      ),
    badges.map((b) => b.getAttribute("title")).join(" | "),
  )
  check(
    "G1 · conectado se ve encendido y con el logo real de Google",
    !!de("Yo")?.querySelector(LOGO_G) &&
      !de("Yo").className.includes("grayscale") &&
      !de("Yo").className.includes("opacity-40"),
  )
  check(
    "G1 · sin conectar se ve apagado (en gris)",
    de("Abuela")?.className.includes("grayscale") &&
      de("Abuela").className.includes("opacity-40") &&
      !!de("Abuela").querySelector(LOGO_G),
  )
  check(
    "G1 · la insignia de Google va junto a la campana, WhatsApp, correo y los otros dos calendarios, todo en una línea",
    de("Yo")?.parentElement?.children.length === 6 &&
      !!de("Yo").parentElement.querySelector("svg") &&
      de("Yo").parentElement.textContent.includes("🔔") &&
      (de("Yo").parentElement.className || "").includes("flex-nowrap") &&
      !(de("Yo").parentElement.className || "").includes("flex-wrap"),
    `${de("Yo")?.parentElement?.children.length} · ${de("Yo")?.parentElement?.className}`,
  )
  // Las insignias nuevas: cada usuario del dispositivo lleva también Apple Calendar y Outlook, con su
  // logo real y apagadas mientras ese usuario no las tenga conectadas.
  const insig = (label) => m.doc.querySelector(`#root [aria-label="${label}"]`)
  check(
    "G2 · cada usuario lleva también su insignia de Apple Calendar y la de Outlook",
    !!insig("Apple Calendar sin conectar (Yo)") &&
      !!insig("Outlook sin conectar (Yo)") &&
      !!insig("Apple Calendar sin conectar (Abuela)") &&
      !!insig("Outlook sin conectar (Empresa)"),
  )
  check(
    "G2 · cada una con su logo real",
    !!insig("Apple Calendar sin conectar (Yo)")?.querySelector(
      'svg path[fill="#1D1D1F"]',
    ) &&
      !!insig("Outlook sin conectar (Yo)")?.querySelector(
        'svg path[fill="#0F6CBD"]',
      ),
  )
  check(
    "G2 · y apagadas mientras ese usuario no las tenga conectadas",
    (insig("Apple Calendar sin conectar (Yo)")?.className || "").includes(
      "grayscale",
    ) &&
      (insig("Outlook sin conectar (Yo)")?.className || "").includes(
        "opacity-40",
      ),
  )
  check(
    "G1 · y trae su equivalente para lectores de pantalla",
    (de("Empresa")?.getAttribute("aria-label") || "").includes(
      "Google Calendar conectado (Empresa)",
    ) &&
      (de("Abuela")?.getAttribute("aria-label") || "").includes("sin conectar"),
    `${de("Empresa")?.getAttribute("aria-label")} | ${de("Abuela")?.getAttribute("aria-label")}`,
  )
  check(
    "G1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- N1) nuevo recordatorio sin teclado automático
{
  const m = mount(seedBase())
  await wait(150)
  await m.crearNuevo()
  const nombre = m.nombreInput()
  check(
    "N1 · al abrir Nuevo recordatorio el campo del nombre no se enfoca solo",
    !!nombre && m.doc.activeElement !== nombre,
    `foco en ${m.doc.activeElement?.tagName}.${m.doc.activeElement?.getAttribute("placeholder") || ""}`,
  )
  check(
    "N1 · y el campo no lleva autoFocus (el teclado del teléfono no se abre solo)",
    !nombre?.hasAttribute("autofocus") &&
      !nombre?.outerHTML.toLowerCase().includes("autofocus"),
    String(nombre?.outerHTML.slice(0, 90)),
  )
  check(
    "N1 · tampoco hay otro campo enfocado dentro del formulario",
    m.doc.activeElement?.tagName !== "INPUT" &&
      m.doc.activeElement?.tagName !== "TEXTAREA" &&
      m.doc.activeElement?.tagName !== "SELECT",
    String(m.doc.activeElement?.tagName),
  )
  m.type(nombre, "Comprar pan")
  await wait(30)
  check(
    "N1 · el campo se puede escribir igual",
    nombre.value === "Comprar pan",
    nombre.value,
  )

  // El otro campo que se enfocaba solo: el nombre al abrir «＋ Nuevo usuario» en Inicio.
  m.clickText("button", "←")
  await wait(60)
  m.click(m.doc.querySelector('[aria-label="Cambiar usuario"]'))
  await wait(60)
  m.clickText("button", "＋ Nuevo usuario")
  await wait(60)
  const nuevoUsuario = m.doc.querySelector(
    'input[placeholder="Nombre (ej. Abuela)"]',
  )
  check(
    "N1 · «＋ Nuevo usuario» tampoco abre el teclado solo",
    !!nuevoUsuario &&
      m.doc.activeElement !== nuevoUsuario &&
      !nuevoUsuario.hasAttribute("autofocus"),
    `foco en ${m.doc.activeElement?.tagName}`,
  )
  check(
    "N1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- P1) «🐝 Personalizada» en ¿Se repite?
{
  const m = mount(seedBase())
  await wait(150)
  await m.crearNuevo()
  const botones = [...m.doc.querySelectorAll("#root button")]
  const personalizada = botones.find(
    (b) => (b.textContent || "").trim() === "🐝 Personalizada",
  )
  check(
    "P1 · la opción Personalizada lleva la abeja",
    !!personalizada,
    botones
      .map((b) => (b.textContent || "").trim())
      .filter((t) => t.includes("Personalizada"))
      .join(" | "),
  )
  check(
    "P1 · y las demás opciones de ¿Se repite? siguen igual",
    !!botones.find((b) => (b.textContent || "").trim() === "No se repite") &&
      !!botones.find((b) => (b.textContent || "").trim() === "Cada 8 horas"),
  )
  check(
    "P1 · el emoji está solo en Personalizada",
    !botones.find((b) => (b.textContent || "").trim() === "🐝 Cada semana"),
  )

  if (personalizada) {
    m.click(personalizada)
    await wait(60)
  }
  check(
    "P1 · al elegirla aparece el bloque Repetir cada",
    m.txt().includes("Repetir cada"),
  )
  const intervalo = m.doc.querySelector('#root input[type="number"]')
  const unidad = [...m.doc.querySelectorAll("#root select")].find((s) =>
    [...s.options].some((o) => o.value === "años"),
  )
  check(
    "P1 · con su intervalo y su unidad",
    !!intervalo && !!unidad,
    String(intervalo?.outerHTML.slice(0, 80)),
  )
  if (intervalo && unidad) {
    m.type(intervalo, "3")
    await wait(30)
    m.pick(unidad, "días")
    await wait(40)
  }
  check(
    "P1 · y el resumen ya dice Cada 3 días",
    m.txt().includes("Cada 3 días"),
    JSON.stringify(m.txt().slice(-200)),
  )
  m.type(m.nombreInput(), "Cambiar el filtro")
  await wait(30)
  m.clickText("button", "Guardar recordatorio")
  await wait(80)
  const guardado = m.events().find((e) => e.name === "Cambiar el filtro")
  check(
    "P1 · se guarda la repetición personalizada como antes",
    guardado?.recurrence === "Personalizada" &&
      guardado?.recurrenceInterval === 3 &&
      guardado?.recurrenceUnit === "días",
    JSON.stringify(guardado),
  )
  check(
    "P1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )

  // ------------------------------------------- S1) permiso de notificaciones: explicado y pedido a tiempo
  {
    // a) permiso sin conceder: se explica por qué no puede venir activado y se ofrece el botón.
    const m = mount(seedBase(), { permission: "default" })
    await wait(150)
    await m.irAjustes()
    check(
      "S1 · la tarjeta dice que aún no está concedido",
      m.txt().includes("Permiso de notificaciones") &&
        m.txt().includes("Aún no concedido"),
      JSON.stringify(m.txt().slice(0, 200)),
    )
    check(
      "S1 · y explica que el navegador solo lo concede con un toque",
      m.txt().includes("no puede venir activado por defecto") &&
        m.txt().includes("te lo pedimos en ese momento"),
      JSON.stringify(m.txt().slice(0, 400)),
    )
    check(
      "S1 · con el permiso pendiente aparece el botón Activar",
      !!m.find("#root button", "Activar"),
    )
    m.clickText("button", "Activar")
    await wait(60)
    check(
      "S1 · Activar pide el permiso y la tarjeta pasa a Activado",
      m.asks() === 1 &&
        m.txt().includes("Activado") &&
        !m.find("#root button", "Activar"),
      `pedidos=${m.asks()}`,
    )
    check(
      "S1 · y ya no habla de bloqueo ni de pendiente",
      !m.txt().includes("Aún no concedido") &&
        !m.txt().includes("Bloqueado en el navegador"),
    )

    // b) permiso bloqueado: se explica cómo desbloquearlo y no se ofrece un botón que no sirve.
    const b = mount(seedBase(), { permission: "denied" })
    await wait(150)
    await b.irAjustes()
    check(
      "S1 · bloqueado lo dice y manda al candado del navegador",
      b.txt().includes("Bloqueado en el navegador") &&
        b.txt().includes("candado 🔒"),
      JSON.stringify(b.txt().slice(0, 260)),
    )
    check(
      "S1 · y no promete un botón Activar que el navegador ya no muestra",
      !b.find("#root button", "Activar"),
    )

    // c) guardar un recordatorio con aviso por notificación es cuando se pide el permiso.
    const c = mount(seedBase(), { permission: "default" })
    await wait(150)
    await c.crearNuevo()
    c.type(c.nombreInput(), "Pagar el gas")
    await wait(30)
    check(
      "S1 · el formulario arranca con el canal Notificación",
      c.txt().includes("Notificación"),
    )
    c.clickText("button", "Guardar recordatorio")
    await wait(120)
    check(
      "S1 · al guardar se pide el permiso (mismo gesto del toque)",
      c.asks() === 1,
      `pedidos=${c.asks()}`,
    )
    check(
      "S1 · y el recordatorio se guarda igual",
      !!c.events().find((e) => e.name === "Pagar el gas"),
    )
    await c.irAjustes()
    check(
      "S1 · Ajustes ya lo muestra como Activado",
      c.txt().includes("Activado") && !c.txt().includes("Aún no concedido"),
    )

    // d) si el permiso ya está concedido, guardar no vuelve a preguntar.
    const d = mount(seedBase(), { permission: "granted" })
    await wait(150)
    await d.crearNuevo()
    d.type(d.nombreInput(), "Regar las plantas")
    await wait(30)
    d.clickText("button", "Guardar recordatorio")
    await wait(120)
    check(
      "S1 · con el permiso ya concedido no se vuelve a pedir",
      d.asks() === 0,
      `pedidos=${d.asks()}`,
    )

    // e) sin canal Notificación no hay nada que pedir.

    // ------------------------------------------- I1) aviso de inactividad: «Bzzt… ¡avíspate!»
    // Este bloque es del aviso de inactividad, así que se dejan los recordatorios vacíos: si no, la
    // app carga sus recordatorios de demostración (fechas fijas) y, cuando alguno cae dentro de su
    // plazo de aviso, el motor manda además su notificación y `sent` deja de tener solo el aviso.
    const sinRecordatorios = (extra) =>
      seedBase({ "avispate.events.v1": "[]", ...extra })
    {
      const FRASE = "Bzzt… no te olvides de no olvidarte, ¡avíspate!"
      // a) vuelve después de 8 días: queda el aviso en el historial y sale la notificación del navegador.
      const m = mount(
        sinRecordatorios({ "avispate.ultimaVisita.v1": hace(8) }),
        {
          permission: "granted",
        },
      )
      await wait(150)
      await m.abrirHistorial()
      const t = m.txt()
      check(
        "I1 · al volver después de una semana aparece el aviso",
        t.includes(FRASE),
        JSON.stringify(t.slice(0, 300)),
      )
      check(
        "I1 · con el título del aviso y los días que pasaron",
        t.includes("No te olvides de no olvidarte") &&
          t.includes("8 días sin abrir AVISPATE"),
        JSON.stringify(t.slice(0, 300)),
      )
      check(
        "I1 · y con la abeja de emoji",
        JSON.stringify(
          m.storage("avispate.notifications.v1")?.[0] || {},
        ).includes("🐝"),
        JSON.stringify(m.storage("avispate.notifications.v1")?.slice(0, 1)),
      )
      check(
        "I1 · sale como notificación del navegador cuando el permiso está concedido",
        m.sent.length === 1 &&
          m.sent[0].title.includes("Avíspate") &&
          m.sent[0].body === FRASE,
        JSON.stringify(m.sent),
      )
      check(
        "I1 · la visita queda marcada y el aviso anotado",
        (() => {
          const v = m.raw("avispate.ultimaVisita.v1")
          const a = m.raw("avispate.avisosInactividad.v1")
          return (
            !!v && Math.abs(Date.now() - new Date(v).getTime()) < 60000 && !!a
          )
        })(),
        `${m.raw("avispate.ultimaVisita.v1")} | ${m.raw("avispate.avisosInactividad.v1")}`,
      )
      check(
        "I1 · sin errores de ejecución",
        m.errors.length === 0,
        m.errors.join(" | ").slice(0, 200),
      )

      // b) sin hueco: quien entra todos los días no recibe nada.
      const b = mount(
        sinRecordatorios({ "avispate.ultimaVisita.v1": hace(0.2) }),
        {
          permission: "granted",
        },
      )
      await wait(150)
      await b.abrirHistorial()
      check(
        "I1 · si la última visita fue hace unas horas no hay aviso",
        !b.txt().includes(FRASE) &&
          b.sent.length === 0 &&
          b.raw("avispate.avisosInactividad.v1") === null,
      )

      // c) el mismo aviso no se repite dos veces en la misma semana.
      const nudgePrevio = hace(2)
      const c = mount(
        sinRecordatorios({
          "avispate.ultimaVisita.v1": hace(9),
          "avispate.avisosInactividad.v1": nudgePrevio,
        }),
        { permission: "granted" },
      )
      await wait(150)
      check(
        "I1 · el aviso no se repite dentro de la semana",
        !c.txt().includes(FRASE) &&
          c.sent.length === 0 &&
          c.raw("avispate.avisosInactividad.v1") === nudgePrevio,
        String(c.raw("avispate.avisosInactividad.v1")),
      )

      // d) si el aviso anterior ya quedó viejo (más de una semana), vuelve a salir.
      const d = mount(
        sinRecordatorios({
          "avispate.ultimaVisita.v1": hace(20),
          "avispate.avisosInactividad.v1": hace(10),
        }),
        { permission: "granted" },
      )
      await wait(150)
      await d.abrirHistorial()
      check(
        "I1 · y vuelve a salir si el aviso anterior ya pasó de una semana",
        d.txt().includes(FRASE) && d.sent.length === 1,
        JSON.stringify(d.sent),
      )
      check(
        "I1 · contando los días reales del hueco",
        d.txt().includes("20 días sin abrir AVISPATE"),
        JSON.stringify(d.txt().slice(0, 200)),
      )

      // e) sin onboarding terminado (usuario nuevo) no hay aviso: primero hay que llegar a la app.
      const e = mount(
        { "avispate.ultimaVisita.v1": hace(30), "avispate.events.v1": "[]" },
        {
          permission: "granted",
        },
      )
      await wait(150)
      check(
        "I1 · a quien todavía no termina el onboarding no le llega",
        !e.txt().includes(FRASE) &&
          e.sent.length === 0 &&
          e.raw("avispate.avisosInactividad.v1") === null,
        JSON.stringify(e.txt().slice(0, 120)),
      )

      // f) con el permiso sin conceder el aviso igual queda escrito en el historial de la app.
      const f = mount(
        sinRecordatorios({ "avispate.ultimaVisita.v1": hace(8) }),
        {
          permission: "default",
        },
      )
      await wait(150)
      await f.abrirHistorial()
      check(
        "I1 · sin permiso el aviso queda igual en el historial, sin notificación del navegador",
        f.txt().includes(FRASE) && f.sent.length === 0,
        JSON.stringify(f.sent),
      )
    }

    // ------------------------------------------- V1) la versión se dice en un solo lugar
    {
      const m = mount(seedBase())
      await wait(150)
      await m.irAjustes()
      // La tarjeta de Mi perfil: el nombre, sus canales y su rejilla de emoji, sin la versión repetida.
      const perfilCard = () => {
        const p = [...m.doc.querySelectorAll("#root p")].find((el) =>
          (el.textContent || "").startsWith("Mi perfil ·"),
        )
        return p?.parentElement?.parentElement?.parentElement?.outerHTML || ""
      }
      check(
        "V1 · el pie de Ajustes muestra versión y etapa",
        m.txt().includes("AVISPATE · V1.9 · Etapa 12"),
        JSON.stringify(m.txt().slice(-220)),
      )
      check(
        "V1 · la tarjeta del perfil ya no repite la versión",
        !perfilCard().includes("V1.5") && !perfilCard().includes("Etapa"),
        perfilCard().slice(0, 260),
      )
      // La cara del usuario ya no está siempre a la vista: el nombre y el emoji (o la foto) se cambian con
      // el botón «Editar» de la tarjeta.
      const editar = () =>
        [...m.doc.querySelectorAll("#root button")].find(
          (b) => (b.textContent || "").trim() === "Editar",
        )
      check(
        "V1 · la tarjeta trae su botón «Editar» y ninguna rejilla abierta",
        !!editar() && !m.doc.querySelector('#root [aria-label="Emoji de Yo"]'),
        JSON.stringify(m.txt().slice(-260)),
      )
      m.click(editar())
      await wait(60)
      check(
        "V1 · al presionarlo aparecen el nombre y la rejilla del usuario (con el botón «Otro»)",
        !!m.doc.getElementById("profile-name") &&
          m.doc.querySelectorAll('#root [aria-label="Emoji de Yo"] button')
            .length === 12 &&
          !!m.doc.querySelector(
            '#root [aria-label="Ver todos los emojis para Yo"]',
          ),
      )
      check(
        "V1 · y ya no queda el número suelto de antes",
        !m.html().includes("V1.5 local") &&
          !m.html().includes("AVISPATE · V1.5<"),
      )
      check(
        "V1 · sin errores de ejecución",
        m.errors.length === 0,
        m.errors.join(" | ").slice(0, 200),
      )
    }

    // e) sin canal Notificación no hay nada que pedir.
    const e = mount(
      seedBase({
        "avispate.profiles.v1": JSON.stringify([
          {
            ...YO,
            contact: { phone: "+56 9 2222 2222", email: "", accepted: true },
          },
        ]),
      }),
      { permission: "default" },
    )
    await wait(150)
    await e.crearNuevo()
    e.clickText("button", "Notificación")
    await wait(40) // se apaga el canal
    e.type(e.nombreInput(), "Llamar al doctor")
    await wait(30)
    e.clickText("button", "Guardar recordatorio")
    await wait(120)
    check(
      "S1 · sin el canal Notificación no se pide el permiso",
      e.asks() === 0,
      `pedidos=${e.asks()}`,
    )

    // f) navegador sin soporte de avisos (o sin instalarlos): se dice tal cual y no se promete Activar.
    const f = mount(seedBase(), { supported: false })
    await wait(150)
    await f.irAjustes()
    check(
      "S1 · un navegador sin avisos lo dice y no promete Activar",
      f.txt().includes("Este navegador no lo permite") &&
        !f.find("#root button", "Activar"),
      JSON.stringify(f.txt().slice(0, 220)),
    )
    check(
      "S1 · sin errores de ejecución",
      [m, b, c, d, e, f].every((x) => x.errors.length === 0),
      [m, b, c, d, e, f]
        .map((x) => x.errors.join(","))
        .join(" | ")
        .slice(0, 200),
    )
  }
}

process.exit(finish() ? 1 : 0)
