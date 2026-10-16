// E2E de la Etapa 2 (ajustes de interfaz pedidos): formato de la hora de los avisos (24 h o a.m./p.m.)
// elegido en Ajustes y aplicado al campo propio de hora, a las tarjetas y al detalle; separación y
// anchos de las secciones Archivos y Fecha - Hora al crear un recordatorio; y los textos y los logos
// reales de WhatsApp del onboarding (slide 4, slide 5 y último paso).
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const tomorrow = dayKey(new Date(Date.now() + 86400000))
const YO = {
  id: "yo",
  name: "Yo",
  emoji: "🙂",
  contact: { phone: "", email: "" },
  channels: { push: true, whatsapp: true, email: true },
  gcal: { connected: false },
}
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
// El logo real de WhatsApp (glifo oficial en su verde de marca) tiene que estar siempre inline.
const LOGO_WA = 'svg path[fill="#25D366"]'

// Ayudas propias de esta suite (los tres campos de hora y el botón de volver): se cuelgan de cada
// sesión al montarla, así el cuerpo de las comprobaciones sigue igual (`m.hourSel()`, `m.volver()`).
const ampliar = (sesion) =>
  Object.assign(sesion, {
    hourSel: () => sesion.doc.querySelector('select[aria-label="Hora"]'),
    minSel: () => sesion.doc.querySelector('select[aria-label="Minutos"]'),
    merSel: () => sesion.doc.querySelector('select[aria-label="a.m. o p.m."]'),
    volver: async () => {
      sesion.clickText("button", "←")
      await wait(60)
    },
  })
const mount = (seed) => ampliar(montar(bundle, seed))

const { check, finish } = reporter()
const seedBase = (extra) => ({
  "recuerda.onboarding.v1": "1",
  "recuerda.profiles.v1": JSON.stringify([YO]),
  "recuerda.activeProfile.v1": "yo",
  ...extra,
})

