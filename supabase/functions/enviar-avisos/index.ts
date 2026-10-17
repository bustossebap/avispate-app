// Edge Function de AVISPATE · Etapas 10 y 14: entrega los avisos que ya vencieron.
//
// La llama el cron de la base cada minuto (ver supabase/migrations/0001_etapa10.sql). No calcula
// fechas: la cola ya viene con la hora exacta de cada aviso, calculada en el teléfono. Mira qué toca
// y entrega por el canal de la fila:
//
//   push      la notificación del navegador (VAPID, como desde la Etapa 10)
//   whatsapp  la Cloud API de Meta, con una plantilla de utilidad aprobada
//   email     Resend, con el dominio propio de AVISPATE
//
// Cada fila se reclama antes de mandarse (`proximo_intento` pasa a dentro de cinco minutos): si dos
// pasadas del cron se cruzan, la segunda no encuentra nada que reclamar y no hay envíos duplicados.
// Si el proveedor falla, la fila vuelve a la cola con espera creciente (1, 2, 4… minutos, tope 1 h)
// y el motivo queda en `ultimo_error`. A los 5 intentos se marca `fallido` y deja de reintentarse.
//
// Los secretos llegan por variables de entorno de Supabase y nunca salen de acá: el GET de estado
// solo devuelve booleanos y el nombre de la plantilla (ver supabase/README.md).
import { createClient } from "jsr:@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

const cabeceras = { "Content-Type": "application/json" }
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras })

// Cuántos avisos por pasada: con uno por minuto sobra, y mantiene la función corta y barata.
const LOTE = 50
const MAX_INTENTOS = 5
// Tope de WhatsApp + correo por dispositivo en 24 h. Es un seguro contra un bucle (una repetición
// mal escrita, una prueba que se toca muchas veces): no debería alcanzarlo un uso normal.
const TOPE_DIARIO = 60
// Cuánto se reclama una fila mientras se manda. Si la función se cae en el medio, vuelve sola.
const RECLAMO_MINUTOS = 5

type Canal = "push" | "whatsapp" | "email"

type Fila = {
  dispositivo_id: string
  id: string
  canal: Canal
  destino: string | null
  perfil_id: string | null
  zona: string | null
  titulo: string
  cuerpo: string
  emoji: string | null
  cuando: string
  intentos: number
  dispositivos:
    | { endpoint: string | null; p256dh: string | null; auth: string | null }
    | null
}

function configuracion() {
  const publica = Deno.env.get("VAPID_PUBLIC_KEY") || ""
  const privada = Deno.env.get("VAPID_PRIVATE_KEY") || ""
  const whatsappToken = Deno.env.get("WHATSAPP_TOKEN") || ""
  const whatsappPhone = Deno.env.get("WHATSAPP_PHONE_ID") || ""
  const resend = Deno.env.get("RESEND_API_KEY") || ""
  const emailFrom = Deno.env.get("EMAIL_FROM") || ""
  return {
    url: Deno.env.get("SUPABASE_URL") || "",
    servicio: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    publica,
    privada,
    contacto: Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@avispate.app",
    push: !!(publica && privada),
    whatsappToken,
    whatsappPhone,
    whatsappTemplate: Deno.env.get("WHATSAPP_TEMPLATE") || "avispate_recordatorio",
    whatsappLang: Deno.env.get("WHATSAPP_TEMPLATE_LANG") || "es",
    whatsappVersion: Deno.env.get("WHATSAPP_API_VERSION") || "v21.0",
    whatsapp: !!(whatsappToken && whatsappPhone),
    resend,
    emailFrom,
    email: !!(resend && emailFrom),
  }
}

