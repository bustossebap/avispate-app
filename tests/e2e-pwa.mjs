// E2E de la Etapa 10 (AVISPATE instalable): el manifest, los íconos y el service worker que hacen que
// la app se pueda agregar a la pantalla de inicio y que el push llegue con la app cerrada.
//
// Se miran los archivos de `dist/` —lo que de verdad se publica— y después la pantalla de Ajustes, que
// es donde se activa. En jsdom no hay service worker ni PushManager: lo que se comprueba ahí es que la
// app lo diga con todas las letras en vez de romperse.
import fs from "node:fs"
import path from "node:path"
import { BASE, cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()
const dist = path.join(BASE, "dist")
const leer = (nombre) => fs.readFileSync(path.join(dist, nombre))

// Un PNG empieza siempre igual (‰PNG) y el tamaño va en el IHDR: ancho y alto, en big endian, después
// de la firma y del bloque de 8 bytes.
function medirPng(nombre) {
  const datos = leer(nombre)
  const firma = datos.subarray(0, 8).toString("hex")
  if (firma !== "89504e470d0a1a0a") return { ok: false, firma }
  return {
    ok: true,
    firma,
    ancho: datos.readUInt32BE(16),
    alto: datos.readUInt32BE(20),
  }
}

// ------------------------------------------- A) El manifest
const manifestRuta = path.join(dist, "manifest.webmanifest")
check("A · el manifest se publica en dist/", fs.existsSync(manifestRuta))
let manifest = {}
try {
  manifest = JSON.parse(fs.readFileSync(manifestRuta, "utf8"))
} catch {}
check("A · es JSON válido", !!manifest && typeof manifest === "object")
check(
  "A · la app se llama AVISPATE y arranca en su raíz",
  manifest.name?.includes("AVISPATE") &&
    manifest.short_name === "AVISPATE" &&
    manifest.start_url === "./" &&
    manifest.scope === "./",
  JSON.stringify({
    name: manifest.name,
    short_name: manifest.short_name,
    start_url: manifest.start_url,
  }),
)
check(
  "A · se abre como app (sin la barra del navegador), en vertical y en español",
  manifest.display === "standalone" && manifest.lang === "es",
  JSON.stringify({ display: manifest.display, lang: manifest.lang }),
)
check(
  "A · lleva los colores de la marca",
  manifest.theme_color === "#F59E0B" && !!manifest.background_color,
  JSON.stringify({
    theme: manifest.theme_color,
    fondo: manifest.background_color,
  }),
)
const iconos = Array.isArray(manifest.icons) ? manifest.icons : []
check(
  "A · trae el ícono de 192 y el de 512 (los que exige Chrome para instalar)",
  iconos.some((i) => i.sizes === "192x192" && i.type === "image/png") &&
    iconos.some((i) => i.sizes === "512x512" && i.type === "image/png"),
  JSON.stringify(iconos),
)
check(
  "A · y uno maskable para que Android no le corte la cabeza a la abeja",
  iconos.some((i) => i.purpose === "maskable" && i.sizes === "512x512"),
  JSON.stringify(iconos.map((i) => [i.sizes, i.purpose])),
)
check(
  "A · cada ícono del manifest existe en dist/",
  iconos.every((i) => fs.existsSync(path.join(dist, i.src.replace("./", "")))),
  JSON.stringify(iconos.map((i) => i.src)),
)

// ------------------------------------------- B) Los íconos son PNG del tamaño que dicen
const tamanos = [
  ["icono-32.png", 32],
  ["icono-180.png", 180],
  ["icono-192.png", 192],
  ["icono-512.png", 512],
]
for (const [nombre, lado] of tamanos) {
  const png = fs.existsSync(path.join(dist, nombre))
    ? medirPng(nombre)
    : { ok: false, firma: "sin archivo" }
  check(
    `B · ${nombre} es un PNG de ${lado}×${lado}`,
    png.ok && png.ancho === lado && png.alto === lado,
    JSON.stringify(png),
  )
}

// ------------------------------------------- C) El index.html publicado
const html = leer("index.html").toString("utf8")
check(
  "C · el HTML enlaza el manifest y el color de la barra",
  html.includes('rel="manifest"') &&
    html.includes("manifest.webmanifest") &&
    html.includes('name="theme-color"'),
)
check(
  "C · y trae el ícono de iPhone y el modo app",
  html.includes('rel="apple-touch-icon"') &&
    html.includes("icono-180.png") &&
    html.includes('name="apple-mobile-web-app-capable"'),
)
check(
  "C · la ventana respeta el borde del teléfono (viewport-fit=cover)",
  html.includes("viewport-fit=cover"),
)
check(
  "C · el HTML apunta al bundle con ruta relativa (dist/ sirve desde cualquier raíz)",
  /src="\.\/assets\/index-[^"]+\.js"/.test(html),
  html.match(/src="[^"]+"/)?.[0] || "",
)

