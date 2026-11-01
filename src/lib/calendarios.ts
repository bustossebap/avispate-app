// Calendarios reales (Etapa 16): el puente entre la app y las Edge Functions.
//
// La app nunca recibe tokens de Google: pide el estado, inicia el consentimiento y manda la foto de
// sus recordatorios. Si no hay sesión, nube o red, todo devuelve `{ ok: false }` y la app sigue con
// el enlace de Google y el `.ics` de siempre.
import { asegurarSesion, type Sesion } from "./cuenta"

export type ProveedorCalendario = "google" | "outlook" | "apple"
export type ModoCalendario = "oauth" | "simulado"

export type CalendarioCuenta = {
  id: string
  perfil_id: string
  proveedor: ProveedorCalendario
  cuenta_email?: string | null
  calendario_externo: string
  nombre?: string | null
  activo: boolean
  modo: ModoCalendario
  ultima_sincronizacion?: string | null
  ultimo_error?: string | null
  creado_en?: string
}

// La forma que entiende `calendarios-sync`. Se arma en App.tsx a partir del recordatorio.
export type EventoCalendario = {
  recordatorioId: string
  titulo: string
  inicio: string
  fin: string
  todoElDia: boolean
  notas?: string
  actualizadoEn: string
  zona?: string
}

// Lo que devuelve la bajada: el mismo evento, ya con la hora de Google y si fue borrado.
export type CambioCalendario = {
  recordatorioId: string
  titulo: string
  inicio: string
  fin: string
  todoElDia: boolean
  notas?: string
  eliminado: boolean
  actualizadoEn: string
  zona?: string
}

// Lo mínimo que necesita un recordatorio para recibir un cambio del calendario.
export type RecordatorioCalendario = {
  id: string
  ownerId?: string
  name: string
  date: string
  time: string
  notes?: string
  updatedAt?: string
  gcalAddedAt?: string
}

export type ResultadoAplicarCambios<T> = {
  eventos: T[]
  aplicados: number
  eliminados: number
  ignorados: number
  conflictos: number
}

export type RespuestaCalendario = {
  ok: boolean
  error?: string
  sesion?: Sesion | null
}

export type RespuestaEstadoCalendarios = RespuestaCalendario & {
  modo?: ModoCalendario
  calendarios: CalendarioCuenta[]
}

export type RespuestaInicioCalendario = RespuestaCalendario & {
  modo?: ModoCalendario
  url?: string
  calendario?: CalendarioCuenta
}

export type RespuestaSyncCalendario = RespuestaCalendario & {
  subidos?: number
  borrados?: number
  bajados?: number
  errores?: number
  cambios?: CambioCalendario[]
  calendario?: CalendarioCuenta
}

export type AvisoCalendario = { texto: string; ok: boolean }

const URL_NUBE = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "")
const CLAVE_NUBE = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim()
const CLAVE_AVISO = "avispate.calendarios.aviso.v1"

export function calendariosDisponibles() {
  return !!URL_NUBE && !!CLAVE_NUBE
}

export function explicarErrorCalendario(error?: string) {
  if (!error) return ""
  if (error === "sin-nube")
    return "Falta conectar la nube (ver supabase/README.md)."
  if (error === "sin-red")
    return "Sin conexión: no se pudo hablar con el calendario."
  if (error === "sin-sesion")
    return "Entrá a tu cuenta para conectar el calendario."
  return error
}

type RespuestaHttp = {
  ok: boolean
  datos?: unknown
  error?: string
  sesion?: Sesion | null
}

function textoDelError(datos: unknown) {
  const d = datos as { error?: unknown; message?: unknown } | null
  const texto = d?.error || d?.message
  return typeof texto === "string" ? texto : ""
}

// Todas las llamadas salen por acá: nunca lanzan y siempre devuelven la sesión vigente para que la
// pantalla pueda reemplazarla si Supabase la renovó.
async function pedirCalendario(
  ruta: string,
  opciones: {
    metodo?: "GET" | "POST"
    cuerpo?: unknown
    sesion: Sesion
  },
): Promise<RespuestaHttp> {
  if (!calendariosDisponibles()) return { ok: false, error: "sin-nube" }
  if (typeof fetch !== "function") return { ok: false, error: "sin-red" }

  const activa = await asegurarSesion(opciones.sesion)
  if (!activa) return { ok: false, error: "sin-sesion", sesion: null }

  try {
    const respuesta = await fetch(
      `${URL_NUBE}/functions/v1/calendarios-oauth${ruta}`,
      {
        method: opciones.metodo || "GET",
        headers: {
          apikey: CLAVE_NUBE,
          Authorization: `Bearer ${activa.accessToken}`,
          "Content-Type": "application/json",
        },
        body:
          opciones.cuerpo === undefined
            ? undefined
            : JSON.stringify(opciones.cuerpo),
      },
    )
    const datos = await respuesta.json().catch(() => ({}))
    if (!respuesta.ok)
      return {
        ok: false,
        datos,
        error:
          textoDelError(datos) ||
          `La nube respondió con un error (${respuesta.status}).`,
        sesion: activa,
      }
    return { ok: true, datos, sesion: activa }
  } catch {
    return { ok: false, error: "sin-red", sesion: activa }
  }
}

