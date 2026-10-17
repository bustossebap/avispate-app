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

// Etapa 12: restaurar de dos maneras. «Reemplazar» es lo de siempre (la copia manda y lo que había se
// va); «combinar» suma lo que falta sin tocar nada de lo que ya está, que es lo que sirve para juntar
// dos teléfonos o para recuperar algo borrado sin perder lo creado después del respaldo.
export type ModoRestaurar = "reemplazar" | "combinar"

// Cómo se reconoce un elemento repetido dentro de una lista: los recordatorios, los usuarios y los
// avisos llevan `id`; las categorías se identifican por su nombre, que además es su clave.
export type ListaCombinable = {
  clave: string
  identidad: "id" | "name"
}

export type CuentaCombinar = {
  agregados: number
  conservados: number
}

export type ResultadoCombinar = {
  datos: Record<string, string>
  porClave: Record<string, CuentaCombinar>
  agregados: number
  conservados: number
}

// La lista guardada como texto, sin romperse por una clave suelta: si el JSON no es una lista (o no
// parsea), se trata como vacía. Solo quedan los objetos, que son los que tienen `id` o `name`.
function leerLista(valor: string | undefined): Record<string, unknown>[] {
  try {
    const lista = JSON.parse(valor ?? "[]")
    return Array.isArray(lista) ? lista.filter(esObjeto) : []
  } catch {
    return []
  }
}

// Combina una copia con lo que hay guardado ahora. Regla de oro: lo que ya está **no se toca** —ni se
// pisa ni se borra—; solo se agregan los elementos cuyo id (o nombre, en categorías) no existía. Las
// claves que no son listas (reloj, modo oscuro, usuario activo) se quedan como están en este teléfono;
// solo se toman de la copia si acá no existen, y lo mismo con cualquier clave que esta versión no
// conozca. El texto de una lista que no recibe nada queda idéntico, byte a byte.
export function combinarDatos(
  actuales: Record<string, string>,
  copia: Record<string, string>,
  listas: ListaCombinable[],
): ResultadoCombinar {
  const datos: Record<string, string> = { ...actuales }
  for (const [clave, valor] of Object.entries(copia))
    if (!(clave in datos)) datos[clave] = valor

  const porClave: Record<string, CuentaCombinar> = {}
  let agregados = 0
  let conservados = 0
  for (const { clave, identidad } of listas) {
    const actual = leerLista(actuales[clave])
    const traida = leerLista(copia[clave])
    const vistos = new Set(actual.map((e) => String(e[identidad])))
    const suma: Record<string, unknown>[] = []
    let repetidos = 0
    for (const elemento of traida) {
      const marca = String(elemento[identidad] ?? "")
      if (!marca || vistos.has(marca)) {
        repetidos += 1
        continue
      }
      vistos.add(marca)
      suma.push(elemento)
    }
    if (suma.length)
      datos[clave] = JSON.stringify([...actual, ...suma])
    porClave[clave] = { agregados: suma.length, conservados: repetidos }
    agregados += suma.length
    conservados += repetidos
  }
  return { datos, porClave, agregados, conservados }
}

// Días completos entre una fecha guardada y ahora. null si el texto no es una fecha: la pantalla lo
// trata como «no hay dato» en vez de inventar «hace 0 días».
export function diasDesde(iso: string, ahora: Date = new Date()): number | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((ahora.getTime() - t) / 86_400_000))
}

// «hoy», «ayer», «hace 12 días», «hace 2 meses»: la antigüedad del último respaldo en palabras, que es
// lo que se lee de un vistazo. Se corta en meses y años para no decir «hace 487 días».
export function haceCuanto(iso: string, ahora: Date = new Date()): string {
  const dias = diasDesde(iso, ahora)
  if (dias === null) return ""
  if (dias === 0) return "hoy"
  if (dias === 1) return "ayer"
  if (dias < 30) return `hace ${dias} días`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return meses === 1 ? "hace un mes" : `hace ${meses} meses`
  const anios = Math.floor(dias / 365)
  return anios === 1 ? "hace un año" : `hace ${anios} años`
}
