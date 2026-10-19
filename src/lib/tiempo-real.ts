// Tiempo real (Etapa 15, fase 6): un WebSocket directo al servicio Realtime de Supabase, sin SDK.
//
// El motor de sincronización ya funciona solo con las pasadas de 45 segundos. Realtime es un atajo:
// cuando otro teléfono escribe una fila, el servidor avisa por el socket y la app hace una pasada en
// el acto. Si el socket no está disponible, no hay sesión o el proyecto no tiene Realtime, no pasa
// nada: el sondeo sigue siendo la red de seguridad.
//
// El canal se une con el JWT de la cuenta y pide cambios de las cinco tablas filtrados por
// `user_id=eq.{id}`. Las políticas RLS de las tablas son las que deciden qué puede viajar; el filtro
// es una comodidad para no recibir el mundo entero.
import type { Sesion } from "./cuenta"

export type EstadoTiempoReal =
  | "apagado"
  | "conectando"
  | "conectado"
  | "reconectando"
  | "sin-red"
  | "sin-permiso"

export type CambioTiempoReal = {
  tabla: string
  tipo: string
  commit: string
}

export type ControlTiempoReal = { detener: () => void }

type OpcionesTiempoReal = {
  sesion: Sesion | null
  onCambio: (cambio: CambioTiempoReal) => void
  onEstado: (estado: EstadoTiempoReal) => void
  // La batería inyecta un WebSocket de mentira; en el navegador se usa el global.
  WebSocketImpl?: typeof WebSocket
}

const TABLAS = [
  "recordatorios",
  "categorias",
  "perfiles",
  "ajustes",
  "marcas",
]
const URL_NUBE = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "")
const CLAVE_NUBE = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim()
const TOPIC = "realtime:avispate"
const LATIDO_MS = 25_000

function urlSocket() {
  const base = URL_NUBE.replace(/^http/i, "ws")
  return `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(CLAVE_NUBE)}&vsn=1.0.0`
}

// El mensaje de entrada del protocolo Phoenix que usa Supabase. `access_token` va en el join para
// que RLS sepa quién es la persona; las tablas y el filtro van en `postgres_changes`.
function mensajeJoin(sesion: Sesion, ref: string) {
  return {
    topic: TOPIC,
    event: "phx_join",
    ref,
    join_ref: ref,
    payload: {
      config: {
        broadcast: { self: false },
        presence: { key: sesion.usuario.id },
        postgres_changes: TABLAS.map((table) => ({
          event: "*",
          schema: "public",
          table,
          filter: `user_id=eq.${sesion.usuario.id}`,
        })),
      },
      access_token: sesion.accessToken,
    },
  }
}

// Texto para Ajustes. Se centraliza acá para que la tarjeta no invente otro vocabulario.
export function explicarEstadoTiempoReal(estado: EstadoTiempoReal) {
  if (estado === "conectado") return "Tiempo real: conectado"
  if (estado === "conectando") return "Tiempo real: conectando…"
  if (estado === "reconectando") return "Tiempo real: reconectando…"
  if (estado === "sin-red") return "Tiempo real: sin conexión"
  if (estado === "sin-permiso")
    return "Tiempo real: la nube no autorizó el canal"
  return "Tiempo real: apagado"
}

