// La búsqueda de Inicio (Etapa 11). Es una función pura y sin React a propósito: la batería la puede
// mirar sin montar la app, y la pantalla solo decide qué dibujar con el resultado.
//
// Cómo se compara: se quitan las tildes a los dos lados y se pasa a minúsculas. Así «jardin» encuentra
// «Jardín», «año» se busca escribiendo «ano» y «PASAPORTE» no exige acordarse de la mayúscula. Se usa
// NFD (la forma descompuesta de Unicode) y se borran los signos diacríticos que quedan sueltos; la ñ
// cae en lo mismo (n + tilde combinada), que es justo lo que uno espera de un buscador en español.
//
// La consulta se parte por espacios y TODAS las palabras tienen que aparecer, en cualquier orden: «luz
// marzo» encuentra «Pagar la luz» aunque la nota diga otra cosa. Sin palabras, la lista queda igual.
//
// Se mira el nombre, las notas y la categoría. El dueño no entra: Inicio ya muestra solo los
// recordatorios del usuario activo, así que buscarlo no distinguiría nada (para ver los de otro se
// cambia de usuario, que es una acción de un toque en la misma cabecera).

export type CamposBuscables = {
  name?: string
  notes?: string
  category?: string
}

// NFD separa cada letra de su tilde y el rango U+0300–U+036F son justamente esos signos combinados.
// `normalize` existe desde ES2015, igual que el resto de lo que usa la app.
export function normalizar(texto: string | null | undefined) {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

// Las palabras de la consulta, ya normalizadas. Vacío (o solo espacios) devuelve una lista vacía.
export function palabrasDe(consulta: string | null | undefined) {
  return normalizar(consulta).split(/\s+/).filter(Boolean)
}

// ¿Hay algo que buscar? Sirve para no tratar «   » como una búsqueda que no encuentra nada.
export function hayConsulta(consulta: string | null | undefined) {
  return palabrasDe(consulta).length > 0
}

// Un recordatorio coincide si TODAS las palabras de la consulta aparecen en alguno de sus campos. El
// campo vacío no suma nada; el `trim` final evita que un espacio de más cuente como palabra.
export function coincide(
  campos: Array<string | null | undefined>,
  consulta: string | null | undefined,
) {
  const buscadas = palabrasDe(consulta)
  if (!buscadas.length) return true
  const heno = normalizar(campos.filter(Boolean).join(" "))
  return buscadas.every((palabra) => heno.includes(palabra))
}

// Filtra sin tocar el orden que traía la lista (Inicio ya la ordena por fecha). Devuelve una copia
// cuando no hay consulta, para que quien la reciba pueda ordenarla sin tocar el original.
export function buscarRecordatorios<T extends CamposBuscables>(
  lista: readonly T[],
  consulta: string | null | undefined,
): T[] {
  if (!hayConsulta(consulta)) return [...lista]
  return lista.filter((item) =>
    coincide([item.name, item.notes, item.category], consulta),
  )
}
