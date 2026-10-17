// Motor de sincronización de la Etapa 15 (fase 3).
//
// La app sigue siendo local-first: los datos viven en localStorage y esta capa solo los replica. La
// cola es la misma idea que la de avisos de la Etapa 10: un cambio se anota primero, se intenta subir
// después y, si no hay red, queda esperando. Nunca se pierde un cambio por cerrar la app.
//
// Decisiones que conviene tener a mano:
//
//   · La cola y el cursor viven en localStorage, no en IndexedDB. Son pocos KB (solo cambios, no
//     adjuntos) y así el motor funciona también en los navegadores donde IndexedDB está bloqueado.
//     El contenido de los adjuntos no viaja: el archivo sigue en el teléfono que lo agregó.
//   · El conflicto se resuelve con la hora del cambio y, si empatan, con el id del dispositivo. La
//     hora la manda el teléfono que editó; el servidor acota relojes muy adelantados.
//   · La primera pasada de una cuenta baja antes de subir. Así un teléfono nuevo no pisa el perfil
//     remoto con los valores de fábrica; lo que existe solo acá se sube en la misma pasada.
//   · La sincronización es oportunista: al arrancar, cuando cambian los datos (con un respiro para
//     no subir cada tecla), cada 45 segundos y al volver la conexión.

import { asegurarSesion, cuentaDisponible, type Sesion } from "./cuenta"
import { dispositivo } from "./nube"

export type EntidadSync = "recordatorios" | "categorias" | "perfiles" | "ajustes" | "marcas"

export type FotoSync = {
  recordatorios: unknown[]
  categorias: unknown[]
  perfiles: unknown[]
  ajustes?: unknown[]
  marcas?: unknown[]
}

export type CambioSync = {
  entidad: EntidadSync
  id: string
  payload: unknown
  actualizadoEn: string
  eliminadoEn: string | null
  revision: number
  dispositivoId: string
  seq: number
}

export type UltimaSync = {
  cuando: string
  ok: boolean
  subidos: number
  bajados: number
  error?: string
}

export type ResumenSync = {
  pendientes: number
  cursor: number
  ultima: UltimaSync | null
}

export type ResultadoSync = {
  ok: boolean
  error?: string
  sesion?: Sesion
  cambios: CambioSync[]
  subidos: number
  bajados: number
  pendientes: number
  cursor: number
}

type Marca = {
  hash: string
  actualizadoEn: number
  eliminado: boolean
}

type Operacion = {
  entidad: EntidadSync
  id: string
  payload: unknown | null
  actualizadoEn: string
}

type EstadoSync = {
  usuarioId: string
  dispositivoId: string
  cursor: number
  meta: Record<string, Marca>
  // Copia de lo último que este teléfono conoce de cada fila. Sirve para desempatar un conflicto sin
  // volver a leer React desde el motor.
  local: Record<string, unknown | null>
  cola: Operacion[]
  fallos: number
  esperaHasta: number
  ultima: UltimaSync | null
}

const CLAVE = "avispate.sync.v1"
const LIMITE_LOTE = 200
const LIMITE_PAGINAS = 10

const ENTIDADES: EntidadSync[] = [
  "recordatorios",
  "categorias",
  "perfiles",
  "ajustes",
  "marcas",
]

function esEntidad(valor: unknown): valor is EntidadSync {
  return typeof valor === "string" && (ENTIDADES as string[]).includes(valor)
}

function claveDe(entidad: EntidadSync, id: string) {
  return `${entidad}\u001f${id}`
}

function idDe(entidad: EntidadSync, item: unknown): string {
  if (!item || typeof item !== "object") return ""
  const fila = item as Record<string, unknown>
  // Las categorías se identifican por su nombre, igual que en la app y en las copias.
  const valor = entidad === "categorias" ? fila.name : fila.id
  return typeof valor === "string" ? valor.trim().slice(0, 200) : ""
}

