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

