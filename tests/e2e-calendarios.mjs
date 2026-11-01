// E2E de la Etapa 16: calendarios de ida y vuelta con Google simulado.
//
// Prueba lo que se puede probar sin credenciales: que Ajustes conecte con la sesión, que el push
// mande la foto completa o solo los marcados, que desconectar borre la conexión, que el callback
// deje el aviso y limpie la dirección, y que sin sesión no se llame a la red. Además lee la
// migración y las Edge Functions para comprobar RLS, PKCE, cifrado y los dos adaptadores.
import fs from "node:fs"
import path from "node:path"
import { BASE, cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const SESION = JSON.stringify({
  accessToken: "token-ana",
  refreshToken: "refresh-ana",
  expiraEn: Date.now() + 3600_000,
  usuario: { id: "u-ana", email: "ana@ejemplo.com" },
})
const hoy = new Date().toISOString().slice(0, 10)
const evento = (id, name, extra = {}) => ({
  id,
  ownerId: "yo",
  name,
  date: hoy,
  time: "12:00",
  category: "Hogar",
  categoryEmoji: "🏠",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels: ["Notificación"],
  ...extra,
})
const seed = (extra = {}) => ({
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([
    {
      id: "yo",
      name: "Ana",
      emoji: "🐝",
      gcal: { connected: false, syncAll: true },
    },
  ]),
  "avispate.activeProfile.v1": "yo",
  "avispate.events.v1": JSON.stringify([
    evento("e-1", "Cambio de aceite"),
    evento("e-2", "Regar las plantas", {
      gcalAddedAt: "2026-10-01T10:00:00.000Z",
    }),
  ]),
  "avispate.cuenta.v1": SESION,
  ...extra,
})

const respuesta = (datos, status = 200) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json" },
  })

const CALENDARIO = {
  id: "cal-google",
  perfil_id: "yo",
  proveedor: "google",
  cuenta_email: "cuenta-simulada@avispate.local",
  calendario_externo: "primary",
  nombre: "Calendario de prueba",
  activo: true,
  modo: "simulado",
  ultima_sincronizacion: null,
  ultimo_error: null,
}

// Nube mínima de calendarios. `estadoInicial` permite simular una conexión que ya existía (por
// ejemplo, al volver del callback de Google).
function red(estadoInicial = [], cambios = []) {
  const llamadas = []
  let calendarios = [...estadoInicial]
  const fetchFalso = async (url, opciones = {}) => {
    const direccion = String(url)
    llamadas.push({ url: direccion, opciones })
    if (direccion.includes("/calendarios-oauth/estado")) {
      return respuesta({ ok: true, modo: "simulado", calendarios })
    }
    if (direccion.includes("/calendarios-oauth/iniciar")) {
      calendarios = [CALENDARIO]
      return respuesta({ ok: true, modo: "simulado", calendario: CALENDARIO })
    }
    if (direccion.includes("/calendarios-oauth/desconectar")) {
      calendarios = []
      return respuesta({ ok: true })
    }
    if (direccion.includes("/calendarios-sync")) {
      let cuerpo = {}
      try {
        cuerpo = JSON.parse(opciones.body || "{}")
      } catch {}
      const cantidad = Array.isArray(cuerpo.eventos) ? cuerpo.eventos.length : 0
      return respuesta({
        ok: true,
        subidos: cantidad,
        borrados: 0,
        bajados: cambios.length,
        errores: 0,
        cursor: "sim-1",
        cambios,
        calendario: {
          ...CALENDARIO,
          ultima_sincronizacion: new Date().toISOString(),
        },
      })
    }
    return respuesta({ ok: true })
  }
  return { fetch: fetchFalso, llamadas }
}

const cuerpoDe = (llamada) => {
  try {
    return JSON.parse(llamada?.opciones?.body || "{}")
  } catch {
    return {}
  }
}

const tarjetaGoogle = (m) =>
  m.doc.querySelector('#root [data-calendar="google"]')
const botonDe = (m, texto) =>
  [...(tarjetaGoogle(m)?.querySelectorAll("button") || [])].find((b) =>
    (b.textContent || "").includes(texto),
  )