function listaDe(foto: FotoSync, entidad: EntidadSync): unknown[] {
  if (entidad === "recordatorios") return foto.recordatorios
  if (entidad === "categorias") return foto.categorias
  if (entidad === "perfiles") return foto.perfiles
  if (entidad === "ajustes") return foto.ajustes ?? []
  return foto.marcas ?? []
}

// ---------------------------------------------------------------------------------------------
// Huellas y estado local
// ---------------------------------------------------------------------------------------------
// Una huella estable del contenido: dos teléfonos que tienen lo mismo deben producir el mismo hash
// aunque el JSON haya salido con las claves en otro orden. Es lo que evita subir cambios de más.
function canonico(valor: unknown): string {
  if (valor === null || valor === undefined) return "null"
  if (typeof valor === "string") return JSON.stringify(valor)
  if (typeof valor === "number")
    return Number.isFinite(valor) ? String(valor) : "null"
  if (typeof valor === "boolean") return valor ? "true" : "false"
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`
  if (typeof valor === "object") {
    const fila = valor as Record<string, unknown>
    return `{${Object.keys(fila)
      .sort()
      .filter((k) => fila[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonico(fila[k])}`)
      .join(",")}}`
  }
  return "null"
}

// FNV-1a de 32 bits. No es criptográfico y no hace falta que lo sea: solo responde «¿cambió?».
function huella(valor: unknown) {
  const texto = canonico(valor)
  let h = 2166136261
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function estadoVacio(usuarioId: string, dispositivoId: string): EstadoSync {
  return {
    usuarioId,
    dispositivoId,
    cursor: 0,
    meta: {},
    local: {},
    cola: [],
    fallos: 0,
    esperaHasta: 0,
    ultima: null,
  }
}

function cargarEstado(usuarioId: string, dispositivoId: string): EstadoSync {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) || "null")
    // La cola es de una cuenta y un teléfono concretos. Si cambió cualquiera de los dos, se empieza
    // de cero: no tiene sentido subir a la cuenta B lo que quedó pendiente de la cuenta A.
    if (
      guardado &&
      guardado.usuarioId === usuarioId &&
      guardado.dispositivoId === dispositivoId &&
      typeof guardado.cursor === "number" &&
      Array.isArray(guardado.cola)
    ) {
      return {
        ...estadoVacio(usuarioId, dispositivoId),
        ...guardado,
        meta:
          guardado.meta && typeof guardado.meta === "object"
            ? guardado.meta
            : {},
        local:
          guardado.local && typeof guardado.local === "object"
            ? guardado.local
            : {},
        cola: guardado.cola.filter(
          (o: Operacion) =>
            o && esEntidad(o.entidad) && typeof o.id === "string",
        ),
      }
    }
  } catch {}
  return estadoVacio(usuarioId, dispositivoId)
}

function guardarEstado(estado: EstadoSync) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado))
  } catch {}
}

export function resumenSincronizacion(usuarioId: string | null): ResumenSync {
  if (!usuarioId) return { pendientes: 0, cursor: 0, ultima: null }
  const estado = cargarEstado(usuarioId, dispositivo().id)
  return {
    pendientes: estado.cola.length,
    cursor: estado.cursor,
    ultima: estado.ultima,
  }
}

function encolar(estado: EstadoSync, operacion: Operacion) {
  const indice = estado.cola.findIndex(
    (o) => o.entidad === operacion.entidad && o.id === operacion.id,
  )
  // Si ya había una operación pendiente para la misma fila, la nueva la reemplaza: solo importa el
  // último estado, no cada paso intermedio.
  if (indice >= 0) estado.cola[indice] = operacion
  else estado.cola.push(operacion)
}

function aplicarLocal(
  estado: EstadoSync,
  entidad: EntidadSync,
  id: string,
  payload: unknown | null,
  actualizadoEn: number,
) {
  const clave = claveDe(entidad, id)
  estado.local[clave] = payload
  estado.meta[clave] = {
    hash: payload === null ? "" : huella(payload),
    actualizadoEn,
    eliminado: payload === null,
  }
}

