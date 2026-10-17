// E2E de la Etapa 15 (primera entrega): cuenta por enlace mágico y vínculo del dispositivo.
//
// Lo que se prueba sin un Supabase de verdad: que el modo invitado no cambie, que el correo se valide
// antes de salir, que el enlace vuelva a la app y deje la sesión guardada, que el hash se limpie, que
// vincular/desvincular pase el id y el token del teléfono, y que la migración tenga RLS y las
// funciones solo para `authenticated`. La red se simula con un `fetch` de mentira, como en la
// Etapa 14; la prueba negativa de RLS se corre aparte contra Supabase (ver supabase/README.md).
import fs from "node:fs"
import path from "node:path"
import { BASE, cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const LISTO = { "avispate.onboarding.v1": "1" }

const sesion = (extra = {}) =>
  JSON.stringify({
    accessToken: "token-ana",
    refreshToken: "refresh-ana",
    expiraEn: Date.now() + 3600_000,
    usuario: { id: "u-ana", email: "ana@ejemplo.com" },
    ...extra,
  })

const respuesta = (datos, status = 200) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json" },
  })

// Un `fetch` de mentira que anota todo. Cada ruta se puede pisar con una función o con una respuesta
// ya armada; las que no importan devuelven lo mínimo para que la app siga.
const red = (rutas = {}) => {
  const llamadas = []
  // Lo que la nube recordaría después de reclamar: la lista de dispositivos lo devuelve en la
  // siguiente consulta, como en el servidor de verdad.
  let vinculado = null
  const fetchFalso = async (url, opciones = {}) => {
    const direccion = String(url)
    llamadas.push({ url: direccion, opciones })
    for (const [clave, valor] of Object.entries(rutas)) {
      if (!direccion.includes(clave)) continue
      return typeof valor === "function" ? valor(direccion, opciones) : valor
    }
    if (direccion.includes("/auth/v1/user"))
      return respuesta({ id: "u-nueva", email: "nueva@ejemplo.com" })
    if (direccion.includes("/auth/v1/otp")) return respuesta({})
    if (direccion.includes("/auth/v1/logout")) return respuesta({})
    if (direccion.includes("/rest/v1/rpc/mis_dispositivos"))
      return respuesta(
        vinculado
          ? [
              {
                dispositivo_id: vinculado,
                nombre: "Este dispositivo",
                reclamado_en: new Date().toISOString(),
                ultima_conexion: new Date().toISOString(),
              },
            ]
          : [],
      )
    if (direccion.includes("/rest/v1/rpc/reclamar_dispositivo")) {
      try {
        vinculado = JSON.parse(opciones.body || "{}").p_dispositivo || null
      } catch {
        vinculado = null
      }
      return respuesta({ ok: true })
    }
    if (direccion.includes("/rest/v1/rpc/desvincular_dispositivo"))
      return respuesta({ ok: true })
    return respuesta({}, 404)
  }
  return { fetch: fetchFalso, llamadas }
}

const cuerpo = (llamada) => {
  try {
    return JSON.parse(llamada?.opciones?.body || "{}")
  } catch {
    return {}
  }
}

// ------------------------------------------- Modo invitado
{
  const { fetch, llamadas } = red()
  const m = montar(bundle, { ...LISTO }, { fetch })
  await wait(120)
  await m.irAjustes()

  check("Ajustes muestra la sección Cuenta", m.txt().includes("Cuenta"))
  check(
    "el invitado ve la explicación del enlace mágico",
    m.txt().includes("Entrá sin contraseña"),
  )
  check("hay un campo para el correo", !!m.byLabel("Correo de la cuenta"))
  check(
    "hay un botón para enviar el enlace",
    !!m.byLabel("Enviar enlace mágico"),
  )
  check(
    "sin sesión no se piden dispositivos",
    !llamadas.some((l) => l.url.includes("mis_dispositivos")),
  )

  // Un correo vacío no sale a la red: el mensaje aparece en la tarjeta y no se pidió ningún enlace.
  m.click(m.byLabel("Enviar enlace mágico"))
  await wait(40)
  check(
    "un correo vacío se rechaza con un mensaje",
    m.txt().includes("Escribí un correo válido"),
  )
  check(
    "el correo inválido no pide el enlace",
    !llamadas.some((l) => l.url.includes("/auth/v1/otp")),
  )

  m.type(m.byLabel("Correo de la cuenta"), "  Ana@Ejemplo.com  ")
  m.click(m.byLabel("Enviar enlace mágico"))
  await wait(60)
  const otp = llamadas.find((l) => l.url.includes("/auth/v1/otp"))
  check("el correo válido pide el enlace", !!otp)
  check(
    "el enlace viaja al correo en minúsculas",
    cuerpo(otp).email === "ana@ejemplo.com",
  )
  check(
    "el enlace vuelve a la dirección de la app",
    otp?.url.includes("redirect_to=") &&
      decodeURIComponent(otp.url).includes("avispate-app.vercel.app"),
  )
  check(
    "la tarjeta confirma que el enlace salió",
    m.txt().includes("Te mandamos un enlace"),
  )
}

