// Edge Function de AVISPATE · Etapa 10: entrega los avisos que ya vencieron.
//
// La llama el cron de la base cada minuto (ver supabase/migrations/0001_etapa10.sql). No calcula
// fechas: la cola ya viene con la hora exacta de cada aviso, calculada en el teléfono. Solo mira qué
// toca, manda el push y anota el resultado. Es idempotente: un aviso enviado no vuelve a salir, y si
// la suscripción está muerta (el navegador la revocó) se borra el dispositivo con sus avisos.
import { createClient } from "jsr:@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

const cabeceras = { "Content-Type": "application/json" }
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras })

// Cuántos avisos por pasada: con uno por minuto sobra, y mantiene la función corta y barata.
const LOTE = 50
const MAX_INTENTOS = 5

type Fila = {
  dispositivo_id: string
  id: string
  titulo: string
  cuerpo: string
  emoji: string | null
  intentos: number
  dispositivos:
    | { endpoint: string | null; p256dh: string | null; auth: string | null }
    | null
}

Deno.serve(async (peticion) => {
  if (peticion.method === "OPTIONS") return new Response("ok", { headers: cabeceras })

  const url = Deno.env.get("SUPABASE_URL")
  const servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const publica = Deno.env.get("VAPID_PUBLIC_KEY")
  const privada = Deno.env.get("VAPID_PRIVATE_KEY")
  const contacto = Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@avispate.app"

  if (!url || !servicio) return responder({ ok: false, error: "Falta la configuración de Supabase." }, 500)
  if (!publica || !privada)
    return responder(
      { ok: false, error: "Faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en los secretos." },
      500,
    )
  webpush.setVapidDetails(contacto, publica, privada)

  const base = createClient(url, servicio, { auth: { persistSession: false } })

  // Pendientes y ya vencidos, con la suscripción de su dispositivo. `!inner` descarta los que no
  // tienen a quién llegar.
  const { data, error } = await base
    .from("avisos")
    .select("dispositivo_id, id, titulo, cuerpo, emoji, intentos, dispositivos!inner(endpoint, p256dh, auth)")
    .lte("cuando", new Date().toISOString())
    .is("enviado_en", null)
    .lt("intentos", MAX_INTENTOS)
    .not("dispositivos.endpoint", "is", null)
    .order("cuando", { ascending: true })
    .limit(LOTE)

  if (error) return responder({ ok: false, error: error.message }, 500)

  let enviados = 0
  let borrados = 0
  let fallidos = 0
  const ahora = new Date().toISOString()

  for (const fila of (data ?? []) as unknown as Fila[]) {
    const dispositivo = fila.dispositivos
    if (!dispositivo?.endpoint || !dispositivo.p256dh || !dispositivo.auth) continue

    try {
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
        }),
        // 12 h de vigencia y urgencia alta: es un recordatorio, no un boletín. Si el teléfono estuvo
        // apagado dos días, el aviso viejo ya no sirve.
        { TTL: 12 * 60 * 60, urgency: "high" },
      )
      await base
        .from("avisos")
        .update({ enviado_en: ahora, ultimo_error: null })
        .eq("dispositivo_id", fila.dispositivo_id)
        .eq("id", fila.id)
      enviados += 1
    } catch (fallo) {
      const estado = (fallo as { statusCode?: number }).statusCode ?? 0
      // 404/410: el navegador dio de baja la suscripción (app desinstalada, permiso revocado). El
      // dispositivo se borra con sus avisos en cascada y la app lo vuelve a registrar al reactivar.
      if (estado === 404 || estado === 410) {
        await base.from("dispositivos").delete().eq("id", fila.dispositivo_id)
        borrados += 1
        continue
      }
      fallidos += 1
      await base
        .from("avisos")
        .update({
          intentos: fila.intentos + 1,
          ultimo_error: String(fallo).slice(0, 300),
        })
        .eq("dispositivo_id", fila.dispositivo_id)
        .eq("id", fila.id)
    }
  }

  return responder({ ok: true, enviados, fallidos, borrados })
})
