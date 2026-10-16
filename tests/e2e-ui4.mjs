// E2E de la Etapa 3 (ajustes pedidos sobre la V1.5 local): el onboarding también avanza —y retrocede—
// deslizando, avisa "Bzzt… escribe un nombre primero" si se aprieta Siguiente sin nombre, ya no abre el
// teclado solo al llegar a los pasos de formulario y estrena la descripción del slide 5. En Ajustes:
// los canales de contacto conectados se ilustran en cada fila de "Usuarios de este dispositivo", hay un
// ticket para aceptar el número y el correo, y "Eliminar" de usuarios ya borra de verdad el perfil.
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const tomorrow = dayKey(new Date(Date.now() + 86400000))
const LOGO_WA = 'svg path[fill="#25D366"]'

const YO = {
  id: "yo",
  name: "Yo",
  emoji: "🙂",
  contact: { phone: "+56 9 1111 2222", email: "yo@ejemplo.com" },
  channels: { push: true, whatsapp: true, email: true },
}
const ABUELA = { id: "abuela", name: "Abuela", emoji: "👵" }
// Empresa dejó su número y su correo, pero todavía no marcó el ticket: sus datos no están confirmados.
const EMPRESA = {
  id: "empresa",
  name: "Empresa",
  emoji: "🧑",
  contact: {
    phone: "+56 9 3333 4444",
    email: "empresa@ejemplo.com",
    accepted: false,
  },
  channels: { push: true, whatsapp: true, email: true },
}
const reminderFor = (id, ownerId, name, channels = ["WhatsApp"]) => ({
  id,
  ownerId,
  name,
  date: tomorrow,
  time: "12:00",
  category: "Otros",
  categoryEmoji: "📦",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels,
})
const notifFor = (id, ownerId, eventName) => ({
  id,
  eventId: id,
  eventName,
  emoji: "📦",
  ownerId,
  message: `${eventName} está por vencer.`,
  createdAt: new Date().toISOString(),
  channel: "Notificación",
  status: "Enviado",
})

const mount = (seed) => montar(bundle, seed)

const { check, finish } = reporter()
const seedApp = (extra) => ({
  "recuerda.onboarding.v1": "1",
  "recuerda.profiles.v1": JSON.stringify([YO, ABUELA, EMPRESA]),
  "recuerda.activeProfile.v1": "yo",
  ...extra,
})

