// E2E de la Etapa 10 (avisos con la app cerrada): la cola que el teléfono calcula y guarda.
//
// No se prueba la nube —eso necesita un proyecto de Supabase de verdad— sino la mitad que decide qué
// se manda: para cada recordatorio, qué instantes concretos hay que avisar. Se miran las fechas reales
// que quedan en `avispate.cola.v1`, que es exactamente lo que la app sube cuando hay suscripción.
import fs from "node:fs"
import path from "node:path"
import { BASE, cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

// Fechas armadas a partir de hoy para que la suite no caduque: todo se calcula en hora local, como la
// app. `dia(n)` devuelve el "YYYY-MM-DD" de dentro de n días.
const pad = (n) => String(n).padStart(2, "0")
const ymd = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const dia = (n) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
const instante = (fecha, hora) => new Date(`${fecha}T${hora}:00`).getTime()
const horaLocal = (iso) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fechaLocal = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Un recordatorio que se viene: tres avisos configurados, pero el de 30 días ya pasó (el recordatorio
// es a 20 días), así que solo deben quedar dos. Es el caso que más se rompe al programar de más.
const futuro = {
  id: "e-futuro",
  name: "Renovar pasaporte",
  date: dia(20),
  time: "09:30",
  category: "Documentos",
  categoryEmoji: "📄",
  recurrence: "No se repite",
  remindersBefore: [30, 7, 1],
  channels: ["Notificación"],
  ownerId: "yo",
}
// Repetición por horas: 45 días de cola dan 135 ocurrencias; el tope por recordatorio es 120.
const horaria = {
  id: "e-horas",
  name: "Tomar agua",
  date: dia(0),
  time: "08:00",
  category: "Personal",
  categoryEmoji: "❤️",
  recurrence: "Cada 8 horas",
  remindersBefore: [],
  customReminders: [{ id: "c1", amount: 1, unit: "horas" }],
  channels: ["Notificación"],
  ownerId: "yo",
}
// Repetición semanal con un aviso un día antes: siete ocurrencias dentro de la ventana (2, 9, 16, 23,
// 30, 37 y 44 días), la de 51 queda afuera.
const semanal = {
  id: "e-semanal",
  name: "Regar las plantas",
  date: dia(2),
  time: "18:00",
  category: "Hogar",
  categoryEmoji: "🏠",
  recurrence: "Cada semana",
  remindersBefore: [1],
  channels: ["Notificación"],
  ownerId: "yo",
}
// «7 días» del selector y «1 semana» escrito a mano son el mismo momento: un solo aviso, no dos.
const doble = {
  id: "e-doble",
  name: "Cambiar el filtro",
  date: dia(10),
  time: "10:00",
  category: "Auto",
  categoryEmoji: "🚗",
  recurrence: "No se repite",
  remindersBefore: [7],
  customReminders: [{ id: "d1", amount: 1, unit: "semanas" }],
  channels: ["Notificación"],
  ownerId: "yo",
}
// Un aviso que cae dentro de un rato, para comprobar que el instante se calcula al minuto y que el
// texto dice cuánto falta. La fecha y la hora salen del propio instante para que no cruce medianoche.
const prontoEn = new Date(Date.now() + 3 * 3600e3)
const pronto = {
  id: "e-pronto",
  name: "Llamar al dentista",
  date: ymd(prontoEn),
  time: hm(prontoEn),
  category: "Personal",
  categoryEmoji: "❤️",
  recurrence: "No se repite",
  remindersBefore: [],
  customReminders: [{ id: "p1", amount: 2, unit: "horas" }],
  channels: ["Notificación"],
  ownerId: "yo",
}
const completado = {
  ...futuro,
  id: "e-completado",
  name: "Ya está hecho",
  completed: true,
}
const pasado = {
  ...futuro,
  id: "e-pasado",
  name: "Venció la semana pasada",
  date: dia(-5),
  remindersBefore: [1],
}

const recordatorios = [
  futuro,
  horaria,
  semanal,
  doble,
  pronto,
  completado,
  pasado,
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
const cola = m.storage("avispate.cola.v1") || []
const de = (id) => cola.filter((a) => a.recordatorioId === id)

// ------------------------------------------- A) La cola existe y está entera
check(
  "A · la app deja la cola en el dispositivo",
  Array.isArray(cola) && cola.length > 0,
  String(cola.length),
)
check(
  "A · cada recordatorio aporta solo sus avisos futuros y sin repetidos",
  cola.length === 2 + 120 + 7 + 1 + 1,
  `total ${cola.length}: ${JSON.stringify(
    recordatorios.map((r) => [r.id, de(r.id).length]),
  )}`,
)
check(
  "A · un recordatorio completado no programa nada",
  de("e-completado").length === 0,
)
check(
  "A · uno que ya venció (y no se repite) tampoco",
  de("e-pasado").length === 0,
)
check(
  "A · el aviso de 30 días que ya pasó no se cuela",
  de("e-futuro").length === 2,
  JSON.stringify(de("e-futuro").map((a) => a.cuando)),
)
check(
  "A · dos avisos iguales se guardan una sola vez",
  de("e-doble").length === 1,
)

// ------------------------------------------- B) Las fechas son las que van
const futuroOrdenado = [...de("e-futuro")].sort((a, b) =>
  a.cuando.localeCompare(b.cuando),
)
check(
  "B · el aviso de 7 días cae 7 días antes, a la misma hora del recordatorio",
  new Date(futuroOrdenado[0]?.cuando).getTime() === instante(dia(13), "09:30"),
  `${futuroOrdenado[0]?.cuando} vs ${instante(dia(13), "09:30")}`,
)
check(
  "B · el de 1 día cae 1 día antes",
  new Date(futuroOrdenado[1]?.cuando).getTime() === instante(dia(19), "09:30"),
  String(futuroOrdenado[1]?.cuando),
)
check(
  "B · el texto dice cuánto falta",
  futuroOrdenado[0]?.cuerpo === "Renovar pasaporte vence en 7 días." &&
    futuroOrdenado[1]?.cuerpo === "Renovar pasaporte vence en 1 día.",
  JSON.stringify(futuroOrdenado.map((a) => a.cuerpo)),
)
check(
  "B · el título lleva el emoji de la categoría y el nombre",
  futuroOrdenado[0]?.titulo === "📄 Renovar pasaporte",
  String(futuroOrdenado[0]?.titulo),
)
check(
  "B · la repetición semanal programa sus siete ocurrencias, un día antes de cada una",
  de("e-semanal").length === 7 &&
    de("e-semanal").every((a) => horaLocal(a.cuando) === "18:00"),
  JSON.stringify(
    de("e-semanal").map(
      (a) => `${fechaLocal(a.cuando)} ${horaLocal(a.cuando)}`,
    ),
  ),
)
check(
  "B · y la primera es la de dentro de un día",
  fechaLocal(de("e-semanal")[0]?.cuando) === dia(1),
  `${fechaLocal(de("e-semanal")[0]?.cuando)} vs ${dia(1)}`,
)
check(
  "B · la repetición por horas respeta el tope de 120 (y no se dispara)",
  de("e-horas").length === 120,
  String(de("e-horas").length),
)
check(
  "B · las horas se mueven de 8 en 8 (el aviso, 1 hora antes: 07:00, 15:00 y 23:00 locales)",
  de("e-horas").length === 120 &&
    de("e-horas").every((a) =>
      ["07:00", "15:00", "23:00"].includes(horaLocal(a.cuando)),
    ),
  JSON.stringify(
    de("e-horas")
      .slice(0, 3)
      .map((a) => `${fechaLocal(a.cuando)} ${horaLocal(a.cuando)}`),
  ),
)
const prontoAviso = de("e-pronto")[0]
check(
  "B · un aviso de horas cae al minuto (2 horas antes, o sea dentro de una hora)",
  !!prontoAviso &&
    Math.abs(new Date(prontoAviso.cuando).getTime() - (Date.now() + 3600e3)) <
      10 * 60e3,
  String(prontoAviso?.cuando),
)
check(
  "B · y su texto usa el singular/plural correcto",
  prontoAviso?.cuerpo === "Llamar al dentista vence en 2 horas.",
  String(prontoAviso?.cuerpo),
)

// ------------------------------------------- C) Orden, unicidad y horizonte
const instantes = cola.map((a) => new Date(a.cuando).getTime())
check(
  "C · la cola viene ordenada de la fecha más próxima a la más lejana",
  instantes.every((t, i) => i === 0 || instantes[i - 1] <= t),
)
check(
  "C · no hay ids repetidos (subirla dos veces no duplica nada)",
  new Set(cola.map((a) => a.id)).size === cola.length,
  `${new Set(cola.map((a) => a.id)).size} únicos de ${cola.length}`,
)
check(
  "C · todo lo programado es futuro",
  instantes.every((t) => t > Date.now()),
  String(Math.min(...instantes) - Date.now()),
)
check(
  "C · nada se programa más allá de los 45 días de la ventana",
  instantes.every((t) => t <= Date.now() + 45 * 86400e3 + 3600e3),
  String(Math.max(...instantes) - Date.now()),
)
check(
  "C · cada aviso lleva lo que el servidor necesita para enviarlo",
  cola.every(
    (a) =>
      typeof a.id === "string" &&
      a.id.length > 0 &&
      typeof a.recordatorioId === "string" &&
      typeof a.titulo === "string" &&
      a.titulo.length > 0 &&
      typeof a.cuerpo === "string" &&
      a.cuerpo.length > 0 &&
      !Number.isNaN(new Date(a.cuando).getTime()),
  ),
)

// ------------------------------------------- D) Es estable entre aperturas
const otro = montar(bundle, semilla)
await wait(80)
const colaOtro = otro.storage("avispate.cola.v1") || []
check(
  "D · abrir la app otra vez arma exactamente la misma cola (mismos ids)",
  JSON.stringify(cola.map((a) => a.id)) ===
    JSON.stringify(colaOtro.map((a) => a.id)),
  `${cola.length} vs ${colaOtro.length}`,
)

// ------------------------------------------- E) El service worker, del lado del build
const sw = path.join(BASE, "dist/sw.js")
check("E · el service worker se publica en dist/", fs.existsSync(sw))
if (fs.existsSync(sw)) {
  const fuente = fs.readFileSync(sw, "utf8")
  check(
    "E · y trae los dos manejadores del push, sin marcadores sin reemplazar",
    fuente.includes('addEventListener("push"') &&
      fuente.includes('addEventListener("notificationclick"') &&
      !fuente.includes("__SELLO__") &&
      !fuente.includes("__ARCHIVOS__"),
  )
}
check(
  "E · el bundle trae la cola y el nombre de la función que la sube",
  bundle.includes("avispate.cola.v1") && bundle.includes("sincronizar_avisos"),
)
check(
  "E · sin errores de ejecución",
  m.errors.length === 0,
  m.errors.join(" | ").slice(0, 200),
)

process.exit(finish() ? 1 : 0)