// ------------------------------------------- Sin red
{
  // jsdom no trae `fetch`: es el caso de un teléfono sin conexión. La app no se rompe y lo cuenta.
  const m = montar(bundle, { ...LISTO })
  await wait(120)
  await m.irAjustes()
  m.type(m.byLabel("Correo de la cuenta"), "ana@ejemplo.com")
  m.click(m.byLabel("Enviar enlace mágico"))
  await wait(60)
  check(
    "sin red el enlace no se pierde en una excepción",
    m.txt().includes("Sin conexión"),
  )
}

// ------------------------------------------- Sesión ya guardada, vínculo y salida
{
  const { fetch, llamadas } = red()
  const m = montar(bundle, { ...LISTO, "avispate.cuenta.v1": sesion() }, {
    fetch,
  })
  await wait(120)
  await m.irAjustes()

  check(
    "la sesión guardada se muestra al abrir Ajustes",
    m.txt().includes("Cuenta de ana@ejemplo.com"),
  )
  check(
    "al entrar se revisa la lista de dispositivos",
    llamadas.some((l) => l.url.includes("mis_dispositivos")),
  )
  check(
    "el teléfono empieza sin vincular",
    m.txt().includes("Sin vincular") &&
      !!m.find("button", "Vincular este teléfono"),
  )
  check(
    "la lista vacía se explica",
    m.txt().includes("Todavía no hay teléfonos vinculados"),
  )

  m.clickText("button", "Vincular este teléfono")
  await wait(80)
  const alta = llamadas.find((l) => l.url.includes("reclamar_dispositivo"))
  const datosAlta = cuerpo(alta)
  check("vincular llama a la función de la nube", !!alta)
  check(
    "vincular manda el id del dispositivo",
    typeof datosAlta.p_dispositivo === "string" &&
      datosAlta.p_dispositivo.length > 0,
  )
  check(
    "vincular manda el token secreto del dispositivo",
    typeof datosAlta.p_token === "string" && datosAlta.p_token.length === 64,
  )
  check(
    "vincular manda la sesión en Authorization",
    /^Bearer token-ana$/.test(alta?.opciones?.headers?.Authorization || ""),
  )
  check(
    "la tarjeta confirma el vínculo",
    m.txt().includes("quedó vinculado a tu cuenta") &&
      m.txt().includes("✓ Vinculado"),
  )
  check(
    "la lista muestra el teléfono recién vinculado",
    m.txt().includes("Este dispositivo") && m.txt().includes("este teléfono"),
  )
  check(
    "el vínculo queda recordado para esta cuenta",
    m.raw("avispate.cuenta.vinculo.v1") === "u-ana",
  )

  // Desvincular pide confirmación: el primer toque no llama a la nube, el segundo sí.
  m.clickText("button", "Desvincular este teléfono")
  await wait(40)
  check("desvincular pide un segundo toque", m.txt().includes("Tocá de nuevo"))
  check(
    "el primer toque no desvincula",
    !llamadas.some((l) => l.url.includes("desvincular_dispositivo")),
  )
  m.clickText("button", "¿Seguro? Tocá de nuevo para desvincular")
  await wait(80)
  check(
    "el segundo toque desvincula",
    llamadas.some((l) => l.url.includes("desvincular_dispositivo")),
  )
  check(
    "desvincular borra el recuerdo local",
    m.raw("avispate.cuenta.vinculo.v1") === null,
  )
  check("la tarjeta vuelve a Sin vincular", m.txt().includes("Sin vincular"))

  m.clickText("button", "Cerrar sesión")
  await wait(80)
  check(
    "cerrar sesión avisa a la nube",
    llamadas.some((l) => l.url.includes("/auth/v1/logout")),
  )
  check(
    "cerrar sesión borra la sesión del teléfono",
    m.raw("avispate.cuenta.v1") === null,
  )
  check(
    "cerrar sesión vuelve al modo invitado",
    m.txt().includes("Entrá sin contraseña") &&
      m.txt().includes("Sesión cerrada"),
  )
}

