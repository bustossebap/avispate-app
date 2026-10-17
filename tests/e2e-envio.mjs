// E2E de la Etapa 14: entrega real por WhatsApp y correo.
//
// Lo que se puede probar sin las cuentas de Meta y Resend: que la cola separe cada aviso por canal
// (con destino, usuario y zona), que no mande WhatsApp a quien no marcó el ticket, que Ajustes
// traduzca la configuración de la nube y el historial a estados legibles y que los botones de prueba
// pidan lo que corresponde. La batería también mira la migración, las dos Edge Functions y la guía.
import fs from "node:fs"
import path from "node:path"
import { BASE, cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const { check, finish } = reporter()

const pad = (n) => String(n).padStart(2, "0")
const dia = (n) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const manana = dia(6)

const YO = {
  id: "yo",
  name: "Yo",
  emoji: "🐝",
  contact: {
    phone: "+56 9 1111 2222",
    email: "Yo@Ejemplo.com",
    accepted: true,
  },
  channels: { push: true, whatsapp: true, email: true },
}
// Empresa dejó sus datos pero no marcó el ticket: WhatsApp y correo quedan en pausa.
const EMPRESA = {
  id: "empresa",
  name: "Empresa",
  emoji: "🧑",
  contact: {
    phone: "+56 9 3333 4444",
    email: "empresa@ejemplo.com",
    accepted: false,
  },
  channels: { push: true, whatsapp: true, email: true },
}
// Abuela no dejó ningún dato: su recordatorio cae en la notificación del navegador.
const ABUELA = { id: "abuela", name: "Abuela", emoji: "👵" }

const recordatorio = (id, ownerId, name, channels) => ({
  id,
  ownerId,
  name,
  date: manana,
  time: "12:00",
  category: "Cuentas",
  categoryEmoji: "💡",
  recurrence: "No se repite",
  remindersBefore: [1],
  channels,
})

const recordatorios = [
  recordatorio("e-todo", "yo", "Pagar el arriendo", [
    "Notificación",
    "WhatsApp",
    "Correo",
  ]),
  recordatorio("e-empresa", "empresa", "Renovar el contrato", ["WhatsApp"]),
  recordatorio("e-abuela", "abuela", "Llamar a la abuela", ["WhatsApp"]),
]

const semilla = (extra = {}) => ({
  "avispate.onboarding.v1": "1",
  "avispate.events.v1": JSON.stringify(recordatorios),
  "avispate.profiles.v1": JSON.stringify([YO, EMPRESA, ABUELA]),
  "avispate.activeProfile.v1": "yo",
  "avispate.push.v1": "1",
  // Ya registrado en la nube: la tarjeta pide el resumen y el historial sin esperar a que se active
  // el push (en jsdom no hay notificaciones).
  "avispate.nube.v1": "1",
  "avispate.dispositivo.v1": JSON.stringify({
    id: "11111111-1111-4111-8111-111111111111",
    token: "token-de-prueba",
  }),
  ...extra,
})

// La nube de mentira: anota cada llamada y responde como respondería Supabase. Los dos estados del
// historial son los que la tarjeta tiene que traducir (entregado y fallido con su motivo).
const llamadas = []
const nube = async (url, opciones = {}) => {
  const u = String(url)
  const metodo = opciones.method || "GET"
  let cuerpo = null
  try {
    cuerpo = opciones.body ? JSON.parse(String(opciones.body)) : null
  } catch {}
  llamadas.push({ url: u, metodo, cuerpo })
  const json = (valor) => ({
    ok: true,
    status: 200,
    json: async () => valor,
    text: async () => JSON.stringify(valor),
  })
  if (u.includes("/functions/v1/enviar-avisos"))
    return json({
      ok: true,
      canales: {
        push: true,
        whatsapp: true,
        email: false,
        plantilla: "avispate_recordatorio",
      },
    })
  if (u.endsWith("/rpc/resumen_cola"))
    return json({
      programados: 5,
      pendientes: 5,
      enviados: 0,
      conError: 0,
      proximo: new Date(Date.now() + 86400e3).toISOString(),
      ultimoEnviado: null,
    })
  if (u.endsWith("/rpc/ultimos_envios"))
    return json([
      {
        id: "e-todo:2026-10-22T12:00:whatsapp",
        canal: "whatsapp",
        titulo: "💡 Pagar el arriendo",
        cuando: new Date(Date.now() - 600e3).toISOString(),
        estado: "entregado",
        enviadoEn: new Date(Date.now() - 700e3).toISOString(),
        entregadoEn: new Date(Date.now() - 600e3).toISOString(),
        error: null,
      },
      {
        id: "e-todo:2026-10-22T12:00:email",
        canal: "email",
        titulo: "💡 Pagar el arriendo",
        cuando: new Date(Date.now() - 1200e3).toISOString(),
        estado: "fallido",
        enviadoEn: null,
        entregadoEn: null,
        error: "El buzón no existe.",
      },
    ])
  if (u.endsWith("/rpc/probar_canal")) return json(null)
  return json(5)
}

const m = montar(bundle, semilla(), { fetch: nube })
await wait(1900)
const cola = m.storage("avispate.cola.v1") || []
const de = (id) => cola.filter((a) => a.recordatorioId === id)
const canalesDe = (id) =>
  de(id)
    .map((a) => a.canal)
    .sort()

// ------------------------------------------- A) La cola separa cada canal
check(
  "A · el mismo recordatorio con tres canales deja tres filas",
  de("e-todo").length === 3,
  JSON.stringify(canalesDe("e-todo")),
)
check(
  "A · y son push, WhatsApp y correo, sin repetir",
  JSON.stringify(canalesDe("e-todo")) ===
    JSON.stringify(["email", "push", "whatsapp"]),
  JSON.stringify(canalesDe("e-todo")),
)
check(
  "A · WhatsApp lleva el número en dígitos y correo lleva el correo en minúsculas",
  de("e-todo").find((a) => a.canal === "whatsapp")?.destino === "56911112222" &&
    de("e-todo").find((a) => a.canal === "email")?.destino === "yo@ejemplo.com",
  JSON.stringify(de("e-todo").map((a) => [a.canal, a.destino])),
)
check(
  "A · el push no lleva destino y todas las filas traen perfil y zona",
  de("e-todo").find((a) => a.canal === "push")?.destino === undefined &&
    de("e-todo").every(
      (a) =>
        a.perfilId === "yo" && typeof a.zona === "string" && a.zona.length > 0,
    ),
  JSON.stringify(de("e-todo")[0]),
)
check(
  "A · las tres filas comparten el id estable del aviso",
  new Set(de("e-todo").map((a) => a.id)).size === 1,
  JSON.stringify(de("e-todo").map((a) => a.id)),
)
check(
  "A · sin ticket no hay WhatsApp: el aviso de Empresa cae en la notificación",
  JSON.stringify(canalesDe("e-empresa")) === JSON.stringify(["push"]),
  JSON.stringify(canalesDe("e-empresa")),
)
check(
  "A · sin datos de contacto pasa lo mismo con Abuela",
  JSON.stringify(canalesDe("e-abuela")) === JSON.stringify(["push"]),
  JSON.stringify(canalesDe("e-abuela")),
)
check(
  "A · la cola entera son cinco filas (tres de Yo y una por cada uno de los otros)",
  cola.length === 5,
  String(cola.length),
)

// ------------------------------------------- B) Lo que sube a la nube
const subida = llamadas.find((l) => l.url.endsWith("/rpc/sincronizar_avisos"))
check(
  "B · la app sube la cola al abrir (ya había dispositivo registrado)",
  !!subida && Array.isArray(subida.cuerpo?.p_avisos),
  JSON.stringify(llamadas.map((l) => l.url.split("/").pop())),
)
const filas = subida?.cuerpo?.p_avisos || []
const filaTodo = filas.filter((a) => String(a.id).startsWith("e-todo"))
check(
  "B · viajan las cinco filas con su canal",
  filas.length === 5 && filaTodo.length === 3,
  `${filas.length} filas · ${filaTodo.length} de e-todo`,
)
check(
  "B · cada fila lleva canal, destino, perfil y zona, no solo el título",
  filaTodo.some(
    (a) =>
      a.canal === "whatsapp" &&
      a.destino === "56911112222" &&
      a.perfilId === "yo" &&
      !!a.zona,
  ) &&
    filaTodo.some(
      (a) =>
        a.canal === "email" &&
        a.destino === "yo@ejemplo.com" &&
        a.perfilId === "yo",
    ),
  JSON.stringify(filaTodo),
)
check(
  "B · el recordatorio de Empresa no sube una fila de WhatsApp",
  filas
    .filter((a) => String(a.id).startsWith("e-empresa"))
    .every((a) => a.canal === "push"),
  JSON.stringify(filas.filter((a) => String(a.id).startsWith("e-empresa"))),
)
check(
  "B · el token y el id del dispositivo viajan en el sobre de la llamada",
  subida?.cuerpo?.p_token === "token-de-prueba" &&
    subida?.cuerpo?.p_dispositivo === "11111111-1111-4111-8111-111111111111",
  JSON.stringify(subida?.cuerpo ? Object.keys(subida.cuerpo) : []),
)

// ------------------------------------------- C) Ajustes › Entrega real
await m.irAjustes()
await wait(400)
const texto = m.txt()
check(
  "C · Ajustes trae la tarjeta «Entrega real»",
  texto.includes("Entrega real"),
  texto.slice(
    texto.indexOf("Entrega real"),
    texto.indexOf("Entrega real") + 160,
  ),
)
check(
  "C · dice qué plantilla de WhatsApp está configurada en la nube",
  texto.includes("Plantilla: avispate_recordatorio."),
)
check(
  "C · WhatsApp está listo (proveedor configurado y datos con ticket)",
  texto.includes("Listo para enviar") &&
    /\+56 9 1111 2222 · Listo para enviar/.test(texto),
  texto.slice(texto.indexOf("WhatsApp"), texto.indexOf("WhatsApp") + 160),
)
check(
  "C · el correo, en cambio, avisa que falta configurarlo en la nube",
  texto.includes("Yo@Ejemplo.com · Falta configurar en la nube"),
  texto.slice(texto.indexOf("Correo"), texto.indexOf("Correo") + 160),
)
check(
  "C · el historial muestra el canal y el estado de cada envío",
  texto.includes("Últimos envíos") &&
    texto.includes("Entregado") &&
    texto.includes("Falló"),
  texto.slice(
    texto.indexOf("Últimos envíos"),
    texto.indexOf("Últimos envíos") + 220,
  ),
)
check(
  "C · y el fallo se explica con el motivo que dio el proveedor",
  texto.includes("El buzón no existe."),
)
check(
  "C · «Probar WhatsApp» está disponible y «Probar Correo» no",
  !!m.byLabel("Probar WhatsApp") &&
    m.byLabel("Probar WhatsApp").disabled === false &&
    !!m.byLabel("Probar Correo") &&
    m.byLabel("Probar Correo").disabled === true,
  JSON.stringify({
    wa: m.byLabel("Probar WhatsApp")?.disabled,
    mail: m.byLabel("Probar Correo")?.disabled,
  }),
)

// ------------------------------------------- D) El botón de prueba
m.press(m.byLabel("Probar WhatsApp"))
await wait(120)
const prueba = [...llamadas]
  .reverse()
  .find((l) => l.url.endsWith("/rpc/probar_canal"))
check(
  "D · tocar «Probar WhatsApp» encola la prueba con el número en dígitos",
  prueba?.cuerpo?.p_canal === "whatsapp" &&
    prueba?.cuerpo?.p_destino === "56911112222",
  JSON.stringify(prueba?.cuerpo),
)
check(
  "D · la prueba lleva el token del dispositivo y la zona del teléfono",
  prueba?.cuerpo?.p_token === "token-de-prueba" &&
    typeof prueba?.cuerpo?.p_zona === "string",
  JSON.stringify(prueba?.cuerpo),
)
check(
  "D · la pantalla confirma que la prueba va a salir en menos de un minuto",
  m.txt().includes("Prueba pedida: revisá WhatsApp en menos de un minuto."),
  m.txt().slice(-180),
)
check(
  "D · sin errores de ejecución en la app con red",
  m.errors.length === 0,
  m.errors.join(" | ").slice(0, 200),
)

// ------------------------------------------- E) Sin red, la tarjeta no rompe nada
const sinRed = montar(bundle, semilla())
await wait(120)
await sinRed.irAjustes()
await wait(200)
check(
  "E · sin red la tarjeta sigue ahí y explica que no pudo consultar la nube",
  sinRed.txt().includes("Entrega real") &&
    sinRed
      .txt()
      .includes("Sin conexión: este navegador no puede llegar a la nube."),
  sinRed.txt().slice(-220),
)
check(
  "E · y los botones de prueba quedan apagados en vez de fallar al tocarlos",
  sinRed.byLabel("Probar WhatsApp")?.disabled === true &&
    sinRed.byLabel("Probar Correo")?.disabled === true,
)
check(
  "E · sin errores de ejecución en la app sin red",
  sinRed.errors.length === 0,
  sinRed.errors.join(" | ").slice(0, 200),
)

// ------------------------------------------- F) Lo que tiene que estar en el repo
const migracion = fs.readFileSync(
  path.join(BASE, "supabase/migrations/0003_etapa14.sql"),
  "utf8",
)
check(
  "F · la migración agrega el canal y la clave por dispositivo + id + canal",
  migracion.includes("add column if not exists canal") &&
    migracion.includes("primary key (dispositivo_id, id, canal)"),
)
check(
  "F · trae destino, proveedor, entrega y el próximo intento; apagar el push no borra WhatsApp ni correo",
  migracion.includes("destino") &&
    migracion.includes("proveedor_id") &&
    migracion.includes("entregado_en") &&
    migracion.includes("proximo_intento") &&
    migracion.includes("and canal = 'push'"),
)
check(
  "F · y las dos funciones nuevas, con sus permisos para la app",
  migracion.includes("probar_canal") &&
    migracion.includes("ultimos_envios") &&
    migracion.includes("grant execute on function public.probar_canal"),
)
check(
  "F · «Posponer» conserva el nombre que llama el service worker y solo mueve el push",
  migracion.includes("function public.posponer_aviso(") &&
    migracion.includes("and a.canal = 'push'") &&
    !migracion.includes("pospuesto_aviso"),
)
check(
  "F · la sincronización no pisa un aviso pospuesto desde la notificación",
  migracion.includes("and public.avisos.pospuesto_en is null"),
)

const funcion = fs.readFileSync(
  path.join(BASE, "supabase/functions/enviar-avisos/index.ts"),
  "utf8",
)
check(
  "F · la entrega habla con la Cloud API de Meta y con Resend",
  funcion.includes("graph.facebook.com") &&
    funcion.includes("api.resend.com") &&
    funcion.includes("WHATSAPP_TOKEN") &&
    funcion.includes("RESEND_API_KEY"),
)
check(
  "F · la plantilla y el remitente salen de secretos, no del bundle",
  funcion.includes("WHATSAPP_TEMPLATE") &&
    funcion.includes("EMAIL_FROM") &&
    funcion.includes("Deno.env.get") &&
    !bundle.includes("RESEND_API_KEY"),
)
check(
  "F · el envío se reclama y se reintenta con espera creciente",
  funcion.includes("RECLAMO_MINUTOS") &&
    funcion.includes("TOPE_DIARIO") &&
    funcion.includes("2 ** intentos"),
)
check(
  "F · el correo manda una clave de idempotencia al proveedor",
  funcion.includes("Idempotency-Key"),
)

const webhook = fs.readFileSync(
  path.join(BASE, "supabase/functions/webhooks-envio/index.ts"),
  "utf8",
)
check(
  "F · el webhook verifica Meta y Resend y actualiza el estado",
  webhook.includes("hub.verify_token") &&
    webhook.includes("x-hub-signature-256") &&
    webhook.includes("svix-signature") &&
    webhook.includes("email.delivered") &&
    webhook.includes('estado: "entregado"'),
)
check(
  "F · el bundle sabe pedir el estado de los canales y el historial",
  bundle.includes("probar_canal") &&
    bundle.includes("ultimos_envios") &&
    bundle.includes("avispate.nube.v1") &&
    bundle.includes("enviar-avisos"),
)
check(
  "F · el pie de Ajustes ya es el de la V2.1",
  texto.includes("AVISPATE · V2.1 · Etapa 15"),
  texto.slice(-60),
)

const readme = fs.readFileSync(path.join(BASE, "README.md"), "utf8")
const guia = fs.readFileSync(path.join(BASE, "supabase/README.md"), "utf8")
check(
  "F · el README cuenta la Etapa 15 y la V2.1",
  readme.includes("# AVISPATE — V2.1 (Etapa 15)"),
)
check(
  "F · la guía explica la migración, los secretos y el webhook",
  guia.includes("0003_etapa14.sql") &&
    guia.includes("WHATSAPP_TOKEN") &&
    guia.includes("RESEND_API_KEY") &&
    guia.includes("webhooks-envio"),
)

process.exit(finish() ? 1 : 0)
