// Repeticiones de AVISPATE, en un solo lugar: la app las usa para mostrar «se programará» y para
// saber cuándo toca avisar, y la cola de avisos (src/lib/cola.ts) las usa para saber qué fechas van a
// existir de acá en adelante. Antes vivían dentro de App.tsx; se movieron acá —sin cambiar una línea
// de su comportamiento— para que la cola pueda calcularlas sin importar la pantalla ni React.
//
// Las fechas de los recordatorios son "YYYY-MM-DD" y las horas "HH:MM", siempre en la hora local del
// dispositivo: por eso todo se arma con `new Date(año, mes, día, hora, minuto)` y nunca con
// `new Date("2026-10-17")`, que se interpretaría como UTC y correría el día en Chile.

export type UnidadRepeticion = "horas" | "días" | "semanas" | "meses" | "años"

// Lo mínimo que hace falta para repetir: así la cola puede trabajar con recordatorios recortados (y
// con los datos que llegan de la nube) sin depender del tipo completo de App.tsx.
export type EventoRepetible = {
  date: string
  time: string
  recurrence: string
  recurrenceInterval?: number
  recurrenceUnit?: UnidadRepeticion
}

export function pad2(n: number) {
  return String(n).padStart(2, "0")
}

export function parseDate(date: string, time = "12:00") {
  return new Date(`${date}T${time || "12:00"}:00`)
}

export function addMonthsSafe(d: Date, months: number) {
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  d.setDate(
    Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()),
  )
}

export function addYearsSafe(d: Date, years: number) {
  const day = d.getDate(),
    month = d.getMonth()
  d.setDate(1)
  d.setFullYear(d.getFullYear() + years)
  d.setMonth(month)
  d.setDate(Math.min(day, new Date(d.getFullYear(), month + 1, 0).getDate()))
}

// La próxima vez que vence el recordatorio después de su fecha base. La primera llamada devuelve la
// segunda ocurrencia: la base ya está puesta en el recordatorio.
export function nextOccurrenceAt(
  date: string,
  time: string,
  recurrence: string,
  interval?: number,
  unit?: UnidadRepeticion,
) {
  const d = parseDate(date, time)
  if (recurrence === "No se repite") return { date, time: time || "12:00" }
  const hours =
    recurrence === "Cada 8 horas"
      ? 8
      : recurrence === "Personalizada" && unit === "horas" && interval
        ? interval
        : 0
  if (hours > 0) {
    d.setHours(d.getHours() + hours)
    return {
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    }
  }
  if (recurrence === "Cada semana") d.setDate(d.getDate() + 7)
  else if (recurrence === "Cada 2 semanas") d.setDate(d.getDate() + 14)
  else if (recurrence === "Cada mes") addMonthsSafe(d, 1)
  else if (recurrence === "Cada 6 meses") addMonthsSafe(d, 6)
  else if (recurrence === "Cada año") addYearsSafe(d, 1)
  else if (recurrence === "Cada 2 años") addYearsSafe(d, 2)
  else if (recurrence === "Cada 5 años") addYearsSafe(d, 5)
  else if (recurrence === "Cada 10 años") addYearsSafe(d, 10)
  else if (recurrence === "Personalizada" && interval && unit) {
    if (unit === "días") d.setDate(d.getDate() + interval)
    else if (unit === "semanas") d.setDate(d.getDate() + interval * 7)
    else if (unit === "meses") addMonthsSafe(d, interval)
    else if (unit === "años") addYearsSafe(d, interval)
  }
  return {
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    time: time || "12:00",
  }
}

// Cuántos milisegundos avanza cada paso cuando la repetición es de paso fijo (horas, días o semanas).
// Devuelve 0 en las de calendario (meses y años), que no se pueden saltar con aritmética de reloj
// porque un mes no siempre tiene los mismos días. Sirve para adelantar el recorrido cuando un
// recordatorio con repetición horaria es viejo: sin esto, uno de «cada 8 horas» creado hace tres años
// obligaría a caminar más de tres mil fechas para llegar a la semana que viene.
export function pasoFijoMs(evento: EventoRepetible) {
  const { recurrence, recurrenceInterval: intervalo, recurrenceUnit: unidad } = evento
  if (recurrence === "Cada 8 horas") return 8 * 3600000
  if (recurrence === "Cada semana") return 7 * 86400000
  if (recurrence === "Cada 2 semanas") return 14 * 86400000
  if (recurrence !== "Personalizada" || !intervalo || intervalo < 1) return 0
  if (unidad === "horas") return intervalo * 3600000
  if (unidad === "días") return intervalo * 86400000
  if (unidad === "semanas") return intervalo * 7 * 86400000
  return 0
}