// La fecha en la hora de la persona. `zona` la calculó el teléfono al programar la cola; si viene
// vacía o rota (un navegador viejo), se cae a UTC en vez de romper el envío.
function fechaLegible(iso: string, zona: string | null) {
  try {
    return new Intl.DateTimeFormat("es", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: zona || "UTC",
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString()
  }
}

function escaparHtml(texto: string) {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function mensajeDeError(fallo: unknown) {
  if (fallo instanceof Error) return fallo.message
  try {
    return JSON.stringify(fallo)
  } catch {
    return String(fallo)
  }
}

// El correo: texto plano como respaldo y un HTML mínimo, sin imágenes ni recursos externos. Todo lo
// que viene del recordatorio se escapa; el título ya trae el emoji que eligió la persona.
function armarCorreo(fila: Fila) {
  const titulo = `${fila.emoji || "🔔"} ${fila.titulo}`.trim()
  const fecha = fechaLegible(fila.cuando, fila.zona)
  const texto = `${titulo}\n\n${fila.cuerpo}\n\n${fecha}\n\nAVISPATE · no te olvides de no olvidarte.`
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#fafaf9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#292524">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:20px;padding:24px">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a8a29e">AVISPATE</p>
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escaparHtml(titulo)}</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#57534e">${escaparHtml(fila.cuerpo)}</p>
    <p style="margin:0;font-size:12px;color:#a8a29e">${escaparHtml(fecha)}</p>
    <p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #f5f5f4;font-size:11px;color:#a8a29e">No te olvides de no olvidarte. 🐝</p>
  </div>
</body></html>`
  return { asunto: titulo, texto, html }
}

type Config = ReturnType<typeof configuracion>

// ---------------------------------------------------------------------------------------------
// Los tres adaptadores. Todos devuelven el id que dio el proveedor (o null en el push) y lanzan un
// Error con el motivo cuando no se pudo. La función de arriba no conoce ninguna API: solo llama acá.
// ---------------------------------------------------------------------------------------------
async function enviarPush(fila: Fila, cfg: Config) {
  if (!cfg.push) throw new Error("Faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en los secretos.")
  const dispositivo = fila.dispositivos
  if (!dispositivo?.endpoint || !dispositivo.p256dh || !dispositivo.auth)
    throw new Error("Este dispositivo no tiene una suscripción push activa.")

  await webpush.sendNotification(
    {
      endpoint: dispositivo.endpoint,
      keys: { p256dh: dispositivo.p256dh, auth: dispositivo.auth },
    },
    JSON.stringify({
      titulo: fila.titulo,
      cuerpo: fila.cuerpo,
      tag: fila.id,
      url: "./",
      // El id de la fila: es lo que el service worker manda a `posponer_aviso` cuando alguien toca
      // «Posponer 10 min» o «Posponer 1 hora» sin abrir la app (Etapa 11).
      aviso: fila.id,
    }),
    // 12 h de vigencia y urgencia alta: es un recordatorio, no un boletín. Si el teléfono estuvo
    // apagado dos días, el aviso viejo ya no sirve.
    { TTL: 12 * 60 * 60, urgency: "high" },
  )
  return null
}

async function enviarWhatsApp(fila: Fila, cfg: Config) {
  if (!cfg.whatsapp)
    throw new Error("WhatsApp no está configurado en la nube (faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID).")
  const destino = (fila.destino || "").replace(/\D/g, "")
  if (!destino) throw new Error("El aviso de WhatsApp no tiene un número de destino.")

  // Plantilla de utilidad: tres variables en el cuerpo (recordatorio, mensaje y fecha). La plantilla
  // se aprueba en Meta Business y se nombra con WHATSAPP_TEMPLATE; el idioma, con
  // WHATSAPP_TEMPLATE_LANG. Fuera de la ventana de 24 h, Meta solo permite plantillas aprobadas.
  const respuesta = await fetch(
    `https://graph.facebook.com/${cfg.whatsappVersion}/${cfg.whatsappPhone}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.whatsappToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: destino,
        type: "template",
        template: {
          name: cfg.whatsappTemplate,
          language: { code: cfg.whatsappLang },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: fila.titulo },
                { type: "text", text: fila.cuerpo },
                { type: "text", text: fechaLegible(fila.cuando, fila.zona) },
              ],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(15000),
    },
  )

  const datos = await respuesta.json().catch(() => null)
  if (!respuesta.ok) {
    const detalle = (datos as { error?: { message?: string } } | null)?.error?.message
    throw new Error(detalle || `WhatsApp respondió ${respuesta.status}.`)
  }
  const id = (datos as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id
  return id || null
}

