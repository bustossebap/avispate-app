// E2E de la Etapa 6 (los ajustes pedidos sobre la Etapa 5): el último paso del onboarding estrena la
// burbuja blanca desplegable «Sincronizar con Calendarios»; en Ajustes los tres calendarios viven en UNA
// sola burbuja separados por líneas; al agregar desde una categoría vacía el recordatorio nuevo llega
// con esa categoría elegida; el número de WhatsApp se escribe con la extensión de país (Chile por
// defecto) en un cuadro chico con la bandera y el estado «✓ Conectado» en la línea del título; las dos
// listas de usuarios muestran los canales de contacto Y los calendarios de cada uno, sin la campana
// —las notificaciones del navegador no son un canal del usuario—; Mi perfil se rediseña (ícono en
// cuadrado, el nombre y «Editar», sin repetir canales); el botón de avisos de Inicio vuelve a ser la
// campana simple; la cara del usuario se elige de la rejilla, de la lista completa de emojis por temas
// (el botón «+»), escribiendo uno propio o con su foto, que ahora se ve en una vista previa con ✓ y ✕
// antes de guardarla; «Avísame» pasa a ser «¿Cuándo te aviso?» con las opciones elegidas sombreadas; las
// repeticiones incluyen las de horas; y al fondo de Ajustes, después de Datos, queda solo el botón
// «Ver tips» (la tarjeta con el título «Tips» y la avispa se fue).
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle, css } = await cargarBundle()
const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const evento = (id, ownerId, name, category = "Auto") => ({
  id,
  ownerId,
  name,
  date: manana,
  time: "12:00",
  category,
  categoryEmoji: category === "Auto" ? "🚗" : "🏠",
  recurrence: "No se repite",
  remindersBefore: [7],
  channels: ["Notificación"],
})
const YO = {
  id: "yo",
  name: "Yo",
  emoji: "🙂",
  contact: { phone: "+56 9 1111 2222", email: "yo@correo.cl", accepted: true },
  channels: { push: true, whatsapp: true, email: true },
  gcal: { connected: true, syncAll: true },
}
const ABUELA = { id: "abuela", name: "Abuela", emoji: "👵" }
const EMPRESA = {
  id: "empresa",
  name: "Empresa",
  emoji: "🧑",
  contact: {
    phone: "+56 9 3333 4444",
    email: "empresa@correo.cl",
    accepted: false,
  },
  channels: { push: false, whatsapp: true, email: true },
}
const seed = (extra) => ({
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([YO]),
  "avispate.activeProfile.v1": "yo",
  "avispate.reloj.v1": "24",
  ...extra,
})

const mount = (seed) => montar(bundle, seed, { descargas: true })

const { check, finish } = reporter()

