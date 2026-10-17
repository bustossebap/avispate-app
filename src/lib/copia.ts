// Copia de seguridad de AVISPATE: un solo archivo .json con todo lo que la app tiene guardado en este
// navegador. Vive fuera de App.tsx porque es la pieza que más conviene poder leer sin montar la
// pantalla: acá no hay React, ni localStorage, ni IndexedDB; solo el formato del archivo y sus
// comprobaciones.
//
//   {
//     "app": "avispate",
//     "version": 1,
//     "creada": "2026-10-17T18:04:00.000Z",
//     "datos": { "avispate.events.v1": "[…]", "avispate.profiles.v1": "[…]", … },
//     "adjuntos": { "<id>": { "type": "image/jpeg", "data": "<base64>" } }
//   }
//
// `datos` guarda el texto de cada clave de localStorage tal cual estaba: restaurar es volver a
// escribirlo, sin reinterpretar nada. Los adjuntos (fotos y notas de voz) van en base64 porque en
// IndexedDB son archivos y un .json no los puede llevar de otra forma; el prefijo "data:" no se
// guarda, así el mismo texto sirve en cualquier navegador y el archivo sigue siendo legible.

export const VERSION_COPIA = 1

export type AdjuntoEnCopia = {
  type: string
  data: string
}

export type Copia = {
  app: "avispate"
  version: number
  creada: string
  datos: Record<string, string>
  adjuntos: Record<string, AdjuntoEnCopia>
}

// Lo que devuelve leerCopia: la copia lista para restaurar o el motivo por el que no se puede. Los
// mensajes están escritos para mostrarse tal cual en Ajustes.
export type LecturaCopia =
  | { ok: true; copia: Copia }
  | { ok: false; error: string }

// Lo que devuelven a la pantalla las dos acciones de la copia (descargar y restaurar).
export type RespuestaCopia = { ok: boolean; text: string }

export function armarCopia(
  datos: Record<string, string>,
  adjuntos: Record<string, AdjuntoEnCopia> = {},
  creada: Date = new Date(),
): Copia {
  return {
    app: "avispate",
    version: VERSION_COPIA,
    creada: creada.toISOString(),
    datos: { ...datos },
    adjuntos: { ...adjuntos },
  }
}

// Con sangría de dos espacios: si alguien abre el archivo para mirarlo (o para sacar una nota de voz a
// mano), se entiende. El precio son unos kilobytes; no vale la pena optimizarlo.
export function serializarCopia(copia: Copia): string {
  return `${JSON.stringify(copia, null, 2)}\n`
}

// avispate-2026-10-17.json, con la fecha local (no UTC): es la fecha que la persona ve en su reloj.
export function nombreDeCopia(creada: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, "0")
  return `avispate-${creada.getFullYear()}-${dos(creada.getMonth() + 1)}-${dos(
    creada.getDate(),
  )}.json`
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

export function leerCopia(texto: string): LecturaCopia {
  if (!texto.trim()) return { ok: false, error: "El archivo está vacío." }
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return {
      ok: false,
      error: "El archivo no es una copia de AVISPATE: no se pudo leer.",
    }
  }
  if (!esObjeto(crudo) || crudo.app !== "avispate")
    return { ok: false, error: "El archivo no es una copia de AVISPATE." }

  const version = crudo.version
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    return {
      ok: false,
      error: "La copia no dice de qué versión es. Descárgala de nuevo desde Ajustes.",
    }
  // Una copia más nueva puede traer datos que esta versión no sabe leer: restaurarla a medias sería
  // peor que no restaurarla.
  if (version > VERSION_COPIA)
    return {
      ok: false,
      error: `La copia es de una versión más nueva de AVISPATE (${version}). Actualiza la app y vuelve a intentarlo.`,
    }
  if (!esObjeto(crudo.datos))
    return { ok: false, error: "La copia no trae los datos guardados." }

  // Lo que no sea texto no se puede volver a escribir en localStorage: se ignora en vez de romper la
  // restauración entera por una clave suelta.
  const datos: Record<string, string> = {}
  for (const [clave, valor] of Object.entries(crudo.datos))
    if (typeof valor === "string") datos[clave] = valor

  const adjuntos: Record<string, AdjuntoEnCopia> = {}
  if (esObjeto(crudo.adjuntos)) {
    for (const [id, valor] of Object.entries(crudo.adjuntos)) {
      if (!esObjeto(valor) || typeof valor.data !== "string" || !valor.data)
        continue
      adjuntos[id] = {
        type:
          typeof valor.type === "string" && valor.type
            ? valor.type
            : "application/octet-stream",
        data: valor.data,
      }
    }
  }

  return {
    ok: true,
    copia: {
      app: "avispate",
      version,
      creada: typeof crudo.creada === "string" ? crudo.creada : "",
      datos,
      adjuntos,
    },
  }
}

// Cuántos elementos trae una lista guardada (recordatorios, usuarios, categorías): es lo que se
// muestra antes de reemplazar lo que hay. Un valor raro se cuenta como 0: la copia ya pasó las
// comprobaciones de leerCopia, así que acá solo se trata de no romper el resumen.
export function contarEnCopia(
  datos: Record<string, string>,
  clave: string,
): number {
  try {
    const lista = JSON.parse(datos[clave] ?? "[]")
    return Array.isArray(lista) ? lista.length : 0
  } catch {
    return 0
  }
}
