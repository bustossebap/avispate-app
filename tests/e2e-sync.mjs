// E2E de la Etapa 15 (fases 2 y 3): el motor de sincronización contra una nube de mentira.
//
// Lo que se prueba sin Supabase: que una cuenta vinculada suba lo local una sola vez, que la primera
// pasada baje antes de subir, que lo remoto se aplique a React (y se guarde), que un cambio remoto más
// nuevo gane, que una tumba borre, que un borrado local viaje como tumba, y que la tarjeta de Ajustes
// muestre el estado. La RLS y las funciones se prueban aparte con `supabase/tests/0005_negativo.sql`.
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const HOY = () => new Date().toISOString()
const HACE = (ms) => new Date(Date.now() - ms).toISOString()
const DEVICE = {
  id: "11111111-1111-4111-8111-111111111111",
  token: "a".repeat(64),
}
const SESION = () =>
  JSON.stringify({
    accessToken: "token-ana",
    refreshToken: "refresh-ana",
    expiraEn: Date.now() + 3600_000,
    usuario: { id: "u-ana", email: "ana@ejemplo.com" },
  })
const YO = { id: "yo", name: "Ana", emoji: "🐝" }
const CATS = [{ name: "Hogar", emoji: "🏠" }]
const evento = (id, name, extra = {}) => ({
  id,
  ownerId: "yo",
  name,
  date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
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
  "avispate.profiles.v1": JSON.stringify([YO]),
  "avispate.activeProfile.v1": "yo",
  "avispate.categorias.v1": JSON.stringify(CATS),
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

// Una nube mínima con la misma forma que las funciones de 0005: guarda filas por entidad, resuelve el
// conflicto por `updated_at`, devuelve lo que tenga `seq` mayor que el cursor y exige el vínculo.
function nube({ filas = [], falla = false } = {}) {
  const tabla = new Map()
  let seq = 0
  let vinculado = true
  let caida = falla
  const llamadas = []
  const clave = (entidad, id) => `${entidad}\u001f${id}`
  const publicar = (
    entidad,
    id,
    payload,
    actualizadoEn = HOY(),
    eliminadoEn = null,
    dispositivoId = "otro-telefono",
  ) => {
    seq += 1
    const fila = {
      entidad,
      id,
      payload,
      updated_at: actualizadoEn,
      deleted_at: eliminadoEn,
      revision: 1,
      dispositivo_id: dispositivoId,
      seq,
    }
    tabla.set(clave(entidad, id), fila)
    return fila
  }
  for (const fila of filas)
    publicar(
      fila.entidad,
      fila.id,
      fila.payload,
      fila.updated_at,
      fila.deleted_at || null,
      fila.dispositivo_id || "otro-telefono",
    )

  const fetchFalso = async (url, opciones = {}) => {
    const direccion = String(url)
    llamadas.push({ url: direccion, opciones })
    if (caida && direccion.includes("/rpc/")) return respuesta({}, 503)
    if (direccion.includes("/rest/v1/rpc/mis_dispositivos"))
      return respuesta(
        vinculado
          ? [
              {
                dispositivo_id: DEVICE.id,
                nombre: "Este teléfono",
                reclamado_en: HOY(),
                ultima_conexion: HOY(),
              },
            ]
          : [],
      )
    if (direccion.includes("/rest/v1/rpc/bajar_cambios")) {
      const datos = cuerpo(opciones)
      const desde = Number(datos.p_desde || 0)
      const limite = Number(datos.p_limite || 200)
      return respuesta(
        [...tabla.values()]
          .filter((f) => f.seq > desde)
          .sort((a, b) => a.seq - b.seq)
          .slice(0, limite),
      )
    }
    if (direccion.includes("/rest/v1/rpc/subir_cambios")) {
      const datos = cuerpo(opciones)
      const cambios = Array.isArray(datos.p_cambios) ? datos.p_cambios : []
      // La función real rechaza lotes de más de 200; el cliente tiene que partir la cola.
      if (cambios.length > 200)
        return respuesta({ message: "demasiados cambios en un lote" }, 400)
      let subidos = 0
      let ignorados = 0
      for (const cambio of cambios) {
        const anterior = tabla.get(clave(cambio.entidad, cambio.id))
        const hora = Date.parse(cambio.actualizadoEn)
        if (anterior && hora < Date.parse(anterior.updated_at)) {
          ignorados += 1
          continue
        }
        seq += 1
        tabla.set(clave(cambio.entidad, cambio.id), {
          entidad: cambio.entidad,
          id: cambio.id,
          payload: cambio.payload ?? {},
          updated_at: cambio.actualizadoEn,
          deleted_at: cambio.eliminadoEn || null,
          revision: (anterior?.revision || 0) + 1,
          dispositivo_id: datos.p_dispositivo,
          seq,
        })
        subidos += 1
      }
      return respuesta({ ok: true, subidos, ignorados })
    }
    if (direccion.includes("/auth/v1/user"))
      return respuesta({ id: "u-ana", email: "ana@ejemplo.com" })
    if (direccion.includes("/auth/v1/logout")) return respuesta({})
    return respuesta({}, 404)
  }

  return {
    fetch: fetchFalso,
    llamadas,
    tabla,
    publicar,
    fila: (entidad, id) => tabla.get(clave(entidad, id)),
    subidas: () => llamadas.filter((l) => l.url.includes("/rpc/subir_cambios")),
    bajadas: () => llamadas.filter((l) => l.url.includes("/rpc/bajar_cambios")),
    caer: (valor) => {
      caida = valor
    },
    desvincular: () => {
      vinculado = false
    },
  }
}

const botonExacto = (m, texto) =>
  [...m.doc.querySelectorAll("#root button")].find(
    (b) => (b.textContent || "").trim() === texto,
  ) || null

// ------------------------------------------- A) lo local se sube una vez
{
  const n = nube()
  const m = montar(
    bundle,
    seed({
      "avispate.events.v1": JSON.stringify([evento("local-1", "Pagar la luz")]),
    }),
    { fetch: n.fetch },
  )
  await wait(1800)

  const subida = n.subidas()[0]
  const cambios = cuerpo(subida?.opciones).p_cambios || []
  check("A1 · la cuenta vinculada sube sin tocar nada", !!subida)
  check(
    "A1 · el cuerpo lleva el id y el token del teléfono",
    cuerpo(subida?.opciones).p_dispositivo === DEVICE.id &&
      cuerpo(subida?.opciones).p_token === DEVICE.token,
  )
  check(
    "A1 · el recordatorio local viaja con su id",
    cambios.some((c) => c.entidad === "recordatorios" && c.id === "local-1"),
    JSON.stringify(cambios.map((c) => `${c.entidad}:${c.id}`)),
  )
  check(
    "A1 · el perfil y las categorías también viajan",
    cambios.some((c) => c.entidad === "perfiles" && c.id === "yo") &&
      cambios.some((c) => c.entidad === "categorias" && c.id === "Hogar"),
  )
  check(
    "A1 · la nube de mentira guardó el recordatorio",
    n.fila("recordatorios", "local-1")?.payload?.name === "Pagar la luz",
  )
  const estado = JSON.parse(m.raw("avispate.sync.v1") || "null")
  check(
    "A1 · la cola queda vacía y la última pasada fue buena",
    estado?.cola?.length === 0 && estado?.ultima?.ok === true,
    JSON.stringify(estado?.ultima),
  )
  check(
    "A1 · el cursor avanza con lo que devolvió la nube",
    typeof estado?.cursor === "number" && estado.cursor > 0,
  )
  check(
    "A1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- B) la primera pasada baja antes de subir
{
  const n = nube({
    filas: [
      {
        entidad: "recordatorios",
        id: "remoto-1",
        payload: evento("remoto-1", "Venía del otro teléfono"),
        updated_at: HACE(60_000),
      },
    ],
  })
  const m = montar(bundle, seed({ "avispate.events.v1": JSON.stringify([]) }), {
    fetch: n.fetch,
  })
  await wait(1800)

  check(
    "B1 · lo remoto aparece en los recordatorios del teléfono",
    m.events().some((e) => e.id === "remoto-1"),
    JSON.stringify(m.events().map((e) => e.id)),
  )
  check(
    "B1 · el orden de la primera pasada es bajar y después subir",
    n.llamadas.findIndex((l) => l.url.includes("bajar_cambios")) <
      n.llamadas.findIndex((l) => l.url.includes("subir_cambios")),
  )
  check(
    "B1 · la fila bajada no se devuelve como cambio local",
    !n
      .subidas()
      .some((l) =>
        (cuerpo(l.opciones).p_cambios || []).some(
          (c) => c.entidad === "recordatorios" && c.id === "remoto-1",
        ),
      ),
  )
  const estado = JSON.parse(m.raw("avispate.sync.v1") || "null")
  check(
    "B1 · el cursor pasa por la marca de la fila remota",
    estado?.cursor >= n.fila("recordatorios", "remoto-1")?.seq,
    `${estado?.cursor} vs ${n.fila("recordatorios", "remoto-1")?.seq}`,
  )
  // El cursor también salta lo que la propia pasada subió (perfil y categorías): no hay que volver a
  // bajarlo en la siguiente vuelta.
  const marcas = [...n.tabla.values()].map((f) => f.seq)
  check(
    "B1 · el cursor no se queda atrás de lo ya visto",
    estado?.cursor === Math.max(...marcas),
    `${estado?.cursor} vs ${Math.max(...marcas)}`,
  )

  // Un cambio remoto más nuevo gana al abrir «Sincronizar ahora» en Ajustes.
  await m.irAjustes()
  check(
    "B2 · la tarjeta de cuenta muestra la sincronización",
    m.txt().includes("Sincronización") &&
      m.txt().includes("Al día") &&
      !!m.byLabel("Sincronizar la cuenta ahora"),
    m.txt().slice(-260),
  )
  n.publicar(
    "recordatorios",
    "remoto-1",
    evento("remoto-1", "Cambiado en la nube"),
    new Date(Date.now() + 30_000).toISOString(),
  )
  m.press(m.byLabel("Sincronizar la cuenta ahora"))
  await wait(500)
  check(
    "B2 · lo remoto más nuevo se aplica y se guarda",
    m.events().find((e) => e.id === "remoto-1")?.name ===
      "Cambiado en la nube" &&
      m.events().find((e) => e.id === "remoto-1")?.name ===
        JSON.parse(m.raw("avispate.events.v1"))[0]?.name,
    JSON.stringify(m.events().find((e) => e.id === "remoto-1")),
  )

  // Si las horas empatan, gana el id de dispositivo mayor. El remoto se publica con la misma hora
  // que la fila que ya está en la nube y un id mayor que el de este teléfono.
  const filaEmpate = n.fila("recordatorios", "remoto-1")
  n.publicar(
    "recordatorios",
    "remoto-1",
    evento("remoto-1", "Gana el dispositivo mayor"),
    filaEmpate.updated_at,
    null,
    "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz",
  )
  m.press(m.byLabel("Sincronizar la cuenta ahora"))
  await wait(500)
  check(
    "B2b · a igual hora gana el dispositivo con id mayor",
    m.events().find((e) => e.id === "remoto-1")?.name ===
      "Gana el dispositivo mayor",
    JSON.stringify(m.events().find((e) => e.id === "remoto-1")),
  )

  // Una tumba remota borra la fila local en la siguiente pasada.
  n.publicar(
    "recordatorios",
    "remoto-1",
    evento("remoto-1", "Cambiado en la nube"),
    new Date(Date.now() + 60_000).toISOString(),
    new Date(Date.now() + 60_000).toISOString(),
  )
  m.press(m.byLabel("Sincronizar la cuenta ahora"))
  await wait(500)
  check(
    "B3 · una tumba remota quita el recordatorio del teléfono",
    !m.events().some((e) => e.id === "remoto-1"),
    JSON.stringify(m.events().map((e) => e.id)),
  )
  check(
    "B3 · y no se vuelve a subir como vivo",
    !n
      .subidas()
      .some((l) =>
        (cuerpo(l.opciones).p_cambios || []).some(
          (c) => c.entidad === "recordatorios" && c.id === "remoto-1",
        ),
      ),
  )
  check(
    "B3 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- C) sin red la cola no se pierde
{
  const n = nube({ falla: true })
  const m = montar(
    bundle,
    seed({
      "avispate.events.v1": JSON.stringify([
        evento("sin-red-1", "Guardado sin conexión"),
      ]),
    }),
    { fetch: n.fetch },
  )
  await wait(1800)

  check(
    "C1 · la app sigue viva cuando la nube falla",
    m.events().some((e) => e.id === "sin-red-1"),
  )
  const estado = JSON.parse(m.raw("avispate.sync.v1") || "null")
  check(
    "C1 · la última pasada queda marcada como fallida",
    estado?.ultima?.ok === false,
  )
  await m.irAjustes()
  check(
    "C1 · la tarjeta cuenta que hubo un aviso",
    m.txt().includes("Con aviso") ||
      m.txt().includes("La última pasada no pudo completarse"),
    m.txt().slice(-300),
  )
  // La cola no se pierde y la siguiente pasada (forzada) la vuelve a intentar: el fallo no deja el
  // teléfono trabado esperando un cambio nuevo.
  n.caer(false)
  m.press(m.byLabel("Sincronizar la cuenta ahora"))
  await wait(700)
  const recuperado = JSON.parse(m.raw("avispate.sync.v1") || "null")
  check(
    "C2 · al volver la nube la cola pendiente se sube",
    recuperado?.cola?.length === 0 &&
      recuperado?.ultima?.ok === true &&
      n.fila("recordatorios", "sin-red-1")?.payload?.name ===
        "Guardado sin conexión",
    JSON.stringify(recuperado?.ultima),
  )
  check(
    "C1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- D) borrar acá manda una tumba
{
  const n = nube()
  const m = montar(
    bundle,
    seed({
      "avispate.events.v1": JSON.stringify([
        evento("borrar-1", "Se va a borrar"),
      ]),
    }),
    { fetch: n.fetch },
  )
  await wait(1800)
  check(
    "D1 · primero se sube el recordatorio vivo",
    n.fila("recordatorios", "borrar-1")?.deleted_at === null,
  )

  m.press(
    [...m.doc.querySelectorAll("#root button")].find((b) =>
      (b.textContent || "").includes("Se va a borrar"),
    ),
  )
  await wait(100)
  m.press(botonExacto(m, "Eliminar recordatorio"))
  await wait(80)
  const modal = [...m.doc.querySelectorAll("#root div.fixed")].find((d) =>
    (d.textContent || "").includes("¿Eliminar este recordatorio?"),
  )
  m.press(
    modal &&
      [...modal.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === "Eliminar",
      ),
  )
  await wait(1800)

  const tumba = n
    .subidas()
    .flatMap((l) => cuerpo(l.opciones).p_cambios || [])
    .filter((c) => c.entidad === "recordatorios" && c.id === "borrar-1")
    .pop()
  check(
    "D1 · el borrado local se encola como tumba",
    !!tumba && tumba.payload === null && !!tumba.eliminadoEn,
    JSON.stringify(tumba),
  )
  check(
    "D1 · la nube guarda la marca de borrado",
    !!n.fila("recordatorios", "borrar-1")?.deleted_at,
  )
  check(
    "D1 · la fila ya no está en el teléfono",
    !m.events().some((e) => e.id === "borrar-1"),
  )
  check(
    "D1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- E) una cola grande se sube en tandas y la bajada pagina
{
  const muchos = Array.from({ length: 205 }, (_, i) =>
    evento(`masivo-${i}`, `Recordatorio ${i}`),
  )
  const n = nube()
  const m = montar(
    bundle,
    seed({ "avispate.events.v1": JSON.stringify(muchos) }),
    { fetch: n.fetch },
  )
  await wait(3200)

  const lotes = n
    .subidas()
    .map((l) => (cuerpo(l.opciones).p_cambios || []).length)
  check(
    "E1 · ningún lote supera los 200 cambios del servidor",
    lotes.length > 0 && lotes.every((n) => n <= 200),
    JSON.stringify(lotes),
  )
  check(
    "E1 · la cola de 205 recordatorios se parte en más de un lote",
    lotes.length >= 2 && lotes.some((n) => n === 200),
    JSON.stringify(lotes),
  )
  const filas = [...n.tabla.values()].filter(
    (f) => f.entidad === "recordatorios",
  )
  check(
    "E1 · la nube termina con los 205 recordatorios",
    filas.length === 205 && filas.some((f) => f.id === "masivo-204"),
    `${filas.length}`,
  )
  const estado = JSON.parse(m.raw("avispate.sync.v1") || "null")
  check(
    "E2 · la cola queda vacía después de todas las tandas",
    estado?.cola?.length === 0,
    JSON.stringify(estado?.cola?.slice(0, 3)),
  )
  check(
    "E2 · la bajada pidió más de una página y el cursor quedó al final",
    n.bajadas().length >= 2 &&
      estado?.cursor === Math.max(...[...n.tabla.values()].map((f) => f.seq)),
    `${n.bajadas().length} páginas · cursor ${estado?.cursor}`,
  )
  check(
    "E2 · los 205 siguen en el teléfono",
    m.events().length === 205 && m.events().some((e) => e.id === "masivo-204"),
    `${m.events().length}`,
  )
  check(
    "E2 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

process.exit(finish() ? 1 : 0)
