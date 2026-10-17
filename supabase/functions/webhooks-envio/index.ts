// Edge Function de AVISPATE · Etapa 14: recibe los estados de los proveedores.
//
// Meta avisa por webhook cuando un WhatsApp se entrega, se lee o falla; Resend hace lo mismo con los
// correos (entregado, rebotado, queja). Acá se busca la fila por `proveedor_id` —el id que devolvió
// el proveedor al aceptar el envío— y se actualiza el estado que muestra Ajustes.
//
// La URL se configura en cada proveedor (ver supabase/README.md). Hay dos formas de autenticar:
//
//   1. Firma del proveedor: HMAC con WHATSAPP_APP_SECRET (Meta) o RESEND_WEBHOOK_SECRET (Svix).
//      Es la recomendada y no necesita nada en la URL.
//   2. Secreto compartido: `?secreto=...` que coincida con WEBHOOK_TOKEN. Es el respaldo simple,
//      útil para probar a mano; conviene no usarlo en producción si la firma está disponible.
//
// Los estados nunca hacen retroceder una fila: un «entregado» no vuelve a «enviado».
import { createClient } from "jsr:@supabase/supabase-js@2"

const cabeceras = { "Content-Type": "application/json" }
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras })

type Aviso = { puede: boolean; motivo?: string }

const codificar = (texto: string) => new TextEncoder().encode(texto)

function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

function iguales(a: string, b: string) {
  if (a.length !== b.length) return false
  let diferencia = 0
  for (let i = 0; i < a.length; i += 1)
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferencia === 0
}