function comoCalendario(valor: unknown): CalendarioCuenta | null {
  if (!valor || typeof valor !== "object") return null
  const c = valor as Record<string, unknown>
  const proveedor = c.proveedor
  if (proveedor !== "google" && proveedor !== "outlook" && proveedor !== "apple")
    return null
  if (typeof c.id !== "string") return null
  return {
    id: c.id,
    perfil_id: typeof c.perfil_id === "string" ? c.perfil_id : "yo",
    proveedor,
    cuenta_email: typeof c.cuenta_email === "string" ? c.cuenta_email : null,
    calendario_externo:
      typeof c.calendario_externo === "string" ? c.calendario_externo : "primary",
    nombre: typeof c.nombre === "string" ? c.nombre : null,
    activo: c.activo !== false,
    modo: c.modo === "simulado" ? "simulado" : "oauth",
    ultima_sincronizacion:
      typeof c.ultima_sincronizacion === "string"
        ? c.ultima_sincronizacion
        : null,
    ultimo_error: typeof c.ultimo_error === "string" ? c.ultimo_error : null,
    creado_en: typeof c.creado_en === "string" ? c.creado_en : undefined,
  }
}

// Los cambios que llegan de Google se validan acá: si falta el id o las fechas, se descartan en vez
// de romper la lista de recordatorios.
function comoCambioCalendario(valor: unknown): CambioCalendario | null {
  if (!valor || typeof valor !== "object") return null
  const c = valor as Record<string, unknown>
  const texto = (v: unknown, max: number) =>
    typeof v === "string" ? v.slice(0, max) : ""
  const recordatorioId = texto(c.recordatorioId, 200)
  const inicio = texto(c.inicio, 64)
  const fin = texto(c.fin, 64)
  if (!recordatorioId || !inicio || !fin) return null
  return {
    recordatorioId,
    titulo: texto(c.titulo, 500) || "Recordatorio",
    inicio,
    fin,
    todoElDia: c.todoElDia === true,
    notas: texto(c.notas, 4000) || undefined,
    eliminado: c.eliminado === true,
    actualizadoEn: texto(c.actualizadoEn, 64) || new Date().toISOString(),
    zona: texto(c.zona, 80) || undefined,
  }
}

// Google guarda la descripción tal cual la mandó el push, incluida la línea de la categoría. Al bajar
// un cambio esa línea no es parte de las notas de la persona: se quita para no duplicarla cada vez.
function limpiarNotasGoogle(notas?: string) {
  if (!notas) return ""
  return notas
    .split(/\r?\n/)
    .filter((linea) => !/^Recordatorio de AVISPATE · /i.test(linea.trim()))
    .join("\n")
    .trim()
}

// La fecha y la hora locales de un instante ISO. Se usa la zona del teléfono (o la que se pase en las
// pruebas), no la del evento: la app guarda fecha y hora locales, sin offset.
function partesEnZona(iso: string, zona?: string) {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return null
  const dos = (n: number) => String(n).padStart(2, "0")
  if (!zona)
    return {
      date: `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`,
      time: `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`,
    }
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(fecha)
    const valor = (tipo: string) =>
      partes.find((parte) => parte.type === tipo)?.value || ""
    const hora = valor("hour") === "24" ? "00" : valor("hour")
    const date = `${valor("year")}-${valor("month")}-${valor("day")}`
    const time = `${hora}:${valor("minute")}`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
      return null
    return { date, time }
  } catch {
    return null
  }
}

type CamposCalendario = Pick<
  RecordatorioCalendario,
  "name" | "date" | "time" | "notes"
>

function camposDeCambio(
  cambio: CambioCalendario,
  zonaLocal?: string,
): CamposCalendario | null {
  const name = cambio.titulo.trim() || "Recordatorio"
  const notes = limpiarNotasGoogle(cambio.notas) || undefined
  if (cambio.todoElDia) {
    const date = cambio.inicio.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
    return { name, date, time: "00:00", notes }
  }
  const partes = partesEnZona(cambio.inicio, zonaLocal)
  if (!partes) return null
  return { name, date: partes.date, time: partes.time, notes }
}

