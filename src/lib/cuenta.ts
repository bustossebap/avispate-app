// La cuenta de AVISPATE (Etapa 15): Supabase Auth por enlace mágico, sin SDK y sin contraseña.
//
// Tres ideas sostienen este módulo:
//
//   1. La app sigue siendo local por defecto. Sin nube, sin red o sin sesión, todo lo de acá devuelve
//      { ok: false } con una frase entendible y el modo invitado no cambia.
//   2. La sesión es del dispositivo, como el par id/token de la nube. Vive en localStorage y NO viaja
//      dentro de las copias de seguridad: una copia compartida no debe llevarse la llave de nadie.
//   3. La identidad no alcanza para tocar datos ajenos. Las escrituras de la Etapa 15 pasan por
//      funciones que comprueban `auth.uid()` y el token del dispositivo; las tablas tienen RLS.
//
// El enlace mágico lo manda Supabase. Al tocarlo, el correo vuelve a la app con los tokens en el hash
// (`#access_token=…`), se piden los datos de la cuenta con `GET /auth/v1/user`, se guarda la sesión y
// el hash se limpia enseguida para que los tokens no queden en la barra de direcciones ni en el
// historial. Si el enlace venció, el error también vuelve en el hash y se muestra en Ajustes.
import { dispositivo } from "./nube"

export type UsuarioCuenta = { id: string; email: string }

// `expiraEn` va en milisegundos desde la época (no en segundos como `expires_in`): así comparar con
// Date.now() no deja lugar a dudas.
export type Sesion = {
  accessToken: string
  refreshToken: string
  expiraEn: number
  usuario: UsuarioCuenta
}

export type RespuestaCuenta = { ok: boolean; error?: string }
export type RespuestaConSesion = RespuestaCuenta & { sesion?: Sesion }

export type DispositivoCuenta = {
  dispositivoId: string
  nombre: string
  reclamadoEn: string
  ultimaConexion: string
}

const CLAVE_SESION = "avispate.cuenta.v1"
const CLAVE_VINCULO = "avispate.cuenta.vinculo.v1"
// Se renueva un minuto antes de que venza: alcanza para una llamada normal y evita mandar un token
// que expire mientras viaja.
const MARGEN_RENOVACION = 60_000

// Las mismas dos variables públicas de la nube (Etapa 10). Se leen con nombre fijo para que Vite las
// reemplace en el build; la service_role nunca aparece acá.
const URL_NUBE = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "")
const CLAVE_NUBE = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim()

export function cuentaDisponible() {
  return !!URL_NUBE && !!CLAVE_NUBE
}

// Validación deliberadamente simple: la verdad la dice Supabase. Acá solo se evita mandar cualquier
// cosa y se le da un mensaje claro a quien se equivocó de campo.
export function correoValido(correo: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((correo || "").trim())
}

export function explicarErrorCuenta(error?: string) {
  if (!error) return ""
  if (error === "sin-nube")
    return "Falta conectar la nube (ver supabase/README.md)."
  if (error === "sin-red")
    return "Sin conexión: este navegador no puede llegar a la nube."
  return error
}

function textoDelCuerpo(datos: unknown) {
  const d = datos as
    | {
        msg?: unknown
        message?: unknown
        error_description?: unknown
        error?: unknown
      }
    | null
  const texto = d?.msg || d?.message || d?.error_description || d?.error
  return typeof texto === "string" ? texto : ""
}

function explicarHttp(estado: number, datos?: unknown) {
  const detalle = textoDelCuerpo(datos)
  if (estado === 429)
    return "Demasiados intentos seguidos: esperá un minuto y probá de nuevo."
  if (estado === 401 || estado === 403) {
    if (/token/i.test(detalle))
      return "No se pudo comprobar este teléfono. Recargá la app y volvé a intentar."
    return "La sesión venció o no es válida. Pedí un enlace nuevo."
  }
  if (estado === 422) return detalle || "El correo no es válido."
  if (estado >= 500)
    return "La nube no pudo responder ahora. Probá de nuevo en un rato."
  return detalle || `La nube respondió con un error (${estado}).`
}
type RespuestaHttp = {
  ok: boolean
  estado?: number
  datos?: unknown
  error?: string
}

