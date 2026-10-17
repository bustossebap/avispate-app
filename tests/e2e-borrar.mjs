// E2E de la Etapa 13: borrar sin miedo. Al eliminar un recordatorio, un adjunto, una categoría o un
// usuario aparece un aviso con «Deshacer» que devuelve exactamente lo que salió —con su lugar, sus
// archivos y sus marcas— durante unos segundos; un borrado nuevo reemplaza al anterior. Ajustes suma
// la tarjeta «Espacio en este dispositivo», que cuenta textos y archivos y ofrece liberar los que
// ningún recordatorio usa (en jsdom no hay IndexedDB: la tarjeta lo dice sin romperse).
import { cargarBundle, montar, reporter, wait } from "./harness.mjs"

const { bundle } = await cargarBundle()
const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const evento = (id, name, extra = {}) => ({
  id,
  ownerId: "yo",
  name,
  date: manana,
  time: "12:00",
  category: "Hogar",
  categoryEmoji: "🏠",
  recurrence: "No se repite",
  remindersBefore: [7],
  channels: ["Notificación"],
  ...extra,
})
const YO = { id: "yo", name: "Yo", emoji: "🙂" }
const ABUELA = { id: "abuela", name: "Abuela", emoji: "👵" }
const EMPRESA = { id: "empresa", name: "Empresa", emoji: "🧑" }
const CATS = [
  { name: "Hogar", emoji: "🏠" },
  { name: "Auto", emoji: "🚗" },
  { name: "Salud", emoji: "💊" },
]
const notif = (id, eventId, eventName, ownerId = "yo") => ({
  id,
  eventId,
  eventName,
  emoji: "🏠",
  ownerId,
  message: `Aviso de ${eventName}`,
  createdAt: new Date().toISOString(),
  channel: "Notificación",
})
const seed = (extra) => ({
  "avispate.onboarding.v1": "1",
  "avispate.profiles.v1": JSON.stringify([YO]),
  "avispate.activeProfile.v1": "yo",
  "avispate.reloj.v1": "24",
  "avispate.categorias.v1": JSON.stringify(CATS),
  ...extra,
})
const mount = (extra) => montar(bundle, seed(extra), {})
const { check, finish } = reporter()

// El botón exacto: el «Eliminar» del modal no se confunde con «Eliminar recordatorio» ni con el
// «Eliminar» de cada adjunto.
const boton = (m, texto) =>
  [...m.doc.querySelectorAll("#root button")].find(
    (b) => (b.textContent || "").trim() === texto,
  ) || null
const enModal = (m, texto) => {
  const modal = [...m.doc.querySelectorAll("#root div.fixed")].find((d) =>
    (d.textContent || "").includes("¿Eliminar este recordatorio?"),
  )
  return (
    (modal &&
      [...modal.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === texto,
      )) ||
    null
  )
}
const abrir = async (m, name) => {
  m.press(
    [...m.doc.querySelectorAll("#root button")].find((b) =>
      (b.textContent || "").includes(name),
    ),
  )
  await wait(80)
}
const eliminarRecordatorio = async (m) => {
  m.press(boton(m, "Eliminar recordatorio"))
  await wait(60)
  m.press(enModal(m, "Eliminar"))
  await wait(80)
}