function mismaHora(a: string, b: string) {
  const x = Date.parse(a)
  return !Number.isNaN(x) && x === Date.parse(b)
}

function mismosCampos(evento: RecordatorioCalendario, campos: CamposCalendario) {
  const texto = (v?: string) => (v || "").trim()
  return (
    evento.name === campos.name &&
    evento.date === campos.date &&
    evento.time === campos.time &&
    texto(evento.notes) === texto(campos.notes)
  )
}

// Un cambio que acaba de subir la misma pasada vuelve en la bajada como un eco. No se aplica si el
// contenido es idéntico al que se envió: así una edición hecha en Google durante la sincronización
// sigue entrando, pero el push normal no pisa la copia local.
function mismoEventoEnviado(cambio: CambioCalendario, enviado: EventoCalendario) {
  if (cambio.eliminado || cambio.todoElDia !== enviado.todoElDia) return false
  if ((cambio.titulo || "").trim() !== (enviado.titulo || "").trim())
    return false
  const mismaFecha = cambio.todoElDia
    ? cambio.inicio.slice(0, 10) === enviado.inicio.slice(0, 10) &&
      cambio.fin.slice(0, 10) === enviado.fin.slice(0, 10)
    : mismaHora(cambio.inicio, enviado.inicio) &&
      mismaHora(cambio.fin, enviado.fin)
  return (
    mismaFecha &&
    limpiarNotasGoogle(cambio.notas) === (enviado.notas || "").trim()
  )
}

// Aplica la bajada de Google sobre los recordatorios locales. No crea recordatorios que no existan
// (la app es la dueña de su lista), no toca otros perfiles y resuelve cada choque por la hora del
// último cambio: si la copia local es más nueva, se conserva y el próximo push la vuelve a subir.
export function aplicarCambiosCalendario<T extends RecordatorioCalendario>(
  eventos: T[],
  cambios: CambioCalendario[],
  opciones: {
    perfilId: string
    perfilPorDefecto?: string
    enviados?: EventoCalendario[]
    zonaLocal?: string
  },
): ResultadoAplicarCambios<T> {
  const perfilPorDefecto = opciones.perfilPorDefecto || "yo"
  const enviados = new Map(
    (opciones.enviados || []).map((evento) => [evento.recordatorioId, evento]),
  )
  let lista = eventos.slice()
  const porId = new Map(lista.map((evento) => [evento.id, evento]))
  let aplicados = 0
  let eliminados = 0
  let ignorados = 0
  let conflictos = 0

  for (const cambio of cambios) {
    const evento = porId.get(cambio.recordatorioId)
    if (!evento) {
      ignorados += 1
      continue
    }
    if ((evento.ownerId || perfilPorDefecto) !== opciones.perfilId) {
      ignorados += 1
      continue
    }
    const enviado = enviados.get(cambio.recordatorioId)
    if (enviado && mismoEventoEnviado(cambio, enviado)) {
      ignorados += 1
      continue
    }

    const localEn =
      Date.parse(evento.updatedAt || evento.gcalAddedAt || "") || 0
    const remotoEn = Date.parse(cambio.actualizadoEn) || 0
    if (localEn > remotoEn) {
      conflictos += 1
      continue
    }

    if (cambio.eliminado) {
      lista = lista.filter((item) => item.id !== evento.id)
      porId.delete(evento.id)
      eliminados += 1
      continue
    }

    const campos = camposDeCambio(cambio, opciones.zonaLocal)
    if (!campos) {
      ignorados += 1
      continue
    }
    if (mismosCampos(evento, campos)) {
      ignorados += 1
      continue
    }
    const actualizado = {
      ...evento,
      ...campos,
      updatedAt: cambio.actualizadoEn,
    } as T
    lista = lista.map((item) => (item.id === evento.id ? actualizado : item))
    porId.set(evento.id, actualizado)
    aplicados += 1
  }

  return { eventos: lista, aplicados, eliminados, ignorados, conflictos }
}

export async function estadoCalendarios(
  sesion: Sesion,
): Promise<RespuestaEstadoCalendarios> {
  const r = await pedirCalendario("/estado", { sesion })
  if (!r.ok)
    return { ok: false, error: r.error, sesion: r.sesion, calendarios: [] }
  const datos = r.datos as { modo?: unknown; calendarios?: unknown } | null
  const lista = Array.isArray(datos?.calendarios) ? datos.calendarios : []
  return {
    ok: true,
    sesion: r.sesion,
    modo: datos?.modo === "real" ? "oauth" : "simulado",
    calendarios: lista
      .map(comoCalendario)
      .filter((c): c is CalendarioCuenta => !!c),
  }
}