// ------------------------------------------- D) El service worker de esta entrega
const sw = leer("sw.js").toString("utf8")
const assets = fs
  .readdirSync(path.join(dist, "assets"))
  .filter((f) => /\.(js|css)$/.test(f))
check(
  "D · el service worker guarda los assets de ESTA entrega",
  assets.every((a) => sw.includes(a)),
  `${assets.join(", ")} en ${sw.length} bytes`,
)
check(
  "D · estrena caché con un sello (no queda el marcador del build)",
  /const SELLO = "[0-9a-f]{8,}"/.test(sw) && !sw.includes("__SELLO__"),
  sw.match(/const SELLO = [^\n]+/)?.[0] || "",
)
check(
  "D · guarda el armado, lo limpia al activarse y toma el control",
  [
    'addEventListener("install"',
    'addEventListener("activate"',
    "caches.delete",
    "clients.claim",
  ].every((t) => sw.includes(t)),
)
check(
  "D · solo cambia de versión cuando se lo piden (no recarga en medio de un formulario)",
  sw.includes('tipo === "ACTIVAR"') && sw.includes("skipWaiting"),
)
check(
  "D · no toca la nube: la cola y las funciones no se cachean",
  sw.includes('"/rest/v1/"') && sw.includes('"/functions/v1/"'),
)

// ------------------------------------------- E) Ajustes, en la app de verdad
const m = montar(bundle, { "avispate.onboarding.v1": "1" })
await wait(80)
await m.irAjustes()
await wait(80)
const txt = m.txt()
check(
  "E · Ajustes trae la tarjeta de los avisos con la app cerrada",
  txt.includes("Avisos con la app cerrada"),
)
check(
  "E · el permiso del navegador sigue estando aparte (no se mezclan las dos cosas)",
  txt.includes("Permiso de notificaciones"),
)
check(
  "E · dice en cuál de los estados está este dispositivo",
  [
    "Activado en este dispositivo",
    "Falta conectar la nube",
    "Este navegador no puede avisar",
    "Bloqueado en el navegador",
    "Listo para activar",
    "Revisando este dispositivo",
  ].some((estado) => txt.includes(estado)),
  txt.slice(
    txt.indexOf("Avisos con la app cerrada"),
    txt.indexOf("Avisos con la app cerrada") + 260,
  ),
)
check(
  "E · explica cómo instalarla en iPhone y en Android",
  txt.includes("pantalla de inicio") &&
    txt.includes("Instalar") &&
    txt.includes("Android"),
)
check(
  "E · sin suscripción no ofrece «Probar aviso» (no habría por dónde mandarlo)",
  !txt.includes("Probar aviso"),
)
check(
  "E · y la versión del pie ya es la de esta entrega",
  txt.includes("AVISPATE · V2.0 · Etapa 14"),
)
check(
  "E · el bundle sabe suscribirse al push y registrar el service worker",
  bundle.includes("PushManager") && bundle.includes("serviceWorker"),
)
check(
  "E · sin errores de ejecución",
  m.errors.length === 0,
  m.errors.join(" | ").slice(0, 200),
)

process.exit(finish() ? 1 : 0)
