// Los avisos de un recordatorio («30 días antes», «1 hora antes»), en un solo lugar: cómo se llama
// cada uno, cuántos días representa y cuáles quedan después de descartar repetidos. Antes vivían
// dentro de App.tsx; se movieron acá —sin cambiar su comportamiento— porque la cola de avisos con la
// app cerrada (src/lib/cola.ts) tiene que nombrarlos igual que la pantalla.
//
// Los offsets se guardan siempre en días, así que las horas son fracción de día (1/24): es el mismo
// número con el que se calculan las fechas de aviso y el que viaja a la nube.

export type UnidadAviso = "horas" | "días" | "semanas" | "meses"

export type Alerta = {
  id: string
  amount: number
  unit: UnidadAviso
}

export const HOUR_OFFSET = 1 / 24 // "1 hora antes" expresado en días
// Selector "Avísame": 90 / 30 / 14 / 7 días, 1 día y 1 hora antes.
export const PRESET_OFFSETS = [90, 30, 14, 7, 1, HOUR_OFFSET]
const UNIT_SINGULAR: Record<UnidadAviso, string> = {
  horas: "hora",
  días: "día",
  semanas: "semana",
  meses: "mes",
}

export function alertToDays(alerta: Alerta) {
  if (alerta.unit === "horas") return alerta.amount * HOUR_OFFSET
  if (alerta.unit === "días") return alerta.amount
  if (alerta.unit === "semanas") return alerta.amount * 7
  return alerta.amount * 30
}

export function unitText(unit: UnidadAviso, amount: number) {
  return `${amount} ${amount === 1 ? UNIT_SINGULAR[unit] : unit}`
}

export function alertLabel(alerta: Alerta) {
  return `${unitText(alerta.unit, alerta.amount)} antes`
}

// Los avisos guardan siempre su offset en días, así que los de horas son fracción de día.
export function offsetLabel(days: number) {
  if (days < 1) {
    const h = Math.max(1, Math.round(days * 24))
    return `${h} ${h === 1 ? "hora" : "horas"}`
  }
  return `${Math.round(days)} ${Math.round(days) === 1 ? "día" : "días"}`
}

// Los avisos que de verdad hay que programar: los del selector y los propios, sin repetir el mismo
// momento. Repetir no es raro —«7 días» del selector y «1 semana» escrito a mano son lo mismo— y sin
// esto el mismo aviso saldría dos veces. Gana el primero, que es el del selector y se lee más corto.
export function avisosDe(evento: {
  remindersBefore: number[]
  customReminders?: Alerta[]
}) {
  const vistos = new Set<number>()
  const lista: Array<{ clave: string; offset: number; etiqueta: string }> = []
  const sumar = (clave: string, offset: number, etiqueta: string) => {
    // La clave se redondea para comparar (0.0416666… y 1/24 son lo mismo), pero el offset que se
    // guarda es el exacto: redondearlo correría el aviso 29 ms, porque después se multiplica por los
    // 86.400.000 ms del día.
    const llave = Math.round(offset * 1e6)
    if (vistos.has(llave)) return
    vistos.add(llave)
    lista.push({ clave, offset, etiqueta })
  }
  ;(evento.remindersBefore ?? []).forEach((offset, i) => {
    if (!Number.isFinite(offset) || offset < 0) return
    sumar(`p${i}`, offset, offsetLabel(offset))
  })
  ;(evento.customReminders ?? []).forEach((alerta) => {
    const offset = alertToDays(alerta)
    if (!Number.isFinite(offset) || offset < 0) return
    // Sin el «antes»: el texto del aviso dice «vence en …» y ya lo agrega él.
    sumar(`c${alerta.id}`, offset, unitText(alerta.unit, alerta.amount))
  })
  return lista
}