async function hmac(clave: ArrayBuffer | Uint8Array, datos: string) {
  const llave = await crypto.subtle.importKey(
    "raw",
    clave,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return crypto.subtle.sign("HMAC", llave, codificar(datos))
}

// Meta firma el cuerpo crudo con el App Secret y lo manda en hexadecimal.
async function firmaMetaValida(cuerpo: string, cabecera: string | null, secreto: string) {
  if (!secreto || !cabecera?.startsWith("sha256=")) return false
  const firma = new Uint8Array(await hmac(codificar(secreto), cuerpo))
  const hex = [...firma].map((b) => b.toString(16).padStart(2, "0")).join("")
  return iguales(hex, cabecera.slice(7))
}

// Resend usa Svix: `id.timestamp.cuerpo`, firmado con la clave que empieza con `whsec_` (base64).
async function firmaResendValida(
  cuerpo: string,
  id: string | null,
  marca: string | null,
  cabecera: string | null,
  secreto: string,
) {
  if (!secreto || !id || !marca || !cabecera) return false
  // Cinco minutos de tolerancia: alcanza para un reloj desfasado y corta un replay viejo.
  const edad = Math.abs(Date.now() / 1000 - Number(marca))
  if (!Number.isFinite(edad) || edad > 300) return false
  const clave = Uint8Array.from(atob(secreto.replace(/^whsec_/, "")), (c) =>
    c.charCodeAt(0),
  )
  const firma = base64(await hmac(clave, `${id}.${marca}.${cuerpo}`))
  return cabecera
    .split(" ")
    .map((parte) => parte.split(",")[1])
    .filter(Boolean)
    .some((parte) => iguales(parte, firma))
}

async function autorizado(
  peticion: Request,
  url: URL,
  cuerpo: string,
  tipo: "whatsapp" | "resend",
): Promise<Aviso> {
  const compartido = Deno.env.get("WEBHOOK_TOKEN") || ""
  const query = url.searchParams.get("secreto") || ""
  if (compartido && query && iguales(query, compartido)) return { puede: true }

  if (tipo === "whatsapp") {
    const secreto = Deno.env.get("WHATSAPP_APP_SECRET") || ""
    const firma = peticion.headers.get("x-hub-signature-256")
    if (await firmaMetaValida(cuerpo, firma, secreto)) return { puede: true }
    return {
      puede: false,
      motivo: secreto
        ? "La firma de Meta no coincide."
        : "Falta WHATSAPP_APP_SECRET o el secreto compartido.",
    }
  }

  const secreto = Deno.env.get("RESEND_WEBHOOK_SECRET") || ""
  const firma = await firmaResendValida(
    cuerpo,
    peticion.headers.get("svix-id"),
    peticion.headers.get("svix-timestamp"),
    peticion.headers.get("svix-signature"),
    secreto,
  )
  if (firma) return { puede: true }
  return {
    puede: false,
    motivo: secreto
      ? "La firma de Resend no coincide."
      : "Falta RESEND_WEBHOOK_SECRET o el secreto compartido.",
  }
}

type EstadoProveedor = "sent" | "delivered" | "read" | "failed" | string

async function procesar(
  supabaseUrl: string,
  servicio: string,
  tipo: "whatsapp" | "resend",
  datos: Record<string, unknown>,
) {
  const base = createClient(supabaseUrl, servicio, { auth: { persistSession: false } })
  let actualizados = 0
  const ahora = new Date().toISOString()

  if (tipo === "whatsapp") {
    const entradas = (datos.entry ?? []) as Array<Record<string, unknown>>
    for (const entrada of entradas) {
      const cambios = (entrada.changes ?? []) as Array<Record<string, unknown>>
      for (const cambio of cambios) {
        const valor = (cambio.value ?? {}) as Record<string, unknown>
        const estados = (valor.statuses ?? []) as Array<Record<string, unknown>>
        for (const estado of estados) {
          const id = String(estado.id || "")
          const nombre = String(estado.status || "") as EstadoProveedor
          if (!id || !nombre) continue
          if (nombre === "delivered" || nombre === "read") {
            const { error } = await base
              .from("avisos")
              .update({ estado: "entregado", entregado_en: ahora, ultimo_error: null })
              .eq("proveedor_id", id)
              .eq("canal", "whatsapp")
            if (!error) actualizados += 1
          } else if (nombre === "failed") {
            const errores = (estado.errors ?? []) as Array<Record<string, unknown>>
            const detalle =
              String(errores[0]?.title || errores[0]?.message || "") ||
              "Meta no pudo entregar el mensaje."
            const { error } = await base
              .from("avisos")
              .update({ estado: "fallido", ultimo_error: detalle.slice(0, 300) })
              .eq("proveedor_id", id)
              .eq("canal", "whatsapp")
            if (!error) actualizados += 1
          } else if (nombre === "sent") {
            // Solo asciende desde «en cola»: un «sent» atrasado no pisa un «entregado».
            const { error } = await base
              .from("avisos")
              .update({ estado: "enviado" })
              .eq("proveedor_id", id)
              .eq("canal", "whatsapp")
              .eq("estado", "en_cola")
            if (!error) actualizados += 1
          }
        }
      }
    }
    return { ok: true, proveedor: "whatsapp", actualizados }
  }

  const evento = String(datos.type || "")
  const data = (datos.data ?? {}) as Record<string, unknown>
  const id = String(data.email_id || "")
  if (!id) return { ok: true, proveedor: "resend", actualizados: 0 }

  if (evento === "email.delivered") {
    const { error } = await base
      .from("avisos")
      .update({ estado: "entregado", entregado_en: ahora, ultimo_error: null })
      .eq("proveedor_id", id)
      .eq("canal", "email")
    if (!error) actualizados += 1
  } else if (evento === "email.sent") {
    const { error } = await base
      .from("avisos")
      .update({ estado: "enviado" })
      .eq("proveedor_id", id)
      .eq("canal", "email")
      .eq("estado", "en_cola")
    if (!error) actualizados += 1
  } else if (
    evento === "email.bounced" ||
    evento === "email.complained" ||
    evento === "email.failed"
  ) {
    const rebote = (data.bounce ?? {}) as Record<string, unknown>
    const detalle =
      String(rebote.message || "") ||
      (evento === "email.complained"
        ? "El destinatario marcó el correo como spam."
        : "El proveedor no pudo entregar el correo.")
    const { error } = await base
      .from("avisos")
      .update({ estado: "fallido", ultimo_error: detalle.slice(0, 300) })
      .eq("proveedor_id", id)
      .eq("canal", "email")
    if (!error) actualizados += 1
  }

  return { ok: true, proveedor: "resend", actualizados, evento }
}

Deno.serve(async (peticion) => {
  if (peticion.method === "OPTIONS") return new Response("ok", { headers: cabeceras })
  const url = new URL(peticion.url)

  // Verificación de Meta: la consola manda hub.mode=subscribe y hub.verify_token antes de aceptar
  // la URL. Se responde el challenge tal cual, sin JSON.
  if (peticion.method === "GET") {
    const modo = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const esperado = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || ""
    if (modo === "subscribe" && esperado && token === esperado)
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 })
    return responder({ ok: false, error: "Verificación de webhook inválida." }, 403)
  }

  if (peticion.method !== "POST")
    return responder({ ok: false, error: "Método no permitido." }, 405)

  const servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const supabase = Deno.env.get("SUPABASE_URL")
  if (!servicio || !supabase)
    return responder({ ok: false, error: "Falta la configuración de Supabase." }, 500)

  const cuerpo = await peticion.text()
  let datos: Record<string, unknown>
  try {
    datos = JSON.parse(cuerpo)
  } catch {
    return responder({ ok: false, error: "El cuerpo no es JSON." }, 400)
  }

  const tipo =
    datos.object === "whatsapp_business_account"
      ? "whatsapp"
      : typeof datos.type === "string" && datos.type.startsWith("email.")
        ? "resend"
        : ""
  if (!tipo) return responder({ ok: false, error: "Proveedor desconocido." }, 400)

  const permiso = await autorizado(peticion, url, cuerpo, tipo)
  if (!permiso.puede) return responder({ ok: false, error: permiso.motivo }, 401)

  return procesar(supabase, servicio, tipo, datos)
})

