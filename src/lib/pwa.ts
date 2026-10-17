// Avisos con la app cerrada (Etapa 10): el puente entre el navegador —permiso, service worker y
// suscripción push— y la nube. Es la única parte que toca APIs del navegador que no existen en todos
// lados (iPhone antes de instalar, navegadores viejos, jsdom en la batería), así que siempre se
// pregunta primero y se devuelve un estado claro en vez de romper.
import {
  CLAVE_PUSH,
  nubeLista,
  olvidarDispositivo,
  registrarDispositivo,
} from "./nube"

export type EstadoAvisos =
  | "sin-nube" // falta configurar la URL o la clave de Supabase
  | "iphone-instalar" // en iPhone, primero hay que agregar la app a la pantalla de inicio
  | "sin-soporte" // el navegador no tiene service worker o push
  | "bloqueado" // el usuario (o el sistema) negó las notificaciones
  | "pendiente" // hay soporte, pero todavía no se pidió el permiso o no hay suscripción
  | "activo" // suscripción guardada y registrada en la nube

export type ResultadoAvisos = { estado: EstadoAvisos; error?: string }

let registroActual: ServiceWorkerRegistration | null = null

// Marca de «este dispositivo ya está suscrito», para no intentar subir la cola en cada cambio de
// recordatorios cuando todavía no se activó nada (sería un error por gusto: la nube pide que el
// dispositivo exista). La verdad la sigue teniendo la suscripción del navegador: si aparece una y la
// marca no estaba, se pone.
const CLAVE_SUSCRITO = "avispate.push.v1"

export function pushAnotado() {
  try {
    return localStorage.getItem(CLAVE_SUSCRITO) === "1"
  } catch {
    return false
  }
}

function marcarSuscripcion(activa: boolean) {
  try {
    localStorage.setItem(CLAVE_SUSCRITO, activa ? "1" : "0")
  } catch {}
}

export function swDisponible() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator
}

export function esIPhone() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  return /iP(hone|ad|od)/.test(ua)
}

// Instalada = abierta desde el ícono de la pantalla de inicio (o como app de escritorio). Es la
// condición que pone Safari en iPhone para aceptar push, y la que evita ofrecer «instalar» de nuevo.
export function esInstalada() {
  if (typeof window === "undefined") return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return !!(window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone)
}

export function haySoporte() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "PushManager" in window &&
    swDisponible()
  )
}

// El service worker se registra solo en la entrega compilada: en `npm run dev` los archivos cambian a
// cada rato y un service worker viejo sirviendo el armado anterior confunde más de lo que ayuda. Para
// probar los avisos: `npm run build && npm run preview`.
export async function registrarSW() {
  if (!import.meta.env.PROD || !swDisponible()) return
  try {
    registroActual = await navigator.serviceWorker.register("./sw.js")
  } catch {
    registroActual = null
  }
}

// Cuando hay una versión nueva esperando, se avisa una sola vez. El service worker nuevo se queda en
// `waiting` hasta que alguien toca «Actualizar» (ver activarVersionNueva): así una recarga en medio de
// un formulario no se lleva lo que se estaba escribiendo.
export function vigilarVersionNueva(alAvisar: () => void) {
  if (!swDisponible()) return () => {}
  let vivo = true
  const revisar = async () => {
    const registro =
      registroActual ??
      (await navigator.serviceWorker.getRegistration().catch(() => null))
    if (!registro || !vivo) return
    if (registro.waiting && navigator.serviceWorker.controller) {
      alAvisar()
      return
    }
    registro.addEventListener("updatefound", () => {
      const nuevo = registro.installing
      if (!nuevo) return
      nuevo.addEventListener("statechange", () => {
        if (nuevo.state === "installed" && navigator.serviceWorker.controller) alAvisar()
      })
    })
  }
  void revisar()
  return () => {
    vivo = false
  }
}

export async function activarVersionNueva() {
  if (!swDisponible()) return
  const registro = await navigator.serviceWorker.getRegistration().catch(() => null)
  if (!registro?.waiting) return
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {
    once: true,
  })
  registro.waiting.postMessage({ tipo: "ACTIVAR" })
}

// La clave VAPID viaja en base64url y `subscribe` quiere bytes. El relleno se recalcula porque
// base64url lo omite y `atob` lo exige.
function bytes(base64url: string) {
  const normal = base64url.replace(/-/g, "+").replace(/_/g, "/")
  const relleno = normal + "=".repeat((4 - (normal.length % 4)) % 4)
  const binario = atob(relleno)
  const salida = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i)
  return salida as unknown as BufferSource
}

