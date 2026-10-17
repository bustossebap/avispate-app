// E2E de la Etapa 9 (copia de seguridad): Ajustes › Datos descarga un .json con los recordatorios,
// usuarios, categorías y preferencias, y lo devuelve después de mostrar qué trae. El archivo se lee
// tal cual —es JSON—, así que las comprobaciones miran el contenido real y no solo la pantalla.
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const recordatorios = [
  {
    id: "e1",
    name: "Pagar la luz",
    date: "2026-11-02",
    time: "09:00",
    category: "Hogar",
    categoryEmoji: "🏠",
    recurrence: "No se repite",
    remindersBefore: [7],
    channels: ["Notificación"],
    ownerId: "yo",
  },
]
const usuarios = [
  { id: "yo", name: "Yo", emoji: "🐝" },
  { id: "p-2", name: "Ana", emoji: "🌻" },
]
const categorias = [
  { name: "Hogar", emoji: "🏠" },
  { name: "Salud", emoji: "💊" },
]
// Una marca de «ya avisado» y la última visita: son del momento, no del respaldo, así que no viajan.
const marcaEnviada = "avispate.sent.e1:7:2026-10-26"

const m = montar(
  bundle,
  {
    "avispate.onboarding.v1": "1",
    "avispate.events.v1": JSON.stringify(recordatorios),
    "avispate.profiles.v1": JSON.stringify(usuarios),
    "avispate.categorias.v1": JSON.stringify(categorias),
    "avispate.activeProfile.v1": "yo",
    "avispate.ultimaVisita.v1": "2026-10-01T12:00:00.000Z",
    [marcaEnviada]: "1",
  },
  { descargas: true },
)
const { doc, txt, storage, errors } = m
const find = (text) => m.find("button", text)

await wait(150)
await m.irAjustes()

check(
  "C · Ajustes › Datos tiene la copia de seguridad con sus dos botones",
  txt().includes("Copia de seguridad") &&
    !!find("Descargar copia") &&
    !!find("Restaurar desde archivo"),
  JSON.stringify(txt().slice(-260)),
)

// ---------------------------------------------------------------- A) descargar
m.click(find("Descargar copia"))
await wait(200)

const texto = await m.download(0)
check(
  "C · la copia se descarga como un solo archivo",
  !!texto && m.downloads.length === 1,
  `${m.downloads.length} descarga(s)`,
)
check(
  "C · el nombre lleva la fecha (avispate-AAAA-MM-DD.json)",
  /^avispate-\d{4}-\d{2}-\d{2}\.json$/.test(m.downloadNames[0] || ""),
  m.downloadNames[0],
)

let copia = null
try {
  copia = JSON.parse(texto)
} catch {}
check(
  "C · la copia dice que es de AVISPATE, versión 1 y con fecha",
  copia?.app === "avispate" &&
    copia?.version === 1 &&
    typeof copia?.creada === "string" &&
    !Number.isNaN(Date.parse(copia?.creada || "")),
  String(texto).slice(0, 120),
)
check(
  "C · trae los recordatorios, los usuarios y las categorías",
  copia?.datos?.["avispate.events.v1"]?.includes("Pagar la luz") &&
    copia?.datos?.["avispate.profiles.v1"]?.includes("Ana") &&
    copia?.datos?.["avispate.categorias.v1"]?.includes("Salud"),
  JSON.stringify(Object.keys(copia?.datos || {})),
)
check(
  "C · también las preferencias (reloj, modo oscuro, introducción y usuario activo)",
  [
    "avispate.reloj.v1",
    "avispate.dark.v1",
    "avispate.onboarding.v1",
    "avispate.activeProfile.v1",
  ].every((clave) => copia?.datos?.[clave] !== undefined),
  JSON.stringify(Object.keys(copia?.datos || {})),
)
check(
  "C · no viajan las marcas de «ya avisado» ni la última visita",
  copia?.datos?.[marcaEnviada] === undefined &&
    copia?.datos?.["avispate.ultimaVisita.v1"] === undefined,
  JSON.stringify(Object.keys(copia?.datos || {})),
)
check(
  "C · sin adjuntos guardados, la lista de adjuntos va vacía",
  !!copia?.adjuntos && Object.keys(copia.adjuntos).length === 0,
)
check(
  "C · y Ajustes avisa qué se descargó",
  txt().includes("Copia descargada: 1 recordatorio y 0 adjuntos"),
  JSON.stringify(txt().slice(-200)),
)

// ---------------------------------------------------------------- B) restaurar
const campo = doc.querySelector('input[type="file"]')
check(
  "C · el selector de archivo acepta .json y está identificado",
  campo?.getAttribute("accept")?.includes(".json") &&
    campo?.getAttribute("aria-label") === "Archivo de copia de seguridad",
  campo?.outerHTML.slice(0, 140),
)

