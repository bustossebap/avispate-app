// E2E del renombre RECUERDA → AVISPATE (Etapa 7): la marca visible en toda la app, las claves guardadas
// con su nombre nuevo y —lo que más importa— la migración, para que quien ya usaba RECUERDA conserve sus
// recordatorios, usuarios, categorías, ajustes y su contacto al actualizar.
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString()
const lejos = () => {
  const d = new Date(Date.now() + 30 * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const YO = {
  id: "yo",
  name: "Sebastián",
  emoji: "🐝",
  channels: { push: true, whatsapp: true, email: true },
}
const EVENTO = {
  id: "r1",
  ownerId: "yo",
  name: "Renovar el registro",
  date: lejos(),
  time: "09:00",
  category: "Otros",
  categoryEmoji: "📦",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels: ["Notificación"],
}
// El estado ya migrado: es el punto de partida de las comprobaciones que no miran la migración.
const alDia = (extra = {}) => ({
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([YO]),
  "avispate.events.v1": "[]",
  ...extra,
})

// ---------------------------------------------------------------- A) la marca en el bundle
check("A · el bundle dice AVISPATE", bundle.includes("AVISPATE"))
check(
  "A · y no queda ningún RECUERDA (las claves viejas van en minúscula: son legado)",
  !bundle.includes("RECUERDA"),
)
check(
  "A · la marca nueva en los textos que salen de la app",
  bundle.includes("Recordatorio de AVISPATE") &&
    bundle.includes("Tips de AVISPATE") &&
    bundle.includes("sin abrir AVISPATE"),
)
check(
  "A · el .ics y las notificaciones también",
  bundle.includes("PRODID:-//AVISPATE//Recordatorios//ES") &&
    bundle.includes("X-WR-CALNAME:AVISPATE") &&
    bundle.includes("AVISPATE · Recordatorio") &&
    bundle.includes("AVISPATE · Avíspate"),
)
check(
  "A · las claves guardadas ya son avispate.*",
  bundle.includes("avispate.events.v1") &&
    bundle.includes("avispate.profiles.v1") &&
    bundle.includes("avispate.activeProfile.v1") &&
    bundle.includes("avispate.sent.") &&
    bundle.includes("avispate.attachments.v1"),
)
check(
  "A · las dos claves históricas de la V1.5 se siguen leyendo para migrar",
  bundle.includes("recuerda.contacto.v1") &&
    bundle.includes("recuerda.gcal.v1"),
)

// ---------------------------------------------------------------- B) la migración de las claves
// Se siembra todo con los nombres viejos, como lo tendría alguien que ya usaba RECUERDA.
{
  const VIEJAS = [
    "recuerda.onboarding.v1",
    "recuerda.profiles.v1",
    "recuerda.events.v1",
    "recuerda.categorias.v1",
    "recuerda.reloj.v1",
    "recuerda.avisosInactividad.v1",
    "recuerda.sent.r1:a1:20260101",
  ]
  const m = montar(bundle, {
    "recuerda.onboarding.v1": "1",
    "recuerda.profiles.v1": JSON.stringify([YO]),
    "recuerda.events.v1": JSON.stringify([EVENTO]),
    "recuerda.categorias.v1": JSON.stringify([
      { id: "c1", name: "Salud", emoji: "🩺" },
    ]),
    "recuerda.reloj.v1": "24",
    "recuerda.avisosInactividad.v1": hace(1),
    "recuerda.sent.r1:a1:20260101": "1",
    "recuerda.contacto.v1": JSON.stringify({
      phone: "+56 9 1111 2222",
      email: "yo@avispate.cl",
      accepted: true,
    }),
  })
  await wait(150)

  check(
    "B · el usuario guardado pasa a la clave nueva, intacto",
    m.storage("avispate.profiles.v1")?.[0]?.name === "Sebastián",
    JSON.stringify(m.storage("avispate.profiles.v1")),
  )
  check(
    "B · el recordatorio también",
    (m.storage("avispate.events.v1") || [])[0]?.name === "Renovar el registro",
  )
  check(
    "B · y la categoría propia",
    m.storage("avispate.categorias.v1")?.[0]?.name === "Salud",
  )
  check(
    "B · el reloj, el onboarding, la inactividad y los avisos ya enviados",
    m.raw("avispate.reloj.v1") === "24" &&
      m.raw("avispate.onboarding.v1") === "1" &&
      m.raw("avispate.avisosInactividad.v1") !== null &&
      m.raw("avispate.sent.r1:a1:20260101") === "1",
  )
  check(
    "B · las claves viejas se borran (una sola fuente de verdad)",
    VIEJAS.every((k) => m.raw(k) === null),
    JSON.stringify(VIEJAS.filter((k) => m.raw(k) !== null)),
  )
  check(
    "B · el contacto global de la V1.5 termina dentro del usuario «yo»",
    m.profileOf("yo")?.contact?.phone === "+56 9 1111 2222" &&
      m.raw("recuerda.contacto.v1") === null,
    JSON.stringify(m.profileOf("yo")),
  )
  check(
    "B · la app entra derecho al inicio con los datos migrados",
    m.txt().includes("¡Avíspate! 🐝") &&
      m.txt().includes("Renovar el registro"),
    JSON.stringify(m.txt().slice(0, 160)),
  )
  check(
    "B · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ---------------------------------------------------------------- C) la migración no pisa lo nuevo
{
  const m = montar(bundle, {
    "avispate.onboarding.v1": "1",
    "avispate.events.v1": JSON.stringify([EVENTO]),
    "recuerda.events.v1": JSON.stringify([
      { ...EVENTO, id: "r2", name: "Viejo" },
    ]),
  })
  await wait(120)
  const eventos = m.storage("avispate.events.v1") || []
  check(
    "C · si la clave nueva ya tenía datos, mandan los nuevos",
    eventos.length === 1 && eventos[0].name === "Renovar el registro",
    JSON.stringify(eventos),
  )
  check(
    "C · y la clave vieja se va igual (no queda duplicada)",
    m.raw("recuerda.events.v1") === null,
  )
}

// ---------------------------------------------------------------- D) la marca en pantalla
{
  const m = montar(bundle, alDia())
  await wait(150)
  await m.irAjustes()
  check(
    "D · el pie de Ajustes dice AVISPATE · V2.1 · Etapa 15",
    m.txt().includes("AVISPATE · V2.1 · Etapa 15"),
    JSON.stringify(m.txt().slice(-220)),
  )
  m.clickText("button", "Ver tips")
  await wait(120)
  check(
    "D · la sección de consejos también cambió de nombre",
    m.txt().includes("Tips de AVISPATE"),
    JSON.stringify(m.txt().slice(0, 160)),
  )
  check(
    "D · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

// ---------------------------------------------------------------- E) el aviso de inactividad
{
  const m = montar(bundle, alDia({ "avispate.ultimaVisita.v1": hace(8) }), {
    notificaciones: { permission: "granted" },
  })
  await wait(150)
  check(
    "E · la notificación del navegador sale con la marca nueva",
    m.sent.length === 1 &&
      m.sent[0].title.includes("AVISPATE") &&
      m.sent[0].title.includes("Avíspate"),
    JSON.stringify(m.sent),
  )
  check(
    "E · y el historial guarda los días sin abrir AVISPATE",
    JSON.stringify(m.storage("avispate.notifications.v1")?.[0] || {}).includes(
      "8 días sin abrir AVISPATE",
    ),
    JSON.stringify(m.storage("avispate.notifications.v1")?.slice(0, 1)),
  )
  check(
    "E · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | ").slice(0, 200),
  )
}

process.exit(finish() ? 1 : 0)
