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

// Etapa 11: la URL y la clave pública de la nube las inyecta el build (vite.config.ts). Son las mismas
// que ya viajan en el armado —la `anon` es pública por diseño— y sirven solo para llamar a las funciones
// que validan el token del dispositivo. Sin ellas, «Posponer» no tiene con quién hablar y abre la app.
const NUBE = "__NUBE_URL__"
const CLAVE_NUBE = "__NUBE_CLAVE__"
// Los minutos que ofrece cada acción de la notificación. La clave es el `action` que llega al tocarla.
const POSPONER = { "posponer-10": 10, "posponer-60": 60 }

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
//
// Por el mismo canal llegan las credenciales del dispositivo (Etapa 11): la página no puede escribir en
// el IndexedDB del service worker, así que se las manda y acá se guardan para poder posponer un aviso
// con la app cerrada.
self.addEventListener("message", (evento) => {
  const datos = evento.data || {}
  if (datos.tipo === "ACTIVAR") self.skipWaiting()
  if (datos.tipo === "CREDENCIALES" && datos.dispositivo && datos.token) {
    evento.waitUntil(
      guardarClaves({ dispositivo: datos.dispositivo, token: datos.token }),
    )
  }
})

// ------------------------------------------- IndexedDB de las credenciales
const BD = "avispate"
const DEPOSITO = "claves"

function abrirBD() {
  return new Promise((ok, mal) => {
    if (!self.indexedDB) return mal(new Error("sin indexedDB"))
    const pedido = indexedDB.open(BD, 1)
    pedido.onupgradeneeded = () => {
      const bd = pedido.result
      if (!bd.objectStoreNames.contains(DEPOSITO)) bd.createObjectStore(DEPOSITO)
    }
    pedido.onsuccess = () => ok(pedido.result)
    pedido.onerror = () => mal(pedido.error)
  })
}

async function guardarClaves(claves) {
  try {
    const bd = await abrirBD()
    await new Promise((ok, mal) => {
      const tx = bd.transaction(DEPOSITO, "readwrite")
      tx.objectStore(DEPOSITO).put(claves, "dispositivo")
      tx.oncomplete = ok
      tx.onerror = () => mal(tx.error)
    })
    bd.close()
  } catch (e) {
    // Sin IndexedDB (navegador viejo o modo privado) el push sigue funcionando: solo no se puede
    // posponer desde la notificación, y en ese caso se abre la app.
  }
}

async function leerClaves() {
  try {
    const bd = await abrirBD()
    const claves = await new Promise((ok, mal) => {
      const tx = bd.transaction(DEPOSITO, "readonly")
      const pedido = tx.objectStore(DEPOSITO).get("dispositivo")
      pedido.onsuccess = () => ok(pedido.result)
      pedido.onerror = () => mal(pedido.error)
    })
    bd.close()
    return claves && claves.dispositivo && claves.token ? claves : null
  } catch (e) {
    return null
  }
}

// Posponer es mover el aviso que ya salió: la función de la base lo deja pendiente otra vez a la hora
// nueva (ver supabase/migrations/0002_etapa11.sql). Devuelve true solo si la nube lo aceptó.
async function posponerAviso(avisoId, minutos) {
  if (!avisoId || !NUBE || !CLAVE_NUBE) return false
  const claves = await leerClaves()
  if (!claves) return false
  try {
    const respuesta = await fetch(`${NUBE}/rest/v1/rpc/posponer_aviso`, {
      method: "POST",
      headers: {
        apikey: CLAVE_NUBE,
        Authorization: `Bearer ${CLAVE_NUBE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_dispositivo: claves.dispositivo,
        p_token: claves.token,
        p_aviso_id: avisoId,
        p_minutos: minutos,
      }),
    })
    return respuesta.ok
  } catch (e) {
    return false
  }
}

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
    // `aviso` es el id de la fila en la nube: con él se puede posponer sin abrir la app. Si el push no lo
    // trae (un envío de prueba desde Supabase, por ejemplo), la notificación sale sin botones.
    data: { url: datos.url || INICIO, aviso: datos.aviso || null },
    tag: datos.tag || undefined,
    renotify: !!datos.tag,
    actions: datos.aviso
      ? [
          { action: "posponer-10", title: "Posponer 10 min" },
          { action: "posponer-60", title: "Posponer 1 hora" },
        ]
      : [],
  }
  evento.waitUntil(self.registration.showNotification(titulo, opciones))
})

async function abrirLaApp(url) {
  // La ruta puede venir relativa ("./"): se resuelve contra la raíz del service worker antes de
  // comparar orígenes, porque `new URL("./")` sin base es un error.
  const destino = new URL(url || "./", RAIZ).href
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
}

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close()
  const datos = evento.notification.data || {}
  const minutos = POSPONER[evento.action || ""]

  // «Posponer» (Etapa 11) no abre la app: mueve el aviso en la nube y deja una confirmación silenciosa.
  // Si no se pudo —sin credenciales guardadas o sin red—, se abre la app, que es el camino de siempre.
  if (minutos) {
    evento.waitUntil(
      (async () => {
        if (await posponerAviso(datos.aviso, minutos)) {
          await self.registration.showNotification("🐝 Pospuesto", {
            body: `Te vuelvo a avisar en ${
              minutos === 60 ? "1 hora" : `${minutos} minutos`
            }.`,
            icon: new URL("icono-192.png", RAIZ).href,
            badge: new URL("icono-192.png", RAIZ).href,
            tag: "avispate-pospuesto",
            silent: true,
          })
          return
        }
        await abrirLaApp(datos.url)
      })(),
    )
    return
  }

  evento.waitUntil(abrirLaApp(datos.url))
})