// ------------------------------------------- H1) arranca en 24 h y se cambia a a.m./p.m.
{
  const m = mount(
    seedBase({
      "recuerda.reloj.v1": "24",
      "recuerda.events.v1": JSON.stringify([
        evento("e1", "Renovar licencia", "14:30"),
      ]),
    }),
  )
  await wait(150)
  check(
    "H1 · con 24 h la tarjeta muestra 14:30",
    m.txt().includes("· 14:30"),
    JSON.stringify(m.txt().slice(-160)),
  )

  m.clickText("button", "Ajustes")
  await wait(60)
  const group = m.doc.querySelector('[aria-label="Formato de hora"]')
  check(
    "H1 · Ajustes › Apariencia trae «Hora de los avisos»",
    m.txt().includes("Hora de los avisos") && !!group,
    JSON.stringify(m.txt().slice(0, 200)),
  )
  check(
    "H1 · y arranca en 24 h según lo guardado",
    m
      .find('[aria-label="Formato de hora"] button', "24 h")
      ?.getAttribute("aria-pressed") === "true",
    JSON.stringify(group?.outerHTML.slice(0, 200)),
  )
  // Etapa 4: el control se rediseñó (dos botones mitad y mitad, cada uno con su ejemplo dentro) para
  // que al elegir a.m./p.m. no se mueva nada de lugar.
  check(
    "H1 · los dos botones llevan su ejemplo y no hay texto que cambie de largo",
    group?.querySelectorAll("button").length === 2 &&
      group.textContent.includes("22:30") &&
      group.textContent.includes("10:30 p.m.") &&
      !m.txt().includes("Se muestra como"),
    JSON.stringify(group?.textContent),
  )
  check(
    "H1 · la otra opción queda sin elegir",
    m
      .find('[aria-label="Formato de hora"] button', "a.m./p.m.")
      ?.getAttribute("aria-pressed") === "false",
  )
  const filaAntes = group.parentElement.outerHTML
    .replace(/ aria-pressed="[^"]*"/g, "")
    .replace(
      /(bg-amber-600|text-white|bg-white|dark:bg-stone-900|text-stone-500|dark:text-stone-300)\s?/g,
      "",
    )

  m.clickText("button", "a.m./p.m.")
  await wait(40)
  check(
    "H1 · elegir a.m./p.m. se guarda en el dispositivo",
    m.raw("recuerda.reloj.v1") === "12",
    String(m.raw("recuerda.reloj.v1")),
  )
  const filaDespues = m.doc
    .querySelector('[aria-label="Formato de hora"]')
    .parentElement.outerHTML.replace(/ aria-pressed="[^"]*"/g, "")
    .replace(
      /(bg-amber-600|text-white|bg-white|dark:bg-stone-900|text-stone-500|dark:text-stone-300)\s?/g,
      "",
    )
  check(
    "H1 · y la fila del ajuste queda igual: nada se mueve",
    filaDespues === filaAntes,
    `${filaAntes.slice(0, 110)} | ${filaDespues.slice(0, 110)}`,
  )

  m.clickText("button", "Inicio")
  await wait(60)
  check(
    "H1 · la tarjeta del inicio pasa a 2:30 p.m.",
    m.txt().includes("· 2:30 p.m.") && !m.txt().includes("· 14:30"),
    JSON.stringify(m.txt().slice(-160)),
  )

  m.clickText("button", "Renovar licencia")
  await wait(60)
  check(
    "H1 · el detalle también usa el formato elegido",
    m.txt().includes("· 2:30 p.m."),
    JSON.stringify(m.txt().slice(0, 240)),
  )
  m.clickText("button", "Editar")
  await wait(60)
  check(
    "H1 · el campo de hora es propio: hora, minutos y a.m./p.m.",
    !!m.hourSel() && !!m.minSel() && !!m.merSel(),
  )
  check(
    "H1 · 14:30 se edita como 2 + p.m.",
    m.hourSel().value === "2" &&
      m.merSel().value === "pm" &&
      m.minSel().value === "30",
    `${m.hourSel().value}:${m.minSel().value} ${m.merSel().value}`,
  )
  check(
    "H1 · con 12 h la lista de horas es de 1 a 12",
    m.hourSel().options.length === 12 &&
      m.hourSel().options[0].textContent === "1" &&
      m.hourSel().options[11].textContent === "12",
    String(m.hourSel().options.length),
  )

  m.pick(m.hourSel(), "9")
  m.pick(m.minSel(), "0")
  m.pick(m.merSel(), "am")
  await wait(40)
  m.type(
    m.doc.querySelector(
      'input[placeholder="Ej. Renovar licencia de conducir"]',
    ),
    "Comprar pan",
  )
  await wait(30)
  m.clickText("button", "Guardar recordatorio")
  await wait(80)
  check(
    "H1 · 9 a.m. se guarda como 09:00 (24 h por dentro)",
    m.events().find((e) => e.name === "Comprar pan")?.time === "09:00",
    JSON.stringify(m.events().find((e) => e.name === "Comprar pan")),
  )
  check(
    "H1 · y se muestra 9:00 a.m. en el inicio",
    m.txt().includes("9:00 a.m."),
    JSON.stringify(m.txt().slice(-200)),
  )
  check(
    "H1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- H2) el formato de 24 h en el campo de hora
{
  const m = mount(
    seedBase({
      "recuerda.reloj.v1": "24",
      "recuerda.events.v1": JSON.stringify([
        evento("e1", "Medianoche", "00:30"),
        evento("e2", "Noche", "22:30"),
      ]),
    }),
  )
  await wait(150)
  check(
    "H2 · con 24 h las tarjetas muestran 00:30 y 22:30",
    m.txt().includes("· 00:30") && m.txt().includes("· 22:30"),
    JSON.stringify(m.txt().slice(-200)),
  )

  await m.crearNuevo()
  check(
    "H2 · en 24 h no hay selector a.m./p.m.",
    !m.merSel() && !!m.hourSel() && !!m.minSel(),
  )
  check(
    "H2 · la lista de horas va de 00 a 23",
    m.hourSel().options.length === 24 &&
      m.hourSel().options[0].textContent === "00" &&
      m.hourSel().options[23].textContent === "23",
    String(m.hourSel().options.length),
  )
  check(
    "H2 · los minutos van de 00 a 59",
    m.minSel().options.length === 60 &&
      m.minSel().options[0].textContent === "00" &&
      m.minSel().options[59].textContent === "59",
  )
  check(
    "H2 · arranca al mediodía (12:00)",
    m.hourSel().value === "12" && m.minSel().value === "0",
    `${m.hourSel().value}:${m.minSel().value}`,
  )
  await m.volver()

  m.clickText("button", "Medianoche")
  await wait(60)
  m.clickText("button", "Editar")
  await wait(60)
  check(
    "H2 · 00:30 se edita como 00:30 en 24 h",
    m.hourSel().value === "0" && m.minSel().value === "30",
    `${m.hourSel().value}:${m.minSel().value}`,
  )
  await m.volver()
  await wait(40)

  m.clickText("button", "Noche")
  await wait(60)
  m.clickText("button", "Editar")
  await wait(60)
  check(
    "H2 · 22:30 se edita como 22:30 en 24 h",
    m.hourSel().value === "22" && m.minSel().value === "30",
    `${m.hourSel().value}:${m.minSel().value}`,
  )
  check(
    "H2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- F1) secciones Archivos y Fecha - Hora al crear
{
  const m = mount(seedBase({ "recuerda.reloj.v1": "12" }))
  await wait(150)
  await m.crearNuevo()
  const fecha = m.doc.querySelector('input[type="date"]')
  const cajaFecha = fecha.parentElement,
    cajaHora = m.doc.querySelector(
      '[role="group"][aria-label="Hora"]',
    ).parentElement
  const fila = cajaFecha.parentElement
  check(
    "F1 · Fecha y Hora siguen viviendo en la misma fila",
    fila === cajaHora.parentElement,
    fila?.className,
  )
  check(
    "F1 · la fila lleva más aire respecto de Archivos (mt-8)",
    /(^|\s)mt-8(\s|$)/.test(fila.className),
    fila.className,
  )
  check(
    "F1 · Fecha se acorta (flexible, con mínimo de 136 px)",
    /(^|\s)flex-1(\s|$)/.test(cajaFecha.className) &&
      cajaFecha.className.includes("min-w-[136px]"),
    cajaFecha.className,
  )
  check(
    "F1 · Hora conserva su ancho propio y no se recorta",
    /(^|\s)flex-shrink-0(\s|$)/.test(cajaHora.className),
    cajaHora.className,
  )
  check(
    "F1 · la fila se envuelve en pantallas angostas en vez de cortar el p.m.",
    /(^|\s)flex-wrap(\s|$)/.test(fila.className),
  )
  check(
    "F1 · ya no hay ancho fijo de 120 px ni input nativo de hora",
    !m.html().includes("grid-cols-[1fr_120px]") &&
      !m.doc.querySelector('input[type="time"]'),
  )
  check(
    "F1 · con 12 h la hora se elige con tres listas",
    !!m.hourSel() && !!m.minSel() && !!m.merSel(),
  )
  check(
    "F1 · siguen sus etiquetas Fecha, Hora y la sección Archivos",
    m.txt().includes("Archivos") &&
      m.txt().includes("Fecha") &&
      m.txt().includes("Hora"),
  )
  check(
    "F1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- O1) onboarding: textos nuevos y logos reales
{
  const m = mount()
  await wait(150)
  m.tap()
  await wait(40)
  m.tap()
  await wait(60) // intro + paso 2
  m.tap()
  await wait(60)
  m.tap()
  await wait(60) // paso 3 + paso 4
  const t4 = m.txt()
  check(
    "O1 · slide 4 con la descripción nueva",
    t4.includes(
      "Agrega notas, audio, documentos y fotos para recordar cada detalle. Además puedes ordenar cada recordatorio por categorías.",
    ) &&
      !t4.includes(
        "Puedes agregar notas, audio, documentos y fotos, y ordenar",
      ),
    JSON.stringify(t4.slice(0, 260)),
  )
  check(
    "O1 · slide 4 sigue siendo el paso 4 de 7",
    m.dots()[3]?.getAttribute("aria-current") === "true",
  )

  m.tap()
  await wait(60) // paso 5 (usuarios y canales)
  const t5 = m.txt()
  const parrafo = [...m.doc.querySelectorAll("#root p")].find((p) =>
    (p.textContent || "").startsWith("Recordar también"),
  )
  check(
    "O1 · slide 5 estrena la descripción nueva en un solo párrafo",
    !!parrafo && !parrafo.textContent.includes("\n"),
    JSON.stringify(parrafo?.textContent),
  )
  check(
    "O1 · y el texto sigue completo",
    t5.includes(
      "Recordar también es cuidar. Crea recordatorios para la familia, tus amigos o incluso para tu empresa.",
    ) && !t5.includes("Porque a veces recordar por alguien"),
  )
  check(
    "O1 · slide 5 con el logo real de WhatsApp en los tres usuarios",
    m.doc.querySelectorAll(`#root ${LOGO_WA}`).length === 3,
    String(m.doc.querySelectorAll(`#root ${LOGO_WA}`).length),
  )
  check("O1 · y sin el emoji de burbuja en el slide", !m.html().includes("💬"))

  m.click(m.dots()[6])
  await wait(60) // último paso: contacto
  const filaWA = m.input("onboarding-phone")?.parentElement?.parentElement
  const extWA = () =>
    m.doc.querySelector('#root select[aria-label="Extensión de país"]')
  check(
    "O1 · último paso con el logo real para el número de WhatsApp",
    !!filaWA?.querySelector(LOGO_WA) && !filaWA?.textContent.includes("💬"),
    JSON.stringify(filaWA?.textContent),
  )
  check(
    "O1 · y el número se escribe con su extensión de país al lado, Chile por defecto",
    m.input("onboarding-phone")?.getAttribute("placeholder") ===
      "9 1234 5678" &&
      extWA()?.value === "+56" &&
      (
        [...(extWA()?.options || [])].find((o) => o.value === "+56")
          ?.textContent || ""
      ).trim() === "🇨🇱" &&
      !(extWA()?.textContent || "").includes("Chile") &&
      m.txt().includes("Número de WhatsApp"),
  )
  check(
    "O1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

process.exit(finish() ? 1 : 0)