async function enviarCorreo(fila: Fila, cfg: Config) {
  if (!cfg.email)
    throw new Error("El correo no está configurado en la nube (faltan RESEND_API_KEY o EMAIL_FROM).")
  const destino = (fila.destino || "").trim()
  if (!destino.includes("@")) throw new Error("El aviso de correo no tiene un destino válido.")

  const correo = armarCorreo(fila)
  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.resend}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: cfg.emailFrom,
      to: [destino],
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
      // La clave de idempotencia de Resend: si el cron repite la llamada por un corte de red, el
      // proveedor devuelve el mismo correo en vez de mandar dos.
      headers: { "Idempotency-Key": `avispate-${fila.dispositivo_id}-${fila.id}-${fila.canal}` },
    }),
    signal: AbortSignal.timeout(15000),
  })

  const datos = await respuesta.json().catch(() => null)
  if (!respuesta.ok) {
    const detalle = (datos as { message?: string } | null)?.message
    throw new Error(detalle || `El correo respondió ${respuesta.status}.`)
  }
  return (datos as { id?: string } | null)?.id || null
}

function enviarPorCanal(fila: Fila, cfg: Config) {
  if (fila.canal === "push") return enviarPush(fila, cfg)
  if (fila.canal === "whatsapp") return enviarWhatsApp(fila, cfg)
  return enviarCorreo(fila, cfg)
}


