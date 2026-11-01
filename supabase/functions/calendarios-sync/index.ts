// Edge Function de AVISPATE · Etapa 16: subir y bajar eventos del calendario.
//
// El navegador manda la foto de sus recordatorios y el id de la conexión. Esta función:
//
//   * comprueba la sesión y que la conexión sea de esa persona;
//   * elige el adaptador (`simulado` o `google`) sin que el resto del código sepa cuál es;
//   * crea o actualiza cada evento y guarda el id externo para no duplicar;
//   * con `completo: true`, borra del calendario lo que ya no está en la foto;
//   * baja cambios desde el proveedor con el cursor (`syncToken` en Google);
//   * renueva el access token si está por vencer y guarda el nuevo cifrado.
//
// Los tokens nunca salen de acá. En modo simulado no hay tokens ni llamadas a Google.
import { createClient } from "jsr:@supabase/supabase-js@2"

const cabeceras = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras })

const GOOGLE_BASE = "https://www.googleapis.com/calendar/v3"
const MAX_EVENTOS = 200
const CAMPOS_PUBLICOS =
  "id, perfil_id, proveedor, cuenta_email, calendario_externo, nombre, activo, modo, ultima_sincronizacion, ultimo_error, creado_en"

function configuracion() {
  return {
    url: (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, ""),
    servicio: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    clientId: Deno.env.get("GOOGLE_CLIENT_ID") || "",
    clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
    tokenKey: Deno.env.get("CALENDARIOS_TOKEN_KEY") || "",
  }
}
type Config = ReturnType<typeof configuracion>