export async function iniciarConexionCalendario(
  sesion: Sesion,
  perfilId: string,
  proveedor: ProveedorCalendario = "google",
): Promise<RespuestaInicioCalendario> {
  const r = await pedirCalendario("/iniciar", {
    metodo: "POST",
    cuerpo: { proveedor, perfilId },
    sesion,
  })
  if (!r.ok) return { ok: false, error: r.error, sesion: r.sesion }
  const datos = r.datos as
    | { modo?: unknown; url?: unknown; calendario?: unknown }
    | null
  const calendario = comoCalendario(datos?.calendario)
  return {
    ok: true,
    sesion: r.sesion,
    modo: datos?.modo === "real" ? "oauth" : "simulado",
    url: typeof datos?.url === "string" ? datos.url : undefined,
    calendario: calendario || undefined,
  }
}

export async function desconectarCalendario(
  sesion: Sesion,
  calendarioId: string,
): Promise<RespuestaCalendario> {
  const r = await pedirCalendario("/desconectar", {
    metodo: "POST",
    cuerpo: { calendarioId },
    sesion,
  })
  return { ok: r.ok, error: r.error, sesion: r.sesion }
}

// El push va a `calendarios-sync`, no a `calendarios-oauth`.
export async function sincronizarCalendario(
  sesion: Sesion,
  calendarioId: string,
  eventos: EventoCalendario[],
  completo: boolean,
): Promise<RespuestaSyncCalendario> {
  if (!calendariosDisponibles()) return { ok: false, error: "sin-nube" }
  if (typeof fetch !== "function") return { ok: false, error: "sin-red" }
  const activa = await asegurarSesion(sesion)
  if (!activa) return { ok: false, error: "sin-sesion", sesion: null }

  try {
    const respuesta = await fetch(`${URL_NUBE}/functions/v1/calendarios-sync`, {
      method: "POST",
      headers: {
        apikey: CLAVE_NUBE,
        Authorization: `Bearer ${activa.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accion: "sincronizar",
        calendarioId,
        eventos,
        completo,
      }),
    })
    const datos = (await respuesta.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    if (!respuesta.ok)
      return {
        ok: false,
        error:
          textoDelError(datos) ||
          `La nube respondió con un error (${respuesta.status}).`,
        sesion: activa,
      }
    return {
      ok: true,
      sesion: activa,
      subidos: Number(datos.subidos) || 0,
      borrados: Number(datos.borrados) || 0,
      bajados: Number(datos.bajados) || 0,
      errores: Number(datos.errores) || 0,
      cambios: Array.isArray(datos.cambios)
        ? datos.cambios
            .map(comoCambioCalendario)
            .filter((c): c is CambioCalendario => !!c)
        : [],
      calendario: comoCalendario(datos.calendario) || undefined,
    }
  } catch {
    return { ok: false, error: "sin-red", sesion: activa }
  }
}


// Google vuelve a la app con `?calendario=google&estado=conectado|error&motivo=…`. Se guarda un
// aviso breve y se limpia la dirección para que el estado no quede en el historial.
export function procesarRetornoCalendario(): AvisoCalendario | null {
  if (typeof window === "undefined") return null
  const url = new URL(window.location.href)
  const proveedor = url.searchParams.get("calendario")
  if (!proveedor) return null

  const estado = url.searchParams.get("estado") || ""
  const motivo = url.searchParams.get("motivo") || ""
  const etiqueta =
    proveedor === "google"
      ? "Google Calendar"
      : proveedor === "outlook"
        ? "Outlook"
        : "Apple Calendar"
  const aviso: AvisoCalendario =
    estado === "conectado"
      ? {
          ok: true,
          texto: `${etiqueta} conectado. Ya podés sincronizar desde Ajustes.`,
        }
      : {
          ok: false,
          texto: `No se pudo conectar ${etiqueta}${motivo ? `: ${motivo}` : "."}`,
        }

  url.searchParams.delete("calendario")
  url.searchParams.delete("estado")
  url.searchParams.delete("motivo")
  try {
    window.history.replaceState(null, "", url.pathname + url.search + url.hash)
  } catch {}
  try {
    window.localStorage.setItem(CLAVE_AVISO, JSON.stringify(aviso))
  } catch {}
  return aviso
}

// Ajustes lo lee una vez y lo borra: el aviso no se repite en cada visita.
export function leerAvisoCalendario(): AvisoCalendario | null {
  try {
    const crudo = localStorage.getItem(CLAVE_AVISO)
    if (!crudo) return null
    localStorage.removeItem(CLAVE_AVISO)
    const datos = JSON.parse(crudo)
    if (!datos || typeof datos.texto !== "string") return null
    return { texto: datos.texto, ok: datos.ok !== false }
  } catch {
    return null
  }
}