const nueva = {
  app: "avispate",
  version: 1,
  creada: "2026-10-17T12:00:00.000Z",
  datos: {
    "avispate.events.v1": JSON.stringify([
      {
        id: "n1",
        name: "Renovar pasaporte",
        date: "2027-01-15",
        time: "12:00",
        category: "Documentos",
        categoryEmoji: "📄",
        recurrence: "Cada 10 años",
        remindersBefore: [30],
        channels: ["Notificación"],
        ownerId: "yo",
      },
    ]),
    "avispate.profiles.v1": JSON.stringify(usuarios),
    "avispate.categorias.v1": JSON.stringify([
      { name: "Documentos", emoji: "📄" },
    ]),
    "avispate.onboarding.v1": "1",
    "avispate.activeProfile.v1": "yo",
    "avispate.reloj.v1": "24",
    "avispate.dark.v1": "0",
  },
  adjuntos: {},
}

// Elegir un archivo: jsdom no deja abrir el diálogo del sistema, así que se pone el File en el campo
// y se dispara el cambio, que es lo mismo que hace el navegador al elegirlo. El campo se busca en
// cada subida porque la pantalla lo vuelve a montar al entrar y salir de Ajustes.
const subir = async (contenido, nombre = "avispate-2026-10-17.json") => {
  const file = new m.window.File([contenido], nombre, {
    type: "application/json",
  })
  const campo = doc.querySelector('input[type="file"]')
  Object.defineProperty(campo, "files", {
    value: [file],
    configurable: true,
  })
  campo.dispatchEvent(new m.window.Event("change", { bubbles: true }))
  await wait(200)
}

await subir(JSON.stringify(nueva))
check(
  "C · antes de reemplazar, muestra qué trae el archivo",
  txt().includes("trae 1 recordatorio, 2 usuarios, 1 categoría y 0 adjuntos") &&
    txt().includes("Se reemplaza lo que hay guardado ahora"),
  JSON.stringify(txt().slice(-320)),
)
check(
  "C · y todavía no tocó nada",
  storage("avispate.events.v1")?.[0]?.name === "Pagar la luz",
  JSON.stringify(storage("avispate.events.v1")),
)

m.click(find("Cancelar"))
await wait(80)
check(
  "C · cancelar deja todo como estaba",
  !txt().includes("Se reemplaza lo que hay guardado ahora") &&
    storage("avispate.events.v1")?.[0]?.name === "Pagar la luz",
)

await subir(JSON.stringify(nueva))
m.click(find("Sí, restaurar"))
await wait(250)
check(
  "C · restaurar reemplaza los recordatorios",
  storage("avispate.events.v1")?.length === 1 &&
    storage("avispate.events.v1")[0].name === "Renovar pasaporte",
  JSON.stringify(storage("avispate.events.v1")),
)
check(
  "C · y también usuarios, categorías y usuario activo",
  storage("avispate.profiles.v1")?.length === 2 &&
    storage("avispate.profiles.v1")[1].name === "Ana" &&
    storage("avispate.categorias.v1")?.[0]?.name === "Documentos" &&
    m.raw("avispate.activeProfile.v1") === "yo",
  JSON.stringify({
    perfiles: storage("avispate.profiles.v1"),
    categorias: storage("avispate.categorias.v1"),
    activo: m.raw("avispate.activeProfile.v1"),
  }),
)
check(
  "C · las marcas de «ya avisado» se borran, así lo restaurado puede volver a avisar",
  m.raw(marcaEnviada) === null,
  m.raw(marcaEnviada),
)
check(
  "C · Ajustes confirma la restauración",
  txt().includes("Copia restaurada: 1 recordatorio, 2 usuarios y 0 adjuntos"),
  JSON.stringify(txt().slice(-200)),
)

m.clickText("button", "Inicio")
await wait(150)
check(
  "C · el inicio muestra lo restaurado sin recargar la página",
  txt().includes("Renovar pasaporte") && !txt().includes("Pagar la luz"),
  JSON.stringify(txt().slice(0, 200)),
)
await m.irAjustes()

// ---------------------------------------------------------------- C) archivos que no sirven
await subir("{ esto no es json")
check(
  "C · un archivo que no es JSON se rechaza con un mensaje claro",
  txt().includes("no es una copia de AVISPATE") &&
    txt().includes("no se pudo leer"),
  JSON.stringify(txt().slice(-200)),
)

await subir(JSON.stringify({ app: "avispate", version: 99, datos: {} }))
check(
  "C · una copia de una versión más nueva se rechaza y dice cuál",
  txt().includes("versión más nueva de AVISPATE (99)"),
  JSON.stringify(txt().slice(-200)),
)

await subir("   ")
check(
  "C · un archivo vacío se rechaza",
  txt().includes("El archivo está vacío."),
  JSON.stringify(txt().slice(-200)),
)
check(
  "C · y después de los rechazos los datos siguen siendo los restaurados",
  storage("avispate.events.v1")?.[0]?.name === "Renovar pasaporte",
  JSON.stringify(storage("avispate.events.v1")),
)

check(
  "C · sin errores de ejecución",
  errors.length === 0,
  errors.join(" | ").slice(0, 200),
)

process.exit(finish() ? 1 : 0)
