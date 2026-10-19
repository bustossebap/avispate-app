// Harness de la batería E2E: monta el bundle real dentro de jsdom y entrega las ayudas comunes.
// Todo lo que antes estaba copiado en las ocho suites (el montaje, `wait`, `click`, `find`, `type`,
// `storage`, el reporter) vive acá: un arreglo se hace una vez y vale para todas.
//
// Uso típico en una suite:
//
//   import { cargarBundle, montar, reporter, wait } from "./harness.mjs";
//   const { live, bundle, css } = await cargarBundle();
//   const { check, finish } = reporter();
//   const m = montar(bundle, { "avispate.onboarding.v1": "1", ... });
//   ...
//   process.exit(finish() ? 1 : 0);
//
// `montar` acepta opciones para las dos cosas que la app usa y jsdom no trae:
//   montar(bundle, seed, { notificaciones: { permission, grant, supported }, descargas: true })
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { JSDOM } from "jsdom"

// La raíz del proyecto (la carpeta que contiene dist/, src/ y tests/).
export const BASE = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// El bundle (y el CSS) de la entrega que se está probando: el de `dist/` recién construido o, si se
// pasa LIVE_BASE, el que está publicado en esa dirección. En vivo se trae también el CSS, para que las
// comprobaciones estáticas miren lo mismo que el navegador.
export async function cargarBundle({
  vivo = process.env.LIVE_BASE || "",
} = {}) {
  if (vivo) {
    // Reintentos: justo después de un despliegue el alias puede tardar un momento en servir un asset, y
    // un 404 pasajero no debería tumbar la suite (eso daba un 0/0 sin explicación).
    const get = async (u) => {
      let ultimo = ""
      for (let intento = 0; intento < 3; intento++) {
        const r = await fetch(u, { headers: { "Cache-Control": "no-cache" } })
        if (r.ok) return r.text()
        ultimo = `${u} -> ${r.status}`
        await wait(1000)
      }
      throw new Error(ultimo)
    }
    const html = await get(vivo + "/")
    // El build usa `base: "./"` (para que dist/ se pueda servir desde cualquier raíz), así que los
    // assets llegan como `./assets/…` y no como `/assets/…`. Se resuelven contra la dirección para
    // quedarse con la ruta absoluta, que es la que se le pide al servidor.
    const ruta = (etiqueta, ext) => {
      const src = html.match(
        new RegExp(`${etiqueta}="([^"]*assets/[^"]+\\.${ext})"`),
      )
      if (!src)
        throw new Error(
          `index.html en vivo sin assets/${ext}: ${html.slice(0, 120)}`,
        )
      return new URL(src[1], vivo + "/").pathname
    }
    const jsPath = ruta("src", "js")
    const cssPath = ruta("href", "css")
    const bundle = await get(vivo + jsPath)
    let css = ""
    try {
      css = await get(vivo + cssPath)
    } catch (e) {
      // Si el CSS en vivo no aparece, se sigue con el local (para estas reglas es el mismo) y se avisa.
      console.warn(
        `OJO: no se pudo bajar el CSS en vivo (${String(e).slice(0, 70)}); se usa el local`,
      )
      const assets = path.join(BASE, "dist/assets")
      css = fs.readFileSync(
        path.join(
          assets,
          fs.readdirSync(assets).find((f) => f.endsWith(".css")),
        ),
        "utf8",
      )
    }
    console.log(`EN VIVO ${vivo} · ${jsPath} · ${cssPath}\n`)
    return { vivo, live: vivo, bundle, css, jsPath, cssPath }
  }
  const assets = path.join(BASE, "dist/assets")
  if (!fs.existsSync(assets))
    throw new Error("No hay dist/: corré `npm run build` antes de la batería.")
  const jsPath = fs.readdirSync(assets).find((f) => f.endsWith(".js"))
  const cssPath = fs.readdirSync(assets).find((f) => f.endsWith(".css"))
  if (!jsPath || !cssPath)
    throw new Error("dist/assets no tiene JS/CSS: corré `npm run build`.")
  return {
    vivo: "",
    live: "",
    bundle: fs.readFileSync(path.join(assets, jsPath), "utf8"),
    css: fs.readFileSync(path.join(assets, cssPath), "utf8"),
    jsPath,
    cssPath,
  }
}