// ---------------------------------------------------------------------------------------------
// Preparar la subida: qué cambió desde la última vez
// ---------------------------------------------------------------------------------------------
function prepararOperaciones(
  estado: EstadoSync,
  foto: FotoSync,
  ahora: number,
  ignorar: Set<string>,
): Operacion[] {
  const iso = new Date(ahora).toISOString()
  const vistos = new Set<string>()

  for (const entidad of ENTIDADES) {
    for (const item of listaDe(foto, entidad)) {
      const id = idDe(entidad, item)
      if (!id) continue
      const clave = claveDe(entidad, id)
      vistos.add(clave)

      // La primera bajada ya dejó la marca de lo que vino del servidor. No hay que volver a subirlo
      // en esta pasada (ni pisar con los valores de fábrica un perfil que acaba de llegar).
      if (ignorar.has(clave)) continue

      const marca = estado.meta[clave]
      const hash = huella(item)
      if (marca && marca.hash === hash && !marca.eliminado) {
        estado.local[clave] = item
        continue
      }

      encolar(estado, { entidad, id, payload: item, actualizadoEn: iso })
      aplicarLocal(estado, entidad, id, item, ahora)
    }
  }

  // Lo que estaba en la foto anterior y ya no está se borró en este teléfono. Se manda una tumba con
  // payload nulo; el servidor conserva el contenido viejo por si otro dispositivo la necesita.
  for (const [clave, marca] of Object.entries(estado.meta)) {
    // Lo que acaba de bajar del servidor no está en la foto local todavía: no es un borrado. Sin
    // esta guarda, un teléfono nuevo mandaría una tumba por cada fila remota que aún no pintó React.
    if (marca.eliminado || vistos.has(clave) || ignorar.has(clave)) continue
    const separador = clave.indexOf("\u001f")
    const entidad = clave.slice(0, separador)
    const id = clave.slice(separador + 1)
    if (!esEntidad(entidad) || !id) continue

    encolar(estado, { entidad, id, payload: null, actualizadoEn: iso })
    estado.local[clave] = null
    estado.meta[clave] = { hash: "", actualizadoEn: ahora, eliminado: true }
  }

  return estado.cola
}

// ---------------------------------------------------------------------------------------------
// Aplicar la bajada: gana la hora más nueva; si empatan, el dispositivo con id mayor
// ---------------------------------------------------------------------------------------------
function fechaDe(valor: unknown): number {
  const n = typeof valor === "string" ? Date.parse(valor) : NaN
  return Number.isFinite(n) ? n : 0
}

function ganaRemoto(
  cambio: CambioSync,
  marca: Marca,
  dispositivoLocal: string,
) {
  const hora = fechaDe(cambio.actualizadoEn)
  if (hora !== marca.actualizadoEn) return hora > marca.actualizadoEn
  // Mismo instante: desempate determinista para que los dos teléfonos lleguen al mismo resultado.
  if (cambio.dispositivoId !== dispositivoLocal)
    return cambio.dispositivoId > dispositivoLocal
  return huella(cambio.payload) > marca.hash
}

function aplicarCambio(
  estado: EstadoSync,
  cambio: CambioSync,
  ahora: number,
  ignorar: Set<string>,
): boolean {
  const clave = claveDe(cambio.entidad, cambio.id)
  const marca = estado.meta[clave]
  const hash = cambio.eliminadoEn ? "" : huella(cambio.payload)

  if (marca) {
    if (!ganaRemoto(cambio, marca, estado.dispositivoId)) {
      // La versión local es más nueva. Si el servidor tiene otra cosa, se reencola con la hora de
      // ahora para que la próxima subida gane; si es la misma, no hay nada que hacer.
      if (marca.hash !== hash) {
        const local = estado.local[clave] ?? null
        encolar(estado, {
          entidad: cambio.entidad,
          id: cambio.id,
          payload: local,
          actualizadoEn: new Date(ahora).toISOString(),
        })
        estado.meta[clave] = {
          hash: local === null ? "" : huella(local),
          actualizadoEn: ahora,
          eliminado: local === null,
        }
      }
      return false
    }
    if (marca.hash === hash) {
      // Misma fila y mismo contenido: el cursor avanza, pero no se molesta a React.
      estado.local[clave] = cambio.eliminadoEn ? null : cambio.payload
      return false
    }
  }

  aplicarLocal(
    estado,
    cambio.entidad,
    cambio.id,
    cambio.eliminadoEn ? null : cambio.payload,
    fechaDe(cambio.actualizadoEn),
  )
  ignorar.add(clave)
  return true
}

