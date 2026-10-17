// E2E de la Etapa 12: la copia que se combina, se deshace y se comparte.
//
// Lo que se prueba sin un teléfono de verdad: que «Sumar lo que falta» agregue solo lo que no está y no
// toque nada de lo que hay (ni el usuario activo, ni las preferencias, ni una categoría con el mismo
// nombre); que después de restaurar se pueda «Volver a como estaba», con las marcas de «ya avisado»
// incluidas; que Descargar y Compartir anoten cuándo salió la copia para decir «Último respaldo: hoy» y
// avisar a los 30 días; y que cancelar el menú del sistema no se confunda con un error.
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const pad = (n) => String(n).padStart(2, "0")
const dia = (n) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const haceDias = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

// Un recordatorio de cada lado: el mismo id en la copia no se duplica, el nuevo se suma.
const luz = {
  id: "e-luz",
  name: "Pagar la luz",
  date: dia(4),
  time: "09:00",
  category: "Cuentas",
  categoryEmoji: "💡",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels: ["Notificación"],
  ownerId: "yo",
}
const agua = {
  id: "e-agua",
  name: "Pagar el agua",
  date: dia(8),
  time: "10:30",
  category: "Cuentas",
  categoryEmoji: "💡",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels: ["Notificación"],
  ownerId: "yo",
}
const pasaporte = {
  id: "e-plan",
  name: "Renovar pasaporte",
  date: dia(21),
  time: "11:00",
  category: "Documentos",
  categoryEmoji: "📄",
  recurrence: "No se repite",
  remindersBefore: [7],
  channels: ["Notificación"],
  ownerId: "yo",
}
const yo = { id: "yo", name: "Yo", emoji: "🐝" }
const ana = { id: "ana", name: "Ana", emoji: "🌻" }
const luis = { id: "luis", name: "Luis", emoji: "🦊" }

const semilla = (extra = {}) => ({
  "avispate.onboarding.v1": "1",
  "avispate.events.v1": JSON.stringify([luz, agua]),
  "avispate.profiles.v1": JSON.stringify([yo, ana]),
  "avispate.categorias.v1": JSON.stringify([{ name: "Cuentas", emoji: "💡" }]),
  "avispate.activeProfile.v1": "yo",
  "avispate.reloj.v1": "24",
  "avispate.dark.v1": "0",
  ...extra,
})

// La copia que se sube: trae un recordatorio repetido y uno nuevo, un usuario nuevo, la misma
// categoría con otro emoji y otra nueva, y prefiere a Ana como usuaria activa. Al combinar, nada de
// eso último tiene que pisar lo que ya hay.
const copia = {
  app: "avispate",
  version: 1,
  creada: new Date().toISOString(),
  datos: {
    "avispate.events.v1": JSON.stringify([luz, pasaporte]),
    "avispate.profiles.v1": JSON.stringify([yo, luis]),
    "avispate.categorias.v1": JSON.stringify([
      { name: "Cuentas", emoji: "💰" },
      { name: "Salud", emoji: "🩺" },
    ]),
    "avispate.activeProfile.v1": "ana",
    "avispate.reloj.v1": "12",
    "avispate.dark.v1": "1",
  },
  adjuntos: {},
}

// Elegir un archivo: jsdom no abre el diálogo del sistema, así que se pone el File en el campo y se
// dispara el cambio, que es lo mismo que hace el navegador al elegirlo.
const subir = async (m, contenido, nombre = "avispate-2026-10-17.json") => {
  const file = new m.window.File([contenido], nombre, {
    type: "application/json",
  })
  const campo = m.doc.querySelector('input[type="file"]')
  Object.defineProperty(campo, "files", { value: [file], configurable: true })
  campo.dispatchEvent(new m.window.Event("change", { bubbles: true }))
  await wait(200)
}

// ------------------------------------------- A) Sin copia previa
// Con `descargas: true` el arnés intercepta la descarga: se puede leer el archivo sin tocar el disco.
const m = montar(bundle, semilla(), { descargas: true })
await wait(80)
await m.irAjustes()
await wait(120)
check(
  "A · sin respaldos, lo dice sin inventar una fecha",
  m.txt().includes("Todavía no descargaste ninguna copia."),
  m.txt().slice(-260),
)
check(
  "A · y no ofrece deshacer ni compartir donde el navegador no sabe",
  !m.find("button", "Volver a como estaba") &&
    !m.find("button", "Compartir copia"),
)

// ------------------------------------------- B) Descargar anota la última copia
m.click(m.find("button", "Descargar copia"))
await wait(250)
const ultima = m.storage("avispate.copia.ultima.v1")
check(
  "B · descargar deja el archivo de siempre",
  m.downloads.length === 1 &&
    /^avispate-\d{4}-\d{2}-\d{2}\.json$/.test(m.downloadNames[0]),
  m.downloadNames.join(", "),
)
check(
  "B · y anota cuándo salió, cuántos recordatorios traía y cuánto pesa",
  !!ultima &&
    typeof ultima.cuando === "string" &&
    ultima.recordatorios === 2 &&
    ultima.bytes > 0,
  JSON.stringify(ultima),
)
check(
  "B · Ajustes lo dice en palabras: «Último respaldo: hoy»",
  m.txt().includes("Último respaldo: hoy · 2 recordatorios"),
  m.txt().slice(-300),
)