// Monta la app con el bundle ya cargado.
export function montar(bundle, seed = {}, opciones = {}) {
  const errors = []
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
      // La cuenta (Etapa 15) vuelve del correo con los tokens en el hash: una suite puede montar la
      // app con esa dirección para probar el enlace mágico sin abrir un navegador.
      url: opciones.url || "https://avispate-app.vercel.app/",
    },
  )
  const { window } = dom
  window.matchMedia = (q) => ({
    media: q,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
  })
  window.addEventListener("error", (e) =>
    errors.push(String(e.message || e.error)),
  )
  window.onerror = (m) => errors.push(String(m))

  // Red de mentira (Etapa 14): las suites de WhatsApp y correo necesitan ver qué sube la cola y qué
  // devuelve la nube sin un Supabase de verdad. El bundle usa `fetch` en el momento de llamar, así
  // que instalarlo acá antes de evaluar alcanza; la suite decide qué responder y anota las llamadas.
  if (opciones.fetch) window.fetch = opciones.fetch
  // El tiempo real se prueba con un WebSocket de mentira: el bundle usa el global del navegador.
  if (opciones.websocket) window.WebSocket = opciones.websocket

  // Avisos del navegador de mentira: se ve el permiso, se puede pedir y se cuentan los enviados.
  const sent = []
  const state = {
    permission: (opciones.notificaciones || {}).permission || "default",
    asks: 0,
  }
  const notif = opciones.notificaciones
  if (notif) {
    window.__sent = sent
    const Fake = function (title, opts) {
      sent.push({ title: String(title), body: opts?.body || "" })
    }
    Fake.requestPermission = () => {
      state.asks += 1
      const p = notif.grant || "granted"
      state.permission = p
      return Promise.resolve(p)
    }
    Object.defineProperty(Fake, "permission", {
      get: () => state.permission,
      set: (v) => {
        state.permission = v
      },
      configurable: true,
    })
    if (notif.supported !== false) window.Notification = Fake
  }
  // Descargas (.ics, .json) y ventanas nuevas (Outlook / Google Calendar), que jsdom no implementa.
  const downloads = []
  const downloadNames = []
  const opened = []
  if (opciones.descargas) {
    window.URL.createObjectURL = (blob) => {
      downloads.push(blob)
      return `blob:recuerda-${downloads.length}`
    }
    window.URL.revokeObjectURL = () => {}
    // El nombre del archivo viaja en el atributo `download` del <a> que la app toca: se anota el clic
    // para poder comprobarlo (jsdom no dispara ninguna descarga de verdad).
    const clickOriginal = window.HTMLAnchorElement.prototype.click
    window.HTMLAnchorElement.prototype.click = function () {
      const nombre = this.getAttribute("download")
      if (nombre) {
        downloadNames.push(nombre)
        // jsdom no descarga: dejar que siga solo ensucia la salida con «Not implemented: navigation».
        return
      }
      return clickOriginal.call(this)
    }
    window.open = (url) => {
      opened.push(String(url))
      return null
    }
  }
  // Menú de compartir del teléfono (Web Share API con archivos): jsdom no lo trae. Con
  // opciones.compartir se simula, y con { cancelar: true } se simula que la persona cierra el menú
  // sin compartir nada, que la app tiene que tratar como «no se compartió» y no como un error.
  const shared = []
  if (opciones.compartir) {
    const definir = (clave, valor) =>
      Object.defineProperty(window.navigator, clave, {
        value: valor,
        configurable: true,
      })
    definir("canShare", () => true)
    definir("share", async (datos) => {
      if (opciones.compartir.cancelar) {
        const error = new Error("compartir cancelado")
        error.name = "AbortError"
        throw error
      }
      shared.push(datos)
    })
  }

  for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v)
  window.eval(bundle)

  const doc = window.document
  const root = () => doc.getElementById("root")
  const txt = () => root().textContent || ""
  const html = () => root().innerHTML
  const click = (el) =>
    el.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    )
  // Tocar sin exigir que el elemento exista: una comprobación que falla se cuenta como falla y no
  // revienta la corrida entera.
  const press = (el) => {
    if (el) click(el)
    return !!el
  }
  const find = (sel, text) =>
    [...doc.querySelectorAll(sel)].find(
      (e) => (e.textContent || "").trim() === text,
    ) ||
    [...doc.querySelectorAll(sel)].find((e) =>
      (e.textContent || "").includes(text),
    )
  const pressText = (sel, text) => press(find(sel, text))
  const clickText = (sel, text) => {
    const el = find(sel, text)
    if (!el) throw new Error(`no encontrado ${sel} "${text}"`)
    click(el)
    return el
  }
  const type = (el, value) => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(el, value)
    el.dispatchEvent(new window.Event("input", { bubbles: true }))
  }
  const pick = (el, value) => {
    Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    ).set.call(el, value)
    el.dispatchEvent(new window.Event("change", { bubbles: true }))
  }
  const input = (id) => doc.getElementById(id)
  const storage = (k) => {
    const raw = window.localStorage.getItem(k)
    return raw === null ? null : JSON.parse(raw)
  }
  const raw = (k) => window.localStorage.getItem(k)
  const events = () => storage("avispate.events.v1") || []
  const notifications = () => storage("avispate.notifications.v1") || []
  const notifOf = (name) => notifications().find((n) => n.eventName === name)
  const profileOf = (id) =>
    (storage("avispate.profiles.v1") || []).find((p) => p.id === id)
  // Buscar por aria-label comparando el atributo y no con un selector: los selectores de atributo con
  // emoji fallan en el motor de jsdom, y media app tiene etiquetas con emoji.
  // En todo el documento y no solo en #root: los modales (la hoja de emojis, la foto) se dibujan con un
  // portal dentro del marco de la app, y ahí afuera no llega un selector con el prefijo #root.
  const byLabel = (text) =>
    [...doc.querySelectorAll("[aria-label]")].find(
      (el) => el.getAttribute("aria-label") === text,
    ) || null
  const badge = byLabel
  const cardOf = (label) => {
    const p = [...doc.querySelectorAll("#root p")].find(
      (el) => (el.textContent || "").trim() === label,
    )
    return p?.closest('div[class*="rounded-3xl"]') || null
  }
  const dots = () => [
    ...doc.querySelectorAll('#root [aria-label^="Ir al paso"]'),
  ]
  const stepAt = () =>
    dots().findIndex((d) => d.getAttribute("aria-current") === "true")
  const tapEl = () =>
    doc.querySelector('#root div[class*="select-none"]') ||
    doc.querySelector('#root div[class*="flex-col flex-1"]')
  const tap = () => {
    const el = tapEl()
    if (!el) throw new Error("sin zona de toque")
    click(el)
  }

  // Un gesto de verdad: toque, los movimientos del dedo y el cierre, que puede ser touchend o, cuando
  // el navegador se queda con el gesto y corta la secuencia, touchcancel. `pointer` es el mouse.
  const fire = (el, kind, x, y) => {
    if (kind.startsWith("pointer")) {
      el.dispatchEvent(
        new window.MouseEvent(kind, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      )
      return
    }
    const e = new window.Event(kind, { bubbles: true, cancelable: true })
    const punto = { clientX: x, clientY: y }
    if (kind === "touchend" || kind === "touchcancel") {
      e.touches = []
      e.changedTouches = [punto]
    } else {
      e.touches = [punto]
      e.changedTouches = [punto]
    }
    el.dispatchEvent(e)
  }
  const swipe = async (dx, dy = 0, modo = "touch") => {
    const el = tapEl()
    if (!el) throw new Error("sin zona de deslizar")
    if (modo === "pointer") {
      fire(el, "pointerdown", 260, 200)
      fire(el, "pointerup", 260 + dx, 200 + dy)
    } else {
      fire(el, "touchstart", 300, 200)
      fire(el, "touchmove", 300 + dx / 2, 200 + dy / 2)
      fire(el, "touchmove", 300 + dx, 200 + dy)
      fire(
        el,
        modo === "touchcancel" ? "touchcancel" : "touchend",
        300 + dx,
        200 + dy,
      )
    }
    await wait(60)
    return el
  }
  // Deslizar empezando sobre un elemento concreto (un campo, un botón): ahí el gesto no navega.
  const swipeFrom = (target, dx, dy = 0) => {
    fire(target, "pointerdown", 260, 200)
    fire(target, "pointerup", 260 + dx, 200 + dy)
  }
  const crearNuevo = async () => {
    press(doc.querySelector('[aria-label="Nuevo recordatorio"]'))
    await wait(80)
  }
  const irAjustes = async () => {
    clickText("button", "Ajustes")
    await wait(80)
  }
  const nombreInput = () =>
    doc.querySelector('input[placeholder="Ej. Renovar licencia de conducir"]')
  const download = async (i = 0) =>
    downloads[i] ? await downloads[i].text() : ""
  const rowOf = (name) =>
    [...doc.querySelectorAll("#root div")]
      .filter(
        (d) =>
          d.querySelector('[aria-label*="WhatsApp"]') &&
          d.querySelector("button") &&
          (d.textContent || "").includes(name),
      )
      .pop()
  const deleteBtn = (name) => {
    const row = rowOf(name)
    return (
      row &&
      [...row.querySelectorAll("button")].find((b) =>
        (b.textContent || "").includes("Eliminar"),
      )
    )
  }

  return {
    window,
    doc,
    root,
    txt,
    html,
    click,
    press,
    pressText,
    clickText,
    find,
    type,
    pick,
    input,
    storage,
    raw,
    events,
    notifications,
    notifOf,
    profileOf,
    byLabel,
    badge,
    cardOf,
    dots,
    stepAt,
    tapEl,
    tap,
    swipe,
    swipeFrom,
    crearNuevo,
    irAjustes,
    ajustes: irAjustes,
    nombreInput,
    download,
    downloads,
    downloadNames,
    opened,
    shared,
    rowOf,
    deleteBtn,
    sent,
    asks: () => state.asks,
    setPermission: (p) => {
      state.permission = p
    },
    errors,
  }
}

// Reporter: junta las comprobaciones y las imprime como siempre (OK/FALLA y el resumen del final).
export function reporter() {
  const res = []
  const check = (label, ok, extra = "") => res.push([label, !!ok, extra])
  const finish = () => {
    const failed = res.filter((r) => !r[1])
    for (const [label, ok, extra] of res)
      console.log(
        `${ok ? "OK   " : "FALLA"} ${label}${
          !ok && extra ? " -> " + extra : ""
        }`,
      )
    console.log(
      `\n${res.length - failed.length}/${res.length} comprobaciones OK`,
    )
    return failed.length
  }
  return { res, check, finish }
}