// Abre el canal y devuelve un control para cerrarlo. Se reconecta con espera creciente (2 s, 4 s,
// 8 s… hasta un minuto); el latido mantiene el socket despierto y detecta conexiones mudas.
export function conectarTiempoReal({
  sesion,
  onCambio,
  onEstado,
  WebSocketImpl,
}: OpcionesTiempoReal): ControlTiempoReal {
  const WS =
    WebSocketImpl ||
    (typeof WebSocket !== "undefined" ? WebSocket : undefined)
  if (!sesion || !URL_NUBE || !CLAVE_NUBE || !WS) {
    onEstado("apagado")
    return { detener() {} }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    onEstado("sin-red")
    return { detener() {} }
  }

  let detenido = false
  let socket: WebSocket | null = null
  let latido: ReturnType<typeof setInterval> | null = null
  let reconexion: ReturnType<typeof setTimeout> | null = null
  let fallos = 0
  let ref = 0
  let refJoin = ""
  const pendientes = new Map<string, string>()

  const enviar = (mensaje: Record<string, unknown>) => {
    try {
      socket?.send(JSON.stringify(mensaje))
    } catch {}
  }
  const limpiarLatido = () => {
    if (latido) clearInterval(latido)
    latido = null
  }
  const programar = () => {
    if (detenido) return
    limpiarLatido()
    // Un error y un cierre pueden llegar seguidos: se queda un solo reintento pendiente.
    if (reconexion) clearTimeout(reconexion)
    const espera = Math.min(60_000, 2_000 * 2 ** Math.min(fallos, 5))
    fallos += 1
    onEstado("reconectando")
    reconexion = setTimeout(() => {
      reconexion = null
      conectar()
    }, espera)
  }
  const conectar = () => {
    if (detenido) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      onEstado("sin-red")
      programar()
      return
    }
    onEstado("conectando")
    try {
      socket = new WS(urlSocket())
    } catch {
      programar()
      return
    }
    const actual = socket
    actual.onopen = () => {
      if (detenido) return
      fallos = 0
      ref += 1
      refJoin = String(ref)
      pendientes.set(refJoin, refJoin)
      enviar(mensajeJoin(sesion, refJoin))
      onEstado("conectado")
      limpiarLatido()
      latido = setInterval(() => {
        ref += 1
        const id = String(ref)
        pendientes.set(id, "heartbeat")
        enviar({ topic: "phoenix", event: "heartbeat", payload: {}, ref: id })
      }, LATIDO_MS)
    }
    actual.onmessage = (evento: MessageEvent) => {
      if (detenido) return
      let mensaje: {
        event?: unknown
        ref?: unknown
        payload?: unknown
      } | null = null
      try {
        mensaje = JSON.parse(String(evento.data || "{}"))
      } catch {
        return
      }
      const nombre = typeof mensaje?.event === "string" ? mensaje.event : ""
      if (nombre === "postgres_changes") {
        const carga = mensaje?.payload as
          | {
              data?: {
                table?: unknown
                type?: unknown
                commit_timestamp?: unknown
              }
            }
          | undefined
        const datos = carga?.data
        onCambio({
          tabla: typeof datos?.table === "string" ? datos.table : "",
          tipo: typeof datos?.type === "string" ? datos.type : "",
          commit:
            typeof datos?.commit_timestamp === "string"
              ? datos.commit_timestamp
              : new Date().toISOString(),
        })
        return
      }
      if (nombre === "phx_reply") {
        const respuesta = mensaje?.payload as
          | { status?: unknown; response?: { reason?: unknown } }
          | undefined
        const id = typeof mensaje?.ref === "string" ? mensaje.ref : ""
        if (id === refJoin) {
          if (respuesta?.status === "ok") {
            fallos = 0
            onEstado("conectado")
          } else {
            onEstado("sin-permiso")
          }
        }
        if (id) pendientes.delete(id)
        return
      }
      if (nombre === "phx_error" || nombre === "phx_close") programar()
    }
    actual.onerror = () => {
      if (detenido) return
      onEstado("sin-red")
    }
    actual.onclose = () => {
      if (detenido) return
      limpiarLatido()
      programar()
    }
  }

  onEstado("conectando")
  conectar()

  return {
    detener() {
      detenido = true
      if (latido) clearInterval(latido)
      if (reconexion) clearTimeout(reconexion)
      limpiarLatido()
      try {
        socket?.close(1000, "cerrado por la app")
      } catch {}
      socket = null
      onEstado("apagado")
    },
  }
}