function administrador(cfg: Config) {
  return createClient(cfg.url, cfg.servicio, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
type Admin = ReturnType<typeof administrador>

async function usuarioDe(req: Request, admin: Admin) {
  const autorizacion = req.headers.get("Authorization") || ""
  const token = autorizacion.replace(/^Bearer\s+/i, "").trim()
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

function base64(bytes: Uint8Array) {
  let texto = ""
  for (const byte of bytes) texto += String.fromCharCode(byte)
  return btoa(texto)
}

// Web Crypto pide `ArrayBuffer` y no un `Uint8Array<ArrayBufferLike>`: se recorta el tramo exacto.
function bufferDe(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function claveAes(cfg: Config) {
  if (!cfg.tokenKey) return null
  try {
    const bytes = Uint8Array.from(atob(cfg.tokenKey), (c) => c.charCodeAt(0))
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

async function cifrar(texto: string, clave: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const llave = await crypto.subtle.importKey(
    "raw",
    bufferDe(clave),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  )
  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferDe(iv) },
    llave,
    new TextEncoder().encode(texto),
  )
  return { texto: base64(new Uint8Array(cifrado)), iv: base64(iv) }
}

async function descifrar(texto: string, ivTexto: string, clave: Uint8Array) {
  const iv = Uint8Array.from(atob(ivTexto), (c) => c.charCodeAt(0))
  const datos = Uint8Array.from(atob(texto), (c) => c.charCodeAt(0))
  const llave = await crypto.subtle.importKey(
    "raw",
    bufferDe(clave),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  )
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferDe(iv) },
    llave,
    bufferDe(datos),
  )
  return new TextDecoder().decode(claro)
}

type FilaCalendario = {
  id: string
  user_id: string
  perfil_id: string
  proveedor: string
  calendario_externo: string
  nombre: string | null
  activo: boolean
  modo: string
  token_acceso_cifrado: string | null
  token_renovacion_cifrado: string | null
  token_iv: string | null
  token_renovacion_iv: string | null
  token_expira_en: string | null
  scope: string | null
  cursor_sync: string | null
  ultima_sincronizacion: string | null
  ultimo_error: string | null
}

type EventoEntrada = {
  recordatorioId: string
  titulo: string
  inicio: string
  fin: string
  todoElDia: boolean
  notas?: string
  actualizadoEn: string
  zona?: string
}

type CambioRemoto = {
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

type ResultadoPush = { id: string; etag?: string }
type ResultadoBajada = { cambios: CambioRemoto[]; cursor: string | null }

// Interfaz que comparten Google y el simulador. El resto de la función no sabe cuál está detrás.
interface AdaptadorCalendario {
  crear(evento: EventoEntrada): Promise<ResultadoPush>
  actualizar(externo: string, evento: EventoEntrada): Promise<ResultadoPush>
  borrar(externo: string): Promise<void>
  bajar(cursor: string | null): Promise<ResultadoBajada>
}

// ---------------------------------------------------------------------------------------------
// Adaptador simulado: mismos métodos, sin red. El id externo es estable y el cursor avanza con la
// fecha, así una segunda pasada actualiza el mismo evento en vez de crear otro.
// ---------------------------------------------------------------------------------------------
class Simulado implements AdaptadorCalendario {
  async crear(evento: EventoEntrada): Promise<ResultadoPush> {
    return { id: `sim-${evento.recordatorioId}`, etag: `sim-${Date.now()}` }
  }
  async actualizar(externo: string, _evento: EventoEntrada): Promise<ResultadoPush> {
    return { id: externo, etag: `sim-${Date.now()}` }
  }
  async borrar(_externo: string) {
    // No hay nada que borrar fuera de la base.
  }
  async bajar(cursor: string | null): Promise<ResultadoBajada> {
    return { cambios: [], cursor: cursor || `sim-${Date.now()}` }
  }
}

// ---------------------------------------------------------------------------------------------
// Adaptador de Google Calendar. Se usa en modo real; la lógica de tokens queda fuera de él.
// ---------------------------------------------------------------------------------------------
function eventoGoogle(evento: EventoEntrada) {
  const cuerpo: Record<string, unknown> = {
    summary: evento.titulo,
    description: evento.notas || "",
    extendedProperties: { private: { avispate_id: evento.recordatorioId } },
    reminders: { useDefault: true },
  }
  if (evento.todoElDia) {
    cuerpo.start = { date: evento.inicio.slice(0, 10) }
    cuerpo.end = { date: evento.fin.slice(0, 10) }
  } else {
    cuerpo.start = {
      dateTime: evento.inicio,
      timeZone: evento.zona || "UTC",
    }
    cuerpo.end = { dateTime: evento.fin, timeZone: evento.zona || "UTC" }
  }
  return cuerpo
}

type RespuestaGoogle = {
  id?: string
  etag?: string
  status?: string
  summary?: string
  description?: string
  updated?: string
  nextSyncToken?: string
  nextPageToken?: string
  items?: RespuestaGoogle[]
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
  extendedProperties?: { private?: { avispate_id?: string } }
  error?: { message?: string }
}

class Google implements AdaptadorCalendario {
  constructor(
    private token: string,
    private calendario: string,
  ) {}

  private async pedir(ruta: string, init: RequestInit = {}) {
    const respuesta = await fetch(`${GOOGLE_BASE}${ruta}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    })
    const datos = (await respuesta.json().catch(() => ({}))) as RespuestaGoogle
    if (!respuesta.ok)
      throw new Error(
        datos.error?.message ||
          `Google respondió con un error (${respuesta.status}).`,
      )
    return datos
  }

  async crear(evento: EventoEntrada) {
    const datos = await this.pedir(
      `/calendars/${encodeURIComponent(this.calendario)}/events?sendUpdates=none`,
      { method: "POST", body: JSON.stringify(eventoGoogle(evento)) },
    )
    if (!datos.id) throw new Error("Google no devolvió el id del evento.")
    return { id: datos.id, etag: datos.etag }
  }

  async actualizar(externo: string, evento: EventoEntrada) {
    const datos = await this.pedir(
      `/calendars/${encodeURIComponent(this.calendario)}/events/${encodeURIComponent(externo)}?sendUpdates=none`,
      { method: "PATCH", body: JSON.stringify(eventoGoogle(evento)) },
    )
    return { id: datos.id || externo, etag: datos.etag }
  }

  async borrar(externo: string) {
    const respuesta = await fetch(
      `${GOOGLE_BASE}/calendars/${encodeURIComponent(this.calendario)}/events/${encodeURIComponent(externo)}?sendUpdates=none`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.token}` },
      },
    )
    // 404/410: ya no está; el resultado buscado es el mismo.
    if (!respuesta.ok && respuesta.status !== 404 && respuesta.status !== 410)
      throw new Error(`No se pudo borrar el evento (${respuesta.status}).`)
  }

  async bajar(cursor: string | null): Promise<ResultadoBajada> {
    if (cursor) {
      try {
        return await this.bajarCon(cursor)
      } catch (e) {
        // Google invalida el syncToken viejo con 410. Se reinicia una vez desde la ventana de 90
        // días; si tampoco funciona, el error sube y queda en `ultimo_error`.
        if (!/410|sync token/i.test(String(e))) throw e
      }
    }
    return this.bajarCon(null)
  }

  private async bajarCon(cursor: string | null): Promise<ResultadoBajada> {
    const cambios: CambioRemoto[] = []
    let pageToken: string | undefined
    let siguienteCursor: string | null = null

    // Google devuelve `nextSyncToken` solo en la última página. Con `nextPageToken` hay que seguir
    // pidiendo: si no, una cuenta con más de 250 eventos (o con repeticiones expandidas) se queda sin
    // cursor y vuelve a bajar todo desde cero en cada sincronización.
    do {
      const parametros = new URLSearchParams({
        maxResults: "250",
        showDeleted: "true",
        singleEvents: "true",
      })
      if (cursor) parametros.set("syncToken", cursor)
      else {
        // Primera bajada: últimos 90 días. Sin ventana, una cuenta grande devolvería años de historia.
        const desde = new Date(Date.now() - 90 * 86400_000).toISOString()
        parametros.set("timeMin", desde)
        parametros.set("orderBy", "startTime")
      }
      if (pageToken) parametros.set("pageToken", pageToken)

      const datos = await this.pedir(
        `/calendars/${encodeURIComponent(this.calendario)}/events?${parametros.toString()}`,
      )
      for (const item of datos.items || []) {
        const recordatorioId =
          item.extendedProperties?.private?.avispate_id || ""
        if (!recordatorioId) continue
        const todoElDia = !!(item.start?.date || item.end?.date)
        cambios.push({
          recordatorioId,
          titulo: item.summary || "Recordatorio",
          inicio:
            item.start?.dateTime || item.start?.date || new Date().toISOString(),
          fin: item.end?.dateTime || item.end?.date || new Date().toISOString(),
          todoElDia,
          notas: item.description || "",
          eliminado: item.status === "cancelled",
          actualizadoEn: item.updated || new Date().toISOString(),
          zona: item.start?.timeZone || undefined,
        })
      }
      pageToken = datos.nextPageToken
      if (datos.nextSyncToken) siguienteCursor = datos.nextSyncToken
    } while (pageToken)

    // `singleEvents` expande una repetición en varias instancias con el mismo `avispate_id`. Para la
    // app es un solo recordatorio: se queda con el último cambio, salvo que una instancia siga viva
    // (entonces no se toma como borrado).
    const porRecordatorio = new Map<string, CambioRemoto>()
    for (const cambio of cambios) {
      const previo = porRecordatorio.get(cambio.recordatorioId)
      if (!previo) {
        porRecordatorio.set(cambio.recordatorioId, cambio)
        continue
      }
      if (previo.eliminado && !cambio.eliminado) {
        porRecordatorio.set(cambio.recordatorioId, cambio)
        continue
      }
      if (
        previo.eliminado === cambio.eliminado &&
        Date.parse(cambio.actualizadoEn) >= Date.parse(previo.actualizadoEn)
      )
        porRecordatorio.set(cambio.recordatorioId, cambio)
    }

    return {
      cambios: [...porRecordatorio.values()],
      cursor: siguienteCursor || cursor,
    }
  }
}


// ---------------------------------------------------------------------------------------------
// Token de Google: se descifra solo acá y se renueva si está por vencer.
// ---------------------------------------------------------------------------------------------
async function tokenDeGoogle(
  admin: Admin,
  cfg: Config,
  fila: FilaCalendario,
  clave: Uint8Array,
) {
  if (!fila.token_acceso_cifrado || !fila.token_iv)
    throw new Error("La conexión no tiene un token de acceso.")

  let acceso = await descifrar(
    fila.token_acceso_cifrado,
    fila.token_iv,
    clave,
  )
  const vence = fila.token_expira_en ? Date.parse(fila.token_expira_en) : 0
  const porVencer = !vence || vence <= Date.now() + 60_000
  if (!porVencer) return acceso

  if (
    !fila.token_renovacion_cifrado ||
    !fila.token_renovacion_iv ||
    !cfg.clientId ||
    !cfg.clientSecret
  )
    return acceso

  let renovacion: string
  try {
    renovacion = await descifrar(
      fila.token_renovacion_cifrado,
      fila.token_renovacion_iv,
      clave,
    )
  } catch {
    return acceso
  }

  const respuesta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: renovacion,
      grant_type: "refresh_token",
    }),
  })
  const datos = await respuesta.json().catch(() => ({}))
  if (!respuesta.ok || !datos.access_token)
    throw new Error("Google no renovó el acceso. Volvé a conectar la cuenta.")

  acceso = String(datos.access_token)
  const nuevoAcceso = await cifrar(acceso, clave)
  const nuevaRenovacion = datos.refresh_token
    ? await cifrar(String(datos.refresh_token), clave)
    : null

  await admin
    .from("calendarios_cuenta")
    .update({
      token_acceso_cifrado: nuevoAcceso.texto,
      token_iv: nuevoAcceso.iv,
      token_renovacion_cifrado:
        nuevaRenovacion?.texto || fila.token_renovacion_cifrado,
      token_renovacion_iv:
        nuevaRenovacion?.iv || fila.token_renovacion_iv,
      token_expira_en: new Date(
        Date.now() + Math.max(60, Number(datos.expires_in) || 3600) * 1000,
      ).toISOString(),
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", fila.id)

  return acceso
}

async function adaptadorPara(
  admin: Admin,
  cfg: Config,
  fila: FilaCalendario,
): Promise<AdaptadorCalendario> {
  if (fila.modo === "simulado") return new Simulado()
  if (fila.proveedor !== "google")
    throw new Error("Ese proveedor todavía no está conectado.")
  const clave = claveAes(cfg)
  if (!clave) throw new Error("Falta CALENDARIOS_TOKEN_KEY en la nube.")
  const token = await tokenDeGoogle(admin, cfg, fila, clave)
  return new Google(token, fila.calendario_externo || "primary")
}

// ---------------------------------------------------------------------------------------------
// Validación de la foto que manda el teléfono. Acota tamaños para que una sesión no pueda subir
// megabytes ni 10.000 eventos en una llamada.
// ---------------------------------------------------------------------------------------------
function normalizarEvento(valor: unknown): EventoEntrada | null {
  if (!valor || typeof valor !== "object") return null
  const e = valor as Record<string, unknown>
  const texto = (v: unknown, max: number) =>
    typeof v === "string" ? v.slice(0, max) : ""
  const recordatorioId = texto(e.recordatorioId, 200)
  const inicio = texto(e.inicio, 64)
  const fin = texto(e.fin, 64)
  if (!recordatorioId || !inicio || !fin) return null
  return {
    recordatorioId,
    titulo: texto(e.titulo, 500) || "Recordatorio",
    inicio,
    fin,
    todoElDia: !!e.todoElDia,
    notas: texto(e.notas, 4000),
    actualizadoEn: texto(e.actualizadoEn, 64) || new Date().toISOString(),
    zona: texto(e.zona, 80) || undefined,
  }
}


type Enlace = {
  recordatorio_id: string
  evento_externo_id: string | null
  estado: string
}

async function guardarEnlace(
  admin: Admin,
  fila: FilaCalendario,
  evento: EventoEntrada,
  externo: string | null,
  etag: string | null,
  estado: "sincronizado" | "error" | "borrado",
  error: string | null,
) {
  const ahora = new Date().toISOString()
  const { error: errorGuardar } = await admin
    .from("eventos_calendario")
    .upsert(
      {
        calendario_id: fila.id,
        user_id: fila.user_id,
        recordatorio_id: evento.recordatorioId,
        evento_externo_id: externo,
        etag,
        estado,
        payload: evento,
        actualizado_en: evento.actualizadoEn || ahora,
        sincronizado_en: estado === "sincronizado" ? ahora : null,
        ultimo_error: error,
      },
      { onConflict: "calendario_id,recordatorio_id" },
    )
  if (errorGuardar) throw new Error("No se pudo guardar el enlace del evento.")
}

async function sincronizar(
  req: Request,
  cfg: Config,
  admin: Admin,
  userId: string,
) {
  let cuerpo: {
    calendarioId?: string
    eventos?: unknown
    completo?: boolean
  } = {}
  try {
    cuerpo = await req.json()
  } catch {
    return responder({ ok: false, error: "cuerpo inválido" }, 400)
  }

  const calendarioId = String(cuerpo.calendarioId || "")
  if (!calendarioId)
    return responder({ ok: false, error: "falta calendarioId" }, 400)

  if (!Array.isArray(cuerpo.eventos))
    return responder({ ok: false, error: "faltan eventos" }, 400)
  if (cuerpo.eventos.length > MAX_EVENTOS)
    return responder(
      { ok: false, error: `Máximo ${MAX_EVENTOS} recordatorios por sincronización.` },
      400,
    )

  const eventos = cuerpo.eventos
    .map(normalizarEvento)
    .filter((e): e is EventoEntrada => !!e)

  const { data, error } = await admin
    .from("calendarios_cuenta")
    .select("*")
    .eq("id", calendarioId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error || !data)
    return responder({ ok: false, error: "calendario no encontrado" }, 404)
  const fila = data as FilaCalendario
  if (!fila.activo)
    return responder({ ok: false, error: "el calendario está desconectado" }, 409)

  let adaptador: AdaptadorCalendario
  try {
    adaptador = await adaptadorPara(admin, cfg, fila)
  } catch (e) {
    const motivo = String(e).slice(0, 240)
    await admin
      .from("calendarios_cuenta")
      .update({ ultimo_error: motivo, actualizado_en: new Date().toISOString() })
      .eq("id", fila.id)
    return responder({ ok: false, error: motivo }, 502)
  }

  const { data: enlacesData } = await admin
    .from("eventos_calendario")
    .select("recordatorio_id,evento_externo_id,estado")
    .eq("calendario_id", fila.id)
  const enlaces = new Map(
    ((enlacesData || []) as Enlace[]).map((e) => [e.recordatorio_id, e]),
  )

  const vistos = new Set<string>()
  let subidos = 0
  let borrados = 0
  let errores = 0
  let primerError = ""

  for (const evento of eventos) {
    vistos.add(evento.recordatorioId)
    const enlace = enlaces.get(evento.recordatorioId)
    const externo =
      enlace && enlace.estado !== "borrado" ? enlace.evento_externo_id : null
    try {
      const resultado = externo
        ? await adaptador.actualizar(externo, evento)
        : await adaptador.crear(evento)
      await guardarEnlace(
        admin,
        fila,
        evento,
        resultado.id,
        resultado.etag || null,
        "sincronizado",
        null,
      )
      subidos += 1
    } catch (e) {
      errores += 1
      if (!primerError) primerError = String(e).slice(0, 240)
      await guardarEnlace(
        admin,
        fila,
        evento,
        externo,
        null,
        "error",
        String(e).slice(0, 240),
      ).catch(() => {})
    }
  }


  // «Todos los avisos» manda la foto entera: lo que ya no está se borra también del calendario.
  // Con la lista parcial (solo los marcados) no se toca nada de lo que no vino.
  if (cuerpo.completo === true) {
    for (const enlace of enlaces.values()) {
      if (vistos.has(enlace.recordatorio_id)) continue
      if (enlace.estado === "borrado") continue
      try {
        if (enlace.evento_externo_id) await adaptador.borrar(enlace.evento_externo_id)
        const ahora = new Date().toISOString()
        await admin.from("eventos_calendario").upsert(
          {
            calendario_id: fila.id,
            user_id: fila.user_id,
            recordatorio_id: enlace.recordatorio_id,
            evento_externo_id: enlace.evento_externo_id,
            estado: "borrado",
            actualizado_en: ahora,
            sincronizado_en: ahora,
            ultimo_error: null,
          },
          { onConflict: "calendario_id,recordatorio_id" },
        )
        borrados += 1
      } catch (e) {
        errores += 1
        if (!primerError) primerError = String(e).slice(0, 240)
        await admin
          .from("eventos_calendario")
          .update({
            estado: "error",
            ultimo_error: String(e).slice(0, 240),
            actualizado_en: new Date().toISOString(),
          })
          .eq("calendario_id", fila.id)
          .eq("recordatorio_id", enlace.recordatorio_id)
      }
    }
  }

  let cursor = fila.cursor_sync
  let bajados = 0
  let cambios: CambioRemoto[] = []
  try {
    const bajada = await adaptador.bajar(cursor)
    cursor = bajada.cursor
    cambios = bajada.cambios
    bajados = cambios.length
  } catch (e) {
    errores += 1
    if (!primerError) primerError = `No se pudieron bajar cambios: ${String(e).slice(0, 200)}`
  }

  const ahora = new Date().toISOString()
  // Si el evento se borró en Google, el enlace queda marcado para que un push parcial posterior no
  // intente actualizar un evento que ya no existe y lo vuelva a crear con el mismo id.
  const borradosRemotos = cambios
    .filter((cambio) => cambio.eliminado)
    .map((cambio) => cambio.recordatorioId)
  if (borradosRemotos.length) {
    const { error: errorBorrados } = await admin
      .from("eventos_calendario")
      .update({
        estado: "borrado",
        actualizado_en: ahora,
        sincronizado_en: ahora,
        ultimo_error: null,
      })
      .eq("calendario_id", fila.id)
      .in("recordatorio_id", borradosRemotos)
    if (errorBorrados) {
      errores += 1
      if (!primerError)
        primerError = "No se pudo marcar un evento borrado en Google."
    }
  }
  const { data: actualizado, error: errorActualizar } = await admin
    .from("calendarios_cuenta")
    .update({
      cursor_sync: cursor,
      ultima_sincronizacion: ahora,
      ultimo_error: errores
        ? primerError || `${errores} evento(s) no se pudieron sincronizar.`
        : null,
      actualizado_en: ahora,
    })
    .eq("id", fila.id)
    .select(
      "id,perfil_id,proveedor,cuenta_email,calendario_externo,nombre,activo,modo,ultima_sincronizacion,ultimo_error,creado_en",
    )
    .single()
  if (errorActualizar)
    return responder(
      { ok: false, error: "No se pudo guardar el estado de la sincronización." },
      500,
    )

  return responder({
    ok: true,
    subidos,
    borrados,
    bajados,
    errores,
    cursor,
    cambios,
    calendario: actualizado,
  })
}

async function estado(admin: Admin, userId: string) {
  // Igual que en `calendarios-oauth`: la service_role no tiene `auth.uid()`, así que se filtra por
  // el usuario ya comprobado con `getUser` y se devuelven solo las columnas públicas.
  const { data, error } = await admin
    .from("calendarios_cuenta")
    .select(CAMPOS_PUBLICOS)
    .eq("user_id", userId)
    .order("proveedor", { ascending: true })
    .order("creado_en", { ascending: true })
  if (error) return responder({ ok: false, error: "no se pudo leer" }, 500)
  return responder({
    ok: true,
    calendarios: Array.isArray(data) ? data : [],
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cabeceras })

  const cfg = configuracion()
  const admin = administrador(cfg)
  const usuario = await usuarioDe(req, admin)
  if (!usuario) return responder({ ok: false, error: "sin sesión" }, 401)

  try {
    if (req.method === "GET") return await estado(admin, usuario.id)
    if (req.method !== "POST")
      return responder({ ok: false, error: "método no permitido" }, 405)

    let cuerpo: { accion?: string } = {}
    try {
      cuerpo = await req.clone().json()
    } catch {
      // Sin acción se asume sincronizar; el cuerpo real se vuelve a leer abajo.
    }
    if (cuerpo.accion === "estado") return await estado(admin, usuario.id)
    return await sincronizar(req, cfg, admin, usuario.id)
  } catch (e) {
    console.error("calendarios-sync", String(e))
    return responder(
      { ok: false, error: "No se pudo completar la sincronización." },
      500,
    )
  }
})

