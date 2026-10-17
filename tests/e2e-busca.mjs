// E2E de la Etapa 11-B: la búsqueda de Inicio.
//
// Se prueba lo que de verdad usa una persona: abrir la lupa, escribir (con tildes o sin ellas, en
// mayúsculas, dos palabras en cualquier orden) y ver que la lista se achica; y que lo que no está se
// dice con la abeja en vez de dejar la pantalla vacía. También que la búsqueda respeta la categoría
// elegida y que no deja el conmutador Vigentes/Vencidos a la vista.
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

// Cuatro recordatorios con nombres, notas y categorías distintas: alcanza para probar cada campo por
// separado (notas: «Registro Civil»; categoría: «Documentos»; tildes: «jardín» y «Año»).
const base = (id, name, category, categoryEmoji, date, notes) => ({
  id,
  name,
  date,
  time: "09:30",
  category,
  categoryEmoji,
  recurrence: "No se repite",
  remindersBefore: [1],
  channels: ["Notificación"],
  ownerId: "yo",
  ...(notes ? { notes } : {}),
})

const recordatorios = [
  base(
    "e-pasaporte",
    "Renovar pasaporte",
    "Documentos",
    "📄",
    dia(20),
    "Ir al Registro Civil con la foto",
  ),
  base("e-jardin", "Podar el jardín", "Hogar", "🏠", dia(10)),
  base(
    "e-ano",
    "Año nuevo",
    "Familia",
    "🎉",
    dia(60),
    "Reservar la casa de la playa",
  ),
  base(
    "e-luz",
    "Pagar la luz de marzo",
    "Cuentas",
    "💡",
    dia(5),
    "Vence el 15",
  ),
]

const semilla = {
  "avispate.onboarding.v1": "1",
  "avispate.events.v1": JSON.stringify(recordatorios),
  "avispate.profiles.v1": JSON.stringify([
    { id: "yo", name: "Yo", emoji: "🐝", channels: { push: true } },
  ]),
}

const m = montar(bundle, semilla)
await wait(80)

const campo = () => m.byLabel("Buscar recordatorios")
const tarjetas = () => [
  ...m.doc.querySelectorAll('#root button[class*="items-stretch"]'),
]
const nombres = () => tarjetas().map((b) => (b.textContent || "").trim())
const cuantas = () => tarjetas().length
const abrir = async () => {
  m.press(m.byLabel("Buscar"))
  await wait(60)
}
const escribir = async (texto) => {
  const el = campo()
  if (!el) return false
  m.type(el, texto)
  await wait(60)
  return true
}
const limpiar = async () => {
  m.press(m.byLabel("Limpiar búsqueda"))
  await wait(60)
}

// ------------------------------------------- A) La lupa abre el campo
check("A · Inicio arranca sin el campo de búsqueda", !campo())
await abrir()
check(
  "A · la lupa abre un campo con su etiqueta y una pista de qué busca",
  !!campo() && campo().placeholder === "Nombre, nota o categoría",
  campo()?.placeholder,
)
check(
  "A · arriba de todo, la lista sigue completa",
  cuantas() === 4,
  String(cuantas()),
)
check(
  "A · con el campo abierto pero vacío no se filtró nada (el conmutador sigue)",
  m.txt().includes("Vencidos"),
)

// ------------------------------------------- B) El nombre, sin exigir tildes ni mayúsculas
await escribir("jardin")
check(
  "B · «jardin» encuentra «Podar el jardín» (sin tilde y en minúsculas)",
  cuantas() === 1 && nombres()[0].includes("Podar el jardín"),
  nombres().join(" | "),
)
check(
  "B · con texto escrito, el conmutador Vigentes/Vencidos se esconde",
  !m.txt().includes("Vencidos"),
  m.txt().slice(0, 140),
)
await escribir("JARDÍN")
check(
  "B · «JARDÍN» encuentra lo mismo (mayúsculas y tilde no importan)",
  cuantas() === 1 && nombres()[0].includes("Podar el jardín"),
  nombres().join(" | "),
)
await escribir("ano")
check(
  "B · «ano» encuentra «Año nuevo» (la ñ se compara como n + tilde)",
  cuantas() === 1 && nombres()[0].includes("Año nuevo"),
  nombres().join(" | "),
)
await escribir("PASAPORTE")
check(
  "B · el nombre se busca por dentro, no solo por el principio",
  cuantas() === 1 && nombres()[0].includes("Renovar pasaporte"),
  nombres().join(" | "),
)

