// El estado de un envío real (Etapa 14), en palabras que se puedan mostrar. El servidor guarda un
// estado corto —`en_cola`, `enviado`, `entregado`, `fallido`— y acá se traduce a la etiqueta y al
// color de Ajustes. Es puro y vive aparte de la pantalla para que el día que haya historial completo
// (Etapa 15) no haya dos listas de estados que se contradigan.
export type CanalEnvio = "push" | "whatsapp" | "email"
export type EstadoEnvio = "en_cola" | "enviado" | "entregado" | "fallido"

// Lo que devuelve `ultimos_envios` en la nube. Los dos tiempos pueden venir en null: un envío en
// cola todavía no salió y uno entregado puede no tener la marca del webhook (el proveedor no siempre
// lo manda, y no vale la pena inventarla).
export type EnvioReciente = {
  id: string
  canal: CanalEnvio
  titulo: string
  cuando: string
  estado: EstadoEnvio
  enviadoEn: string | null
  entregadoEn: string | null
  error: string | null
}

export function etiquetaCanal(canal: string) {
  if (canal === "whatsapp") return "WhatsApp"
  if (canal === "email") return "Correo"
  return "Notificación"
}

export function etiquetaEstado(estado: string) {
  if (estado === "enviado") return "Enviado"
  if (estado === "entregado") return "Entregado"
  if (estado === "fallido") return "Falló"
  return "En cola"
}

// El estado que se muestra: lo que dice la nube y, si viene vacío o raro, lo que se deduce de las
// marcas de tiempo. Así una fila vieja de la Etapa 13 (sin `estado`) no aparece como «En cola» para
// siempre.
export function estadoDe(envio: {
  estado?: string
  enviadoEn?: string | null
  entregadoEn?: string | null
  intentos?: number
}): EstadoEnvio {
  if (
    envio.estado === "entregado" ||
    envio.estado === "enviado" ||
    envio.estado === "fallido" ||
    envio.estado === "en_cola"
  )
    return envio.estado
  if (envio.entregadoEn) return "entregado"
  if (envio.enviadoEn) return "enviado"
  if ((envio.intentos ?? 0) >= 5) return "fallido"
  return "en_cola"
}

// Texto de una fila del historial: «WhatsApp · Entregado». En la pantalla va como dos piezas (un
// ícono y una etiqueta), pero tener el resumen junto simplifica las pruebas y los textos accesibles.
export function resumenEnvio(envio: Pick<EnvioReciente, "canal" | "estado">) {
  return `${etiquetaCanal(envio.canal)} · ${etiquetaEstado(envio.estado)}`
}


