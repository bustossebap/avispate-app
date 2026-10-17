// A quién le llega cada recordatorio (Etapa 14). Antes esta cuenta vivía dentro de App.tsx, porque
// solo servía para el aviso local y el historial; ahora también decide qué filas sube la cola a la
// nube (una por canal), así que se muda acá: una sola versión de «este canal está listo» para la
// pantalla, la cola y las pruebas.
//
// Las reglas no cambian: WhatsApp y correo necesitan el dato del usuario activo y el ticket de
// Contacto; la notificación depende del interruptor del navegador. Si el recordatorio no tiene
// ningún canal listo pero la notificación sí, se usa la notificación como respaldo: es mejor que
// avisar por donde se pueda a no avisar.
export type Contact = { phone: string; email: string; accepted?: boolean }
export type ChannelPrefs = { push: boolean; whatsapp: boolean; email: boolean }
export const DEFAULT_CHANNEL_PREFS: ChannelPrefs = {
  push: true,
  whatsapp: true,
  email: false,
}

// Lo mínimo que necesita esta lógica de un usuario. `Profile` de App.tsx encaja sin conversión.
export type PerfilEntrega = {
  id: string
  contact?: Contact
  channels?: ChannelPrefs
}

// Canales tal como los guarda un recordatorio («Notificación», «WhatsApp», «Correo»).
export type CanalRecordatorio = "Notificación" | "WhatsApp" | "Correo"
// Canales tal como viajan a la nube (en minúsculas y sin tildes).
export type CanalEntrega = "push" | "whatsapp" | "email"

export type DestinoEntrega = {
  canal: CanalEntrega
  // Solo para WhatsApp y correo. El número va en dígitos (código de país incluido); el correo, en
  // minúsculas. Es lo que el proveedor espera, no lo que se muestra en Ajustes.
  destino?: string
}

export function contactConfirmed(profile: PerfilEntrega) {
  return profile.contact?.accepted !== false
}

// El número que se le pasa a la Cloud API: solo dígitos, con el código de país que ya está guardado
// («+56 9 1234 5678» → «56912345678»). Si el dato no tiene dígitos, devuelve vacío y el canal no está
// listo (mejor eso que mandarle un mensaje a cualquier lado).
export function numeroParaEnviar(phone: string) {
  return (phone || "").replace(/\D/g, "")
}

export function channelReady(profile: PerfilEntrega, channel: string) {
  const prefs = profile.channels ?? DEFAULT_CHANNEL_PREFS
  if (channel === "WhatsApp")
    return (
      prefs.whatsapp &&
      !!numeroParaEnviar(profile.contact?.phone || "") &&
      contactConfirmed(profile)
    )
  if (channel === "Correo") {
    const email = (profile.contact?.email || "").trim()
    return prefs.email && !!email && email.includes("@") && contactConfirmed(profile)
  }
  return prefs.push
}

// Canales del recordatorio que su dueño puede recibir de verdad. Si no tiene ninguno listo queda
// la notificación del navegador; si ni eso (apagó las notificaciones), no hay nada que enviar.
export function deliveryChannels(
  event: { channels: string[] },
  owner: PerfilEntrega,
) {
  const ready = (event.channels || []).filter((c) => channelReady(owner, c))
  if (ready.length) return ready
  return channelReady(owner, "Notificación") ? ["Notificación"] : []
}

// La lista que consume la cola: cada canal con su destino. Un recordatorio con los tres canales
// listos produce tres filas con el mismo id y distinto `canal`; la clave de la tabla las distingue.
export function destinosDe(
  event: { channels: string[] },
  owner: PerfilEntrega,
): DestinoEntrega[] {
  const salida: DestinoEntrega[] = []
  // Sin repetidos: la clave de la tabla es (dispositivo, id, canal), así que dos filas iguales en el
  // mismo envío harían fallar el upsert de la nube («cannot affect row a second time»). Un recordatorio
  // con «WhatsApp» repetido por un dato viejo no debe romper toda la sincronización.
  for (const canal of new Set(deliveryChannels(event, owner))) {
    if (canal === "Notificación") salida.push({ canal: "push" })
    else if (canal === "WhatsApp")
      salida.push({
        canal: "whatsapp",
        destino: numeroParaEnviar(owner.contact?.phone || ""),
      })
    else if (canal === "Correo")
      salida.push({
        canal: "email",
        destino: (owner.contact?.email || "").trim().toLowerCase(),
      })
  }
  return salida
}

// ¿Hay al menos un usuario con WhatsApp o correo listo? Es lo que permite subir la cola aunque este
// teléfono no tenga push: la nube ya tiene por dónde entregar y no hace falta suscribirse al
// navegador para que un correo salga.
export function hayEntregaReal(profiles: PerfilEntrega[]) {
  return (profiles || []).some(
    (p) => channelReady(p, "WhatsApp") || channelReady(p, "Correo"),
  )
}