// ------------------------------------------- C) Notas, categoría y varias palabras
await escribir("registro civil")
check(
  "C · las notas también cuentan («Registro Civil» está en una nota)",
  cuantas() === 1 && nombres()[0].includes("Renovar pasaporte"),
  nombres().join(" | "),
)
await escribir("documentos")
check(
  "C · la categoría se puede escribir como una palabra más",
  cuantas() === 1 && nombres()[0].includes("Renovar pasaporte"),
  nombres().join(" | "),
)
await escribir("luz marzo")
check(
  "C · con dos palabras tienen que aparecer las dos («luz marzo»)",
  cuantas() === 1 && nombres()[0].includes("Pagar la luz de marzo"),
  nombres().join(" | "),
)
await escribir("marzo luz")
check(
  "C · y da igual el orden («marzo luz»)",
  cuantas() === 1 && nombres()[0].includes("Pagar la luz de marzo"),
  nombres().join(" | "),
)
await escribir("luz pasaporte")
check(
  "C · dos palabras de recordatorios distintos no mezclan resultados",
  cuantas() === 0,
  nombres().join(" | "),
)

// ------------------------------------------- D) Nada encontrado
await escribir("zzz")
check(
  "D · sin resultados aparece la abeja y el aviso, no una pantalla vacía",
  m.txt().includes("Nada por acá") && m.txt().includes("🐝") && cuantas() === 0,
  m.txt().slice(0, 160),
)
check(
  "D · y se ofrece limpiar la búsqueda",
  !!m.find("button", "Limpiar búsqueda"),
)
m.pressText("button", "Limpiar búsqueda")
await wait(60)
check(
  "D · «Limpiar búsqueda» cierra el campo y devuelve la lista entera",
  !campo() && cuantas() === 4,
  `${cuantas()} tarjetas`,
)
check(
  "D · al cerrar, el conmutador Vigentes/Vencidos vuelve",
  m.txt().includes("Vigentes") && m.txt().includes("Vencidos"),
)

// ------------------------------------------- E) Respeta la categoría elegida
await m.clickText("button", "Hogar")
await wait(60)
check(
  "E · al elegir Hogar queda un solo recordatorio",
  cuantas() === 1,
  String(cuantas()),
)
await abrir()
await escribir("luz")
check(
  "E · buscar dentro de Hogar no trae lo de otras categorías",
  cuantas() === 0 && m.txt().includes("Nada por acá"),
  nombres().join(" | "),
)
await limpiar()
check(
  "E · al limpiar vuelve el filtro de Hogar, no «Todas»",
  cuantas() === 1 && nombres()[0].includes("Podar el jardín"),
  nombres().join(" | "),
)
await m.clickText("button", "Todas")
await wait(60)

// ------------------------------------------- F) Escape y limpieza al cambiar de pestaña
await abrir()
await escribir("luz")
check("F · con texto, queda solo lo que coincide", cuantas() === 1)
const input = campo()
input.dispatchEvent(
  new m.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
)
await wait(60)
check("F · Escape cierra la búsqueda", !campo() && cuantas() === 4)

await abrir()
await escribir("luz")
await m.clickText("button", "Calendario")
await wait(60)
await m.clickText("button", "Inicio")
await wait(60)
check(
  "F · al volver a Inicio la búsqueda no quedó puesta (no hay filtros invisibles)",
  !campo() && cuantas() === 4,
  `${cuantas()} tarjetas`,
)

// ------------------------------------------- G) Sin errores
check(
  "G · sin errores de ejecución",
  m.errors.length === 0,
  m.errors.join(" | ").slice(0, 200),
)
check(
  "G · el bundle trae la búsqueda y la frase de «sin resultados»",
  bundle.includes("Nada por acá") && bundle.includes("Buscar recordatorios"),
)

process.exit(finish() ? 1 : 0)