function mensajeDeSuscripcion(error: unknown) {
  const nombre = (error as { name?: string } | null)?.name || ""
  if (nombre === "NotAllowedError")
    return "El navegador no dio permiso para los avisos. Revisá el candado del sitio."
  if (nombre === "AbortError" || nombre === "NotSupportedError")
    return "Este navegador no pudo suscribirse a los avisos con la app cerrada."
  return `No se pudo activar el push: ${String(error).slice(0, 120)}`
}

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (!nubeLista()) return "sin-nube"
  if (esIPhone() && !esInstalada()) return "iphone-instalar"
  if (!haySoporte()) return "sin-soporte"
  if (Notification.permission === "denied") return "bloqueado"
  if (Notification.permission !== "granted") return "pendiente"
  try {
    const registro = await navigator.serviceWorker.getRegistration()
    const suscripcion = registro ? await registro.pushManager.getSubscription() : null
    if (suscripcion) marcarSuscripcion(true)
    return suscripcion ? "activo" : "pendiente"
  } catch {
    return "pendiente"
  }
}

// Se llama desde un toque («Activar avisos»): el navegador exige un gesto del usuario para pedir el
// permiso. Si algo falla, la suscripción se da de baja para no quedar a medias entre el teléfono y la
// nube.
export async function activarAvisos(): Promise<ResultadoAvisos> {
  if (!nubeLista()) return { estado: "sin-nube" }
  if (esIPhone() && !esInstalada()) return { estado: "iphone-instalar" }
  if (!haySoporte()) return { estado: "sin-soporte" }
  if (!CLAVE_PUSH)
    return {
      estado: "sin-nube",
      error: "Falta la clave pública de VAPID (VITE_VAPID_PUBLIC_KEY en .env.local).",
    }

  let permiso: NotificationPermission = Notification.permission
  if (permiso === "default") {
    try {
      permiso = await Notification.requestPermission()
    } catch {
      permiso = Notification.permission
    }
  }
  if (permiso !== "granted")
    return { estado: permiso === "denied" ? "bloqueado" : "pendiente" }

  let registro =
    registroActual ??
    (await navigator.serviceWorker.getRegistration().catch(() => null))
  if (!registro) {
    try {
      registro = await navigator.serviceWorker.register("./sw.js")
    } catch {
      registro = null
    }
  }
  if (!registro)
    return {
      estado: "sin-soporte",
      error: "El service worker no arrancó. Probá de nuevo en unos segundos.",
    }
  // `ready` se espera con tope: si el service worker no llega a activarse, el botón no puede quedarse
  // girando para siempre. Pasado el tope se sigue igual y `subscribe` dirá si hay con qué.
  await Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise((seguir) => setTimeout(seguir, 3000)),
  ])

  let suscripcion = await registro.pushManager
    .getSubscription()
    .catch(() => null)
  if (!suscripcion) {
    try {
      suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes(CLAVE_PUSH),
      })
    } catch (error) {
      return { estado: "pendiente", error: mensajeDeSuscripcion(error) }
    }
  }

  const json = suscripcion.toJSON()
  const claves = json.keys ?? {}
  if (!json.endpoint || !claves.p256dh || !claves.auth)
    return {
      estado: "pendiente",
      error: "El navegador no entregó la suscripción completa. Probá de nuevo.",
    }

  const alta = await registrarDispositivo({
    endpoint: json.endpoint,
    p256dh: claves.p256dh,
    auth: claves.auth,
  })
  if (!alta.ok) {
    await suscripcion.unsubscribe().catch(() => {})
    return { estado: "pendiente", error: alta.error }
  }
  marcarSuscripcion(true)
  return { estado: "activo" }
}

export async function desactivarAvisos(): Promise<ResultadoAvisos> {
  if (!haySoporte()) return { estado: await estadoAvisos() }
  try {
    const registro = await navigator.serviceWorker.getRegistration()
    const suscripcion = registro ? await registro.pushManager.getSubscription() : null
    await suscripcion?.unsubscribe().catch(() => false)
  } catch {}
  await olvidarDispositivo()
  marcarSuscripcion(false)
  return { estado: await estadoAvisos() }
}