// ------------------------------------------- C) La copia vieja avisa a los 30 días
const viejo = montar(
  bundle,
  semilla({
    "avispate.copia.ultima.v1": JSON.stringify({
      cuando: haceDias(45),
      bytes: 12_345,
      recordatorios: 3,
    }),
  }),
)
await wait(80)
await viejo.irAjustes()
await wait(120)
check(
  "C · una copia de hace mes y medio se cuenta como «hace un mes»",
  viejo.txt().includes("Último respaldo: hace un mes · 3 recordatorios"),
  viejo.txt().slice(-340),
)
check(
  "C · y Ajustes sugiere descargar otra, sin alarmar",
  viejo.txt().includes("Conviene descargar una copia nueva"),
)
check(
  "C · con una copia de hoy no aparece ese aviso",
  !m.txt().includes("Conviene descargar una copia nueva"),
)

// ------------------------------------------- D) Sumar lo que falta y deshacer
const combo = montar(
  bundle,
  semilla({ "avispate.sent.e-luz:1:2026-10-01": "1" }),
  { descargas: true },
)
await wait(80)
await combo.irAjustes()
await wait(120)
await subir(combo, JSON.stringify(copia))
check(
  "D · el aviso previo ya no dice que reemplaza, sino que hay dos maneras",
  combo.txt().includes("Sumar no borra nada") &&
    !!combo.find("button", "Sumar lo que falta"),
  combo.txt().slice(-300),
)
combo.click(combo.find("button", "Sumar lo que falta"))
await wait(300)
const eventosCombo = combo.events()
const perfilesCombo = combo.storage("avispate.profiles.v1")
const categoriasCombo = combo.storage("avispate.categorias.v1")
check(
  "D · suma los recordatorios que faltaban y no repite el que ya estaba",
  eventosCombo.length === 3 &&
    eventosCombo.map((e) => e.name).join("|") ===
      "Pagar la luz|Pagar el agua|Renovar pasaporte",
  eventosCombo.map((e) => e.name).join(", "),
)
check(
  "D · suma el usuario nuevo y deja los dos que había",
  perfilesCombo.length === 3 &&
    perfilesCombo.map((p) => p.id).join("|") === "yo|ana|luis",
  JSON.stringify(perfilesCombo.map((p) => p.id)),
)
check(
  "D · la categoría repetida no se pisa: sigue con su emoji de siempre",
  categoriasCombo.length === 2 &&
    categoriasCombo[0].name === "Cuentas" &&
    categoriasCombo[0].emoji === "💡" &&
    categoriasCombo[1].name === "Salud",
  JSON.stringify(categoriasCombo),
)
check(
  "D · el usuario activo, el reloj y el modo oscuro de este teléfono no cambian",
  combo.raw("avispate.activeProfile.v1") === "yo" &&
    combo.raw("avispate.reloj.v1") === "24" &&
    combo.raw("avispate.dark.v1") === "0",
  [
    combo.raw("avispate.activeProfile.v1"),
    combo.raw("avispate.reloj.v1"),
    combo.raw("avispate.dark.v1"),
  ].join(" · "),
)
check(
  "D · y las marcas de «ya avisado» siguen ahí",
  combo.raw("avispate.sent.e-luz:1:2026-10-01") === "1",
)
check(
  "D · Ajustes cuenta lo que sumó y promete que nada se tocó",
  combo
    .txt()
    .includes(
      "Copia combinada: se sumaron 1 recordatorio, 1 usuario, 1 categoría y 0 adjuntos. Lo que ya tenías quedó igual.",
    ),
  combo.txt().slice(-360),
)
check(
  "D · después de combinar se ofrece «Volver a como estaba»",
  !!combo.find("button", "Volver a como estaba") &&
    !!combo.storage("avispate.copia.deshacer.v1"),
)
combo.click(combo.find("button", "Volver a como estaba"))
await wait(250)
check(
  "D · deshacer devuelve todo a como estaba antes de combinar",
  combo.events().length === 2 &&
    combo.storage("avispate.profiles.v1").length === 2 &&
    combo.storage("avispate.categorias.v1").length === 1 &&
    combo.raw("avispate.activeProfile.v1") === "yo" &&
    combo.raw("avispate.sent.e-luz:1:2026-10-01") === "1",
  JSON.stringify({
    eventos: combo.events().length,
    perfiles: combo.storage("avispate.profiles.v1").length,
    categorias: combo.storage("avispate.categorias.v1").length,
  }),
)
check(
  "D · y lo dice, y el botón desaparece porque ya no hay nada que deshacer",
  combo.txt().includes("Listo: volviste a como estaba antes de restaurar.") &&
    !combo.find("button", "Volver a como estaba") &&
    !combo.raw("avispate.copia.deshacer.v1"),
)

