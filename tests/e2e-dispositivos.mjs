// E2E de la Etapa 15 (fase 4): lista de dispositivos, renombre, cierre remoto, cierre global y la
// decisión sobre la copia local. También comprueba que un teléfono desvinculado desde otro equipo
// apaga el motor sin cerrar la sesión.
import fs from "node:fs"
import path from "node:path"
import { BASE, cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const DEVICE = {
  id: "11111111-1111-4111-8111-111111111111",
  token: "a".repeat(64),
}
const IPAD = "22222222-2222-4222-8222-222222222222"
const SESION = () =>
  JSON.stringify({
    accessToken: "token-ana",
    refreshToken: "refresh-ana",
    expiraEn: Date.now() + 3600_000,
    usuario: { id: "u-ana", email: "ana@ejemplo.com" },
  })
const YO = {
  id: "yo",
  name: "Ana",
  emoji: "🐝",
  contact: {
    phone: "+56 9 1111 2222",
    email: "ana@ejemplo.com",
    accepted: true,
  },
}
const seed = (extra = {}) => ({
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([YO]),
  "avispate.activeProfile.v1": "yo",
  "avispate.events.v1": JSON.stringify([
    {
      id: "e-1",
      ownerId: "yo",
      name: "Regar las plantas",
      date: new Date().toISOString().slice(0, 10),
      time: "12:00",
      category: "Hogar",
      categoryEmoji: "🏠",
      recurrence: "No se repite",
      remindersBefore: [1],
      channels: ["Notificación"],
    },
  ]),
  "avispate.cuenta.v1": SESION(),
  "avispate.cuenta.vinculo.v1": "u-ana",
  "avispate.dispositivo.v1": JSON.stringify(DEVICE),
  ...extra,
})

const respuesta = (datos, status = 200) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json" },
  })
const cuerpo = (opciones) => {
  try {
    return JSON.parse(opciones?.body || "{}")
  } catch {
    return {}
  }
}

// Nube mínima de la fase 4: lista de dos teléfonos, renombre y desvinculación. Las llamadas del motor
// de sincronización devuelven vacío para que la app no se quede con un aviso de error.
function red({ revocado = false } = {}) {
  const llamadas = []
  let dispositivos = [
    {
      dispositivo_id: DEVICE.id,
      nombre: "iPhone de Ana",
      reclamado_en: new Date(Date.now() - 86400_000).toISOString(),
      ultima_conexion: new Date().toISOString(),
    },
    {
      dispositivo_id: IPAD,
      nombre: "iPad de Ana",
      reclamado_en: new Date(Date.now() - 172800_000).toISOString(),
      ultima_conexion: new Date(Date.now() - 3600_000).toISOString(),
    },
  ]
  const fetchFalso = async (url, opciones = {}) => {
    const direccion = String(url)
    llamadas.push({ url: direccion, opciones })
    if (revocado && direccion.includes("/rest/v1/rpc/"))
      return respuesta({ message: "dispositivo no vinculado" }, 403)
    if (direccion.includes("/rest/v1/rpc/mis_dispositivos"))
      return respuesta(dispositivos)
    if (direccion.includes("/rest/v1/rpc/renombrar_dispositivo")) {
      const datos = cuerpo(opciones)
      dispositivos = dispositivos.map((d) =>
        d.dispositivo_id === datos.p_dispositivo
          ? { ...d, nombre: datos.p_nombre }
          : d,
      )
      return respuesta({ ok: true })
    }
    if (direccion.includes("/rest/v1/rpc/desvincular_dispositivo")) {
      const datos = cuerpo(opciones)
      dispositivos = dispositivos.filter(
        (d) => d.dispositivo_id !== datos.p_dispositivo,
      )
      return respuesta({ ok: true })
    }
    if (direccion.includes("/rest/v1/rpc/desvincular_todos_dispositivos")) {
      dispositivos = []
      return respuesta({ ok: true, desvinculados: 2 })
    }
    if (direccion.includes("/rest/v1/rpc/bajar_cambios")) return respuesta([])
    if (direccion.includes("/rest/v1/rpc/subir_cambios"))
      return respuesta({ ok: true, subidos: 0, ignorados: 0 })
    if (direccion.includes("/auth/v1/logout")) return respuesta({})
    return respuesta({})
  }
  return { fetch: fetchFalso, llamadas, dispositivos: () => dispositivos }
}