// Todas las llamadas salen por acá. Nunca lanza: el botón de Ajustes necesita un resultado, no una
// promesa rechazada que deje la tarjeta en «Enviando…» para siempre.
async function pedirCuenta(
  ruta: string,
  opciones: {
    metodo?: "GET" | "POST"
    cuerpo?: unknown
    sesion?: Sesion
  } = {},
): Promise<RespuestaHttp> {
  if (!cuentaDisponible()) return { ok: false, error: "sin-nube" }
  if (typeof fetch !== "function") return { ok: false, error: "sin-red" }
  try {
    const headers: Record<string, string> = {
      apikey: CLAVE_NUBE,
      "Content-Type": "application/json",
    }
    if (opciones.sesion)
      headers.Authorization = `Bearer ${opciones.sesion.accessToken}`
    const respuesta = await fetch(`${URL_NUBE}${ruta}`, {
      method: opciones.metodo || "GET",
      headers,
      ...(opciones.cuerpo === undefined
        ? {}
        : { body: JSON.stringify(opciones.cuerpo) }),
    })
    const texto = await respuesta.text().catch(() => "")
    let datos: unknown = null
    try {
      datos = texto ? JSON.parse(texto) : null
    } catch {
      datos = null
    }
    if (!respuesta.ok)
      return {
        ok: false,
        estado: respuesta.status,
        datos,
        error: explicarHttp(respuesta.status, datos),
      }
    return { ok: true, datos }
  } catch {
    return {
      ok: false,
      error: "No se pudo llegar a la nube: revisá tu conexión.",
    }
  }
}

function sesionDesdeRespuesta(datos: unknown, anterior?: Sesion): Sesion | null {
  const d = datos as
    | {
        access_token?: unknown
        refresh_token?: unknown
        expires_in?: unknown
        user?: { id?: unknown; email?: unknown } | null
      }
    | null
  const accessToken = typeof d?.access_token === "string" ? d.access_token : ""
  const refreshToken =
    typeof d?.refresh_token === "string" ? d.refresh_token : ""
  const id = typeof d?.user?.id === "string" ? d.user.id : ""
  if (!accessToken || !refreshToken || !id) return null
  const segundos = Number(d?.expires_in)
  return {
    accessToken,
    refreshToken,
    expiraEn:
      Date.now() + (Number.isFinite(segundos) ? segundos : 3600) * 1000,
    usuario: {
      id,
      email:
        typeof d?.user?.email === "string"
          ? d.user.email
          : anterior?.usuario.email || "",
    },
  }
}

function normalizarSesion(valor: unknown): Sesion | null {
  const s = valor as
    | {
        accessToken?: unknown
        refreshToken?: unknown
        expiraEn?: unknown
        usuario?: { id?: unknown; email?: unknown } | null
      }
    | null
  if (
    !s ||
    typeof s.accessToken !== "string" ||
    typeof s.refreshToken !== "string" ||
    typeof s.usuario?.id !== "string"
  )
    return null
  const expiraEn = Number(s.expiraEn)
  return {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    expiraEn: Number.isFinite(expiraEn) ? expiraEn : 0,
    usuario: {
      id: s.usuario.id,
      email: typeof s.usuario.email === "string" ? s.usuario.email : "",
    },
  }
}

function guardarSesion(sesion: Sesion | null) {
  try {
    if (sesion) localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion))
    else localStorage.removeItem(CLAVE_SESION)
  } catch {}
}

// La sesión guardada en este dispositivo, sin tocar la red. La usa el arranque para pintar la tarjeta
// de inmediato; después `asegurarSesion` decide si hay que renovarla.
export function leerSesion(): Sesion | null {
  try {
    const crudo = localStorage.getItem(CLAVE_SESION)
    if (!crudo) return null
    return normalizarSesion(JSON.parse(crudo))
  } catch {
    return null
  }
}