// ------------------------------------------- S) el onboarding avanza (y retrocede) deslizando
{
  const m = mount()
  await wait(150)
  check(
    "S1 · el paso 1 arranca con la abeja y sin el pitch",
    m.txt().includes("Bzzzt") && !m.txt().includes("Anota lo importante"),
    JSON.stringify(m.txt().slice(0, 120)),
  )

  m.swipe(-120, 0, "pointer")
  await wait(60) // deslizar con el mouse
  check(
    "S1 · deslizar a la izquierda abre el pitch (paso 1/7)",
    m.txt().includes("Deja de acordarte de todo.") &&
      m.txt().includes("Anota lo importante") &&
      m.stepAt() === 0,
    JSON.stringify(m.txt().slice(0, 160)),
  )

  m.swipe(-120)
  await wait(60) // deslizar con el dedo
  check(
    "S1 · deslizar a la izquierda pasa al paso 2/7",
    m.txt().includes("Recibe recordatorios") && m.stepAt() === 1,
    JSON.stringify(m.txt().slice(0, 120)),
  )

  m.swipe(120)
  await wait(60) // deslizar a la derecha = volver
  check(
    "S1 · deslizar a la derecha vuelve al paso 1/7",
    m.stepAt() === 0 && m.txt().includes("Anota lo importante"),
  )

  m.swipe(-60, -140)
  await wait(60)
  check("S1 · el gesto vertical (scroll) no cambia de paso", m.stepAt() === 0)
  m.swipe(-20)
  await wait(60)
  check("S1 · el gesto corto tampoco cambia de paso", m.stepAt() === 0)
  check(
    "S1 · el aviso de abajo ahora invita a deslizar",
    m.txt().includes("Toca o desliza para continuar"),
    JSON.stringify(m.txt().slice(-120)),
  )

  m.swipe(-130, 0, "pointer")
  await wait(60)
  check("S1 · con el mouse también avanza (paso 2/7)", m.stepAt() === 1)

  m.click(m.dots()[5])
  await wait(60)
  m.swipe(-120)
  await wait(60)
  check(
    "S2 · en el paso del nombre deslizar no avanza (hay que escribir)",
    m.stepAt() === 5 && !!m.input("onboarding-name"),
    String(m.stepAt()),
  )
  m.swipe(120)
  await wait(60)
  check(
    "S2 · pero sí retrocede al slide 5",
    m.stepAt() === 4 && m.txt().includes("Recuerda por"),
  )
  m.swipe(-120)
  await wait(60)
  check("S2 · y se vuelve al nombre", m.stepAt() === 5)

  m.type(m.input("onboarding-name"), "Papi")
  await wait(40)
  m.swipe(120)
  await wait(60)
  m.swipe(-120)
  await wait(60)
  check(
    "S2 · el nombre escrito sigue ahí al ir y volver",
    m.stepAt() === 5 && m.input("onboarding-name")?.value === "Papi",
    m.input("onboarding-name")?.value,
  )

  m.swipeFrom(m.input("onboarding-name"), -160)
  await wait(60)
  check("S2 · deslizar desde el campo de texto no navega", m.stepAt() === 5)
  m.swipeFrom(m.find("button", "Siguiente"), -160)
  await wait(60)
  check("S2 · deslizar desde el botón Siguiente tampoco", m.stepAt() === 5)

  m.clickText("button", "Siguiente")
  await wait(60)
  check(
    "S2 · el botón Siguiente lleva al último paso",
    m.stepAt() === 6 && m.txt().includes("¿Por dónde"),
  )
  m.swipe(-120)
  await wait(60)
  check("S2 · en el último paso deslizar no avanza", m.stepAt() === 6)
  m.swipe(120)
  await wait(60)
  check(
    "S2 · y deslizar atrás vuelve al nombre",
    m.stepAt() === 5 && m.input("onboarding-name")?.value === "Papi",
  )
  check(
    "S2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- N) el paso del nombre avisa en rojo y ya no abre el teclado
{
  const m = mount()
  await wait(150)
  m.swipe(-120)
  await wait(40) // abrir el pitch para que aparezcan los puntos
  m.click(m.dots()[5])
  await wait(60)
  const nameInput = m.input("onboarding-name")
  check(
    "N1 · el paso del nombre no roba el foco (no se abre el teclado)",
    !!nameInput &&
      !nameInput.hasAttribute("autofocus") &&
      m.doc.activeElement?.id !== "onboarding-name",
    m.doc.activeElement?.tagName,
  )
  check(
    "N1 · y el botón Siguiente está disponible",
    m.find("button", "Siguiente")?.disabled === false,
  )

  m.clickText("button", "Siguiente")
  await wait(60)
  const alert = () =>
    [...m.doc.querySelectorAll('#root [role="alert"]')].find((e) =>
      (e.textContent || "").includes("escribe un nombre primero"),
    )
  check(
    "N2 · sin nombre sale el aviso «Bzzt… escribe un nombre primero»",
    (alert()?.textContent || "").includes("Bzzt… escribe un nombre primero"),
    JSON.stringify(m.txt().slice(-140)),
  )
  check(
    "N2 · el aviso va chico y en rojo",
    !!alert() &&
      alert().className.includes("text-red-500") &&
      alert().className.includes("text-[12px]"),
    alert()?.className,
  )
  check(
    "N2 · y no avanza: sigue en el paso 6/7",
    m.stepAt() === 5 && m.txt().includes("llamas?"),
  )
  check(
    "N2 · el campo queda marcado como inválido",
    m.input("onboarding-name")?.getAttribute("aria-invalid") === "true",
  )

  m.type(m.input("onboarding-name"), "   ")
  await wait(40)
  check(
    "N2 · los espacios en blanco no cuentan como nombre",
    alert() === undefined,
  )
  m.clickText("button", "Siguiente")
  await wait(60)
  check("N2 · con solo espacios vuelve el aviso", !!alert() && m.stepAt() === 5)

  m.type(m.input("onboarding-name"), "Abuela")
  await wait(40)
  check(
    "N3 · al escribir el aviso se va",
    alert() === undefined &&
      m.input("onboarding-name")?.getAttribute("aria-invalid") === "false",
  )
  m.clickText("button", "Siguiente")
  await wait(60)
  check(
    "N3 · y con nombre el paso avanza al último",
    m.stepAt() === 6 && m.txt().includes("¿Por dónde"),
  )
  check(
    "N3 · el último paso tampoco roba el foco",
    !m.input("onboarding-phone")?.hasAttribute("autofocus") &&
      m.doc.activeElement?.id !== "onboarding-phone",
  )

  const m2 = mount()
  await wait(150)
  m2.swipe(-120)
  await wait(40)
  m2.click(m2.dots()[5])
  await wait(60)
  m2.clickText("button", "Saltar por ahora")
  await wait(60)
  check(
    "N4 · «Saltar por ahora» no pide nombre ni avisa",
    m2.stepAt() === 6 &&
      ![...m2.doc.querySelectorAll('#root [role="alert"]')].some((e) =>
        (e.textContent || "").includes("escribe un nombre primero"),
      ),
    String(m2.stepAt()),
  )
  check(
    "N4 · sin errores de ejecución",
    m.errors.length === 0 && m2.errors.length === 0,
    [m.errors.join(" | "), m2.errors.join(" | ")].join(" / ").slice(0, 200),
  )
}

// ------------------------------------------- O) slide 5 con la descripción nueva
{
  const m = mount()
  await wait(150)
  m.swipe(-120)
  await wait(40)
  m.click(m.dots()[4])
  await wait(60)
  const t5 = m.txt()
  check(
    "O2 · slide 5 con la descripción nueva",
    t5.includes(
      "Recordar también es cuidar. Crea recordatorios para la familia, tus amigos o incluso para tu empresa.",
    ),
    JSON.stringify(t5.slice(0, 260)),
  )
  check(
    "O2 · y sin el texto viejo",
    !t5.includes("Porque a veces recordar por alguien también es cuidar."),
  )
  check(
    "O2 · conserva el remate y sus usuarios",
    t5.includes("Correo, WhatsApp y Calendarios totalmente independientes.") &&
      t5.includes("Abuela") &&
      t5.includes("Empresa"),
  )
  check(
    "O2 · el remate ya no nombra un solo calendario y perdió la coma suelta",
    !t5.includes("Google Calendar") && !t5.includes("Calendarios, totalmente"),
  )
  check(
    "O2 · el bundle trae el texto nuevo y no el viejo",
    bundle.includes("Recordar también es cuidar.") &&
      !bundle.includes("Porque a veces recordar por alguien"),
    "",
  )
  check(
    "O2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- C) Ajustes: canales ilustrados y ticket de contacto
{
  const m = mount(seedApp())
  await wait(150)
  await m.ajustes()

  check(
    "C1 · en la fila de Yo se ven sus canales conectados",
    !!m.badge("WhatsApp conectado (Yo)") && !!m.badge("Correo conectado (Yo)"),
    m.html().slice(0, 80),
  )
  check(
    "C1 · el de WhatsApp es el logo real",
    !!m.badge("WhatsApp conectado (Yo)")?.querySelector(LOGO_WA),
  )
  check(
    "C1 · Abuela aparece sin canales",
    !!m.badge("WhatsApp sin configurar (Abuela)") &&
      !!m.badge("Correo sin configurar (Abuela)"),
  )
  check(
    "C1 · y sus badges quedan apagados",
    (m.badge("WhatsApp sin configurar (Abuela)")?.className || "").includes(
      "opacity-40",
    ) &&
      (m.badge("Correo sin configurar (Abuela)")?.className || "").includes(
        "grayscale",
      ),
  )
  check(
    "C1 · Empresa tiene número pero sin ticket: el canal queda apagado",
    !!m.badge("WhatsApp sin configurar (Empresa)") &&
      !m.badge("WhatsApp conectado (Empresa)"),
  )
  check(
    "C1 · cada badge dice de quién es",
    !!m.rowOf("Yo") && !!m.rowOf("Abuela") && !!m.rowOf("Empresa"),
  )

  const ticket = () => m.doc.getElementById("profile-contact-accept")
  check(
    "C2 · Yo (datos de antes) tiene el ticket marcado",
    !!ticket() &&
      ticket().checked === true &&
      m.txt().includes("Acepto que RECUERDA use estos datos"),
    JSON.stringify(m.txt().slice(0, 200)),
  )
  check(
    "C2 · y sus dos datos figuran como conectados",
    (m.txt().match(/✓ Conectado/g) || []).length === 2,
  )

  m.click(m.rowOf("Abuela").querySelector("button"))
  await wait(60)
  check(
    "C2 · sin datos no hay nada que aceptar: no aparece el ticket",
    m.doc.getElementById("profile-contact-accept") === null &&
      !m.txt().includes("Acepto que RECUERDA"),
  )

  m.click(m.rowOf("Empresa").querySelector("button"))
  await wait(60)
  check(
    "C3 · Empresa tiene el ticket sin marcar",
    !!ticket() && ticket().checked === false,
  )
  check(
    "C3 · sus datos quedan «Por confirmar»",
    (m.txt().match(/Por confirmar/g) || []).length === 2,
    JSON.stringify(m.txt().slice(0, 260)),
  )
  check(
    "C3 · y la app avisa que los avisos están en pausa",
    m
      .txt()
      .includes(
        "Sin el ticket marcado, los avisos por WhatsApp y correo quedan en pausa.",
      ),
  )

  m.click(ticket())
  await wait(60)
  check(
    "C3 · al marcar el ticket se guarda la aceptación",
    m.profileOf("empresa")?.contact?.accepted === true,
    JSON.stringify(m.profileOf("empresa")),
  )
  check(
    "C3 · sus datos pasan a conectados",
    (m.txt().match(/✓ Conectado/g) || []).length === 2 &&
      !m.txt().includes("Sin el ticket marcado"),
  )
  check(
    "C3 · y su canal se enciende en la lista de usuarios",
    !!m.badge("WhatsApp conectado (Empresa)") &&
      !!m.badge("Correo conectado (Empresa)"),
  )

  m.click(m.rowOf("Yo").querySelector("button"))
  await wait(60)
  m.type(m.input("profile-phone"), "9 9999 8888")
  await wait(60)
  check(
    "C4 · al cambiar el número el ticket se destilda solo",
    ticket()?.checked === false &&
      m.profileOf("yo")?.contact?.accepted === false,
    JSON.stringify(m.profileOf("yo")?.contact),
  )
  check(
    "C4 · el dato nuevo queda «Por confirmar»",
    m.txt().includes("Por confirmar") && !m.txt().includes("✓ Conectado"),
  )
  check(
    "C4 · y se guarda completo, con la extensión de país al frente",
    m.profileOf("yo")?.contact?.phone === "+56 9 9999 8888",
    JSON.stringify(m.profileOf("yo")?.contact),
  )
  // La tarjeta de Mi perfil ya no repite los canales: quedó en el ícono, el nombre y «Editar». El estado
  // del ticket se dice en la sección de Contacto y en las insignias de la lista de usuarios.
  const perfilCard = () =>
    [...m.doc.querySelectorAll("#root p")].find((p) =>
      (p.textContent || "").startsWith("Mi perfil ·"),
    )?.parentElement?.parentElement
  check(
    "C4 · la tarjeta de Mi perfil ya no repite los canales ni el estado del ticket",
    !!perfilCard() &&
      !/WhatsApp|Correo/.test(perfilCard().textContent || "") &&
      !perfilCard().querySelector("svg") &&
      !m.html().includes("💬"),
    JSON.stringify(perfilCard()?.textContent),
  )
  check(
    "C4 · y los canales se apagan en la lista de usuarios",
    !!m.badge("WhatsApp sin configurar (Yo)") &&
      !!m.badge("Correo sin configurar (Yo)"),
  )
  m.click(ticket())
  await wait(60)
  check(
    "C4 · al volver a aceptar, todo se reconecta",
    ticket()?.checked === true &&
      m.profileOf("yo")?.contact?.accepted === true &&
      !!m.badge("WhatsApp conectado (Yo)"),
  )
  check(
    "C4 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- C5) el motor respeta el ticket (coherencia con Ajustes)
{
  const abierta = {
    ...YO,
    contact: { phone: "+56 9 1111 2222", accepted: false },
  }
  const m = mount({
    ...seedApp(),
    "recuerda.profiles.v1": JSON.stringify([abierta]),
    "recuerda.events.v1": JSON.stringify([
      reminderFor("t-1", "yo", "Con ticket abierto"),
    ]),
  })
  await wait(150)
  check(
    "C5 · con el ticket sin marcar el aviso cae en notificación",
    m.notifOf("Con ticket abierto")?.channel === "Notificación",
    JSON.stringify(m.notifOf("Con ticket abierto")),
  )

  const cerrado = {
    ...YO,
    contact: { phone: "+56 9 1111 2222", accepted: true },
  }
  const m2 = mount({
    ...seedApp(),
    "recuerda.profiles.v1": JSON.stringify([cerrado]),
    "recuerda.events.v1": JSON.stringify([
      reminderFor("t-2", "yo", "Con ticket marcado"),
    ]),
  })
  await wait(150)
  check(
    "C5 · con el ticket marcado vuelve a salir por WhatsApp (simulado)",
    m2.notifOf("Con ticket marcado")?.channel === "WhatsApp (simulado en V1)",
    JSON.stringify(m2.notifOf("Con ticket marcado")),
  )
  check(
    "C5 · sin errores de ejecución",
    m.errors.length === 0 && m2.errors.length === 0,
    [m.errors.join(" | "), m2.errors.join(" | ")].join(" / ").slice(0, 200),
  )
}

// ------------------------------------------- D) «Eliminar» de usuarios borra de verdad el perfil
{
  const m = mount(
    seedApp({
      "recuerda.events.v1": JSON.stringify([
        reminderFor("e-yo", "yo", "Cita Yo"),
        reminderFor("e-ab", "abuela", "Cita Abuela"),
        reminderFor("e-em", "empresa", "Cita Empresa"),
      ]),
      "recuerda.notifications.v1": JSON.stringify([
        notifFor("e-yo", "yo", "Cita Yo"),
        notifFor("e-ab", "abuela", "Cita Abuela"),
        notifFor("e-em", "empresa", "Cita Empresa"),
      ]),
    }),
  )
  await wait(150)
  await m.ajustes()

  const del = m.deleteBtn("Empresa")
  check(
    "D1 · cada usuario con vecinos tiene su botón Eliminar",
    !!del && (del.textContent || "").includes("Eliminar"),
    String(del?.textContent),
  )
  m.click(del)
  await wait(60)
  check(
    "D1 · el primer toque solo pide confirmación",
    (m.deleteBtn("Empresa")?.textContent || "").includes("¿Eliminar?") &&
      !!m.profileOf("empresa"),
    JSON.stringify(m.profileOf("empresa")),
  )

  const avisosEmpresa = () =>
    m.notifications().filter((n) => n.ownerId === "empresa")
  check(
    "D1 · y sus avisos del historial",
    avisosEmpresa().length > 0,
    String(avisosEmpresa().length),
  )

  m.click(m.deleteBtn("Empresa"))
  await wait(60)
  check(
    "D1 · el segundo toque borra el perfil",
    m.profileOf("empresa") === undefined,
    JSON.stringify((m.storage("recuerda.profiles.v1") || []).map((p) => p.id)),
  )
  check(
    "D1 · y su fila desaparece de Ajustes",
    !m.rowOf("Empresa") && !m.txt().includes("Empresa"),
    JSON.stringify(m.txt().slice(0, 200)),
  )
  check(
    "D1 · se lleva sus recordatorios",
    !m.events().some((e) => e.ownerId === "empresa") && m.events().length === 2,
    JSON.stringify(m.events().map((e) => e.id)),
  )
  check(
    "D1 · y sus avisos del historial",
    avisosEmpresa().length === 0,
    JSON.stringify(m.notifications().map((n) => n.ownerId)),
  )
  check(
    "D1 · los demás usuarios quedan intactos",
    !!m.profileOf("yo") && !!m.profileOf("abuela"),
  )

  // Ahora el usuario activo (Yo): al borrarlo, el mando pasa al que queda.
  m.click(m.deleteBtn("Yo"))
  await wait(60)
  m.click(m.deleteBtn("Yo"))
  await wait(80)
  check(
    "D2 · borrar el usuario activo lo elimina de la lista",
    m.profileOf("yo") === undefined && !m.rowOf("Yo"),
    JSON.stringify((m.storage("recuerda.profiles.v1") || []).map((p) => p.id)),
  )
  check(
    "D2 · y la app pasa al usuario que queda",
    m.raw("recuerda.activeProfile.v1") === "abuela" &&
      m.txt().includes("Contacto de Abuela"),
    m.raw("recuerda.activeProfile.v1"),
  )
  check(
    "D2 · sin tocar los datos del que queda",
    m.profileOf("abuela")?.name === "Abuela" && m.txt().includes("Abuela"),
  )
  check(
    "D2 · con un solo usuario ya no hay Eliminar (no se puede quedar sin ninguno)",
    m.deleteBtn("Abuela") === undefined &&
      ![...m.doc.querySelectorAll("#root button")].some((b) =>
        (b.textContent || "").includes("Eliminar"),
      ),
    String(
      [...m.doc.querySelectorAll("#root button")].filter((b) =>
        (b.textContent || "").includes("Eliminar"),
      ).length,
    ),
  )
  check(
    "D2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

process.exit(finish() ? 1 : 0)
