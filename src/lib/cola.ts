// La cola de avisos con la app cerrada (Etapa 10). El teléfono es el que sabe cuándo vence cada
// recordatorio —con sus repeticiones y su zona horaria—, así que calcula acá las fechas concretas y
// las sube. El servidor no repite esta cuenta: solo mira la hora y manda. Es a propósito: la lógica de
// repetición vive en un solo lugar (src/lib/repeticion.ts) y no hay dos versiones que se contradigan
// cuando alguien viaja o cambia el horario de verano.
//
// Lo que entra: los recordatorios del dispositivo. Lo que sale: una lista plana de avisos futuros,
// ordenada y sin repetidos, con un id estable (`recordatorio:ocurrencia:aviso`) para que subirla dos
// veces no duplique nada.
//
// Hasta dónde se mira: 45 días. Si alguien no abre la app en más tiempo que eso, deja de haber cola
// hasta que la abra (el aviso local, el de siempre, sigue funcionando al abrirla). Es el mismo límite
// que tiene cualquier app que programa en el teléfono, y 45 días cubre de sobra el uso normal.
import {
  nextOccurrenceAt,
  pad2,
  parseDate,
  pasoFijoMs,
  type EventoRepetible,
} from "./repeticion"
import { avisosDe, type Alerta } from "./avisos"

export type AvisoProgramado = {
  id: string
  recordatorioId: string
  // ISO en UTC: el servidor compara contra su reloj sin tener que saber la zona del teléfono.
  cuando: string
  titulo: string
  cuerpo: string
  emoji: string
  usuario: string
}

export type EventoParaAvisar = EventoRepetible & {
  id: string
  name: string
  categoryEmoji: string
  remindersBefore: number[]
  customReminders?: Alerta[]
  completed?: boolean
  ownerId?: string
}

export const DIAS_DE_COLA = 45
// Tope por recordatorio: «cada 8 horas» durante 45 días son 135 ocurrencias; con 120 alcanza para 40
// días y el resto se repone la próxima vez que se abra la app.
export const MAX_POR_RECORDATORIO = 120
// Tope total: una familia con cien recordatorios no debería subir miles de filas.
export const MAX_TOTAL = 600
// Cuántas fechas se caminan como máximo antes de rendirse. Es un seguro contra un dato raro (una
// repetición que no avanza), no un límite real: las de paso fijo se saltan de un tirón.
const MAX_PASOS = 1200
// Margen para no programar un aviso que ya está saliendo por la vía local (el motor de la app).
const MARGEN_MS = 30000

type Opciones = {
  ahora?: Date
  dias?: number
  maxPorRecordatorio?: number
  maxTotal?: number
}

// Adelanta el punto de partida cuando la fecha base quedó muy atrás, sin caminar fecha por fecha.
// Se mueve con el reloj local (setHours / setDate) y no sumando milisegundos: así el aviso de las
// 09:00 sigue siendo a las 09:00 después del cambio de horario.
function saltarHasta(
  evento: EventoRepetible,
  desde: { date: string; time: string },
  objetivo: Date,
) {
  const paso = pasoFijoMs(evento)
  if (!paso) return desde
  const base = parseDate(desde.date, desde.time)
  const faltan = objetivo.getTime() - base.getTime()
  if (faltan < paso * 2) return desde
  const saltos = Math.floor(faltan / paso) - 1
  const d = new Date(base.getTime())
  if (paso < 86400000) d.setHours(d.getHours() + saltos * Math.round(paso / 3600000))
  else d.setDate(d.getDate() + saltos * Math.round(paso / 86400000))
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  }
}

export function programarAvisos(
  eventos: EventoParaAvisar[],
  opciones: Opciones = {},
): AvisoProgramado[] {
  const ahora = opciones.ahora ?? new Date()
  const dias = opciones.dias ?? DIAS_DE_COLA
  const topePorRecordatorio = opciones.maxPorRecordatorio ?? MAX_POR_RECORDATORIO
  const topeTotal = opciones.maxTotal ?? MAX_TOTAL
  const limite = new Date(ahora.getTime() + dias * 86400000)
  const cola: AvisoProgramado[] = []

  for (const evento of eventos || []) {
    if (!evento || evento.completed) continue
    const avisos = avisosDe(evento)
    if (!avisos.length) continue
    const mayorOffset = Math.max(...avisos.map((a) => a.offset))
    const desde = new Date(ahora.getTime() - mayorOffset * 86400000)

    let ocurrencia = { date: evento.date, time: evento.time || "12:00" }
    ocurrencia = saltarHasta(evento, ocurrencia, desde)

    const emitidos: AvisoProgramado[] = []
    let pasos = 0
    while (pasos < MAX_PASOS && emitidos.length < topePorRecordatorio) {
      pasos += 1
      const base = parseDate(ocurrencia.date, ocurrencia.time)
      if (base.getTime() > limite.getTime()) break

      for (const aviso of avisos) {
        // El aviso de días («30 días antes») sale con la misma hora del recordatorio: el motor local
        // lo da en cuanto ve el día, y para el push una hora concreta y predecible es mejor que la
        // medianoche. Los de horas ya caen en un instante exacto por definición.
        const cuando = new Date(base.getTime() - aviso.offset * 86400000)
        if (cuando.getTime() <= ahora.getTime() + MARGEN_MS) continue
        if (cuando.getTime() > limite.getTime()) continue
        emitidos.push({
          id: `${evento.id}:${ocurrencia.date}T${ocurrencia.time}:${aviso.clave}`,
          recordatorioId: evento.id,
          cuando: cuando.toISOString(),
          titulo: `${evento.categoryEmoji || "🔔"} ${evento.name}`.trim(),
          cuerpo:
            aviso.offset === 0
              ? `${evento.name} vence hoy.`
              : `${evento.name} vence en ${aviso.etiqueta}.`,
          emoji: evento.categoryEmoji || "🔔",
          usuario: evento.ownerId || "yo",
        })
      }

      if (evento.recurrence === "No se repite") break
      const siguiente = nextOccurrenceAt(
        ocurrencia.date,
        ocurrencia.time,
        evento.recurrence,
        evento.recurrenceInterval,
        evento.recurrenceUnit,
      )
      // Una repetición que no avanza (dato viejo o roto) corta acá: nunca un bucle infinito.
      if (siguiente.date === ocurrencia.date && siguiente.time === ocurrencia.time)
        break
      ocurrencia = siguiente
    }
    cola.push(...emitidos)
  }

  return cola
    .sort((a, b) => a.cuando.localeCompare(b.cuando) || a.id.localeCompare(b.id))
    .slice(0, topeTotal)
}
