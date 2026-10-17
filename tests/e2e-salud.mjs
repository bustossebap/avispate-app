// E2E de la Etapa 11-A y 11-C: posponer desde la notificación y la salud de la cola.
//
// Lo que se puede probar sin un teléfono ni un Supabase de verdad: que Ajustes cuente la cola local, que
// diga en qué estado está la nube y que el último intento se anote (aunque falle); y que lo compilado
// —el bundle, el service worker, la migración y la Edge Function— traiga las piezas del «Posponer».
import fs from "node:fs"
import path from "node:path"
import { BASE, cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const pad = (n) => String(n).padStart(2, "0")
const dia = (n) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Dos recordatorios futuros: la cola queda con un aviso por cada uno (el de un día antes).
const recordatorios = [
  {
    id: "e-arriendo",
    name: "Pagar el arriendo",
    date: dia(6),
    time: "09:00",
    category: "Cuentas",
    categoryEmoji: "💡",
    recurrence: "No se repite",
    remindersBefore: [1],
    channels: ["Notificación"],
    ownerId: "yo",
  },
  {
    id: "e-control",
    name: "Control del perro",
    date: dia(12),
    time: "16:30",
    category: "Mascotas",
    categoryEmoji: "🐶",
    recurrence: "No se repite",
    remindersBefore: [1],
    channels: ["Notificación"],
    ownerId: "yo",
  },
]

const semilla = (extra = {}) => ({
  "avispate.onboarding.v1": "1",
  "avispate.events.v1": JSON.stringify(recordatorios),
  "avispate.profiles.v1": JSON.stringify([
    { id: "yo", name: "Yo", emoji: "🐝", channels: { push: true } },
  ]),
  ...extra,
})

const m = montar(bundle, semilla())
await wait(80)
const cola = m.storage("avispate.cola.v1") || []

// El texto de un <dd> por el nombre de su <dt>: así se mira la fila que se quiere, no todo el bloque.
const valorDe = (etiqueta) => {
  const dt = [...m.doc.querySelectorAll("dt")].find(
    (d) => (d.textContent || "").trim() === etiqueta,
  )
  return (dt?.nextElementSibling?.textContent || "").trim()
}

await m.irAjustes()
await wait(120)
const texto = m.txt()

// ------------------------------------------- A) La tarjeta existe y cuenta lo local
check(
  "A · Ajustes trae la tarjeta «Salud de la cola»",
  texto.includes("Salud de la cola"),
  texto.slice(
    texto.indexOf("Salud de la cola"),
    texto.indexOf("Salud de la cola") + 160,
  ),
)
check(
  "A · cuenta los avisos que este teléfono calculó y guardó",
  cola.length === 2 &&
    texto.includes(`${cola.length} avisos programados en este teléfono`),
  `${cola.length} en la cola · ${texto.includes("avisos programados")}`,
)
check(
  "A · el próximo aviso se muestra con fecha y hora, no como un guion",
  /\d/.test(valorDe("Próximo aviso")) && valorDe("Próximo aviso").includes(":"),
  valorDe("Próximo aviso"),
)
check(
  "A · sin suscripción lo dice en vez de inventar números de la nube",
  valorDe("En la nube") === "sin suscripción en este dispositivo",
  valorDe("En la nube"),
)
check(
  "A · y todavía no hay una subida que mostrar",
  valorDe("Última subida") === "todavía no se subió",
  valorDe("Última subida"),
)

// ------------------------------------------- B) «Revisar ahora» y el último intento
check(
  "B · el botón para revisar está a mano",
  !!m.find("button", "Revisar ahora"),
)
m.pressText("button", "Revisar ahora")
await wait(140)
const subida = m.storage("avispate.cola.subida.v1")
check(
  "B · el intento queda anotado en el teléfono (aunque no haya red)",
  !!subida && subida.ok === false && typeof subida.cuando === "string",
  JSON.stringify(subida),
)
check(
  "B · y dice por qué no llegó, sin mostrar el código interno",
  !!subida &&
    subida.error === "sin-red" &&
    m.txt().includes("Sin conexión: este navegador no puede llegar a la nube."),
  m.txt().slice(-220),
)
check(
  "B · la tarjeta muestra cuántos avisos se intentaron subir",
  !!subida && m.txt().includes(`${subida.cantidad} avisos`),
  JSON.stringify(subida),
)

// ------------------------------------------- C) Una subida anterior, ya registrada
const anterior = montar(
  bundle,
  semilla({
    "avispate.cola.subida.v1": JSON.stringify({
      cuando: new Date(Date.now() - 3 * 60e3).toISOString(),
      ok: true,
      cantidad: 2,
    }),
  }),
)
await wait(80)
await anterior.irAjustes()
await wait(120)
const textoAnterior = anterior.txt()
check(
  "C · con una subida previa, se ve hace cuánto fue y cuántos avisos",
  textoAnterior.includes("hace 3 min · 2 avisos"),
  textoAnterior.slice(
    textoAnterior.indexOf("Última subida"),
    textoAnterior.indexOf("Última subida") + 120,
  ),
)
check(
  "C · y si el intento salió bien no aparece la alarma roja",
  !textoAnterior.includes("El último intento no llegó"),
)
check(
  "C · los errores de la app, cero",
  m.errors.length === 0 && anterior.errors.length === 0,
  [...m.errors, ...anterior.errors].join(" | ").slice(0, 200),
)

// ------------------------------------------- D) El service worker trae «Posponer»
const sw = fs.readFileSync(path.join(BASE, "dist/sw.js"), "utf8")
check(
  "D · la notificación ofrece posponer 10 minutos y 1 hora",
  sw.includes("posponer-10") &&
    sw.includes("posponer-60") &&
    sw.includes("Posponer 10 min") &&
    sw.includes("Posponer 1 hora"),
)
check(
  "D · el service worker llama a la función de la nube cuando se toca el botón",
  sw.includes("/rest/v1/rpc/posponer_aviso") && sw.includes("p_aviso_id"),
)
check(
  "D · guarda y lee las credenciales del dispositivo en IndexedDB",
  sw.includes("indexedDB") &&
    sw.includes("CREDENCIALES") &&
    sw.includes("leerClaves"),
)
check(
  "D · la URL y la clave de la nube llegan inyectadas, sin marcadores sueltos",
  sw.includes("https://") &&
    !sw.includes("__NUBE_URL__") &&
    !sw.includes("__NUBE_CLAVE__") &&
    !sw.includes("__SELLO__"),
)
check(
  "D · si no se pudo posponer, abre la app en vez de dejar el toque sin respuesta",
  sw.includes("await abrirLaApp(datos.url)"),
)

// ------------------------------------------- E) Lo demás que tiene que estar
check(
  "E · el bundle sabe pedir el resumen de la cola y anotar el último intento",
  bundle.includes("resumen_cola") && bundle.includes("avispate.cola.subida.v1"),
)
const migracion = fs.readFileSync(
  path.join(BASE, "supabase/migrations/0002_etapa11.sql"),
  "utf8",
)
check(
  "E · la migración agrega la marca de pospuesto, posponer_aviso y resumen_cola",
  migracion.includes("pospuesto_en") &&
    migracion.includes("posponer_aviso") &&
    migracion.includes("resumen_cola"),
)
check(
  "E · y la sincronización respeta lo pospuesto al borrar",
  migracion.includes("and a.pospuesto_en is null"),
)
const funcion = fs.readFileSync(
  path.join(BASE, "supabase/functions/enviar-avisos/index.ts"),
  "utf8",
)
check(
  "E · el push lleva el id del aviso para que la notificación sepa qué posponer",
  funcion.includes("aviso: fila.id"),
)
check(
  "E · el pie de Ajustes ya es el de esta entrega",
  texto.includes("AVISPATE · V2.1 · Etapa 15"),
  texto.slice(-60),
)

process.exit(finish() ? 1 : 0)
