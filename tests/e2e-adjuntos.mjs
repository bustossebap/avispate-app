// E2E de la Etapa 15 (fase 5): adjuntos en Storage. Comprueba el contrato del bucket privado, las
// políticas por dueño, que el detalle distingue «En la nube» de «Solo en este teléfono», que baja un
// archivo remoto con URL firmada y que la limpieza de huérfanos no toca lo referenciado.
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
const evento = {
  id: "e-adj",
  ownerId: "yo",
  name: "Con foto",
  date: new Date().toISOString().slice(0, 10),
  time: "12:00",
  category: "Hogar",
  categoryEmoji: "🏠",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels: ["Notificación"],
  attachments: [
    {
      id: "f1",
      name: "foto.jpg",
      type: "image/jpeg",
      size: 10,
      remoto: "u-ana/f1",
      remotoEn: new Date().toISOString(),
    },
    { id: "f2", name: "nota.txt", type: "text/plain", size: 4 },
  ],
}
const seed = (extra = {}) => ({
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([
    {
      id: "yo",
      name: "Ana",
      emoji: "🐝",
      contact: {
        phone: "+56 9 1111 2222",
        email: "ana@ejemplo.com",
        accepted: true,
      },
    },
  ]),
  "avispate.activeProfile.v1": "yo",
  "avispate.events.v1": JSON.stringify([evento]),
  "avispate.cuenta.v1": SESION,
  "avispate.cuenta.vinculo.v1": "u-ana",
  "avispate.dispositivo.v1": JSON.stringify(DEVICE),
  ...extra,
})

const respuesta = (datos, status = 200) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json" },
  })

// Nube mínima de Storage. La lista devuelve el archivo referenciado y uno huérfano; el DELETE del
// huérfano queda anotado para comprobar que la limpieza borra solo lo que no se usa.
function red() {
  const llamadas = []
  const fetchFalso = async (url, opciones = {}) => {
    const direccion = String(url)
    llamadas.push({ url: direccion, opciones })
    if (direccion.includes("/storage/v1/object/sign/adjuntos/"))
      return respuesta({
        signedURL: "/object/sign/adjuntos/u-ana/f1?token=firmado",
      })
    if (direccion.includes("token=firmado"))
      return new Response(new Blob(["foto"], { type: "image/jpeg" }), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    if (direccion.includes("/storage/v1/object/list/adjuntos"))
      return respuesta([
        { name: "f1", metadata: { size: 10 } },
        { name: "huerfano", metadata: { size: 7 } },
      ])
    if (
      direccion.includes("/storage/v1/object/adjuntos/u-ana/huerfano") &&
      (opciones.method || "GET") === "DELETE"
    )
      return respuesta({})
    if (direccion.includes("/rest/v1/rpc/bajar_cambios")) return respuesta([])
    if (direccion.includes("/rest/v1/rpc/subir_cambios"))
      return respuesta({ ok: true, subidos: 0, ignorados: 0 })
    return respuesta({})
  }
  return { fetch: fetchFalso, llamadas }
}

// ------------------------------------------- A) el detalle muestra el estado de cada archivo
{
  const n = red()
  const m = montar(bundle, seed(), { fetch: n.fetch, descargas: true })
  await wait(250)
  m.clickText("p", "Con foto")
  await wait(500)

  check(
    "A1 · el archivo con copia remota dice «En la nube»",
    m.txt().includes("En la nube"),
    m.txt().slice(-300),
  )
  check(
    "A1 · el que solo está en el teléfono lo dice",
    m.txt().includes("Solo en este teléfono"),
  )
  check(
    "A1 · el remoto se firma y se descarga para mostrarlo",
    n.llamadas.some((l) =>
      l.url.includes("/storage/v1/object/sign/adjuntos/u-ana/f1"),
    ) && n.llamadas.some((l) => l.url.includes("token=firmado")),
  )
  check(
    "A1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- B) la cola y la limpieza de huérfanos
{
  const n = red()
  const m = montar(
    bundle,
    seed({
      "avispate.adjuntos.cola.v1": JSON.stringify([
        {
          id: "f3",
          nombre: "pendiente.jpg",
          tipo: "image/jpeg",
          creadoEn: new Date().toISOString(),
        },
      ]),
    }),
    { fetch: n.fetch, descargas: true },
  )
  await wait(250)
  await m.irAjustes()
  await wait(120)

  check(
    "B1 · Ajustes cuenta los archivos que esperan conexión",
    m.txt().includes("1 archivo espera"),
    m.txt().slice(-500),
  )
  m.clickText("button", "Revisar copias sin usar")
  await wait(200)
  check(
    "B1 · la limpieza borra solo el archivo huérfano",
    n.llamadas.some(
      (l) =>
        l.url.includes("/storage/v1/object/adjuntos/u-ana/huerfano") &&
        (l.opciones.method || "GET") === "DELETE",
    ) &&
      !n.llamadas.some(
        (l) =>
          l.url.includes("/storage/v1/object/adjuntos/u-ana/f1") &&
          (l.opciones.method || "GET") === "DELETE",
      ),
  )
  check(
    "B1 · y lo cuenta en la tarjeta",
    m.txt().includes("Se borraron 1 copia sin usar en la nube."),
    m.txt().slice(-300),
  )
  check(
    "B1 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- C) contrato de Storage
{
  const sql = fs.readFileSync(
    path.join(BASE, "supabase/migrations/0007_etapa15_adjuntos.sql"),
    "utf8",
  )
  check(
    "C1 · el bucket existe, es privado y tiene tope de 10 MB",
    /insert into storage\.buckets/.test(sql) &&
      /'adjuntos',\s*'adjuntos',\s*false,\s*10485760/s.test(sql),
  )
  check(
    "C1 · la lista de tipos permitidos está en el bucket",
    /allowed_mime_types/.test(sql) &&
      sql.includes("image/jpeg") &&
      sql.includes("application/pdf"),
  )
  check(
    "C1 · las cuatro operaciones tienen política por dueño",
    ["select", "insert", "update", "delete"].every((cmd) =>
      new RegExp(`on storage\\.objects for ${cmd} to authenticated`).test(sql),
    ),
  )
  check(
    "C1 · cada política compara la primera carpeta con auth.uid()",
    (
      sql.match(/storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g) ||
      []
    ).length >= 4,
  )
  check(
    "C1 · el cliente usa las rutas REST de Storage y las URLs firmadas",
    bundle.includes("/storage/v1/object/sign/") &&
      bundle.includes("/storage/v1/object/list/") &&
      bundle.includes("avispate.adjuntos.cola.v1"),
  )
  check(
    "C1 · la tarjeta y el detalle explican dónde vive el archivo",
    bundle.includes("Adjuntos en la nube") &&
      bundle.includes("En la nube") &&
      bundle.includes("Solo en este teléfono"),
  )
}

process.exit(finish() ? 1 : 0)