// ------------------------------------------- E) Reemplazar todo y volver atrás
const reemplazo = montar(
  bundle,
  semilla({ "avispate.sent.e-luz:1:2026-10-01": "1" }),
  { descargas: true },
)
await wait(80)
await reemplazo.irAjustes()
await wait(120)
await subir(reemplazo, JSON.stringify(copia))
reemplazo.click(reemplazo.find("button", "Sí, reemplazar todo"))
await wait(300)
check(
  "E · reemplazar deja solo lo del archivo, preferencias incluidas",
  reemplazo.events().length === 2 &&
    reemplazo.storage("avispate.profiles.v1").length === 2 &&
    reemplazo.storage("avispate.categorias.v1").length === 2 &&
    reemplazo.raw("avispate.activeProfile.v1") === "ana" &&
    reemplazo.raw("avispate.reloj.v1") === "12" &&
    reemplazo.raw("avispate.dark.v1") === "1",
  JSON.stringify({
    eventos: reemplazo.events().map((e) => e.name),
    activo: reemplazo.raw("avispate.activeProfile.v1"),
  }),
)
check(
  "E · como siempre, borra las marcas de «ya avisado»",
  reemplazo.raw("avispate.sent.e-luz:1:2026-10-01") === null,
)
check(
  "E · Ajustes confirma y guarda el estado anterior para deshacer",
  reemplazo
    .txt()
    .includes("Copia restaurada: 2 recordatorios, 2 usuarios y 0 adjuntos.") &&
    !!reemplazo.storage("avispate.copia.deshacer.v1"),
  reemplazo.txt().slice(-300),
)
reemplazo.click(reemplazo.find("button", "Volver a como estaba"))
await wait(250)
check(
  "E · deshacer devuelve recordatorios, usuarios, categorías y usuario activo",
  reemplazo.events().length === 2 &&
    reemplazo.events()[0].name === "Pagar la luz" &&
    reemplazo.events()[1].name === "Pagar el agua" &&
    reemplazo
      .storage("avispate.profiles.v1")
      .map((p) => p.id)
      .join("|") === "yo|ana" &&
    reemplazo.storage("avispate.categorias.v1")[0].emoji === "💡" &&
    reemplazo.raw("avispate.activeProfile.v1") === "yo",
  JSON.stringify(reemplazo.events().map((e) => e.name)),
)
check(
  "E · y también el reloj, el modo oscuro y las marcas que el reemplazo había borrado",
  reemplazo.raw("avispate.reloj.v1") === "24" &&
    reemplazo.raw("avispate.dark.v1") === "0" &&
    reemplazo.raw("avispate.sent.e-luz:1:2026-10-01") === "1",
)
check(
  "E · el botón se va y no queda un deshacer viejo guardado",
  !reemplazo.find("button", "Volver a como estaba") &&
    !reemplazo.raw("avispate.copia.deshacer.v1"),
)

// ------------------------------------------- F) Compartir por el menú del teléfono
const comparte = montar(bundle, semilla(), { compartir: {} })
await wait(80)
await comparte.irAjustes()
await wait(120)
check(
  "F · donde el navegador sabe compartir archivos, el botón está",
  !!comparte.find("button", "Compartir copia"),
)
comparte.click(comparte.find("button", "Compartir copia"))
await wait(250)
const enviado = comparte.shared[0]
check(
  "F · comparte un .json con el nombre de siempre",
  comparte.shared.length === 1 &&
    enviado.files?.length === 1 &&
    /^avispate-\d{4}-\d{2}-\d{2}\.json$/.test(enviado.files[0].name) &&
    enviado.files[0].size > 0,
  JSON.stringify({
    veces: comparte.shared.length,
    nombre: enviado?.files?.[0]?.name,
  }),
)
check(
  "F · y lo anota como último respaldo, igual que la descarga",
  comparte.txt().includes("Copia compartida.") &&
    comparte.txt().includes("Último respaldo: hoy") &&
    comparte.storage("avispate.copia.ultima.v1")?.recordatorios === 2,
  comparte.txt().slice(-300),
)

// ------------------------------------------- G) Cancelar no es un error
const cancelado = montar(bundle, semilla(), { compartir: { cancelar: true } })
await wait(80)
await cancelado.irAjustes()
await wait(120)
cancelado.click(cancelado.find("button", "Compartir copia"))
await wait(250)
check(
  "G · cerrar el menú del sistema se dice sin alarma y no anota la copia",
  cancelado.txt().includes("No se compartió la copia.") &&
    cancelado.shared.length === 0 &&
    !cancelado.raw("avispate.copia.ultima.v1"),
  cancelado.txt().slice(-260),
)
check(
  "G · los errores de la app, cero",
  [m, viejo, combo, reemplazo, comparte, cancelado].every(
    (x) => x.errors.length === 0,
  ),
  [m, viejo, combo, reemplazo, comparte, cancelado]
    .flatMap((x) => x.errors)
    .join(" | ")
    .slice(0, 240),
)
check(
  "G · el pie de Ajustes ya es el de esta entrega",
  m.txt().includes("AVISPATE · V1.9 · Etapa 13"),
  m.txt().slice(-60),
)

process.exit(finish() ? 1 : 0)