// ------------------------------------------- C1) el contrato del servidor
{
  const sql = fs.readFileSync(
    path.join(BASE, "supabase/migrations/0009_etapa16_calendarios.sql"),
    "utf8",
  )
  check(
    "C1 · la migración crea las tres tablas",
    ["calendarios_cuenta", "eventos_calendario", "oauth_estado"].every((t) =>
      sql.includes(`create table if not exists public.${t}`),
    ),
  )
  check(
    "C1 · las tres tablas tienen RLS",
    (sql.match(/enable row level security/g) || []).length === 3,
  )
  check(
    "C1 · la conexión y el state se atan al perfil local",
    sql.includes("perfil_id text not null default 'yo'") &&
      sql.includes(
        "unique (user_id, perfil_id, proveedor, calendario_externo)",
      ),
  )
  check(
    "C1 · el navegador no puede leer la tabla de tokens",
    sql.includes(
      "revoke all on public.calendarios_cuenta from public, anon, authenticated",
    ) &&
      sql.includes(
        "grant execute on function public.mis_calendarios() to authenticated",
      ),
  )
  check(
    "C1 · los tokens se guardan cifrados y con vencimiento",
    sql.includes("token_acceso_cifrado") &&
      sql.includes("token_renovacion_cifrado") &&
      sql.includes("token_iv") &&
      sql.includes("token_renovacion_iv") &&
      sql.includes("token_expira_en"),
  )
  check(
    "C1 · el state es de un solo uso y solo lo canjea service_role",
    sql.includes("expira_en timestamptz not null") &&
      sql.includes("delete from public.oauth_estado") &&
      sql.includes(") to service_role;"),
  )

  const oauth = fs.readFileSync(
    path.join(BASE, "supabase/functions/calendarios-oauth/index.ts"),
    "utf8",
  )
  check(
    "C1 · OAuth usa PKCE S256 y state",
    oauth.includes('code_challenge_method: "S256"') &&
      oauth.includes("code_challenge: challenge") &&
      oauth.includes("const state = azar(32)"),
  )
  check(
    "C1 · el callback canjea el código en Google y cifra los tokens",
    oauth.includes("https://oauth2.googleapis.com/token") &&
      oauth.includes('{ name: "AES-GCM" }') &&
      oauth.includes("p_token_acceso_cifrado"),
  )
  check(
    "C1 · desconectar revoca el token en Google",
    oauth.includes("https://oauth2.googleapis.com/revoke"),
  )

  const sync = fs.readFileSync(
    path.join(BASE, "supabase/functions/calendarios-sync/index.ts"),
    "utf8",
  )
  const bloqueEstado = (fuente) => {
    const inicio = fuente.indexOf("async function estado")
    const fin = fuente.indexOf("\n}\n", inicio)
    return fuente.slice(inicio, fin)
  }
  check(
    "C1 · /estado lee las conexiones del usuario, no la RPC sin sesión",
    bloqueEstado(oauth).includes('.eq("user_id", usuario.id)') &&
      !bloqueEstado(oauth).includes('admin.rpc("mis_calendarios")') &&
      bloqueEstado(sync).includes('.eq("user_id", userId)') &&
      !bloqueEstado(sync).includes('admin.rpc("mis_calendarios")'),
    `${bloqueEstado(oauth)}\n---\n${bloqueEstado(sync)}`,
  )
  check(
    "C1 · hay dos adaptadores con la misma interfaz",
    sync.includes("class Simulado implements AdaptadorCalendario") &&
      sync.includes("class Google implements AdaptadorCalendario"),
  )
  check(
    "C1 · el enlace externo evita duplicados",
    sync.includes('onConflict: "calendario_id,recordatorio_id"') &&
      sync.includes("evento_externo_id"),
  )
  check(
    "C1 · la bajada usa el cursor de Google y sus propiedades privadas",
    sync.includes("syncToken") &&
      sync.includes("nextSyncToken") &&
      sync.includes("extendedProperties") &&
      sync.includes("avispate_id"),
  )
  check(
    "C1 · la bajada recorre todas las páginas antes de guardar el cursor",
    sync.includes("nextPageToken") &&
      sync.includes("while (pageToken)") &&
      sync.includes("zona: item.start?.timeZone"),
  )
  check(
    "C1 · la bajada devuelve la zona para reconstruir la hora local",
    sync.includes("zona?: string") &&
      bundle.includes("no se aplicó porque tu versión local es más nueva"),
  )
  check(
    "C1 · el bundle del navegador no lleva secretos de servidor",
    !bundle.includes("GOOGLE_CLIENT_SECRET") &&
      !bundle.includes("CALENDARIOS_TOKEN_KEY") &&
      !bundle.includes("SUPABASE_SERVICE_ROLE_KEY"),
  )
}

