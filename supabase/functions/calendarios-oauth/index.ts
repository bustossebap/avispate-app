// Edge Function de AVISPATE · Etapa 16: conectar Google Calendar.
//
// El navegador nunca ve un token de Google. Esta función:
//
//   1. `POST /iniciar` comprueba la sesión de Supabase y crea un `state` + PKCE en `oauth_estado`.
//      En modo real devuelve la URL de Google; en modo simulado crea una conexión de prueba.
//   2. `GET /callback/google` recibe el código, lo cambia por tokens, los cifra con AES-GCM y llama
//      a `completar_oauth`, que borra el state y guarda la conexión en una transacción.
//   3. `DESCONECTAR` revoca el token en Google (si se puede) y borra la fila local.
//   4. `GET /estado` devuelve solo las columnas públicas de las conexiones de la sesión.
//
// Se publica SIN verificación JWT porque Google no manda un JWT de Supabase al callback. Las rutas
// autenticadas comprueban el token a mano con `auth.getUser`; el callback se protege con el state de
// un solo uso y el intercambio del código.
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

const redirigir = (destino: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: destino, "Cache-Control": "no-store" },
  })

const SCOPES =
  "openid email https://www.googleapis.com/auth/calendar.events"

function configuracion() {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "")
  return {
    url,
    servicio: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    clientId: Deno.env.get("GOOGLE_CLIENT_ID") || "",
    clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
    redirectUri:
      Deno.env.get("GOOGLE_REDIRECT_URI") ||
      `${url}/functions/v1/calendarios-oauth/callback/google`,
    appUrl: (Deno.env.get("CALENDARIOS_APP_URL") ||
      "https://avispate-app.vercel.app").replace(/\/+$/, ""),
    appsPermitidas: (Deno.env.get("CALENDARIOS_APP_URLS") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    modo:
      (Deno.env.get("CALENDARIOS_MODO") || "simulado").toLowerCase() === "real"
        ? "real"
        : "simulado",
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

// Comprueba el Bearer contra Supabase Auth. No acepta la anon key como identidad: `getUser`
// devuelve error para un JWT sin usuario.
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

function base64url(bytes: Uint8Array) {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// Web Crypto pide `ArrayBuffer` y no un `Uint8Array<ArrayBufferLike>`: se recorta el tramo exacto.
function bufferDe(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function azar(bytes = 32) {
  const valor = new Uint8Array(bytes)
  crypto.getRandomValues(valor)
  return base64url(valor)
}

async function sha256(texto: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  )
  return base64url(new Uint8Array(hash))
}

// La clave viaja en base64 (32 bytes = AES-256). Si falta o no mide lo que debe, el modo real no
// guarda tokens: es preferible fallar la conexión a dejar un refresh token en claro.
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
  return {
    texto: base64(new Uint8Array(cifrado)),
    iv: base64(iv),
  }
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

function correoDelIdToken(idToken: string) {
  try {
    const parte = idToken.split(".")[1]
    if (!parte) return ""
    const normal = parte.replace(/-/g, "+").replace(/_/g, "/")
    const relleno = normal + "=".repeat((4 - (normal.length % 4)) % 4)
    const datos = JSON.parse(atob(relleno))
    return typeof datos.email === "string" ? datos.email : ""
  } catch {
    return ""
  }
}

// Solo se acepta volver a una dirección conocida. Así un `Origin` inventado no puede convertir el
// callback en un redirect abierto.
function origenPermitido(req: Request, cfg: Config) {
  const permitidas = new Set(
    [cfg.appUrl, ...cfg.appsPermitidas].map((u) =>
      u.replace(/\/+$/, "").toLowerCase(),
    ),
  )
  const origen = (req.headers.get("Origin") || "").replace(/\/+$/, "").toLowerCase()
  if (origen && permitidas.has(origen)) return origen
  return cfg.appUrl
}


type FilaCalendario = {
  id: string
  user_id: string
  perfil_id: string
  proveedor: string
  cuenta_email: string | null
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
  creado_en: string
}

const CAMPOS_PUBLICOS =
  "id, perfil_id, proveedor, cuenta_email, calendario_externo, nombre, activo, modo, ultima_sincronizacion, ultimo_error, creado_en"

// Lo único que puede salir de una fila: ni tokens cifrados ni IV.
function publico(fila: FilaCalendario) {
  return {
    id: fila.id,
    perfil_id: fila.perfil_id,
    proveedor: fila.proveedor,
    cuenta_email: fila.cuenta_email,
    calendario_externo: fila.calendario_externo,
    nombre: fila.nombre,
    activo: fila.activo,
    modo: fila.modo,
    ultima_sincronizacion: fila.ultima_sincronizacion,
    ultimo_error: fila.ultimo_error,
    creado_en: fila.creado_en,
  }
}

async function estado(req: Request, cfg: Config, admin: Admin) {
  const usuario = await usuarioDe(req, admin)
  if (!usuario) return responder({ ok: false, error: "sin sesión" }, 401)
  // La RPC `mis_calendarios()` usa `auth.uid()`, que queda NULL con la service_role. Acá ya
  // comprobamos el Bearer con `getUser`, así que filtramos por ese id y pedimos solo lo público.
  const { data, error } = await admin
    .from("calendarios_cuenta")
    .select(CAMPOS_PUBLICOS)
    .eq("user_id", usuario.id)
    .order("proveedor", { ascending: true })
    .order("creado_en", { ascending: true })
  if (error) return responder({ ok: false, error: "no se pudo leer" }, 500)
  return responder({
    ok: true,
    modo: cfg.modo,
    calendarios: Array.isArray(data) ? data : [],
  })
}

// En modo simulado no se llama a Google: se crea una fila `modo = 'simulado'` que el adaptador de
// `calendarios-sync` entiende. Es la misma interfaz y el mismo contrato, sin tokens.
async function conexionSimulada(
  admin: Admin,
  userId: string,
  perfilId: string,
) {
  const { data, error } = await admin
    .from("calendarios_cuenta")
    .upsert(
      {
        user_id: userId,
        perfil_id: perfilId,
        proveedor: "google",
        cuenta_email: "cuenta-simulada@avispate.local",
        calendario_externo: "primary",
        nombre: "Calendario de prueba",
        activo: true,
        modo: "simulado",
        token_acceso_cifrado: null,
        token_renovacion_cifrado: null,
        token_iv: null,
        token_renovacion_iv: null,
        token_expira_en: null,
        ultimo_error: null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "user_id,perfil_id,proveedor,calendario_externo" },
    )
    .select("*")
    .single()
  if (error || !data) throw new Error("no se pudo crear la conexión de prueba")
  return publico(data as FilaCalendario)
}

async function iniciar(req: Request, cfg: Config, admin: Admin) {
  const usuario = await usuarioDe(req, admin)
  if (!usuario) return responder({ ok: false, error: "sin sesión" }, 401)

  let cuerpo: { proveedor?: string; perfilId?: string } = {}
  try {
    cuerpo = await req.json()
  } catch {
    // Sin cuerpo se asume Google, que es el único proveedor de esta entrega.
  }
  const proveedor = (cuerpo.proveedor || "google").toLowerCase()
  const perfilId =
    String(cuerpo.perfilId || "yo")
      .trim()
      .slice(0, 120) || "yo"
  if (proveedor !== "google")
    return responder(
      { ok: false, error: "Por ahora solo se puede conectar Google Calendar." },
      400,
    )

  if (cfg.modo === "simulado") {
    try {
      const calendario = await conexionSimulada(admin, usuario.id, perfilId)
      return responder({ ok: true, modo: "simulado", calendario })
    } catch (e) {
      console.error("calendarios-oauth · simulado", String(e))
      return responder(
        { ok: false, error: "No se pudo crear la conexión de prueba." },
        500,
      )
    }
  }

  if (!cfg.clientId || !cfg.clientSecret || !claveAes(cfg))
    return responder(
      {
        ok: false,
        error:
          "Falta configurar Google o la clave de cifrado en la nube (ver supabase/README.md).",
      },
      503,
    )

  // Limpieza oportunista: no bloquea la conexión si falla.
  try {
    await admin.rpc("purgar_oauth_estado")
  } catch {
    // La tabla se limpia igual en la próxima conexión.
  }

  const state = azar(32)
  const verifier = azar(48)
  const challenge = await sha256(verifier)
  const origen = origenPermitido(req, cfg)

  const { error } = await admin.from("oauth_estado").insert({
    estado: state,
    user_id: usuario.id,
    perfil_id: perfilId,
    proveedor,
    code_verifier: verifier,
    redirect_uri: cfg.redirectUri,
    origen,
    expira_en: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  if (error) {
    console.error("calendarios-oauth · state", error.message)
    return responder(
      { ok: false, error: "No se pudo iniciar la conexión. Probá de nuevo." },
      500,
    )
  }

  const parametros = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  })

  return responder({
    ok: true,
    modo: "real",
    url: `https://accounts.google.com/o/oauth2/v2/auth?${parametros.toString()}`,
  })
}

function volverA(origen: string, estado: string, motivo?: string) {
  const url = new URL(`${origen.replace(/\/+$/, "")}/`)
  url.searchParams.set("calendario", "google")
  url.searchParams.set("estado", estado)
  if (motivo) url.searchParams.set("motivo", motivo.slice(0, 180))
  return redirigir(url.toString())
}

type TokensGoogle = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

async function correoDeGoogle(accessToken: string) {
  try {
    const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return ""
    const datos = await r.json()
    return typeof datos.email === "string" ? datos.email : ""
  } catch {
    return ""
  }
}

async function callback(req: Request, cfg: Config, admin: Admin) {
  const url = new URL(req.url)
  const proveedor = url.pathname.split("/").filter(Boolean).pop() || ""
  const base = cfg.appUrl
  if (proveedor !== "google")
    return volverA(base, "error", "Proveedor no soportado.")

  const errorGoogle = url.searchParams.get("error")
  if (errorGoogle)
    return volverA(
      base,
      "error",
      url.searchParams.get("error_description") || errorGoogle,
    )

  const code = url.searchParams.get("code") || ""
  const state = url.searchParams.get("state") || ""
  if (!code || !state) return volverA(base, "error", "Faltó el código o el state.")

  const { data: fila, error: errorState } = await admin
    .from("oauth_estado")
    .select("*")
    .eq("estado", state)
    .gt("expira_en", new Date().toISOString())
    .maybeSingle()

  if (errorState || !fila)
    return volverA(base, "error", "El enlace venció o ya se usó. Probá de nuevo.")

  const origen = typeof fila.origen === "string" && fila.origen ? fila.origen : base
  if (fila.proveedor !== "google")
    return volverA(origen, "error", "El state no corresponde a Google.")

  const clave = claveAes(cfg)
  if (!cfg.clientId || !cfg.clientSecret || !clave)
    return volverA(origen, "error", "Falta configurar Google en la nube.")


  let tokens: TokensGoogle
  try {
    const respuesta = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: fila.redirect_uri || cfg.redirectUri,
        grant_type: "authorization_code",
        code_verifier: fila.code_verifier,
      }),
    })
    tokens = await respuesta.json()
    if (!respuesta.ok || !tokens.access_token)
      throw new Error(tokens.error_description || tokens.error || "sin token")
  } catch (e) {
    console.error("calendarios-oauth · canje", String(e))
    return volverA(origen, "error", "Google no confirmó la conexión.")
  }

  try {
    const acceso = await cifrar(tokens.access_token!, clave)
    const renovacion = tokens.refresh_token
      ? await cifrar(tokens.refresh_token, clave)
      : null
    const correo =
      correoDelIdToken(tokens.id_token || "") ||
      (await correoDeGoogle(tokens.access_token!))

    const { data, error } = await admin.rpc("completar_oauth", {
      p_estado: state,
      p_proveedor: "google",
      p_cuenta_email: correo,
      p_calendario_externo: "primary",
      p_nombre: "Google Calendar",
      p_token_acceso_cifrado: acceso.texto,
      p_token_renovacion_cifrado: renovacion ? renovacion.texto : null,
      p_token_iv: acceso.iv,
      p_token_renovacion_iv: renovacion ? renovacion.iv : null,
      p_token_expira_en: new Date(
        Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
      ).toISOString(),
      p_scope: tokens.scope || SCOPES,
      p_modo: "oauth",
    })

    if (error) {
      console.error("calendarios-oauth · guardar", error.message)
      return volverA(origen, "error", "No se pudo guardar la conexión.")
    }
    if (!data || !data.ok)
      return volverA(origen, "error", "No se pudo guardar la conexión.")
    return volverA(origen, "conectado")
  } catch (e) {
    console.error("calendarios-oauth · cifrado", String(e))
    return volverA(origen, "error", "No se pudo proteger la conexión.")
  }
}