Deno.serve(async (peticion) => {
  if (peticion.method === "OPTIONS") return new Response("ok", { headers: cabeceras })

  const cfg = configuracion()

  // El teléfono pregunta qué canales están configurados para poder decirlo en Ajustes. Solo viajan
  // booleanos y el nombre de la plantilla: ningún token, ninguna clave.
  if (peticion.method === "GET") {
    return responder({
      ok: true,
      canales: {
        push: cfg.push,
        whatsapp: cfg.whatsapp,
        email: cfg.email,
        plantilla: cfg.whatsapp ? cfg.whatsappTemplate : null,
      },
    })
  }

  if (!cfg.url || !cfg.servicio)
    return responder({ ok: false, error: "Falta la configuración de Supabase." }, 500)

  if (cfg.push) webpush.setVapidDetails(cfg.contacto, cfg.publica, cfg.privada)

  const base = createClient(cfg.url, cfg.servicio, { auth: { persistSession: false } })
  const ahora = new Date()
  const ahoraIso = ahora.toISOString()

  // Pendientes y ya vencidos, de cualquier canal. La suscripción del dispositivo viene con un left
  // join: los envíos por WhatsApp o correo no dependen de que este teléfono tenga push.
  const { data, error } = await base
    .from("avisos")
    .select(
      "dispositivo_id, id, canal, destino, perfil_id, zona, titulo, cuerpo, emoji, cuando, intentos, dispositivos(endpoint, p256dh, auth)",
    )
    .lte("cuando", ahoraIso)
    .is("enviado_en", null)
    .lt("intentos", MAX_INTENTOS)
    .neq("estado", "fallido")
    .in("canal", ["push", "whatsapp", "email"])
    .lte("proximo_intento", ahoraIso)
    .order("cuando", { ascending: true })
    .limit(LOTE)

  if (error) return responder({ ok: false, error: error.message }, 500)

  let enviados = 0
  let fallidos = 0
  let omitidos = 0
  let borrados = 0
  const porCanal: Record<Canal, number> = { push: 0, whatsapp: 0, email: 0 }
  // Cuántos WhatsApp/correo salieron por dispositivo en las últimas 24 h. Se consulta una sola vez
  // por dispositivo y por pasada y se va incrementando con cada envío bueno.
  const cupo = new Map<string, number>()
  async function enviadosHoy(dispositivo: string) {
    if (cupo.has(dispositivo)) return cupo.get(dispositivo) ?? 0
    const desde = new Date(Date.now() - 24 * 3600e3).toISOString()
    const { count } = await base
      .from("avisos")
      .select("id", { count: "exact", head: true })
      .eq("dispositivo_id", dispositivo)
      .in("canal", ["whatsapp", "email"])
      .gte("enviado_en", desde)
    cupo.set(dispositivo, count ?? 0)
    return count ?? 0
  }


  for (const fila of (data ?? []) as unknown as Fila[]) {
    const donde = { dispositivo_id: fila.dispositivo_id, id: fila.id, canal: fila.canal }

    // Un push sin suscripción (el navegador la revocó) no tiene a dónde ir: se cierra para que no
    // vuelva en cada pasada. La persona lo reactiva desde Ajustes y la próxima sincronización lo
    // repone con la suscripción nueva.
    if (fila.canal === "push") {
      const d = fila.dispositivos
      if (!d?.endpoint || !d.p256dh || !d.auth) {
        await base
          .from("avisos")
          .update({
            estado: "fallido",
            ultimo_error: "Este dispositivo ya no tiene una suscripción push activa.",
          })
          .match(donde)
        omitidos += 1
        continue
      }
    } else if (!fila.destino) {
      await base
        .from("avisos")
        .update({ estado: "fallido", ultimo_error: "El aviso no tiene un destino." })
        .match(donde)
      omitidos += 1
      continue
    }

    if (fila.canal !== "push" && (await enviadosHoy(fila.dispositivo_id)) >= TOPE_DIARIO) {
      await base
        .from("avisos")
        .update({
          ultimo_error: "Tope diario alcanzado: se reintenta más tarde.",
          proximo_intento: new Date(Date.now() + 12 * 3600e3).toISOString(),
        })
        .match(donde)
      omitidos += 1
      continue
    }

    // El reclamo: solo la pasada que logra mover `proximo_intento` desde el pasado manda el aviso.
    // Si otra pasada del cron ya lo hizo, esta no encuentra la fila y sigue de largo.
    const reclamo = await base
      .from("avisos")
      .update({
        proximo_intento: new Date(Date.now() + RECLAMO_MINUTOS * 60000).toISOString(),
      })
      .match(donde)
      .is("enviado_en", null)
      .lte("proximo_intento", ahoraIso)
      .select("id")
    if (reclamo.error || !reclamo.data?.length) {
      omitidos += 1
      continue
    }

    try {
      const proveedorId = await enviarPorCanal(fila, cfg)
      const entregado = new Date().toISOString()
      await base
        .from("avisos")
        .update({
          enviado_en: entregado,
          estado: fila.canal === "push" ? "entregado" : "enviado",
          // El push no tiene webhook: si el servicio lo aceptó, ya está entregado. WhatsApp y correo
          // esperan el aviso del proveedor para pasar a «entregado».
          ...(fila.canal === "push" ? { entregado_en: entregado } : {}),
          ...(proveedorId ? { proveedor_id: proveedorId } : {}),
          ultimo_error: null,
        })
        .match(donde)
      enviados += 1
      porCanal[fila.canal] += 1
      if (fila.canal !== "push")
        cupo.set(fila.dispositivo_id, (cupo.get(fila.dispositivo_id) ?? 0) + 1)
    } catch (fallo) {
      const estado = (fallo as { statusCode?: number }).statusCode ?? 0
      // 404/410 del push: el navegador dio de baja la suscripción (app desinstalada, permiso
      // revocado). El dispositivo se borra con sus avisos en cascada y la app lo vuelve a registrar
      // al reactivar.
      if (fila.canal === "push" && (estado === 404 || estado === 410)) {
        await base.from("dispositivos").delete().eq("id", fila.dispositivo_id)
        borrados += 1
        continue
      }
      const intentos = fila.intentos + 1
      const esperaMin = Math.min(2 ** intentos, 60)
      await base
        .from("avisos")
        .update({
          intentos,
          estado: intentos >= MAX_INTENTOS ? "fallido" : "en_cola",
          ultimo_error: mensajeDeError(fallo).slice(0, 300),
          proximo_intento: new Date(Date.now() + esperaMin * 60000).toISOString(),
        })
        .match(donde)
      fallidos += 1
    }
  }

  return responder({ ok: true, enviados, fallidos, omitidos, borrados, porCanal })
})

