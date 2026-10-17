// Regresión: con el onboarding ya hecho, el resto de la app sigue igual y el ajuste de Google
// Calendar que toca el último paso del onboarding es el mismo que usan Ajustes y Crear.
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

// El ajuste de Google Calendar se guarda con la clave global de la V1.5 a propósito: así este recorrido
// también comprueba que la migración se lo lleva al usuario "yo".
const m = montar(bundle, {
  "avispate.onboarding.v1": "1",
  "recuerda.gcal.v1": JSON.stringify({ connected: true, syncAll: false }),
})
const { doc, txt, click, storage, errors } = m
const find = (text) => m.find("button", text)
const type = (el, value) => m.type(el, value)
const profile = (id) => m.profileOf(id)

await wait(150)
check(
  "R · con el onboarding hecho entra directo al inicio",
  txt().includes("¡Avíspate! 🐝") &&
    !doc.querySelector('#root [aria-label^="Ir al paso"]'),
  JSON.stringify(txt().slice(0, 60)),
)
check(
  "R · el inicio trae la barra inferior",
  !!find("Ajustes") &&
    !!find("Inicio") &&
    !!find("Calendario") &&
    !!find("Historial"),
)

click(find("Ajustes"))
await wait(60)
// Los tres calendarios viven en un desplegable que arranca cerrado: se abre con su burbuja.
const abreCalendarios = () =>
  doc.querySelector('#root [aria-label^="Calendarios de"]')
check(
  "R · Ajustes abre con el desplegable de Calendarios cerrado",
  !!abreCalendarios() &&
    abreCalendarios().getAttribute("aria-expanded") === "false" &&
    !doc.querySelector(
      '[aria-label="Sincronizar todos los avisos con Google Calendar"]',
    ),
)
click(abreCalendarios())
await wait(60)
check(
  "R · al abrirlo aparece Google Calendar con su opción Todos los avisos",
  txt().includes("Todos los avisos") &&
    !!doc.querySelector(
      '[aria-label="Sincronizar todos los avisos con Google Calendar"]',
    ),
)
const setSw = () =>
  doc.querySelector(
    '[aria-label="Sincronizar todos los avisos con Google Calendar"]',
  )
check(
  "R · Ajustes refleja el syncAll apagado que dejó el ajuste",
  setSw()?.getAttribute("aria-pressed") === "false",
  setSw()?.outerHTML.slice(0, 120),
)

click(setSw())
await wait(40)
check(
  "R · encenderlo en Ajustes guarda syncAll:true en ESE usuario",
  profile("yo")?.gcal?.syncAll === true,
  JSON.stringify(profile("yo")),
)
check(
  "R · y la migración se llevó el ajuste global al usuario «yo» (clave vieja borrada)",
  storage("recuerda.gcal.v1") === null &&
    profile("yo")?.gcal?.connected === true,
)
check(
  "R · y avisa del cambio",
  txt().includes(
    "los recordatorios nuevos vienen con Google Calendar activado",
  ),
  JSON.stringify(txt().slice(-160)),
)

check(
  "R · Ajustes trae el contacto del usuario activo, con la extensión de país",
  txt().includes("Contacto de Yo") &&
    !!doc.getElementById("profile-phone") &&
    !!doc.getElementById("profile-email") &&
    doc.querySelector('#root select[aria-label="Extensión de país"]')?.value ===
      "+56",
)
const chanSw = (label) =>
  doc.querySelector(`[aria-label="Canal ${label} de este usuario"]`)
check(
  "R · los canales del usuario arrancan en su valor por defecto",
  chanSw("WhatsApp")?.getAttribute("aria-checked") === "true" &&
    chanSw("Correo electrónico")?.getAttribute("aria-checked") === "false",
  chanSw("Correo electrónico")?.outerHTML.slice(0, 140),
)
type(doc.getElementById("profile-phone"), "9 7777 8888")
await wait(30)
check(
  "R · el número se guarda dentro del usuario, con su extensión (ya no en la clave global)",
  profile("yo")?.contact?.phone === "+56 9 7777 8888" &&
    storage("recuerda.contacto.v1") === null,
  JSON.stringify(profile("yo")),
)
click(chanSw("WhatsApp"))
await wait(30)
check(
  "R · apagar WhatsApp queda solo en ese usuario",
  profile("yo")?.channels?.whatsapp === false,
  JSON.stringify(profile("yo")),
)

click(doc.querySelector('[aria-label="Nuevo recordatorio"]'))
await wait(60)
check(
  "R · Crear abre con el formulario",
  txt().includes("Nuevo recordatorio") ||
    txt().includes("Guardar recordatorio"),
  JSON.stringify(txt().slice(0, 80)),
)
const gcalSw = doc.querySelector('[aria-label="Agregar a Google Calendar"]')
check(
  "R · Crear respeta «Todos los avisos»: viene marcado",
  gcalSw?.getAttribute("aria-pressed") === "true",
  gcalSw?.outerHTML.slice(0, 140),
)
check(
  "R · sin errores de ejecución",
  errors.length === 0,
  errors.join(" | ").slice(0, 200),
)

process.exit(finish() ? 1 : 0)
