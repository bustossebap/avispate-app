// Service worker de AVISPATE (Etapa 10). Se arma en el build: vite.config.ts lee este archivo, le
// inyecta el sello de la entrega y la lista de assets con hash, y lo publica como sw.js. No usa Workbox
// a propósito: son tres tareas —guardar el armado, recibir el push y abrir la app al tocarlo— y una
// dependencia más solo agrega piezas que no se leen.
//
// El sello cambia cuando cambian los assets: cada entrega estrena caché y la anterior se borra, así
// nadie queda con un HTML viejo apuntando a un JS que ya no existe.
const SELLO = "__SELLO__"
const ARCHIVOS = __ARCHIVOS__
const CACHE = "avispate-" + SELLO
const RAIZ = new URL("./", self.registration.scope)
const INICIO = new URL("./", RAIZ).href

// Lo mínimo para abrir la app sin red: el armado de esta entrega y los íconos. Cada archivo va por
// separado y con su try/catch: si uno falla (por ejemplo, el manifest en un servidor que no lo
// sirve), la instalación no se cae entera por eso.
const PRECARGA = ["./", ...ARCHIVOS, "icono-192.png", "icono-512.png", "manifest.webmanifest"]

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(
        PRECARGA.map(async (ruta) => {
          try {
            await cache.add(new URL(ruta, RAIZ))
          } catch (e) {}
        }),
      )
    })(),
  )
})

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(
        nombres.map((nombre) => (nombre !== CACHE ? caches.delete(nombre) : null)),
      )
      await self.clients.claim()
    })(),
  )
})

// La versión nueva no toma el control sola: espera el toque en «Hay una versión nueva». Si tomara el
// control por su cuenta, una recarga en medio de un formulario se llevaría lo escrito.
self.addEventListener("message", (evento) => {
  if (evento.data && evento.data.tipo === "ACTIVAR") self.skipWaiting()
})

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request
  if (pedido.method !== "GET") return
  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.includes("/rest/v1/") || url.pathname.includes("/functions/v1/")) return

  // Navegar: primero la red (para enterarse de una entrega nueva) y, si no hay, lo guardado.
  if (pedido.mode === "navigate") {
    evento.respondWith(
      (async () => {
        try {
          const red = await fetch(pedido)
          if (red.ok) {
            const cache = await caches.open(CACHE)
            cache.put(INICIO, red.clone())
          }
          return red
        } catch (e) {
          const cache = await caches.open(CACHE)
          return (await cache.match(INICIO)) || Response.error()
        }
      })(),
    )
    return
  }

  // Los assets llevan hash en el nombre: si ya están guardados, son los mismos para siempre.
  evento.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const guardado = await cache.match(pedido)
      if (guardado) return guardado
      const red = await fetch(pedido)
      if (red.ok) cache.put(pedido, red.clone())
      return red
    })(),
  )
})

// El servidor manda { titulo, cuerpo } (más `tag` y `url` si hacen falta). Si el mensaje no es JSON se
// usa como cuerpo: así una prueba desde Supabase también se ve bien.
self.addEventListener("push", (evento) => {
  let datos = {}
  try {
    datos = evento.data ? evento.data.json() : {}
  } catch (e) {
    try {
      datos = { cuerpo: evento.data.text() }
    } catch (e2) {
      datos = {}
    }
  }
  const titulo = datos.titulo || "AVISPATE · Recordatorio"
  const opciones = {
    body: datos.cuerpo || "Tenés un recordatorio esperando.",
    icon: new URL("icono-192.png", RAIZ).href,
    badge: new URL("icono-192.png", RAIZ).href,
    data: { url: datos.url || INICIO },
    tag: datos.tag || undefined,
    renotify: !!datos.tag,
  }
  evento.waitUntil(self.registration.showNotification(titulo, opciones))
})

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close()
  // La ruta puede venir relativa ("./"): se resuelve contra la raíz del service worker antes de
  // comparar orígenes, porque `new URL("./")` sin base es un error.
  const destino = new URL(
    (evento.notification.data && evento.notification.data.url) || "./",
    RAIZ,
  ).href
  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      for (const ventana of ventanas) {
        if (new URL(ventana.url).origin !== new URL(destino).origin) continue
        await ventana.focus()
        return
      }
      await self.clients.openWindow(destino)
    })(),
  )
})
