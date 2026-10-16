// Runner de la batería E2E: corre todas las suites de tests/ en orden y resume el resultado.
//
//   npm run test:e2e              · todas, contra el dist/ recién construido
//   npm run test:e2e -- ui7       · solo las suites que contengan "ui7"
//   LIVE_BASE=https://… npm run test:e2e   · contra la entrega publicada en esa dirección
//
// Antes de arrancar comprueba que dist/ no sea más viejo que src/: así no se prueba por error una
// entrega anterior (ni se cae en la trampa de construir y probar a la vez).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const BASE = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const TESTS = path.join(BASE, "tests")
const vivo = process.env.LIVE_BASE || ""

const filtro = process.argv.slice(2).join(" ")
const suites = fs
  .readdirSync(TESTS)
  .filter(
    (f) => f.startsWith("e2e-") && f.endsWith(".mjs") && f.includes(filtro),
  )
  .sort()
if (!suites.length) {
  console.error(`No hay suites que coincidan con "${filtro}" en ${TESTS}`)
  process.exit(2)
}

const masNuevo = (dir) => {
  let ultimo = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) ultimo = Math.max(ultimo, masNuevo(p))
    else ultimo = Math.max(ultimo, fs.statSync(p).mtimeMs)
  }
  return ultimo
}

if (!vivo) {
  const assets = path.join(BASE, "dist/assets")
  const js = fs.existsSync(assets)
    ? fs.readdirSync(assets).filter((f) => f.endsWith(".js"))
    : []
  if (!js.length) {
    console.error(
      "No hay dist/assets/*.js: corré `npm run build` antes de la batería.",
    )
    process.exit(2)
  }
  const dist = Math.max(
    ...js.map((f) => fs.statSync(path.join(assets, f)).mtimeMs),
  )
  const src = Math.max(
    masNuevo(path.join(BASE, "src")),
    fs.statSync(path.join(BASE, "index.html")).mtimeMs,
  )
  if (src > dist) {
    console.error(
      "dist/ es más viejo que src/: corré `npm run build` antes de la batería (si no, se prueba la entrega anterior).",
    )
    process.exit(2)
  }
}

console.log(
  `Batería E2E · ${
    vivo ? `EN VIVO ${vivo}` : "local (dist/)"
  } · ${suites.length} suites\n`,
)

const filas = []
for (const suite of suites) {
  console.log(`=================== ${suite}`)
  const r = spawnSync(process.execPath, [path.join(TESTS, suite)], {
    encoding: "utf8",
    env: process.env,
  })
  const salida = `${r.stdout || ""}${r.stderr || ""}`
  process.stdout.write(salida.endsWith("\n") ? salida : salida + "\n")
  const m = salida.match(/(\d+)\/(\d+) comprobaciones OK/)
  filas.push([
    suite,
    m ? Number(m[1]) : 0,
    m ? Number(m[2]) : 0,
    r.status === 0,
  ])
}

const total = filas.reduce((a, [, ok]) => a + ok, 0)
const esperadas = filas.reduce((a, [, , tot]) => a + tot, 0)
const fallidas = filas.filter(([, , , ok]) => !ok)
console.log("=================== resumen")
for (const [suite, ok, tot, bien] of filas)
  console.log(`${bien ? "OK   " : "FALLA"} ${suite.padEnd(22)} ${ok}/${tot}`)
console.log(
  `\n${total}/${esperadas} comprobaciones OK · ${fallidas.length} suite(s) con fallas`,
)
process.exit(fallidas.length ? 1 : 0)