const llamada = (red, trozo) => red.llamadas.find((l) => l.url.includes(trozo))

// ------------------------------------------- A) renombrar y cerrar un teléfono
{
  const n = red()
  const m = montar(bundle, seed(), { fetch: n.fetch })
  await wait(220)
  await m.irAjustes()
  await wait(120)

  check(
    "D1 · la lista muestra los dos teléfonos y cuál es este",
    m.txt().includes("iPhone de Ana") &&
      m.txt().includes("iPad de Ana") &&
      m.txt().includes("este teléfono"),
    m.txt().slice(0, 240),
  )
  check(
    "D1 · la última conexión viene de la nube",
    m.txt().includes("Última conexión:"),
  )

  m.press(m.byLabel("Renombrar iPad de Ana"))
  await wait(40)
  m.type(m.byLabel("Nombre del teléfono"), "iPad de Seba")
  await wait(20)
  m.press(m.byLabel("Guardar el nombre del teléfono"))
  await wait(120)

  const renombre = llamada(n, "/rest/v1/rpc/renombrar_dispositivo")
  check(
    "D2 · renombrar manda el id y el nombre nuevo",
    renombre &&
      cuerpo(renombre.opciones).p_dispositivo === IPAD &&
      cuerpo(renombre.opciones).p_nombre === "iPad de Seba",
    JSON.stringify(renombre && cuerpo(renombre.opciones)),
  )
  check(
    "D2 · la lista se actualiza sin volver a pedirla",
    m.txt().includes("iPad de Seba") && !m.txt().includes("iPad de Ana"),
  )

  m.press(m.byLabel("Cerrar la sesión de iPad de Seba"))
  await wait(40)
  check(
    "D3 · cerrar la sesión pide un segundo toque",
    m.txt().includes("¿Seguro?") && !llamada(n, "/rpc/desvincular_dispositivo"),
  )
  m.press(m.byLabel("Cerrar la sesión de iPad de Seba"))
  await wait(120)
  const cierre = llamada(n, "/rpc/desvincular_dispositivo")
  check(
    "D3 · el cierre remoto desvincula ese teléfono",
    cierre && cuerpo(cierre.opciones).p_dispositivo === IPAD,
    JSON.stringify(cierre && cuerpo(cierre.opciones)),
  )
  check(
    "D3 · el teléfono cerrado desaparece de la lista",
    !m.txt().includes("iPad de Seba"),
  )
  check(
    "D3 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- B) cerrar en todos y conservar la copia
{
  const n = red()
  const m = montar(bundle, seed(), { fetch: n.fetch })
  await wait(220)
  await m.irAjustes()
  await wait(120)

  m.clickText("button", "Cerrar sesión en todos los teléfonos")
  await wait(40)
  m.clickText("button", "¿Seguro? Cerrar en todos los teléfonos")
  await wait(180)

  const todos = llamada(n, "/rpc/desvincular_todos_dispositivos")
  const global = n.llamadas.find(
    (l) => l.url.includes("/auth/v1/logout") && l.url.includes("scope=global"),
  )
  check(
    "D4 · cierra todos los vínculos y después la sesión global",
    !!todos && !!global && n.dispositivos().length === 0,
  )
  check(
    "D4 · la sesión local se borra y vuelve el modo invitado",
    m.raw("avispate.cuenta.v1") === null &&
      m.txt().includes("Entrá sin contraseña"),
  )
  check(
    "D4 · después de salir pregunta qué hacer con la copia local",
    m.txt().includes("¿Qué hacemos con la copia local?") &&
      m.txt().includes("Conservar mis datos") &&
      m.txt().includes("Borrar la copia local"),
  )
  m.clickText("button", "Conservar mis datos")
  await wait(40)
  check(
    "D4 · conservar cierra la pregunta y deja los datos",
    !m.txt().includes("¿Qué hacemos con la copia local?") &&
      (m.storage("avispate.events.v1") || []).length === 1,
  )
  check(
    "D4 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- C) borrar la copia local
{
  const n = red()
  const m = montar(bundle, seed(), { fetch: n.fetch })
  await wait(220)
  await m.irAjustes()
  await wait(120)
  m.clickText("button", "Cerrar sesión en este teléfono")
  await wait(120)
  m.clickText("button", "Borrar la copia local")
  await wait(40)
  check(
    "D5 · borrar la copia local también pide confirmación",
    m.txt().includes("¿Seguro? Borrar la copia local"),
  )
  m.clickText("button", "¿Seguro? Borrar la copia local")
  await wait(180)
  check(
    "D5 · los recordatorios y usuarios locales se vacían",
    (m.storage("avispate.events.v1") || []).length === 0 &&
      (m.storage("avispate.profiles.v1") || []).length === 1 &&
      m.storage("avispate.profiles.v1")[0].name === "Yo",
    JSON.stringify(m.storage("avispate.profiles.v1")),
  )
  check(
    "D5 · el motor y la cola de la cuenta desaparecen",
    m.raw("avispate.sync.v1") === null &&
      m.raw("avispate.adjuntos.cola.v1") === null &&
      m.raw("avispate.cuenta.vinculo.v1") === null,
  )
  check(
    "D5 · el dispositivo conserva su identidad y no repite el onboarding",
    !!m.raw("avispate.dispositivo.v1") &&
      m.raw("avispate.onboarding.v1") === "1",
  )
  check(
    "D5 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- D) desvinculado desde otro teléfono
{
  const n = red({ revocado: true })
  const m = montar(bundle, seed(), { fetch: n.fetch })
  await wait(1600)
  check(
    "D6 · el motor apaga el vínculo cuando la nube lo rechaza",
    m.raw("avispate.cuenta.vinculo.v1") === null,
    m.raw("avispate.cuenta.vinculo.v1"),
  )
  await m.irAjustes()
  await wait(120)
  check(
    "D6 · Ajustes lo explica y deja volver a vincular",
    m.txt().includes("desconectado desde otro dispositivo") &&
      m.txt().includes("Sin vincular") &&
      m.txt().includes("Vincular este teléfono"),
    m.txt().slice(0, 300),
  )
  check(
    "D6 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- E) contrato de la migración
{
  const sql = fs.readFileSync(
    path.join(BASE, "supabase/migrations/0006_etapa15_dispositivos.sql"),
    "utf8",
  )
  check(
    "D7 · la migración agrega un nombre por cuenta",
    /add column if not exists nombre text/.test(sql),
  )
  check(
    "D7 · renombrar exige sesión y vínculo",
    sql.includes("renombrar_dispositivo") &&
      sql.includes("auth.uid()") &&
      sql.includes("dispositivo no vinculado"),
  )
  check(
    "D7 · cerrar en todos borra solo los vínculos de la cuenta",
    sql.includes("desvincular_todos_dispositivos") &&
      /where dc\.user_id = v_usuario/.test(sql),
  )
  check(
    "D7 · mis_dispositivos usa el nombre propio",
    sql.includes("coalesce(dc.nombre, d.nombre"),
  )
  check(
    "D7 · anon no puede ejecutar las funciones nuevas",
    /revoke all on function public\.renombrar_dispositivo\(uuid, text\) from public, anon/.test(
      sql,
    ) &&
      /revoke all on function public\.desvincular_todos_dispositivos\(\) from public, anon/.test(
        sql,
      ),
  )
  check(
    "D7 · el cliente pide el cierre global",
    bundle.includes("scope=global") &&
      bundle.includes("desvincular_todos_dispositivos"),
  )
}

process.exit(finish() ? 1 : 0)
