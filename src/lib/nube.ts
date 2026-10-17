// La nube de AVISPATE (Etapa 10): Supabase por su API REST, sin SDK. Son tres llamadas y todas pasan
// por funciones de la base que validan el dispositivo con su token, así que la clave pública (la
// `anon`) no puede tocar las tablas de nadie más.
//
// Nada de acá puede romper la app: si no hay claves configuradas, si el teléfono está sin red o si el
// servidor responde con error, la función devuelve { ok: false } y la vida sigue igual (los avisos
// locales, como siempre). Por eso no se lanzan excepciones: la pantalla decide qué contar.
import type { AvisoProgramado } from "./cola"

export type RespuestaNube = { ok: boolean; error?: string }
export type Dispositivo = { id: string; token: string }

// Se leen de a una y con nombre fijo a propósito: Vite reemplaza `import.meta.env.VITE_X` en el
// build y solo esas tres variables llegan al navegador. La privada de VAPID (`VAPID_PRIVATE_KEY`, sin
// prefijo) se queda en el servidor y nunca entra al bundle.
const URL_NUBE = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "")
const CLAVE_NUBE = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim()
export const CLAVE_PUSH = (import.meta.env.VITE_VAPID_PUBLIC_KEY || "").trim()

const CLAVE_DISPOSITIVO = "avispate.dispositivo.v1"
const ESPERA_ANTES_DE_SUBIR = 1500

export function nubeLista() {
  return !!URL_NUBE && !!CLAVE_NUBE
}

// jsdom (la batería) no trae `fetch`, y un teléfono sin red tampoco lo usa: en los dos casos la nube
// se salta sin dejar promesas colgadas ni temporizadores que impidan cerrar el proceso.
export function hayRed() {
  return typeof fetch === "function"
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function azar(bytes: number) {
  const datos = new Uint8Array(bytes)
  try {
    crypto.getRandomValues(datos)
  } catch {
    for (let i = 0; i < bytes; i++) datos[i] = Math.floor(Math.random() * 256)
  }
  return datos
}

// El dispositivo es la identidad de este teléfono ante la nube: un id estable y un token secreto que
// solo él conoce (se guarda en el mismo localStorage que los recordatorios y no se muestra nunca).
export function dispositivo(): Dispositivo {
  try {
    const guardado = localStorage.getItem(CLAVE_DISPOSITIVO)
    if (guardado) {
      const dato = JSON.parse(guardado)
      if (dato && typeof dato.id === "string" && typeof dato.token === "string")
        return { id: dato.id, token: dato.token }
    }
  } catch {}
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `d${Date.now()}-${hex(azar(8))}`
  const nuevo = { id, token: hex(azar(32)) }
  try {
    localStorage.setItem(CLAVE_DISPOSITIVO, JSON.stringify(nuevo))
  } catch {}
  return nuevo
}

// Un nombre legible para reconocer el teléfono en Supabase (solo para mirar la tabla a ojo).
export function nombreDelDispositivo() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  if (/iPhone/i.test(ua)) return "iPhone"
  if (/iPad/i.test(ua)) return "iPad"
  if (/Android/i.test(ua)) return "Android"
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows"
  if (/Linux/i.test(ua)) return "Linux"
  return "Este dispositivo"
}

function mensajeDeError(estado: number, detalle = "") {
  if (estado === 401 || estado === 403)
    return "La clave de la nube no es válida (revisá VITE_SUPABASE_ANON_KEY)."
  if (estado === 404)
    return "Faltan las tablas en Supabase: corré el SQL de supabase/migrations/0001_etapa10.sql."
  if (estado === 429) return "Supabase pidió esperar un momento: probá de nuevo en un minuto."
  return `La nube respondió con un error (${estado}).${detalle ? ` ${detalle.slice(0, 120)}` : ""}`
}


async function rpc(
  nombre: string,
  cuerpo: Record<string, unknown>,
): Promise<RespuestaNube> {
  if (!nubeLista()) return { ok: false, error: "sin-nube" }
  if (!hayRed()) return { ok: false, error: "sin-red" }
  try {
    const respuesta = await fetch(`${URL_NUBE}/rest/v1/rpc/${nombre}`, {
      method: "POST",
      headers: {
        apikey: CLAVE_NUBE,
        Authorization: `Bearer ${CLAVE_NUBE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
    })
    if (respuesta.ok) return { ok: true }
    const detalle = await respuesta.text().catch(() => "")
    return { ok: false, error: mensajeDeError(respuesta.status, detalle) }
  } catch {
    return { ok: false, error: "No se pudo llegar a la nube: revisá tu conexión." }
  }
}

// Alta o actualización del dispositivo. `push` va con la suscripción del navegador (endpoint y las dos
// claves); `null` la borra, para cuando se apagan los avisos.
export async function registrarDispositivo(
  push: { endpoint: string; p256dh: string; auth: string } | null,
): Promise<RespuestaNube> {
  const { id, token } = dispositivo()
  return rpc("registrar_dispositivo", {
    p_dispositivo: id,
    p_token: token,
    p_nombre: nombreDelDispositivo(),
    p_push: push,
  })
}

export async function olvidarDispositivo(): Promise<RespuestaNube> {
  const { id, token } = dispositivo()
  return rpc("olvidar_push", { p_dispositivo: id, p_token: token })
}

let temporizador: ReturnType<typeof setTimeout> | null = null

// Sube la cola entera, pero no en cada tecla: se espera un momento para que crear un recordatorio (que
// toca varios estados seguidos) suba una sola vez. La promesa se resuelve con el resultado del envío
// que de verdad salió, y si llega otro cambio antes se reemplaza por el nuevo.
export function sincronizarCola(avisos: AvisoProgramado[]): Promise<RespuestaNube> {
  if (!nubeLista()) return Promise.resolve({ ok: false, error: "sin-nube" })
  if (!hayRed()) return Promise.resolve({ ok: false, error: "sin-red" })
  if (temporizador) clearTimeout(temporizador)
  const { id, token } = dispositivo()
  return new Promise((resolver) => {
    temporizador = setTimeout(async () => {
      temporizador = null
      const respuesta = await rpc("sincronizar_avisos", {
        p_dispositivo: id,
        p_token: token,
        p_avisos: avisos.map((a) => ({
          id: a.id,
          recordatorioId: a.recordatorioId,
          cuando: a.cuando,
          titulo: a.titulo,
          cuerpo: a.cuerpo,
          emoji: a.emoji,
        })),
      })
      resolver(respuesta)
    }, ESPERA_ANTES_DE_SUBIR)
  })
}

// Un aviso de prueba que vence ya: el servidor lo manda en la próxima pasada (menos de un minuto).
export async function pedirAvisoDePrueba(): Promise<RespuestaNube> {
  const { id, token } = dispositivo()
  return rpc("probar_aviso", { p_dispositivo: id, p_token: token })
}