// ------------------------------------------- U1) conectar, sincronizar y desconectar
{
  const n = red()
  const m = montar(bundle, seed(), { fetch: n.fetch })
  await wait(180)
  await m.irAjustes()
  check(
    "U1 · Ajustes pide el estado de los calendarios al abrirse",
    n.llamadas.some((l) =>
      l.url.includes("/functions/v1/calendarios-oauth/estado"),
    ),
    JSON.stringify(n.llamadas.map((l) => l.url)),
  )
  m.press(m.byLabel("Calendarios de Ana"))
  await wait(80)
  check(
    "U1 · Google arranca sin conectar y con su botón real",
    (tarjetaGoogle(m)?.textContent || "").includes("Sin conectar") &&
      !!botonDe(m, "Conectar con Google Calendar"),
  )

  m.press(botonDe(m, "Conectar con Google Calendar"))
  await wait(160)
  const inicio = n.llamadas.find((l) =>
    l.url.includes("/calendarios-oauth/iniciar"),
  )
  check(
    "U1 · conectar manda el perfil, el proveedor y el Bearer de la sesión",
    cuerpoDe(inicio).proveedor === "google" &&
      cuerpoDe(inicio).perfilId === "yo" &&
      /^Bearer token-ana$/.test(inicio?.opciones?.headers?.Authorization || ""),
    JSON.stringify(inicio?.opciones?.headers),
  )
  check(
    "U1 · en modo simulado no navega: crea la conexión y la muestra",
    (tarjetaGoogle(m)?.textContent || "").includes("✓ Modo de prueba") &&
      (tarjetaGoogle(m)?.textContent || "").includes(
        "Cuenta de prueba conectada",
      ),
    (tarjetaGoogle(m)?.textContent || "").slice(-300),
  )
  check(
    "U1 · la conexión queda en el perfil de ese usuario",
    m.profileOf("yo")?.gcal?.connected === true &&
      m.profileOf("yo")?.gcal?.syncAll === true,
    JSON.stringify(m.profileOf("yo")?.gcal),
  )

  m.press(botonDe(m, "Sincronizar ahora"))
  await wait(180)
  const primero = n.llamadas.find((l) =>
    l.url.includes("/functions/v1/calendarios-sync"),
  )
  const foto = cuerpoDe(primero)
  check(
    "U1 · «Todos los avisos» manda la foto entera y pide reconciliar",
    foto.calendarioId === "cal-google" &&
      foto.completo === true &&
      Array.isArray(foto.eventos) &&
      foto.eventos.length === 2,
    JSON.stringify(foto),
  )
  check(
    "U1 · cada evento lleva id, fecha ISO y zona",
    foto.eventos?.every(
      (e) =>
        typeof e.recordatorioId === "string" &&
        /T.*Z$/.test(e.inicio) &&
        /T.*Z$/.test(e.fin) &&
        typeof e.zona === "string",
    ),
    JSON.stringify(foto.eventos),
  )
  check(
    "U1 · el resultado se cuenta en la tarjeta y en el perfil",
    (tarjetaGoogle(m)?.textContent || "").includes(
      "2 recordatorios sincronizados",
    ) && m.profileOf("yo")?.gcal?.lastCount === 2,
    JSON.stringify(m.profileOf("yo")?.gcal),
  )

  m.press(m.byLabel("Sincronizar todos los avisos con Google Calendar"))
  await wait(80)
  m.press(botonDe(m, "Sincronizar ahora"))
  await wait(180)
  const segundo = n.llamadas
    .filter((l) => l.url.includes("/functions/v1/calendarios-sync"))
    .pop()
  const parcial = cuerpoDe(segundo)
  check(
    "U1 · apagado, solo sube los marcados y no reconcilia",
    parcial.completo === false &&
      parcial.eventos?.length === 1 &&
      parcial.eventos?.[0]?.recordatorioId === "e-2",
    JSON.stringify(parcial),
  )

  m.press(botonDe(m, "Desconectar"))
  await wait(180)
  const baja = n.llamadas.find((l) =>
    l.url.includes("/calendarios-oauth/desconectar"),
  )
  check(
    "U1 · desconectar manda el id de la conexión",
    cuerpoDe(baja).calendarioId === "cal-google",
  )
  check(
    "U1 · la tarjeta y el perfil vuelven a «Sin conectar»",
    (tarjetaGoogle(m)?.textContent || "").includes("Sin conectar") &&
      m.profileOf("yo")?.gcal?.connected === false,
    (tarjetaGoogle(m)?.textContent || "").slice(-200),
  )
  check(
    "U1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- U2) la bajada aplica cambios y respeta lo local más nuevo
{
  const inicioRemoto = new Date(2026, 10, 20, 9, 30, 0)
  const finRemoto = new Date(2026, 10, 20, 10, 30, 0)
  const cambios = [
    {
      recordatorioId: "e-2",
      titulo: "Regar las plantas del balcón",
      inicio: inicioRemoto.toISOString(),
      fin: finRemoto.toISOString(),
      todoElDia: false,
      notas: "Solo las de afuera\nRecordatorio de AVISPATE · Hogar",
      eliminado: false,
      actualizadoEn: "2026-12-01T12:00:00.000Z",
      zona: "America/Argentina/Buenos_Aires",
    },
    {
      recordatorioId: "e-1",
      titulo: "Cambio de aceite",
      inicio: inicioRemoto.toISOString(),
      fin: finRemoto.toISOString(),
      todoElDia: false,
      notas: "",
      eliminado: true,
      actualizadoEn: "2026-12-02T12:00:00.000Z",
      zona: "America/Argentina/Buenos_Aires",
    },
    {
      recordatorioId: "e-3",
      titulo: "Llamar al plomero (Google)",
      inicio: inicioRemoto.toISOString(),
      fin: finRemoto.toISOString(),
      todoElDia: false,
      notas: "",
      eliminado: false,
      actualizadoEn: "2026-12-15T12:00:00.000Z",
      zona: "America/Argentina/Buenos_Aires",
    },
  ]
  const n = red([CALENDARIO], cambios)
  const m = montar(
    bundle,
    seed({
      "avispate.events.v1": JSON.stringify([
        evento("e-1", "Cambio de aceite", {
          updatedAt: "2026-10-01T10:00:00.000Z",
        }),
        evento("e-2", "Regar las plantas", {
          gcalAddedAt: "2026-10-01T10:00:00.000Z",
          updatedAt: "2026-10-01T10:00:00.000Z",
        }),
        evento("e-3", "Llamar al plomero", {
          updatedAt: "2026-12-31T00:00:00.000Z",
        }),
      ]),
    }),
    { fetch: n.fetch },
  )
  await wait(180)
  await m.irAjustes()
  m.press(m.byLabel("Calendarios de Ana"))
  await wait(80)
  m.press(botonDe(m, "Sincronizar ahora"))
  await wait(200)

  const despues = m.events()
  const regar = despues.find((e) => e.id === "e-2")
  const plomero = despues.find((e) => e.id === "e-3")
  check(
    "U2 · un cambio nuevo de Google actualiza título, fecha, hora y notas",
    regar?.name === "Regar las plantas del balcón" &&
      regar?.date === "2026-11-20" &&
      regar?.time === "09:30" &&
      regar?.notes === "Solo las de afuera" &&
      regar?.updatedAt === "2026-12-01T12:00:00.000Z",
    JSON.stringify(regar),
  )
  check(
    "U2 · un evento borrado en Google desaparece de la lista local",
    !despues.some((e) => e.id === "e-1"),
    JSON.stringify(despues.map((e) => e.id)),
  )
  check(
    "U2 · si la copia local es más nueva, el cambio de Google no la pisa",
    plomero?.name === "Llamar al plomero" &&
      plomero?.updatedAt === "2026-12-31T00:00:00.000Z",
    JSON.stringify(plomero),
  )
  check(
    "U2 · la tarjeta cuenta los cambios traídos y los conflictos",
    (tarjetaGoogle(m)?.textContent || "").includes(
      "3 recordatorios sincronizados; 2 cambios traídos de Google Calendar; 1 cambio no se aplicó porque tu versión local es más nueva",
    ),
    (tarjetaGoogle(m)?.textContent || "").slice(-400),
  )
  check(
    "U2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- P1) la conexión es de ESE perfil, no de toda la cuenta
{
  const perfiles = [
    {
      id: "yo",
      name: "Ana",
      emoji: "🐝",
      gcal: { connected: false, syncAll: true },
    },
    { id: "abuela", name: "Abuela", emoji: "👵" },
  ]
  const n = red()
  const m = montar(
    bundle,
    seed({ "avispate.profiles.v1": JSON.stringify(perfiles) }),
    { fetch: n.fetch },
  )
  await wait(160)
  await m.irAjustes()
  m.press(m.byLabel("Calendarios de Ana"))
  await wait(60)
  m.press(botonDe(m, "Conectar con Google Calendar"))
  await wait(150)
  check(
    "P1 · Ana conecta su Google",
    m.profileOf("yo")?.gcal?.connected === true &&
      (tarjetaGoogle(m)?.textContent || "").includes("✓ Modo de prueba"),
  )
  m.pressText("button", "Abuela")
  await wait(150)
  if (!tarjetaGoogle(m)) {
    m.press(m.byLabel("Calendarios de Abuela"))
    await wait(80)
  }
  check(
    "P1 · Abuela no hereda la conexión de Ana",
    (tarjetaGoogle(m)?.textContent || "").includes("Sin conectar") &&
      m.profileOf("abuela")?.gcal?.connected !== true,
    (tarjetaGoogle(m)?.textContent || "").slice(-250),
  )
  check(
    "P1 · conectar en Ana no creó una conexión para Abuela",
    n.llamadas.filter((l) => l.url.includes("/iniciar")).length === 1,
  )
  check(
    "P1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- R1) la vuelta del callback deja el aviso y limpia la URL
{
  const n = red([CALENDARIO])
  const m = montar(bundle, seed(), {
    fetch: n.fetch,
    url: "https://avispate-app.vercel.app/?calendario=google&estado=conectado",
  })
  await wait(220)
  check(
    "R1 · la app limpia los parámetros del callback",
    m.window.location.search === "",
    m.window.location.search,
  )
  await m.irAjustes()
  await wait(120)
  m.press(m.byLabel("Calendarios de Ana"))
  await wait(80)
  check(
    "R1 · Ajustes cuenta que Google quedó conectado",
    (tarjetaGoogle(m)?.textContent || "").includes(
      "Google Calendar conectado. Ya podés sincronizar desde Ajustes.",
    ) && (tarjetaGoogle(m)?.textContent || "").includes("✓ Modo de prueba"),
    (tarjetaGoogle(m)?.textContent || "").slice(-400),
  )
  check(
    "R1 · la conexión que ya existía se refleja en el perfil",
    m.profileOf("yo")?.gcal?.connected === true,
    JSON.stringify(m.profileOf("yo")?.gcal),
  )
  check(
    "R1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- R2) el callback puede volver con error
{
  const n = red()
  const m = montar(bundle, seed(), {
    fetch: n.fetch,
    url: "https://avispate-app.vercel.app/?calendario=google&estado=error&motivo=acceso%20denegado",
  })
  await wait(180)
  await m.irAjustes()
  await wait(100)
  m.press(m.byLabel("Calendarios de Ana"))
  await wait(80)
  check(
    "R2 · el error se explica sin romper Ajustes",
    (tarjetaGoogle(m)?.textContent || "").includes(
      "No se pudo conectar Google Calendar: acceso denegado",
    ) && !(tarjetaGoogle(m)?.textContent || "").includes("✓ Conectado"),
    (tarjetaGoogle(m)?.textContent || "").slice(-300),
  )
  check(
    "R2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- R3) el aviso verde exige que la nube confirme
{
  const n = red()
  const m = montar(bundle, seed(), {
    fetch: n.fetch,
    url: "https://avispate-app.vercel.app/?calendario=google&estado=conectado",
  })
  await wait(220)
  await m.irAjustes()
  await wait(120)
  m.press(m.byLabel("Calendarios de Ana"))
  await wait(80)
  const tarjeta = tarjetaGoogle(m)?.textContent || ""
  check(
    "R3 · si /estado no confirma la conexión, no queda el aviso verde",
    tarjeta.includes("Sin conectar") &&
      !tarjeta.includes(
        "Google Calendar conectado. Ya podés sincronizar desde Ajustes.",
      ) &&
      tarjeta.includes(
        "No se pudo confirmar la conexión de Google Calendar en este perfil.",
      ),
    tarjeta.slice(-400),
  )
  check(
    "R3 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- S1) sin sesión no se llama a la red
{
  const n = red()
  const sinCuenta = seed()
  delete sinCuenta["avispate.cuenta.v1"]
  const m = montar(bundle, sinCuenta, { fetch: n.fetch })
  await wait(150)
  await m.irAjustes()
  m.press(m.byLabel("Calendarios de Ana"))
  await wait(80)
  m.press(botonDe(m, "Conectar con Google Calendar"))
  await wait(80)
  check(
    "S1 · el invitado recibe una explicación, no un error de red",
    (tarjetaGoogle(m)?.textContent || "").includes(
      "Entrá a tu cuenta para conectar Google Calendar.",
    ),
    (tarjetaGoogle(m)?.textContent || "").slice(-250),
  )
  check(
    "S1 · sin sesión no se pide ninguna conexión",
    !n.llamadas.some((l) =>
      l.url.includes("/functions/v1/calendarios-oauth/iniciar"),
    ),
  )
  check(
    "S1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

process.exit(finish() ? 1 : 0)