// ------------------------------------------- A) el recordatorio que vuelve
{
  const m = mount({
    "avispate.events.v1": JSON.stringify([
      evento("r1", "Pagar la luz", { notes: "Luz de octubre" }),
      evento("r2", "Comprar pan", { category: "Auto", categoryEmoji: "🚗" }),
    ]),
  })
  await wait(150)
  await abrir(m, "Pagar la luz")
  check(
    "A1 · el detalle abre con su botón de eliminar",
    m.txt().includes("Pagar la luz") && !!boton(m, "Eliminar recordatorio"),
    m.txt().slice(0, 120),
  )
  m.press(boton(m, "Eliminar recordatorio"))
  await wait(60)
  check(
    "A1 · antes de borrar ya no dice que no se puede deshacer",
    m.txt().includes("Podrás deshacerlo desde el aviso") &&
      !m.txt().includes("Esta acción no se puede deshacer") &&
      !!enModal(m, "Eliminar"),
    m.txt().slice(-200),
  )
  m.press(enModal(m, "Eliminar"))
  await wait(80)
  const aviso = () => m.txt().includes("«Pagar la luz» eliminado")
  check(
    "A2 · el recordatorio sale y aparece el aviso con su nombre",
    !m.events().some((e) => e.id === "r1") && aviso(),
    JSON.stringify(m.events().map((e) => e.id)),
  )
  check("A2 · el aviso trae «Deshacer»", !!boton(m, "Deshacer"))
  check(
    "A2 · y se anuncia a los lectores de pantalla",
    !!m.doc.querySelector('#root [role="status"][aria-live="polite"]'),
  )
  m.press(boton(m, "Deshacer"))
  await wait(80)
  check(
    "A3 · «Deshacer» lo devuelve a su lugar",
    m
      .events()
      .map((e) => e.id)
      .join(",") === "r1,r2",
    JSON.stringify(m.events().map((e) => e.id)),
  )
  check(
    "A3 · con su nota y su categoría intactas",
    m.events()[0]?.notes === "Luz de octubre" &&
      m.events()[0]?.category === "Hogar",
    JSON.stringify(m.events()[0]),
  )
  check("A3 · y el aviso se va con el botón", !aviso() && !boton(m, "Deshacer"))

  // Un segundo borrado reemplaza al primero: solo el último tiene vuelta.
  await abrir(m, "Comprar pan")
  await eliminarRecordatorio(m)
  await abrir(m, "Pagar la luz")
  await eliminarRecordatorio(m)
  check(
    "A4 · un borrado nuevo reemplaza el aviso anterior",
    aviso() && !m.txt().includes("«Comprar pan» eliminado"),
    JSON.stringify(m.txt().slice(-160)),
  )
  m.press(boton(m, "Deshacer"))
  await wait(80)
  check(
    "A4 · deshacer devuelve solo el último borrado",
    m
      .events()
      .map((e) => e.id)
      .join(",") === "r1" && !m.events().some((e) => e.id === "r2"),
    JSON.stringify(m.events().map((e) => e.id)),
  )
  check(
    "A5 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- B) el adjunto que vuelve
{
  const m = mount({
    "avispate.events.v1": JSON.stringify([
      evento("a1", "Con archivos", {
        attachments: [
          { id: "f1", name: "foto.png", type: "image/png", size: 2048 },
          { id: "f2", name: "nota.m4a", type: "audio/mp4", size: 4096 },
        ],
      }),
    ]),
  })
  await wait(150)
  await abrir(m, "Con archivos")
  check(
    "B1 · el detalle lista los dos adjuntos",
    m.txt().includes("foto.png") && m.txt().includes("nota.m4a"),
  )
  m.press(boton(m, "Eliminar"))
  await wait(80)
  check(
    "B1 · quitar un adjunto no borra el recordatorio",
    m.events().length === 1 &&
      (m.events()[0].attachments || []).map((a) => a.id).join(",") === "f2",
    JSON.stringify(m.events()[0]?.attachments),
  )
  check(
    "B1 · y el aviso nombra el recordatorio",
    m.txt().includes("Adjunto quitado de «Con archivos»") &&
      !!boton(m, "Deshacer"),
    m.txt().slice(-160),
  )
  m.press(boton(m, "Deshacer"))
  await wait(80)
  check(
    "B2 · deshacer devuelve el archivo en su lugar",
    (m.events()[0].attachments || []).map((a) => a.id).join(",") === "f1,f2",
    JSON.stringify(m.events()[0]?.attachments),
  )
  check(
    "B3 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- C) la categoría que vuelve
{
  const m = mount({
    "avispate.events.v1": JSON.stringify([
      evento("h1", "Cortar el pasto"),
      evento("h2", "Pagar el gas", { notes: "Gas de octubre" }),
      evento("a1", "Cambio de aceite", {
        category: "Auto",
        categoryEmoji: "🚗",
      }),
    ]),
    "avispate.notifications.v1": JSON.stringify([
      notif("n1", "h1", "Cortar el pasto"),
      notif("n2", "a1", "Cambio de aceite"),
    ]),
  })
  await wait(150)
  m.press(m.byLabel("Editar categorías"))
  await wait(60)
  m.press(m.byLabel("Eliminar Hogar"))
  await wait(60)
  m.press(boton(m, "Dejarlos sin categoría"))
  await wait(80)
  check(
    "C1 · «dejarlos sin categoría» borra la categoría y suelta sus recordatorios",
    !m.storage("avispate.categorias.v1").some((c) => c.name === "Hogar") &&
      m
        .events()
        .filter((e) => e.id.startsWith("h"))
        .every((e) => e.category === ""),
    JSON.stringify(m.events().map((e) => [e.id, e.category])),
  )
  check(
    "C1 · y el aviso dice qué se eliminó",
    m.txt().includes("Categoría «Hogar» eliminada") && !!boton(m, "Deshacer"),
    m.txt().slice(-180),
  )
  m.press(boton(m, "Deshacer"))
  await wait(80)
  check(
    "C2 · deshacer devuelve la categoría a su lugar",
    m
      .storage("avispate.categorias.v1")
      .map((c) => c.name)
      .join(",") === "Hogar,Auto,Salud",
    JSON.stringify(m.storage("avispate.categorias.v1")),
  )
  check(
    "C2 · y sus recordatorios vuelven con la categoría y el emoji",
    m
      .events()
      .filter((e) => e.id.startsWith("h"))
      .every((e) => e.category === "Hogar" && e.categoryEmoji === "🏠"),
    JSON.stringify(m.events().map((e) => [e.id, e.category])),
  )

  // La otra salida: llevarse la categoría con sus recordatorios y su historial.
  m.press(m.byLabel("Eliminar Auto"))
  await wait(60)
  m.press(boton(m, "Borrar sus recordatorios"))
  await wait(80)
  check(
    "C3 · «borrar sus recordatorios» se lleva la categoría, el recordatorio y su aviso",
    !m.storage("avispate.categorias.v1").some((c) => c.name === "Auto") &&
      !m.events().some((e) => e.id === "a1") &&
      !m.notifications().some((n) => n.id === "n2"),
    JSON.stringify(m.events().map((e) => e.id)),
  )
  check(
    "C3 · y el aviso cuenta cuántos se llevó",
    m.txt().includes("Categoría «Auto» eliminada con 1 recordatorio"),
    m.txt().slice(-180),
  )
  m.press(boton(m, "Deshacer"))
  await wait(80)
  check(
    "C4 · deshacer la devuelve completa",
    m
      .storage("avispate.categorias.v1")
      .map((c) => c.name)
      .join(",") === "Hogar,Auto,Salud" &&
      m
        .events()
        .map((e) => e.id)
        .join(",") === "h1,h2,a1" &&
      m.notifications().length === 2,
    JSON.stringify({
      cats: m.storage("avispate.categorias.v1").map((c) => c.name),
      events: m.events().map((e) => e.id),
      avisos: m.notifications().map((n) => n.id),
    }),
  )
  check(
    "C5 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- D) el usuario que vuelve
{
  const m = mount({
    "avispate.profiles.v1": JSON.stringify([YO, ABUELA, EMPRESA]),
    "avispate.events.v1": JSON.stringify([
      evento("e-yo", "Cita Yo"),
      evento("e-ab", "Cita Abuela", { ownerId: "abuela" }),
      evento("e-em", "Cita Empresa", {
        ownerId: "empresa",
        category: "Auto",
        categoryEmoji: "🚗",
      }),
    ]),
    "avispate.notifications.v1": JSON.stringify([
      notif("n-yo", "e-yo", "Cita Yo"),
      notif("n-ab", "e-ab", "Cita Abuela", "abuela"),
      notif("n-em", "e-em", "Cita Empresa", "empresa"),
    ]),
    "avispate.sent.e-em:7:2026-10-17": "1",
  })
  await wait(150)
  await m.ajustes()
  check(
    "D1 · Ajustes lista a los tres usuarios",
    !!m.rowOf("Yo") && !!m.rowOf("Abuela") && !!m.rowOf("Empresa"),
  )
  m.click(m.deleteBtn("Empresa"))
  await wait(60)
  m.click(m.deleteBtn("Empresa"))
  await wait(80)
  check(
    "D1 · el usuario sale con sus recordatorios y sus avisos",
    m.profileOf("empresa") === undefined &&
      !m.events().some((e) => e.ownerId === "empresa") &&
      !m.notifications().some((n) => n.ownerId === "empresa"),
    JSON.stringify(m.events().map((e) => e.id)),
  )
  check(
    "D1 · y sus marcas de «ya avisado»",
    m.raw("avispate.sent.e-em:7:2026-10-17") === null &&
      m.storage("avispate.profiles.v1").length === 2,
  )
  check(
    "D1 · el aviso cuenta lo que se llevó",
    m.txt().includes("Usuario «Empresa» eliminado con 1 recordatorio") &&
      !!boton(m, "Deshacer"),
    m.txt().slice(-180),
  )
  m.press(boton(m, "Deshacer"))
  await wait(80)
  check(
    "D2 · deshacer devuelve el perfil a su lugar",
    m
      .storage("avispate.profiles.v1")
      .map((p) => p.id)
      .join(",") === "yo,abuela,empresa",
    JSON.stringify(m.storage("avispate.profiles.v1").map((p) => p.id)),
  )
  check(
    "D2 · con sus recordatorios, sus avisos y sus marcas",
    m
      .events()
      .map((e) => e.id)
      .join(",") === "e-yo,e-ab,e-em" &&
      m.notifications().length === 3 &&
      m.raw("avispate.sent.e-em:7:2026-10-17") === "1",
    JSON.stringify({
      events: m.events().map((e) => e.id),
      avisos: m.notifications().length,
      marca: m.raw("avispate.sent.e-em:7:2026-10-17"),
    }),
  )

  // El usuario activo: al borrarlo manda otro, y deshacer devuelve el mando.
  m.click(m.deleteBtn("Yo"))
  await wait(60)
  m.click(m.deleteBtn("Yo"))
  await wait(80)
  check(
    "D3 · borrar al usuario activo pasa el mando a otro",
    m.profileOf("yo") === undefined &&
      m.raw("avispate.activeProfile.v1") === "abuela",
    m.raw("avispate.activeProfile.v1"),
  )
  m.press(boton(m, "Deshacer"))
  await wait(80)
  check(
    "D3 · deshacer lo devuelve primero y le devuelve el mando",
    m
      .storage("avispate.profiles.v1")
      .map((p) => p.id)
      .join(",") === "yo,abuela,empresa" &&
      m.raw("avispate.activeProfile.v1") === "yo" &&
      m
        .events()
        .map((e) => e.id)
        .join(",") === "e-yo,e-ab,e-em",
    JSON.stringify({
      perfiles: m.storage("avispate.profiles.v1").map((p) => p.id),
      activo: m.raw("avispate.activeProfile.v1"),
    }),
  )
  check(
    "D4 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

// ------------------------------------------- E) el espacio en el dispositivo
{
  const m = mount({
    "avispate.events.v1": JSON.stringify([evento("r1", "Pagar la luz")]),
  })
  await wait(150)
  await m.ajustes()
  await wait(250)
  check(
    "E1 · Ajustes suma su tarjeta de espacio",
    m.txt().includes("Espacio en este dispositivo"),
    m.txt().slice(-260),
  )
  check(
    "E2 · sin IndexedDB lo dice sin romper la pantalla",
    m.txt().includes("Este navegador no deja revisar los archivos guardados."),
  )
  check(
    "E2 · y aun así cuenta los textos guardados",
    /Textos y ajustes: \d+ (B|KB|MB)\./.test(m.txt()) &&
      m.txt().includes("recordatorios guardados"),
    m.txt().slice(-260),
  )
  check(
    "E3 · sin archivos legibles no ofrece liberar nada",
    ![...m.doc.querySelectorAll("#root button")].some((b) =>
      (b.textContent || "").startsWith("Liberar"),
    ),
  )
  check(
    "E4 · y el pie dice la versión y la etapa",
    m.txt().includes("AVISPATE · V2.1 · Etapa 15"),
    m.txt().slice(-120),
  )
  check(
    "E5 · sin errores de ejecución",
    m.errors.length === 0,
    m.errors.join(" | "),
  )
}

process.exit(finish() ? 1 : 0)