export function olvidarSesion() {
  guardarSesion(null)
  olvidarVinculo()
}

export function sesionVencida(sesion: Sesion) {
  return sesion.expiraEn <= Date.now()
}

// El vínculo con este teléfono se recuerda por cuenta: si alguien cierra sesión y entra con otra, la
// tarjeta no puede decir «vinculado» por lo que hizo la cuenta anterior.
function marcarVinculo(usuarioId: string) {
  try {
    localStorage.setItem(CLAVE_VINCULO, usuarioId)
  } catch {}
}

function olvidarVinculo() {
  try {
    localStorage.removeItem(CLAVE_VINCULO)
  } catch {}
}

export function vinculadoEnEsteTelefono(sesion: Sesion | null) {
  if (!sesion) return false
  try {
    return localStorage.getItem(CLAVE_VINCULO) === sesion.usuario.id
  } catch {
    return false
  }
}


function limpiarHash() {
  try {
    const { pathname, search } = window.location
    window.history.replaceState(null, "", `${pathname}${search}`)
  } catch {}
}

function mensajeDeEnlace(texto: string) {
  if (/expired|invalid|access_denied|otp/i.test(texto))
    return "El enlace venció o ya se usó. Pedí uno nuevo."
  return texto || "No se pudo abrir el enlace de la cuenta."
}

