// E2E de la Etapa 15 (fase 6): Realtime sin SDK. Un WebSocket de mentira comprueba el join con el JWT
// y las cinco tablas, el estado en Ajustes y que un aviso del servidor dispara una pasada del motor.
import fs from "node:fs"
import path from "node:path"
import { BASE, cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const DEVICE = {
  id: "11111111-1111-4111-8111-111111111111",
  token: "a".repeat(64),
}
const SESION = JSON.stringify({
  accessToken: "token-ana",
  refreshToken: "refresh-ana",
  expiraEn: Date.now() + 3600_000,
  usuario: { id: "u-ana", email: "ana@ejemplo.com" },
})
const seed = {
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([
    { id: "yo", name: "Ana", emoji: "🐝" },
  ]),
  "avispate.activeProfile.v1": "yo",
  "avispate.cuenta.v1": SESION,
  "avispate.cuenta.vinculo.v1": "u-ana",
  "avispate.dispositivo.v1": JSON.stringify(DEVICE),
}

const respuesta = (datos, status = 200) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json" },
  })

// Un WebSocket mínimo con la misma superficie que usa el módulo. `abrir` y `recibir` simulan los dos
// momentos del servidor; `enviados` guarda el join y los latidos.
class FakeWS {
  static instancias = []
  constructor(url) {
    this.url = String(url)
    this.enviados = []
    this.cerrado = false
    FakeWS.instancias.push(this)
  }
  send(dato) {
    this.enviados.push(JSON.parse(dato))
  }
  close() {
    this.cerrado = true
  }
  abrir() {
    this.onopen?.({})
  }
  recibir(mensaje) {
    this.onmessage?.({ data: JSON.stringify(mensaje) })
  }
}

function red() {
  const llamadas = []
  const fetchFalso = async (url, opciones = {}) => {
    const direccion = String(url)
    llamadas.push({ url: direccion, opciones })
    if (direccion.includes("/rest/v1/rpc/mis_dispositivos"))
      return respuesta([
        {
          dispositivo_id: DEVICE.id,
          nombre: "iPhone de Ana",
          reclamado_en: new Date().toISOString(),
          ultima_conexion: new Date().toISOString(),
        },
      ])
    if (direccion.includes("/rest/v1/rpc/bajar_cambios")) return respuesta([])
    if (direccion.includes("/rest/v1/rpc/subir_cambios"))
      return respuesta({ ok: true, subidos: 0, ignorados: 0 })
    return respuesta({})
  }
  return { fetch: fetchFalso, llamadas }
}

const bajadas = (n) =>
  n.llamadas.filter((l) => l.url.includes("/rpc/bajar_cambios")).length

// ------------------------------------------- A) join, estado y aviso
{
  FakeWS.instancias = []
  const n = red()
  const m = montar(bundle, seed, { fetch: n.fetch, websocket: FakeWS })
  await wait(1500)

  const abiertos = FakeWS.instancias.filter((w) => !w.cerrado)
  const ws = abiertos.at(-1)
  check(
    "T1 · se abre un socket al Realtime de Supabase",
    abiertos.length >= 1 &&
      ws.url.includes("/realtime/v1/websocket") &&
      ws.url.includes("vsn=1.0.0"),
    FakeWS.instancias
      .map((w) => `${w.url}${w.cerrado ? " (cerrado)" : ""}`)
      .join(" | "),
  )
  ws.abrir()
  await wait(40)
  const join = ws.enviados.find((e) => e.event === "phx_join")
  const cambios = join?.payload?.config?.postgres_changes || []
  check(
    "T1 · el join lleva el JWT y el filtro de la cuenta",
    join?.topic === "realtime:avispate" &&
      join?.payload?.access_token === "token-ana" &&
      join?.payload?.config?.presence?.key === "u-ana",
    String(JSON.stringify(join?.payload)).slice(0, 260),
  )
  check(
    "T1 · pide las cinco tablas del motor, filtradas por usuario",
    cambios.length === 5 &&
      ["recordatorios", "categorias", "perfiles", "ajustes", "marcas"].every(
        (tabla) => cambios.some((c) => c.table === tabla),
      ) &&
      cambios.every((c) => c.filter === "user_id=eq.u-ana"),
    JSON.stringify(cambios),
  )

  await m.irAjustes()
  await wait(120)
  check(
    "T2 · Ajustes muestra el tiempo real conectado",
    m.txt().includes("Tiempo real: conectado"),
    m.txt().slice(-400),
  )

  const antes = bajadas(n)
  ws.recibir({
    event: "postgres_changes",
    payload: {
      data: {
        table: "recordatorios",
        type: "UPDATE",
        commit_timestamp: new Date().toISOString(),
      },
    },
  })
  await wait(900)
  check(
    "T2 · un cambio remoto dispara una pasada del motor",
    bajadas(n) > antes,
    `${antes} → ${bajadas(n)}`,
  )
  check(
    "T2 · y Ajustes cuenta cuál fue la última tabla",
    m.txt().includes("último aviso: recordatorios"),
    m.txt().slice(-300),
  )

  ws.onclose?.({})
  await wait(40)
  check(
    "T2 · si el socket se cae, la tarjeta pasa a reconectando",
    m.txt().includes("Tiempo real: reconectando"),
  )
  check(
    "T2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- B) contrato de la migración
{
  const sql = fs.readFileSync(
    path.join(BASE, "supabase/migrations/0008_etapa15_realtime.sql"),
    "utf8",
  )
  check(
    "T3 · la migración crea la publicación si falta",
    /create publication supabase_realtime/.test(sql),
  )
  check(
    "T3 · agrega las cinco tablas a supabase_realtime",
    /pg_publication_tables/.test(sql) &&
      ["recordatorios", "categorias", "perfiles", "ajustes", "marcas"].every(
        (tabla) => sql.includes(`'${tabla}'`),
      ),
  )
  check(
    "T3 · es idempotente: comprueba antes de agregar",
    /if not exists \(\s*select 1\s*from pg_publication_tables/s.test(sql) &&
      /alter publication supabase_realtime add table/.test(sql),
  )
  check(
    "T3 · el cliente habla el protocolo Phoenix sin SDK",
    bundle.includes("realtime:avispate") &&
      bundle.includes("phx_join") &&
      bundle.includes("postgres_changes") &&
      bundle.includes("user_id=eq."),
  )
  check(
    "T3 · la app no importa el SDK de Supabase",
    !bundle.includes("SupabaseClient") &&
      !bundle.includes("@supabase/supabase-js"),
  )
  check(
    "T3 · el estado se muestra en la tarjeta de sincronización",
    bundle.includes("Tiempo real: conectado") &&
      bundle.includes("Tiempo real: reconectando"),
  )
}

process.exit(finish() ? 1 : 0)
