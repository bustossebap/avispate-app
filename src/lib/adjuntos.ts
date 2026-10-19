// Adjuntos en la nube (Etapa 15, fase 5): Supabase Storage, sin SDK.
//
// La app sigue guardando el archivo en IndexedDB y la nube es una copia: si no hay sesión, no hay red
// o el bucket todavía no existe, el adjunto sigue funcionando en este teléfono. Nunca se lanza una
// excepción; todo devuelve `{ ok }` y la pantalla decide qué contar.
//
// El camino es `{user_id}/{id}` dentro de un bucket privado. Las políticas de Storage comparan la
// primera carpeta con `auth.uid()`, así que una sesión no puede leer ni borrar archivos de otra
// cuenta aunque conozca la ruta. Para mostrarlos se pide una URL firmada de una hora.
import { cuentaDisponible, type Sesion } from "./cuenta"

export type RespuestaAdjunto = {
  ok: boolean
  error?: string
  ruta?: string
  url?: string
  bytes?: number
}

export type AdjuntoPendiente = {
  id: string
  nombre: string
  tipo: string
  creadoEn: string
}

export type AdjuntoRemoto = { ruta: string; nombre: string; bytes?: number }

const BUCKET = "adjuntos"
const CLAVE_COLA = "avispate.adjuntos.cola.v1"
const LIMITE_BYTES = 10 * 1024 * 1024
// La misma lista que el bucket. Se comprueba también en el teléfono para dar un mensaje claro antes
// de gastar datos subiendo algo que el servidor va a rechazar.
const TIPOS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "application/pdf",
  "text/plain",
]

const URL_NUBE = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "")
const CLAVE_NUBE = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim()

export function adjuntosDisponibles() {
  return !!URL_NUBE && !!CLAVE_NUBE && cuentaDisponible()
}

export function explicarErrorAdjunto(error?: string) {
  if (!error) return ""
  if (error === "sin-nube")
    return "Falta conectar la nube (ver supabase/README.md)."
  if (error === "sin-red")
    return "Sin conexión: el archivo queda en este teléfono y se sube después."
  if (error === "sin-sesion")
    return "Entrá a tu cuenta para guardar los adjuntos en la nube."
  if (error === "demasiado-grande")
    return "El archivo supera los 10 MB. Puedes guardarlo igual solo en este teléfono."
  if (error === "tipo-no-permitido")
    return "Ese tipo de archivo no se puede guardar en la nube."
  return error
}

function esTipoPermitido(tipo: string) {
  return TIPOS.includes((tipo || "").split(";")[0].trim().toLowerCase())
}

function rutaDe(sesion: Sesion, id: string) {
  return `${sesion.usuario.id}/${id}`
}

function codificarRuta(ruta: string) {
  return ruta
    .split("/")
    .filter(Boolean)
    .map((parte) => encodeURIComponent(parte))
    .join("/")
}

function leerCola(): AdjuntoPendiente[] {
  try {
    const crudo = localStorage.getItem(CLAVE_COLA)
    const datos = crudo ? JSON.parse(crudo) : []
    if (!Array.isArray(datos)) return []
    return datos.filter(
      (d): d is AdjuntoPendiente =>
        !!d &&
        typeof d.id === "string" &&
        typeof d.nombre === "string" &&
        typeof d.tipo === "string",
    )
  } catch {
    return []
  }
}

function guardarCola(lista: AdjuntoPendiente[]) {
  try {
    localStorage.setItem(CLAVE_COLA, JSON.stringify(lista))
  } catch {}
}

export function colaAdjuntos(): AdjuntoPendiente[] {
  return leerCola()
}

export function encolarAdjunto(dato: Omit<AdjuntoPendiente, "creadoEn">) {
  const lista = leerCola().filter((d) => d.id !== dato.id)
  lista.push({ ...dato, creadoEn: new Date().toISOString() })
  guardarCola(lista)
}

export function desencolarAdjunto(id: string) {
  guardarCola(leerCola().filter((d) => d.id !== id))
}