async function desconectar(req: Request, cfg: Config, admin: Admin) {
  const usuario = await usuarioDe(req, admin)
  if (!usuario) return responder({ ok: false, error: "sin sesión" }, 401)

  let calendarioId = ""
  try {
    calendarioId = String((await req.json()).calendarioId || "")
  } catch {
    return responder({ ok: false, error: "falta calendarioId" }, 400)
  }
  if (!calendarioId)
    return responder({ ok: false, error: "falta calendarioId" }, 400)

  const { data, error } = await admin
    .from("calendarios_cuenta")
    .select("*")
    .eq("id", calendarioId)
    .eq("user_id", usuario.id)
    .maybeSingle()
  if (error || !data)
    return responder({ ok: false, error: "calendario no encontrado" }, 404)

  const fila = data as FilaCalendario
  const clave = claveAes(cfg)
  if (fila.modo === "oauth" && clave && fila.token_iv) {
    try {
      const usaRefresh = !!(fila.token_renovacion_cifrado && fila.token_renovacion_iv)
      const cifrado = usaRefresh
        ? fila.token_renovacion_cifrado
        : fila.token_acceso_cifrado
      const iv = usaRefresh ? fila.token_renovacion_iv : fila.token_iv
      if (cifrado && iv) {
        const token = await descifrar(cifrado, iv, clave)
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          },
        ).catch(() => {})
      }
    } catch {
      // Aunque la revocación falle, la llave local se borra igual.
    }
  }

  const { error: errorBorrar } = await admin
    .from("calendarios_cuenta")
    .delete()
    .eq("id", calendarioId)
    .eq("user_id", usuario.id)
  if (errorBorrar)
    return responder(
      { ok: false, error: "No se pudo desconectar. Probá de nuevo." },
      500,
    )
  return responder({ ok: true })
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cabeceras })

  const cfg = configuracion()
  const admin = administrador(cfg)
  const ruta = new URL(req.url).pathname.replace(/\/+$/, "")
  const es = (sufijo: string) => ruta.endsWith(sufijo)

  try {
    if (req.method === "GET" && es("/callback/google"))
      return await callback(req, cfg, admin)
    if (req.method === "GET" && es("/estado")) return await estado(req, cfg, admin)
    if (req.method === "POST" && (es("/iniciar") || es("/calendarios-oauth")))
      return await iniciar(req, cfg, admin)
    if (req.method === "POST" && es("/desconectar"))
      return await desconectar(req, cfg, admin)
    if (req.method === "GET" && es("/calendarios-oauth"))
      return responder({
        ok: true,
        funcion: "calendarios-oauth",
        modo: cfg.modo,
        googleConfigurado: !!(cfg.clientId && cfg.clientSecret),
        cifradoConfigurado: !!claveAes(cfg),
      })
    return responder({ ok: false, error: "ruta no encontrada" }, 404)
  } catch (e) {
    console.error("calendarios-oauth", String(e))
    return responder(
      { ok: false, error: "No se pudo completar la operación." },
      500,
    )
  }
})