// ---------------------------------------------------------------------------------------------
// Hablar con Supabase
// ---------------------------------------------------------------------------------------------
type RespuestaRpc<T,> = {
  ok: boolean
  datos?: T
  error?: string
  sesion?: Sesion
}

function urlNube() {
  const url = (import.meta.env.VITE_SUPABASE_URL || "")
    .trim()
    .replace(/\/+$/, "")
  const clave = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim()
  return { url, clave }
}

function explicarErrorSync(estado: number, cuerpo: string) {
  if (estado === 401)
    return "La sesión venció. Volvé a entrar con un enlace mágico."
  if (estado === 403)
    return "Este teléfono no está vinculado a la cuenta. Volvé a vincularlo."
  if (estado === 404)
    return "La nube todavía no tiene el motor de sincronización (falta la migración 0005)."
  if (estado === 409)
    return "La nube rechazó el cambio por un conflicto. Se reintentará."
  const limpio = cuerpo
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return limpio ? limpio.slice(0, 180) : `La nube respondió ${estado}.`
}

async function pedirRpc<T>(
  sesion: Sesion,
  funcion: string,
  cuerpo: Record<string, unknown>,
): Promise<RespuestaRpc<T>> {
  const { url, clave } = urlNube()
  if (!cuentaDisponible() || !url || !clave)
    return {
      ok: false,
      error: "La sincronización no está configurada en esta entrega.",
    }
  if (!navigator.onLine)
    return {
      ok: false,
      error: "Sin conexión. Los cambios quedan guardados en este teléfono.",
    }

  // Renueva antes de cada llamada: una sesión vencida no debe dejar la cola trabada.
  const vigente = await asegurarSesion(sesion)
  if (!vigente)
    return {
      ok: false,
      error: "La sesión venció. Volvé a entrar con un enlace mágico.",
    }

  try {
    const respuesta = await fetch(`${url}/rest/v1/rpc/${funcion}`, {
      method: "POST",
      headers: {
        apikey: clave,
        Authorization: `Bearer ${vigente.accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(cuerpo),
    })
    const texto = await respuesta.text()
    if (!respuesta.ok)
      return {
        ok: false,
        error: explicarErrorSync(respuesta.status, texto),
        sesion: vigente,
      }
    const datos = texto ? JSON.parse(texto) as T : undefined as T
    return { ok: true, datos, sesion: vigente }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? `No se pudo hablar con la nube: ${error.message}`
          : "No se pudo hablar con la nube.",
      sesion: vigente,
    }
  }
}

type FilaBajada = {
  entidad?: unknown
  id?: unknown
  payload?: unknown
  updated_at?: unknown
  deleted_at?: unknown
  revision?: unknown
  dispositivo_id?: unknown
  seq?: unknown
}

function leerFila(fila: FilaBajada): CambioSync | null {
  if (!fila || !esEntidad(fila.entidad)) return null
  const id = typeof fila.id === "string" ? fila.id : ""
  const seq = typeof fila.seq === "number" ? fila.seq : Number(fila.seq)
  if (!id || !Number.isFinite(seq)) return null
  const actualizadoEn =
    typeof fila.updated_at === "string"
      ? fila.updated_at
      : new Date().toISOString()
  const eliminadoEn =
    typeof fila.deleted_at === "string" ? fila.deleted_at : null
  return {
    entidad: fila.entidad,
    id,
    payload: fila.payload ?? null,
    actualizadoEn,
    eliminadoEn,
    revision: typeof fila.revision === "number" ? fila.revision : 1,
    dispositivoId:
      typeof fila.dispositivo_id === "string" ? fila.dispositivo_id : "",
    seq,
  }
}

async function bajarPaginas(
  sesion: Sesion,
  estado: EstadoSync,
  ahora: number,
): Promise<{
  ok: boolean
  error?: string
  cambios: CambioSync[]
  sesion?: Sesion
}> {
  const cambios: CambioSync[] = []
  const ignorar = new Set<string>()

  for (let pagina = 0; pagina < LIMITE_PAGINAS; pagina += 1) {
    const respuesta = await pedirRpc<FilaBajada[]>(sesion, "bajar_cambios", {
      p_dispositivo: dispositivo().id,
      p_token: dispositivo().token,
      p_desde: estado.cursor,
      p_limite: LIMITE_LOTE,
    })
    if (!respuesta.ok)
      return {
        ok: false,
        error: respuesta.error,
        cambios,
        sesion: respuesta.sesion,
      }

    const filas = Array.isArray(respuesta.datos) ? respuesta.datos : []
    const antes = estado.cursor
    let mayor = estado.cursor
    let validas = 0
    for (const fila of filas) {
      const cambio = leerFila(fila)
      if (!cambio) continue
      validas += 1
      if (aplicarCambio(estado, cambio, ahora, ignorar)) cambios.push(cambio)
      if (cambio.seq > mayor) mayor = cambio.seq
    }
    estado.cursor = mayor

    // Una página incompleta es el final. Si llegó justo al límite, se pide la siguiente sin esperar.
    if (filas.length < LIMITE_LOTE) break
    // Defensa: si el servidor devolviera filas sin `seq` válido (o sin avanzar), no se entra en bucle.
    if (validas === 0 || mayor === antes) break
  }

  return { ok: true, cambios, sesion }
}

// ---------------------------------------------------------------------------------------------
// Una pasada completa
// ---------------------------------------------------------------------------------------------
function esperaTrasFallo(fallos: number) {
  // 2 s, 4 s, 8 s… hasta un minuto. Un servidor caído no se martilla desde cada teléfono.
  return Math.min(60_000, 2_000 * 2 ** Math.min(fallos, 5))
}

export async function sincronizarCuenta({
  sesion,
  foto,
  forzar = false,
  ahora = Date.now(),
}: {
  sesion: Sesion
  foto: FotoSync
  forzar?: boolean
  ahora?: number
}): Promise<ResultadoSync> {
  const activa = await asegurarSesion(sesion)
  if (!activa) {
    return {
      ok: false,
      error: "La sesión venció. Volvé a entrar con un enlace mágico.",
      cambios: [],
      subidos: 0,
      bajados: 0,
      pendientes: 0,
      cursor: 0,
    }
  }

  const estado = cargarEstado(activa.usuario.id, dispositivo().id)
  const primera = estado.cursor === 0 && Object.keys(estado.meta).length === 0
  const cambios: CambioSync[] = []
  let bajados = 0
  let subidos = 0

  // En una cuenta recién vinculada se baja primero. El teléfono nuevo tiene datos de fábrica (o de
  // muestra) y subirlos antes de mirar la nube pisaría el perfil y los recordatorios reales.
  const ignorar = new Set<string>()
  if (primera) {
    const bajada = await bajarPaginas(activa, estado, ahora)
    if (!bajada.ok) {
      estado.ultima = {
        cuando: new Date(ahora).toISOString(),
        ok: false,
        subidos: 0,
        bajados: 0,
        error: bajada.error,
      }
      guardarEstado(estado)
      return {
        ok: false,
        error: bajada.error,
        sesion: bajada.sesion,
        cambios,
        subidos: 0,
        bajados: 0,
        pendientes: estado.cola.length,
        cursor: estado.cursor,
      }
    }
    cambios.push(...bajada.cambios)
    bajados += bajada.cambios.length
    for (const cambio of bajada.cambios)
      ignorar.add(claveDe(cambio.entidad, cambio.id))
  }

  const operaciones = prepararOperaciones(estado, foto, ahora, ignorar)
  guardarEstado(estado)

  // Si la última subida falló, se espera un poco antes de reintentar; el botón «Sincronizar ahora»
  // pasa `forzar` y salta la espera. La bajada se intenta igual: leer no tiene backoff.
  //
  // El servidor acepta como máximo 200 cambios por lote. La cola se manda en tandas: una cuenta con
  // cientos de recordatorios no se queda trabada con un error de «demasiados cambios» para siempre.
  if (operaciones.length && (forzar || ahora >= estado.esperaHasta)) {
    let tandas = 0
    while (estado.cola.length && tandas < LIMITE_PAGINAS) {
      const lote = estado.cola.slice(0, LIMITE_LOTE)
      const respuesta = await pedirRpc<{
        ok?: boolean
        subidos?: number
        ignorados?: number
      }>(activa, "subir_cambios", {
        p_dispositivo: dispositivo().id,
        p_token: dispositivo().token,
        p_cambios: lote.map((o) => ({
          entidad: o.entidad,
          id: o.id,
          payload: o.payload,
          actualizadoEn: o.actualizadoEn,
          eliminadoEn: o.payload === null ? o.actualizadoEn : null,
        })),
      })

      if (!respuesta.ok) {
        estado.fallos += 1
        estado.esperaHasta = ahora + esperaTrasFallo(estado.fallos)
        estado.ultima = {
          cuando: new Date(ahora).toISOString(),
          ok: false,
          subidos,
          bajados,
          error: respuesta.error,
        }
        guardarEstado(estado)
        return {
          ok: false,
          error: respuesta.error,
          sesion: respuesta.sesion,
          cambios,
          subidos,
          bajados,
          pendientes: estado.cola.length,
          cursor: estado.cursor,
        }
      }

      // Las operaciones enviadas salieron (el servidor puede haber ignorado las viejas: da igual, ya
      // no son la verdad de este teléfono). Se quitan solo esas, no lo que se haya encolado mientras.
      const enviadas = new Set(lote.map((o) => claveDe(o.entidad, o.id)))
      estado.cola = estado.cola.filter(
        (o) => !enviadas.has(claveDe(o.entidad, o.id)),
      )
      estado.fallos = 0
      estado.esperaHasta = 0
      subidos += respuesta.datos?.subidos ?? lote.length
      guardarEstado(estado)
      tandas += 1
      if (lote.length < LIMITE_LOTE) break
    }
  }

  // Después de subir se baja lo que haya entrado desde el cursor. Así esta misma pasada ve los
  // cambios de los otros teléfonos y, si hubo un empate, el servidor ya tiene la versión nueva.
  const bajada = await bajarPaginas(activa, estado, ahora)
  if (!bajada.ok) {
    estado.ultima = {
      cuando: new Date(ahora).toISOString(),
      ok: false,
      subidos,
      bajados,
      error: bajada.error,
    }
    guardarEstado(estado)
    return {
      ok: false,
      error: bajada.error,
      sesion: bajada.sesion,
      cambios,
      subidos,
      bajados,
      pendientes: estado.cola.length,
      cursor: estado.cursor,
    }
  }

  cambios.push(...bajada.cambios)
  bajados += bajada.cambios.length
  estado.ultima = {
    cuando: new Date(ahora).toISOString(),
    ok: true,
    subidos,
    bajados,
  }
  guardarEstado(estado)

  return {
    ok: true,
    sesion: bajada.sesion ?? activa,
    cambios,
    subidos,
    bajados,
    pendientes: estado.cola.length,
    cursor: estado.cursor,
  }
}