// El enlace del correo vuelve con los tokens en el hash. Se piden los datos de la cuenta, se guarda la
// sesión y se borra el hash. Si fue un problema de red, el hash se conserva para reintentar al
// recargar; si el enlace venció, se limpia y se pide otro.
export async function procesarEnlaceCuenta(): Promise<{
  sesion: Sesion | null
  error?: string
}> {
  if (typeof window === "undefined") return { sesion: null }
  const hash = window.location.hash.replace(/^#/, "")
  if (!hash) return { sesion: null }
  const params = new URLSearchParams(hash)
  const fallo = params.get("error_description") || params.get("error")
  if (fallo) {
    limpiarHash()
    return { sesion: null, error: mensajeDeEnlace(fallo) }
  }
  const tipo = params.get("type") || ""
  // La app no usa el hash para navegar, pero si otro enlace trae uno, no se toca.
  if (tipo && tipo !== "magiclink" && tipo !== "signup") return { sesion: null }
  const accessToken = params.get("access_token") || ""
  const refreshToken = params.get("refresh_token") || ""
  if (!accessToken || !refreshToken) return { sesion: null }
  if (!cuentaDisponible()) {
    limpiarHash()
    return { sesion: null, error: explicarErrorCuenta("sin-nube") }
  }
  if (typeof fetch !== "function")
    return {
      sesion: null,
      error:
        "Sin conexión: el enlace quedó guardado, recargá cuando vuelvas a tener red.",
    }
  try {
    const respuesta = await fetch(`${URL_NUBE}/auth/v1/user`, {
      headers: {
        apikey: CLAVE_NUBE,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!respuesta.ok) {
      if (respuesta.status === 401 || respuesta.status === 403) {
        limpiarHash()
        return {
          sesion: null,
          error: "El enlace venció o ya se usó. Pedí uno nuevo.",
        }
      }
      return {
        sesion: null,
        error:
          "No se pudo comprobar el enlace: revisá tu conexión y recargá la página.",
      }
    }
    const usuario = (await respuesta.json().catch(() => null)) as {
      id?: unknown
      email?: unknown
    } | null
    if (typeof usuario?.id !== "string") {
      limpiarHash()
      return {
        sesion: null,
        error: "La nube no devolvió la cuenta del enlace. Probá de nuevo.",
      }
    }
    const segundos = Number(params.get("expires_in"))
    const sesion: Sesion = {
      accessToken,
      refreshToken,
      expiraEn:
        Date.now() + (Number.isFinite(segundos) ? segundos : 3600) * 1000,
      usuario: {
        id: usuario.id,
        email: typeof usuario.email === "string" ? usuario.email : "",
      },
    }
    guardarSesion(sesion)
    limpiarHash()
    return { sesion }
  } catch {
    return {
      sesion: null,
      error:
        "No se pudo llegar a la nube: el enlace quedó guardado, recargá cuando vuelvas a tener red.",
    }
  }
}

// Pide el enlace mágico. `redirect_to` tiene que estar entre las Redirect URLs del proyecto (ver
// supabase/README.md); si no, Supabase manda al Site URL.
export async function enviarEnlace(correo: string): Promise<RespuestaCuenta> {
  const limpio = (correo || "").trim().toLowerCase()
  if (!correoValido(limpio))
    return {
      ok: false,
      error: "Escribí un correo válido, por ejemplo ana@ejemplo.com.",
    }
  const destino =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname}`
  const consulta = destino
    ? `?redirect_to=${encodeURIComponent(destino)}`
    : ""
  const respuesta = await pedirCuenta(`/auth/v1/otp${consulta}`, {
    metodo: "POST",
    cuerpo: { email: limpio, create_user: true },
  })
  return respuesta.ok
    ? { ok: true }
    : { ok: false, error: explicarErrorCuenta(respuesta.error) }
}


async function renovarSesion(sesion: Sesion): Promise<Sesion | null> {
  const respuesta = await pedirCuenta(
    "/auth/v1/token?grant_type=refresh_token",
    { metodo: "POST", cuerpo: { refresh_token: sesion.refreshToken } },
  )
  if (!respuesta.ok) {
    // Solo se olvida la sesión cuando el servidor dice que el refresh token no sirve. Un corte de
    // red o un 429 no deben cerrar la sesión de nadie.
    if (
      respuesta.estado === 400 ||
      respuesta.estado === 401 ||
      respuesta.estado === 403
    ) {
      olvidarSesion()
      return null
    }
    return sesion
  }
  const nueva = sesionDesdeRespuesta(respuesta.datos, sesion)
  if (!nueva) {
    olvidarSesion()
    return null
  }
  guardarSesion(nueva)
  return nueva
}

// La sesión lista para usar. Si todavía no venció, vuelve tal cual; si está por vencer, se renueva.
// Sin red devuelve la que había: es mejor dejar la tarjeta como estaba que expulsar a alguien por
// estar en el subterráneo.
export async function asegurarSesion(
  sesion: Sesion | null = leerSesion(),
): Promise<Sesion | null> {
  if (!sesion) return null
  if (sesion.expiraEn > Date.now() + MARGEN_RENOVACION) return sesion
  if (!cuentaDisponible() || typeof fetch !== "function") return sesion
  return renovarSesion(sesion)
}

// Cerrar sesión siempre funciona, aunque la nube no conteste: lo que importa es que este teléfono
// deje de tener la llave. Los datos locales se quedan (modo invitado).
//
// `global` cierra la sesión en todos los dispositivos de la cuenta (`scope=global`): Supabase invalida
// los refresh tokens, así que los otros teléfonos no pueden renovar el acceso. Se usa en «Cerrar
// sesión en todos», después de desvincularlos para que además dejen de sincronizar.
export async function cerrarSesion(
  sesion: Sesion | null,
  opciones: { global?: boolean } = {},
): Promise<RespuestaCuenta> {
  if (sesion && cuentaDisponible() && typeof fetch === "function")
    await pedirCuenta(
      `/auth/v1/logout${opciones.global ? "?scope=global" : ""}`,
      { metodo: "POST", sesion },
    )
  olvidarSesion()
  return { ok: true }
}

// Vincula este teléfono a la cuenta. La función de la base comprueba las dos cosas: que haya sesión
// (`auth.uid()`) y que quien llama conozca el token del dispositivo. El id solo no alcanza.
export async function reclamarDispositivo(
  sesion: Sesion,
): Promise<RespuestaConSesion> {
  const activa = await asegurarSesion(sesion)
  if (!activa)
    return {
      ok: false,
      error: "La sesión venció. Pedí un enlace nuevo para volver a entrar.",
    }
  const { id, token } = dispositivo()
  const respuesta = await pedirCuenta(
    "/rest/v1/rpc/reclamar_dispositivo",
    {
      metodo: "POST",
      sesion: activa,
      cuerpo: { p_dispositivo: id, p_token: token },
    },
  )
  if (!respuesta.ok)
    return {
      ok: false,
      error: explicarErrorCuenta(respuesta.error),
      sesion: activa,
    }
  const datos = respuesta.datos as { ok?: unknown } | null
  if (datos?.ok !== true)
    return {
      ok: false,
      error: "La nube no confirmó la vinculación. Probá de nuevo.",
      sesion: activa,
    }
  marcarVinculo(activa.usuario.id)
  return { ok: true, sesion: activa }
}


// Desvincular este teléfono: la cuenta sigue viva, pero deja de tenerlo en su lista.
export async function desvincularDispositivo(
  sesion: Sesion,
): Promise<RespuestaConSesion> {
  const activa = await asegurarSesion(sesion)
  if (!activa)
    return {
      ok: false,
      error: "La sesión venció. Pedí un enlace nuevo para volver a entrar.",
    }
  const { id } = dispositivo()
  const respuesta = await pedirCuenta(
    "/rest/v1/rpc/desvincular_dispositivo",
    {
      metodo: "POST",
      sesion: activa,
      cuerpo: { p_dispositivo: id },
    },
  )
  if (!respuesta.ok)
    return {
      ok: false,
      error: explicarErrorCuenta(respuesta.error),
      sesion: activa,
    }
  olvidarVinculo()
  return { ok: true, sesion: activa }
}

// Renombrar un teléfono de la cuenta. El nombre es una etiqueta para reconocerlo en la lista; no
// cambia la identidad del dispositivo ni su token. La función de la base comprueba que el teléfono
// esté vinculado a quien llama.
export async function renombrarDispositivo(
  sesion: Sesion,
  dispositivoId: string,
  nombre: string,
): Promise<RespuestaConSesion> {
  const limpio = (nombre || "").trim()
  if (!limpio || limpio.length > 40)
    return {
      ok: false,
      error: "Escribí un nombre de hasta 40 caracteres.",
      sesion,
    }
  const activa = await asegurarSesion(sesion)
  if (!activa)
    return {
      ok: false,
      error: "La sesión venció. Pedí un enlace nuevo para volver a entrar.",
    }
  const respuesta = await pedirCuenta("/rest/v1/rpc/renombrar_dispositivo", {
    metodo: "POST",
    sesion: activa,
    cuerpo: { p_dispositivo: dispositivoId, p_nombre: limpio },
  })
  if (!respuesta.ok)
    return {
      ok: false,
      error: explicarErrorCuenta(respuesta.error),
      sesion: activa,
    }
  const datos = respuesta.datos as { ok?: unknown } | null
  if (datos?.ok !== true)
    return {
      ok: false,
      error: "La nube no confirmó el nuevo nombre. Probá de nuevo.",
      sesion: activa,
    }
  return { ok: true, sesion: activa }
}

// Cerrar la sesión de OTRO teléfono: se borra su vínculo con la cuenta. La próxima vez que ese
// equipo sincronice recibe «dispositivo no vinculado» y deja de subir y bajar. El access token que
// tenga guardado vence solo (o se invalida con el cierre global).
export async function revocarDispositivo(
  sesion: Sesion,
  dispositivoId: string,
): Promise<RespuestaConSesion> {
  const activa = await asegurarSesion(sesion)
  if (!activa)
    return {
      ok: false,
      error: "La sesión venció. Pedí un enlace nuevo para volver a entrar.",
    }
  const respuesta = await pedirCuenta(
    "/rest/v1/rpc/desvincular_dispositivo",
    {
      metodo: "POST",
      sesion: activa,
      cuerpo: { p_dispositivo: dispositivoId },
    },
  )
  if (!respuesta.ok)
    return {
      ok: false,
      error: explicarErrorCuenta(respuesta.error),
      sesion: activa,
    }
  const datos = respuesta.datos as { ok?: unknown } | null
  if (datos?.ok !== true)
    return {
      ok: false,
      error: "La nube no confirmó el cierre de esa sesión. Probá de nuevo.",
      sesion: activa,
    }
  if (dispositivo().id === dispositivoId) olvidarVinculo()
  return { ok: true, sesion: activa }
}

// «Cerrar sesión en todos»: primero se desvinculan todos los teléfonos (así ninguno puede seguir
// sincronizando) y después se cierra la sesión global. El orden importa: la función de la base
// necesita el access token vigente.
export async function revocarTodosDispositivos(
  sesion: Sesion,
): Promise<RespuestaConSesion> {
  const activa = await asegurarSesion(sesion)
  if (!activa)
    return {
      ok: false,
      error: "La sesión venció. Pedí un enlace nuevo para volver a entrar.",
    }
  const respuesta = await pedirCuenta(
    "/rest/v1/rpc/desvincular_todos_dispositivos",
    { metodo: "POST", sesion: activa, cuerpo: {} },
  )
  if (!respuesta.ok)
    return {
      ok: false,
      error: explicarErrorCuenta(respuesta.error),
      sesion: activa,
    }
  const datos = respuesta.datos as { ok?: unknown } | null
  if (datos?.ok !== true)
    return {
      ok: false,
      error: "La nube no confirmó el cierre en todos. Probá de nuevo.",
      sesion: activa,
    }
  olvidarVinculo()
  return { ok: true, sesion: activa }
}

// El motor llama a esto cuando la nube contesta que este teléfono ya no está vinculado (lo cerraron
// desde otro equipo). La sesión sigue abierta para poder volver a vincularlo desde Ajustes.
export function olvidarVinculoTelefono() {
  olvidarVinculo()
}

// Los teléfonos vinculados a la cuenta. El nombre propio de la cuenta (0006) tiene prioridad sobre
// el nombre genérico del dispositivo; si no hay ninguno, queda «Este dispositivo».
export async function misDispositivos(sesion: Sesion): Promise<{
  ok: boolean
  datos?: DispositivoCuenta[]
  error?: string
  sesion?: Sesion
}> {
  const activa = await asegurarSesion(sesion)
  if (!activa)
    return {
      ok: false,
      error: "La sesión venció. Pedí un enlace nuevo para volver a entrar.",
    }
  const respuesta = await pedirCuenta("/rest/v1/rpc/mis_dispositivos", {
    metodo: "POST",
    sesion: activa,
    cuerpo: {},
  })
  if (!respuesta.ok)
    return {
      ok: false,
      error: explicarErrorCuenta(respuesta.error),
      sesion: activa,
    }
  const filas = Array.isArray(respuesta.datos) ? respuesta.datos : []
  const datos: DispositivoCuenta[] = filas
    .map((fila) => {
      const f = fila as {
        dispositivo_id?: unknown
        nombre?: unknown
        reclamado_en?: unknown
        ultima_conexion?: unknown
      }
      return {
        dispositivoId:
          typeof f.dispositivo_id === "string" ? f.dispositivo_id : "",
        nombre: typeof f.nombre === "string" ? f.nombre : "Este dispositivo",
        reclamadoEn: typeof f.reclamado_en === "string" ? f.reclamado_en : "",
        ultimaConexion:
          typeof f.ultima_conexion === "string" ? f.ultima_conexion : "",
      }
    })
    .filter((d) => !!d.dispositivoId)
  return { ok: true, datos, sesion: activa }
}