// ------------------------------------------- El enlace mágico vuelve a la app
{
  const { fetch, llamadas } = red()
  const m = montar(bundle, { ...LISTO }, {
    fetch,
    url: "https://avispate-app.vercel.app/#access_token=token-nueva&refresh_token=refresh-nueva&expires_in=3600&type=magiclink",
  })
  await wait(180)

  check(
    "el enlace pide la cuenta con el token",
    llamadas.some((l) => l.url.includes("/auth/v1/user")),
  )
  const guardada = m.storage("avispate.cuenta.v1")
  check(
    "el enlace guarda la sesión en el teléfono",
    guardada?.accessToken === "token-nueva" &&
      guardada?.usuario?.id === "u-nueva",
  )
  check(
    "los tokens no quedan en la barra de direcciones",
    m.window.location.hash === "",
  )
  await m.irAjustes()
  check(
    "la cuenta del enlace se ve en Ajustes",
    m.txt().includes("Cuenta de nueva@ejemplo.com"),
  )
}

// ------------------------------------------- Enlace vencido
{
  const m = montar(bundle, { ...LISTO }, {
    url: "https://avispate-app.vercel.app/#error=access_denied&error_description=Email+link+is+invalid+or+has+expired",
  })
  await wait(140)
  check(
    "el error del enlace también se limpia de la dirección",
    m.window.location.hash === "",
  )
  await m.irAjustes()
  check(
    "un enlace vencido se explica y no crea sesión",
    m.txt().includes("El enlace venció o ya se usó") &&
      m.raw("avispate.cuenta.v1") === null,
  )
}

// ------------------------------------------- La migración y el contrato
{
  const sql = fs.readFileSync(
    path.join(BASE, "supabase/migrations/0004_etapa15.sql"),
    "utf8",
  )
  check(
    "la migración crea perfiles_cuenta",
    /create table if not exists public\.perfiles_cuenta/.test(sql),
  )
  check(
    "la migración crea dispositivos_cuenta",
    /create table if not exists public\.dispositivos_cuenta/.test(sql),
  )
  check(
    "las dos tablas tienen RLS",
    (sql.match(/enable row level security/g) || []).length >= 2,
  )
  check(
    "las tablas no se escriben directo",
    /revoke all on public\.perfiles_cuenta from anon, authenticated/.test(
      sql,
    ) &&
      /revoke all on public\.dispositivos_cuenta from anon, authenticated/.test(
        sql,
      ),
  )
  check("el alta usa auth.uid()", sql.includes("auth.uid()"))
  check(
    "el alta exige el token del dispositivo",
    sql.includes("p_token") && sql.includes("token incorrecto"),
  )
  check(
    "el user_id no se acepta como parámetro",
    !/function public\.reclamar_dispositivo\([^)]*user_id/.test(sql),
  )
  check(
    "anon no puede ejecutar el alta",
    /revoke all on function public\.reclamar_dispositivo\(uuid, text\) from public, anon/.test(
      sql,
    ),
  )
  check(
    "solo authenticated puede reclamar",
    /grant execute on function public\.reclamar_dispositivo\(uuid, text\) to authenticated/.test(
      sql,
    ),
  )
  check(
    "el perfil se crea con un disparador de Auth",
    sql.includes("after insert on auth.users"),
  )

  check("el cliente pide el enlace a Supabase", bundle.includes("/auth/v1/otp"))
  check(
    "el cliente usa la función de vínculo",
    bundle.includes("reclamar_dispositivo"),
  )
  check(
    "la sesión tiene su propia clave",
    bundle.includes("avispate.cuenta.v1"),
  )

  const app = fs.readFileSync(path.join(BASE, "src/App.tsx"), "utf8")
  const bloqueCopia =
    app.match(/const CLAVES_COPIA = \[([\s\S]*?)\]/)?.[1] || ""
  check(
    "la sesión no viaja dentro de las copias de seguridad",
    !bloqueCopia.includes("avispate.cuenta"),
  )

  const doc = fs.readFileSync(
    path.join(BASE, "docs/etapa15-cuenta-y-sincronizacion.md"),
    "utf8",
  )
  check(
    "el diseño de la etapa está escrito",
    doc.includes("Fase 1 · Identidad y vínculo") &&
      doc.includes("Fase 3 · Motor de sincronización"),
  )

  const config = fs.readFileSync(
    path.join(BASE, "supabase/config.toml"),
    "utf8",
  )
  check(
    "Auth vuelve al alias publicado",
    config.includes('site_url = "https://avispate-app.vercel.app"'),
  )
  check(
    "Auth permite el alias y el desarrollo",
    config.includes('"https://avispate-app.vercel.app/**"') &&
      config.includes('"http://localhost:8443/**"'),
  )
}

process.exit(finish() ? 1 : 0)