// ------------------------------------------- R1) categoría preseleccionada al agregar desde el vacío
{
  const m = mount(
    seed({
      "avispate.events.v1": JSON.stringify([
        evento("r1", "yo", "Cambio de aceite", "Auto"),
      ]),
    }),
  )
  await wait(150)
  const chip = (t) => m.find("#root button", t)
  check(
    "R1 · el Inicio trae sus filtros por categoría",
    !!chip("🚗 Auto") && !!chip("🏠 Hogar") && !!chip("✦ Todas"),
  )
  m.press(chip("🏠 Hogar"))
  await wait(60)
  check(
    "R1 · al abrir una categoría vacía el Inicio lo dice",
    m.txt().includes("No hay recordatorios aquí") && m.txt().includes("Hogar"),
  )
  m.pressText("button", "Agregar recordatorio")
  await wait(80)
  check(
    "R1 · el formulario abre con ESA categoría ya elegida",
    m.txt().includes("Nuevo recordatorio") &&
      (chip("🏠 Hogar")?.className || "").includes("bg-amber-600") &&
      !(chip("🚗 Auto")?.className || "").includes("bg-amber-600"),
    chip("🏠 Hogar")?.className,
  )
  m.type(m.nombreInput(), "Cambiar el filtro del agua")
  await wait(30)
  m.clickText("button", "Guardar recordatorio")
  await wait(80)
  const guardado = m
    .events()
    .find((e) => e.name === "Cambiar el filtro del agua")
  check(
    "R1 · y se guarda en esa categoría (con su emoji)",
    guardado?.category === "Hogar" && guardado?.categoryEmoji === "🏠",
    JSON.stringify(guardado),
  )
  // Desde el botón «+» de la barra no se hereda ninguna categoría: es el camino neutro.
  await m.crearNuevo()
  check(
    "R1 · el «+» de la barra sigue abriendo con la categoría de siempre",
    (chip("🚗 Auto")?.className || "").includes("bg-amber-600"),
    chip("🚗 Auto")?.className,
  )
  check(
    "R1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- A1) «¿Cuándo te aviso?» con las opciones sombreadas
{
  const m = mount(seed())
  await wait(150)
  await m.crearNuevo()
  check(
    "A1 · la sección se llama «¿Cuándo te aviso?» (ya no «Avísame»)",
    m.txt().includes("¿Cuándo te aviso?") && !m.txt().includes("Avísame"),
  )
  const aviso = (t) => m.find("#root button", t)
  const elegido = aviso("7 días antes"),
    libre = aviso("90 días antes")
  check(
    "A1 · el aviso elegido se distingue con sombra y anillo",
    elegido?.getAttribute("aria-pressed") === "true" &&
      (elegido?.className || "").includes("shadow-md") &&
      (elegido?.className || "").includes("ring-2") &&
      (elegido?.className || "").includes("bg-amber-600"),
    elegido?.className,
  )
  check(
    "A1 · y el que no está elegido queda plano",
    libre?.getAttribute("aria-pressed") === "false" &&
      !(libre?.className || "").includes("shadow-md") &&
      !(libre?.className || "").includes("ring-2"),
    libre?.className,
  )
  m.press(libre)
  await wait(40)
  check(
    "A1 · al marcarlo también se destaca",
    libre?.getAttribute("aria-pressed") === "true" &&
      (libre?.className || "").includes("shadow-md") &&
      (libre?.className || "").includes("ring-2"),
  )
  m.press(libre)
  await wait(40)
  check(
    "A1 · y al desmarcarlo vuelve a quedar plano",
    libre?.getAttribute("aria-pressed") === "false" &&
      !(libre?.className || "").includes("shadow-md"),
  )
  check(
    "A1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- C1) la campana simple de Inicio (sin avispa)
{
  const m = mount(seed())
  await wait(150)
  const campana = () => m.byLabel("Historial de avisos enviados")
  check(
    "C1 · el botón de avisos vuelve a ser la campana de siempre, no una avispa dibujada",
    !!campana()?.querySelector('span[class*="text-[22px]"]') &&
      (campana()?.textContent || "").includes("🔔") &&
      !campana()?.querySelector("svg"),
    (campana()?.outerHTML || "").slice(0, 160),
  )
  check(
    "C1 · sin zumbido: ni ondas ni .animate-buzz por ningún lado del Inicio",
    m.doc.querySelectorAll("#root .animate-buzz").length === 0 &&
      !(campana()?.outerHTML || "").includes("buzz"),
    (campana()?.outerHTML || "").slice(0, 160),
  )
  check(
    "C1 · la mascota de la app es la abeja del saludo (la avispa dibujada se fue con la tarjeta de Tips)",
    m.txt().includes("¡Avíspate! 🐝") &&
      !bundle.includes("Sácale más partido a AVISPATE") &&
      !css.includes("buzz"),
  )
  check(
    "C1 · y la campana sigue sin burbuja, como el nombre del usuario",
    !(campana().className || "").includes("bg-white") &&
      !(campana().className || "").includes("border") &&
      !(m.byLabel("Cambiar usuario")?.className || "").includes("bg-white") &&
      !(m.byLabel("Cambiar usuario")?.className || "").includes("border"),
    `${campana().className} | ${m.byLabel("Cambiar usuario")?.className}`,
  )
  m.press(campana())
  await wait(60)
  check(
    "C1 · y el historial de avisos se sigue abriendo desde ahí",
    m.txt().includes("Avisos enviados"),
  )
  check(
    "C1 · al cerrarlo el historial se va",
    (m.press(campana()), await wait(60), !m.txt().includes("Avisos enviados")),
  )
  check(
    "C1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- C2) el emoji: los once de la rejilla o la lista completa
{
  const m = mount(seed())
  await wait(150)
  await m.irAjustes()
  m.pressText("button", "Editar")
  await wait(60)
  const rejilla = () =>
    m.doc.querySelector('#root [role="group"][aria-label^="Emoji de"]')
  const verTodos = () => m.byLabel("Ver todos los emojis para Yo")
  const cerrarHoja = () => m.byLabel("Cerrar la lista de emojis de Yo")
  const temas = () => [
    ...m.doc.querySelectorAll('[role="tablist"] [role="tab"]'),
  ]
  const lista = () =>
    m.doc.querySelector('[role="tablist"]')?.nextElementSibling
  check(
    "C2 · la rejilla suma un botón «+» para ver todos los emojis",
    rejilla()?.querySelectorAll("button").length === 12 &&
      !!verTodos() &&
      verTodos().getAttribute("aria-pressed") === "false" &&
      (verTodos().textContent || "").trim() === "+",
    (verTodos()?.outerHTML || "").slice(0, 200),
  )
  // El «+» va centrado en toda la caja: no es un signo suelto en el flujo del texto, sino una capa que
  // cubre el cuadro entero y lo centra ella misma.
  check(
    "C2 · el «+» está centrado en su cuadro",
    (verTodos()?.className || "").includes("relative") &&
      !!verTodos()?.querySelector(
        'span[class*="absolute inset-0"][class*="justify-center"]',
      ) &&
      verTodos().querySelectorAll("span").length === 1,
  )
  // Ya no hay campo para escribir a mano: el emoji se elige de los once o de la lista completa.
  check(
    "C2 · ya no hay campo para escribir un emoji a mano",
    !m.byLabel("Escribir otro emoji para Yo") &&
      !m.txt().includes("¿No está en la lista?"),
  )
  check("C2 · la lista completa todavía no está a la vista", !cerrarHoja())
  m.press(verTodos())
  await wait(40)
  check(
    "C2 · el «+» abre la lista completa en una hoja a pantalla completa, por temas",
    !!cerrarHoja() &&
      temas().length === 9 &&
      !!lista() &&
      lista().querySelectorAll("button").length >= 80,
    `${temas().length} temas · ${lista()?.querySelectorAll("button").length} emojis en el primero`,
  )
  // La hoja se dibuja como capa dentro del marco de la app (`#app-frame`), no dentro del formulario: eso
  // es lo que evita que un ancestro con `transform` (las animaciones `animate-slide-in`, que terminan en
  // `translateY(0)`) la encoja a una porción de la pantalla —lo que pasaba en el onboarding— y también
  // que el desplegable angosto de Inicio la recorte.
  const hoja = () => cerrarHoja()?.closest('div[class*="absolute inset-0"]')
  check(
    "C2 · la hoja se dibuja en el marco de la app (portal), por encima del formulario",
    (hoja()?.className || "").includes("absolute inset-0") &&
      (hoja()?.className || "").includes("z-[60]") &&
      hoja()?.parentElement?.id === "app-frame",
    `${(hoja()?.className || "").slice(0, 90)} · padre: ${hoja()?.parentElement?.id}`,
  )
  check(
    "C2 · la lista es el único scroll de la hoja, y con tope de alto",
    (lista()?.className || "").includes("overflow-y-auto") &&
      (lista()?.className || "").includes("max-h-[46vh]") &&
      (lista()?.className || "").includes("overscroll-contain"),
  )
  check(
    "C2 · los temas se llaman como en el teclado (caras, personas, animales…)",
    !!m.byLabel("Emojis de Caras para Yo") &&
      !!m.byLabel("Emojis de Animales para Yo") &&
      !!m.byLabel("Emojis de Comida para Yo") &&
      !!m.byLabel("Emojis de Banderas para Yo"),
  )
  // Los emojis de todos los temas: la lista completa, no una muestra. Se recorre tema por tema y se
  // cuentan.
  let emojisTotales = 0
  const vistos = new Set()
  for (let i = 0; i < temas().length; i++) {
    m.press(temas()[i])
    await wait(20)
    for (const b of lista().querySelectorAll("button")) {
      vistos.add(b.getAttribute("aria-label"))
      emojisTotales++
    }
  }
  check(
    "C2 · entre todos los temas hay la lista completa de emojis",
    emojisTotales >= 400,
    `${emojisTotales} emojis`,
  )
  check(
    "C2 · y ninguno se repite (ni el mismo emoji dos veces en la lista)",
    vistos.size === emojisTotales,
    `${vistos.size} de ${emojisTotales}`,
  )
  m.press(temas()[2])
  await wait(30) // Animales
  check(
    "C2 · cada tema trae los suyos",
    lista().querySelectorAll("button").length >= 80 &&
      !!m.byLabel("Emoji 🦊 para Yo"),
  )
  // Elegir uno de la lista: la cara cambia y la hoja se cierra, para ver cómo quedó en el formulario.
  m.press(m.byLabel("Emoji 🦊 para Yo"))
  await wait(40)
  check(
    "C2 · al elegir uno de la lista la cara cambia y la hoja se cierra",
    !cerrarHoja() &&
      (verTodos().textContent || "").includes("🦊") &&
      verTodos().getAttribute("aria-pressed") === "true" &&
      rejilla().querySelectorAll('[aria-pressed="true"]').length === 1 &&
      m.profileOf("yo")?.emoji === "🙂",
  )
  // Se puede volver a abrir para elegir otro; «Listo» cierra sin cambiar la cara.
  m.press(verTodos())
  await wait(40)
  const listo = () => m.find("#root button", "Listo")
  check(
    "C2 · la hoja se puede reabrir y trae su «Listo»",
    !!cerrarHoja() && !!listo(),
  )
  m.press(listo())
  await wait(40)
  check(
    "C2 · «Listo» cierra la hoja sin tocar la cara elegida",
    !cerrarHoja() && (verTodos().textContent || "").includes("🦊"),
    verTodos()?.textContent,
  )
  m.clickText("button", "Guardar")
  await wait(80)
  check(
    "C2 · al guardar, la cara elegida de la lista queda en ese usuario y se ve en su tarjeta",
    m.profileOf("yo")?.emoji === "🦊" && m.txt().includes("🦊"),
    JSON.stringify(m.profileOf("yo")),
  )
  m.clickText("button", "Editar")
  await wait(60)
  check(
    "C2 · al reabrir el editor, el botón muestra la cara propia guardada y queda marcado",
    (verTodos().textContent || "").includes("🦊") &&
      verTodos().getAttribute("aria-pressed") === "true",
    verTodos()?.textContent,
  )
  m.pressText("button", "Cancelar")
  await wait(40)
  check(
    "C2 · «Cancelar» cierra sin dejar nada a medias",
    m.profileOf("yo")?.emoji === "🦊" && !cerrarHoja(),
  )
  check(
    "C2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- C3) la lista de emojis desde Inicio (el desplegable angosto)
{
  const m = mount(seed())
  await wait(150)
  m.press(m.byLabel("Cambiar usuario"))
  await wait(60)
  m.pressText("button", "＋ Nuevo usuario")
  await wait(60)
  const desplegable = () =>
    m.doc.querySelector(
      '#root div[class*="absolute left-0"][class*="w-[270px]"]',
    )
  const usuarios = () => desplegable()?.children?.[1]
  check(
    "C3 · el desplegable de usuarios tiene tope de alto y un solo scroll",
    (desplegable()?.className || "").includes("max-h-[calc(100dvh-140px)]") &&
      (desplegable()?.className || "").includes("overflow-y-auto") &&
      (desplegable()?.className || "").includes("overscroll-contain") &&
      !(usuarios()?.className || "").includes("overflow-y-auto") &&
      !(usuarios()?.className || "").includes("max-h"),
    `${(desplegable()?.className || "").slice(0, 80)} | ${usuarios()?.className}`,
  )
  const verTodos = () => m.byLabel("Ver todos los emojis para el usuario nuevo")
  const cerrarHoja = () =>
    m.byLabel("Cerrar la lista de emojis de el usuario nuevo")
  const lista = () =>
    m.doc.querySelector('[role="tablist"]')?.nextElementSibling
  check(
    "C3 · el alta desde Inicio trae el botón «+» de la lista completa",
    !!verTodos(),
  )
  m.press(verTodos())
  await wait(60)
  check(
    "C3 · la hoja se abre como capa del marco (z-[60]) por encima del desplegable (z-40)",
    !!cerrarHoja() &&
      (
        cerrarHoja()?.closest('div[class*="absolute inset-0"]')?.className || ""
      ).includes("absolute inset-0") &&
      (
        cerrarHoja()?.closest('div[class*="absolute inset-0"]')?.className || ""
      ).includes("z-[60]") &&
      cerrarHoja()?.closest('div[class*="absolute inset-0"]')?.parentElement
        ?.id === "app-frame" &&
      (desplegable()?.className || "").includes("z-40"),
    (
      cerrarHoja()?.closest('div[class*="absolute inset-0"]')?.className || ""
    ).slice(0, 90),
  )
  check(
    "C3 · y la lista trae su propio scroll, con tope de alto",
    (lista()?.className || "").includes("overflow-y-auto") &&
      (lista()?.className || "").includes("max-h-[46vh]") &&
      (lista()?.className || "").includes("overscroll-contain"),
  )
  check(
    "C3 · las pestañas de tema envuelven en vez de scrollear de lado",
    !!m.byLabel("Emojis de Animales para el usuario nuevo") &&
      (m.doc.querySelector('[role="tablist"]')?.className || "").includes(
        "flex-wrap",
      ) &&
      !(m.doc.querySelector('[role="tablist"]')?.className || "").includes(
        "overflow-x",
      ),
  )
  m.press(m.byLabel("Emojis de Animales para el usuario nuevo"))
  await wait(40)
  check(
    "C3 · se elige un emoji de la lista y queda en el formulario del alta",
    !!m.byLabel("Emoji 🦊 para el usuario nuevo"),
  )
  m.press(m.byLabel("Emoji 🦊 para el usuario nuevo"))
  await wait(60)
  check(
    "C3 · al elegirlo, la hoja se cierra y la cara queda puesta",
    !cerrarHoja() && (verTodos().textContent || "").includes("🦊"),
    verTodos()?.textContent,
  )
  check(
    "C3 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- P1) extensión de país del número de WhatsApp
{
  const m = mount(
    seed({ "avispate.profiles.v1": JSON.stringify([YO, ABUELA]) }),
  )
  await wait(150)
  await m.irAjustes()
  const ext = () =>
    m.doc.querySelector('#root select[aria-label="Extensión de país"]')
  const opcion = (code) =>
    [...(ext()?.options || [])].find((o) => o.value === code)
  check(
    "P1 · el contacto trae la lista de extensión, con Chile por defecto",
    !!ext() &&
      ext().value === "+56" &&
      [...ext().options].length >= 15 &&
      (opcion("+56")?.textContent || "").trim() === "🇨🇱",
    String([...(ext()?.options || [])].length),
  )
  // El cuadro quedó chico y con la bandera sola: el nombre del país no se gasta en la pantalla (está al
  // abrir la lista y en el texto que aparece al pasar el dedo) y el número tiene todo el ancho.
  const filaNumero = () => m.input("profile-phone")?.parentElement
  const filaTitulo = () =>
    m.doc.querySelector('#root label[for="profile-phone"]')?.parentElement
  check(
    "P1 · la extensión es un cuadro chico con la bandera y sin el nombre del país",
    (ext().className || "").includes("w-[62px]") &&
      (ext().className || "").includes("appearance-none") &&
      (opcion("+1")?.textContent || "").trim() === "🇺🇸" &&
      ![...ext().options].some((o) =>
        /Chile|Estados Unidos|Argentina/.test(o.textContent || ""),
      ),
    JSON.stringify([...ext().options].slice(0, 4).map((o) => o.textContent)),
  )
  check(
    "P1 · el número se queda con el ancho (y por eso se ve completo)",
    (m.input("profile-phone")?.className || "").includes("flex-1") &&
      !(filaNumero()?.textContent || "").includes("Conectado"),
  )
  check(
    "P1 · y el estado del WhatsApp sube a la línea del título, a la vista",
    !!filaTitulo() &&
      (filaTitulo().textContent || "").includes("✓ Conectado") &&
      (filaTitulo().textContent || "").includes("Número de WhatsApp"),
  )
  // El correo se alinea igual que el WhatsApp: su estado va en la línea de «Correo electrónico», no
  // dentro de la fila del campo.
  const tituloDe = (campo) =>
    m.doc.querySelector(`#root label[for="${campo}"]`)?.parentElement
  const campoDe = (campo) => m.input(campo)?.parentElement
  check(
    "P1 · el estado del correo va en la línea de «Correo electrónico», igual que el del WhatsApp",
    (tituloDe("profile-email")?.textContent || "").includes("✓ Conectado") &&
      (tituloDe("profile-email")?.textContent || "").includes(
        "Correo electrónico",
      ) &&
      !(campoDe("profile-email")?.textContent || "").includes("Conectado"),
    JSON.stringify(tituloDe("profile-email")?.textContent),
  )
  check(
    "P1 · y las dos líneas están alineadas igual: título a la izquierda y estado a la derecha",
    ["profile-phone", "profile-email"].every((campo) => {
      const fila = tituloDe(campo)
      return (
        !!fila &&
        (fila.className || "").includes("flex items-center justify-between") &&
        fila.children.length === 2 &&
        fila.children[0].tagName === "LABEL" &&
        /Conectado|Por confirmar/.test(fila.children[1].textContent || "")
      )
    }),
    `${tituloDe("profile-phone")?.className} | ${tituloDe("profile-email")?.className}`,
  )
  check(
    "P1 · y el número se escribe aparte, sin repetir el país",
    m.input("profile-phone")?.value === "9 1111 2222" &&
      m.input("profile-phone")?.getAttribute("placeholder") === "9 1234 5678",
    m.input("profile-phone")?.value,
  )
  m.type(m.input("profile-phone"), "8888 7777")
  await wait(30)
  check(
    "P1 · al escribir se guarda con la extensión elegida",
    m.profileOf("yo")?.contact?.phone === "+56 8888 7777",
    JSON.stringify(m.profileOf("yo")?.contact),
  )
  m.pick(ext(), "+1")
  await wait(30)
  check(
    "P1 · al cambiar de país el número guardado cambia de extensión",
    m.profileOf("yo")?.contact?.phone === "+1 8888 7777" &&
      ext().value === "+1",
    JSON.stringify(m.profileOf("yo")?.contact),
  )
  // Cambiar de usuario y volver: la extensión se lee de lo guardado, no se queda pegada.
  m.clickText("button", "Abuela")
  await wait(60)
  check(
    "P1 · el usuario sin número arranca con Chile y el campo vacío",
    ext().value === "+56" && m.input("profile-phone")?.value === "",
  )
  m.clickText("button", "Yo")
  await wait(60)
  check(
    "P1 · al volver a ese usuario, su número aparece con SU extensión",
    ext().value === "+1" && m.input("profile-phone")?.value === "8888 7777",
    `${ext().value} ${m.input("profile-phone")?.value}`,
  )
  check(
    "P1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- U1) los canales de CADA usuario, en las dos listas
{
  const perfiles = [YO, ABUELA, EMPRESA]
  const m = mount(seed({ "avispate.profiles.v1": JSON.stringify(perfiles) }))
  await wait(150)
  // Las etiquetas de las insignias: dicen de quién son y si están encendidas. La campana ya no es una
  // insignia —las notificaciones del navegador no son un canal del usuario, son de este dispositivo— y
  // su interruptor vive en Ajustes › Notificaciones.
  const etiquetas = () =>
    [...m.doc.querySelectorAll("#root [aria-label]")]
      .map((e) => e.getAttribute("aria-label"))
      .filter(
        (l) =>
          l.includes("(Yo)") ||
          l.includes("(Abuela)") ||
          l.includes("(Empresa)"),
      )
      .sort()
  // La pista de que el nombre se toca: un chevron en ámbar dentro de una pastilla translúcida, sin
  // burbuja blanca (sería un chip más, igual que las categorías de abajo) y sin texto.
  const selector = () => m.byLabel("Cambiar usuario")
  check(
    "U1 · el selector de usuario se nota tocable, solo con la flecha y sin burbuja",
    !!selector() &&
      !(selector().className || "").includes("bg-white") &&
      !(selector().className || "").includes("border") &&
      !(selector().textContent || "").includes("Cambiar") &&
      !!selector().querySelector('span[class*="bg-amber-500/15"]') &&
      !!selector().querySelector("svg") &&
      !selector().querySelector('span[class*="rotate-180"]'),
    `${selector()?.className} · ${selector()?.textContent}`,
  )
  m.press(selector())
  await wait(60)
  check(
    "U1 · y su chevron gira cuando el desplegable está abierto",
    selector().getAttribute("aria-expanded") === "true" &&
      !!selector().querySelector('span[class*="rotate-180"]'),
  )
  m.press(selector())
  await wait(60)
  check(
    "U1 · al cerrarlo, el chevron vuelve a su lugar",
    selector().getAttribute("aria-expanded") === "false" &&
      !selector().querySelector('span[class*="rotate-180"]'),
  )
  m.press(m.byLabel("Cambiar usuario"))
  await wait(60)
  check(
    "U1 · la campana vuelve a ser un canal y va primera, en la misma línea que las demás",
    !!m.byLabel("Notificaciones activadas (Yo)") &&
      !!m.byLabel("Notificaciones activadas (Abuela)") &&
      !!m.byLabel("Notificaciones apagadas (Empresa)") &&
      m.byLabel("Notificaciones activadas (Yo)")?.parentElement
        ?.firstElementChild === m.byLabel("Notificaciones activadas (Yo)") &&
      !!m.byLabel("WhatsApp conectado (Yo)"),
  )
  check(
    "U1 · y sus canales de WhatsApp y correo según sus datos y su ticket",
    !!m.byLabel("WhatsApp conectado (Yo)") &&
      !!m.byLabel("Correo conectado (Yo)") &&
      !!m.byLabel("WhatsApp sin configurar (Abuela)") &&
      !!m.byLabel("Correo sin configurar (Abuela)"),
  )
  check(
    "U1 · sin ticket el canal queda apagado, aunque tenga número",
    !!m.byLabel("WhatsApp sin configurar (Empresa)") &&
      !!m.byLabel("Correo sin configurar (Empresa)") &&
      !m.byLabel("WhatsApp conectado (Empresa)"),
  )
  check(
    "U1 · y los tres calendarios de cada uno",
    !!m.byLabel("Google Calendar conectado (Yo) · Todos los avisos") &&
      !!m.byLabel("Apple Calendar sin conectar (Yo)") &&
      !!m.byLabel("Outlook sin conectar (Abuela)") &&
      !!m.byLabel("Google Calendar sin conectar (Empresa)"),
  )
  const enInicio = etiquetas()
  check(
    "U1 · son seis insignias por usuario (campana, dos canales y tres calendarios), todas en una línea",
    enInicio.length === 18 &&
      [
        ["Yo", "activadas"],
        ["Abuela", "activadas"],
        ["Empresa", "apagadas"],
      ].every(([nombre, estado]) => {
        const fila = m.byLabel(`Notificaciones ${estado} (${nombre})`)
          ?.parentElement
        return (
          !!fila &&
          fila.children.length === 6 &&
          (fila.className || "").includes("flex-nowrap") &&
          !(fila.className || "").includes("flex-wrap")
        )
      }),
    `${enInicio.length}: ${enInicio.join(" | ")}`,
  )
  await m.irAjustes()
  check(
    "U1 · Ajustes arranca con «Mi perfil» y después «Apariencia» (modo oscuro y hora)",
    m.txt().indexOf("Mi perfil ·") > -1 &&
      m.txt().indexOf("Apariencia") > m.txt().indexOf("Mi perfil ·") &&
      m.txt().indexOf("Modo oscuro") > m.txt().indexOf("Apariencia") &&
      m.txt().indexOf("Hora de los avisos") > m.txt().indexOf("Modo oscuro"),
    JSON.stringify(m.txt().slice(0, 120)),
  )
  check(
    "U1 · Ajustes cuenta exactamente lo mismo de cada usuario",
    JSON.stringify(etiquetas()) === JSON.stringify(enInicio),
    `${etiquetas().length} vs ${enInicio.length}`,
  )
  // En Ajustes la fila es angosta (avatar + nombre + botón de eliminar), así que las seis insignias van
  // en su propia línea a todo lo ancho de la tarjeta, alineadas con el nombre y fuera del botón.
  check(
    "U1 · en Ajustes las seis van en su propia línea, alineadas con el nombre y fuera del botón",
    (() => {
      const fila = m.byLabel("Notificaciones activadas (Yo)")?.parentElement
      const caja = fila?.parentElement
      return (
        !!fila &&
        !fila.closest("button") &&
        fila.children.length === 6 &&
        (fila.className || "").includes("flex-nowrap") &&
        (caja?.className || "").includes("pl-12") &&
        (caja?.className || "").includes("pb-3.5")
      )
    })(),
    (() => {
      const fila = m.byLabel("Notificaciones activadas (Yo)")?.parentElement
      return `${fila?.className} | ${fila?.parentElement?.className}`
    })(),
  )
  check(
    "U1 · y cada uno lleva su insignia en su propia fila",
    !!m.byLabel("Correo sin configurar (Abuela)") &&
      !!m.byLabel("WhatsApp sin configurar (Empresa)") &&
      !!m.byLabel("Apple Calendar sin conectar (Yo)"),
  )
  check(
    "U1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- M1) «Mi perfil» rediseñado
{
  const m = mount(
    seed({
      "avispate.profiles.v1": JSON.stringify([
        { ...YO, apple: { connected: true, syncAll: false } },
      ]),
    }),
  )
  await wait(150)
  await m.irAjustes()
  const card = () => {
    const p = [...m.doc.querySelectorAll("#root p")].find((el) =>
      (el.textContent || "").startsWith("Mi perfil ·"),
    )
    return p?.closest('div[class*="rounded-3xl"]')
  }
  const texto = () => card()?.textContent || ""
  check(
    "M1 · la tarjeta trae el ícono en un cuadrado y el nombre a su derecha",
    !!card()?.querySelector('span[class*="rounded-2xl"]') &&
      texto().includes("Mi perfil · Yo"),
  )
  check(
    "M1 · y nada más: ni un canal ni un calendario dentro de la tarjeta",
    !/Notificaciones|WhatsApp|Correo|Calendar|Outlook/.test(texto()),
    JSON.stringify(texto().slice(0, 260)),
  )
  check(
    "M1 · el único texto de la tarjeta es el nombre (los canales viven en sus propias secciones)",
    [...(card()?.querySelectorAll("p") || [])]
      .map((p) => (p.textContent || "").trim())
      .join(" | ") === "Mi perfil · Yo",
    JSON.stringify(
      [...(card()?.querySelectorAll("p") || [])].map((p) =>
        (p.textContent || "").trim(),
      ),
    ),
  )
  check(
    "M1 · y sin logos sueltos: el WhatsApp de verdad está en su fila de canales",
    !card()?.querySelector("svg") &&
      !!m
        .byLabel("Canal WhatsApp de este usuario")
        ?.parentElement?.querySelector('svg path[fill="#25D366"]'),
  )
  const editar = () =>
    [...m.doc.querySelectorAll("#root button")].find(
      (b) => (b.textContent || "").trim() === "Editar",
    )
  check(
    "M1 · abajo está «Editar», y la cara no está a la vista hasta presionarlo",
    !!editar() &&
      !m.doc.getElementById("profile-name") &&
      !m.doc.querySelector('#root [aria-label="Emoji de Yo"]'),
  )
  m.press(editar())
  await wait(60)
  check(
    "M1 · al presionarlo se editan el nombre y el ícono ahí mismo",
    m.doc.getElementById("profile-name")?.value === "Yo" &&
      !!m.doc.querySelector('#root [aria-label="Emoji de Yo"]') &&
      !!m.byLabel("Tomar o subir la foto de Yo"),
  )
  m.type(m.doc.getElementById("profile-name"), "Yo Mismo")
  await wait(30)
  m.press(m.byLabel("Emoji 👨 para Yo Mismo"))
  await wait(30)
  m.clickText("button", "Guardar")
  await wait(60)
  check(
    "M1 · al guardar quedan el nombre y el emoji nuevos en ese usuario",
    m.profileOf("yo")?.name === "Yo Mismo" &&
      m.profileOf("yo")?.emoji === "👨" &&
      m.profileOf("yo")?.contact?.phone === "+56 9 1111 2222",
    JSON.stringify(m.profileOf("yo")),
  )
  m.press(editar())
  await wait(40)
  check(
    "M1 · y al reabrirlo el nombre guardado es el nuevo",
    m.doc.getElementById("profile-name")?.value === "Yo Mismo",
  )
  m.pressText("button", "Cancelar")
  await wait(40)
  check(
    "M1 · «Cancelar» cierra sin tocar nada",
    !m.doc.getElementById("profile-name") &&
      m.txt().includes("Mi perfil · Yo Mismo"),
  )
  check(
    "M1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- C4) la hoja de emojis en el onboarding (slide animado)
{
  // El onboarding arma cada paso con `animate-slide-in`, que termina en `translateY(0)` y por eso deja un
  // `transform` en el elemento: cualquier modal `fixed` de adentro suyo se encogía a esa porción de la
  // pantalla. Con el portal al marco, la hoja cubre toda la pantalla del teléfono.
  const m = mount({})
  await wait(150)
  m.tap()
  await wait(40)
  for (let i = 0; i < 5; i++) {
    m.tap()
    await wait(40)
  }
  const verTodos = () => m.byLabel("Ver todos los emojis para ti")
  const cerrarHoja = () => m.byLabel("Cerrar la lista de emojis de ti")
  check(
    "C4 · el paso del nombre del onboarding trae el botón de todos los emojis",
    !!verTodos() && !!m.doc.getElementById("onboarding-name"),
  )
  m.press(verTodos())
  await wait(60)
  const hoja = () => cerrarHoja()?.closest('div[class*="absolute inset-0"]')
  check(
    "C4 · la hoja se dibuja en el marco de la app, no dentro del slide animado",
    !!hoja() &&
      (hoja()?.className || "").includes("z-[60]") &&
      hoja()?.parentElement?.id === "app-frame" &&
      !hoja()?.closest('[class*="animate-slide-in"]'),
    `padre: ${hoja()?.parentElement?.id} · dentro de una animación: ${!!hoja()?.closest('[class*="animate-slide-in"]')}`,
  )
  check(
    "C4 · y por eso cubre toda la pantalla del marco (ahí arriba no hay ningún transform)",
    hoja()?.parentElement?.id === "app-frame" &&
      !hoja()?.parentElement?.closest('[class*="animate-slide-in"]'),
  )
  m.press(m.byLabel("Emojis de Animales para ti"))
  await wait(40)
  m.press(m.byLabel("Emoji 🦊 para ti"))
  await wait(60)
  check(
    "C4 · se elige un emoji de la lista y la hoja se cierra, dejando la cara en el slide",
    !cerrarHoja() && (verTodos().textContent || "").includes("🦊"),
    verTodos()?.textContent,
  )
  // El modal de la foto tenía el mismo problema en el onboarding: también va al marco.
  m.press(m.byLabel("Tomar o subir la foto de ti"))
  await wait(60)
  const cerrarFoto = () => m.byLabel("Cerrar la cámara")
  check(
    "C4 · el modal de la foto también se dibuja en el marco, no dentro del slide",
    !!cerrarFoto() &&
      cerrarFoto()?.closest('div[class*="absolute inset-0"]')?.parentElement
        ?.id === "app-frame",
    `padre: ${cerrarFoto()?.closest('div[class*="absolute inset-0"]')?.parentElement?.id}`,
  )
  m.press(cerrarFoto())
  await wait(40)
  check(
    "C4 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- CAT) categorías propias: crear, ordenar y eliminar
{
  // Dos recordatorios sembrados, uno en Hogar y otro en Auto: así la eliminación tiene algo que ofrecer
  // (dejarlos sin categoría o borrarlos) y se ve el número real en el aviso.
  const m = mount(
    seed({
      "avispate.events.v1": JSON.stringify([
        evento("c-hogar", "yo", "Cortar el pasto", "Hogar"),
        evento("c-auto", "yo", "Cambio de aceite", "Auto"),
      ]),
    }),
  )
  await wait(150)
  const chip = (t) => m.find("#root button", t)
  const cats = () => m.storage("avispate.categorias.v1") || []
  const hojaNueva = () => m.byLabel("Cerrar la nueva categoría")
  const campo = () => m.doc.getElementById("category-name")
  const botonCrear = () => m.find("button", "Crear categoría")
  const carrusel = () => chip("✦ Todas")?.parentElement
  const ordenEnCarrusel = () =>
    [...(carrusel()?.querySelectorAll("button") || [])].map((b) =>
      (b.textContent || "").trim(),
    )

  check(
    "CAT · las categorías arrancan con las de siempre y el carrusel suma sus dos acciones al final",
    cats().length === 8 &&
      cats()[0].name === "Auto" &&
      !!chip("🚗 Auto") &&
      !!chip("＋ Nueva") &&
      !!m.byLabel("Editar categorías") &&
      m.txt().indexOf("＋ Nueva") > m.txt().indexOf("📦 Otros"),
    JSON.stringify(cats()),
  )
  // Crear desde Inicio: nombre y emoji (de la lista completa).
  m.press(chip("＋ Nueva"))
  await wait(60)
  check(
    "CAT · la hoja nueva pide nombre y un «+» para elegir el emoji (sin la rejilla de once caras)",
    !!hojaNueva() &&
      !!campo() &&
      (m.byLabel("Emoji de esta categoría")?.querySelectorAll("button")
        .length || 0) === 1 &&
      (
        m.byLabel("Ver todos los emojis para esta categoría")?.textContent || ""
      ).trim() === "+" &&
      m.txt().includes("Toca el «+» para elegir otro emoji"),
    (m.byLabel("Emoji de esta categoría")?.textContent || "").trim(),
  )
  check("CAT · sin nombre, crear está apagado", !!botonCrear()?.disabled)
  m.type(campo(), "Jardín")
  await wait(40)
  m.press(m.byLabel("Ver todos los emojis para esta categoría"))
  await wait(60)
  m.press(m.byLabel("Emojis de Animales para esta categoría"))
  await wait(40)
  m.press(m.byLabel("Emoji 🌻 para esta categoría"))
  await wait(40)
  check(
    "CAT · al elegir el emoji de la lista, el botón de crear se enciende",
    !botonCrear()?.disabled,
  )
  m.press(botonCrear())
  await wait(80)
  check(
    "CAT · la categoría nueva queda guardada, en el carrusel y elegida como filtro",
    cats().some((c) => c.name === "Jardín" && c.emoji === "🌻") &&
      !!chip("🌻 Jardín") &&
      (chip("🌻 Jardín")?.className || "").includes("bg-amber-600") &&
      !hojaNueva(),
    JSON.stringify(cats()),
  )
  check(
    "CAT · y el filtro quedó en la categoría nueva, que todavía no tiene recordatorios",
    m.txt().includes("No hay recordatorios aquí"),
  )
  // Repetida y en blanco: no se crea.
  m.press(chip("＋ Nueva"))
  await wait(60)
  m.type(campo(), " JARDÍN ")
  await wait(40)
  check(
    "CAT · repetida (aunque cambie la mayúscula) avisa y no deja crear",
    m.txt().includes("Ya tienes una categoría con ese nombre") &&
      !!botonCrear()?.disabled,
    JSON.stringify(m.txt().slice(-160)),
  )
  m.type(campo(), "   ")
  await wait(40)
  check(
    "CAT · con el nombre en blanco tampoco, y el aviso desaparece",
    !!botonCrear()?.disabled && !m.txt().includes("Ya tienes una categoría"),
  )
  m.press(m.byLabel("Cerrar la nueva categoría"))
  await wait(60)
  check(
    "CAT · al cerrar sin crear no se agregó nada",
    cats().length === 9,
    String(cats().length),
  )
  // Ordenar con las flechas del editor.
  m.press(m.byLabel("Editar categorías"))
  await wait(60)
  check(
    "CAT · el editor lista las categorías con sus recordatorios y su agarradera para arrastrar",
    !!m.byLabel("Cerrar el editor de categorías") &&
      m.txt().includes("1 recordatorio") &&
      m.txt().includes("0 recordatorios") &&
      !!m.byLabel("Mover Auto") &&
      m.txt().includes("Arrástralas desde la agarradera"),
  )
  // Arrastrar, no flechas: se toma la agarradera y se recorre media fila o más para intercambiar.
  const arrastrar = async (agarradera, dy) => {
    const disparar = (tipo, y) => {
      const e = new m.window.MouseEvent(tipo, {
        bubbles: true,
        cancelable: true,
        clientY: y,
      })
      e.pointerId = 1
      agarradera.dispatchEvent(e)
    }
    disparar("pointerdown", 200)
    disparar("pointermove", 200 + dy)
    disparar("pointerup", 200 + dy)
    await wait(60)
  }
  await arrastrar(m.byLabel("Mover Auto"), 70)
  check(
    "CAT · arrastrar la primera hacia abajo la manda al segundo lugar, y el orden se guarda",
    cats()[0].name === "Documentos" && cats()[1].name === "Auto",
    cats()
      .map((c) => c.name)
      .join(" · "),
  )
  check(
    "CAT · y el carrusel queda en ese orden",
    ordenEnCarrusel().indexOf("📄 Documentos") <
      ordenEnCarrusel().indexOf("🚗 Auto"),
    ordenEnCarrusel().join(" · "),
  )
  // Y al revés: hacia arriba vuelve al primer lugar (el gesto sirve en los dos sentidos).
  await arrastrar(m.byLabel("Mover Auto"), -70)
  check(
    "CAT · arrastrarla hacia arriba la devuelve al primer lugar",
    cats()[0].name === "Auto" && cats()[1].name === "Documentos",
    cats()
      .map((c) => c.name)
      .join(" · "),
  )
  // Eliminar dejando los recordatorios sin categoría.
  m.press(m.byLabel("Eliminar Hogar"))
  await wait(60)
  check(
    "CAT · al eliminar dice cuántos recordatorios tiene y ofrece las dos salidas",
    m.txt().includes("«Hogar» tiene 1 recordatorio") &&
      !!m.find("button", "Dejarlos sin categoría") &&
      !!m.find("button", "Borrar sus recordatorios"),
    JSON.stringify(m.txt().slice(-260)),
  )
  m.press(m.find("button", "Dejarlos sin categoría"))
  await wait(80)
  check(
    "CAT · «dejarlos sin categoría» borra la categoría y deja el recordatorio sin categoría",
    !cats().some((c) => c.name === "Hogar") &&
      (m.storage("avispate.events.v1") || []).some(
        (e) => e.name === "Cortar el pasto" && e.category === "",
      ),
    JSON.stringify(m.storage("avispate.events.v1")),
  )
  check("CAT · el carrusel ya no trae Hogar", !chip("🏠 Hogar"))
  // Eliminar borrando también sus recordatorios.
  m.press(m.byLabel("Eliminar Auto"))
  await wait(60)
  m.press(m.find("button", "Borrar sus recordatorios"))
  await wait(80)
  check(
    "CAT · «borrar sus recordatorios» se lleva la categoría y sus recordatorios",
    !cats().some((c) => c.name === "Auto") &&
      !(m.storage("avispate.events.v1") || []).some(
        (e) => e.name === "Cambio de aceite",
      ),
    JSON.stringify((m.storage("avispate.events.v1") || []).map((e) => e.name)),
  )
  m.press(m.byLabel("Cerrar el editor de categorías"))
  await wait(60)
  m.press(chip("✦ Todas"))
  await wait(60)
  check(
    "CAT · el recordatorio que quedó sin categoría se sigue viendo en «Todas»",
    m.txt().includes("Cortar el pasto"),
  )
  check(
    "CAT · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- CAT2) crear una categoría desde Nuevo recordatorio
{
  const m = mount(seed())
  await wait(150)
  m.press(m.doc.querySelector('[aria-label="Nuevo recordatorio"]'))
  await wait(80)
  const chip = (t) => m.find("#root button", t)
  const cats = () => m.storage("avispate.categorias.v1") || []
  check(
    "CAT2 · el formulario de Nuevo recordatorio también ofrece crear una categoría",
    !!chip("＋ Nueva") && !!chip("🚗 Auto"),
  )
  m.press(chip("＋ Nueva"))
  await wait(60)
  m.type(m.doc.getElementById("category-name"), "Mascotas")
  await wait(40)
  m.press(m.byLabel("Ver todos los emojis para esta categoría"))
  await wait(60)
  m.press(m.byLabel("Emojis de Comida para esta categoría"))
  await wait(40)
  m.press(m.byLabel("Emoji 🍕 para esta categoría"))
  await wait(40)
  m.press(m.find("button", "Crear categoría"))
  await wait(80)
  check(
    "CAT2 · al crearla queda elegida en el formulario y guardada en el dispositivo",
    (chip("🍕 Mascotas")?.className || "").includes("bg-amber-600") &&
      cats().some((c) => c.name === "Mascotas" && c.emoji === "🍕"),
    JSON.stringify(cats().map((c) => `${c.name} ${c.emoji}`)),
  )
  m.type(m.nombreInput(), "Vacuna")
  await wait(40)
  m.press(m.find("button", "Guardar recordatorio"))
  await wait(150)
  check(
    "CAT2 · y el recordatorio se guarda con esa categoría y su emoji",
    (m.storage("avispate.events.v1") || []).some(
      (e) =>
        e.name === "Vacuna" &&
        e.category === "Mascotas" &&
        e.categoryEmoji === "🍕",
    ),
    JSON.stringify(m.storage("avispate.events.v1")),
  )
  check(
    "CAT2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- F1) el usuario se puede poner por foto
{
  const m = mount(seed())
  await wait(150)
  await m.irAjustes()
  m.pressText("button", "Editar")
  await wait(60)
  const cam = () => m.byLabel("Tomar o subir la foto de Yo")
  check(
    "F1 · el botón de foto lleva un ícono de cámara, no un emoji",
    !!cam()?.querySelector("svg") &&
      !(cam()?.textContent || "").includes("📷") &&
      (cam()?.textContent || "").includes("Tomar o subir foto"),
    cam()?.outerHTML.slice(0, 130),
  )
  m.press(cam())
  await wait(60)
  check(
    "F1 · al abrirlo se puede tomar la foto o subir una",
    m.txt().includes("Foto de Yo") &&
      !!m.find("button", "Tomar la foto") &&
      !!m.find("button", "Subir una foto") &&
      !!m.byLabel("Cerrar la cámara"),
  )
  const selector = () =>
    m.doc.querySelector('input[type="file"][accept="image/*"]')
  check(
    "F1 · con su selector de imagen para la galería",
    !!selector() && (selector().className || "").includes("hidden"),
  )
  // Subir una foto de verdad: jsdom lee el archivo y la app la muestra en la vista previa, esperando el
  // ✓ o la ✕ (antes se guardaba sola y la cámara apagada dejaba el cuadro negro).
  const subir = async (nombre, contenido) => {
    const file = new m.window.File([contenido], nombre, { type: "image/png" })
    Object.defineProperty(selector(), "files", {
      value: [file],
      configurable: true,
    })
    selector().dispatchEvent(new m.window.Event("change", { bubbles: true }))
    await wait(1300)
  }
  await subir("yo.png", "foto-de-prueba")
  const vista = () =>
    m.doc.querySelector('img[alt="Vista previa de la foto de Yo"]')
  check(
    "F1 · la foto elegida se ve en la vista previa, con el ✓ y la ✕ para decidir",
    !!vista() &&
      !!m.byLabel("Usar esta foto de Yo") &&
      !!m.byLabel("Cancelar esta foto de Yo") &&
      m.txt().includes("Así queda tu foto"),
  )
  check(
    "F1 · y no queda el cuadro negro ni los controles de la cámara en vivo",
    !m.doc.querySelector("video") &&
      !m.byLabel("Cambiar de cámara") &&
      !m.doc.querySelector('#root img[alt="Foto de Yo"]'),
    `video ${!!m.doc.querySelector("video")} · cambiar de cámara ${!!m.byLabel("Cambiar de cámara")} · foto en el editor ${!!m.doc.querySelector('#root img[alt="Foto de Yo"]')}`,
  )
  // La ✕ cancela esa foto: se prueba con otra y se descarta, sin que quede nada guardado ni a medias.
  await subir("otra.png", "otra-foto")
  m.press(m.byLabel("Cancelar esta foto de Yo"))
  await wait(80)
  check(
    "F1 · la ✕ descarta esa foto y no guarda nada",
    !vista() &&
      !m.doc.querySelector('#root img[alt="Foto de Yo"]') &&
      !m.profileOf("yo")?.photo &&
      !!cam(),
  )
  m.press(cam())
  await wait(60)
  await subir("yo.png", "foto-de-prueba")
  m.press(m.byLabel("Usar esta foto de Yo"))
  await wait(80)
  check(
    "F1 · el ✓ la pone en el editor (y la vista previa se cierra)",
    !!m.doc.querySelector('#root img[alt="Foto de Yo"]') &&
      !vista() &&
      !m.byLabel("Usar esta foto de Yo"),
  )
  m.clickText("button", "Guardar")
  await wait(60)
  check(
    "F1 · y queda guardada en ese usuario",
    String(m.profileOf("yo")?.photo || "").startsWith("data:image/"),
    String(m.profileOf("yo")?.photo || "").slice(0, 40),
  )
  m.pressText("button", "Editar")
  await wait(60)
  m.press(m.byLabel("Quitar la foto de Yo"))
  await wait(40)
  m.clickText("button", "Guardar")
  await wait(60)
  check(
    "F1 · y se puede quitar para volver al emoji",
    !m.profileOf("yo")?.photo && m.txt().includes("Mi perfil · Yo"),
  )
  check(
    "F1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- F2) emoji o foto en todas las altas de usuario
{
  // a) En Inicio, al agregar un usuario nuevo.
  const m = mount(seed())
  await wait(150)
  m.press(m.byLabel("Cambiar usuario"))
  await wait(60)
  m.pressText("button", "＋ Nuevo usuario")
  await wait(60)
  check(
    "F2 · al agregar un usuario desde Inicio se puede elegir emoji o foto",
    m.txt().includes("Su emoji o su foto") &&
      !!m.byLabel("Emoji de el usuario nuevo") &&
      !!m.byLabel("Tomar o subir la foto de el usuario nuevo"),
  )
  m.type(
    m.doc.querySelector('input[placeholder="Nombre (ej. Abuela)"]'),
    "Taller",
  )
  await wait(40)
  check(
    "F2 · y el botón de foto pasa a ser del usuario que se está creando",
    !!m.byLabel("Tomar o subir la foto de Taller") &&
      !!m.byLabel("Emoji de Taller"),
  )
  m.press(m.byLabel("Emoji 🏢 para Taller"))
  await wait(30)
  m.clickText("button", "Agregar")
  await wait(60)
  check(
    "F2 · el usuario nuevo queda con su emoji",
    (m.storage("avispate.profiles.v1") || []).find((p) => p.name === "Taller")
      ?.emoji === "🏢",
  )
  // Y el alta sin tocar la cara: la rejilla arranca con la abeja marcada y ese es el emoji que queda.
  m.press(m.byLabel("Cambiar usuario"))
  await wait(60)
  m.pressText("button", "＋ Nuevo usuario")
  await wait(60)
  m.type(
    m.doc.querySelector('input[placeholder="Nombre (ej. Abuela)"]'),
    "Sin cara",
  )
  await wait(40)
  check(
    "F2 · la rejilla arranca con la abeja marcada (cara por defecto)",
    m.byLabel("Emoji 🐝 para Sin cara")?.getAttribute("aria-pressed") ===
      "true",
    m.byLabel("Emoji de Sin cara")?.textContent,
  )
  m.clickText("button", "Agregar")
  await wait(60)
  check(
    "F2 · y un usuario nuevo sin elegir cara queda con la abeja",
    (m.storage("avispate.profiles.v1") || []).find((p) => p.name === "Sin cara")
      ?.emoji === "🐝",
    JSON.stringify(
      (m.storage("avispate.profiles.v1") || []).find(
        (p) => p.name === "Sin cara",
      ),
    ),
  )
  check(
    "F2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
  // b) En el onboarding, en el paso del nombre.
  const onb = mount()
  await wait(150)
  onb.tap()
  await wait(40)
  for (let i = 0; i < 5; i++) {
    onb.tap()
    await wait(40)
  }
  check(
    "F2 · el onboarding pide el emoji o la foto del usuario «yo»",
    onb.txt().includes("Tu emoji o tu foto") &&
      !!onb.byLabel("Emoji de ti") &&
      !!onb.byLabel("Tomar o subir la foto de ti") &&
      !!onb.doc.getElementById("onboarding-name"),
  )
  check(
    "F2 · sin errores de ejecución en el onboarding",
    onb.errors.length === 0,
    onb.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- N1) repetir por horas
{
  const m = mount(seed())
  await wait(150)
  await m.crearNuevo()
  const opcion = (t) => m.find("#root button", t)
  const nuevas = [
    "No se repite",
    "Cada 8 horas",
    "Cada semana",
    "Cada 2 semanas",
    "Cada mes",
    "Cada 6 meses",
    "Cada año",
    "🐝 Personalizada",
  ]
  check(
    "N1 · las opciones de «¿Se repite?» son las nuevas",
    nuevas.every((t) => !!opcion(t)),
    nuevas.filter((t) => !opcion(t)).join(" | "),
  )
  check(
    "N1 · y las de plazos larguísimos ya no se ofrecen",
    !opcion("Cada 2 años") && !opcion("Cada 5 años") && !opcion("Cada 10 años"),
  )
  m.press(opcion("Cada 8 horas"))
  await wait(40)
  m.type(m.nombreInput(), "Tomar agua")
  await wait(30)
  m.clickText("button", "Guardar recordatorio")
  await wait(80)
  const guardado = m.events().find((e) => e.name === "Tomar agua")
  check(
    "N1 · el recordatorio se guarda con su repetición por horas",
    guardado?.recurrence === "Cada 8 horas",
    JSON.stringify(guardado?.recurrence),
  )
  // Al completarlo, la próxima vuelta es 8 horas después (fecha Y hora): es lo que distingue a las
  // repeticiones por horas de las de días o meses.
  const base = new Date(`${guardado.date}T${guardado.time}:00`)
  base.setHours(base.getHours() + 8)
  const iso = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`
  const hhmm = `${String(base.getHours()).padStart(2, "0")}:${String(base.getMinutes()).padStart(2, "0")}`
  m.clickText("p", "Tomar agua")
  await wait(80)
  check(
    "N1 · el detalle avisa cuál será la próxima vuelta",
    m.txt().includes("se programará"),
    JSON.stringify(m.txt().slice(-220)),
  )
  m.clickText("button", "✓ Marcar como completado")
  await wait(80)
  const despues = m.events().find((e) => e.name === "Tomar agua")
  check(
    "N1 · al completarlo salta 8 horas, con fecha y hora",
    despues?.date === iso && despues?.time === hhmm,
    `${despues?.date} ${despues?.time} vs ${iso} ${hhmm}`,
  )
  check(
    "N1 · y queda registrado en su historial",
    (despues?.history || []).length === 1,
    JSON.stringify(despues?.history),
  )
  check(
    "N1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- N2) horas en la repetición personalizada y en el .ics
{
  const m = mount(seed())
  await wait(150)
  await m.crearNuevo()
  m.press(m.find("#root button", "🐝 Personalizada"))
  await wait(60)
  const unidad = [...m.doc.querySelectorAll("#root select")].find((s) =>
    [...s.options].some((o) => o.value === "horas"),
  )
  check(
    "N2 · la repetición personalizada ahora incluye las horas",
    !!unidad &&
      [...unidad.options].map((o) => o.value).join(",") ===
        "horas,días,semanas,meses,años",
    [...(unidad?.options || [])].map((o) => o.value).join(","),
  )
  m.type([...m.doc.querySelectorAll('#root input[type="number"]')][0], "3")
  await wait(30)
  m.pick(unidad, "horas")
  await wait(40)
  check(
    "N2 · y el resumen dice «Cada 3 horas»",
    m.txt().includes("Cada 3 horas"),
    JSON.stringify(m.txt().slice(-180)),
  )
  m.press(m.byLabel("Agregar a Apple Calendar"))
  await wait(40)
  m.type(m.nombreInput(), "Regar las plantas")
  await wait(30)
  m.clickText("button", "Guardar recordatorio")
  await wait(120)
  const guardado = m.events().find((e) => e.name === "Regar las plantas")
  check(
    "N2 · se guarda la repetición personalizada en horas",
    guardado?.recurrence === "Personalizada" &&
      guardado?.recurrenceInterval === 3 &&
      guardado?.recurrenceUnit === "horas",
    JSON.stringify(guardado),
  )
  const ics = await m.download(0)
  check(
    "N2 · y el archivo para el calendario la expresa por horas",
    ics.includes("RRULE:FREQ=HOURLY;INTERVAL=3"),
    JSON.stringify(
      ics
        .split("\n")
        .filter((l) => l.startsWith("RRULE"))
        .join(" | "),
    ),
  )
  check(
    "N2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- N3) lo ya guardado sigue entendiéndose
{
  const viejo = {
    ...evento("n3", "yo", "Renovar pasaporte"),
    recurrence: "Cada 5 años",
  }
  const m = mount(seed({ "avispate.events.v1": JSON.stringify([viejo]) }))
  await wait(150)
  m.clickText("p", "Renovar pasaporte")
  await wait(60)
  check(
    "N3 · un recordatorio viejo con repetición de años se muestra igual",
    m.txt().includes("Cada 5 años") && m.txt().includes("se programará"),
  )
  m.clickText("button", "Editar")
  await wait(80)
  check(
    "N3 · y al editarlo su opción sigue ahí, marcada",
    (m.find("#root button", "Cada 5 años")?.className || "").includes(
      "bg-amber-600",
    ),
    m.find("#root button", "Cada 5 años")?.className,
  )
  check(
    "N3 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ------------------------------------------- T1) «Ver tips» al fondo de Ajustes
{
  const m = mount(seed())
  await wait(150)
  await m.irAjustes()
  const verTips = () => m.find("#root button", "Ver tips")
  check(
    "T1 · «Ver tips» está al fondo de Ajustes",
    !!verTips() && m.txt().indexOf("Ver tips") > m.txt().indexOf("Datos"),
    String(m.txt().indexOf("Ver tips")),
  )
  // La sección de Tips se fue entera —título, tarjeta, avispa y resumen—: queda el botón solo.
  check(
    "T1 · la sección de Tips ya no está: ni el título ni la tarjeta, solo el botón",
    !/Tips/.test(m.txt()) &&
      !m.txt().includes("Sácale más partido a AVISPATE") &&
      !m.txt().includes("Consejos cortos") &&
      (verTips()?.className || "").includes("w-full"),
    JSON.stringify(m.txt().slice(-260)),
  )
  m.press(verTips())
  await wait(80)
  const puntos = () => [...m.doc.querySelectorAll('#root [aria-label^="Tip "]')]
  const tipsScreen = () => m.doc.querySelector("#root div.tips-bg")
  check(
    "T1 · abre los tips, con su fondo propio (distinto al del onboarding)",
    !!tipsScreen() &&
      !(tipsScreen().className || "").includes("app-bg") &&
      !(tipsScreen().className || "").includes("amber") &&
      m.txt().includes("Tips de AVISPATE"),
    tipsScreen()?.className,
  )
  check(
    "T1 · con sus slides y sus puntos",
    puntos().length === 6 &&
      puntos()[0].getAttribute("aria-current") === "true" &&
      m.txt().includes("Tú decides cuándo"),
  )
  check(
    "T1 · y sus consejos hablan de la app",
    m.txt().includes("avisarte") &&
      m.txt().includes("Se suman todos los avisos que quieras."),
  )
  m.press(puntos()[2])
  await wait(60)
  check(
    "T1 · se puede saltar a un tip desde los puntos",
    m.txt().includes("Los tres calendarios") &&
      puntos()[2].getAttribute("aria-current") === "true",
  )
  m.pressText("button", "Siguiente tip")
  await wait(60)
  check(
    "T1 · y avanzar con el botón",
    puntos()[3].getAttribute("aria-current") === "true" &&
      m.txt().includes("Tip 4 de 6"),
  )
  await m.swipe(-120)
  check(
    "T1 · también se desliza con el dedo, como el onboarding",
    puntos()[4].getAttribute("aria-current") === "true",
    `${puntos().findIndex((p) => p.getAttribute("aria-current") === "true")}`,
  )
  await m.swipe(120)
  check(
    "T1 · y hacia atrás vuelve al tip anterior",
    puntos()[3].getAttribute("aria-current") === "true",
  )
  m.press(puntos()[5])
  await wait(60)
  check(
    "T1 · el último tip cierra con «¡Listo!»",
    !!m.find("#root button", "¡Listo!"),
  )
  m.pressText("button", "¡Listo!")
  await wait(80)
  check(
    "T1 · «¡Listo!» vuelve a Ajustes",
    m.txt().includes("Ajustes") &&
      !m.doc.querySelector("#root div.tips-bg") &&
      !!verTips(),
  )
  m.press(verTips())
  await wait(80)
  m.press(m.byLabel("Cerrar los tips"))
  await wait(80)
  check(
    "T1 · y la × también vuelve a Ajustes",
    !m.doc.querySelector("#root div.tips-bg") && m.txt().includes("Ver tips"),
  )
  check(
    "T1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ---------------------------------------------------------------- D) estáticos del bundle
check(
  "D · el bundle trae los textos y las piezas nuevas",
  bundle.includes("Sincronizar con Calendarios") &&
    bundle.includes("Extensión de país") &&
    bundle.includes("Cada 8 horas") &&
    bundle.includes("¿Cuándo te aviso?") &&
    bundle.includes("Ver tips") &&
    bundle.includes("Tomar o subir foto") &&
    bundle.includes("Ver todos los emojis para") &&
    bundle.includes("tips-bg") &&
    css.includes(".tips-bg"),
)
check(
  "D · y las piezas de esta entrega: la lista completa de emojis, la vista previa de la foto y la bandera",
  bundle.includes("Temas de emojis para") &&
    bundle.includes("Caras") &&
    bundle.includes("Animales") &&
    bundle.includes("Banderas") &&
    bundle.includes("Emoji para") &&
    bundle.includes("Cerrar la lista de emojis de") &&
    bundle.includes("max-h-[46vh]") &&
    ["🦔", "🥌", "🪅", "🌮", "🇿🇦"].every((e) => bundle.includes(e)) &&
    bundle.includes("Así queda tu foto") &&
    bundle.includes("Usar esta foto") &&
    bundle.includes("Cancelar esta foto") &&
    bundle.includes("Vista previa de la foto de") &&
    bundle.includes("Extensión de país") &&
    bundle.includes("appearance-none"),
)
check(
  "D · y lo que se fue ya no está",
  !bundle.includes("Sincronizar todo con Google Calendar") &&
    !bundle.includes("Avísame") &&
    !bundle.includes("Elegir emoji de") &&
    !bundle.includes("Escribe o pega tu emoji") &&
    !bundle.includes("Eso no es un emoji") &&
    !bundle.includes("Cualquiera de tu teclado") &&
    !bundle.includes("Otro emoji para"),
)
check(
  "D · la tarjeta de Tips se fue con su avispa y su zumbido; queda el botón",
  !css.includes("buzz") &&
    !bundle.includes("Sácale más partido a AVISPATE") &&
    !bundle.includes("Consejos cortos") &&
    bundle.includes("Ver tips"),
)
check(
  "D · la campana vuelve a ser una insignia, y las seis van sin envolver",
  bundle.includes("Notificaciones activadas") &&
    bundle.includes("Notificaciones apagadas") &&
    bundle.includes("flex-nowrap") &&
    !bundle.includes("La campana quedó fuera de esta lista") &&
    bundle.includes("Notificaciones push"),
)
check(
  "D · las categorías propias traen su clave, sus dos hojas y sus dos salidas al eliminar",
  bundle.includes("avispate.categorias.v1") &&
    bundle.includes("Editar categorías") &&
    bundle.includes("＋ Nueva") &&
    bundle.includes("Dejarlos sin categoría") &&
    bundle.includes("Borrar sus recordatorios") &&
    bundle.includes("Arrástralas desde la agarradera") &&
    bundle.includes("Toca el «+» para elegir otro emoji") &&
    !bundle.includes("Súbelas o bájalas"),
)
check(
  "D · pero las repeticiones antiguas se siguen entendiendo",
  bundle.includes("Cada 5 años") && bundle.includes("Cada 10 años"),
)
check(
  "D · la entrega en curso es la Etapa 10",
  bundle.includes("Etapa 10") && !bundle.includes("Etapa 7"),
)

process.exit(finish() ? 1 : 0)
