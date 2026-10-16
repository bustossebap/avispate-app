// E2E del onboarding nuevo: monta el bundle construido en jsdom y recorre el flujo completo,
// la ruta "saltar por ahora" y la precarga de datos ya guardados.
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle, css } = await cargarBundle()

const mount = (seed) => montar(bundle, seed)

const { check, finish } = reporter()

// ---------------------------------------------------------------- A) recorrido completo
{
  const m = mount()
  await wait(150)
  check(
    "A · arranca en la intro de la abeja",
    m.txt().includes("Bzzzt") && m.txt().includes("¡Avíspate!"),
    JSON.stringify(m.txt().slice(0, 50)),
  )

  m.tap()
  await wait(40)
  check(
    "A · portada con 7 puntos (5 slides + nombre + contacto)",
    m.dots().length === 7,
    String(m.dots().length),
  )
  check(
    "A · portada abre el pitch",
    m.txt().includes("Deja de acordarte de todo.") &&
      m.txt().includes("Anota lo importante"),
  )

  const snap = {}
  for (const s of [
    { n: 2, t: "Recibe recordatorios" },
    { n: 3, t: "Tú eliges" },
    { n: 4, t: "Complementa tu" },
    { n: 5, t: "Recuerda por" },
  ]) {
    m.tap()
    await wait(40)
    snap[s.n] = { txt: m.txt(), html: m.html() }
    check(
      `A · paso ${s.n}/7 llega «${s.t}»`,
      m.txt().includes(s.t),
      JSON.stringify(m.txt().slice(0, 80)),
    )
    check(
      `A · paso ${s.n}/7 con su punto marcado`,
      m.dots()[s.n - 1]?.getAttribute("aria-current") === "true",
    )
  }

  const t4 = snap[4].txt,
    h4 = snap[4].html
  check(
    "A · paso 4 sin el remate de abajo de la animación",
    !t4.includes("Todo queda guardado en tu dispositivo"),
    JSON.stringify(t4.slice(-140)),
  )
  check(
    "A · paso 4 sin el chip «+» de la animación",
    (h4.match(/animate-pop-in inline-flex/g) || []).length === 4,
    `chips=${(h4.match(/animate-pop-in inline-flex/g) || []).length}`,
  )
  check(
    "A · paso 4 conserva los cuatro adjuntos",
    ["📝 Nota", "🎧 Audio", "📄 Documento", "🖼️ Foto"].every((x) =>
      t4.includes(x),
    ),
    JSON.stringify(t4.slice(-200)),
  )
  const t5 = snap[5].txt,
    h5 = snap[5].html
  check(
    "A · paso 5 sin el slide borrado «Correo y WhatsApp»",
    !t5.includes("Correo y WhatsApp") &&
      !t5.includes("Elige por dónde te avisamos"),
  )
  check(
    "A · paso 5 con la descripción nueva",
    t5.includes(
      "Recordar también es cuidar. Crea recordatorios para la familia, tus amigos o incluso para tu empresa.",
    ) && !t5.includes("Porque a veces recordar por alguien"),
    JSON.stringify(t5.slice(0, 220)),
  )
  check(
    "A · paso 5 con los tres usuarios: Yo, Abuela y Empresa",
    t5.includes("Yo") &&
      t5.includes("5 recordatorios") &&
      t5.includes("Abuela") &&
      t5.includes("3 recordatorios") &&
      t5.includes("Empresa") &&
      t5.includes("8 recordatorios"),
  )
  check(
    "A · paso 5 con la tarjeta «Yo» como primera ilustración de usuario",
    /🐝[\s\S]{0,160}?Yo/.test(h5) && h5.indexOf("Yo") < h5.indexOf("Abuela"),
    JSON.stringify(
      h5.slice(Math.max(0, h5.indexOf("🐝") - 40), h5.indexOf("🐝") + 140),
    ),
  )
  check(
    "A · paso 5 con el remate nuevo",
    t5.includes("Correo, WhatsApp y Calendarios totalmente independientes.") &&
      !t5.includes("Google Calendar, totalmente"),
    JSON.stringify(t5.slice(-160)),
  )
  check(
    "A · paso 5 ya no dice «usuario por usuario» ni «para la abuela»",
    !t5.includes("usuario por usuario") && !t5.includes("para la abuela"),
  )

  m.tap()
  await wait(40)
  check(
    "A · paso 6/7 pide el nombre",
    m.txt().includes("¿Cómo te") &&
      m.txt().includes("llamas?") &&
      m.dots()[5]?.getAttribute("aria-current") === "true",
  )
  check(
    "A · paso 6 con botón «Siguiente» (ya no «¡Avíspate!»)",
    m.txt().includes("Siguiente") && !m.txt().includes("¡Avíspate!"),
  )
  check(
    "A · paso 6 mantiene «Saltar por ahora»",
    m.txt().includes("Saltar por ahora"),
  )
  check(
    "A · paso 6 · el toque ya no avanza",
    (() => {
      m.tap()
      return m.txt().includes("llamas?")
    })(),
  )
  m.clickText("button", "Siguiente")
  await wait(60)
  const aviso = () =>
    [...m.doc.querySelectorAll('#root [role="alert"]')].find((e) =>
      (e.textContent || "").includes("Bzzt… escribe un nombre primero"),
    )
  check(
    "A · «Siguiente» sin nombre avisa en rojo y no avanza",
    !!aviso() &&
      aviso().className.includes("text-red-500") &&
      m.dots()[5]?.getAttribute("aria-current") === "true",
    JSON.stringify(m.txt().slice(-160)),
  )
  m.type(m.input("onboarding-name"), "Sebastián")
  await wait(40)
  check("A · el aviso se va al escribir", aviso() === undefined)
  check(
    "A · «Siguiente» queda disponible al escribir el nombre",
    m.find("button", "Siguiente").disabled === false,
  )
  m.clickText("button", "Siguiente")
  await wait(40)
  // La sincronización con calendarios viene en una burbuja blanca desplegable: cerrada solo se ve el
  // resumen; al abrirla aparecen Google, Apple y Outlook, cada uno con su interruptor.
  const abreCal = () =>
    m.doc.querySelector('#root [aria-label="Sincronizar con Calendarios"]')
  const swSel = '[aria-label="Sincronizar con Google Calendar"]'
  const extSel = () =>
    m.doc.querySelector('#root select[aria-label="Extensión de país"]')
  check(
    "A · paso 7/7 pide el contacto",
    m.txt().includes("¿Por dónde") &&
      m.txt().includes("te avisamos?") &&
      m.dots()[6]?.getAttribute("aria-current") === "true",
    JSON.stringify(m.txt().slice(0, 120)),
  )
  check(
    "A · paso 7 con el campo de teléfono y su extensión de país (Chile por defecto)",
    m.txt().includes("Número de WhatsApp") &&
      m.input("onboarding-phone")?.getAttribute("type") === "tel" &&
      m.input("onboarding-phone")?.getAttribute("placeholder") ===
        "9 1234 5678" &&
      extSel()?.value === "+56" &&
      (
        [...(extSel()?.options || [])].find((o) => o.value === "+56")
          ?.textContent || ""
      ).trim() === "🇨🇱" &&
      !(extSel()?.textContent || "").includes("Chile"),
  )
  check(
    "A · paso 7 con el campo de correo",
    m.txt().includes("Correo electrónico") &&
      m.input("onboarding-email")?.getAttribute("type") === "email" &&
      m.input("onboarding-email")?.getAttribute("placeholder") ===
        "tucorreo@ejemplo.com",
  )
  check(
    "A · paso 7 con la burbuja «Sincronizar con Calendarios», cerrada",
    m.txt().includes("Sincronizar con Calendarios") &&
      !!abreCal() &&
      abreCal().getAttribute("aria-expanded") === "false" &&
      !m.doc.querySelector(swSel),
    JSON.stringify(m.txt().slice(-160)),
  )
  check(
    "A · paso 7 con «¡Avíspate!» y «Saltar por ahora»",
    !!m.find("button", "¡Avíspate!") && !!m.find("button", "Saltar por ahora"),
  )
  check(
    "A · paso 7 · el toque ya no avanza",
    (() => {
      m.tap()
      return m.txt().includes("te avisamos?")
    })(),
  )

  // El contacto y los calendarios ya no son claves globales: viven dentro del usuario "yo".
  const yoProfile = () =>
    (m.storage("recuerda.profiles.v1") || []).find((p) => p.id === "yo")
  check(
    "A · la burbuja resume que no hay ninguno conectado",
    (abreCal()?.textContent || "").includes("sin conectar") &&
      !yoProfile()?.gcal &&
      m.storage("recuerda.gcal.v1") === null,
  )
  m.click(abreCal())
  await wait(40)
  check(
    "A · al abrirla baja con los tres calendarios",
    abreCal().getAttribute("aria-expanded") === "true" &&
      !!m.doc.querySelector(swSel) &&
      !!m.doc.querySelector('[aria-label="Sincronizar con Apple Calendar"]') &&
      !!m.doc.querySelector('[aria-label="Sincronizar con Outlook"]'),
  )
  check(
    "A · los tres arrancan apagados",
    [
      swSel,
      '[aria-label="Sincronizar con Apple Calendar"]',
      '[aria-label="Sincronizar con Outlook"]',
    ].every(
      (sel) =>
        m.doc.querySelector(sel)?.getAttribute("aria-checked") === "false",
    ),
  )
  m.click(m.doc.querySelector(swSel))
  await wait(30)
  const gcal = yoProfile()?.gcal
  check(
    "A · encender Google guarda su calendario en el usuario «yo»",
    gcal?.connected === true &&
      gcal?.syncAll === true &&
      m.storage("recuerda.gcal.v1") === null,
    JSON.stringify({ gcal, legacy: m.storage("recuerda.gcal.v1") }),
  )
  check(
    "A · el interruptor queda encendido con su nota",
    m.doc.querySelector(swSel).getAttribute("aria-checked") === "true" &&
      m
        .txt()
        .includes(
          "Los recordatorios nuevos vienen con este calendario activado.",
        ),
  )
  m.click(m.doc.querySelector('[aria-label="Sincronizar con Apple Calendar"]'))
  await wait(30)
  check(
    "A · Apple Calendar se guarda en el mismo usuario, por separado",
    yoProfile()?.apple?.connected === true &&
      yoProfile()?.apple?.syncAll === true &&
      m.storage("recuerda.gcal.v1") === null,
    JSON.stringify(yoProfile()?.apple),
  )
  check(
    "A · y la burbuja resume cuáles quedaron conectados",
    (abreCal().textContent || "").includes(
      "Conectados: Google Calendar y Apple Calendar",
    ),
    abreCal().textContent,
  )

  m.type(m.input("onboarding-email"), "correo-malo")
  await wait(30)
  check(
    "A · un correo mal escrito avisa y bloquea «¡Avíspate!»",
    m.txt().includes("Revisa el correo electrónico.") &&
      m.find("button", "¡Avíspate!").disabled === true,
  )
  m.type(m.input("onboarding-phone"), "9 1234 5678")
  m.type(m.input("onboarding-email"), "papi@ejemplo.com")
  await wait(30)
  check(
    "A · con datos válidos «¡Avíspate!» se habilita",
    !m.txt().includes("Revisa el") &&
      m.find("button", "¡Avíspate!").disabled === false,
  )
  m.clickText("button", "¡Avíspate!")
  await wait(80)

  check(
    "A · cierra el onboarding y entra al inicio",
    m.window.localStorage.getItem("recuerda.onboarding.v1") === "1" &&
      m.dots().length === 0,
    JSON.stringify(m.txt().slice(0, 80)),
  )
  check(
    "A · guarda el contacto del último paso dentro del usuario «yo»",
    JSON.stringify(yoProfile()?.contact) ===
      JSON.stringify({ phone: "+56 9 1234 5678", email: "papi@ejemplo.com" }) &&
      m.storage("recuerda.contacto.v1") === null,
    JSON.stringify({
      contact: yoProfile()?.contact,
      legacy: m.storage("recuerda.contacto.v1"),
    }),
  )
  check(
    "A · el usuario «yo» queda con el nombre escrito",
    (m.storage("recuerda.profiles.v1") || []).find((p) => p.id === "yo")
      ?.name === "Sebastián",
  )
  check(
    "A · y con la abeja como cara por defecto (no eligió ninguna)",
    (m.storage("recuerda.profiles.v1") || []).find((p) => p.id === "yo")
      ?.emoji === "🐝",
    JSON.stringify(
      (m.storage("recuerda.profiles.v1") || []).find((p) => p.id === "yo"),
    ),
  )
  check(
    "A · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ---------------------------------------------------------------- B) ruta «saltar por ahora»
{
  const m = mount()
  await wait(150)
  m.tap()
  await wait(30)
  for (let i = 0; i < 5; i++) {
    m.tap()
    await wait(30)
  }
  check(
    "B · llega al paso del nombre",
    m.txt().includes("llamas?") &&
      m.dots()[5]?.getAttribute("aria-current") === "true",
  )
  m.type(m.input("onboarding-name"), "Abuela")
  await wait(30)
  m.clickText("button", "Saltar por ahora")
  await wait(40)
  check(
    "B · «Saltar por ahora» en el nombre lleva al último paso (no cierra)",
    m.txt().includes("te avisamos?") &&
      m.dots()[6]?.getAttribute("aria-current") === "true" &&
      m.window.localStorage.getItem("recuerda.onboarding.v1") === null,
    JSON.stringify(m.txt().slice(0, 90)),
  )
  check(
    "B · el último paso conserva «Saltar por ahora»",
    !!m.find("button", "Saltar por ahora") && !!m.find("button", "¡Avíspate!"),
  )
  m.clickText("button", "Saltar por ahora")
  await wait(80)
  check(
    "B · saltar al final cierra el onboarding",
    m.window.localStorage.getItem("recuerda.onboarding.v1") === "1" &&
      m.dots().length === 0,
  )
  check(
    "B · saltar NO guarda el contacto",
    !(m.storage("recuerda.profiles.v1") || []).find((p) => p.id === "yo")
      ?.contact && m.storage("recuerda.contacto.v1") === null,
    JSON.stringify(
      (m.storage("recuerda.profiles.v1") || []).find((p) => p.id === "yo"),
    ),
  )
  check(
    "B · pero sí conserva el nombre escrito",
    (m.storage("recuerda.profiles.v1") || []).find((p) => p.id === "yo")
      ?.name === "Abuela",
  )
  check(
    "B · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ---------------------------------------------------------------- C) precarga de lo guardado
{
  const m = mount({
    "recuerda.contacto.v1": JSON.stringify({
      phone: "+56 9 1111 2222",
      email: "viejo@ejemplo.com",
    }),
    "recuerda.gcal.v1": JSON.stringify({ connected: true, syncAll: true }),
  })
  await wait(150)
  m.tap()
  await wait(30)
  for (let i = 0; i < 5; i++) {
    m.tap()
    await wait(30)
  }
  m.type(m.input("onboarding-name"), "Papi")
  await wait(20)
  m.clickText("button", "Siguiente")
  await wait(40)
  check(
    "C · precarga el número guardado con su extensión (Chile) y separado del país",
    m.input("onboarding-phone")?.value === "9 1111 2222" &&
      m.doc.querySelector('#root select[aria-label="Extensión de país"]')
        ?.value === "+56",
    `${m.doc.querySelector('#root select[aria-label="Extensión de país"]')?.value} ${m.input("onboarding-phone")?.value}`,
  )
  check(
    "C · precarga el correo guardado",
    m.input("onboarding-email")?.value === "viejo@ejemplo.com",
    m.input("onboarding-email")?.value,
  )
  m.click(
    m.doc.querySelector('#root [aria-label="Sincronizar con Calendarios"]'),
  )
  await wait(40)
  check(
    "C · el interruptor refleja el ajuste de Ajustes",
    m.doc
      .querySelector('[aria-label="Sincronizar con Google Calendar"]')
      .getAttribute("aria-checked") === "true",
  )
  const migrado = (m.storage("recuerda.profiles.v1") || []).find(
    (p) => p.id === "yo",
  )
  check(
    "C · la migración movió el contacto y el calendario al usuario «yo» y borró las claves viejas",
    migrado?.contact?.phone === "+56 9 1111 2222" &&
      migrado?.contact?.email === "viejo@ejemplo.com" &&
      migrado?.gcal?.connected === true &&
      m.storage("recuerda.contacto.v1") === null &&
      m.storage("recuerda.gcal.v1") === null,
    JSON.stringify({
      migrado,
      contacto: m.storage("recuerda.contacto.v1"),
      gcal: m.storage("recuerda.gcal.v1"),
    }),
  )
  check(
    "C · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ---------------------------------------------------------------- D) estáticos del bundle
check(
  "D · el bundle ya no trae los slides borrados",
  !bundle.includes("Correo y WhatsApp") &&
    !bundle.includes("Todos los avisos,"),
)
check(
  "D · sin código ni animación huérfanos",
  !bundle.includes("notify-knob") &&
    !bundle.includes("Avisos de cada recordatorio") &&
    !css.includes("notify-knob"),
)
check(
  "D · los textos viejos ya no están en el bundle",
  !bundle.includes("usuario por usuario") &&
    !bundle.includes("Todo queda guardado en tu dispositivo") &&
    !bundle.includes("para la abuela"),
)
check(
  "D · el bundle trae el paso de contacto",
  bundle.includes("recuerda.contacto.v1") &&
    bundle.includes("Número de WhatsApp") &&
    bundle.includes("Correo electrónico") &&
    bundle.includes("Sincronizar con Calendarios") &&
    bundle.includes("Extensión de país") &&
    bundle.includes("Recordar también es cuidar."),
)
check(
  "D · el bundle trae los textos nuevos de la Etapa 3",
  bundle.includes("Bzzt… escribe un nombre primero") &&
    bundle.includes("Toca o desliza para continuar") &&
    !bundle.includes("Porque a veces recordar por alguien"),
)

process.exit(finish() ? 1 : 0)