export function limpiarColaAdjuntos() {
  guardarCola([])
}

// Sube un archivo. Se llama después de guardarlo en IndexedDB: si esto falla, la copia local ya
// existe y el id queda en la cola para reintentar cuando haya red y sesión.
export async function subirAdjunto(
  sesion: Sesion | null,
  id: string,
  archivo: Blob,
  nombre: string,
): Promise<RespuestaAdjunto> {
  if (!sesion) return { ok: false, error: "sin-sesion" }
  if (!adjuntosDisponibles()) return { ok: false, error: "sin-nube" }
  if (typeof fetch !== "function") {
    encolarAdjunto({ id, nombre, tipo: archivo.type })
    return { ok: false, error: "sin-red" }
  }
  if (archivo.size > LIMITE_BYTES) return { ok: false, error: "demasiado-grande" }
  if (!esTipoPermitido(archivo.type)) return { ok: false, error: "tipo-no-permitido" }

  const ruta = rutaDe(sesion, id)
  try {
    const respuesta = await fetch(
      `${URL_NUBE}/storage/v1/object/${BUCKET}/${codificarRuta(ruta)}`,
      {
        method: "POST",
        headers: {
          apikey: CLAVE_NUBE,
          Authorization: `Bearer ${sesion.accessToken}`,
          "Content-Type": archivo.type || "application/octet-stream",
          "x-upsert": "true",
          "cache-control": "3600",
        },
        body: archivo,
      },
    )
    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => "")
      encolarAdjunto({ id, nombre, tipo: archivo.type })
      return {
        ok: false,
        error:
          respuesta.status === 413
            ? "demasiado-grande"
            : detalle.slice(0, 160) ||
              `No se pudo subir el adjunto (${respuesta.status}).`,
      }
    }
    desencolarAdjunto(id)
    return { ok: true, ruta, bytes: archivo.size }
  } catch {
    encolarAdjunto({ id, nombre, tipo: archivo.type })
    return { ok: false, error: "sin-red" }
  }
}
// Una URL firmada para ver o descargar el archivo. Supabase devuelve una ruta relativa que hay que
// pegarle a `/storage/v1`; si algún día devolviera una absoluta, se respeta tal cual.
export async function crearUrlFirmada(
  sesion: Sesion,
  ruta: string,
  segundos = 3600,
): Promise<RespuestaAdjunto> {
  if (!sesion) return { ok: false, error: "sin-sesion" }
  if (!adjuntosDisponibles()) return { ok: false, error: "sin-nube" }
  if (typeof fetch !== "function") return { ok: false, error: "sin-red" }
  try {
    const respuesta = await fetch(
      `${URL_NUBE}/storage/v1/object/sign/${BUCKET}/${codificarRuta(ruta)}`,
      {
        method: "POST",
        headers: {
          apikey: CLAVE_NUBE,
          Authorization: `Bearer ${sesion.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: Math.max(60, segundos) }),
      },
    )
    const datos = (await respuesta.json().catch(() => null)) as {
      signedURL?: unknown
      signedUrl?: unknown
    } | null
    if (!respuesta.ok)
      return {
        ok: false,
        error:
          respuesta.status === 404
            ? "El archivo todavía no está en la nube."
            : `No se pudo firmar el archivo (${respuesta.status}).`,
      }
    const firmada =
      typeof datos?.signedURL === "string"
        ? datos.signedURL
        : typeof datos?.signedUrl === "string"
          ? datos.signedUrl
          : ""
    if (!firmada) return { ok: false, error: "La nube no devolvió la URL." }
    const url = firmada.startsWith("http")
      ? firmada
      : `${URL_NUBE}/storage/v1${firmada.startsWith("/") ? "" : "/"}${firmada}`
    return { ok: true, url, ruta }
  } catch {
    return { ok: false, error: "sin-red" }
  }
}

export async function descargarAdjunto(
  sesion: Sesion,
  ruta: string,
): Promise<{ ok: boolean; blob?: Blob; error?: string }> {
  const firmada = await crearUrlFirmada(sesion, ruta)
  if (!firmada.ok || !firmada.url)
    return { ok: false, error: firmada.error || "sin-url" }
  try {
    const respuesta = await fetch(firmada.url)
    if (!respuesta.ok)
      return { ok: false, error: `La nube respondió ${respuesta.status}.` }
    return { ok: true, blob: await respuesta.blob() }
  } catch {
    return { ok: false, error: "sin-red" }
  }
}

export async function borrarAdjuntoRemoto(
  sesion: Sesion | null,
  ruta?: string,
): Promise<RespuestaAdjunto> {
  if (!sesion || !ruta) return { ok: true }
  if (!adjuntosDisponibles()) return { ok: false, error: "sin-nube" }
  if (typeof fetch !== "function") return { ok: false, error: "sin-red" }
  try {
    const respuesta = await fetch(
      `${URL_NUBE}/storage/v1/object/${BUCKET}/${codificarRuta(ruta)}`,
      {
        method: "DELETE",
        headers: {
          apikey: CLAVE_NUBE,
          Authorization: `Bearer ${sesion.accessToken}`,
        },
      },
    )
    // Si ya no está, el objetivo está cumplido.
    if (respuesta.ok || respuesta.status === 404) return { ok: true }
    return { ok: false, error: `No se pudo borrar (${respuesta.status}).` }
  } catch {
    return { ok: false, error: "sin-red" }
  }
}

// Lista lo que hay en la carpeta de la cuenta. Se usa para limpiar huérfanos: archivos que quedaron
// de un borrado o de una restauración y que ya ningún recordatorio referencia.
export async function listarAdjuntosRemotos(
  sesion: Sesion,
): Promise<{ ok: boolean; datos?: AdjuntoRemoto[]; error?: string }> {
  if (!sesion) return { ok: false, error: "sin-sesion" }
  if (!adjuntosDisponibles()) return { ok: false, error: "sin-nube" }
  if (typeof fetch !== "function") return { ok: false, error: "sin-red" }
  try {
    const respuesta = await fetch(`${URL_NUBE}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: {
        apikey: CLAVE_NUBE,
        Authorization: `Bearer ${sesion.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix: `${sesion.usuario.id}/`,
        limit: 1000,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      }),
    })
    if (!respuesta.ok)
      return {
        ok: false,
        error: `No se pudo revisar la nube (${respuesta.status}).`,
      }
    const filas = (await respuesta.json().catch(() => [])) as Array<{
      name?: unknown
      metadata?: { size?: unknown } | null
    }>
    const datos: AdjuntoRemoto[] = (Array.isArray(filas) ? filas : [])
      .map((fila): AdjuntoRemoto | null => {
        const nombre = typeof fila?.name === "string" ? fila.name : ""
        if (!nombre || nombre.endsWith("/")) return null
        return {
          ruta: `${sesion.usuario.id}/${nombre}`,
          nombre,
          ...(typeof fila.metadata?.size === "number"
            ? { bytes: fila.metadata.size }
            : {}),
        }
      })
      .filter((f): f is AdjuntoRemoto => f !== null)
    return { ok: true, datos }
  } catch {
    return { ok: false, error: "sin-red" }
  }
}

// Borra de Storage lo que ya no está referenciado. No borra nada si la lista no se pudo leer: un
// error de red no debe vaciar la nube de nadie.
export async function limpiarAdjuntosRemotos(
  sesion: Sesion,
  referencias: Set<string>,
): Promise<{ ok: boolean; borrados: number; error?: string }> {
  const lista = await listarAdjuntosRemotos(sesion)
  if (!lista.ok) return { ok: false, borrados: 0, error: lista.error }
  let borrados = 0
  for (const archivo of lista.datos ?? []) {
    if (referencias.has(archivo.ruta)) continue
    const borrado = await borrarAdjuntoRemoto(sesion, archivo.ruta)
    if (borrado.ok) borrados += 1
  }
  return { ok: true, borrados }
}

