import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  armarCopia,
  contarEnCopia,
  leerCopia,
  nombreDeCopia,
  serializarCopia,
  type AdjuntoEnCopia,
  type Copia,
  type RespuestaCopia,
} from "./lib/copia"
import {
  HOUR_OFFSET,
  PRESET_OFFSETS,
  alertLabel,
  alertToDays,
  offsetLabel,
  unitText,
} from "./lib/avisos"
import { programarAvisos } from "./lib/cola"
import { pedirAvisoDePrueba, sincronizarCola } from "./lib/nube"
import {
  activarAvisos,
  activarVersionNueva,
  desactivarAvisos,
  esInstalada,
  estadoAvisos,
  pushAnotado,
  registrarSW,
  vigilarVersionNueva,
  type EstadoAvisos,
} from "./lib/pwa"
import {
  addMonthsSafe,
  addYearsSafe,
  nextOccurrenceAt,
  pad2,
  parseDate,
} from "./lib/repeticion"

// Los modales de la app (la hoja de emojis y la foto) se dibujan con un portal dentro del marco de la
// app —el `div` con id `app-frame`— y no dentro del formulario que los abre. Motivo: cualquier ancestro
// con `transform` convierte al modal `fixed` en un hijo suyo y lo encoge a esa porción de la pantalla, y
// en el onboarding casi todo va con animaciones de entrada (`animate-slide-in` termina en
// `translateY(0)`, que ya cuenta como transform). Dentro del marco, `absolute inset-0` cubre toda la
// pantalla (y en escritorio, todo el teléfono del marco).
function enMarco(children: React.ReactNode) {
  const marco =
    typeof document === "undefined" ? null : document.getElementById("app-frame")
  return marco ? createPortal(children, marco) : children
}

type Status = "normal" | "upcoming" | "urgent" | "overdue"
type Screen = "onboarding" | "home" | "create" | "detail" | "calendar" | "notifications" | "settings" | "tips"
type Tab = "home" | "calendar" | "notifications" | "settings"

interface ReminderAlert {
  id: string
  amount: number
  unit: "horas" | "días" | "semanas" | "meses"
}

interface Reminder {
  id: string
  name: string
  date: string
  time: string
  category: string
  categoryEmoji: string
  recurrence: string
  recurrenceInterval?: number
  recurrenceUnit?: "horas" | "días" | "semanas" | "meses" | "años"
  remindersBefore: number[]
  customReminders?: ReminderAlert[]
  channels: string[]
  notes?: string
  attachments?: AttachmentMeta[]
  completed?: boolean
  ownerId?: string
  history?: CompletedOccurrence[]
  gcalAddedAt?: string
  // Marcas de los otros dos calendarios: el mismo recordatorio puede estar en Google Calendar, en
  // Apple Calendar y en Outlook a la vez, y cada destino lleva su propia fecha.
  appleAddedAt?: string
  outlookAddedAt?: string
}

interface CompletedOccurrence {
  id: string
  date: string
  completedAt: string
}

interface Profile {
  id: string
  name: string
  emoji: string
  // Foto del usuario, guardada como data URL (se reduce a 256 px antes de guardarla). Si existe, es
  // la cara del usuario en toda la app; si no, se dibuja su emoji. Es del usuario, como su contacto.
  photo?: string
  // Cada usuario del dispositivo tiene lo suyo: su contacto (WhatsApp y correo), sus canales
  // activados y su propia conexión con Google Calendar. Ajustes edita siempre los del usuario
  // activo, así que lo que se configura para uno no toca a los demás.
  contact?: Contact
  channels?: ChannelPrefs
  gcal?: GcalState
  apple?: CalendarAppState
  outlook?: CalendarAppState
}

interface AttachmentMeta {
  id: string
  name: string
  type: string
  size: number
}

interface AppNotification {
  id: string
  eventId: string
  eventName: string
  emoji: string
  ownerId?: string
  message: string
  createdAt: string
  channel: string
  status: "Enviado" | "Completado"
}

const STORAGE_EVENTS = "avispate.events.v1"
const STORAGE_NOTIFICATIONS = "avispate.notifications.v1"
const STORAGE_ONBOARDING = "avispate.onboarding.v1"
const STORAGE_DARK = "avispate.dark.v1"
const STORAGE_PROFILES = "avispate.profiles.v1"
const STORAGE_ACTIVE_PROFILE = "avispate.activeProfile.v1"
// Formato de hora elegido en Ajustes: "12" (a.m./p.m.) o "24" (24 horas). Es una preferencia del
// dispositivo, como el modo oscuro; sin elección guardada se respeta lo que prefiera el sistema.
const STORAGE_CLOCK = "avispate.reloj.v1"
// Categorías propias del dispositivo: la lista que alimenta el carrusel de Inicio y el selector de
// Nuevo recordatorio. Si no hay nada guardado se usan las de siempre, así nadie pierde las suyas al
// actualizar; borrar una categoría no toca los recordatorios (se decide en la hoja de edición).
const STORAGE_CATEGORIES = "avispate.categorias.v1"
// Versión visible: un solo lugar para el número y la entrega, así la pantalla y el README no se
// contradicen. La V1.5 es la versión del producto; las etapas son las entregas de trabajo dentro de
// ella (1: cada usuario con lo suyo · 2: hora propia y logos reales · 3: onboarding con deslizar,
// canales a la vista y ticket de contacto · 4: hora estable, Google por usuario e inactividad ·
// 5: emoji propio en todas partes y sincronización con Apple Calendar y Outlook · 6: la avispa de
// Inicio, la foto de usuario, repetir por horas, la extensión del número y los tips · 7: el renombre
// de RECUERDA a AVISPATE, con sus claves guardadas renombradas y migradas · 8: la app publicada en
// avispate-app.vercel.app y la batería en vivo arreglada (los assets con `./`) · 9: la copia de
// seguridad, que saca y devuelve todo en un .json · 10: los avisos con la app cerrada (push + nube de
// Supabase) y AVISPATE instalable en el teléfono).
const APP_VERSION = "V1.7"
const APP_STAGE = "Etapa 10"
// Uso de la app: se guarda la última visita para poder avisar —una sola vez por hueco— cuando alguien
// vuelve después de una semana o más sin abrir AVISPATE. Es el único aviso que no depende de un
// recordatorio, así que vive aparte con su propia clave.
const STORAGE_LAST_SEEN = "avispate.ultimaVisita.v1"
const STORAGE_INACTIVITY = "avispate.avisosInactividad.v1"
// Cola de avisos con la app cerrada (Etapa 10): las fechas concretas que este dispositivo ya calculó
// y subió a la nube. Se guarda para que la batería pueda mirarla y para no recalcularla al abrir; el
// servidor solo la recibe, no la inventa.
const STORAGE_COLA = "avispate.cola.v1"
const INACTIVITY_DAYS = 7
const INACTIVITY_MESSAGE = "Bzzt… no te olvides de no olvidarte, ¡avíspate!"
// Lo que viaja en la copia de seguridad: el contenido de la persona (sus recordatorios, sus usuarios,
// sus categorías y el historial de avisos) y sus preferencias de este dispositivo. Quedan afuera las
// claves de uso —la última visita, el aviso de inactividad y los `avispate.sent.*` de «ya avisado»—:
// son del momento, no del respaldo, y restaurarlas haría que la app se comporte como si el tiempo no
// hubiera pasado. Los adjuntos van aparte, desde IndexedDB (ver src/lib/copia.ts).
const CLAVES_COPIA = [
  STORAGE_EVENTS,
  STORAGE_PROFILES,
  STORAGE_CATEGORIES,
  STORAGE_NOTIFICATIONS,
  STORAGE_ONBOARDING,
  STORAGE_ACTIVE_PROFILE,
  STORAGE_CLOCK,
  STORAGE_DARK,
]

// Claves de la V1.5, cuando el contacto y Google Calendar eran un único dato global. Ahora viven
// dentro de cada usuario: estas claves se leen una sola vez al abrir la app (migración) y se borran.
// Van juntas y arriba a propósito: la migración las usa apenas arranca el módulo.
const LEGACY_CONTACT = "recuerda.contacto.v1"
const LEGACY_GCAL = "recuerda.gcal.v1"
// Marca de "este aviso ya salió" (avispate.sent.<recordatorio>:<aviso>:<fecha>). Lleva prefijo propio
// porque son claves sueltas que se crean y se borran con los avisos, no una lista guardada.
const SENT_PREFIX = "avispate.sent."
// Renombre RECUERDA → AVISPATE: las claves guardadas cambiaron de nombre, así que lo que hubiera en las
// viejas se copia a las nuevas una sola vez (ver migrateRenamedKeys). El destino de cada par se escribe
// con las constantes de arriba —una sola fuente de verdad— y las dos de la V1.5 (contacto/gcal) no van
// acá: son el nombre de una versión pasada, no la marca, y su propia migración las sigue leyendo igual.
const RENAMED_KEYS: Array<[string, string]> = [
  ["recuerda.events.v1", STORAGE_EVENTS],
  ["recuerda.notifications.v1", STORAGE_NOTIFICATIONS],
  ["recuerda.onboarding.v1", STORAGE_ONBOARDING],
  ["recuerda.dark.v1", STORAGE_DARK],
  ["recuerda.profiles.v1", STORAGE_PROFILES],
  ["recuerda.activeProfile.v1", STORAGE_ACTIVE_PROFILE],
  ["recuerda.reloj.v1", STORAGE_CLOCK],
  ["recuerda.categorias.v1", STORAGE_CATEGORIES],
  ["recuerda.ultimaVisita.v1", STORAGE_LAST_SEEN],
  ["recuerda.avisosInactividad.v1", STORAGE_INACTIVITY],
]
const RENAMED_SENT_PREFIX = "recuerda.sent."

const DEFAULT_PROFILE_ID = "yo"
const DEFAULT_PROFILE: Profile = {
  id: DEFAULT_PROFILE_ID,
  name: "Yo",
  emoji: "🐝",
}
// Las caras de la rejilla. La abeja va primera porque es la cara por defecto de un usuario nuevo —es la
// mascota de AVISPATE— y el smiley queda al final, con las demás.
const PROFILE_EMOJIS = [
  "🐝",
  "👨",
  "👩",
  "👧",
  "👦",
  "👴",
  "👵",
  "🧑",
  "👶",
  "🏢",
  "🙂",
]

// El botón «+» del selector abre la lista completa —los emojis de un teclado, agrupados por tema igual
// que en el teléfono— en una hoja a pantalla completa, para elegir uno tocándolo. Los once de la rejilla
// siguen ahí (son los que usa esta familia) y esto son todos los demás.
const EMOJI_GROUPS: { tab: string ;name: string ;emojis: string[] }[] = [
  {
    tab: "🙂",
    name: "Caras",
    emojis:
      "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 💕 💞 💓 💗 💖 💘 💝".split(
        " ",
      ),
  },
  {
    tab: "🧑",
    name: "Personas",
    emojis:
      "👋 🤚 🖐️ ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 💅 🤳 💪 🦵 🦶 👂 👃 🧠 👀 👁️ 👅 👄 💋 🧑 👨 👩 👦 👧 👶 👴 👵 🧓 👱 👳 🧕 🤴 👸 🤵 👰 🤰 🤱 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 👼 💆 💇 🚶 🏃 💃 🕺 👯 🧗 🏇 ⛷️ 🏂 🏄 🚣 🏊 🚴 🚵 🤸 🤼 🤽 🤾 🤹 🧘 🛌 👪 👫 👬 👭 💑 🧑‍🎓 🧑‍🏫 🧑‍💻 👨‍🍳 👩‍⚕️".split(
        " ",
      ),
  },
  {
    tab: "🐝",
    name: "Animales",
    emojis:
      "🐝 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐛 🦋 🐌 🐞 🐜 🦗 🕷️ 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐓 🦃 🕊️ 🐇 🐁 🐀 🐿️ 🦔 🐚 🌵 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍃 🍂 🍁 🌾 🌷 🌹 🥀 🌺 🌻 🌼 🌸 💐 🍄 🌰".split(
        " ",
      ),
  },
  {
    tab: "🍕",
    name: "Comida",
    emojis:
      "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥬 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🥙 🌮 🌯 🥗 🥘 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🎂 🍰 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🥛 ☕ 🍵 🧃 🥤 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍽️ 🥄 🍴 🥢".split(
        " ",
      ),
  },
  {
    tab: "⚽",
    name: "Actividades",
    emojis:
      "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🥅 🏒 🏑 🥍 🏏 🥊 🥋 🥌 ⛳ 🏹 🎣 🤿 🎽 🛹 🛼 🛷 ⛸️ 🥁 🎷 🎸 🎹 🎺 🎻 🪕 🎤 🎧 🎼 🎵 🎶 🎬 🎨 🎭 🎪 🎟️ 🎫 🎖️ 🏆 🏅 🥇 🥈 🥉 🎮 🕹️ 🎲 🧩 ♟️ 🎯 🎳 🎰 🃏 🎴 🎁 🎉 🎊 🎈 🎀 🪅 🎃 🎄 🎆 🎇 🧨 🪄 🪁 🪀".split(
        " ",
      ),
  },
  {
    tab: "✈️",
    name: "Viajes",
    emojis:
      "✈️ 🛫 🛬 🚁 🚀 🛰️ 🚂 🚆 🚇 🚊 🚉 🚌 🚍 🚎 🚐 🚑 🚒 🚓 🚕 🚗 🚙 🚚 🚛 🚜 🛴 🚲 🛵 🏍️ 🚨 🛻 🚢 ⛴️ 🛳️ ⚓ ⛵ 🚤 🛶 🏝️ 🏖️ 🏜️ 🏞️ 🏕️ 🗺️ 🧭 🏔️ ⛰️ 🌋 🗿 🏛️ 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏠 🏡 🏢 🏣 🏥 🏦 🏨 🏪 🏫 🏬 🏭 🏗️ 🚏 🚦 🚥 🗽 🗼 🏙️ 🌃 🌆 🌇 🌉 🌌 🌍 🌎 🌏 🌕 🌙 ⭐ 🌟 ✨ 🌈 🔥 ⚡ ☀️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ⛄ 🌊 💧 🕐 🕒 🕕 🕘 📅 📆".split(
        " ",
      ),
  },
  {
    tab: "💡",
    name: "Objetos",
    emojis:
      "💡 🔦 🕯️ 🛢️ 💸 💵 💰 💳 💎 ⚖️ 🔧 🔨 ⚒️ 🛠️ ⛏️ 🔩 ⚙️ 🧰 🧲 🔫 💣 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳️ 💊 💉 🩹 🩺 🌡️ 🚽 🚰 🚿 🛁 🧼 🧽 🧴 🧷 🧹 🧺 🧻 🚪 🛏️ 🛋️ 🪑 🧳 🕰️ ⌛ ⏳ ⌚ ⏰ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ ⏱️ 🔋 🔌 🔍 🔎 📡 📢 📣 📯 🔔 🔕 📖 📚 📕 📗 📘 📙 📓 📔 📒 📃 📜 📄 📰 🗞️ 📑 🔖 🏷️ ✉️ 📧 📨 📩 📤 📥 📦 📫 📪 📬 📭 📮 🗳️ ✏️ ✒️ 🖋️ 🖊️ 🖌️ 🖍️ 📝 💼 📁 📂 🗂️ 🗒️ 🗓️ 📇 📈 📉 📊 📋 📌 📍 📎 📏 📐 ✂️ 🗃️ 🗄️ 🗑️ 🔒 🔓 🔏 🔐 🔑 🗝️ 🔗 ⛓️".split(
        " ",
      ),
  },
  {
    tab: "❤️",
    name: "Símbolos",
    emojis:
      "✔️ ❌ ❎ ➕ ➖ ➗ 〰️ ‼️ ⁉️ ❓ ❔ ❕ ❗ 💯 ✅ 🔟 🔠 🔡 🔢 🔣 🔤 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 ♦️ ♠️ ♣️ ▶️ ⏸️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ 🔀 🔁 🔂 🔄 🔙 🔚 🔛 🔜 🔝 ⏫ ⏬ ➰ ➿ ✳️ ✴️ ❇️ ©️ ®️ ™️ ⬆️ ↗️ ⬅️ ➡️ ↘️ ↖️ ↙️ ↔️ ↕️ ↩️ ↪️ ⤴️ ⤵️ ⚠️ 🚸 ⛔ 🚫 🚭 🚯 🚱 🚳 🚷 ☢️ ☣️ 📴 📳 📵 🅰️ 🆎 🅱️ 🆑 🆒 🆓 🆔 🆕 🆖 🅾️ 🆗 🅿️ 🆘 🆙 🆚 🔞 ♻️".split(
        " ",
      ),
  },
  {
    tab: "🇨🇱",
    name: "Banderas",
    emojis:
      "🇨🇱 🇦🇷 🇧🇴 🇧🇷 🇨🇦 🇨🇴 🇨🇷 🇨🇺 🇩🇪 🇩🇰 🇪🇨 🇪🇬 🇸🇻 🇪🇸 🇺🇸 🇫🇮 🇫🇷 🇬🇧 🇬🇹 🇭🇳 🇮🇳 🇮🇪 🇮🇱 🇮🇹 🇯🇵 🇰🇪 🇲🇦 🇲🇽 🇳🇮 🇳🇱 🇳🇴 🇳🇿 🇵🇦 🇵🇪 🇵🇾 🇵🇭 🇵🇱 🇵🇹 🇷🇺 🇸🇦 🇸🇪 🇸🇬 🇹🇭 🇹🇷 🇺🇾 🇻🇪 🇻🇳 🇿🇦".split(
        " ",
      ),
  },
]

// Extensión de país del número de WhatsApp: en vez de escribir el "+56" a mano (y equivocarse), se
// elige de una lista corta que cubre Chile —el predeterminado— y los países donde vive la familia
// AVISPATE. El número se sigue guardando completo ("+56 9 1234 5678") dentro del contacto del
// usuario, así el mismo dato sirve para el ticket, los avisos y lo ya guardado en versiones anteriores.
// Cada país lleva su bandera: el cuadro de la extensión quedó chico —una bandera y nada más— para
// dejarle el ancho al número, así que la bandera es lo que se ve y el nombre (+56 Chile) se lee al
// abrir la lista o al pasar el dedo por el cuadro.
const COUNTRY_CODES: { code: string ;name: string ;flag: string }[] = [
  { code: "+56", name: "Chile", flag: "🇨🇱" },
  { code: "+54", name: "Argentina", flag: "🇦🇷" },
  { code: "+591", name: "Bolivia", flag: "🇧🇴" },
  { code: "+55", name: "Brasil", flag: "🇧🇷" },
  { code: "+57", name: "Colombia", flag: "🇨🇴" },
  { code: "+506", name: "Costa Rica", flag: "🇨🇷" },
  { code: "+53", name: "Cuba", flag: "🇨🇺" },
  { code: "+593", name: "Ecuador", flag: "🇪🇨" },
  { code: "+503", name: "El Salvador", flag: "🇸🇻" },
  { code: "+34", name: "España", flag: "🇪🇸" },
  { code: "+1", name: "Estados Unidos", flag: "🇺🇸" },
  { code: "+502", name: "Guatemala", flag: "🇬🇹" },
  { code: "+504", name: "Honduras", flag: "🇭🇳" },
  { code: "+52", name: "México", flag: "🇲🇽" },
  { code: "+505", name: "Nicaragua", flag: "🇳🇮" },
  { code: "+507", name: "Panamá", flag: "🇵🇦" },
  { code: "+595", name: "Paraguay", flag: "🇵🇾" },
  { code: "+51", name: "Perú", flag: "🇵🇪" },
  { code: "+351", name: "Portugal", flag: "🇵🇹" },
  { code: "+598", name: "Uruguay", flag: "🇺🇾" },
  { code: "+58", name: "Venezuela", flag: "🇻🇪" },
]
// El país elegido, con su nombre: se usa para el texto que se lee al pasar el dedo por el cuadro de la
// extensión (el nombre del país no ocupa lugar en la pantalla, pero sigue disponible para quien lo
// busque con el mouse o el lector de pantalla).
function countryOf(code: string) {
  return COUNTRY_CODES.find((c) => c.code === code) ?? COUNTRY_CODES[0]
}
const DEFAULT_COUNTRY = "+56"
// Un número guardado se parte en extensión + número local. Los que se escribieron antes, sin
// extensión, se toman como chilenos: Chile es el público del producto y así no se rompe nada.
function splitPhone(phone: string): { country: string ;local: string } {
  const value = (phone || "").trim()
  if (!value) return { country: DEFAULT_COUNTRY, local: "" }
  if (!value.startsWith("+")) return { country: DEFAULT_COUNTRY, local: value }
  // Gana la extensión más larga: "+591" antes que "+5", que no existe pero se compararía primero.
  const found = [...COUNTRY_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => value.startsWith(c.code))
  if (!found) return { country: DEFAULT_COUNTRY, local: value }
  return { country: found.code, local: value.slice(found.code.length).trim() }
}
function joinPhone(country: string, local: string) {
  const number = (local || "").trim()
  if (!number) return ""
  return `${country} ${number}`
}

// Opciones de «¿Cuándo se repite?»: las nuevas incluyen las de horas (lo pedido en la Etapa 6) y quitan
// las de plazos larguísimos que nadie usaba. Esas otras —«Cada 2 años», «Cada 5 años», «Cada 10 años»—
// siguen entendiéndose al editar un recordatorio guardado antes: no se ofrecen, pero no se rompen.
const RECURRENCE_OPTIONS = [
  "No se repite",
  "Cada 8 horas",
  "Cada semana",
  "Cada 2 semanas",
  "Cada mes",
  "Cada 6 meses",
  "Cada año",
  "Personalizada",
]
const RECURRENCE_UNITS: Reminder["recurrenceUnit"][] = [
  "horas",
  "días",
  "semanas",
  "meses",
  "años",
]

// Las categorías de fábrica: las de siempre (Auto, Documentos, Hogar…). Son sólo el punto de partida:
// en Inicio se pueden agregar, reordenar y eliminar, y esa lista se guarda con su propia clave.
type Category = { name: string; emoji: string }
const DEFAULT_CATEGORIES: Category[] = [
  { name: "Auto", emoji: "🚗" },
  { name: "Documentos", emoji: "📄" },
  { name: "Hogar", emoji: "🏠" },
  { name: "Finanzas", emoji: "💳" },
  { name: "Trabajo", emoji: "💼" },
  { name: "Personal", emoji: "❤️" },
  { name: "Mantención", emoji: "🔧" },
  { name: "Otros", emoji: "📦" },
]
// El emoji de una categoría nueva si no eligen ninguno: la carpeta, que es lo genérico.
const CATEGORY_EMOJI = "🗂️"
// La lista guardada, ya limpia: se descartan entradas rotas y se completa el emoji que falte. Si no
// hay nada (o quedó vacía por un guardado a medias) se devuelven las de fábrica.
function loadCategories(): Category[] {
  try {
    const raw = localStorage.getItem(STORAGE_CATEGORIES)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) {
        const limpias = list
          .filter((c) => c && typeof c.name === "string" && c.name.trim() !== "")
          .map((c) => ({
            name: String(c.name).trim(),
            emoji: String(c.emoji || CATEGORY_EMOJI),
          }))
        if (limpias.length) return limpias
      }
    }
  } catch {}
  return DEFAULT_CATEGORIES
}

function dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10)
}
function daysUntil(date: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = parseDate(date)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / 86400000)
}
function getStatus(days: number): Status {
  if (days < 0) return "overdue"
  if (days <= 7) return "urgent"
  if (days <= 30) return "upcoming"
  return "normal"
}
function formatDate(date: string) {
  return parseDate(date).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}
function formatStamp(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("es-CL", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
}
function formatDaysLabel(days: number) {
  if (days < 0) return `Vencido hace ${Math.abs(days)} días`
  if (days === 0) return "Vence hoy"
  if (days === 1) return "Vence mañana"
  if (days <= 30) return `Vence en ${days} días`
  const months = Math.floor(days / 30)
  if (months < 12)
    return `Vence en ${months === 1 ? "1 mes" : `${months} meses`}`
  return `Vence en ${Math.floor(months / 12)} años`
}
// Los recordatorios guardan la hora como "HH:MM" de 24 h; así se muestra según lo que se eligió en
// Ajustes: 22:30 con el formato de 24 h y 10:30 p.m. con el de 12 h.
function formatTime(time: string, clock12 = false) {
  const [hRaw, mRaw] = (time || "").split(":")
  const h = Number(hRaw)
  const m = Number(mRaw)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time
  if (!clock12) return `${pad2(h)}:${pad2(m)}`
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(m)} ${h < 12 ? "a.m." : "p.m."}`
}
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function recurrenceLabel(
  recurrence: string,
  interval?: number,
  unit?: Reminder["recurrenceUnit"],
) {
  if (recurrence !== "Personalizada") return recurrence
  if (!interval || !unit) return "Personalizada"
  const label =
    unit === "horas"
      ? interval === 1
        ? "hora"
        : "horas"
      : unit === "días"
        ? interval === 1
          ? "día"
          : "días"
        : unit === "semanas"
          ? interval === 1
            ? "semana"
            : "semanas"
          : unit === "meses"
            ? interval === 1
              ? "mes"
              : "meses"
            : interval === 1
              ? "año"
              : "años"
  return `Cada ${interval} ${label}`
}

// Próxima vuelta de un recordatorio que se repite. Devuelve fecha Y hora porque las repeticiones por
// horas (cada 8 horas, o una cantidad personalizada de horas) mueven el reloj, no el calendario: si el
// recordatorio vence a las 09:00 y se repite cada 8 horas, el siguiente es el mismo día a las 17:00.
// Vive en src/lib/repeticion.ts (junto con el calendario que usan los avisos con la app cerrada).
const STATUS_CONFIG: Record<Status, {
  bg: string
  bar: string
  badge: string
  label: string
  text: string
}> = {
  normal: {
    bg: "bg-stone-50 dark:bg-stone-800",
    bar: "bg-stone-300",
    badge: "bg-stone-100 dark:bg-stone-700 text-stone-500 dark:text-stone-300",
    label: "Normal",
    text: "text-stone-400",
  },
  upcoming: {
    bg: "bg-amber-50 dark:bg-amber-500/10",
    bar: "bg-amber-400",
    badge:
      "bg-amber-100 dark:bg-amber-500/25 text-amber-800 dark:text-amber-300",
    label: "Próximo",
    text: "text-amber-600 dark:text-amber-300",
  },
  urgent: {
    bg: "bg-red-50 dark:bg-red-500/10",
    bar: "bg-red-500",
    badge: "bg-red-100 dark:bg-red-500/25 text-red-700 dark:text-red-300",
    label: "Urgente",
    text: "text-red-600 dark:text-red-400",
  },
  overdue: {
    bg: "bg-stone-100/70 dark:bg-stone-800/70",
    bar: "bg-stone-500",
    badge: "bg-stone-200 dark:bg-stone-600 text-stone-600 dark:text-stone-300",
    label: "Vencido",
    text: "text-stone-500",
  },
}

const ATTACHMENT_DB = "avispate.attachments.v1"
// Nombre viejo de la base de adjuntos (la de RECUERDA). Lo guardado ahí no se pierde ni se copia en
// bloque al arrancar —son archivos, y eso sí bloquearía la app—: cada adjunto que se pide y no está en
// la base nueva se lee de la vieja y se copia en ese momento (copia perezosa, ver getAttachment).
const LEGACY_ATTACHMENT_DB = "recuerda.attachments.v1"
const ATTACHMENT_STORE = "files"

function openAttachmentDB(name = ATTACHMENT_DB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(ATTACHMENT_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function saveAttachment(id: string, file: Blob) {
  const db = await openAttachmentDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, "readwrite")
    tx.objectStore(ATTACHMENT_STORE).put(file, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
// Lee un adjunto de una base concreta y no falla nunca: si la base no está o el archivo no existe,
// devuelve null (para quien pregunta, "no lo tengo" y "no pude abrirlo" se resuelven igual).
async function readAttachment(dbName: string, id: string): Promise<Blob | null> {
  try {
    const db = await openAttachmentDB(dbName)
    const result = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(ATTACHMENT_STORE, "readonly")
      const req = tx.objectStore(ATTACHMENT_STORE).get(id)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}
async function getAttachment(id: string): Promise<Blob | null> {
  const propio = await readAttachment(ATTACHMENT_DB, id)
  if (propio) return propio
  // Copia perezosa de la base vieja: el adjunto se sirve igual y queda en la base nueva para la próxima
  // vez, así el renombre no deja ninguna foto ni nota de voz sin abrir.
  const viejo = await readAttachment(LEGACY_ATTACHMENT_DB, id)
  if (!viejo) return null
  await saveAttachment(id, viejo)
  return viejo
}
async function deleteAttachment(id: string) {
  try {
    const db = await openAttachmentDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ATTACHMENT_STORE, "readwrite")
      tx.objectStore(ATTACHMENT_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {}
}
// Copia de seguridad y adjuntos: un .json no puede llevar archivos, así que las fotos y notas de voz
// viajan como base64. Se convierte por trozos porque un `String.fromCharCode(...bytes)` de un audio de
// varios MB revienta la pila de llamadas.
async function blobABase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binario = ""
  const trozo = 0x8000
  for (let i = 0; i < bytes.length; i += trozo)
    binario += String.fromCharCode(...bytes.subarray(i, i + trozo))
  return btoa(binario)
}
function blobDesdeBase64(data: string, type: string): Blob {
  const binario = atob(data)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new Blob([bytes], { type: type || "application/octet-stream" })
}
// «1 recordatorio» / «3 recordatorios»: el resumen de la copia se lee como una frase.
function cuantos(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`
}
function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
function attachmentIcon(type: string) {
  if (type.startsWith("image/")) return "🖼️"
  if (type.startsWith("audio/")) return "🎧"
  return "📎"
}
// Tipos que acepta el selector de archivos del sistema (showOpenFilePicker): los mismos que el input
// de siempre —imágenes y documentos— pero declarados por tipo y extensión, como pide esa API.
const FILE_TYPES: Record<string, string[]> = {
  "image/*": [".png", ".jpg", ".jpeg", ".heic", ".webp", ".gif"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt", ".csv"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],
}
const ATTACH_ACCEPT =
  "image/*,.pdf,.doc,.docx,.txt,.rtf,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.csv"
// Icono de cada canal de aviso, en emoji. WhatsApp ya no está aquí: donde aparece su nombre se dibuja
// su logo real (WhatsAppG), el mismo del resto de la app, en vez del emoji de burbuja.
function channelIcon(channel: string) {
  if (channel === "Correo") return "✉️"
  if (channel === "Google Calendar") return "📅"
  return "🔔"
}
// El icono del canal listo para pintar dentro de un texto: WhatsApp con su logo real, los demás con su
// emoji. Se usa en los canales del formulario y en los del detalle del recordatorio.
function ChannelIcon({
  channel,
  className = "w-4 h-4",
}: {
  channel: string
  className?: string
}) {
  if (channel === "WhatsApp") return <WhatsAppG className={className} />
  return <span className="leading-none">{channelIcon(channel)}</span>
}

const SAMPLE_EVENTS: Reminder[] = [
  {
    id: "sample-1",
    ownerId: DEFAULT_PROFILE_ID,
    name: "Revisión técnica",
    date: "2026-09-22",
    time: "10:00",
    category: "Auto",
    categoryEmoji: "🚗",
    recurrence: "Cada año",
    remindersBefore: [30, 7, 1],
    channels: ["Notificación", "WhatsApp"],
  },
  {
    id: "sample-2",
    ownerId: DEFAULT_PROFILE_ID,
    name: "Batería control remoto",
    date: "2026-09-30",
    time: "12:00",
    category: "Auto",
    categoryEmoji: "🚗",
    recurrence: "Cada 2 años",
    remindersBefore: [7, 1],
    channels: ["Notificación"],
  },
  {
    id: "sample-3",
    ownerId: DEFAULT_PROFILE_ID,
    name: "Renovar licencia de conducir",
    date: "2026-10-15",
    time: "12:00",
    category: "Documentos",
    categoryEmoji: "📄",
    recurrence: "Cada 5 años",
    remindersBefore: [30, 7],
    channels: ["Notificación", "WhatsApp"],
  },
  {
    id: "sample-4",
    ownerId: DEFAULT_PROFILE_ID,
    name: "Seguro del auto",
    date: "2026-11-10",
    time: "12:00",
    category: "Finanzas",
    categoryEmoji: "💳",
    recurrence: "Cada año",
    remindersBefore: [30, 7, 1],
    channels: ["WhatsApp"],
  },
  {
    id: "sample-5",
    ownerId: DEFAULT_PROFILE_ID,
    name: "Renovar pasaporte",
    date: "2027-01-15",
    time: "12:00",
    category: "Documentos",
    categoryEmoji: "📄",
    recurrence: "Cada 10 años",
    remindersBefore: [90, 30, 7],
    channels: ["Notificación"],
  },
]

function loadEvents(): Reminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_EVENTS)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list))
        return (list as Reminder[]).map((e) => ({
          ...e,
          ownerId: e.ownerId || DEFAULT_PROFILE_ID,
        }))
    }
  } catch {}
  return SAMPLE_EVENTS
}

function normalizeProfile(p: unknown, i: number): Profile {
  const raw = (p ?? {}) as Partial<Profile>
  const profile: Profile = {
    id: String(raw.id ?? `p-${i}`),
    name: String(raw.name || "Usuario"),
    emoji: String(raw.emoji || DEFAULT_PROFILE.emoji),
  }
  // La foto viaja como data URL: si lo guardado no lo es, se descarta y queda el emoji.
  if (typeof raw.photo === "string" && raw.photo.startsWith("data:image/"))
    profile.photo = raw.photo
  if (raw.contact) profile.contact = normalizeContact(raw.contact)
  if (raw.channels) profile.channels = normalizeChannels(raw.channels)
  if (raw.gcal) profile.gcal = normalizeGcal(raw.gcal)
  if (raw.apple) profile.apple = normalizeCalendarApp(raw.apple)
  if (raw.outlook) profile.outlook = normalizeCalendarApp(raw.outlook)
  return profile
}

function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(STORAGE_PROFILES)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list) && list.length) return list.map(normalizeProfile)
    }
  } catch {}
  return [DEFAULT_PROFILE]
}

// Migración de las claves globales de la V1.5: antes el contacto y Google Calendar eran un solo
// dato para todo el dispositivo (recuerda.contacto.v1 / recuerda.gcal.v1). Ahora cada usuario tiene
// los suyos, así que lo que hubiera guardado se copia al usuario "yo" y las claves viejas se borran
// para que no queden dos fuentes de verdad. Si falla la escritura, no se borra nada y se reintenta.
function patchDefaultProfile(
  prev: Profile[],
  patch: Partial<Profile>,
): Profile[] {
  const i = prev.findIndex((p) => p.id === DEFAULT_PROFILE_ID)
  if (i === -1) return [{ ...DEFAULT_PROFILE, ...patch }, ...prev]
  return prev.map((p, index) => (index === i ? { ...p, ...patch } : p))
}

// Renombre RECUERDA → AVISPATE: las claves guardadas cambiaron de nombre, así que lo que hubiera en las
// viejas se copia a las nuevas una sola vez y la vieja se borra —solo después de comprobar que la copia
// quedó bien— para que nadie pierda sus recordatorios, usuarios ni categorías. Corre antes de la
// migración de la V1.5, que escribe en las claves nuevas (las suyas son históricas y no cambian).
function migrateRenamedKeys() {
  try {
    for (const [viejo, nuevo] of RENAMED_KEYS) {
      const guardado = localStorage.getItem(viejo)
      if (guardado === null) continue
      if (localStorage.getItem(nuevo) === null) {
        localStorage.setItem(nuevo, guardado)
        // Solo se borra la vieja si la copia quedó idéntica: si no (cuota llena, por ejemplo), se deja
        // para reintentarla en la próxima apertura en vez de perder el dato.
        if (localStorage.getItem(nuevo) !== guardado) continue
      }
      // Si la clave nueva ya tenía datos propios, mandan esos y la vieja es obsoleta: se borra igual,
      // para no dejar dos fuentes de verdad.
      localStorage.removeItem(viejo)
    }
    // Los avisos ya enviados son claves sueltas (avispate.sent.<recordatorio>:<aviso>:<fecha>), así que
    // se recogen primero por prefijo y recién después se renombran: borrar mientras se recorre mueve el
    // índice y dejaría claves sin pasar.
    const enviados: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i)
      if (clave && clave.startsWith(RENAMED_SENT_PREFIX)) enviados.push(clave)
    }
    for (const viejo of enviados) {
      const guardado = localStorage.getItem(viejo)
      if (guardado === null) continue
      localStorage.setItem(SENT_PREFIX + viejo.slice(RENAMED_SENT_PREFIX.length), guardado)
      localStorage.removeItem(viejo)
    }
  } catch {}
}

function migrateLegacyProfileSettings() {
  try {
    const legacyContact = localStorage.getItem(LEGACY_CONTACT)
    const legacyGcal = localStorage.getItem(LEGACY_GCAL)
    if (!legacyContact && !legacyGcal) return
    const profiles = loadProfiles()
    const base =
      profiles.find((p) => p.id === DEFAULT_PROFILE_ID) ?? DEFAULT_PROFILE
    const patch: Partial<Profile> = {}
    if (legacyContact && !base.contact)
      patch.contact = normalizeContact(JSON.parse(legacyContact))
    if (legacyGcal && !base.gcal)
      patch.gcal = normalizeGcal(JSON.parse(legacyGcal))
    if (Object.keys(patch).length)
      localStorage.setItem(
        STORAGE_PROFILES,
        JSON.stringify(patchDefaultProfile(profiles, patch)),
      )
    localStorage.removeItem(LEGACY_CONTACT)
    localStorage.removeItem(LEGACY_GCAL)
  } catch {}
}
// Se corren una vez al cargar el módulo, antes de que la app se dibuje: primero el renombre de las
// claves (RECUERDA → AVISPATE) y después la migración de la V1.5, para que Ajustes, Crear y el
// onboarding lean desde el primer render los datos ya repartidos por usuario.
migrateRenamedKeys()
migrateLegacyProfileSettings()
// Los avisos («30 días antes», «1 hora antes») viven en src/lib/avisos.ts: de ahí salen las mismas
// etiquetas y los mismos offsets que usa la cola de avisos con la app cerrada.
// ¿Ya toca avisar? Los avisos de días/semanas/meses se disparan el día calendario que
// corresponde; los de horas, al pasar la hora exacta (con 24 h de margen para no llegar tarde).
function alertDueAt(eventAt: Date, offsetDays: number, now: Date) {
  const target = new Date(eventAt.getTime() - offsetDays * 86400000)
  if (offsetDays < 1)
    return (
      now.getTime() >= target.getTime() &&
      now.getTime() - target.getTime() <= 86400000
    )
  const targetDay = new Date(target)
  targetDay.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return targetDay.getTime() === today.getTime()
}

// Logo de WhatsApp en SVG: los mismos trazos oficiales de la marca, en su verde, para no depender
// de imágenes externas ni del emoji de la burbuja.
function WhatsAppG({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </svg>
  )
}
// Logo de Google en SVG (los mismos trazos que usa Google), para no depender de imágenes externas.
function GoogleG({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}
// Logo de Apple Calendar en SVG: el trazo oficial de la marca, para el mismo uso que el de Google.
function AppleG({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#1D1D1F"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </svg>
  )
}
// Logo de Outlook en SVG: el trazo oficial de la marca, en su azul.
function OutlookG({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#0F6CBD"
        d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V10.85l1.24.72h.01q.1.07.18.18.07.12.07.25zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.03l2.41 1.5 1.34-.8v-2.73zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.19-.86.48-.55.73-1.28.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.3-1.2.85-.5.54-.75 1.3-.25.74-.25 1.63 0 .85.26 1.56.26.72.74 1.23.48.52 1.17.81.69.3 1.56.3zM7.5 21h12.39L12 16.08V17q0 .41-.3.7-.29.3-.7.3H7.5zm15-.13v-7.24l-5.9 3.54Z"
      />
    </svg>
  )
}

// Ícono de cámara de verdad (SVG, no emoji): es el botón que ofrece tomar o subir una foto para el
// usuario, y tiene que leerse como cámara incluso al lado de los emojis de la rejilla.
function CameraIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a1.6 1.6 0 0 0 1.34-.72l.6-.92A1.6 1.6 0 0 1 10.2 3.5h3.6a1.6 1.6 0 0 1 1.34.72l.6.92A1.6 1.6 0 0 0 17.08 6h1.42A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
      <circle cx="12" cy="12.4" r="3.4" />
    </svg>
  )
}

// (La avispa dibujada que ilustraba la tarjeta de Tips se fue con esa tarjeta: la mascota de AVISPATE
// sigue siendo la abeja del saludo «¡Avíspate!», que es un emoji, no un dibujo propio.)

// La cara de un usuario en la app: su foto si la tiene, si no su emoji. Se usa en el inicio, en las
// listas de usuarios y en Ajustes.
function Avatar({
  profile,
  className = "w-9 h-9 rounded-xl text-[18px]",
}: {
  profile: { name?: string ;emoji: string ;photo?: string }
  className?: string
}) {
  if (profile.photo)
    return (
      <img
        src={profile.photo}
        alt={`Foto de ${profile.name || "este usuario"}`}
        className={`${className} object-cover bg-amber-50 dark:bg-amber-500/20 flex-shrink-0`}
      />
    )
  return (
    <span
      aria-hidden="true"
      className={`${className} bg-amber-50 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0 leading-none`}
    >
      {profile.emoji}
    </span>
  )
}

// Insignias de un usuario de este dispositivo: su campana de notificaciones, sus canales de contacto
// (WhatsApp y correo) y sus tres calendarios. Cada una dice de quién es y si está encendida, con el mismo
// criterio con el que la app manda avisos (channelReady). Son seis y van en una sola línea: en la lista
// se dibujan chicas y sin envolver (`size="sm"`, `wrap={false}`), así el estado de un usuario se lee de un
// vistazo sin que la fila crezca a dos renglones.
type UserBadge = {
  key: string
  on: boolean
  label: string
  className: string
  node: React.ReactNode
}
const BADGE_OFF =
  "bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700 opacity-40 grayscale"
function userBadges(p: Profile): UserBadge[] {
  const push = channelReady(p, "Notificación")
  const wa = channelReady(p, "WhatsApp")
  const mail = channelReady(p, "Correo")
  const badges: UserBadge[] = [
    {
      key: "push",
      on: push,
      label: `${
        push ? "Notificaciones activadas" : "Notificaciones apagadas"
      } (${p.name})`,
      className: push
        ? "bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/40"
        : BADGE_OFF,
      node: <span className="text-[12px] leading-none">🔔</span>,
    },
    {
      key: "whatsapp",
      on: wa,
      label: `${
        wa ? "WhatsApp conectado" : "WhatsApp sin configurar"
      } (${p.name})`,
      className: wa
        ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/40"
        : BADGE_OFF,
      node: <WhatsAppG className="w-3.5 h-3.5" />,
    },
    {
      key: "correo",
      on: mail,
      label: `${
        mail ? "Correo conectado" : "Correo sin configurar"
      } (${p.name})`,
      className: mail
        ? "bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/40"
        : BADGE_OFF,
      node: <span className="text-[12px] leading-none">✉️</span>,
    },
  ]
  const cals = (["google", "apple", "outlook"] as CalendarApp[]).map((app) => {
    const state = calendarStateOf(p, app)
    const on = state.connected
    const label = `${CALENDAR_LABELS[app]} ${
      on ? "conectado" : "sin conectar"
    } (${p.name})${
      on
        ? calendarSyncsAll(state)
          ? " · Todos los avisos"
          : " · Solo los que eliges"
        : ""
    }`
    const logo =
      app === "google" ? (
        <GoogleG className="w-3.5 h-3.5" />
      ) : app === "apple" ? (
        <AppleG className="w-3.5 h-3.5" />
      ) : (
        <OutlookG className="w-3.5 h-3.5" />
      )
    return {
      key: app,
      on,
      label,
      className: on
        ? "bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700"
        : BADGE_OFF,
      node: logo,
    }
  })
  return [...badges, ...cals]
}
function ChannelBadges({
  profile,
  size = "md",
  wrap = true,
  className = "",
}: {
  profile: Profile
  size?: "sm" | "md"
  wrap?: boolean
  className?: string
}) {
  const box = size === "sm" ? "w-5 h-5 text-[10px]" : "w-6 h-6 text-[12px]"
  // `wrap={false}` deja las seis insignias en una sola línea (es lo que usan las dos listas de usuarios);
  // el `flex-wrap` de antes las mandaba a un segundo renglón en cuanto no entraban.
  const fila = wrap ? "flex-wrap gap-1.5" : "flex-nowrap gap-1"
  return (
    <div className={`flex items-center ${fila} ${className}`}>
      {userBadges(profile).map((b) => (
        <span
          key={b.key}
          role="img"
          title={b.label}
          aria-label={b.label}
          className={`${box} rounded-lg border flex items-center justify-center flex-shrink-0 ${b.className}`}
        >
          {b.node}
        </span>
      ))}
    </div>
  )
}

// El texto de «se programará» del detalle: con las repeticiones por horas también se mueve la hora, así
// que se muestran las dos cosas (fecha y hora del próximo vencimiento).
function nextOccurrenceLabel(event: Reminder, clock12: boolean) {
  const next = nextOccurrenceAt(
    event.date,
    event.time,
    event.recurrence,
    event.recurrenceInterval,
    event.recurrenceUnit,
  )
  return `${formatDate(next.date)} · ${formatTime(next.time, clock12)}`
}

// Fechas para Google Calendar y para el .ics: 20261110T120000 (hora local, sin zona horaria).
function gcalStart(date: string, time: string) {
  return `${date.replace(/-/g, "")}T${(time || "12:00").replace(":", "")}00`
}
function gcalEnd(date: string, time: string) {
  const d = parseDate(date, time)
  d.setHours(d.getHours() + 1)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`
}
// Repetición en formato RRULE: lo entienden tanto Google Calendar como el .ics. Las repeticiones de
// horas salen como FREQ=HOURLY y las de semanas o meses con su INTERVAL.
function rruleFor(event: Reminder) {
  const fixed: Record<string, string> = {
    "Cada 8 horas": "FREQ=HOURLY;INTERVAL=8",
    "Cada semana": "FREQ=WEEKLY",
    "Cada 2 semanas": "FREQ=WEEKLY;INTERVAL=2",
    "Cada mes": "FREQ=MONTHLY",
    "Cada 6 meses": "FREQ=MONTHLY;INTERVAL=6",
    "Cada año": "FREQ=YEARLY",
    "Cada 2 años": "FREQ=YEARLY;INTERVAL=2",
    "Cada 5 años": "FREQ=YEARLY;INTERVAL=5",
    "Cada 10 años": "FREQ=YEARLY;INTERVAL=10",
  }
  if (fixed[event.recurrence]) return fixed[event.recurrence]
  if (event.recurrence !== "Personalizada") return ""
  const unit =
    event.recurrenceUnit === "horas"
      ? "HOURLY"
      : event.recurrenceUnit === "días"
        ? "DAILY"
        : event.recurrenceUnit === "semanas"
          ? "WEEKLY"
          : event.recurrenceUnit === "meses"
            ? "MONTHLY"
            : "YEARLY"
  return `FREQ=${unit};INTERVAL=${Math.max(1, Math.floor(event.recurrenceInterval ?? 1))}`
}
// Cada aviso, en duración ISO 8601 para las alarmas del .ics: -P30D (días) o -PT7H (horas).
function alarmTrigger(offsetDays: number) {
  if (offsetDays < 1) return `-PT${Math.max(1, Math.round(offsetDays * 24))}H`
  return `-P${Math.round(offsetDays)}D`
}
function icsEscape(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
}
// Enlace que abre Google Calendar con el evento ya rellenado: solo hay que confirmar y guardar.
function googleCalendarUrl(event: Reminder) {
  const details = [event.notes, `Recordatorio de AVISPATE · ${event.category}`]
    .filter(Boolean)
    .join("\n")
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.name,
    dates: `${gcalStart(event.date, event.time)}/${gcalEnd(event.date, event.time)}`,
    details,
  })
  const rrule = rruleFor(event)
  if (rrule) params.set("recur", `RRULE:${rrule}`)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
// Al guardar desde el formulario: si el interruptor de un calendario está encendido el recordatorio
// queda marcado como enviado ahí, y si ya lo estaba conserva la fecha original.
function calendarStampFor(addTo: boolean, previous?: string) {
  if (!addTo) return previous
  return previous ?? new Date().toISOString()
}
// Un evento del .ics: el recordatorio con una alarma por cada aviso. Va aparte porque el mismo bloque
// se repite cuando el archivo lleva varios recordatorios (el de «Sincronizar ahora»).
function icsVeventLines(event: Reminder, stamp: string) {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@recuerda`,
    `DTSTAMP:${stamp}Z`,
    `DTSTART:${gcalStart(event.date, event.time)}`,
    `DTEND:${gcalEnd(event.date, event.time)}`,
    `SUMMARY:${icsEscape(event.name)}`,
    `CATEGORIES:${icsEscape(event.category)}`,
  ]
  if (event.notes) lines.push(`DESCRIPTION:${icsEscape(event.notes)}`)
  const rrule = rruleFor(event)
  if (rrule) lines.push(`RRULE:${rrule}`)
  ;[
    ...event.remindersBefore,
    ...(event.customReminders ?? []).map(alertToDays),
  ].forEach((offset) =>
    lines.push(
      "BEGIN:VALARM",
      `TRIGGER:${alarmTrigger(offset)}`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(event.name)}`,
      "END:VALARM",
    ),
  )
  lines.push("END:VEVENT")
  return lines
}
const ICS_HEAD = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//AVISPATE//Recordatorios//ES",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:AVISPATE",
]
function icsStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").split(".")[0]
}
// Archivo .ics de un recordatorio: así lo agregan Apple Calendar y Outlook.
function buildIcs(event: Reminder) {
  return [
    ...ICS_HEAD,
    ...icsVeventLines(event, icsStamp()),
    "END:VCALENDAR",
  ].join("\r\n")
}
// Archivo .ics con varios recordatorios: es el que descarga «Sincronizar ahora» para dejarlos todos
// de una sola vez en Apple Calendar o en Outlook.
function buildIcsForAll(events: Reminder[]) {
  const stamp = icsStamp()
  return [
    ...ICS_HEAD,
    ...events.flatMap((event) => icsVeventLines(event, stamp)),
    "END:VCALENDAR",
  ].join("\r\n")
}
function icsFileName(text: string, fallback: string) {
  return `${
    text
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 40) || fallback
  }.ics`
}
// Descarga de un archivo de texto (el .ics de un recordatorio o la copia de seguridad). Si el
// navegador no sabe armar archivos (o los bloquea) la app sigue igual: lo único que se pierde es la
// descarga, nunca el guardado.
function downloadTextFile(content: string, fileName: string, type: string) {
  try {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {}
}
function downloadIcsText(content: string, fileName: string) {
  downloadTextFile(content, fileName, "text/calendar;charset=utf-8")
}
function downloadIcs(event: Reminder) {
  downloadIcsText(buildIcs(event), icsFileName(event.name, "recordatorio"))
}
function downloadIcsForAll(events: Reminder[], ownerName: string) {
  downloadIcsText(
    buildIcsForAll(events),
    icsFileName(`recuerda-${ownerName}`, "recuerda"),
  )
}
// Fechas para Outlook: 2026-11-10T12:00:00, hora local y sin zona, como las del .ics.
function outlookStamp(date: string, time: string) {
  return `${date}T${(time || "12:00").slice(0, 5)}:00`
}
function outlookEnd(date: string, time: string) {
  const d = parseDate(date, time)
  d.setHours(d.getHours() + 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`
}
// Enlace que abre Outlook con el evento ya rellenado: los mismos parámetros que usa su propio botón
// «Agregar al calendario» (path, rru, subject, startdt, enddt, body, allday).
function outlookCalendarUrl(event: Reminder) {
  const body = [event.notes, `Recordatorio de AVISPATE · ${event.category}`]
    .filter(Boolean)
    .join("\n")
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.name,
    startdt: outlookStamp(event.date, event.time),
    enddt: outlookEnd(event.date, event.time),
    body,
    allday: "false",
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

// Google Calendar por usuario. syncAll: opción "Todos los avisos" de ese usuario; cuando está
// activada (o no se ha tocado nunca) los recordatorios nuevos se crean con Google Calendar ya
// marcado, y si se apaga se crean sin marcar y cada recordatorio se enciende a mano.
interface GcalState {
  connected: boolean
  lastSync?: string
  lastCount?: number
  syncAll?: boolean
}
const DEFAULT_GCAL: GcalState = { connected: false }
function normalizeGcal(v: unknown): GcalState {
  const s = v as GcalState | null | undefined
  return {
    connected: !!s?.connected,
    lastSync: s?.lastSync ? String(s.lastSync) : undefined,
    lastCount: typeof s?.lastCount === "number" ? s.lastCount : undefined,
    syncAll: typeof s?.syncAll === "boolean" ? s.syncAll : undefined,
  }
}

// Apple Calendar y Outlook: los otros dos calendarios de esta entrega. En el navegador no hay una
// cuenta que conectar, así que Apple Calendar se llena con el archivo .ics (el iPhone y el Mac lo
// abren con la app Calendario) y Outlook con su enlace web, que abre el evento ya rellenado. Cada
// usuario del dispositivo tiene su propio estado y su propio «Todos los avisos», igual que con Google.
type CalendarApp = "google" | "apple" | "outlook"
interface CalendarAppState {
  connected: boolean
  syncAll?: boolean
  lastSync?: string
  lastCount?: number
}
const CALENDAR_LABELS: Record<CalendarApp, string> = {
  google: "Google Calendar",
  apple: "Apple Calendar",
  outlook: "Outlook",
}
// Campo del recordatorio donde queda la fecha en que se mandó a ese calendario.
const CALENDAR_FIELDS: Record<CalendarApp, "gcalAddedAt" | "appleAddedAt" | "outlookAddedAt"> =
  { google: "gcalAddedAt", apple: "appleAddedAt", outlook: "outlookAddedAt" }
function normalizeCalendarApp(v: unknown): CalendarAppState {
  const s = v as CalendarAppState | null | undefined
  return {
    connected: !!s?.connected,
    syncAll: typeof s?.syncAll === "boolean" ? s.syncAll : undefined,
    lastSync: s?.lastSync ? String(s.lastSync) : undefined,
    lastCount: typeof s?.lastCount === "number" ? s.lastCount : undefined,
  }
}
function calendarStateOf(profile: Profile, app: CalendarApp): CalendarAppState {
  const state =
    app === "google"
      ? profile.gcal
      : app === "apple"
        ? profile.apple
        : profile.outlook
  return {
    connected: !!state?.connected,
    syncAll: state?.syncAll,
    lastSync: state?.lastSync,
    lastCount: state?.lastCount,
  }
}
// «Todos los avisos»: cuando está activado (o no se ha tocado nunca) los recordatorios nuevos de ese
// usuario vienen con el calendario ya marcado; si se apaga, se crean sin marcar.
function calendarSyncsAll(state: CalendarAppState) {
  return state.syncAll !== false
}
function calendarPatch(
  app: CalendarApp,
  state: CalendarAppState,
): Partial<Profile> {
  if (app === "google") return { gcal: state }
  return app === "apple" ? { apple: state } : { outlook: state }
}

// Contacto de un usuario: número de WhatsApp, correo y el "ticket" (accepted) con el que confirma que
// esos datos son suyos. En esta V1.5 se queda en el dispositivo y los avisos por WhatsApp y correo
// todavía se simulan (el envío real llega con el backend).
type Contact = { phone: string ;email: string ;accepted?: boolean }
function normalizeContact(v: unknown): Contact {
  const s = v as Contact | null | undefined
  const contact: Contact = {
    phone: typeof s?.phone === "string" ? s.phone : "",
    email: typeof s?.email === "string" ? s.email : "",
  }
  // Solo se guarda si venía con un valor: los contactos anteriores al ticket quedan sin la marca y se
  // toman como confirmados, para no cambiarle la vida a quien ya tenía sus canales funcionando.
  if (typeof s?.accepted === "boolean") contact.accepted = s.accepted
  return contact
}

// Canales activados por usuario en Ajustes. WhatsApp y correo, además del interruptor, necesitan
// sus datos: sin número o sin correo el canal no está listo.
type ChannelPrefs = { push: boolean ;whatsapp: boolean ;email: boolean }
const DEFAULT_CHANNEL_PREFS: ChannelPrefs = {
  push: true,
  whatsapp: true,
  email: false,
}
function normalizeChannels(v: unknown): ChannelPrefs {
  const s = v as ChannelPrefs | null | undefined
  return {
    push: typeof s?.push === "boolean" ? s.push : DEFAULT_CHANNEL_PREFS.push,
    whatsapp:
      typeof s?.whatsapp === "boolean"
        ? s.whatsapp
        : DEFAULT_CHANNEL_PREFS.whatsapp,
    email:
      typeof s?.email === "boolean" ? s.email : DEFAULT_CHANNEL_PREFS.email,
  }
}
// ¿El usuario ya confirmó sus datos de contacto (el "ticket" de Ajustes › Contacto)? Solo queda en
// pausa si lo destildó o si acaba de escribir un dato nuevo que todavía no confirmó (accepted: false).
function contactConfirmed(profile: Profile) {
  return profile.contact?.accepted !== false
}
// ¿Este usuario puede recibir avisos por ese canal? La notificación depende del interruptor del
// navegador; WhatsApp y correo necesitan que el usuario haya dejado sus datos y los haya confirmado.
function channelReady(profile: Profile, channel: string) {
  const prefs = profile.channels ?? DEFAULT_CHANNEL_PREFS
  if (channel === "WhatsApp")
    return (
      prefs.whatsapp &&
      !!profile.contact?.phone.trim() &&
      contactConfirmed(profile)
    )
  if (channel === "Correo")
    return (
      prefs.email &&
      !!profile.contact?.email.trim() &&
      contactConfirmed(profile)
    )
  return prefs.push
}
// Canales del recordatorio que su dueño puede recibir de verdad. Si no tiene ninguno listo queda
// la notificación del navegador; si ni eso (apagó las notificaciones), no hay nada que enviar.
function deliveryChannels(event: Reminder, owner: Profile) {
  const ready = event.channels.filter((c) => channelReady(owner, c))
  if (ready.length) return ready
  return channelReady(owner, "Notificación") ? ["Notificación"] : []
}
function timeAgo(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return "hace un momento"
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} ${days === 1 ? "día" : "días"}`
}

// Ilustración del onboarding: el mismo recordatorio cae en los tres calendarios —Google, Apple y
// Outlook—, cada uno con su logo real y su visto bueno, para mostrar que la sincronización no es de
// uno solo. Todo con CSS: el recordatorio entra, de él bajan tres líneas punteadas —una hacia cada
// calendario— y los tres calendarios llegan uno detrás del otro con su ✓ al final.
function CalendarsScene() {
  const targets: {
    key: string
    label: string
    logo: React.ReactNode
    accent: string
    delay: string
  }[] = [
    {
      key: "google",
      label: "Google",
      logo: <GoogleG className="w-3 h-3" />,
      accent: "#4285F4",
      delay: "460ms",
    },
    {
      key: "apple",
      label: "Apple",
      logo: <AppleG className="w-3 h-3" />,
      accent: "#1D1D1F",
      delay: "640ms",
    },
    {
      key: "outlook",
      label: "Outlook",
      logo: <OutlookG className="w-3 h-3" />,
      accent: "#0F6CBD",
      delay: "820ms",
    },
  ]
  return (
    <div className="animate-slide-in [animation-delay:280ms] mt-5 flex flex-col items-center">
      <div className="animate-pop-in [animation-delay:200ms] w-[152px] rounded-2xl bg-white/15 border border-white/25 px-2.5 py-2 text-left">
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-white/60">
          Recordatorio
        </p>
        <p className="text-[11px] font-extrabold leading-tight">
          Cambio de aceite
        </p>
        <p className="text-[10px] font-semibold text-white/70">en 7 días</p>
      </div>
      {/* Del recordatorio salen tres líneas punteadas —una por calendario— y cada una se mueve hacia el
        suyo. La fila de abajo mide 234 px (tres tarjetas de 74 px y dos separaciones de 6 px), así que
        las líneas arrancan del centro (117) y terminan en el centro de cada tarjeta: 37, 117 y 197. */}
      <svg
        viewBox="0 0 234 24"
        className="w-[234px] h-6 text-white/70"
        aria-hidden="true"
      >
        <path
          d="M117 0V6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {[37, 117, 197].map((x, i) => (
          <path
            key={x}
            d={`M117 6L${x} 23`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="3 5"
            className="animate-gcal-dash"
            style={{ animationDelay: `${300 + i * 120}ms` }}
          />
        ))}
      </svg>
      <div className="flex items-start gap-1.5">
        {targets.map((t) => (
          <div
            key={t.key}
            className="animate-pop-in relative w-[74px] rounded-2xl bg-white shadow-lg shadow-black/20 px-2 py-2"
            style={{ animationDelay: t.delay }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[7px] font-bold tracking-widest text-stone-400">
                NOV
              </span>
              {t.logo}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-[2px]">
              {Array.from({ length: 14 }).map((_, i) => (
                <span
                  key={i}
                  className="h-[4px] rounded-[1.5px]"
                  style={{ backgroundColor: i === 4 ? t.accent : "#E7E5E4" }}
                />
              ))}
            </div>
            <p className="mt-1 text-[8px] font-extrabold text-stone-600">
              {t.label}
            </p>
            <span
              className="animate-pop-in absolute -right-1.5 -bottom-1.5 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center shadow"
              style={{ animationDelay: `calc(${t.delay} + 180ms)` }}
            >
              ✓
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Ilustración del onboarding: dos menús desplegables demuestran que el tiempo de
// anticipación se puede cambiar. El primero pasa de 6 a 7; el segundo recorre
// horas, días, semanas y meses. Todo con CSS: cada columna se desplaza una fila
// (18px) por vez y el contenedor recorta lo que queda fuera. La última fila de cada
// columna repite la primera para que el bucle cierre sin salto visible.
function AlertPickerScene() {
  const caret = (
    <svg
      viewBox="0 0 10 6"
      className="animate-caret w-2.5 h-1.5 shrink-0"
      aria-hidden="true"
    >
      <path
        d="M1 1l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
  return (
    <div className="animate-slide-in [animation-delay:260ms] mt-5 w-full max-w-[252px]">
      <div className="animate-pop-in [animation-delay:340ms] rounded-3xl bg-white px-4 py-3 text-left shadow-lg shadow-black/20">
        <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-stone-400">
          ¿Cuándo te aviso?
        </p>
        <div className="mt-2 flex items-center gap-2">
          {/* Menú 1: hace cuánto avisar. La fila final (6) cierra el bucle. */}
          <span className="flex items-center gap-1 rounded-xl bg-amber-50 border border-amber-300 text-amber-600 px-2.5 py-1">
            <span className="block h-[18px] overflow-hidden">
              <span className="animate-alert-num block">
                <span className="block h-[18px] text-[15px] font-extrabold leading-[18px] text-amber-600">
                  6
                </span>
                <span className="block h-[18px] text-[15px] font-extrabold leading-[18px] text-amber-800">
                  7
                </span>
                <span className="block h-[18px] text-[15px] font-extrabold leading-[18px] text-amber-600">
                  6
                </span>
              </span>
            </span>
            {caret}
          </span>
          {/* Menú 2: en qué unidad. La fila final (horas) cierra el bucle. */}
          <span className="flex items-center gap-1 rounded-xl bg-stone-50 border border-stone-300 text-stone-500 px-2.5 py-1">
            <span className="block h-[18px] overflow-hidden">
              <span className="animate-alert-unit block">
                {["horas", "días", "semanas", "meses", "horas"].map((u, i) => (
                  <span
                    key={`${u}-${i}`}
                    className="block h-[18px] text-[15px] font-extrabold leading-[18px] text-stone-700"
                  >
                    {u}
                  </span>
                ))}
              </span>
            </span>
            {caret}
          </span>
          <span className="text-[11px] font-bold text-stone-400">antes</span>
        </div>
      </div>
    </div>
  )
}

// Ilustración del onboarding: todo lo que se le puede sumar a un recordatorio. La
// categoría va arriba, y debajo entran uno por uno los adjuntos (nota, audio, documento y
// foto). Los chips ya colocados se mecen en cadena para que se entienda que se van
// acumulando dentro del mismo aviso.
function AttachScene() {
  const files = [
    { emoji: "📝", label: "Nota", delay: "420ms" },
    { emoji: "🎧", label: "Audio", delay: "540ms" },
    { emoji: "📄", label: "Documento", delay: "660ms" },
    { emoji: "🖼️", label: "Foto", delay: "780ms" },
  ]
  return (
    <div className="animate-slide-in [animation-delay:240ms] mt-5 w-full max-w-[268px]">
      <div className="animate-pop-in [animation-delay:320ms] rounded-3xl bg-white px-4 py-3 text-left shadow-lg shadow-black/20">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[9px] font-bold text-amber-700">
            🚗 Auto
          </span>
          <span className="ml-auto text-[9px] font-semibold text-stone-400">
            en 7 días
          </span>
        </div>
        <p className="mt-2 text-[13px] font-extrabold leading-tight text-stone-800">
          Cambio de aceite
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {files.map((f, i) => (
            <span
              key={f.label}
              className="animate-pop-in inline-flex"
              style={{ animationDelay: f.delay }}
            >
              <span
                className="animate-attach-wave flex items-center gap-1 px-2 py-1 rounded-xl bg-stone-50 border border-stone-200 text-[10px] font-bold text-stone-600"
                style={{ animationDelay: `${i * 180}ms` }}
              >
                {f.emoji} {f.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// Ilustración del onboarding: usuarios locales (yo, abuela, empresa…). Cada uno tiene
// sus propios recordatorios y elige sus propios canales de aviso.
function ProfilesScene() {
  const users = [
    { emoji: "🐝", name: "Yo", count: "5 recordatorios", delay: "160ms" },
    { emoji: "👵", name: "Abuela", count: "3 recordatorios", delay: "380ms" },
    { emoji: "🏢", name: "Empresa", count: "8 recordatorios", delay: "600ms" },
  ]
  // Cada usuario tiene sus canales: el logo real de WhatsApp (y el de Google) en vez de emojis.
  const channels: {
    label: string
    emoji?: string
    google?: boolean
    whatsapp?: boolean
  }[] = [
    { label: "Correo", emoji: "✉️" },
    { label: "WhatsApp", whatsapp: true },
    { label: "Calendario", google: true },
  ]
  return (
    <div className="animate-slide-in [animation-delay:240ms] mt-5 mb-3 w-full max-w-[262px] flex flex-col gap-2">
      {users.map((u) => (
        <div
          key={u.name}
          className="animate-pop-in rounded-2xl bg-white/15 border border-white/25 px-3 py-2 text-left"
          style={{ animationDelay: u.delay }}
        >
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-[13px] flex-shrink-0">
              {u.emoji}
            </span>
            <span className="text-[12px] font-extrabold truncate">
              {u.name}
            </span>
            <span className="ml-auto text-[9px] font-semibold text-white/70 whitespace-nowrap">
              {u.count}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {channels.map((c) => (
              <span
                key={c.label}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap ${
                  c.google
                    ? "bg-white text-stone-500"
                    : "bg-white/20 text-white/90 border border-white/25"
                }`}
              >
                {c.google ? (
                  <GoogleG className="w-2.5 h-2.5" />
                ) : c.whatsapp ? (
                  <WhatsAppG className="w-3 h-3" />
                ) : (
                  <span className="leading-none">{c.emoji}</span>
                )}
                {c.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function loadClock12(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_CLOCK)
    if (saved === "12") return true
    if (saved === "24") return false
  } catch {}
  return (
    typeof Intl !== "undefined" &&
    !!Intl.DateTimeFormat().resolvedOptions().hour12
  )
}
function saveClock12(clock12: boolean) {
  try {
    localStorage.setItem(STORAGE_CLOCK, clock12 ? "12" : "24")
  } catch {}
}

function loadNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_NOTIFICATIONS)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list))
        return (list as AppNotification[]).map((n) => ({
          ...n,
          ownerId: n.ownerId || DEFAULT_PROFILE_ID,
        }))
    }
  } catch {}
  return []
}

function StatusBadge({ status }: { status: Status }) {
  const c = STATUS_CONFIG[status]
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${c.badge}`}
    >
      {c.label}
    </span>
  )
}

function EventCard({
  event,
  onClick,
  clock12 = false,
}: {
  event: Reminder
  onClick: () => void
  clock12?: boolean
}) {
  const status = getStatus(daysUntil(event.date))
  const c = STATUS_CONFIG[status]
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-stretch rounded-2xl overflow-hidden shadow-sm border border-white/80 dark:border-white/10 text-left mb-3 transition-transform active:scale-[0.98] ${c.bg}`}
    >
      <div className={`w-1 flex-shrink-0 ${c.bar}`} />
      <div className="flex-1 min-w-0 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <span className="text-xl flex-shrink-0">{event.categoryEmoji}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[15px] text-stone-900 dark:text-stone-50 leading-snug line-clamp-2 break-words">
                {event.name}
                {event.gcalAddedAt && (
                  <span className="inline-flex items-center gap-1 align-middle ml-1.5 px-1.5 py-[1px] rounded-full bg-white/80 dark:bg-stone-800 border border-stone-200/70 dark:border-stone-700">
                    <GoogleG className="w-2.5 h-2.5" />
                    <span className="text-[9px] font-bold text-stone-500 dark:text-stone-400">
                      Calendario
                    </span>
                  </span>
                )}
              </p>
              <p className="text-[12px] text-stone-400 mt-1">
                {formatDate(event.date)}
                {event.time && ` · ${formatTime(event.time, clock12)}`}
              </p>
            </div>
          </div>
          <div className="flex-shrink-0 pt-0.5">
            <StatusBadge status={status} />
          </div>
        </div>
        <p className={`text-[13px] font-medium mt-2 ${c.text}`}>
          {formatDaysLabel(daysUntil(event.date))}
        </p>
      </div>
    </button>
  )
}

function BottomNav({
  tab,
  onTab,
  onAdd,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  onAdd: () => void
}) {
  const tabs: { id: Tab ;label: string ;icon: string }[] = [
    { id: "home", label: "Inicio", icon: "⌂" },
    { id: "calendar", label: "Calendario", icon: "▦" },
    { id: "notifications", label: "Historial", icon: "✓" },
    { id: "settings", label: "Ajustes", icon: "⚙" },
  ]
  return (
    <div className="relative flex items-center bg-white dark:bg-stone-900 border-t border-stone-100 dark:border-stone-800 pb-safe">
      {tabs.slice(0, 2).map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id)}
          className={`flex-1 flex flex-col items-center py-3 gap-0.5 ${
            tab === t.id
              ? "text-amber-600 dark:text-amber-300"
              : "text-stone-400"
          }`}
        >
          <span className="text-lg leading-none">{t.icon}</span>
          <span className="text-[10px] font-semibold">{t.label}</span>
        </button>
      ))}
      <button
        aria-label="Nuevo recordatorio"
        onClick={onAdd}
        className="absolute left-1/2 -translate-x-1/2 -top-5 w-14 h-14 rounded-full bg-amber-600 text-white shadow-lg shadow-amber-200 flex items-center justify-center active:scale-95"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="w-7 h-7"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <div className="w-14 flex-shrink-0" />
      {tabs.slice(2).map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id)}
          className={`flex-1 flex flex-col items-center py-3 gap-0.5 ${
            tab === t.id
              ? "text-amber-600 dark:text-amber-300"
              : "text-stone-400"
          }`}
        >
          <span className="text-lg leading-none">{t.icon}</span>
          <span className="text-[10px] font-semibold">{t.label}</span>
        </button>
      ))}
    </div>
  )
}
function Header({
  title,
  onBack,
  right,
}: {
  title?: string
  onBack?: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between px-5 pt-12 pb-3">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
          >
            ←
          </button>
        )}
        {title && (
          <h1 className="font-bold text-[18px] text-stone-900 dark:text-stone-50">
            {title}
          </h1>
        )}
      </div>
      {right}
    </div>
  )
}

// Hoja a pantalla completa para elegir entre todos los emojis: la abre el botón «+» del selector y se
// usa igual en las tres altas (el onboarding, «＋ Nuevo usuario» y Mi perfil › Editar). Es una hoja —y no
// un despliegue dentro del formulario— porque la lista es larga y el formulario puede vivir dentro de un
// desplegable angosto (el de Inicio deja 254 px útiles): ahí la lista quedaba recortada por el borde de
// la pantalla y sin scroll para llegar al final. Acá el único scroll es el de la lista, y las pestañas de
// tema envuelven en dos filas cuando el ancho no da (antes iban en una fila con scroll horizontal).
function EmojiSheet({
  name,
  value,
  onPick,
  onClose,
}: {
  name: string
  value: string
  onPick: (emoji: string) => void
  onClose: () => void
}) {
  // El tema de la lista: arranca en «Caras», que es donde están las que más se usan.
  const [tema, setTema] = useState(0)
  return enMarco(
    <div className="absolute inset-0 z-[60] bg-black/60 flex items-center justify-center p-5">
      {/* Tocar fuera cierra sin cambiar la cara. */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="min-w-0 truncate font-bold text-stone-800 dark:text-stone-100">
            Emoji para {name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Cerrar la lista de emojis de ${name}`}
            className="w-8 h-8 rounded-full text-stone-400 text-xl flex-shrink-0"
          >
            ×
          </button>
        </div>
        {/* Los temas, como en el teclado del teléfono: se toca uno y cambia la lista de abajo. */}
        <div
          role="tablist"
          aria-label={`Temas de emojis para ${name}`}
          className="flex flex-wrap gap-1"
        >
          {EMOJI_GROUPS.map((g, i) => (
            <button
              key={g.name}
              type="button"
              role="tab"
              aria-selected={i === tema}
              aria-label={`Emojis de ${g.name} para ${name}`}
              onClick={() => setTema(i)}
              className={`w-8 h-8 rounded-xl text-[17px] leading-none flex items-center justify-center border ${
                i === tema
                  ? "bg-amber-50 dark:bg-amber-500/25 border-amber-400"
                  : "bg-white dark:bg-stone-900 border-stone-100 dark:border-stone-800 opacity-70"
              }`}
            >
              {g.tab}
            </button>
          ))}
        </div>
        {/* La lista del tema elegido: es el único scroll de la hoja. Al tocar un emoji se elige y la hoja
            se cierra, para ver la cara nueva en el formulario. */}
        <div
          aria-label={`Emojis de ${EMOJI_GROUPS[tema].name}`}
          className="flex flex-wrap gap-1 max-h-[46vh] overflow-y-auto overscroll-contain mt-2"
        >
          {EMOJI_GROUPS[tema].emojis.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onPick(e)
                onClose()
              }}
              aria-label={`Emoji ${e} para ${name}`}
              className={`w-9 h-9 rounded-xl text-[19px] leading-none flex items-center justify-center ${
                value === e
                  ? "bg-amber-50 dark:bg-amber-500/25 ring-2 ring-amber-200 dark:ring-amber-500/40"
                  : "bg-stone-50 dark:bg-stone-800/60"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-3 py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[14px] font-bold"
        >
          Listo
        </button>
      </div>
    </div>,
  )
}

// Selector de emoji del usuario: el mismo en el onboarding, al crear un usuario desde Inicio y al
// editar Mi perfil, para que cambiar de cara se haga igual en los tres lugares. Cada botón dice a quién
// le cambia el emoji, así se puede tocar y probar sin adivinar de quién es cada uno.
// Primero van los once de siempre y, al final, el botón «+»: abre la lista completa —por temas, como el
// teclado del teléfono— en una hoja a pantalla completa, y al elegir uno la cara cambia y la hoja se
// cierra. Si la cara en uso no es de los once, el botón la muestra dentro, así se ve de dónde salió.
// Con `presets={false}` —lo que usan las categorías— no hay rejilla de once: queda **solo el botón «+»**,
// que siempre dice «+» (no el emoji elegido) porque su único trabajo es abrir la lista para cambiar el
// emoji; el emoji en uso se muestra aparte, junto al título.
function EmojiPicker({
  value,
  onChange,
  name,
  size = "md",
  className = "",
  presets = true,
}: {
  value: string
  onChange: (emoji: string) => void
  name: string
  size?: "sm" | "md"
  className?: string
  presets?: boolean
}) {
  const box =
    size === "sm"
      ? "w-9 h-9 rounded-xl text-[18px]"
      : "w-11 h-11 rounded-2xl text-[22px]"
  const [open, setOpen] = useState(false)
  const preset = PROFILE_EMOJIS.includes(value)
  // Con la rejilla, el botón muestra la cara propia si no es de los once; sin rejilla, siempre «+».
  const muestraEmoji = presets && !preset
  return (
    <div className="flex flex-col items-start gap-2">
      <div
        role="group"
        aria-label={`Emoji de ${name}`}
        className={`flex flex-wrap gap-2 ${className}`}
      >
        {presets &&
          PROFILE_EMOJIS.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => onChange(x)}
              aria-pressed={value === x}
              aria-label={`Emoji ${x} para ${name}`}
              className={`${box} flex items-center justify-center border transition-colors ${
                value === x
                  ? "bg-amber-50 dark:bg-amber-500/25 border-amber-400 ring-2 ring-amber-200 dark:ring-amber-500/40"
                  : "bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700"
              }`}
            >
              {x}
            </button>
          ))}
        {/* El botón «+» (o la cara propia, si no es de los once): abre la lista completa de emojis. El
            borde punteado queda marcado cuando la cara en uso no es de la rejilla, así se entiende de
            dónde salió. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-pressed={!presets || !preset}
          aria-expanded={open}
          aria-label={`Ver todos los emojis para ${name}`}
          className={`${box} relative flex items-center justify-center border border-dashed transition-colors ${
            !presets || !preset
              ? "bg-amber-50 dark:bg-amber-500/25 border-amber-400 ring-2 ring-amber-200 dark:ring-amber-500/40"
              : "bg-white dark:bg-stone-900 border-stone-300 dark:border-stone-600 text-stone-400 dark:text-stone-500"
          }`}
        >
          {muestraEmoji ? (
            value
          ) : (
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center text-[20px] font-bold leading-none"
            >
              +
            </span>
          )}
        </button>
      </div>
      {open && (
        <EmojiSheet
          name={name}
          value={value}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

// Extensión de país + número de WhatsApp: el "+56" (Chile, por defecto) se elige de la lista y el
// número se escribe aparte. Se guarda junto ("+56 9 1234 5678") para que todos los lugares que ya leen
// el contacto —el ticket, los avisos, lo guardado antes— sigan funcionando igual.
// El cuadro de la extensión quedó chico y con la bandera sola: el nombre del país no se gasta en la
// pantalla (se lee al abrir la lista o al pasar el dedo por el cuadro) y el número tiene todo el ancho
// para verse completo, que es lo que de verdad hay que leer ahí.
function PhoneField({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [country, setCountry] = useState(() => splitPhone(value).country)
  const lastValue = useRef(value)
  const local = splitPhone(value).local
  // El número puede cambiar desde afuera (se cambió de usuario activo): la extensión se vuelve a leer
  // del número, así los dos campos siempre cuentan la misma historia.
  useEffect(() => {
    if (lastValue.current === value) return
    lastValue.current = value
    setCountry(splitPhone(value).country)
  }, [value])
  // Elegir país con el número todavía vacío no debe inventar un número guardado (el contacto seguiría
  // "sin número"): la extensión se recuerda acá y se junta recién cuando hay algo escrito.
  const pickCountry = (code: string) => {
    setCountry(code)
    if (!local) return
    const next = joinPhone(code, local)
    lastValue.current = next
    onChange(next)
  }
  const typeNumber = (raw: string) => {
    const next = joinPhone(country, raw)
    lastValue.current = next
    onChange(next)
  }
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      {/* La extensión: un cuadro chico con la bandera. La flechita es la nuestra (aparece-none) para que
        el cuadro pueda ser estrecho sin que el navegador le meta su propio espacio. */}
      <span className="relative flex-shrink-0">
        <select
          aria-label="Extensión de país"
          title={`${countryOf(country).flag} ${country} ${countryOf(country).name}`}
          value={country}
          disabled={disabled}
          onChange={(e) => pickCountry(e.target.value)}
          className="appearance-none w-[62px] pl-2 pr-5 py-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-[19px] font-semibold text-stone-700 dark:text-stone-200 outline-none focus:border-amber-400"
        >
          {COUNTRY_CODES.map((c) => (
            <option
              key={c.name}
              value={c.code}
              title={`${c.flag} ${c.code} ${c.name}`}
            >
              {c.flag}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 10 6"
          aria-hidden="true"
          className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-1.5 text-stone-400"
        >
          <path
            d="M1 1l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={local}
        maxLength={16}
        disabled={disabled}
        onChange={(e) => typeNumber(e.target.value)}
        placeholder="9 1234 5678"
        className="flex-1 min-w-0 px-4 py-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-[16px] font-semibold text-stone-800 dark:text-stone-100 placeholder:text-stone-300 dark:placeholder:text-stone-600 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
      />
    </div>
  )
}

// La foto del usuario se reduce antes de guardarla: 256×256 recortado al centro y en JPEG. Así una
// foto de cámara de varios MB queda en unos pocos KB y cabe sin problema en el almacenamiento del
// navegador (que es donde viven los usuarios de este dispositivo).
function readAvatarFile(file: File): Promise<string> {
  return new Promise((resolve) => {
    let listo = false
    let timer = 0
    // Se resuelve una sola vez: la primera respuesta gana (la imagen recortada, la original si el
    // navegador no la puede leer, o el respaldo por tiempo de abajo).
    const entregar = (value: string) => {
      if (listo) return
      listo = true
      if (timer) window.clearTimeout(timer)
      resolve(value)
    }
    const reader = new FileReader()
    reader.onerror = () => entregar("")
    reader.onload = () => {
      const original = String(reader.result || "")
      if (!original) return entregar("")
      // Si el navegador no termina de cargar la imagen (raro, pero pasa en algunos webviews), se guarda
      // tal cual llegó: la foto es de la persona y tiene que entrar igual.
      timer = window.setTimeout(() => entregar(original), 900)
      const img = new Image()
      img.onerror = () => entregar(original)
      img.onload = () => {
        try {
          const size = 256
          const canvas = document.createElement("canvas")
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext("2d")
          if (!ctx) return entregar(original)
          const scale = Math.max(size / img.width, size / img.height)
          const w = img.width * scale,
            h = img.height * scale
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
          entregar(canvas.toDataURL("image/jpeg", 0.85))
        } catch {
          entregar(original)
        }
      }
      img.src = original
    }
    reader.readAsDataURL(file)
  })
}

// Sacar o subir la foto del usuario: se abre la cámara del dispositivo (la delantera, que es la que
// sirve para una cara) y, si no hay cámara o no dan permiso, queda el botón «Subir una foto» para
// elegirla de la galería. Entre los dos siempre se puede poner una foto. Lo que se tome o se suba no se
// guarda solo: se muestra en la vista previa y hay que aceptarla con el ✓ (o descartarla con la ✕),
// porque una foto a medias —movida, oscura, de la cámara de atrás— se elige mejor antes de guardarla.
function PhotoCapture({
  name,
  onPhoto,
  onClose,
}: {
  name: string
  onPhoto: (photo: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [ready, setReady] = useState(false)
  const [facing, setFacing] = useState<"user" | "environment">("user")
  const [error, setError] = useState("")
  // La foto recién tomada (o subida) se muestra antes de guardarla. Antes se entregaba al instante y la
  // cámara se apagaba con la ventana abierta: eso dejaba la pantalla negra, sin ver la foto ni poder
  // arrepentirse. Ahora hay vista previa, con ✓ para usarla y ✕ para descartarla.
  const [shot, setShot] = useState("")
  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }
  const start = async (mode: "user" | "environment") => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported")
      stop()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      })
      streamRef.current = stream
      setFacing(mode)
      setReady(false)
      setError("")
      window.setTimeout(() => {
        const v = videoRef.current
        if (v && streamRef.current === stream) {
          v.srcObject = stream
          v.play().catch(() => {})
        }
        setReady(true)
      }, 80)
    } catch {
      setError(
        "No pudimos abrir la cámara. Puedes subir una foto de tu galería.",
      )
    }
  }
  useEffect(() => {
    start("user")
    return stop
  }, [])
  const shoot = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
    stop()
    // Se apaga la cámara y la foto queda a la vista, esperando el ✓ o la ✕: así nunca se ve un
    // rectángulo negro (la cámara apagada) sin saber qué pasó con la foto.
    setShot(canvas.toDataURL("image/jpeg", 0.85))
  }
  // El ✓ entrega la foto de la vista previa al editor; la ✕ la descarta y devuelve a la cámara para
  // probar otra vez (si la cámara no está disponible, la ✕ cierra la ventana: no hay a dónde volver).
  const usar = () => {
    onPhoto(shot)
    onClose()
  }
  const descartar = () => {
    setShot("")
    setError("")
    if (error) {
      onClose()
      return
    }
    start(facing)
  }
  const upload = async (list: FileList | null) => {
    const file = list?.[0]
    if (!file) return
    const photo = await readAvatarFile(file)
    if (!photo) {
      setError("No se pudo leer esa imagen. Prueba con otra.")
      return
    }
    stop()
    setShot(photo)
  }
  const close = () => {
    stop()
    onClose()
  }
  return enMarco(
    <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-5">
      <div className="w-full max-w-sm bg-white dark:bg-stone-900 rounded-3xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-stone-800 dark:text-stone-100">
            Foto de {name}
          </h3>
          <div className="flex items-center gap-2">
            {/* Cambiar de cámara es de la cámara en vivo: en la vista previa la cámara ya está apagada. */}
            {!shot && (
              <button
                type="button"
                onClick={() =>
                  start(facing === "user" ? "environment" : "user")
                }
                aria-label="Cambiar de cámara"
                className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-700 text-[15px]"
              >
                🔄
              </button>
            )}
            <button
              type="button"
              onClick={close}
              aria-label="Cerrar la cámara"
              className="text-stone-400 text-xl"
            >
              ×
            </button>
          </div>
        </div>
        <div className="bg-black rounded-2xl overflow-hidden aspect-[3/4] flex items-center justify-center">
          {shot ? (
            <img
              src={shot}
              alt={`Vista previa de la foto de ${name}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          )}
        </div>
        {error && (
          <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-300 mt-2">
            {error}
          </p>
        )}
        {shot && (
          <p className="text-[12px] text-stone-500 dark:text-stone-400 mt-2">
            Así queda tu foto. Toca el ✓ para guardarla o la ✕ para probar otra.
          </p>
        )}
        <div className="flex items-center gap-2 mt-3">
          {shot ? (
            <>
              <button
                type="button"
                onClick={usar}
                aria-label={`Usar esta foto de ${name}`}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-600 text-white font-bold"
              >
                ✓ Usar esta foto
              </button>
              <button
                type="button"
                onClick={descartar}
                aria-label={`Cancelar esta foto de ${name}`}
                className="px-4 flex items-center justify-center gap-2 py-3 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[13px] font-semibold"
              >
                ✕ Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!ready}
                onClick={shoot}
                className="flex-1 py-3 rounded-2xl bg-amber-600 text-white font-bold disabled:opacity-40"
              >
                Tomar la foto
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-4 py-3 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[13px] font-semibold"
              >
                Subir una foto
              </button>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            upload(e.target.files)
            e.target.value = ""
          }}
        />
      </div>
    </div>,
  )
}

// La cara del usuario se elige igual en los tres lugares donde se pone una (el onboarding, al crear un
// usuario desde Inicio y al editar Mi perfil): la rejilla de emojis de siempre y, al lado, un botón de
// cámara de verdad —ícono, no emoji— para tomar o subir una foto. Si hay foto, manda la foto.
function AvatarEditor({
  emoji,
  photo = "",
  name,
  onEmoji,
  onPhoto,
  size = "md",
  className = "",
}: {
  emoji: string
  photo?: string
  name: string
  onEmoji: (emoji: string) => void
  onPhoto: (photo: string) => void
  size?: "sm" | "md"
  className?: string
}) {
  const [capture, setCapture] = useState(false)
  const box =
    size === "sm"
      ? "w-12 h-12 rounded-2xl text-[24px]"
      : "w-14 h-14 rounded-2xl text-[28px]"
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-3">
        <Avatar profile={{ emoji, photo, name }} className={box} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCapture(true)}
            aria-label={`Tomar o subir la foto de ${name}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-[12px] font-bold text-stone-600 dark:text-stone-300"
          >
            <CameraIcon className="w-4 h-4" /> Tomar o subir foto
          </button>
          {photo && (
            <button
              type="button"
              onClick={() => onPhoto("")}
              aria-label={`Quitar la foto de ${name}`}
              className="px-2.5 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-[12px] font-semibold text-stone-500 dark:text-stone-300"
            >
              Quitar
            </button>
          )}
        </div>
      </div>
      <EmojiPicker
        value={emoji}
        onChange={onEmoji}
        name={name}
        size={size}
        className={className}
      />
      {capture && (
        <PhotoCapture
          name={name}
          onPhoto={onPhoto}
          onClose={() => setCapture(false)}
        />
      )}
    </div>
  )
}

// highlight: línea opcional que se muestra en negritas (plazos de aviso, canales, Google Calendar…).
// kicker: línea corta opcional sobre el título (el "Bzzzt..." del último paso).
// scene: ilustración animada del slide (calendario, menús de aviso, adjuntos, usuarios locales).
// logo: el slide se ilustra con el logo real de una app (WhatsApp) en vez de un emoji, así el emoji de
// burbuja no queda en ninguna parte de la aplicación.
type OnboardingSlide = {
  emoji?: string
  logo?: "whatsapp"
  title: string
  body: string
  highlight?: string
  kicker?: string
  scene?: "calendars" | "alert" | "attach" | "users"
  accent: string
}

// onDone cierra el onboarding: el nombre y el emoji del usuario "yo" y, si los dejó, su contacto
// (número de WhatsApp y correo) del último paso. onDefaultProfile escribe dentro de ese mismo
// usuario "yo": así el interruptor de Google Calendar queda guardado al instante y Ajustes lo ve.
function OnboardingScreen({
  onDone,
  onDefaultProfile,
}: {
  onDone: (
    name: string,
    emoji: string,
    contact?: Contact,
    photo?: string,
  ) => void
  onDefaultProfile: (patch: Partial<Profile>) => void
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  // El "Bzzt..." del paso del nombre: si se aprieta "Siguiente" sin nombre, sale el aviso en rojo y no
  // se avanza; al primer tecleo el aviso se va.
  const [nameError, setNameError] = useState(false)
  const [emoji, setEmoji] = useState(DEFAULT_PROFILE.emoji)
  // Primer slide: la abeja con "Bzzzt..." e "¡Avíspate!" justo debajo.
  // Al tocar la abeja aparecen, uno tras otro y con difuminado, los párrafos del pitch.
  const [introOpen, setIntroOpen] = useState(false)
  // Último paso: el contacto opcional y el interruptor de Google Calendar del usuario "yo". Se
  // precarga lo que ese usuario ya tuviera guardado, y el interruptor arranca con el ajuste actual
  // de Ajustes (conectado + "Todos los avisos"), para que ambos lugares digan siempre lo mismo.
  const [ownProfile] = useState(
    () =>
      loadProfiles().find((p) => p.id === DEFAULT_PROFILE_ID) ??
      DEFAULT_PROFILE,
  )
  const [phone, setPhone] = useState(() => ownProfile.contact?.phone ?? "")
  const [email, setEmail] = useState(() => ownProfile.contact?.email ?? "")
  // La cara del usuario "yo" se elige aquí mismo (emoji o foto) y se guarda al terminar el onboarding.
  const [photo, setPhoto] = useState(() => ownProfile.photo ?? "")
  // Último paso: "Sincronizar con Calendarios" es una burbuja blanca desplegable que abre los tres
  // calendarios. Cada uno se enciende por su cuenta y queda guardado al instante en el usuario "yo",
  // así Ajustes muestra exactamente lo mismo apenas se entra a la app.
  const [gcalInitial] = useState<GcalState>(
    () => ownProfile.gcal ?? DEFAULT_GCAL,
  )
  const [syncCals, setSyncCals] = useState<Record<CalendarApp, boolean>>(
    () => ({
      google:
        (ownProfile.gcal ?? DEFAULT_GCAL).connected &&
        (ownProfile.gcal ?? DEFAULT_GCAL).syncAll !== false,
      apple: calendarStateOf(ownProfile, "apple").connected,
      outlook: calendarStateOf(ownProfile, "outlook").connected,
    }),
  )
  const [openSync, setOpenSync] = useState(false)
  const syncCount = (["google", "apple", "outlook"] as CalendarApp[]).filter(
    (app) => syncCals[app],
  ).length
  const syncSummary =
    syncCount === 0
      ? "Google, Apple y Outlook · sin conectar"
      : syncCount === 3
        ? "Google, Apple y Outlook · los tres conectados"
        : `Conectados: ${(["google", "apple", "outlook"] as CalendarApp[])
            .filter((app) => syncCals[app])
            .map((app) => CALENDAR_LABELS[app])
            .join(" y ")}`
  const slides: OnboardingSlide[] = [
    {
      emoji: "🐝",
      title: "Deja de acordarte de todo.",
      body: "Anota lo importante y olvídate del resto: nosotros te avisamos a tiempo.",
      accent: "bg-linear-to-b from-amber-500 to-amber-700",
    },
    {
      logo: "whatsapp",
      title: "Recibe recordatorios\na tiempo",
      body: "Recibe avisos por notificaciones push, por WhatsApp y por correo, justo cuando los necesitas.",
      highlight: "También en Google Calendar, Apple Calendar y Outlook",
      scene: "calendars",
      accent: "bg-linear-to-b from-amber-600 to-amber-800",
    },
    {
      emoji: "🔔",
      title: "Tú eliges\ncuándo avisarte",
      body: "Un mismo evento puede llevar varios avisos:",
      scene: "alert",
      accent: "bg-linear-to-b from-amber-600 to-amber-800",
    },
    {
      emoji: "📎",
      title: "Complementa tu\nrecordatorio",
      body: "Agrega notas, audio, documentos y fotos para recordar cada detalle. Además puedes ordenar cada recordatorio por categorías.",
      scene: "attach",
      accent: "bg-linear-to-b from-amber-600 to-amber-800",
    },
    {
      emoji: "👥",
      title: "Recuerda por\nlos demás",
      body: "Recordar también es cuidar. Crea recordatorios para la familia, tus amigos o incluso para tu empresa.",
      highlight: "Correo, WhatsApp y Calendarios totalmente independientes.",
      scene: "users",
      accent: "bg-linear-to-b from-amber-600 to-amber-800",
    },
  ]
  const nameSlide: OnboardingSlide = {
    emoji: "🐝",
    kicker: "Bzzzt...",
    title: "¿Cómo te\nllamas?",
    body: "Tus recordatorios quedarán guardados con tu nombre en este dispositivo.\nPodrás cambiarlo cuando quieras en Ajustes.",
    accent: "bg-linear-to-b from-amber-500 to-amber-700",
  }
  // Último paso, después del nombre: el contacto opcional y el interruptor de Google Calendar.
  const contactSlide: OnboardingSlide = {
    emoji: "📬",
    title: "¿Por dónde\nte avisamos?",
    body: "Si quieres, deja tu número de WhatsApp y tu correo para que los avisos te lleguen ahí.\nTodo es opcional: puedes llenarlo más tarde en Ajustes.",
    accent: "bg-linear-to-b from-amber-500 to-amber-700",
  }
  const isNameStep = step === slides.length
  const isContactStep = step === slides.length + 1
  // Los dos últimos pasos son formularios: el degradado se recoge para dejar ver los campos.
  const isFormStep = isNameStep || isContactStep
  const isIntro = step === 0
  const totalSteps = slides.length + 2
  const slide = isNameStep
    ? nameSlide
    : isContactStep
      ? contactSlide
      : slides[step]
  // Los slides con ilustración usan tipografía un poco más compacta para que todo quepa en pantallas chicas.
  const compact = !isFormStep && !!slide.scene
  const showBottom = !isIntro || introOpen
  // El contacto se guarda solo si se aprieta "¡Avíspate!" en el último paso: si el usuario salta,
  // igual se queda con el nombre, el emoji y la foto que eligió.
  const finish = (contact?: Contact) =>
    onDone(name.trim(), emoji, contact, photo)
  // Sin botón "Siguiente" en los slides: se avanza tocando cualquier parte de la pantalla o deslizando
  // el dedo (o el mouse) hacia la izquierda. En los pasos de formulario hay botones, porque ahí hay que
  // escribir o elegir; ahí el deslizar hacia la derecha sí retrocede, y los datos se conservan.
  const next = () => setStep((s) => Math.min(s + 1, slides.length + 1))
  // Deslizar: cada gesto se mide aparte —touch para el dedo, pointer para el mouse o el lápiz— para no
  // contarlo dos veces cuando el navegador manda los dos. Se ignoran los gestos que empiezan sobre un
  // campo o un botón, y solo cuentan los claramente horizontales: si manda lo vertical, es scroll.
  // La posición se anota en cada movimiento (touchmove/pointermove) y no solo al soltar, porque en el
  // teléfono el navegador puede quedarse con el gesto y cerrar la secuencia con un touchcancel sin
  // decir dónde terminó: con lo anotado, el deslizar con el dedo funciona igual.
  const swipeAt = useRef<{
    startX: number
    startY: number
    x: number
    y: number
    touch: boolean
  } | null>(null)
  const swipedAt = useRef(0)
  const SWIPE_MIN = 50
  const SWIPE_CLICK_MS = 350
  const onField = (target: EventTarget | null) =>
    !!(target as HTMLElement | null)?.closest?.(
      "input, textarea, select, button",
    )
  const swipeStart = (
    x: number,
    y: number,
    touch: boolean,
    target: EventTarget | null,
  ) => {
    swipeAt.current = onField(target)
      ? null
      : { startX: x, startY: y, x, y, touch }
  }
  const swipeMove = (x: number, y: number, touch: boolean) => {
    const gesture = swipeAt.current
    if (!gesture || gesture.touch !== touch) return
    gesture.x = x
    gesture.y = y
  }
  // x e y pueden venir vacíos: es el caso del touchcancel, y ahí se usa el último punto anotado.
  const swipeEnd = (
    x: number | null,
    y: number | null,
    touch: boolean,
    target: EventTarget | null,
  ) => {
    const gesture = swipeAt.current
    swipeAt.current = null
    if (!gesture || gesture.touch !== touch) return
    if (target && onField(target)) return
    const dx = (x ?? gesture.x) - gesture.startX,
      dy = (y ?? gesture.y) - gesture.startY
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return
    swipedAt.current = Date.now()
    if (dx < 0) {
      if (isIntro && !introOpen) {
        setIntroOpen(true)
        return
      }
      if (isFormStep) return
      next()
    } else setStep((s) => Math.max(s - 1, 0))
  }
  // Tocar la pantalla no avanza en los dos últimos pasos: ahí el avance lo deciden los botones,
  // porque hay campos que llenar.
  const tapScreen = () => {
    // Un deslizar no es un toque: los navegadores de teléfono además mandan el clic del gesto, y sin
    // esta guarda el onboarding saltaría dos pasos de una sola vez.
    if (Date.now() - swipedAt.current < SWIPE_CLICK_MS) return
    if (isFormStep) return
    if (isIntro && !introOpen) {
      setIntroOpen(true)
      return
    }
    next()
  }
  // Paso del nombre → último paso (contacto). Sin nombre no avanza: sale el "Bzzt..." en rojo y nada más.
  const goContact = () => {
    if (!name.trim()) {
      setNameError(true)
      return
    }
    setNameError(false)
    setStep(slides.length + 1)
  }
  // "Saltar por ahora" no pide nombre: pasa al contacto con lo que haya escrito (o con el de siempre).
  const skipName = () => {
    setNameError(false)
    setStep(slides.length + 1)
  }
  // Interruptor de cada calendario del último paso. Es el mismo ajuste que vive en Ajustes ›
  // Calendarios › «Todos los avisos», así que se guarda al instante en el usuario "yo"; encenderlo deja
  // ese calendario conectado (solo el suyo: cada usuario del dispositivo tiene sus propias conexiones).
  const toggleCalendar = (app: CalendarApp) => {
    const on = !syncCals[app]
    setSyncCals((prev) => ({ ...prev, [app]: on }))
    if (app === "google")
      onDefaultProfile({
        gcal: on
          ? { ...gcalInitial, connected: true, syncAll: true }
          : { ...gcalInitial, syncAll: false },
      })
    else
      onDefaultProfile({
        [app]: (on
          ? { connected: true, syncAll: true }
          : { connected: false }) as CalendarAppState,
      })
  }
  // Validación suave: si un campo trae algo, tiene que parecer un número y un correo de verdad.
  const phoneOk =
    phone.trim() === "" || /^\+?[0-9][0-9\s.()-]{6,19}$/.test(phone.trim())
  const emailOk =
    email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const contactOk = phoneOk && emailOk
  // Puntos de progreso: sobre el degradado en blanco, sobre el fondo crema en ámbar.
  // Cada punto es tocable y salta a su paso; como el contenido va con key={step}, la
  // animación de entrada se vuelve a reproducir siempre (y la altura del degradado, si aplica).
  const dots = (
    <div className="animate-slide-in [animation-delay:340ms] flex items-center">
      {Array.from({ length: totalSteps }).map((_, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setStep(i)
          }}
          aria-label={`Ir al paso ${i + 1} de ${totalSteps}`}
          aria-current={i === step}
          className="cursor-pointer px-2 py-2"
        >
          <span
            className={`block h-1.5 rounded-full transition-all duration-300 ${
              i === step ? "w-6" : "w-1.5"
            } ${
              isFormStep
                ? i === step
                  ? "bg-amber-500"
                  : "bg-stone-200 dark:bg-stone-600"
                : i === step
                  ? "bg-white"
                  : "bg-white/40"
            }`}
          />
        </button>
      ))}
    </div>
  )
  return (
    <div className="flex flex-col h-full overflow-y-auto app-bg dark:bg-stone-950">
      <div
        onClick={tapScreen}
        style={{ touchAction: "pan-y" }}
        onTouchStart={(e) => {
          const t = e.touches[0]
          if (t) swipeStart(t.clientX, t.clientY, true, e.target)
        }}
        onTouchMove={(e) => {
          const t = e.touches[0]
          if (t) swipeMove(t.clientX, t.clientY, true)
        }}
        onTouchEnd={(e) => {
          const t = e.changedTouches[0]
          if (t) swipeEnd(t.clientX, t.clientY, true, e.target)
        }}
        onTouchCancel={() => swipeEnd(null, null, true, null)}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") return
          swipeStart(e.clientX, e.clientY, false, e.target)
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch") return
          swipeMove(e.clientX, e.clientY, false)
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") return
          swipeEnd(e.clientX, e.clientY, false, e.target)
        }}
        onPointerCancel={() => swipeEnd(null, null, false, null)}
        className={`flex flex-col flex-1 ${
          isNameStep ? "" : "cursor-pointer select-none"
        }`}
      >
        {/* El degradado cubre toda la pantalla en los slides. En el último paso se recoge hacia
          arriba (transición de altura) para dejar ver el formulario y los botones. */}
        <div
          className={`flex flex-col items-center ${slide.accent} rounded-b-[40px] text-white px-8 min-h-fit transition-[height] duration-700 ease-out ${
            isNameStep
              ? "flex-none h-[340px] pt-14 pb-8"
              : isContactStep
                ? "flex-none h-[288px] pt-12 pb-6"
                : "h-full pt-10 pb-10"
          }`}
        >
          <div
            key={step}
            className="flex flex-1 min-h-0 w-full flex-col items-center justify-center"
          >
            {isIntro ? (
              <>
                <span className="animate-pop-in text-[112px] leading-none">
                  {slide.emoji}
                </span>
                <p className="animate-blur-in [animation-delay:240ms] mt-4 text-[26px] font-bold leading-none text-white/85">
                  Bzzzt...
                </p>
                <p className="animate-blur-in [animation-delay:460ms] text-[42px] font-extrabold leading-none">
                  ¡Avíspate!
                </p>
                <div
                  className={`grid w-full transition-[grid-template-rows] duration-700 ease-out ${
                    introOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden min-h-0">
                    {introOpen && (
                      <>
                        <h1 className="animate-blur-in [animation-delay:180ms] mt-8 text-[28px] font-extrabold leading-tight text-center">
                          {slide.title}
                        </h1>
                        <p className="animate-blur-in [animation-delay:880ms] mt-3 text-[15px] text-white/85 text-center leading-relaxed">
                          {slide.body}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div
                  className={`animate-pop-in ${
                    isNameStep
                      ? "text-[52px] mb-4"
                      : isContactStep
                        ? "text-[44px] mb-3"
                        : compact
                          ? "text-[56px] mb-6"
                          : "text-[72px] mb-8"
                  }`}
                >
                  {slide.logo === "whatsapp" ? (
                    <WhatsAppG
                      className={
                        isNameStep
                          ? "w-[52px] h-[52px]"
                          : isContactStep
                            ? "w-[44px] h-[44px]"
                            : compact
                              ? "w-[56px] h-[56px]"
                              : "w-[72px] h-[72px]"
                      }
                    />
                  ) : (
                    slide.emoji
                  )}
                </div>
                {slide.kicker && (
                  <p className="animate-blur-in [animation-delay:60ms] text-[22px] font-bold leading-none text-white/80 mb-2">
                    {slide.kicker}
                  </p>
                )}
                <h1
                  className={`animate-slide-in [animation-delay:90ms] font-extrabold leading-tight text-center whitespace-pre-line mb-4 ${
                    isFormStep
                      ? "text-[24px]"
                      : compact
                        ? "text-[26px]"
                        : "text-[28px]"
                  }`}
                >
                  {slide.title}
                </h1>
                <p
                  className={`animate-slide-in [animation-delay:180ms] ${
                    isFormStep || compact ? "text-[14px]" : "text-[15px]"
                  } text-white/80 text-center leading-relaxed whitespace-pre-line`}
                >
                  {slide.body}
                </p>
                {slide.scene === "calendars" && <CalendarsScene />}
                {slide.scene === "alert" && <AlertPickerScene />}
                {slide.scene === "attach" && <AttachScene />}
                {slide.scene === "users" && <ProfilesScene />}
                {slide.highlight && (
                  <p
                    className={`animate-slide-in ${
                      slide.scene === "calendars"
                        ? "[animation-delay:280ms]"
                        : slide.scene === "attach"
                          ? "[animation-delay:900ms]"
                          : "[animation-delay:420ms]"
                    } mt-2 ${
                      compact ? "text-[15px]" : "text-[16px]"
                    } font-extrabold text-center leading-relaxed`}
                  >
                    {slide.highlight}
                  </p>
                )}
              </>
            )}
          </div>
          {!isFormStep && showBottom && (
            <div className="w-full pt-8 flex flex-col items-center gap-6">
              {dots}
              <p className="animate-slide-in [animation-delay:420ms] flex items-center gap-1.5 text-[13px] font-semibold text-white/75">
                Toca o desliza para continuar{" "}
                <span className="animate-pulse text-[15px] leading-none">
                  ›
                </span>
              </p>
            </div>
          )}
        </div>
        {isFormStep && (
          <div className="px-6 pt-6 pb-10 flex flex-col items-center gap-5">
            {dots}
            {isNameStep ? (
              <>
                <div className="animate-slide-in [animation-delay:400ms] w-full">
                  <label
                    htmlFor="onboarding-name"
                    className="block text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2"
                  >
                    Tu nombre
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-500/20 border border-amber-200 dark:border-amber-500/40 flex items-center justify-center text-[24px] flex-shrink-0">
                      {emoji}
                    </span>
                    <input
                      id="onboarding-name"
                      value={name}
                      maxLength={24}
                      aria-invalid={nameError}
                      onChange={(e) => {
                        setName(e.target.value)
                        if (nameError) setNameError(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") goContact()
                      }}
                      placeholder="Ej: Papi, Mamá, Sebastián…"
                      className="flex-1 min-w-0 px-4 py-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-[16px] font-semibold text-stone-800 dark:text-stone-100 placeholder:text-stone-300 dark:placeholder:text-stone-600 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                    />
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mt-4 mb-2">
                    Tu emoji o tu foto
                  </p>
                  <AvatarEditor
                    emoji={emoji}
                    photo={photo}
                    name="ti"
                    onEmoji={setEmoji}
                    onPhoto={setPhoto}
                  />
                  <p className="text-[11px] text-stone-400 mt-3">
                    Puedes agregar más usuarios (familia, taller, etc.) desde el
                    inicio o en Ajustes.
                  </p>
                </div>
                <button
                  onClick={goContact}
                  className="animate-slide-in [animation-delay:460ms] w-full py-4 rounded-2xl bg-amber-600 text-white font-bold text-[16px] shadow-lg shadow-amber-200 active:scale-[0.99] transition-transform"
                >
                  Siguiente
                </button>
                {nameError && (
                  <p
                    role="alert"
                    className="animate-slide-in -mt-2 text-[12px] font-semibold text-red-500"
                  >
                    Bzzt… escribe un nombre primero
                  </p>
                )}
                <button
                  onClick={skipName}
                  className="animate-slide-in [animation-delay:540ms] text-stone-400 text-[14px] font-medium"
                >
                  Saltar por ahora
                </button>
              </>
            ) : (
              <>
                {/* Último paso: número de WhatsApp, correo y la burbuja «Sincronizar con Calendarios». Todo es
              opcional, así que "¡Avíspate!" solo se bloquea si algún campo quedó mal escrito. */}
                <div className="animate-slide-in [animation-delay:400ms] w-full">
                  <label
                    htmlFor="onboarding-phone"
                    className="block text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2"
                  >
                    Número de WhatsApp
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-500/20 border border-amber-200 dark:border-amber-500/40 flex items-center justify-center flex-shrink-0">
                      <WhatsAppG className="w-7 h-7" />
                    </span>
                    <PhoneField
                      id="onboarding-phone"
                      value={phone}
                      onChange={setPhone}
                    />
                  </div>
                  <label
                    htmlFor="onboarding-email"
                    className="block text-[11px] font-bold uppercase tracking-widest text-stone-400 mt-4 mb-2"
                  >
                    Correo electrónico
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-500/20 border border-amber-200 dark:border-amber-500/40 flex items-center justify-center text-[22px] flex-shrink-0">
                      ✉️
                    </span>
                    <input
                      id="onboarding-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      maxLength={60}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && contactOk)
                          finish({ phone: phone.trim(), email: email.trim() })
                      }}
                      placeholder="tucorreo@ejemplo.com"
                      className="flex-1 min-w-0 px-4 py-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-[16px] font-semibold text-stone-800 dark:text-stone-100 placeholder:text-stone-300 dark:placeholder:text-stone-600 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                    />
                  </div>
                  {!contactOk && (
                    <p className="animate-slide-in [animation-delay:440ms] text-[12px] font-semibold text-red-500 mt-2">
                      {phoneOk
                        ? "Revisa el correo electrónico."
                        : "Revisa el número de WhatsApp."}
                    </p>
                  )}
                  {/* Burbuja blanca desplegable: cerrada resume qué calendarios están conectados; al abrirla
                aparecen los tres, cada uno con su interruptor. */}
                  <div className="animate-slide-in [animation-delay:480ms] mt-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 overflow-hidden">
                    <button
                      type="button"
                      aria-expanded={openSync}
                      aria-label="Sincronizar con Calendarios"
                      onClick={() => setOpenSync((v) => !v)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                    >
                      <span
                        aria-hidden="true"
                        className="flex items-center gap-0.5 rounded-full bg-stone-50 dark:bg-stone-800 border border-stone-100 dark:border-stone-800 px-1.5 py-1 flex-shrink-0"
                      >
                        <span className="w-6 h-6 rounded-full bg-white dark:bg-stone-900 flex items-center justify-center">
                          <GoogleG className="w-3.5 h-3.5" />
                        </span>
                        <span className="w-6 h-6 rounded-full bg-white dark:bg-stone-900 flex items-center justify-center">
                          <AppleG className="w-3.5 h-3.5" />
                        </span>
                        <span className="w-6 h-6 rounded-full bg-white dark:bg-stone-900 flex items-center justify-center">
                          <OutlookG className="w-3.5 h-3.5" />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
                          Sincronizar con Calendarios
                        </p>
                        <p className="text-[11px] text-stone-400 truncate">
                          {syncSummary}
                        </p>
                      </span>
                      <svg
                        viewBox="0 0 10 6"
                        aria-hidden="true"
                        className={`w-3 h-2 flex-shrink-0 text-stone-400 transition-transform ${
                          openSync ? "rotate-180" : ""
                        }`}
                      >
                        <path
                          d="M1 1l4 4 4-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    {openSync && (
                      <div className="border-t border-stone-100 dark:border-stone-800 px-4 pb-4">
                        {(["google", "apple", "outlook"] as CalendarApp[]).map(
                          (app, i) => {
                            const logo =
                              app === "google" ? (
                                <GoogleG className="w-5 h-5" />
                              ) : app === "apple" ? (
                                <AppleG className="w-5 h-5" />
                              ) : (
                                <OutlookG className="w-5 h-5" />
                              )
                            return (
                              <div
                                key={app}
                                className={`flex items-center gap-3 ${
                                  i === 0
                                    ? "pt-3"
                                    : "mt-3 pt-3 border-t border-stone-50 dark:border-stone-800"
                                }`}
                              >
                                <div className="w-9 h-9 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-100 dark:border-stone-800 flex items-center justify-center flex-shrink-0">
                                  {logo}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100 leading-tight">
                                    {CALENDAR_LABELS[app]}
                                  </p>
                                  <p className="text-[11px] text-stone-400 mt-0.5">
                                    {syncCals[app]
                                      ? "Los recordatorios nuevos vienen con este calendario activado."
                                      : "Opcional: puedes activarlo cuando quieras."}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={syncCals[app]}
                                  aria-label={`Sincronizar con ${CALENDAR_LABELS[app]}`}
                                  onClick={() => toggleCalendar(app)}
                                  className={`w-11 h-6 rounded-full flex-shrink-0 transition-colors ${
                                    syncCals[app]
                                      ? "bg-amber-500"
                                      : "bg-stone-200 dark:bg-stone-600"
                                  }`}
                                >
                                  <div
                                    className={`w-5 h-5 bg-white rounded-full shadow mx-0.5 transition-transform ${
                                      syncCals[app] ? "translate-x-5" : ""
                                    }`}
                                  />
                                </button>
                              </div>
                            )
                          },
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() =>
                    finish({ phone: phone.trim(), email: email.trim() })
                  }
                  disabled={!contactOk}
                  className="animate-slide-in [animation-delay:520ms] w-full py-4 rounded-2xl bg-amber-600 text-white font-bold text-[16px] shadow-lg shadow-amber-200 active:scale-[0.99] transition-transform disabled:opacity-40"
                >
                  ¡Avíspate!
                </button>
                <button
                  onClick={() => finish()}
                  className="animate-slide-in [animation-delay:600ms] text-stone-400 text-[14px] font-medium"
                >
                  Saltar por ahora
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Hoja para crear una categoría: el nombre y su emoji, con el mismo selector de emojis de los usuarios
// (la rejilla de once y la lista completa). La abren el final del carrusel de Inicio y el selector de
// categoría de Nuevo recordatorio; quien la abre deja la categoría nueva elegida.
function CategorySheet({
  categories,
  onSave,
  onClose,
}: {
  categories: Category[]
  onSave: (name: string, emoji: string) => void
  onClose: () => void
}) {
  const [nombre, setNombre] = useState("")
  const [emoji, setEmoji] = useState(CATEGORY_EMOJI)
  // Ni vacía ni repetida: en los dos casos se avisa y el botón de crear queda apagado.
  const limpio = nombre.trim()
  const repetida = categories.some(
    (c) => c.name.toLowerCase() === limpio.toLowerCase(),
  )
  const puede = limpio !== "" && !repetida
  const crear = () => {
    if (!puede) return
    onSave(limpio, emoji)
    onClose()
  }
  return enMarco(
    <div className="absolute inset-0 z-[55] bg-black/60 flex items-center justify-center p-5">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="flex items-center gap-2 font-bold text-stone-800 dark:text-stone-100">
            Nueva categoría
            {/* El emoji elegido, a la vista: el botón de abajo solo dice «+», así que acá se ve cuál es
                el que va a quedar. */}
            <span className="text-[20px] leading-none" aria-hidden="true">
              {emoji}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar la nueva categoría"
            className="w-8 h-8 rounded-full text-stone-400 text-xl flex-shrink-0"
          >
            ×
          </button>
        </div>
        <label
          htmlFor="category-name"
          className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block"
        >
          Nombre
        </label>
        <input
          id="category-name"
          value={nombre}
          maxLength={24}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. Jardín, Mascotas…"
          className="w-full bg-stone-50 dark:bg-stone-800 rounded-2xl px-4 py-3.5 text-[16px] font-semibold border border-stone-100 dark:border-stone-800 outline-none focus:border-amber-400"
        />
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mt-4 mb-2">
          Su emoji
        </p>
        {/* Sin la rejilla de once caras: las categorías no son caras. Queda solo el «+», que abre la
            lista completa de emojis, y el elegido se ve junto al título. */}
        <EmojiPicker
          value={emoji}
          onChange={setEmoji}
          name="esta categoría"
          size="sm"
          presets={false}
        />
        <p className="text-[11px] text-stone-400 mt-2">
          Toca el «+» para elegir otro emoji.
        </p>
        {repetida && (
          <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-300 mt-2">
            Ya tienes una categoría con ese nombre.
          </p>
        )}
        <div className="flex items-center gap-2 mt-4">
          <button
            type="button"
            onClick={crear}
            disabled={!puede}
            className="flex-1 py-3 rounded-2xl bg-amber-600 text-white text-[15px] font-bold disabled:opacity-40"
          >
            Crear categoría
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[14px] font-semibold"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>,
  )
}

// Hoja para ordenar y eliminar las categorías. Se ordenan con flechas —arriba y abajo— y no arrastrando:
// dentro de un carrusel que ya scrollea de lado el arrastre pelea con el gesto, y con el dedo las flechas
// son más predecibles. Al eliminar se pregunta qué hacer con los recordatorios de esa categoría: dejarlos
// sin categoría (quedan sólo en «Todas») o borrarlos junto con ella.
function CategoriesEditor({
  categories,
  counts,
  onMove,
  onRemove,
  onClose,
}: {
  categories: Category[]
  counts: (name: string) => number
  onMove: (name: string, dir: -1 | 1) => void
  onRemove: (name: string, queHacer: "borrar" | "soltar") => void
  onClose: () => void
}) {
  const [porBorrar, setPorBorrar] = useState<string | null>(null)
  const cuantos = porBorrar ? counts(porBorrar) : 0
  // El arrastre: se toma la agarradera y, mientras el dedo (o el mouse) se mueve, la categoría sube o
  // baja una posición cada vez que recorre media fila. Se usa Pointer Events —y no el arrastre nativo de
  // HTML— porque el nativo no existe en el navegador del teléfono, que es donde de verdad se usa esto.
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const arrastre = useRef<{ nombre: string; y: number; alto: number } | null>(null)
  const empezar = (e: React.PointerEvent<HTMLElement>, nombre: string) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // En jsdom no hay medidas: sin fila medida se usa un alto de referencia para que el gesto funcione.
    const alto = e.currentTarget.parentElement?.getBoundingClientRect().height || 56
    arrastre.current = { nombre, y: e.clientY, alto }
    setArrastrando(nombre)
  }
  const mover = (e: React.PointerEvent<HTMLElement>, nombre: string) => {
    const a = arrastre.current
    if (!a || a.nombre !== nombre) return
    const dy = e.clientY - a.y
    if (Math.abs(dy) < a.alto * 0.6) return
    onMove(nombre, dy > 0 ? 1 : -1)
    a.y = e.clientY
  }
  const soltar = () => {
    arrastre.current = null
    setArrastrando(null)
  }
  return enMarco(
    <div className="absolute inset-0 z-[55] bg-black/60 flex items-center justify-center p-5">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm max-h-[82dvh] flex flex-col bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 p-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="font-bold text-stone-800 dark:text-stone-100">
            Editar categorías
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar el editor de categorías"
            className="w-8 h-8 rounded-full text-stone-400 text-xl flex-shrink-0"
          >
            ×
          </button>
        </div>
        <p className="text-[11px] text-stone-400 mb-2">
          Arrástralas desde la agarradera para cambiar el orden del carrusel.
        </p>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {categories.length === 0 && (
            <p className="text-[13px] text-stone-400 py-6 text-center">
              No tienes categorías. Crea una con «＋ Nueva».
            </p>
          )}
          {categories.map((c) => (
            <div
              key={c.name}
              className={`flex items-center gap-2 py-2 border-b border-stone-50 dark:border-stone-800 last:border-b-0 transition-colors ${
                arrastrando === c.name
                  ? "bg-amber-50 dark:bg-amber-500/10 rounded-xl shadow-lg ring-1 ring-amber-200 dark:ring-amber-500/40"
                  : ""
              }`}
            >
              {/* La agarradera: `touch-none` para que el gesto no se lo coma el scroll de la lista, y con
                  las flechas del teclado como alternativa accesible (sin botones a la vista). */}
              <button
                type="button"
                aria-label={`Mover ${c.name}`}
                onPointerDown={(e) => empezar(e, c.name)}
                onPointerMove={(e) => mover(e, c.name)}
                onPointerUp={soltar}
                onPointerCancel={soltar}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") onMove(c.name, -1)
                  if (e.key === "ArrowDown") onMove(c.name, 1)
                }}
                className={`w-6 h-8 flex items-center justify-center flex-shrink-0 touch-none select-none text-[15px] leading-none text-stone-300 dark:text-stone-600 ${
                  arrastrando === c.name ? "cursor-grabbing" : "cursor-grab"
                }`}
              >
                ⠿
              </button>
              <span className="w-6 text-center text-[18px] flex-shrink-0">
                {c.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-stone-700 dark:text-stone-200">
                  {c.name}
                </span>
                <span className="block text-[11px] text-stone-400">
                  {counts(c.name)}{" "}
                  {counts(c.name) === 1 ? "recordatorio" : "recordatorios"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPorBorrar(porBorrar === c.name ? null : c.name)}
                aria-label={`Eliminar ${c.name}`}
                className="w-8 h-8 rounded-xl text-[15px] text-red-500 dark:text-red-400"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
        {porBorrar && (
          <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
            <p className="text-[13px] font-semibold text-stone-700 dark:text-stone-200">
              {cuantos === 0
                ? `«${porBorrar}» no tiene recordatorios.`
                : `«${porBorrar}» tiene ${cuantos} ${
                    cuantos === 1 ? "recordatorio" : "recordatorios"
                  }: ¿qué hacemos con ellos?`}
            </p>
            <div className="flex flex-col gap-2 mt-3">
              {cuantos > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onRemove(porBorrar, "soltar")
                    setPorBorrar(null)
                  }}
                  className="w-full py-2.5 rounded-2xl bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[14px] font-bold"
                >
                  Dejarlos sin categoría
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onRemove(porBorrar, "borrar")
                  setPorBorrar(null)
                }}
                className="w-full py-2.5 rounded-2xl bg-red-600 text-white text-[14px] font-bold"
              >
                {cuantos === 0
                  ? "Eliminar la categoría"
                  : "Borrar sus recordatorios"}
              </button>
              <button
                type="button"
                onClick={() => setPorBorrar(null)}
                className="w-full py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[14px] font-semibold"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-3 py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[14px] font-bold"
        >
          Listo
        </button>
      </div>
    </div>,
  )
}

function HomeScreen({
  events,
  notifications,
  onEventClick,
  onAdd,
  profiles,
  activeProfile,
  onSelectProfile,
  onAddProfile,
  categories,
  onAddCategory,
  onMoveCategory,
  onRemoveCategory,
  clock12,
}: {
  events: Reminder[]
  notifications: AppNotification[]
  onEventClick: (id: string) => void
  onAdd: (category?: string) => void
  profiles: Profile[]
  activeProfile: Profile
  onSelectProfile: (id: string) => void
  onAddProfile: (name: string, emoji: string, photo?: string) => void
  categories: Category[]
  onAddCategory: (name: string, emoji: string) => void
  onMoveCategory: (name: string, dir: -1 | 1) => void
  onRemoveCategory: (name: string, queHacer: "borrar" | "soltar") => void
  clock12: boolean
}) {
  const [view, setView] = useState<"vigentes" | "vencidos">("vigentes")
  const [openUpcoming, setOpenUpcoming] = useState(true)
  const [openRest, setOpenRest] = useState(true)
  const [openBell, setOpenBell] = useState(false)
  const [openUsers, setOpenUsers] = useState(false)
  const [addingUser, setAddingUser] = useState(false)
  // Las dos hojas de categorías: crear una nueva y ordenar/eliminar las que hay.
  const [nuevaCategoria, setNuevaCategoria] = useState(false)
  const [editarCategorias, setEditarCategorias] = useState(false)
  // Cuántos recordatorios tiene cada categoría: la hoja de edición lo dice antes de eliminar.
  const cuantosDe = (nombre: string) =>
    events.filter((e) => e.category === nombre).length
  const [newUserName, setNewUserName] = useState("")
  // La cara del usuario nuevo se elige de la misma manera que en el onboarding y en Ajustes: emoji de
  // la rejilla o foto con la cámara; arranca en la abeja (la cara por defecto, la mascota de AVISPATE)
  // para que agregar a alguien de apuro pida solo el nombre.
  const [newUserEmoji, setNewUserEmoji] = useState(DEFAULT_PROFILE.emoji)
  const [newUserPhoto, setNewUserPhoto] = useState("")
  const addUser = () => {
    if (!newUserName.trim()) return
    onAddProfile(
      newUserName.trim(),
      newUserEmoji.trim() || DEFAULT_PROFILE.emoji,
      newUserPhoto || undefined,
    )
    setNewUserName("")
    setNewUserEmoji(DEFAULT_PROFILE.emoji)
    setNewUserPhoto("")
    setAddingUser(false)
    setOpenUsers(false)
  }
  const [categoryFilter, setCategoryFilter] = useState("Todas")
  const filtered =
    categoryFilter === "Todas"
      ? events
      : events.filter((e) => e.category === categoryFilter)
  const active = filtered
    .filter((e) => !e.completed)
    .sort(
      (a, b) =>
        parseDate(a.date, a.time).getTime() -
        parseDate(b.date, b.time).getTime(),
    )
  const overdue = active
    .filter((e) => daysUntil(e.date) < 0)
    .sort(
      (a, b) =>
        parseDate(a.date, a.time).getTime() -
        parseDate(b.date, b.time).getTime(),
    )
  const upcoming = active.filter(
    (e) => daysUntil(e.date) >= 0 && daysUntil(e.date) <= 30,
  )
  const rest = active.filter((e) => daysUntil(e.date) > 30)
  const sortedNotifs = [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  return (
    <div className="flex flex-col h-full app-bg dark:bg-stone-950">
      <div className="px-5 pt-12 pb-3">
        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            <h1 className="font-extrabold text-[28px] text-stone-900 dark:text-stone-50 leading-tight">
              ¡Avíspate! 🐝
            </h1>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* De vuelta la campana simple —ni avispa ni zumbido— y sin burbuja: es un control libre sobre
            el fondo, para que no se lea como las categorías que están justo abajo. */}
            <div className="relative flex-shrink-0">
              <button
                aria-label="Historial de avisos enviados"
                onClick={() => setOpenBell((v) => !v)}
                className={`w-11 h-11 rounded-2xl flex items-center justify-center active:scale-95 transition-colors ${
                  openBell
                    ? "bg-amber-100/80 dark:bg-amber-500/25 text-amber-800 dark:text-amber-200"
                    : "text-stone-700 dark:text-stone-100"
                }`}
              >
                <span className="text-[22px] leading-none">🔔</span>
              </button>
              {openBell && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setOpenBell(false)}
                  />
                  <div className="absolute right-0 top-12 z-40 w-[min(320px,calc(100vw-32px))] max-h-[55vh] overflow-y-auto overscroll-contain bg-white dark:bg-stone-900 rounded-3xl shadow-2xl border border-stone-100 dark:border-stone-800 p-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 px-3 pt-2 pb-1">
                      Avisos enviados
                    </p>
                    {sortedNotifs.length === 0 ? (
                      <div className="px-3 py-8 text-center">
                        <span className="text-3xl block mb-2">🔕</span>
                        <p className="text-[13px] text-stone-400">
                          Aún no se han enviado avisos.
                        </p>
                      </div>
                    ) : (
                      sortedNotifs.map((n) => (
                        <div
                          key={n.id}
                          className="flex items-start gap-3 px-3 py-2.5 rounded-2xl hover:bg-stone-50 dark:hover:bg-stone-800"
                        >
                          <span className="text-lg mt-0.5">{n.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-[13px] text-stone-900 dark:text-stone-50 truncate">
                                {n.eventName}
                              </p>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-700 text-stone-500 dark:text-stone-400 flex-shrink-0">
                                {n.status}
                              </span>
                            </div>
                            <p className="text-[12px] text-stone-500 dark:text-stone-400 mt-0.5">
                              {n.message}
                            </p>
                            <p className="text-[10px] text-stone-300 dark:text-stone-500 mt-1">
                              {new Date(n.createdAt).toLocaleString("es-CL", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              · {n.channel}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="relative mt-3">
          <button
            aria-label="Cambiar usuario"
            onClick={() => {
              setOpenUsers((v) => !v)
              setAddingUser(false)
            }}
            aria-expanded={openUsers}
            className="flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-2xl active:scale-[0.98] transition-transform"
          >
            <Avatar
              profile={activeProfile}
              className="w-8 h-8 rounded-xl text-[17px]"
            />
            <span className="max-w-[150px] truncate text-[17px] font-extrabold text-stone-800 dark:text-stone-100">
              {activeProfile.name}
            </span>
            {/* La pista de que el nombre se toca: un chevron en ámbar —el color de lo accionable en la
                app— dentro de una pastilla translúcida, y nada de burbuja blanca (se leería igual que
                los chips de categoría de aquí abajo). Gira cuando el desplegable está abierto. */}
            <span
              aria-hidden="true"
              className={`w-5 h-5 rounded-full bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300 flex items-center justify-center flex-shrink-0 transition-transform ${
                openUsers ? "rotate-180" : ""
              }`}
            >
              <svg viewBox="0 0 10 6" className="w-2.5 h-1.5">
                <path
                  d="M1 1l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          {openUsers && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => {
                  setOpenUsers(false)
                  setAddingUser(false)
                }}
              />
              <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-[270px] max-w-full max-h-[calc(100dvh-140px)] overflow-y-auto overscroll-contain bg-white dark:bg-stone-900 rounded-3xl shadow-2xl border border-stone-100 dark:border-stone-800 p-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 px-3 pt-2 pb-1">
                  Usuarios locales
                </p>
                {/* Sin tope propio: el único scroll del desplegable es el de arriba, para no anidar dos. */}
                <div>
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onSelectProfile(p.id)
                        setOpenUsers(false)
                      }}
                      className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-2xl text-left ${
                        p.id === activeProfile.id
                          ? "bg-amber-50 dark:bg-amber-500/20"
                          : "hover:bg-stone-50 dark:hover:bg-stone-800"
                      }`}
                    >
                      <Avatar
                        profile={p}
                        className="w-8 h-8 rounded-xl text-[18px]"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 truncate font-semibold text-[16px] text-stone-700 dark:text-stone-200">
                            {p.name}
                          </span>
                          {p.id === activeProfile.id && (
                            <span className="text-amber-600 dark:text-amber-300 text-[15px] font-bold">
                              ✓
                            </span>
                          )}
                        </span>
                        {/* Los canales y calendarios de ESE usuario, igual que en Ajustes: con esto se ve de
                        un vistazo quién recibe avisos por dónde antes de elegirlo. */}
                        <ChannelBadges
                          profile={p}
                          size="sm"
                          wrap={false}
                          className="mt-1.5"
                        />
                      </span>
                    </button>
                  ))}
                </div>
                {addingUser ? (
                  <div className="border-t border-stone-100 dark:border-stone-800 mt-2 pt-2 px-1 pb-1 space-y-2">
                    <input
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      placeholder="Nombre (ej. Abuela)"
                      className="w-full bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-2 text-[16px] font-semibold border border-stone-100 dark:border-stone-800 outline-none focus:border-amber-400"
                    />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                      Su emoji o su foto
                    </p>
                    <AvatarEditor
                      emoji={newUserEmoji}
                      photo={newUserPhoto}
                      name={newUserName.trim() || "el usuario nuevo"}
                      onEmoji={setNewUserEmoji}
                      onPhoto={setNewUserPhoto}
                      size="sm"
                      className="pb-1"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={addUser}
                        className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-[15px] font-bold"
                      >
                        Agregar
                      </button>
                      <button
                        onClick={() => setAddingUser(false)}
                        className="w-10 h-10 rounded-xl bg-stone-100 dark:bg-stone-700 text-stone-500 dark:text-stone-300 text-[16px]"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setAddingUser(true)
                      setNewUserName("")
                      setNewUserEmoji(DEFAULT_PROFILE.emoji)
                      setNewUserPhoto("")
                    }}
                    className="w-full mt-1 py-2.5 rounded-2xl bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[15px] font-bold"
                  >
                    ＋ Nuevo usuario
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="px-5 pb-3">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
          {[{ name: "Todas", emoji: "✦" }, ...categories].map((cat) => (
            <button
              key={cat.name}
              onClick={() => setCategoryFilter(cat.name)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold border transition-colors ${
                categoryFilter === cat.name
                  ? "bg-amber-600 text-white border-amber-500"
                  : "bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-800"
              }`}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
          {/* Al final del carrusel, las dos puertas a las categorías propias: crear una nueva y ordenar
              o eliminar las que hay. Van punteadas y en ámbar para leerse como acciones y no como
              categorías más. */}
          <button
            type="button"
            onClick={() => setNuevaCategoria(true)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-bold border border-dashed border-amber-400 text-amber-700 dark:text-amber-300"
          >
            ＋ Nueva
          </button>
          <button
            type="button"
            onClick={() => setEditarCategorias(true)}
            aria-label="Editar categorías"
            className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-bold border border-dashed border-stone-300 dark:border-stone-600 text-stone-500 dark:text-stone-300"
          >
            ✎ Editar
          </button>
        </div>
      </div>
      <div className="px-5 pb-3">
        <div className="flex bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-full p-1">
          <button
            type="button"
            onClick={() => setView("vigentes")}
            className={`flex-1 py-2 rounded-full text-[13px] font-bold transition-colors ${
              view === "vigentes"
                ? "bg-amber-600 text-white"
                : "text-stone-500 dark:text-stone-400"
            }`}
          >
            Vigentes
          </button>
          <button
            type="button"
            onClick={() => setView("vencidos")}
            className={`flex-1 py-2 rounded-full text-[13px] font-bold transition-colors ${
              view === "vencidos"
                ? "bg-amber-600 text-white"
                : "text-stone-500 dark:text-stone-400"
            }`}
          >
            Vencidos
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        {view === "vigentes" ? (
          active.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <span className="text-5xl mb-4">✨</span>
              <h3 className="font-bold text-[18px] text-stone-800 dark:text-stone-100">
                {categoryFilter === "Todas"
                  ? "Todo bajo control"
                  : "No hay recordatorios aquí"}
              </h3>
              <p className="text-stone-400 text-[14px] mt-2 mb-6">
                {categoryFilter === "Todas"
                  ? "No tienes recordatorios activos."
                  : "Prueba otra categoría o agrega uno nuevo."}
              </p>
              {/* Al agregar desde una categoría vacía, el recordatorio nuevo llega con ESA categoría ya
                elegida: es lo que se estaba mirando, así no hay que volver a buscarla en el formulario. */}
              <button
                onClick={() =>
                  onAdd(categoryFilter === "Todas" ? undefined : categoryFilter)
                }
                className="px-6 py-3 bg-amber-600 text-white rounded-xl font-semibold text-[14px]"
              >
                Agregar recordatorio
              </button>
            </div>
          ) : (
            <>
              {upcoming.length > 0 && (
                <section className="mb-6">
                  <button
                    type="button"
                    onClick={() => setOpenUpcoming((v) => !v)}
                    className="w-full flex items-center justify-between mb-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <h2 className="text-[11px] font-bold tracking-widest text-stone-400 uppercase">
                        Próximamente
                      </h2>
                      <span className="text-[11px] font-semibold text-amber-500 dark:text-amber-300">
                        {upcoming.length}{" "}
                        {upcoming.length === 1 ? "evento" : "eventos"}
                      </span>
                    </div>
                    <span
                      className="text-stone-400 text-lg leading-none transition-transform duration-200"
                      style={{
                        transform: openUpcoming
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                      }}
                    >
                      ⌄
                    </span>
                  </button>
                  {openUpcoming &&
                    upcoming.map((e) => (
                      <EventCard
                        key={e.id}
                        event={e}
                        clock12={clock12}
                        onClick={() => onEventClick(e.id)}
                      />
                    ))}
                </section>
              )}
              {rest.length > 0 && (
                <section className="mb-6">
                  <button
                    type="button"
                    onClick={() => setOpenRest((v) => !v)}
                    className="w-full flex items-center justify-between mb-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <h2 className="text-[11px] font-bold tracking-widest text-stone-400 uppercase">
                        Más adelante
                      </h2>
                      <span className="text-[11px] font-semibold text-stone-400">
                        {rest.length} {rest.length === 1 ? "evento" : "eventos"}
                      </span>
                    </div>
                    <span
                      className="text-stone-400 text-lg leading-none transition-transform duration-200"
                      style={{
                        transform: openRest ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    >
                      ⌄
                    </span>
                  </button>
                  {openRest &&
                    rest.map((e) => (
                      <EventCard
                        key={e.id}
                        event={e}
                        clock12={clock12}
                        onClick={() => onEventClick(e.id)}
                      />
                    ))}
                </section>
              )}
            </>
          )
        ) : overdue.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <span className="text-5xl mb-4">✅</span>
            <h3 className="font-bold text-[18px] text-stone-800 dark:text-stone-100">
              {categoryFilter === "Todas"
                ? "Nada vencido"
                : "No hay vencidos aquí"}
            </h3>
            <p className="text-stone-400 text-[14px] mt-2 mb-6">
              {categoryFilter === "Todas"
                ? "Los recordatorios con fecha pasada aparecerán automáticamente aquí."
                : "Prueba otra categoría para ver sus vencidos."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-bold tracking-widest text-stone-400 uppercase">
                Vencidos
              </h2>
              <span className="text-[11px] font-semibold text-stone-400">
                {overdue.length} {overdue.length === 1 ? "evento" : "eventos"}
              </span>
            </div>
            {overdue.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                clock12={clock12}
                onClick={() => onEventClick(e.id)}
              />
            ))}
          </>
        )}
      </div>
      {nuevaCategoria && (
        <CategorySheet
          categories={categories}
          onSave={(name, emoji) => {
            onAddCategory(name, emoji)
            setCategoryFilter(name)
          }}
          onClose={() => setNuevaCategoria(false)}
        />
      )}
      {editarCategorias && (
        <CategoriesEditor
          categories={categories}
          counts={cuantosDe}
          onMove={onMoveCategory}
          onRemove={onRemoveCategory}
          onClose={() => setEditarCategorias(false)}
        />
      )}
    </div>
  )
}

// Campo de hora propio: los <input type="time"> del navegador siguen el idioma del sistema y no se
// pueden forzar a 12 h, así que el formato lo decide Ajustes y la hora se elige con listas: hora,
// minutos y, en formato de 12 h, a.m./p.m. Por dentro el recordatorio sigue guardando "HH:MM" de 24 h.
function TimeField({
  value,
  onChange,
  clock12,
}: {
  value: string
  onChange: (v: string) => void
  clock12: boolean
}) {
  const [hRaw, mRaw] = (value || "12:00").split(":")
  const hour24 = Math.min(23, Math.max(0, Number(hRaw) || 0))
  const minute = Math.min(59, Math.max(0, Number(mRaw) || 0))
  const pm = hour24 >= 12
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  const put = (h: number, mi: number) => onChange(`${pad2(h)}:${pad2(mi)}`)
  const field =
    "bg-white dark:bg-stone-900 rounded-2xl px-2 py-4 text-[15px] font-semibold text-stone-800 dark:text-stone-100 border border-stone-100 dark:border-stone-800 outline-none focus:border-amber-400"
  return (
    <div role="group" aria-label="Hora" className="flex items-center gap-1.5">
      <select
        aria-label="Hora"
        value={clock12 ? hour12 : hour24}
        onChange={(e) => {
          const v = Number(e.target.value)
          put(clock12 ? (pm ? (v % 12) + 12 : v % 12) : v, minute)
        }}
        className={field}
      >
        {Array.from({ length: clock12 ? 12 : 24 }, (_, i) =>
          clock12 ? i + 1 : i,
        ).map((h) => (
          <option key={h} value={h}>
            {clock12 ? h : pad2(h)}
          </option>
        ))}
      </select>
      <span className="text-stone-400 font-bold">:</span>
      <select
        aria-label="Minutos"
        value={minute}
        onChange={(e) => put(hour24, Number(e.target.value))}
        className={field}
      >
        {Array.from({ length: 60 }, (_, i) => i).map((mi) => (
          <option key={mi} value={mi}>
            {pad2(mi)}
          </option>
        ))}
      </select>
      {clock12 && (
        <select
          aria-label="a.m. o p.m."
          value={pm ? "pm" : "am"}
          onChange={(e) => {
            const isPm = e.target.value === "pm"
            put((hour12 % 12) + (isPm ? 12 : 0), minute)
          }}
          className={field}
        >
          <option value="am">a.m.</option>
          <option value="pm">p.m.</option>
        </select>
      )}
    </div>
  )
}

// Fila de un calendario en el formulario: logo, título, qué pasa si está encendido y su interruptor.
// Las tres filas —Google, Apple y Outlook— se arman con la misma pieza para que se vean y se manejen
// igual, y para que agregar un cuarto calendario mañana sea una fila más.
function CalendarToggle({
  app,
  on,
  onToggle,
}: {
  app: CalendarApp
  on: boolean
  onToggle: () => void
}) {
  const logo =
    app === "google" ? (
      <GoogleG className="w-5 h-5" />
    ) : app === "apple" ? (
      <AppleG className="w-5 h-5" />
    ) : (
      <OutlookG className="w-5 h-5" />
    )
  const title = `Agregar a ${CALENDAR_LABELS[app]}`
  const onText =
    app === "google"
      ? "Al guardar se abre Google Calendar con el evento listo."
      : app === "apple"
        ? "Al guardar se descarga el .ics: tu iPhone o tu Mac lo abre en Calendario."
        : "Al guardar se abre Outlook con el evento listo."
  const offText =
    app === "google"
      ? "Apagado: este recordatorio no irá a Google Calendar."
      : app === "apple"
        ? "Apagado: no se descarga el archivo para Apple Calendar."
        : "Apagado: este recordatorio no irá a Outlook."
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-100 dark:border-stone-800 flex items-center justify-center flex-shrink-0">
        {logo}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
          {title}
        </p>
        <p className="text-[12px] text-stone-400">{on ? onText : offText}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        aria-label={title}
        className={`w-11 h-6 rounded-full flex-shrink-0 transition-colors ${
          on ? "bg-amber-500" : "bg-stone-200 dark:bg-stone-600"
        }`}
      >
        <div
          className={`w-5 h-5 bg-white rounded-full shadow mx-0.5 transition-transform ${
            on ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  )
}

// Tarjeta de Apple Calendar o Outlook en Ajustes › Calendario. Se conectan igual que Google Calendar
// —conectar, sincronizar ahora, desconectar y «Todos los avisos»—, pero lo que hacen de verdad es
// distinto: en el navegador no hay una cuenta que conectar, así que «Sincronizar ahora» descarga un
// solo archivo .ics con todos los recordatorios de ese usuario para que la app de calendario lo
// importe (Apple Calendar en el iPhone o el Mac, Outlook en el escritorio), y Outlook además tiene su
// enlace por recordatorio desde el formulario y el detalle.
function CalendarSyncCard({
  app,
  state,
  events,
  userName,
  onUpdate,
  bare = false,
}: {
  app: CalendarApp
  state: CalendarAppState
  events: Reminder[]
  userName: string
  onUpdate: (next: CalendarAppState) => void
  bare?: boolean
}) {
  const [busy, setBusy] = useState<"" | "connect" | "sync">("")
  const [msg, setMsg] = useState("")
  const label = CALENDAR_LABELS[app]
  const syncAll = calendarSyncsAll(state)
  const logo =
    app === "apple" ? (
      <AppleG className="w-5 h-5" />
    ) : (
      <OutlookG className="w-5 h-5" />
    )
  const connect = () => {
    setBusy("connect")
    setMsg("")
    window.setTimeout(() => {
      onUpdate({ ...state, connected: true, syncAll: true })
      setBusy("")
      setMsg(
        `${label} queda listo: los recordatorios nuevos vienen con este calendario activado.`,
      )
    }, 1200)
  }
  const disconnect = () => {
    onUpdate({ connected: false })
    setMsg("")
  }
  const syncNow = () => {
    setBusy("sync")
    setMsg("")
    window.setTimeout(() => {
      if (events.length) downloadIcsForAll(events, userName)
      onUpdate({
        ...state,
        connected: true,
        lastSync: new Date().toISOString(),
        lastCount: events.length,
      })
      setBusy("")
      setMsg(
        events.length === 0
          ? "Todavía no tienes recordatorios que sincronizar."
          : `${events.length} ${
              events.length === 1
                ? "recordatorio listo"
                : "recordatorios listos"
            } para ${label}: se descargó el archivo con todos.`,
      )
    }, 1500)
  }
  const toggleSyncAll = () => {
    onUpdate({ ...state, syncAll: !syncAll })
    setMsg(
      syncAll
        ? `Listo: los recordatorios nuevos se crean sin ${label}; puedes encenderlo en cada uno.`
        : `Listo: los recordatorios nuevos vienen con ${label} activado.`,
    )
  }
  // bare: dentro del desplegable de Ajustes los tres calendarios comparten una sola burbuja blanca y se
  // separan con líneas; sin bare (uso suelto) la tarjeta trae su propia burbuja.
  const content = (
    <>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-100 dark:border-stone-800 flex items-center justify-center flex-shrink-0">
          {logo}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
            {label}
          </p>
          <p className="text-[12px] text-stone-400">
            {state.connected
              ? state.lastSync
                ? `Conectado · Última sincronización ${timeAgo(state.lastSync)}`
                : "Conectado · Sincroniza cuando quieras"
              : "Sin conectar"}
          </p>
        </div>
        {state.connected && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex-shrink-0">
            ✓ Conectado
          </span>
        )}
      </div>
      <div className="flex gap-2 mt-4">
        {state.connected ? (
          <>
            <button
              onClick={syncNow}
              disabled={busy !== ""}
              className="flex-1 py-3 rounded-2xl bg-amber-600 text-white text-[13px] font-bold disabled:opacity-60"
            >
              {busy === "sync" ? "Sincronizando…" : "Sincronizar ahora"}
            </button>
            <button
              onClick={disconnect}
              className="px-4 py-3 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[13px] font-semibold"
            >
              Desconectar
            </button>
          </>
        ) : (
          <button
            onClick={connect}
            disabled={busy !== ""}
            className={`flex-1 py-3 rounded-2xl text-white text-[13px] font-bold disabled:opacity-60 ${
              app === "apple"
                ? "bg-stone-900 dark:bg-stone-700"
                : "bg-[#0F6CBD]"
            }`}
          >
            {busy === "connect" ? "Conectando…" : `Conectar con ${label}`}
          </button>
        )}
      </div>
      {state.connected && (
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-stone-50 dark:border-stone-800">
          <span className="text-[15px]">🗓️</span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
              Todos los avisos
            </p>
            <p className="text-[12px] text-stone-400">
              {syncAll
                ? `Los recordatorios nuevos vienen con ${label} activado; puedes apagarlo en cada uno.`
                : `Los recordatorios nuevos se crean sin ${label}; puedes encenderlo en cada uno.`}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleSyncAll}
            aria-pressed={syncAll}
            aria-label={`Sincronizar todos los avisos con ${label}`}
            className={`w-11 h-6 rounded-full flex-shrink-0 transition-colors ${
              syncAll ? "bg-amber-500" : "bg-stone-200 dark:bg-stone-600"
            }`}
          >
            <div
              className={`w-5 h-5 bg-white rounded-full shadow mx-0.5 transition-transform ${
                syncAll ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
      )}
      <p className="text-[12px] text-stone-400 mt-3">
        {events.length === 0
          ? `Todavía no tienes recordatorios de ${userName} para sincronizar.`
          : `${events.length} ${
              events.length === 1 ? "recordatorio" : "recordatorios"
            } de ${userName}: «Sincronizar ahora» baja un solo archivo con todos.`}
      </p>
      {msg && (
        <p className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 mt-2">
          {msg}
        </p>
      )}
      <p className="text-[11px] text-stone-400 mt-2">
        {app === "apple"
          ? "Sin cuenta que conectar en el navegador: el archivo .ics se abre en la app Calendario del iPhone o del Mac y ahí queda cada recordatorio con sus avisos."
          : "Sin cuenta que conectar en el navegador: el archivo .ics se importa en Outlook desde el escritorio y, además, cada recordatorio se puede abrir en Outlook web con el evento ya rellenado."}
      </p>
    </>
  )
  return bare ? (
    <div>{content}</div>
  ) : (
    <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 p-5 mb-4">
      {content}
    </div>
  )
}

function CreateScreen({
  initial,
  initialDate,
  initialCategory,
  onClose,
  onSave,
  profiles,
  activeProfileId,
  categories,
  onAddCategory,
  clock12,
}: {
  initial?: Reminder
  initialDate?: string
  initialCategory?: string
  onClose: () => void
  onSave: (r: Reminder, files: File[]) => void
  profiles: Profile[]
  activeProfileId: string
  categories: Category[]
  onAddCategory: (name: string, emoji: string) => void
  clock12: boolean
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [date, setDate] = useState(initial?.date ?? initialDate ?? dateKey())
  const [time, setTime] = useState(initial?.time ?? "12:00")
  // La categoría preseleccionada: la del recordatorio que se edita; si es nuevo, la que se estaba
  // mirando en Inicio (se llega desde una categoría vacía). Sin ninguna de las dos, la primera de la
  // lista (y si alguien borró todas, una genérica para no quedarse sin categoría).
  const [category, setCategory] = useState<Category>(
    categories.find((c) => c.name === (initial?.category ?? initialCategory)) ??
      categories[0] ?? { name: "", emoji: CATEGORY_EMOJI },
  )
  // La hoja para crear una categoría sin salir del formulario: la nueva queda elegida al crearla.
  const [nuevaCategoria, setNuevaCategoria] = useState(false)
  const [ownerId, setOwnerId] = useState(
    initial?.ownerId ||
      activeProfileId ||
      profiles[0]?.id ||
      DEFAULT_PROFILE_ID,
  )
  const [notes, setNotes] = useState(initial?.notes ?? "")
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [recurrence, setRecurrence] = useState(
    initial?.recurrence ?? "No se repite",
  )
  const [customInterval, setCustomInterval] = useState<string>(
    initial?.recurrenceInterval ? String(initial.recurrenceInterval) : "",
  )
  const [customUnit, setCustomUnit] = useState<Reminder["recurrenceUnit"]>(
    initial?.recurrenceUnit ?? "meses",
  )
  const [reminders, setReminders] = useState<number[]>(
    initial?.remindersBefore ?? [30, 7, 1, HOUR_OFFSET],
  )
  const [customReminders, setCustomReminders] = useState<ReminderAlert[]>(
    initial?.customReminders ?? [],
  )
  const [customReminderAmount, setCustomReminderAmount] = useState("")
  const [customReminderUnit, setCustomReminderUnit] =
    useState<ReminderAlert["unit"]>("días")
  const [isRecording, setIsRecording] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [isLandscape, setIsLandscape] = useState(false)
  const [facing, setFacing] = useState<"environment" | "user">("environment")
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  // El input de archivos de siempre, escondido: es el respaldo de los navegadores que no traen el
  // selector del sistema (ver openFilePicker).
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const [channels, setChannels] = useState<string[]>(
    initial?.channels ?? ["Notificación"],
  )
  // Opciones de calendario por recordatorio: al guardar se puede mandar el evento a
  // Google Calendar (se abre ya rellenado) y/o descargar el archivo .ics.
  // Si la cuenta de Google Calendar del usuario dueño quedó conectada en Ajustes, los recordatorios
  // NUEVOS vienen con la opción ya activada (el interruptor se puede apagar); si ese usuario apagó
  // "Todos los avisos", se crean sin marcar. Al editar se respeta lo que ya tenía guardado.
  const ownerProfile =
    profiles.find((p) => p.id === (ownerId || activeProfileId)) ??
    profiles[0] ??
    DEFAULT_PROFILE
  // Los calendarios del usuario dueño del recordatorio: si tiene la cuenta conectada en Ajustes con
  // «Todos los avisos», los recordatorios nuevos vienen con ese calendario ya marcado.
  const gcalSettings = ownerProfile.gcal ?? DEFAULT_GCAL
  const gcalLinked = gcalSettings.connected
  const gcalAll = gcalSettings.syncAll !== false
  const linkedInSettings = (app: CalendarApp) => {
    const s = calendarStateOf(ownerProfile, app)
    return s.connected && calendarSyncsAll(s)
  }
  const [addToGcal, setAddToGcal] = useState(
    () => !!initial?.gcalAddedAt || (!initial && gcalLinked && gcalAll),
  )
  const [addToApple, setAddToApple] = useState(
    () => !!initial?.appleAddedAt || (!initial && linkedInSettings("apple")),
  )
  const [addToOutlook, setAddToOutlook] = useState(
    () =>
      !!initial?.outlookAddedAt || (!initial && linkedInSettings("outlook")),
  )
  // Canales que el usuario elegido todavía no tiene listos (sin número, sin correo o con el canal
  // apagado en Ajustes): el recordatorio se guarda igual, pero esos avisos salen por notificación.
  const missingChannels = channels.filter((c) => !channelReady(ownerProfile, c))
  const [error, setError] = useState("")
  const toggle = (n: number) =>
    setReminders((r) =>
      r.includes(n)
        ? r.filter((x) => x !== n)
        : [...r, n].sort((a, b) => b - a),
    )
  const toggleChannel = (c: string) =>
    setChannels((v) => (v.includes(c) ? v.filter((x) => x !== c) : [...v, c]))
  const addCustomReminder = () => {
    const amount = Math.max(1, Math.floor(Number(customReminderAmount) || 1))
    const alert: ReminderAlert = { id: uid(), amount, unit: customReminderUnit }
    const days = alertToDays(alert)
    const repeated =
      reminders.some((d) => Math.abs(d - days) < 1e-9) ||
      customReminders.some((r) => Math.abs(alertToDays(r) - days) < 1e-9)
    if (repeated) return setError("Ese aviso ya está agregado.")
    setCustomReminders((v) =>
      [...v, alert].sort((a, b) => alertToDays(b) - alertToDays(a)),
    )
    setError("")
  }
  const removeCustomReminder = (id: string) =>
    setCustomReminders((v) => v.filter((r) => r.id !== id))
  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return
    setPendingFiles((v) => [...v, ...Array.from(list)])
  }
  // Adjuntar archivos: se prefiere el selector de archivos del sistema (showOpenFilePicker), que abre
  // el explorador y no ofrece la cámara —la app ya tiene su propio botón «Sacar foto»—; si el navegador
  // no lo trae (Safari de iPhone, Firefox) se usa el input de siempre, que en el teléfono sí puede
  // ofrecer la cámara desde el sistema: eso lo decide el navegador y la página no puede quitarlo.
  const openFilePicker = async () => {
    const picker = (window as unknown as {
      showOpenFilePicker?: (
        options: unknown,
      ) => Promise<{ getFile: () => Promise<File> }[]>
    }).showOpenFilePicker
    if (typeof picker !== "function") {
      fileInputRef.current?.click()
      return
    }
    try {
      const handles = await picker({
        multiple: true,
        excludeAcceptAllOption: false,
        types: [{ description: "Imágenes y documentos", accept: FILE_TYPES }],
      })
      const files = await Promise.all(handles.map((handle) => handle.getFile()))
      if (files.length) addFiles(files)
    } catch (e) {
      // Cerrar el selector no es un error que haya que atender; si fue el navegador el que lo bloqueó,
      // se recurre al input clásico para no dejar a la persona sin manera de adjuntar.
      if ((e as DOMException | null)?.name !== "AbortError")
        fileInputRef.current?.click()
    }
  }
  const startAudioRecording = async () => {
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error("unsupported")
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime =
        ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) =>
          MediaRecorder.isTypeSupported(t),
        ) || ""
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      )
      recordedChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size) recordedChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm"
        const ext = type.includes("mp4") ? "m4a" : "webm"
        const file = new File(
          [new Blob(recordedChunksRef.current, { type })],
          `nota-de-voz-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`,
          { type },
        )
        setPendingFiles((v) => [...v, file])
        stream.getTracks().forEach((t) => t.stop())
        setIsRecording(false)
      }
      recorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      setError("")
    } catch {
      setError(
        "No se pudo acceder al micrófono. Revisa los permisos del navegador.",
      )
    }
  }
  const stopAudioRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive")
      recorderRef.current.stop()
  }
  const requestCamera = async (mode: "environment" | "user") => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported")
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: mode } },
      audio: false,
    })
    cameraStreamRef.current = stream
    setFacing(mode)
    setCameraReady(false)
    window.setTimeout(() => {
      const v = videoRef.current
      if (v && cameraStreamRef.current === stream) {
        v.srcObject = stream
        v.play().catch(() => {})
      }
      setCameraReady(true)
    }, 80)
  }
  const openCamera = async () => {
    try {
      setCameraOpen(true)
      setError("")
      await requestCamera("environment")
    } catch {
      setCameraOpen(false)
      setError("No se pudo abrir la cámara. Revisa los permisos del navegador.")
    }
  }
  const flipCamera = async () => {
    try {
      await requestCamera(facing === "environment" ? "user" : "environment")
    } catch {
      setError(
        "No se pudo cambiar de cámara. Revisa los permisos del navegador.",
      )
    }
  }
  const closeCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
    cameraStreamRef.current = null
    setCameraOpen(false)
    setCameraReady(false)
  }
  const takePhoto = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (blob)
          setPendingFiles((v) => [
            ...v,
            new File(
              [blob],
              `foto-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
              { type: "image/jpeg" },
            ),
          ])
        closeCamera()
      },
      "image/jpeg",
      0.92,
    )
  }
  useEffect(
    () => () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
      if (recorderRef.current && recorderRef.current.state !== "inactive")
        recorderRef.current.stop()
    },
    [],
  )
  useEffect(() => {
    const update = () =>
      setIsLandscape(
        typeof window !== "undefined" && window.innerWidth > window.innerHeight,
      )
    update()
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
    }
  }, [])
  useEffect(() => {
    if (!cameraOpen || !cameraStreamRef.current) return
    const t = window.setTimeout(() => {
      const v = videoRef.current
      const s = cameraStreamRef.current
      if (v && s) {
        v.srcObject = s
        v.play().catch(() => {})
      }
      setCameraReady(true)
    }, 60)
    return () => window.clearTimeout(t)
  }, [cameraOpen, isLandscape])
  const save = () => {
    if (!name.trim()) return setError("Escribe qué quieres recordar.")
    if (!date) return setError("Selecciona una fecha.")
    if (!reminders.length)
      return setError("Selecciona al menos un recordatorio.")
    if (
      recurrence === "Personalizada" &&
      (!customInterval.trim() ||
        Math.floor(Number(customInterval)) < 1 ||
        !customUnit)
    )
      return setError(
        "Define un intervalo válido para la repetición personalizada.",
      )
    const id = initial?.id ?? uid()
    const existing = initial?.attachments ?? []
    const newMeta = pendingFiles.map((file) => ({
      id: uid(),
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
    }))
    const draft: Reminder = {
      id,
      ownerId: ownerId || DEFAULT_PROFILE_ID,
      name: name.trim(),
      date,
      time,
      category: category.name,
      categoryEmoji: category.emoji,
      recurrence,
      recurrenceInterval:
        recurrence === "Personalizada"
          ? Math.floor(Number(customInterval))
          : undefined,
      recurrenceUnit: recurrence === "Personalizada" ? customUnit : undefined,
      remindersBefore: reminders,
      customReminders,
      channels,
      notes: notes.trim() || undefined,
      attachments: [...existing, ...newMeta],
      completed: initial?.completed ?? false,
      history: initial?.history,
      gcalAddedAt: calendarStampFor(addToGcal, initial?.gcalAddedAt),
      appleAddedAt: calendarStampFor(addToApple, initial?.appleAddedAt),
      outlookAddedAt: calendarStampFor(addToOutlook, initial?.outlookAddedAt),
    }
    // Los enlaces y la descarga se disparan aquí, dentro del mismo clic y antes de guardar: si se
    // abrieran después de un await, el navegador los tomaría como ventana emergente y los bloquearía.
    if (addToGcal)
      window.open(googleCalendarUrl(draft), "_blank", "noopener,noreferrer")
    if (addToOutlook)
      window.open(outlookCalendarUrl(draft), "_blank", "noopener,noreferrer")
    if (addToApple) downloadIcs(draft)
    onSave(draft, pendingFiles)
  }
  return (
    <div className="flex flex-col h-full app-bg dark:bg-stone-950">
      <Header
        title={initial ? "Editar recordatorio" : "Nuevo recordatorio"}
        onBack={onClose}
      />
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          ¿Qué quieres recordar?
        </label>
        <input
          className="w-full bg-white dark:bg-stone-900 rounded-2xl px-4 py-4 text-[16px] font-medium border border-stone-100 dark:border-stone-800 outline-none focus:border-amber-400 mb-6"
          placeholder="Ej. Renovar licencia de conducir"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          Recordar para
        </label>
        <div className="flex gap-2 flex-wrap mb-6">
          {profiles.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => setOwnerId(p.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold border ${
                ownerId === p.id
                  ? "bg-amber-600 text-white border-amber-500"
                  : "bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-800"
              }`}
            >
              <span className="text-[15px] leading-none">{p.emoji}</span>
              {p.name}
            </button>
          ))}
        </div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          Categoría
        </label>
        <div className="flex gap-2 flex-wrap mb-6">
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setCategory(cat)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border ${
                category.name === cat.name
                  ? "bg-amber-600 text-white border-amber-500"
                  : "bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-800"
              }`}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
          {/* Crear una categoría sin salir del formulario: se guarda en la lista y queda elegida. */}
          <button
            type="button"
            onClick={() => setNuevaCategoria(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-bold border border-dashed border-amber-400 text-amber-700 dark:text-amber-300"
          >
            ＋ Nueva
          </button>
        </div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          Notas
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full bg-white dark:bg-stone-900 rounded-2xl px-4 py-4 text-[14px] border border-stone-100 dark:border-stone-800 outline-none focus:border-amber-400 resize-none mb-6"
          placeholder="Agrega detalles, instrucciones, datos importantes..."
        />
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          Archivos
        </label>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <button
            type="button"
            onClick={openFilePicker}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl py-3 flex flex-col items-center gap-1"
          >
            <span className="text-xl leading-none">📂🖼️</span>
            <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-300 text-center leading-tight">
              Imagen o documento
            </span>
          </button>
          <button
            type="button"
            onClick={isRecording ? stopAudioRecording : startAudioRecording}
            className={`bg-white dark:bg-stone-900 border rounded-2xl py-3 flex flex-col items-center gap-1 ${
              isRecording
                ? "border-red-300 bg-red-50 dark:bg-red-500/10"
                : "border-stone-200 dark:border-stone-800"
            }`}
          >
            <span className="text-xl">{isRecording ? "⏹️" : "🎙️"}</span>
            <span
              className={`text-[11px] font-semibold ${
                isRecording
                  ? "text-red-600 dark:text-red-400"
                  : "text-stone-600 dark:text-stone-300"
              }`}
            >
              {isRecording ? "Detener" : "Grabar voz"}
            </span>
          </button>
          <button
            type="button"
            onClick={openCamera}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl py-3 flex flex-col items-center gap-1"
          >
            <span className="text-xl">📷</span>
            <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-300">
              Sacar foto
            </span>
          </button>
        </div>
        {/* Respaldo de los navegadores sin selector del sistema: en el teléfono su propio selector puede
        ofrecer la cámara, por eso se usa solo cuando no hay otra manera de elegir archivos. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ""
          }}
        />
        {pendingFiles.length > 0 && (
          <div className="space-y-2 mb-6">
            {pendingFiles.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="bg-white dark:bg-stone-900 rounded-xl border border-stone-100 dark:border-stone-800 px-3 py-2 flex items-center gap-2"
              >
                <span>{attachmentIcon(file.type)}</span>
                <span className="min-w-0 flex-1 text-[12px] font-medium truncate">
                  {file.name}
                </span>
                <span className="text-[10px] text-stone-400">
                  {formatFileSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingFiles((v) => v.filter((_, j) => j !== i))
                  }
                  className="text-stone-400 px-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Fecha y hora van en su propia sección, más separadas de Archivos. Fecha se ajusta al ancho de
        su contenido para que Hora se vea entera (con su a.m./p.m. cuando el formato es de 12 h) y, si
        la pantalla es muy angosta, Hora baja a otra línea en vez de recortarse. */}
        <div className="mt-8 mb-6 flex flex-wrap items-start gap-2">
          <div className="min-w-[136px] flex-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
              Fecha
            </label>
            <input
              type="date"
              className="w-full bg-white dark:bg-stone-900 rounded-2xl px-4 py-4 text-[15px] border border-stone-100 dark:border-stone-800"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex-shrink-0">
            <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
              Hora
            </label>
            <TimeField value={time} onChange={setTime} clock12={clock12} />
          </div>
        </div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          ¿Se repite?
        </label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {(recurrence && !RECURRENCE_OPTIONS.includes(recurrence)
            ? [...RECURRENCE_OPTIONS, recurrence]
            : RECURRENCE_OPTIONS
          ).map((o) => (
            <button
              key={o}
              onClick={() => setRecurrence(o)}
              className={`py-3 rounded-xl text-[13px] font-semibold border ${
                recurrence === o
                  ? "bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-300/60 ring-2 ring-amber-300 dark:ring-amber-500/40"
                  : "bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-800"
              }`}
            >
              {o === "Personalizada" ? "🐝 Personalizada" : o}
            </button>
          ))}
        </div>
        {recurrence === "Personalizada" && (
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-amber-100 p-4 mb-6">
            <p className="text-[12px] text-stone-400 mb-2">Repetir cada</p>
            <div className="grid grid-cols-[1fr_1.5fr] gap-2">
              <input
                type="number"
                min="1"
                step="1"
                value={customInterval}
                onChange={(e) =>
                  setCustomInterval(e.target.value.replace(/[^\d]/g, ""))
                }
                className="w-full bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-3 text-[15px] font-semibold border border-stone-100 dark:border-stone-800"
              />
              <select
                value={customUnit}
                onChange={(e) =>
                  setCustomUnit(e.target.value as Reminder["recurrenceUnit"])
                }
                className="w-full bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-3 text-[15px] font-semibold border border-stone-100 dark:border-stone-800"
              >
                {RECURRENCE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[12px] text-amber-600 dark:text-amber-300 font-semibold mt-3">
              {recurrenceLabel(
                "Personalizada",
                customInterval
                  ? Math.max(1, Math.floor(Number(customInterval)))
                  : undefined,
                customUnit,
              )}
            </p>
          </div>
        )}
        {/* «¿Cuándo te aviso?»: los avisos elegidos van con sombra y anillo, así se ve de un vistazo cuáles
        están encendidos (antes todos los botones se parecían demasiado). */}
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          ¿Cuándo te aviso?
        </label>
        <div className="flex gap-2 flex-wrap mb-3">
          {PRESET_OFFSETS.map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => toggle(n)}
              aria-pressed={reminders.includes(n)}
              className={`px-3 py-2 rounded-full text-[12px] font-semibold border transition-shadow ${
                reminders.includes(n)
                  ? "bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-300/70 ring-2 ring-amber-300 dark:ring-amber-500/40"
                  : "bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-800"
              }`}
            >
              {offsetLabel(n)} antes
            </button>
          ))}
        </div>
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 p-4 mb-6">
          <p className="text-[12px] font-semibold text-stone-500 dark:text-stone-400 mb-3">
            Avisos personalizados
          </p>
          {customReminders.length > 0 && (
            <div className="space-y-2 mb-3">
              {customReminders.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-2"
                >
                  <span className="text-[12px] font-semibold text-stone-700 dark:text-stone-200">
                    🔔 {alertLabel(r)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCustomReminder(r.id)}
                    className="text-stone-400 px-2"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2">
            <input
              type="number"
              min="1"
              step="1"
              value={customReminderAmount}
              onChange={(e) => setCustomReminderAmount(e.target.value)}
              className="w-full bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-2.5 text-[13px] font-semibold border border-stone-100 dark:border-stone-800"
            />
            <select
              value={customReminderUnit}
              onChange={(e) =>
                setCustomReminderUnit(e.target.value as ReminderAlert["unit"])
              }
              className="w-full bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-2.5 text-[13px] font-semibold border border-stone-100 dark:border-stone-800"
            >
              <option value="horas">horas antes</option>
              <option value="días">días antes</option>
              <option value="semanas">semanas antes</option>
              <option value="meses">meses antes</option>
            </select>
            <button
              type="button"
              onClick={addCustomReminder}
              className="px-3 rounded-xl bg-amber-600 text-white flex items-center justify-center"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-stone-400 mt-2">
            Puedes agregar todos los avisos que quieras.
          </p>
        </div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          Canales
        </label>
        <div className="flex gap-2 flex-wrap mb-3">
          {["Notificación", "WhatsApp", "Correo"].map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => toggleChannel(c)}
              className={`inline-flex items-center gap-1 px-4 py-2 rounded-full text-[12px] font-semibold border ${
                channels.includes(c)
                  ? "bg-amber-600 text-white border-amber-500"
                  : "bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-800"
              }`}
            >
              <ChannelIcon channel={c} className="w-4 h-4" /> {c}
            </button>
          ))}
        </div>
        {missingChannels.length > 0 && (
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mb-6">
            {ownerProfile.name} todavía no tiene configurado{" "}
            {missingChannels.map((c, i) => (
              <span key={c} className="whitespace-nowrap">
                {i > 0 && " ni "}
                <ChannelIcon
                  channel={c}
                  className="w-3.5 h-3.5 inline-block align-[-2px]"
                />{" "}
                {c}
              </span>
            ))}
            : ese aviso saldrá por notificación. Puedes configurarlo en Ajustes
            › Contacto.
          </p>
        )}
        {/* Calendario de ESTE recordatorio: se puede mandar a Google Calendar (enlace que abre el evento
        rellenado), a Apple Calendar (se descarga el .ics y lo abre la app Calendario) y a Outlook
        (enlace que abre el evento rellenado). Los tres se eligen por separado. */}
        <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block">
          Calendario
        </label>
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 p-4 mb-6">
          <CalendarToggle
            app="google"
            on={addToGcal}
            onToggle={() => setAddToGcal((v) => !v)}
          />
          <div className="mt-4 pt-4 border-t border-stone-50 dark:border-stone-800">
            <CalendarToggle
              app="apple"
              on={addToApple}
              onToggle={() => setAddToApple((v) => !v)}
            />
          </div>
          <div className="mt-4 pt-4 border-t border-stone-50 dark:border-stone-800">
            <CalendarToggle
              app="outlook"
              on={addToOutlook}
              onToggle={() => setAddToOutlook((v) => !v)}
            />
          </div>
          {gcalLinked && gcalAll && (
            <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-3">
              Google Calendar está conectado en Ajustes: los recordatorios
              nuevos vienen con esta opción activada.
            </p>
          )}
          {gcalLinked && !gcalAll && (
            <p className="text-[11px] font-semibold text-stone-400 mt-3">
              En Ajustes apagaste «Todos los avisos» de Google Calendar: este
              recordatorio va a tu calendario solo si lo enciendes aquí.
            </p>
          )}
          {(["apple", "outlook"] as CalendarApp[]).map(
            (app) =>
              linkedInSettings(app) && (
                <p
                  key={app}
                  className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-2"
                >
                  {CALENDAR_LABELS[app]} está conectado en Ajustes: los
                  recordatorios nuevos vienen con esta opción activada.
                </p>
              ),
          )}
          <p className="text-[11px] text-stone-400 mt-3">
            Google Calendar y Outlook se abren con el evento ya rellenado: solo
            confirmas y guardas. Apple Calendar recibe el archivo .ics, que tu
            iPhone o tu Mac abren en la app Calendario con estos mismos avisos.
            Si el navegador bloquea la ventana, usa el botón Calendario en el
            detalle del recordatorio.
          </p>
        </div>
        {error && (
          <p className="text-red-500 dark:text-red-400 text-[12px] mb-3">
            {error}
          </p>
        )}
        <button
          onClick={save}
          className="w-full py-4 rounded-2xl bg-amber-600 text-white font-bold"
        >
          Guardar recordatorio
        </button>
      </div>
      {cameraOpen &&
        (isLandscape ? (
          <div className="fixed inset-0 z-50 bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={closeCamera}
              className="absolute top-4 left-4 z-20 w-10 h-10 rounded-full bg-white/20 text-white text-xl"
            >
              ×
            </button>
            <div className="absolute right-5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-6">
              <button
                type="button"
                onClick={flipCamera}
                className="w-12 h-12 rounded-full bg-white/20 text-white text-xl"
                title="Cambiar cámara"
              >
                🔄
              </button>
              <button
                type="button"
                disabled={!cameraReady}
                onClick={takePhoto}
                className="w-20 h-20 rounded-full border-4 border-white bg-white/30 flex items-center justify-center disabled:opacity-40"
              >
                <span className="w-14 h-14 rounded-full bg-white" />
              </button>
              <span className="text-white/80 text-[10px] font-bold tracking-widest uppercase">
                Capturar
              </span>
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-5">
            <div className="w-full max-w-md bg-white dark:bg-stone-900 rounded-3xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-stone-800 dark:text-stone-100">
                  Sacar foto
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={flipCamera}
                    className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-700 text-[15px]"
                    title="Cambiar cámara"
                  >
                    🔄
                  </button>
                  <button
                    type="button"
                    onClick={closeCamera}
                    className="text-stone-400 text-xl"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="bg-black rounded-2xl overflow-hidden aspect-[3/4] flex items-center justify-center">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
              <button
                type="button"
                disabled={!cameraReady}
                onClick={takePhoto}
                className="w-full mt-3 py-3 rounded-2xl bg-amber-600 text-white font-bold disabled:opacity-40"
              >
                📷 Capturar
              </button>
            </div>
          </div>
        ))}
      {nuevaCategoria && (
        <CategorySheet
          categories={categories}
          onSave={(name, emoji) => {
            onAddCategory(name, emoji)
            setCategory({ name, emoji })
          }}
          onClose={() => setNuevaCategoria(false)}
        />
      )}
    </div>
  )
}

function DetailScreen({
  event,
  onBack,
  onEdit,
  onDelete,
  onComplete,
  onRemoveAttachment,
  onCalendar,
  clock12,
}: {
  event: Reminder
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onComplete: () => void
  onRemoveAttachment: (attachmentId: string) => void
  onCalendar: (app: CalendarApp) => void
  clock12: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>(
    {},
  )
  const days = daysUntil(event.date)
  const status = getStatus(days)
  const c = STATUS_CONFIG[status]
  useEffect(() => {
    let alive = true
    const load = async () => {
      const next: Record<string, string> = {}
      for (const a of event.attachments ?? []) {
        const blob = await getAttachment(a.id)
        if (blob) next[a.id] = URL.createObjectURL(blob)
      }
      if (alive) setAttachmentUrls(next)
      else Object.values(next).forEach((url) => URL.revokeObjectURL(url))
    }
    load()
    return () => {
      alive = false
      Object.values(attachmentUrls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [event.attachments])
  return (
    <div className="flex flex-col h-full app-bg dark:bg-stone-950">
      <Header
        title="Detalle"
        onBack={onBack}
        right={
          <button
            onClick={onEdit}
            className="text-amber-600 dark:text-amber-300 text-[13px] font-bold"
          >
            Editar
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <div className={`rounded-3xl p-6 mb-4 ${c.bg}`}>
          <div className="text-4xl mb-4">
            {event.categoryEmoji || (event.category ? "" : "🗂️")}
          </div>
          <h1 className="font-extrabold text-[25px] text-stone-900 dark:text-stone-50 leading-tight break-words">
            {event.name}
          </h1>
          <p className={`font-bold text-[16px] mt-2 ${c.text}`}>
            {formatDaysLabel(days)}
          </p>
          <p className="text-[13px] text-stone-500 dark:text-stone-400 mt-1">
            {formatDate(event.date)} · {formatTime(event.time, clock12)}
          </p>
          {event.recurrence !== "No se repite" && !event.completed && (
            <p className="text-[12px] text-amber-600 dark:text-amber-300 font-semibold mt-2">
              ↻{" "}
              {recurrenceLabel(
                event.recurrence,
                event.recurrenceInterval,
                event.recurrenceUnit,
              )}{" "}
              · Al completarlo, se programará:{" "}
              {nextOccurrenceLabel(event, clock12)}
            </p>
          )}
        </div>
        {event.notes && (
          <div className="bg-white dark:bg-stone-900 rounded-3xl p-5 border border-stone-100 dark:border-stone-800 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">
              Notas
            </p>
            <p className="text-[14px] text-stone-600 dark:text-stone-300 whitespace-pre-wrap break-words leading-relaxed">
              {event.notes}
            </p>
          </div>
        )}
        {(event.attachments?.length ?? 0) > 0 && (
          <div className="bg-white dark:bg-stone-900 rounded-3xl p-5 border border-stone-100 dark:border-stone-800 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">
              Archivos
            </p>
            <div className="space-y-3">
              {(event.attachments ?? []).map((a) => (
                <div
                  key={a.id}
                  className="border border-stone-100 dark:border-stone-800 rounded-2xl p-3"
                >
                  {a.type.startsWith("image/") && attachmentUrls[a.id] ? (
                    <img
                      src={attachmentUrls[a.id]}
                      alt={a.name}
                      className="w-full max-h-56 object-cover rounded-xl mb-2"
                    />
                  ) : a.type.startsWith("audio/") && attachmentUrls[a.id] ? (
                    <audio
                      controls
                      src={attachmentUrls[a.id]}
                      className="w-full mb-2"
                    />
                  ) : (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{attachmentIcon(a.type)}</span>
                      <span className="text-[13px] font-semibold text-stone-700 dark:text-stone-200 truncate">
                        {a.name}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-stone-700 dark:text-stone-200 truncate">
                        {a.name}
                      </p>
                      <p className="text-[10px] text-stone-400">
                        {formatFileSize(a.size)}
                      </p>
                    </div>
                    <button
                      onClick={() => onRemoveAttachment(a.id)}
                      className="text-red-500 dark:text-red-400 text-[11px] font-semibold"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {(event.history?.length ?? 0) > 0 && (
          <div className="bg-white dark:bg-stone-900 rounded-3xl p-5 border border-stone-100 dark:border-stone-800 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">
              Completados anteriores
            </p>
            <div className="space-y-2.5">
              {(event.history ?? []).slice(0, 6).map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center text-[12px] font-bold flex-shrink-0">
                      ✓
                    </span>
                    <span className="text-[13px] font-semibold text-stone-600 dark:text-stone-300 truncate">
                      {formatDate(h.date)}
                    </span>
                  </div>
                  <span className="text-[11px] text-stone-400 flex-shrink-0">
                    Completado el {formatStamp(h.completedAt)}
                  </span>
                </div>
              ))}
            </div>
            {(event.history?.length ?? 0) > 6 && (
              <p className="text-[11px] text-stone-400 mt-3">
                +{(event.history?.length ?? 0) - 6} más en el historial
              </p>
            )}
          </div>
        )}
        <div className="bg-white dark:bg-stone-900 rounded-3xl p-5 border border-stone-100 dark:border-stone-800 mb-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">
            Configuración
          </p>
          <div className="space-y-4 text-[14px]">
            <div className="flex justify-between">
              <span className="text-stone-400">Categoría</span>
              <span className="font-semibold text-stone-700 dark:text-stone-200">
                {event.category
                  ? `${event.categoryEmoji} ${event.category}`
                  : "Sin categoría"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-stone-400">Repetición</span>
              <span className="font-semibold text-stone-700 dark:text-stone-200 text-right">
                {recurrenceLabel(
                  event.recurrence,
                  event.recurrenceInterval,
                  event.recurrenceUnit,
                )}
              </span>
            </div>
            <div>
              <p className="text-stone-400 mb-2">Recordatorios</p>
              <div className="flex flex-wrap gap-2">
                {[...event.remindersBefore]
                  .sort((a, b) => b - a)
                  .map((d) => (
                    <span
                      key={`preset-${d}`}
                      className="px-3 py-1.5 bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-full font-semibold text-[12px]"
                    >
                      🔔 {offsetLabel(d)} antes
                    </span>
                  ))}
                {(event.customReminders ?? []).map((r) => (
                  <span
                    key={r.id}
                    className="px-3 py-1.5 bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-full font-semibold text-[12px]"
                  >
                    🔔 {alertLabel(r)}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-stone-400 mb-2">Canales</p>
              <div className="flex gap-2">
                {event.channels.map((ch) => (
                  <span
                    key={ch}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300 rounded-full font-semibold text-[12px]"
                  >
                    <ChannelIcon channel={ch} className="w-4 h-4" /> {ch}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-stone-900 rounded-3xl p-5 border border-stone-100 dark:border-stone-800 mb-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">
            Calendario
          </p>
          <div className="space-y-3">
            {(Object.keys(CALENDAR_LABELS) as CalendarApp[]).map((app) => {
              const stamp = event[CALENDAR_FIELDS[app]]
              const logo =
                app === "google" ? (
                  <GoogleG className="w-5 h-5" />
                ) : app === "apple" ? (
                  <AppleG className="w-5 h-5" />
                ) : (
                  <OutlookG className="w-5 h-5" />
                )
              return (
                <div key={app} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-100 dark:border-stone-800 flex items-center justify-center flex-shrink-0">
                    {logo}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
                      {CALENDAR_LABELS[app]}
                    </p>
                    <p className="text-[12px] text-stone-400">
                      {stamp
                        ? `Añadido el ${formatStamp(stamp)}`
                        : "Aún no está en tu calendario"}
                    </p>
                  </div>
                  {stamp && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex-shrink-0">
                      ✓ Añadido
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex gap-2 mt-4">
            <a
              href={googleCalendarUrl(event)}
              target="_blank"
              rel="noreferrer"
              onClick={() => onCalendar("google")}
              aria-label="Añadir a Google Calendar"
              className="flex-1 py-3 rounded-2xl bg-[#4285F4] text-white text-[13px] font-bold text-center"
            >
              Google
            </a>
            <button
              onClick={() => {
                downloadIcs(event)
                onCalendar("apple")
              }}
              aria-label="Añadir a Apple Calendar"
              className="flex-1 py-3 rounded-2xl bg-stone-900 dark:bg-stone-700 text-white text-[13px] font-bold"
            >
              Apple .ics
            </button>
            <a
              href={outlookCalendarUrl(event)}
              target="_blank"
              rel="noreferrer"
              onClick={() => onCalendar("outlook")}
              aria-label="Añadir a Outlook"
              className="flex-1 py-3 rounded-2xl bg-[#0F6CBD] text-white text-[13px] font-bold text-center"
            >
              Outlook
            </a>
          </div>
          <p className="text-[11px] text-stone-400 mt-2">
            Google Calendar y Outlook se abren con el evento ya rellenado: solo
            confirmas y guardas. Apple Calendar recibe el archivo .ics, que tu
            iPhone o tu Mac abren en la app Calendario.
          </p>
        </div>
        <button
          onClick={onComplete}
          className="w-full py-4 rounded-2xl bg-amber-600 text-white font-bold mb-2"
        >
          {event.completed
            ? "↩ Marcar como pendiente"
            : "✓ Marcar como completado"}
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full py-3 text-red-500 dark:text-red-400 text-[13px] font-semibold"
        >
          Eliminar recordatorio
        </button>
        {confirmDelete && (
          <div className="fixed inset-0 bg-black/30 flex items-end justify-center z-50">
            <div className="w-full max-w-[390px] bg-white dark:bg-stone-900 rounded-t-3xl p-6">
              <h3 className="font-bold text-lg text-stone-900 dark:text-stone-50">
                ¿Eliminar este recordatorio?
              </h3>
              <p className="text-stone-400 text-sm mt-1 mb-5">
                Esta acción no se puede deshacer.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-3 rounded-xl bg-stone-100 dark:bg-stone-700 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  onClick={onDelete}
                  className="flex-1 py-3 rounded-xl bg-red-600 text-white font-semibold"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CalendarScreen({
  events,
  onEventClick,
  onCreateDate,
  clock12,
}: {
  events: Reminder[]
  onEventClick: (id: string) => void
  onCreateDate: (date: string) => void
  clock12: boolean
}) {
  const [month, setMonth] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  )
  const [picker, setPicker] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const year = month.getFullYear(),
    m = month.getMonth()
  const first = new Date(year, m, 1).getDay()
  const offset = (first + 6) % 7
  const count = new Date(year, m + 1, 0).getDate()
  const days = Array.from({ length: offset + count }, (_, i) =>
    i < offset ? null : i - offset + 1,
  )
  const monthName = month.toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
  })
  const eventDays = new Map(
    events.filter((e) => !e.completed).map((e) => [e.date, e]),
  )
  const selectedDayEvents = selectedDay
    ? events
        .filter((e) => !e.completed && e.date === selectedDay)
        .sort((a, b) => a.time.localeCompare(b.time))
    : []
  return (
    <div className="flex flex-col h-full app-bg dark:bg-stone-950">
      <Header title="Calendario" />
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        <div className="relative flex items-center justify-between mb-4">
          <button
            onClick={() => setMonth(new Date(year, m - 1, 1))}
            className="w-9 h-9 rounded-full bg-white dark:bg-stone-900 border"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setPicker((p) => !p)}
            className="relative z-40 flex items-center gap-1.5 font-bold capitalize text-stone-800 dark:text-stone-100 px-2 py-1 rounded-xl"
          >
            <span>{monthName}</span>
            <span className="text-[10px] text-stone-400">
              {picker ? "▲" : "▼"}
            </span>
          </button>
          <button
            onClick={() => setMonth(new Date(year, m + 1, 1))}
            className="w-9 h-9 rounded-full bg-white dark:bg-stone-900 border"
          >
            →
          </button>
          {picker && (
            <div
              className="fixed inset-0 z-30"
              onClick={() => setPicker(false)}
            />
          )}
          {picker && (
            <div className="absolute left-0 right-0 top-12 z-40 bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 shadow-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={() => setMonth(new Date(year - 1, m, 1))}
                  className="w-9 h-9 rounded-full bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
                >
                  ←
                </button>
                <span className="font-extrabold text-stone-800 dark:text-stone-100">
                  {year}
                </span>
                <button
                  type="button"
                  onClick={() => setMonth(new Date(year + 1, m, 1))}
                  className="w-9 h-9 rounded-full bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
                >
                  →
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  "Enero",
                  "Febrero",
                  "Marzo",
                  "Abril",
                  "Mayo",
                  "Junio",
                  "Julio",
                  "Agosto",
                  "Septiembre",
                  "Octubre",
                  "Noviembre",
                  "Diciembre",
                ].map((mn, i) => (
                  <button
                    key={mn}
                    type="button"
                    onClick={() => {
                      setMonth(new Date(year, i, 1))
                      setPicker(false)
                    }}
                    className={`py-2 rounded-xl text-[12px] font-semibold ${
                      i === m
                        ? "bg-amber-600 text-white"
                        : "bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300"
                    }`}
                  >
                    {mn}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  const t = new Date()
                  setMonth(new Date(t.getFullYear(), t.getMonth(), 1))
                  setPicker(false)
                }}
                className="w-full mt-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-300 text-[12px] font-bold"
              >
                Ir al mes actual
              </button>
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-stone-900 rounded-3xl p-4 border border-stone-100 dark:border-stone-800">
          <div className="grid grid-cols-7 text-center mb-2">
            {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
              <span
                key={d}
                className="text-[11px] font-bold text-stone-400 py-2"
              >
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-2">
            {days.map((d, i) => {
              const key = d
                ? `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
                : ""
              const e = eventDays.get(key)
              const today = key === dateKey()
              return (
                <button
                  key={i}
                  disabled={!d}
                  onClick={() => {
                    if (!d) return
                    setSelectedDay((prev) => (prev === key ? null : key))
                  }}
                  className={`h-11 rounded-xl flex flex-col items-center justify-center transition-colors ${
                    !d ? "opacity-0" : ""
                  } ${
                    key === selectedDay
                      ? "bg-amber-600 text-white font-bold shadow-md shadow-amber-200/70 ring-2 ring-amber-300 dark:ring-amber-500/60"
                      : today
                        ? "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100 font-bold"
                        : e
                          ? "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : ""
                  }`}
                >
                  <span className="text-[13px] font-semibold">{d}</span>
                  {e && (
                    <span
                      className={`text-[8px] ${
                        key === selectedDay
                          ? "text-white"
                          : "text-amber-500 dark:text-amber-300"
                      }`}
                    >
                      ●
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <p className="text-[11px] text-stone-400 mt-2 px-1">
          Toca un día para ver y agregar sus recordatorios.
        </p>
        {selectedDay && (
          <div className="mt-4 rounded-3xl bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-[14px] font-extrabold text-stone-800 dark:text-stone-100 capitalize">
                {formatDate(selectedDay)}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="text-[11px] font-semibold text-stone-400 flex-shrink-0"
              >
                Cerrar
              </button>
            </div>
            <p className="text-[11px] text-stone-400 mb-3">
              {selectedDayEvents.length === 0
                ? "Sin recordatorios ese día."
                : `${selectedDayEvents.length} ${
                    selectedDayEvents.length === 1
                      ? "recordatorio"
                      : "recordatorios"
                  }`}
            </p>
            {selectedDayEvents.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                clock12={clock12}
                onClick={() => onEventClick(e.id)}
              />
            ))}
            <button
              type="button"
              onClick={() => onCreateDate(selectedDay)}
              className="w-full py-3 rounded-2xl bg-amber-600 text-white text-[14px] font-bold shadow-sm shadow-amber-200/70"
            >
              ＋ Nuevo recordatorio este día
            </button>
          </div>
        )}
        <div className="mt-5">
          <h3 className="text-[11px] font-bold tracking-widest text-stone-400 uppercase mb-3">
            Eventos de este mes
          </h3>
          {events
            .filter(
              (e) =>
                !e.completed &&
                parseDate(e.date).getMonth() === m &&
                parseDate(e.date).getFullYear() === year,
            )
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((e) => (
              <EventCard
                key={e.id}
                event={e}
                clock12={clock12}
                onClick={() => onEventClick(e.id)}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

interface HistoryEntry {
  id: string
  eventId: string
  name: string
  emoji: string
  category: string
  date: string
  completedAt?: string
}

function buildHistoryEntries(events: Reminder[]): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  events.forEach((e) => {
    if (e.completed)
      entries.push({
        id: `done-${e.id}`,
        eventId: e.id,
        name: e.name,
        emoji: e.categoryEmoji,
        category: e.category,
        date: e.date,
      })
    ;(e.history ?? []).forEach((h) =>
      entries.push({
        id: `occ-${e.id}-${h.id}`,
        eventId: e.id,
        name: e.name,
        emoji: e.categoryEmoji,
        category: e.category,
        date: h.date,
        completedAt: h.completedAt,
      }),
    )
  })
  return entries.sort(
    (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime(),
  )
}

function HistorialScreen({
  events,
  onEventClick,
}: {
  events: Reminder[]
  onEventClick: (id: string) => void
}) {
  const completed = buildHistoryEntries(events)
  return (
    <div className="flex flex-col h-full app-bg dark:bg-stone-950">
      <Header title="Historial" />
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        {completed.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">✅</div>
            <h3 className="font-bold text-lg text-stone-800 dark:text-stone-100">
              Nada completado aún
            </h3>
            <p className="text-sm text-stone-400 mt-2">
              Cuando marques un recordatorio como completado, aparecerá aquí.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">
              Recordatorios completados · {completed.length}
            </p>
            {completed.map((h) => (
              <div
                key={h.id}
                onClick={() => onEventClick(h.eventId)}
                className="bg-white/80 dark:bg-stone-900/80 rounded-2xl p-4 border border-stone-100 dark:border-stone-800 mb-2 flex items-center gap-3 cursor-pointer"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center text-lg flex-shrink-0">
                  ✓
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[14px] text-stone-500 dark:text-stone-400 line-clamp-2 break-words line-through">
                    {h.emoji} {h.name}
                  </p>
                  <p className="text-[11px] text-stone-400 mt-1">
                    {h.category} · {formatDate(h.date)}
                    {h.completedAt
                      ? ` · Completado el ${formatStamp(h.completedAt)}`
                      : ""}
                  </p>
                </div>
                <span className="text-stone-300 dark:text-stone-500">›</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// Ajustes trabaja siempre sobre el usuario activo: su nombre y emoji, su contacto (WhatsApp y
// correo), sus canales y su conexión con Google Calendar. onUpdateProfile guarda cada cambio en ese
// perfil, así que lo que se configura para un usuario no cambia nada en los demás.
function SettingsScreen({
  events,
  dark,
  onToggleDark,
  onReset,
  profiles,
  activeProfile,
  onSelectProfile,
  onDeleteProfile,
  onAddProfile,
  onReplay,
  onUpdateProfile,
  onTips,
  clock12,
  onClock12,
  onBackup,
  onRestore,
}: {
  events: Reminder[]
  dark: boolean
  onToggleDark: () => void
  onReset: () => void
  profiles: Profile[]
  activeProfile: Profile
  onSelectProfile: (id: string) => void
  onDeleteProfile: (id: string) => void
  onAddProfile: (name: string, emoji: string, photo?: string) => void
  onReplay: () => void
  onUpdateProfile: (patch: Partial<Profile>) => void
  onTips: () => void
  clock12: boolean
  onClock12: (v: boolean) => void
  onBackup: () => Promise<RespuestaCopia>
  onRestore: (copia: Copia) => Promise<RespuestaCopia>
}) {
  // Copia de seguridad: el archivo se elige acá mismo y antes de reemplazar nada se muestra qué trae.
  // El mensaje del final es del último intento (descarga, restauración o error) y se queda a la vista.
  const [mensaje, setMensaje] = useState<RespuestaCopia | null>(null)
  const [pendiente, setPendiente] = useState<{
    nombre: string
    copia: Copia
    cuenta: string
  } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const archivoCopia = useRef<HTMLInputElement | null>(null)
  const descargar = async () => {
    setOcupado(true)
    setPendiente(null)
    setMensaje(await onBackup())
    setOcupado(false)
  }
  const leerArchivo = async (file: File | undefined) => {
    if (!file) return
    setMensaje(null)
    setPendiente(null)
    let texto = ""
    try {
      texto = await file.text()
    } catch {
      setMensaje({ ok: false, text: "No se pudo leer el archivo." })
      return
    }
    const leido = leerCopia(texto)
    if (!leido.ok) {
      setMensaje({ ok: false, text: leido.error })
      return
    }
    const { datos, adjuntos } = leido.copia
    setPendiente({
      nombre: file.name,
      copia: leido.copia,
      cuenta: `${cuantos(
        contarEnCopia(datos, STORAGE_EVENTS),
        "recordatorio",
        "recordatorios",
      )}, ${cuantos(
        contarEnCopia(datos, STORAGE_PROFILES),
        "usuario",
        "usuarios",
      )}, ${cuantos(
        contarEnCopia(datos, STORAGE_CATEGORIES),
        "categoría",
        "categorías",
      )} y ${cuantos(
        Object.keys(adjuntos).length,
        "adjunto",
        "adjuntos",
      )}`,
    })
  }
  const confirmarRestaurar = async () => {
    if (!pendiente) return
    setOcupado(true)
    setMensaje(await onRestore(pendiente.copia))
    setPendiente(null)
    setOcupado(false)
  }
  // Los canales y el contacto salen del usuario activo: al cambiar de usuario, Ajustes muestra lo
  // suyo. El permiso del navegador, en cambio, es del dispositivo (se pide una sola vez).
  const prefs = activeProfile.channels ?? DEFAULT_CHANNEL_PREFS
  const contact = activeProfile.contact ?? { phone: "", email: "" }
  const setPref = (key: keyof ChannelPrefs) =>
    onUpdateProfile({ channels: { ...prefs, [key]: !prefs[key] } })
  const setContact = (patch: Partial<Contact>) =>
    onUpdateProfile({ contact: { ...contact, ...patch } })
  // El "ticket" de Contacto: si el usuario escribe o cambia un dato, la confirmación se destilda y hay
  // que volver a aceptarlo (por eso los campos mandan accepted: false en cada edición). Los avisos por
  // WhatsApp y correo quedan en pausa mientras haya datos sin confirmar: channelReady lo respeta, así
  // que Crear también avisa que ese recordatorio saldrá por notificación.
  const hasContact = !!(contact.phone.trim() || contact.email.trim())
  const contactAccepted = contact.accepted !== false
  const [permission, setPermission] = useState(
    "Notification" in window ? Notification.permission : "default",
  )
  const [confirmUserId, setConfirmUserId] = useState<string | null>(null)
  // Agregar un usuario también se puede desde acá: la misma alta que Inicio —nombre y su cara, con la
  // rejilla de emoji, la lista completa del «+» o su foto— para no tener que volver a Inicio solo para
  // sumar a alguien. Al agregarlo queda como usuario activo, igual que cuando se agrega desde Inicio.
  const [addingUser, setAddingUser] = useState(false)
  const [newUserName, setNewUserName] = useState("")
  const [newUserEmoji, setNewUserEmoji] = useState(DEFAULT_PROFILE.emoji)
  const [newUserPhoto, setNewUserPhoto] = useState("")
  const openAddUser = () => {
    setConfirmUserId(null)
    setNewUserName("")
    setNewUserEmoji(DEFAULT_PROFILE.emoji)
    setNewUserPhoto("")
    setAddingUser(true)
  }
  const addUser = () => {
    if (!newUserName.trim()) return
    onAddProfile(
      newUserName.trim(),
      newUserEmoji.trim() || DEFAULT_PROFILE.emoji,
      newUserPhoto || undefined,
    )
    setNewUserName("")
    setNewUserEmoji(DEFAULT_PROFILE.emoji)
    setNewUserPhoto("")
    setAddingUser(false)
  }
  const enableNotifications = async () => {
    if (!("Notification" in window)) return
    const p = await Notification.requestPermission()
    setPermission(p)
  }
  // Etapa 10: la otra mitad de los avisos. La tarjeta de arriba es el permiso del navegador (avisa
  // mientras la app está abierta); esta es la suscripción push, que llega con la app cerrada y por eso
  // necesita el service worker y la nube. El estado se lee al entrar y se vuelve a leer al volver a la
  // app: si el permiso se cambió en el candado del sitio, la tarjeta lo refleja sin recargar.
  const [estadoAvisosAhora, setEstadoAvisosAhora] = useState<EstadoAvisos | null>(null)
  const [avisoOcupado, setAvisoOcupado] = useState(false)
  const [avisoMensaje, setAvisoMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  useEffect(() => {
    let vivo = true
    const leer = () =>
      estadoAvisos().then((estado) => {
        if (vivo) setEstadoAvisosAhora(estado)
      })
    void leer()
    window.addEventListener("focus", leer)
    document.addEventListener("visibilitychange", leer)
    return () => {
      vivo = false
      window.removeEventListener("focus", leer)
      document.removeEventListener("visibilitychange", leer)
    }
  }, [])
  const encenderAvisos = async () => {
    setAvisoOcupado(true)
    setAvisoMensaje(null)
    const resultado = await activarAvisos()
    setEstadoAvisosAhora(resultado.estado)
    if (resultado.estado === "activo") {
      // Al activar se sube la cola de una vez: si no, el primer aviso con la app cerrada no tendría
      // nada programado hasta el próximo cambio en los recordatorios.
      const cola = programarAvisos(events)
      try {
        localStorage.setItem(STORAGE_COLA, JSON.stringify(cola))
      } catch {}
      const subida = await sincronizarCola(cola)
      setAvisoMensaje(
        subida.ok
          ? {
              ok: true,
              texto: `Listo: ${cola.length} ${
                cola.length === 1 ? "aviso programado" : "avisos programados"
              } para este dispositivo.`,
            }
          : { ok: false, texto: subida.error || "No se pudo subir la cola a la nube." },
      )
    } else if (resultado.error) {
      setAvisoMensaje({ ok: false, texto: resultado.error })
    }
    setAvisoOcupado(false)
  }
  const apagarAvisos = async () => {
    setAvisoOcupado(true)
    setAvisoMensaje(null)
    const resultado = await desactivarAvisos()
    setEstadoAvisosAhora(resultado.estado)
    setAvisoMensaje({
      ok: true,
      texto: "Apagados: este dispositivo ya no va a recibir avisos con la app cerrada.",
    })
    setAvisoOcupado(false)
  }
  const probarAviso = async () => {
    setAvisoOcupado(true)
    setAvisoMensaje(null)
    const resultado = await pedirAvisoDePrueba()
    setAvisoMensaje(
      resultado.ok
        ? {
            ok: true,
            texto: "Prueba pedida: llega en menos de un minuto, aunque cierres la app.",
          }
        : { ok: false, texto: resultado.error || "No se pudo pedir la prueba." },
    )
    setAvisoOcupado(false)
  }
  const textoAvisos =
    estadoAvisosAhora === null
      ? "Revisando este dispositivo…"
      : estadoAvisosAhora === "activo"
        ? "Activado en este dispositivo: los avisos llegan aunque cierres la app."
        : estadoAvisosAhora === "sin-nube"
          ? "Falta conectar la nube: sin ella el servidor no tiene por dónde avisar."
          : estadoAvisosAhora === "iphone-instalar"
            ? "Primero agrega AVISPATE a la pantalla de inicio: Safari solo así acepta avisos."
            : estadoAvisosAhora === "sin-soporte"
              ? "Este navegador no puede avisar con la app cerrada."
              : estadoAvisosAhora === "bloqueado"
                ? "Bloqueado en el navegador: revisá el candado del sitio."
                : "Listo para activar en este dispositivo."
  const notaAvisos =
    estadoAvisosAhora === "sin-nube"
      ? "Pegá la anon key de Supabase en .env.local y volvé a compilar (ver supabase/README.md)."
      : estadoAvisosAhora === "iphone-instalar"
        ? "En iPhone: Compartir → Agregar a pantalla de inicio. Después abrí la app desde el ícono y activá los avisos acá."
        : estadoAvisosAhora === "sin-soporte"
          ? "Probá con Chrome, Edge o Safari actualizado; en iPhone, con la app instalada y iOS 16.4 o más nuevo."
          : estadoAvisosAhora === "bloqueado"
            ? "En el candado del sitio, permití las notificaciones y volvé a intentar."
            : "Se programan en tu teléfono y se suben a la nube: el servidor solo mira la hora y manda. No hace falta tener la app abierta."
  // El permiso lo concede el navegador, no la app: no se puede dejar "activado por defecto" (el
  // navegador exige un toque del usuario y muestra su propio cartel). Lo que sí se puede es pedirlo en
  // el momento en que hace falta (al guardar un recordatorio con aviso por notificación, ver saveEvent)
  // y enseñar aquí el estado real. Por eso se vuelve a leer el permiso cada vez que Ajustes aparece o
  // la app recupera el foco: si lo cambiaste en el candado del navegador, la tarjeta lo refleja.
  useEffect(() => {
    const read = () =>
      setPermission(
        "Notification" in window ? Notification.permission : "default",
      )
    read()
    window.addEventListener("focus", read)
    document.addEventListener("visibilitychange", read)
    return () => {
      window.removeEventListener("focus", read)
      document.removeEventListener("visibilitychange", read)
    }
  }, [])
  const notifSupported = "Notification" in window
  const permissionText = !notifSupported
    ? "Este navegador no lo permite"
    : permission === "granted"
      ? "Activado"
      : permission === "denied"
        ? "Bloqueado en el navegador"
        : "Aún no concedido"
  const permissionNote = !notifSupported
    ? "En iPhone, primero agrega AVISPATE a la pantalla de inicio: solo así Safari admite avisos."
    : permission === "granted"
      ? "Los recordatorios cuyo dueño tiene encendido el canal Notificación avisan en este dispositivo."
      : permission === "denied"
        ? "Quedó bloqueado en este navegador: ábrelo desde el candado 🔒 de la barra de direcciones, elige «Permitir» y vuelve. Desde aquí ya no podemos preguntarte."
        : "El navegador solo lo concede cuando tú lo aceptas con un toque, así que no puede venir activado por defecto. Si eliges «Notificación» al guardar un recordatorio te lo pedimos en ese momento; también puedes activarlo aquí."
  // Google Calendar de ESTE usuario: la conexión con la cuenta real llega junto con las cuentas de
  // usuario. Por ahora mostramos los estados (sin conectar, conectando, conectado) y una
  // sincronización simulada, pero cada usuario tiene su conexión y su propio "Todos los avisos".
  const gcal = activeProfile.gcal ?? DEFAULT_GCAL
  const [gcalBusy, setGcalBusy] = useState<"" | "connect" | "sync">("")
  const [gcalMsg, setGcalMsg] = useState("")
  const gcalEvents = events.filter(
    (e) =>
      e.gcalAddedAt && (e.ownerId || DEFAULT_PROFILE_ID) === activeProfile.id,
  )
  // Los recordatorios de ESTE usuario: son los que se descargan en un solo .ics cuando se sincroniza
  // Apple Calendar o Outlook.
  const myEvents = events.filter(
    (e) => (e.ownerId || DEFAULT_PROFILE_ID) === activeProfile.id,
  )
  const persistGcal = (next: GcalState) => onUpdateProfile({ gcal: next })
  // "Todos los avisos": opción opcional que decide si los recordatorios nuevos se crean con
  // Google Calendar ya marcado. Viene activada al conectar y se puede apagar cuando se quiera;
  // si el dato no existe todavía (instalaciones anteriores), se toma como activada.
  const syncAll = gcal.syncAll !== false
  const toggleSyncAll = () => {
    persistGcal({ ...gcal, syncAll: !syncAll })
    setGcalMsg(
      !syncAll
        ? "Listo: los recordatorios nuevos vienen con Google Calendar activado."
        : "Listo: los recordatorios nuevos se crean sin Google Calendar; puedes encenderlo en cada uno.",
    )
  }
  const connectGcal = () => {
    setGcalBusy("connect")
    setGcalMsg("")
    window.setTimeout(() => {
      persistGcal({ ...gcal, connected: true, syncAll: true })
      setGcalBusy("")
      setGcalMsg(
        "Cuenta conectada. Los recordatorios nuevos vienen con Google Calendar activado.",
      )
    }, 1200)
  }
  const disconnectGcal = () => {
    persistGcal({ connected: false })
    setGcalMsg("")
  }
  const syncGcal = () => {
    setGcalBusy("sync")
    setGcalMsg("")
    window.setTimeout(() => {
      const count = gcalEvents.length
      persistGcal({
        ...gcal,
        connected: true,
        lastSync: new Date().toISOString(),
        lastCount: count,
      })
      setGcalBusy("")
      setGcalMsg(
        count === 0
          ? "Todavía no has enviado recordatorios al calendario."
          : `${count} ${
              count === 1
                ? "recordatorio sincronizado"
                : "recordatorios sincronizados"
            }.`,
      )
    }, 1500)
  }
  // Filas de los canales de ESTE usuario: WhatsApp va con su logo real (ya no el emoji de burbuja) y
  // las otras dos con su emoji, para que las tres se lean igual.
  const channelRows: {
    label: string
    emoji?: string
    whatsapp?: boolean
    on: boolean
    key: keyof ChannelPrefs
  }[] = [
    { label: "Notificaciones push", emoji: "🔔", on: prefs.push, key: "push" },
    { label: "WhatsApp", whatsapp: true, on: prefs.whatsapp, key: "whatsapp" },
    { label: "Correo electrónico", emoji: "✉️", on: prefs.email, key: "email" },
  ]
  // Los tres calendarios viven en un solo desplegable: cerrado enseña la burbuja con los tres logos y
  // el resumen de cuáles están conectados; al abrirlo aparecen las tarjetas de cada uno.
  const [openCalendars, setOpenCalendars] = useState(false)
  const connectedCals = ([
    "google",
    "apple",
    "outlook",
  ] as CalendarApp[]).filter(
    (app) => calendarStateOf(activeProfile, app).connected,
  )
  const calendarSummary =
    connectedCals.length === 0
      ? "Google, Apple y Outlook · sin conectar"
      : connectedCals.length === 3
        ? "Google, Apple y Outlook · los tres conectados"
        : `Conectados: ${connectedCals.map((app) => CALENDAR_LABELS[app]).join(" y ")}`
  // La tarjeta de Mi perfil se queda en lo mínimo —el ícono, el nombre y «Editar»—: sus canales y sus
  // calendarios se ven más abajo, en «Notificaciones» y en el desplegable de Calendarios. Las insignias
  // de cada fila de la lista de usuarios las sigue dibujando ChannelBadges por su cuenta.
  // Editar Mi perfil: se trabaja sobre copias (nombre, emoji, foto) y nada se guarda hasta apretar
  // «Guardar», así se puede probar una cara sin cambiar la del usuario activo por accidente.
  const [editingProfile, setEditingProfile] = useState(false)
  const [draftName, setDraftName] = useState(activeProfile.name)
  const [draftEmoji, setDraftEmoji] = useState(activeProfile.emoji)
  const [draftPhoto, setDraftPhoto] = useState(activeProfile.photo ?? "")
  const openProfileEditor = () => {
    setDraftName(activeProfile.name)
    setDraftEmoji(activeProfile.emoji)
    setDraftPhoto(activeProfile.photo ?? "")
    setEditingProfile(true)
  }
  const saveProfile = () => {
    onUpdateProfile({
      name: draftName.trim() || activeProfile.name,
      emoji: draftEmoji || DEFAULT_PROFILE.emoji,
      photo: draftPhoto || undefined,
    })
    setEditingProfile(false)
  }

  return (
    <div className="flex flex-col h-full app-bg dark:bg-stone-950">
      <div className="px-5 pt-12 pb-3">
        <h1 className="font-extrabold text-[24px] text-stone-900 dark:text-stone-50">
          Ajustes
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">
          Mi perfil
        </p>
        {/* Solo el ícono, el nombre y «Editar»: nada de canales ni calendarios aquí, que ya tienen su propia sección en Ajustes. */}
        <div className="bg-white dark:bg-stone-900 rounded-3xl p-5 border border-stone-100 dark:border-stone-800 mb-4">
          <div className="flex items-center gap-4">
            <Avatar
              profile={activeProfile}
              className="w-14 h-14 rounded-2xl text-[28px]"
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[16px] text-stone-800 dark:text-stone-100 truncate">
                Mi perfil · {activeProfile.name}
              </p>
            </div>
          </div>
          {/* Editar: el nombre y la cara (emoji o foto) del usuario, en el mismo lugar. Se guarda al apretar
          «Guardar»; hasta entonces nada de lo que se toque acá toca a los demás usuarios. */}
          {editingProfile ? (
            <div className="mt-4 pt-4 border-t border-stone-50 dark:border-stone-800">
              <label
                htmlFor="profile-name"
                className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2 block"
              >
                Nombre de usuario
              </label>
              <input
                id="profile-name"
                value={draftName}
                maxLength={24}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Ej. Papi, Mamá, Sebastián…"
                className="w-full bg-stone-50 dark:bg-stone-800 rounded-2xl px-4 py-3.5 text-[16px] font-semibold border border-stone-100 dark:border-stone-800 outline-none focus:border-amber-400"
              />
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mt-4 mb-2">
                Tu emoji o tu foto
              </p>
              <AvatarEditor
                emoji={draftEmoji}
                photo={draftPhoto}
                name={draftName.trim() || activeProfile.name}
                onEmoji={setDraftEmoji}
                onPhoto={setDraftPhoto}
                size="sm"
              />
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={saveProfile}
                  className="flex-1 py-3 rounded-2xl bg-amber-600 text-white text-[14px] font-bold"
                >
                  Guardar
                </button>
                <button
                  onClick={() => setEditingProfile(false)}
                  className="px-4 py-3 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[14px] font-semibold"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={openProfileEditor}
              aria-expanded={false}
              className="mt-4 w-full py-3 rounded-2xl bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[14px] font-bold"
            >
              Editar
            </button>
          )}
        </div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">
          Apariencia
        </p>
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 overflow-hidden mb-4">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="text-lg">{dark ? "🌙" : "☀️"}</span>
              <span className="text-[14px] font-medium">Modo oscuro</span>
            </div>
            <button
              onClick={onToggleDark}
              aria-label="Alternar modo oscuro"
              className={`w-11 h-6 rounded-full ${
                dark ? "bg-amber-500" : "bg-stone-200 dark:bg-stone-600"
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full shadow mx-0.5 ${
                  dark ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
          <div className="px-5 py-4 border-t border-stone-50 dark:border-stone-800">
            <div className="flex items-center gap-3">
              <span className="text-lg flex-shrink-0">🕘</span>
              <span className="text-[14px] font-medium">
                Hora de los avisos
              </span>
            </div>
            {/* Formato de hora: dos botones con tamaño fijo (mitad y mitad) y su propio ejemplo dentro. Así al elegir a.m./p.m. no hay texto que crezca ni se mueva nada: solo cambia el color del botón elegido. */}
            <div
              role="group"
              aria-label="Formato de hora"
              className="mt-3 grid grid-cols-2 gap-1 p-1 rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/60"
            >
              <button
                type="button"
                onClick={() => onClock12(false)}
                aria-pressed={!clock12}
                aria-label="Hora en formato de 24 horas, por ejemplo 22:30"
                className={`py-2 rounded-xl flex flex-col items-center justify-center leading-tight transition-colors ${
                  clock12
                    ? "bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-300"
                    : "bg-amber-600 text-white"
                }`}
              >
                <span className="text-[12px] font-bold">24 h</span>
                <span className="text-[11px] font-semibold tabular-nums opacity-80">
                  22:30
                </span>
              </button>
              <button
                type="button"
                onClick={() => onClock12(true)}
                aria-pressed={clock12}
                aria-label="Hora en formato de 12 horas, por ejemplo 10:30 p.m."
                className={`py-2 rounded-xl flex flex-col items-center justify-center leading-tight transition-colors ${
                  clock12
                    ? "bg-amber-600 text-white"
                    : "bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-300"
                }`}
              >
                <span className="text-[12px] font-bold">a.m./p.m.</span>
                <span className="text-[11px] font-semibold tabular-nums opacity-80">
                  10:30 p.m.
                </span>
              </button>
            </div>
          </div>
        </div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">
          Usuarios de este dispositivo
        </p>
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 overflow-hidden mb-4">
          {profiles.map((p, i) => {
            const count = events.filter(
              (e) => (e.ownerId || DEFAULT_PROFILE_ID) === p.id,
            ).length
            // Las insignias de ESE usuario —su campana, sus dos canales y sus tres calendarios— salen de
            // la misma función que usa Inicio, así las dos listas dicen exactamente lo mismo de cada uno.
            return (
              <div
                key={p.id}
                className={`px-5 ${
                  i > 0 ? "border-t border-stone-50 dark:border-stone-800" : ""
                } ${
                  p.id === activeProfile.id
                    ? "bg-amber-50/50 dark:bg-amber-500/5"
                    : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setConfirmUserId(null)
                      onSelectProfile(p.id)
                    }}
                    className="flex-1 min-w-0 flex items-center gap-3 pt-3.5 pb-2 text-left"
                  >
                    <Avatar
                      profile={p}
                      className="w-9 h-9 rounded-xl text-[20px]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-stone-700 dark:text-stone-200 truncate">
                        {p.name}
                        {p.id === activeProfile.id && (
                          <span className="text-amber-600 dark:text-amber-300 text-[11px] font-bold ml-2">
                            activo
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-stone-400">
                        {count} {count === 1 ? "recordatorio" : "recordatorios"}
                      </p>
                    </div>
                  </button>
                  {profiles.length > 1 && (
                    <button
                      onClick={() => {
                        if (confirmUserId === p.id) {
                          setConfirmUserId(null)
                          onDeleteProfile(p.id)
                        } else setConfirmUserId(p.id)
                      }}
                      className={`text-[12px] font-semibold px-2.5 py-2 rounded-xl flex-shrink-0 ${
                        confirmUserId === p.id
                          ? "bg-red-600 text-white"
                          : "text-red-500 dark:text-red-400"
                      }`}
                    >
                      {confirmUserId === p.id ? "¿Eliminar?" : "🗑 Eliminar"}
                    </button>
                  )}
                </div>
                {/* Las seis insignias, en su propia línea a todo lo ancho de la tarjeta y alineadas con el
                    nombre (el `pl` es el ancho del avatar más su separación): así entran siempre en una
                    sola línea, sin envolverse ni apretarse contra el botón de eliminar. */}
                <div className="pb-3.5 pl-12">
                  <ChannelBadges profile={p} wrap={false} />
                </div>
              </div>
            )
          })}
          {/* El alta, al final de la misma tarjeta: nombre y su cara —emoji de la rejilla, de la lista
          completa del «+» o su foto— y «Agregar». Recién ahí se suma a la lista y queda como activo. */}
          {addingUser ? (
            <div className="border-t border-stone-50 dark:border-stone-800 px-5 py-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">
                Usuario nuevo
              </p>
              <input
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="Nombre (ej. Abuela)"
                className="w-full bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-2.5 text-[16px] font-semibold border border-stone-100 dark:border-stone-800 outline-none focus:border-amber-400"
              />
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mt-3 mb-2">
                Su emoji o su foto
              </p>
              <AvatarEditor
                emoji={newUserEmoji}
                photo={newUserPhoto}
                name={newUserName.trim() || "el usuario nuevo"}
                onEmoji={setNewUserEmoji}
                onPhoto={setNewUserPhoto}
                size="sm"
                className="pb-1"
              />
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={addUser}
                  className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-[15px] font-bold"
                >
                  Agregar
                </button>
                <button
                  onClick={() => setAddingUser(false)}
                  aria-label="Cancelar el usuario nuevo"
                  className="w-10 h-10 rounded-xl bg-stone-100 dark:bg-stone-700 text-stone-500 dark:text-stone-300 text-[16px]"
                >
                  ×
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={openAddUser}
              className="w-full py-3.5 border-t border-stone-50 dark:border-stone-800 text-amber-600 dark:text-amber-300 text-[15px] font-bold active:bg-amber-50/70 dark:active:bg-amber-500/10"
            >
              ＋ Nuevo usuario
            </button>
          )}
        </div>
        <p className="text-[11px] text-stone-400 -mt-2 mb-4 px-1">
          Cada usuario tiene sus propios recordatorios, su contacto y sus
          calendarios. Eliminar un usuario borra también lo suyo en este
          dispositivo.
        </p>
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">
          Contacto de {activeProfile.name}
        </p>
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 p-5 mb-4">
          {/* Los estados («✓ Conectado» / «Por confirmar») van en la línea del título de cada dato
              —WhatsApp y correo, alineados igual—: así la fila del campo queda para el dato y el número
              entra completo con su cuadro chico de extensión. */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <label
              htmlFor="profile-phone"
              className="text-[11px] font-bold uppercase tracking-widest text-stone-400"
            >
              Número de WhatsApp
            </label>
            {!!contact.phone.trim() && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                  contactAccepted
                    ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-100 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300"
                }`}
              >
                {contactAccepted ? "✓ Conectado" : "Por confirmar"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-11 h-11 rounded-2xl bg-amber-50 dark:bg-amber-500/20 border border-amber-200 dark:border-amber-500/40 flex items-center justify-center flex-shrink-0">
              <WhatsAppG className="w-6 h-6" />
            </span>
            <PhoneField
              id="profile-phone"
              value={contact.phone}
              onChange={(v) => setContact({ phone: v, accepted: false })}
            />
          </div>
          <div className="flex items-center justify-between gap-2 mt-4 mb-2">
            <label
              htmlFor="profile-email"
              className="text-[11px] font-bold uppercase tracking-widest text-stone-400"
            >
              Correo electrónico
            </label>
            {!!contact.email.trim() && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                  contactAccepted
                    ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-100 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300"
                }`}
              >
                {contactAccepted ? "✓ Conectado" : "Por confirmar"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-amber-50 dark:bg-amber-500/20 border border-amber-200 dark:border-amber-500/40 flex items-center justify-center text-[20px] flex-shrink-0">
              ✉️
            </span>
            <input
              id="profile-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={60}
              value={contact.email}
              onChange={(e) =>
                setContact({ email: e.target.value, accepted: false })
              }
              placeholder="tucorreo@ejemplo.com"
              className="flex-1 min-w-0 px-4 py-3.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-100 dark:border-stone-800 text-[15px] font-semibold text-stone-800 dark:text-stone-100 placeholder:text-stone-300 dark:placeholder:text-stone-600 outline-none focus:border-amber-400"
            />
          </div>
          {hasContact && (
            <>
              <label
                htmlFor="profile-contact-accept"
                className="mt-4 flex items-start gap-3 cursor-pointer select-none"
              >
                <input
                  id="profile-contact-accept"
                  type="checkbox"
                  checked={contactAccepted}
                  onChange={(e) => setContact({ accepted: e.target.checked })}
                  className="mt-0.5 w-4 h-4 flex-shrink-0 accent-amber-600"
                />
                <span className="text-[12px] text-stone-600 dark:text-stone-300 leading-snug">
                  Acepto que AVISPATE use estos datos para avisarme por WhatsApp
                  y por correo. Son míos y puedo cambiarlos cuando quiera.
                </span>
              </label>
              {!contactAccepted && (
                <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mt-2">
                  Sin el ticket marcado, los avisos por WhatsApp y correo quedan
                  en pausa.
                </p>
              )}
            </>
          )}
          <p className="text-[11px] text-stone-400 mt-3">
            Son los datos de {activeProfile.name}: cada usuario del dispositivo
            tiene los suyos. Ahí llegan los avisos por WhatsApp y por correo
            (simulados en esta V1.5).
          </p>
        </div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">
          Notificaciones
        </p>
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 overflow-hidden mb-4">
          {channelRows.map((row, i) => (
            <div
              key={row.label}
              className={`flex items-center justify-between px-5 py-4 ${
                i < 2 ? "border-b border-stone-50 dark:border-stone-800" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                {row.whatsapp ? (
                  <WhatsAppG className="w-4 h-4" />
                ) : (
                  <span className="leading-none">{row.emoji}</span>
                )}
                <span className="text-[14px] font-medium">{row.label}</span>
              </div>
              <button
                role="switch"
                aria-checked={row.on}
                aria-label={`Canal ${row.label} de este usuario`}
                onClick={() => setPref(row.key)}
                className={`w-11 h-6 rounded-full ${
                  row.on ? "bg-amber-500" : "bg-stone-200 dark:bg-stone-600"
                }`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow mx-0.5 ${
                    row.on ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-stone-400 -mt-2 mb-4 px-1">
          Estos canales son de {activeProfile.name}: puedes apagarlos aquí sin
          afectar a los demás usuarios. WhatsApp y correo solo se usan si ese
          usuario dejó sus datos y marcó el ticket de Contacto.
        </p>
        <div className="bg-white dark:bg-stone-900 rounded-3xl p-5 border border-stone-100 dark:border-stone-800 mb-4">
          <div className="flex justify-between items-center gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-[14px]">
                Permiso de notificaciones
              </p>
              <p className="text-[12px] text-stone-400 mt-1">
                {permissionText}
              </p>
            </div>
            {notifSupported && permission === "default" && (
              <button
                onClick={enableNotifications}
                className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[12px] font-bold flex-shrink-0"
              >
                Activar
              </button>
            )}
          </div>
          <p className="text-[11px] text-stone-400 mt-3 pt-3 border-t border-stone-50 dark:border-stone-800">
            {permissionNote}
          </p>
        </div>
        {/* Etapa 10: la misma familia de avisos, pero con la app cerrada. Acá se activa la suscripción
        push del dispositivo; la tarjeta de arriba sigue siendo el permiso del navegador, que es lo que
        usa la app abierta. Se separan porque se pueden dar por separado: sin push la app sigue
        avisando mientras está abierta, y con push avisa también cuando no lo está. */}
        <div className="bg-white dark:bg-stone-900 rounded-3xl p-5 border border-stone-100 dark:border-stone-800 mb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-[14px]">Avisos con la app cerrada</p>
              <p className="text-[12px] text-stone-400 mt-1" aria-live="polite">
                {textoAvisos}
              </p>
            </div>
            {estadoAvisosAhora === "activo" ? (
              <button
                type="button"
                onClick={apagarAvisos}
                disabled={avisoOcupado}
                className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[12px] font-bold flex-shrink-0 disabled:opacity-50"
              >
                Apagar
              </button>
            ) : estadoAvisosAhora === "pendiente" ||
              estadoAvisosAhora === "bloqueado" ? (
              <button
                type="button"
                onClick={encenderAvisos}
                disabled={avisoOcupado}
                className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[12px] font-bold flex-shrink-0 disabled:opacity-50"
              >
                Activar avisos
              </button>
            ) : null}
          </div>
          <p className="text-[11px] text-stone-400 mt-3 pt-3 border-t border-stone-50 dark:border-stone-800">
            {notaAvisos}
          </p>
          {estadoAvisosAhora === "activo" && (
            <button
              type="button"
              onClick={probarAviso}
              disabled={avisoOcupado}
              className="mt-3 w-full py-2.5 rounded-xl bg-amber-500 text-white text-[12px] font-bold disabled:opacity-50"
            >
              Probar aviso
            </button>
          )}
          {avisoMensaje && (
            <p
              role="status"
              className={`text-[11px] mt-2 ${
                avisoMensaje.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {avisoMensaje.texto}
            </p>
          )}
          {!esInstalada() && (
            <p className="text-[11px] text-stone-400 mt-3 pt-3 border-t border-stone-50 dark:border-stone-800">
              Para tenerla como una app: en <strong>iPhone</strong>, Compartir → «Agregar a
              pantalla de inicio»; en <strong>Android</strong>, menú ⋮ → «Instalar
              aplicación».
            </p>
          )}
        </div>
        {/* Los tres calendarios en UNA sola burbuja: cerrada se ve el encabezado con los tres logos y la
        flecha, con el resumen de cuáles están conectados; al abrirla baja el contenido —Google, Apple y
        Outlook— dentro de la misma burbuja, y al fondo queda otra flecha para cerrarla. */}
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 overflow-hidden mb-4">
        <button
          type="button"
          onClick={() => setOpenCalendars((v) => !v)}
          aria-expanded={openCalendars}
          aria-label={`Calendarios de ${activeProfile.name}`}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
        >
          <span
            aria-hidden="true"
            className="flex items-center gap-0.5 rounded-full bg-stone-50 dark:bg-stone-800 border border-stone-100 dark:border-stone-800 px-1.5 py-1 flex-shrink-0"
          >
            <span className="w-6 h-6 rounded-full bg-white dark:bg-stone-900 flex items-center justify-center">
              <GoogleG className="w-3.5 h-3.5" />
            </span>
            <span className="w-6 h-6 rounded-full bg-white dark:bg-stone-900 flex items-center justify-center">
              <AppleG className="w-3.5 h-3.5" />
            </span>
            <span className="w-6 h-6 rounded-full bg-white dark:bg-stone-900 flex items-center justify-center">
              <OutlookG className="w-3.5 h-3.5" />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100 truncate">
              Calendarios de {activeProfile.name}
            </p>
            <p className="text-[12px] text-stone-400 truncate">
              {calendarSummary}
            </p>
          </span>
          <svg
            viewBox="0 0 10 6"
            aria-hidden="true"
            className={`w-3 h-2 flex-shrink-0 text-stone-400 transition-transform ${
              openCalendars ? "rotate-180" : ""
            }`}
          >
            <path
              d="M1 1l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {openCalendars && (
          <div className="border-t border-stone-100 dark:border-stone-800 px-5 pt-5 pb-2">
            <div data-calendar="google">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-100 dark:border-stone-800 flex items-center justify-center flex-shrink-0">
                  <GoogleG className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
                    Google Calendar
                  </p>
                  <p className="text-[12px] text-stone-400">
                    {gcal.connected
                      ? gcal.lastSync
                        ? `Conectado · Última sincronización ${timeAgo(gcal.lastSync)}`
                        : "Conectado · Sincroniza cuando quieras"
                      : "Sin conectar"}
                  </p>
                </div>
                {gcal.connected && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex-shrink-0">
                    ✓ Conectado
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                {gcal.connected ? (
                  <>
                    <button
                      onClick={syncGcal}
                      disabled={gcalBusy !== ""}
                      className="flex-1 py-3 rounded-2xl bg-amber-600 text-white text-[13px] font-bold disabled:opacity-60"
                    >
                      {gcalBusy === "sync"
                        ? "Sincronizando…"
                        : "Sincronizar ahora"}
                    </button>
                    <button
                      onClick={disconnectGcal}
                      className="px-4 py-3 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[13px] font-semibold"
                    >
                      Desconectar
                    </button>
                  </>
                ) : (
                  <button
                    onClick={connectGcal}
                    disabled={gcalBusy !== ""}
                    className="flex-1 py-3 rounded-2xl bg-[#4285F4] text-white text-[13px] font-bold disabled:opacity-60"
                  >
                    {gcalBusy === "connect"
                      ? "Conectando…"
                      : "Conectar con Google Calendar"}
                  </button>
                )}
              </div>
              {gcal.connected && (
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-stone-50 dark:border-stone-800">
                  <span className="text-[15px]">🗓️</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
                      Todos los avisos
                    </p>
                    <p className="text-[12px] text-stone-400">
                      {syncAll
                        ? "Los recordatorios nuevos vienen con Google Calendar activado; puedes apagarlo en cada uno."
                        : "Los recordatorios nuevos se crean sin Google Calendar; puedes encenderlo en cada uno."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleSyncAll}
                    aria-pressed={syncAll}
                    aria-label="Sincronizar todos los avisos con Google Calendar"
                    className={`w-11 h-6 rounded-full flex-shrink-0 transition-colors ${
                      syncAll
                        ? "bg-amber-500"
                        : "bg-stone-200 dark:bg-stone-600"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full shadow mx-0.5 transition-transform ${
                        syncAll ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
              )}
              <p className="text-[12px] text-stone-400 mt-3">
                {gcalEvents.length === 0
                  ? "Aún no has enviado recordatorios a tu calendario."
                  : `${gcalEvents.length} ${
                      gcalEvents.length === 1
                        ? "recordatorio está"
                        : "recordatorios están"
                    } en tu calendario.`}
              </p>
              {gcalMsg && (
                <p className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 mt-2">
                  {gcalMsg}
                </p>
              )}
              <p className="text-[11px] text-stone-400 mt-2">
                En esta versión la conexión es una demostración, sin cuenta de
                Google: no sincroniza sola todos tus recordatorios. Con la
                cuenta conectada y «Todos los avisos» activado, los
                recordatorios nuevos vienen con la opción de Google Calendar ya
                marcada y el envío se abre rellenado para que lo confirmes; si
                apagas «Todos los avisos», se crean sin marcar y lo enciendes en
                cada uno. También puedes descargar cualquier recordatorio en
                .ics para Apple Calendar y Outlook.
              </p>
            </div>
            {/* Apple Calendar y Outlook, cada uno con su tarjeta dentro del desplegable: se conectan y se
        sincronizan igual que Google Calendar, y su «Todos los avisos» decide si los recordatorios
        nuevos llevan ese calendario ya marcado. */}
            {/* Apple Calendar y Outlook: las mismas tarjetas, pero dentro de la MISMA burbuja blanca de Google
        y separadas con una línea, para que se lean como los tres calendarios de un solo bloque. */}
            {(["apple", "outlook"] as CalendarApp[]).map((app) => (
              <div
                key={app}
                data-calendar={app}
                className="mt-4 pt-4 border-t border-stone-50 dark:border-stone-800"
              >
                <CalendarSyncCard
                  bare
                  app={app}
                  state={calendarStateOf(activeProfile, app)}
                  events={myEvents}
                  userName={activeProfile.name}
                  onUpdate={(next) => onUpdateProfile(calendarPatch(app, next))}
                />
              </div>
            ))}
            {/* Flecha al fondo de la burbuja: cierra los calendarios sin volver al encabezado, con el
                mismo gesto que la burbuja del onboarding. */}
            <button
              type="button"
              onClick={() => setOpenCalendars(false)}
              aria-label={`Cerrar los calendarios de ${activeProfile.name}`}
              className="w-full mt-3 pt-3 pb-1 flex items-center justify-center text-stone-400"
            >
              <svg
                viewBox="0 0 10 6"
                aria-hidden="true"
                className="w-3.5 h-2.5 rotate-180"
              >
                <path
                  d="M1 1l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}
        </div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">
          Datos
        </p>
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-100 dark:border-stone-800 p-5 mb-4">
          <p className="text-[14px] font-medium text-stone-700 dark:text-stone-200">
            {events.length} recordatorios guardados
          </p>
          <p className="text-[12px] text-stone-400 mt-1">
            Se almacenan localmente en este navegador.
          </p>
          {/* Etapa 9: la copia de seguridad. Descargar deja un .json con todo; restaurar lo devuelve
              después de mostrar qué trae, porque reemplaza lo que hay guardado ahora. */}
          <div className="mt-4 pt-4 border-t border-stone-100 dark:border-stone-800">
            <p className="text-[13px] font-semibold text-stone-700 dark:text-stone-200">
              Copia de seguridad
            </p>
            <p className="text-[12px] text-stone-400 mt-1">
              Un archivo con tus recordatorios, usuarios, categorías, fotos y
              notas de voz. Sirve para cambiar de navegador o para no perder
              nada si se limpia este.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={descargar}
                disabled={ocupado}
                className="px-4 py-2.5 rounded-xl bg-amber-600 text-white text-[13px] font-bold disabled:opacity-50"
              >
                {ocupado ? "Un momento…" : "Descargar copia"}
              </button>
              <button
                type="button"
                onClick={() => archivoCopia.current?.click()}
                disabled={ocupado}
                className="px-4 py-2.5 rounded-xl bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 text-[13px] font-bold disabled:opacity-50"
              >
                Restaurar desde archivo
              </button>
            </div>
            <input
              ref={archivoCopia}
              type="file"
              accept=".json,application/json"
              aria-label="Archivo de copia de seguridad"
              className="hidden"
              onChange={(e) => {
                const elegido = e.target.files?.[0]
                // El campo se vacía para que elegir el mismo archivo otra vez vuelva a disparar el
                // cambio; el File ya está guardado en `elegido`, así que limpiarlo no lo invalida.
                e.target.value = ""
                void leerArchivo(elegido)
              }}
            />
            {pendiente && (
              <div className="mt-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-3">
                <p className="text-[12px] text-stone-600 dark:text-stone-300">
                  «{pendiente.nombre}» trae {pendiente.cuenta}. Se reemplaza lo
                  que hay guardado ahora.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={confirmarRestaurar}
                    disabled={ocupado}
                    className="px-3 py-2 rounded-xl bg-amber-600 text-white text-[12px] font-bold disabled:opacity-50"
                  >
                    Sí, restaurar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendiente(null)}
                    className="px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 text-[12px] font-bold"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {mensaje && (
              <p
                role="status"
                className={`mt-3 text-[12px] ${
                  mensaje.ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-500 dark:text-red-400"
                }`}
              >
                {mensaje.text}
              </p>
            )}
          </div>
          <button
            onClick={onReset}
            className="mt-4 text-red-500 dark:text-red-400 text-[13px] font-semibold"
          >
            Restaurar datos de demostración
          </button>
          <button
            onClick={onReplay}
            className="ml-4 text-amber-600 dark:text-amber-300 text-[13px] font-semibold"
          >
            Ver introducción de nuevo
          </button>
        </div>
        {/* Los tips quedaron solo en su botón, al fondo de Ajustes y después de Datos: la tarjeta con el
        título «Tips», la avispa y el resumen de consejos era una sección de más para llegar al mismo
        lado. El botón abre la misma sección de slides de siempre. */}
        <button
          onClick={onTips}
          className="w-full py-3.5 rounded-2xl bg-amber-600 text-white text-[14px] font-bold mb-4"
        >
          Ver tips
        </button>
        <p className="text-center text-[11px] text-stone-300 dark:text-stone-500 mt-8">
          AVISPATE · {APP_VERSION} · {APP_STAGE}
        </p>
      </div>
    </div>
  )
}

// Tips: una sección de slides con la misma navegación que el onboarding —tocar, deslizar el dedo o el
// mouse, y los puntos— pero sobre otro fondo (azul profundo, ver .tips-bg), para que nadie confunda los
// consejos con la introducción. Se entra desde Ajustes › Tips y se sale con la × o con «¡Listo!».
type TipSlide = {
  emoji: string
  title: string
  body: string
  highlight?: string
  scene?: "calendars" | "alert" | "attach" | "users"
}
const TIPS_SLIDES: TipSlide[] = [
  {
    emoji: "🔔",
    title: "Tú decides cuándo\navisarte",
    body: "En «¿Cuándo te aviso?» puedes marcar varios avisos para el mismo recordatorio: 90 días, 30, 7, 1 día o una hora antes. Los que estén encendidos se ven con su sombra.",
    highlight: "Se suman todos los avisos que quieras.",
  },
  {
    emoji: "⏰",
    title: "Repeticiones\na tu medida",
    body: "Cada 8 horas, cada semana, cada 2 semanas, cada mes, cada 6 meses o cada año. Y si necesitas otra cosa, «Personalizada» te deja elegir cada cuántas horas, días, semanas, meses o años vuelve.",
    highlight:
      "Al completarlo, el recordatorio salta solo a la próxima vuelta.",
  },
  {
    emoji: "📅",
    title: "Los tres calendarios\na la vez",
    body: "El mismo recordatorio puede ir a Google Calendar, a Apple Calendar y a Outlook. En Ajustes los tres viven en un solo lugar: los conectas uno por uno y el interruptor «Todos los avisos» decide si los nuevos llevan ese calendario marcado.",
    scene: "calendars",
  },
  {
    emoji: "📎",
    title: "Guarda todo\nel detalle",
    body: "Notas, una nota de voz, documentos y fotos: cabe todo dentro del recordatorio, para que no haya que ir a buscarlo a otra parte.",
    scene: "attach",
  },
  {
    emoji: "👥",
    title: "Un usuario\npara cada quien",
    body: "Cada usuario de este dispositivo tiene sus recordatorios, su contacto y sus calendarios. En Inicio puedes ver, en las insignias de cada uno, por dónde recibe sus avisos.",
    scene: "users",
  },
  {
    emoji: "📬",
    title: "Deja listo\nel contacto",
    body: "Con tu número de WhatsApp (con su extensión de país, Chile por defecto) y tu correo, y el ticket aceptado, los avisos salen por esos canales. Si falta alguno, el aviso llega igual como notificación.",
    highlight:
      "El nombre, el emoji y la foto se cambian en Ajustes › Mi perfil › Editar.",
  },
]

function TipsScreen({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const slide = TIPS_SLIDES[step]
  const last = step === TIPS_SLIDES.length - 1
  const next = () => setStep((s) => Math.min(s + 1, TIPS_SLIDES.length - 1))
  const prev = () => setStep((s) => Math.max(s - 1, 0))
  // Mismo criterio que el onboarding: los gestos que empiezan en un botón no navegan, y el clic que los
  // navegadores de teléfono mandan detrás de un deslizar no cuenta como toque.
  const start = useRef<{ x: number ;y: number } | null>(null)
  const swipedAt = useRef(0)
  const onField = (target: EventTarget | null) =>
    !!(target as HTMLElement | null)?.closest?.("button")
  const swipeStart = (x: number, y: number, target: EventTarget | null) => {
    start.current = onField(target) ? null : { x, y }
  }
  const swipeEnd = (x: number, target: EventTarget | null) => {
    const gesture = start.current
    start.current = null
    if (!gesture || (target && onField(target))) return
    if (Math.abs(x - gesture.x) < 50) return
    swipedAt.current = Date.now()
    if (x < gesture.x) next()
    else prev()
  }
  const tap = () => {
    if (Date.now() - swipedAt.current < 350) return
    next()
  }
  return (
    <div className="flex flex-col h-full tips-bg text-white">
      <div className="flex items-center justify-between px-5 pt-12 pb-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
          Tips de AVISPATE
        </span>
        <button
          onClick={onClose}
          aria-label="Cerrar los tips"
          className="w-9 h-9 rounded-2xl bg-white/15 border border-white/25 text-white text-lg leading-none"
        >
          ×
        </button>
      </div>
      <div
        onClick={tap}
        style={{ touchAction: "pan-y" }}
        onTouchStart={(e) => {
          const t = e.touches[0]
          if (t) swipeStart(t.clientX, t.clientY, e.target)
        }}
        onTouchEnd={(e) => {
          const t = e.changedTouches[0]
          if (t) swipeEnd(t.clientX, e.target)
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") return
          swipeStart(e.clientX, e.clientY, e.target)
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") return
          swipeEnd(e.clientX, e.target)
        }}
        className="flex-1 flex flex-col items-center justify-center px-8 py-4 cursor-pointer select-none overflow-y-auto"
      >
        <div key={step} className="flex flex-col items-center">
          <span className="animate-pop-in text-[64px] leading-none">
            {slide.emoji}
          </span>
          <h1 className="animate-slide-in [animation-delay:90ms] mt-5 text-[26px] font-extrabold leading-tight text-center whitespace-pre-line">
            {slide.title}
          </h1>
          <p className="animate-slide-in [animation-delay:180ms] mt-3 text-[15px] text-white/85 text-center leading-relaxed">
            {slide.body}
          </p>
          {slide.scene === "calendars" && <CalendarsScene />}
          {slide.scene === "alert" && <AlertPickerScene />}
          {slide.scene === "attach" && <AttachScene />}
          {slide.scene === "users" && <ProfilesScene />}
          {slide.highlight && (
            <p className="animate-slide-in [animation-delay:420ms] mt-4 text-[15px] font-extrabold text-center leading-relaxed">
              {slide.highlight}
            </p>
          )}
        </div>
      </div>
      <div className="px-8 pb-10 flex flex-col items-center gap-4">
        <div className="flex items-center">
          {TIPS_SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              aria-label={`Tip ${i + 1} de ${TIPS_SLIDES.length}`}
              aria-current={i === step}
              className="cursor-pointer px-2 py-2"
            >
              <span
                className={`block h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? "w-6 bg-white" : "w-1.5 bg-white/40"
                }`}
              />
            </button>
          ))}
        </div>
        <button
          onClick={last ? onClose : next}
          className="w-full py-4 rounded-2xl bg-white text-stone-800 font-bold text-[15px]"
        >
          {last ? "¡Listo!" : "Siguiente tip"}
        </button>
        <p className="text-[12px] font-semibold text-white/70">
          Tip {step + 1} de {TIPS_SLIDES.length}
        </p>
      </div>
    </div>
  )
}

// Despedida del onboarding: al terminar se ve solo la abeja grande en el centro, se va volando
// hacia la izquierda y la siguen varias abejas pequeñas, mientras el velo ámbar (el mismo
// degradado del último paso) se desvanece y deja ver el inicio de la app saliendo del desenfoque.
// El velo y el revelado duran lo mismo que la vida del componente, así el relevo no se corta.
const BEE_HANDOFF_MS = 2700
const beeReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

function BeeHandoff() {
  // Cada abeja pequeña entra un poco después que la anterior y vuela en su propio carril. El
  // carril va en un contenedor aparte para que no pelee con la animación de vuelo (transform).
  const followers = [
    {
      size: "text-[30px]",
      lane: "-translate-y-9 -translate-x-4",
      delay: "980ms",
    },
    {
      size: "text-[22px]",
      lane: "translate-y-7 -translate-x-2",
      delay: "1110ms",
    },
    {
      size: "text-[26px]",
      lane: "-translate-y-2 -translate-x-9",
      delay: "1240ms",
    },
    {
      size: "text-[18px]",
      lane: "translate-y-14 translate-x-3",
      delay: "1370ms",
    },
  ]
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      <div className="animate-bee-curtain absolute inset-0 bg-linear-to-b from-amber-500 to-amber-700" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="animate-pop-in [animation-delay:120ms]">
          <span className="animate-bee-fly-left [animation-delay:800ms] block text-[112px] leading-none">
            🐝
          </span>
        </span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        {followers.map((f) => (
          <span
            key={f.delay}
            className={`flex leading-none ${f.size} ${f.lane}`}
          >
            <span
              className="animate-bee-follow block"
              style={{ animationDelay: f.delay }}
            >
              🐝
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    localStorage.getItem(STORAGE_ONBOARDING) ? "home" : "onboarding",
  )
  const [tab, setTab] = useState<Tab>("home")
  const [events, setEvents] = useState<Reminder[]>(loadEvents)
  const [notifications, setNotifications] =
    useState<AppNotification[]>(loadNotifications)
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles)
  const [activeProfileId, setActiveProfileId] = useState<string>(() => {
    try {
      const s = localStorage.getItem(STORAGE_ACTIVE_PROFILE)
      if (s) return s
    } catch {}
    return DEFAULT_PROFILE_ID
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [createDate, setCreateDate] = useState<string | undefined>(undefined)
  // Las categorías del dispositivo: se leen de su clave (o las de fábrica si no hay nada guardado) y se
  // guardan solas cuando cambian. Agregar, reordenar y eliminar se hacen desde Inicio.
  const [categories, setCategories] = useState<Category[]>(loadCategories)
  // Categoría con la que se abre el formulario de un recordatorio NUEVO: se llena al agregar desde una
  // categoría vacía de Inicio, para no tener que volver a elegirla a mano.
  const [createCategory, setCreateCategory] = useState<string | undefined>(
    undefined,
  )
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DARK)
      if (saved !== null) return saved === "1"
    } catch {}
    return (
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
    )
  })
  // Formato de hora de los avisos (24 h o a.m./p.m.): se elige en Ajustes › Apariencia y es del
  // dispositivo, como el modo oscuro. Se aplica al campo de hora del recordatorio, a las tarjetas y
  // al detalle; los datos guardados siguen siendo "HH:MM" de 24 h (Google Calendar y .ics incluidos).
  const [clock12, setClock12] = useState<boolean>(loadClock12)
  // Relevo al cerrar el onboarding: mientras la abeja se despide y el velo se desvanece, el
  // inicio de la app se revela saliendo del desenfoque (ver BeeHandoff). El temporizador lo apaga.
  const [handoff, setHandoff] = useState(false)
  const handoffTimer = useRef<number | null>(null)
  // Etapa 10: la entrega nueva avisa con una píldora, no recargando sola. El service worker nuevo se
  // queda esperando a que alguien toque «Actualizar» (ver src/lib/pwa.ts).
  const [versionNueva, setVersionNueva] = useState(false)
  useEffect(() => {
    let vivo = true
    const arrancar = async () => {
      await registrarSW()
      if (!vivo) return
      vigilarVersionNueva(() => setVersionNueva(true))
    }
    void arrancar()
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    try {
      localStorage.setItem(STORAGE_DARK, dark ? "1" : "0")
    } catch {}
  }, [dark])

  useEffect(() => {
    saveClock12(clock12)
  }, [clock12])

  useEffect(
    () => () => {
      if (handoffTimer.current) window.clearTimeout(handoffTimer.current)
    },
    [],
  )

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ??
    profiles[0] ??
    DEFAULT_PROFILE
  const ownerOfId = (o?: string) => o || DEFAULT_PROFILE_ID
  // Cada usuario del dispositivo guarda lo suyo (contacto, canales y Google Calendar). Estas dos
  // ayudas son las únicas puertas de escritura a `profiles` desde las pantallas: Ajustes escribe en
  // el usuario activo y el onboarding en el usuario "yo".
  const updateProfile = (id: string, patch: Partial<Profile>) =>
    setProfiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    )
  const patchOwnProfile = (patch: Partial<Profile>) =>
    setProfiles((prev) => patchDefaultProfile(prev, patch))
  const userEvents = events.filter(
    (e) => ownerOfId(e.ownerId) === activeProfile.id,
  )
  const userNotifications = notifications.filter(
    (n) => ownerOfId(n.ownerId) === activeProfile.id,
  )
  useEffect(() => {
    localStorage.setItem(STORAGE_PROFILES, JSON.stringify(profiles))
  }, [profiles])
  useEffect(() => {
    localStorage.setItem(STORAGE_ACTIVE_PROFILE, activeProfile.id)
  }, [activeProfile.id])

  useEffect(() => {
    localStorage.setItem(STORAGE_EVENTS, JSON.stringify(events))
  }, [events])
  // Etapa 10: la cola de avisos con la app cerrada. Se recalcula cuando cambian los recordatorios (y al
  // abrir), se guarda en el dispositivo —la batería la mira ahí— y, si este teléfono ya está suscrito,
  // se sube a la nube. Recalcular es barato (unas fechas) y así el servidor nunca queda con una cola
  // vieja; subirla tarda un momento y se agrupa (ver sincronizarCola).
  useEffect(() => {
    const cola = programarAvisos(events)
    try {
      localStorage.setItem(STORAGE_COLA, JSON.stringify(cola))
    } catch {}
    if (pushAnotado()) void sincronizarCola(cola)
  }, [events])
  useEffect(() => {
    localStorage.setItem(STORAGE_NOTIFICATIONS, JSON.stringify(notifications))
  }, [notifications])
  useEffect(() => {
    localStorage.setItem(STORAGE_CATEGORIES, JSON.stringify(categories))
  }, [categories])

  // Categorías: agregar (sin repetir el nombre, sin distinguir mayúsculas), mover una posición y
  // eliminar. Al eliminar se decide qué pasa con sus recordatorios: se borran con ella (y con sus
  // adjuntos) o se quedan sin categoría, así dejan de aparecer en el carrusel y se ven sólo en «Todas».
  const addCategory = (name: string, emoji: string) => {
    const limpio = name.trim()
    if (!limpio) return
    setCategories((prev) =>
      prev.some((c) => c.name.toLowerCase() === limpio.toLowerCase())
        ? prev
        : [...prev, { name: limpio, emoji: emoji || CATEGORY_EMOJI }],
    )
  }
  const moveCategory = (name: string, dir: -1 | 1) => {
    setCategories((prev) => {
      const i = prev.findIndex((c) => c.name === name)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const copia = [...prev]
      ;[copia[i], copia[j]] = [copia[j], copia[i]]
      return copia
    })
  }
  const removeCategory = (name: string, queHacer: "borrar" | "soltar") => {
    if (queHacer === "borrar") {
      const condenados = events.filter((e) => e.category === name)
      condenados.forEach((e) =>
        (e.attachments ?? []).forEach((a) => deleteAttachment(a.id)),
      )
      const ids = new Set(condenados.map((e) => e.id))
      setEvents((prev) => prev.filter((e) => e.category !== name))
      setNotifications((prev) => prev.filter((n) => !n.eventId || !ids.has(n.eventId)))
      if (selectedId && ids.has(selectedId)) {
        setSelectedId(null)
        setScreen(tab as Screen)
      }
    } else {
      setEvents((prev) =>
        prev.map((e) =>
          e.category === name ? { ...e, category: "", categoryEmoji: "" } : e,
        ),
      )
    }
    setCategories((prev) => prev.filter((c) => c.name !== name))
  }

  const selected = events.find((e) => e.id === selectedId)
  const editing = events.find((e) => e.id === editingId)
  const goTab = (t: Tab) => {
    setTab(t)
    setScreen(t as Screen)
  }
  const doneOnboarding = (
    name?: string,
    emoji?: string,
    contact?: Contact,
    photo?: string,
  ) => {
    const cleanName = (name ?? "").trim()
    const cleanEmoji = (emoji ?? "").trim()
    // Al terminar el onboarding el usuario local de este dispositivo ("yo") queda siempre activo:
    // - si escribió un nombre, ese nombre (y su emoji) reemplazan al perfil "yo"
    // - si saltó, el perfil se restablece a "Yo" para no quedarse con un usuario guardado antes
    // - el contacto del último paso (número de WhatsApp y correo) se guarda DENTRO de ese usuario;
    //   si saltó ese paso no se toca lo que hubiera antes. El interruptor de Google Calendar ya se
    //   fue guardando en el mismo perfil mientras recorría el paso.
    setProfiles((prev) => {
      const current = prev.find((p) => p.id === DEFAULT_PROFILE_ID)
      return patchDefaultProfile(prev, {
        name: cleanName || DEFAULT_PROFILE.name,
        emoji: cleanName
          ? cleanEmoji || current?.emoji || DEFAULT_PROFILE.emoji
          : DEFAULT_PROFILE.emoji,
        // La foto elegida en el paso del nombre se guarda con el resto de su cara; si saltó el paso, se
        // respeta la que ya tuviera.
        photo: cleanName ? photo || undefined : current?.photo,
        ...(contact
          ? {
              contact: {
                phone: contact.phone.trim(),
                email: contact.email.trim(),
              },
            }
          : {}),
      })
    })
    setActiveProfileId(DEFAULT_PROFILE_ID)
    localStorage.setItem(STORAGE_ONBOARDING, "1")
    setScreen("home")
    setTab("home")
    // En vez de caer de golpe en el inicio, la abeja se despide: aparece sola en el centro, se va
    // volando a la izquierda con las pequeñas detrás y el inicio se revela desde el desenfoque.
    // Con movimiento reducido se entra directo a la app (el CSS también lo desactiva).
    if (!beeReducedMotion()) {
      setHandoff(true)
      if (handoffTimer.current) window.clearTimeout(handoffTimer.current)
      handoffTimer.current = window.setTimeout(
        () => setHandoff(false),
        BEE_HANDOFF_MS,
      )
    }
  }
  const saveEvent = async (r: Reminder, files: File[] = []) => {
    // El permiso de notificaciones se pide aquí, dentro del mismo toque de «Guardar recordatorio» y
    // antes de cualquier await: el navegador solo muestra su cartel si viene de un gesto del usuario.
    askNotificationPermission(r)
    const metas = r.attachments ?? []
    const start = Math.max(0, metas.length - files.length)
    await Promise.all(
      files.map((file, i) => saveAttachment(metas[start + i].id, file)),
    )
    const alreadyAdded = events.some((e) => e.id === r.id && e.gcalAddedAt)
    setEvents((prev) =>
      prev.some((e) => e.id === r.id)
        ? prev.map((e) => (e.id === r.id ? r : e))
        : [r, ...prev],
    )
    // Si el formulario lo mandó a Google Calendar, queda la constancia en el historial.
    if (r.gcalAddedAt && !alreadyAdded)
      setNotifications((n) => [
        {
          id: uid(),
          eventId: r.id,
          eventName: r.name,
          emoji: "📅",
          ownerId: r.ownerId || DEFAULT_PROFILE_ID,
          message: `${r.name} se envió a Google Calendar.`,
          createdAt: r.gcalAddedAt as string,
          channel: "Google Calendar",
          status: "Enviado",
        },
        ...n,
      ])
    setEditingId(null)
    setScreen(tab as Screen)
  }
  const deleteEvent = () => {
    if (!selectedId) return
    const old = events.find((e) => e.id === selectedId)
    ;(old?.attachments ?? []).forEach((a) => deleteAttachment(a.id))
    setEvents((prev) => prev.filter((e) => e.id !== selectedId))
    setSelectedId(null)
    setScreen(tab as Screen)
  }
  const removeAttachment = (attachmentId: string) => {
    if (!selectedId) return
    deleteAttachment(attachmentId)
    setEvents((prev) =>
      prev.map((e) =>
        e.id === selectedId
          ? {
              ...e,
              attachments: (e.attachments ?? []).filter(
                (a) => a.id !== attachmentId,
              ),
            }
          : e,
      ),
    )
  }
  const completeEvent = () => {
    if (!selectedId) return
    const stamp = new Date().toISOString()
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== selectedId) return e
        if (e.completed) return { ...e, completed: false }
        if (e.recurrence !== "No se repite") {
          // La repetición puede mover el reloj (cada 8 horas), así que la próxima vuelta devuelve fecha y hora.
          const next = nextOccurrenceAt(
            e.date,
            e.time,
            e.recurrence,
            e.recurrenceInterval,
            e.recurrenceUnit,
          )
          return {
            ...e,
            date: next.date,
            time: next.time,
            completed: false,
            history: [
              { id: uid(), date: e.date, completedAt: stamp },
              ...(e.history ?? []),
            ],
          }
        }
        return { ...e, completed: true }
      }),
    )
    setSelectedId(null)
    setScreen("home")
    setTab("home")
  }
  // El usuario mandó este recordatorio a uno de los tres calendarios: se marca ese destino y queda en
  // el historial de avisos. Cada calendario lleva su propia fecha, así que el mismo recordatorio puede
  // estar en Google, en Apple y en Outlook a la vez.
  const markCalendar = (app: CalendarApp) => {
    if (!selected) return
    const field = CALENDAR_FIELDS[app]
    if (selected[field]) return
    const label = CALENDAR_LABELS[app]
    const stamp = new Date().toISOString()
    setEvents((prev) =>
      prev.map((e) => (e.id === selected.id ? { ...e, [field]: stamp } : e)),
    )
    setNotifications((n) => [
      {
        id: uid(),
        eventId: selected.id,
        eventName: selected.name,
        emoji: "📅",
        ownerId: selected.ownerId || DEFAULT_PROFILE_ID,
        message: `${selected.name} se envió a ${label}.`,
        createdAt: stamp,
        channel: label,
        status: "Enviado",
      },
      ...n,
    ])
  }
  const reset = () => {
    setEvents(SAMPLE_EVENTS)
    setNotifications([])
    localStorage.setItem(STORAGE_ONBOARDING, "1")
    setScreen("home")
    setTab("home")
  }

  // Copia de seguridad (Etapa 9): se arma con lo que hay guardado en este momento y se descarga como un
  // .json. Los adjuntos se leen de IndexedDB uno por uno; si alguno ya no está (o el navegador no deja
  // abrir la base), la copia sale igual, sin ese archivo y sin romper nada.
  const descargarCopia = async (): Promise<RespuestaCopia> => {
    try {
      const datos: Record<string, string> = {}
      for (const clave of CLAVES_COPIA) {
        const guardado = localStorage.getItem(clave)
        if (guardado !== null) datos[clave] = guardado
      }
      const adjuntos: Record<string, AdjuntoEnCopia> = {}
      for (const evento of events) {
        for (const meta of evento.attachments ?? []) {
          if (adjuntos[meta.id]) continue
          try {
            const blob = await getAttachment(meta.id)
            if (!blob) continue
            adjuntos[meta.id] = {
              type: blob.type || meta.type,
              data: await blobABase64(blob),
            }
          } catch {}
        }
      }
      const texto = serializarCopia(armarCopia(datos, adjuntos))
      downloadTextFile(texto, nombreDeCopia(), "application/json")
      return {
        ok: true,
        text: `Copia descargada: ${cuantos(
          events.length,
          "recordatorio",
          "recordatorios",
        )} y ${cuantos(
          Object.keys(adjuntos).length,
          "adjunto",
          "adjuntos",
        )} (${formatFileSize(new Blob([texto]).size)}).`,
      }
    } catch {
      return {
        ok: false,
        text: "No se pudo preparar la copia. Prueba de nuevo.",
      }
    }
  }

  // Restaurar reemplaza las claves de la copia y deja el resto del dispositivo como está. Las marcas de
  // «ya avisado» se borran para que los recordatorios restaurados puedan volver a avisar; la última
  // visita y el aviso de inactividad no se tocan (son del momento, no del respaldo). Al final no se
  // recarga: se relee lo restaurado y la pantalla lo muestra en el acto, sin salir de Ajustes.
  const restaurarCopia = async (copia: Copia): Promise<RespuestaCopia> => {
    try {
      for (const clave of CLAVES_COPIA) localStorage.removeItem(clave)
      for (const [clave, guardado] of Object.entries(copia.datos))
        localStorage.setItem(clave, guardado)
      const enviados: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const clave = localStorage.key(i)
        if (clave?.startsWith(SENT_PREFIX)) enviados.push(clave)
      }
      enviados.forEach((clave) => localStorage.removeItem(clave))

      let adjuntos = 0
      for (const [id, archivo] of Object.entries(copia.adjuntos)) {
        try {
          await saveAttachment(id, blobDesdeBase64(archivo.data, archivo.type))
          adjuntos += 1
        } catch {}
      }

      const restaurados = loadProfiles()
      const activo = copia.datos[STORAGE_ACTIVE_PROFILE] ?? ""
      setProfiles(restaurados)
      setActiveProfileId(
        restaurados.some((p) => p.id === activo) ? activo : restaurados[0].id,
      )
      setEvents(loadEvents())
      setNotifications(loadNotifications())
      setCategories(loadCategories())
      setClock12(loadClock12())
      const oscuro = copia.datos[STORAGE_DARK]
      if (oscuro === "0" || oscuro === "1") setDark(oscuro === "1")
      setSelectedId(null)
      setEditingId(null)

      return {
        ok: true,
        text: `Copia restaurada: ${cuantos(
          contarEnCopia(copia.datos, STORAGE_EVENTS),
          "recordatorio",
          "recordatorios",
        )}, ${cuantos(restaurados.length, "usuario", "usuarios")} y ${cuantos(
          adjuntos,
          "adjunto",
          "adjuntos",
        )}.`,
      }
    } catch {
      return {
        ok: false,
        text: "No se pudo restaurar la copia. Prueba con otro archivo.",
      }
    }
  }
  const addProfile = (name: string, emoji: string, photo?: string) => {
    const p: Profile = {
      id: uid(),
      name: name.trim(),
      emoji: emoji.trim() || DEFAULT_PROFILE.emoji,
      ...(photo ? { photo } : {}),
    }
    setProfiles((v) => [...v, p])
    setActiveProfileId(p.id)
  }
  const selectProfile = (id: string) => {
    setActiveProfileId(id)
  }
  // Eliminar un usuario borra lo suyo en este dispositivo: sus recordatorios (con sus archivos y sus
  // marcas de "ya enviado"), sus avisos del historial y el perfil mismo, que es donde viven su
  // contacto, sus canales y su Google Calendar. Si el borrado era el activo, pasa el mando a otro.
  const deleteProfile = (id: string) => {
    if (profiles.length <= 1) return
    const doomed = events.filter((e) => ownerOfId(e.ownerId) === id)
    doomed.forEach((e) =>
      (e.attachments ?? []).forEach((a) => deleteAttachment(a.id)),
    )
    doomed.forEach((e) =>
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith(SENT_PREFIX) && k.includes(`${e.id}:`))
          localStorage.removeItem(k)
      }),
    )
    setEvents((prev) => prev.filter((e) => ownerOfId(e.ownerId) !== id))
    setNotifications((prev) => prev.filter((n) => ownerOfId(n.ownerId) !== id))
    setProfiles((prev) => prev.filter((p) => p.id !== id))
    if (activeProfile.id === id) {
      const next = profiles.find((p) => p.id !== id)
      if (next) setActiveProfileId(next.id)
    }
  }
  const replayOnboarding = () => {
    localStorage.removeItem(STORAGE_ONBOARDING)
    location.reload()
  }

  // Pide el permiso del navegador en el momento en que hace falta: al guardar un recordatorio que
  // incluye el canal Notificación y con el permiso todavía sin decidir ("default"). Si ya está
  // concedido o bloqueado no hace nada (el navegador no vuelve a mostrar su cartel) y si el navegador
  // no admite avisos, tampoco. Se llama desde saveEvent, o sea dentro del clic de guardar.
  const askNotificationPermission = (r: Reminder) => {
    if (!("Notification" in window) || Notification.permission !== "default")
      return
    if (!r.channels.includes("Notificación")) return
    try {
      const asked = Notification.requestPermission()
      if (asked && typeof asked.catch === "function") asked.catch(() => {})
    } catch {}
  }

  // Aviso de inactividad: es el único que no depende de un recordatorio. Al abrir la app se compara la
  // visita anterior con la de ahora y, si pasó una semana o más, se deja el «Bzzt…» en el historial de
  // avisos (y como notificación del navegador si el permiso está concedido), una sola vez por hueco.
  // El otro efecto —el de abajo— va marcando la última visita mientras la app está abierta, así la
  // cuenta es de uso y no de apertura. Con la app cerrada todavía no se puede avisar: para eso hace
  // falta el push real (servicio de notificaciones + servidor), que no existe en esta versión local.
  useEffect(() => {
    let previous: string | null = null
    let lastNudge: string | null = null
    if (!localStorage.getItem(STORAGE_ONBOARDING)) return // onboarding a medias: todavía no hay uso que recordar
    try {
      previous = localStorage.getItem(STORAGE_LAST_SEEN)
    } catch {}
    // La visita se marca siempre (también en el primer arranque): así la próxima vez hay con qué comparar.
    try {
      localStorage.setItem(STORAGE_LAST_SEEN, new Date().toISOString())
    } catch {}
    if (!previous) return
    const days = (Date.now() - new Date(previous).getTime()) / 86400000
    if (!(days >= INACTIVITY_DAYS)) return
    try {
      lastNudge = localStorage.getItem(STORAGE_INACTIVITY)
    } catch {}
    if (
      lastNudge &&
      (Date.now() - new Date(lastNudge).getTime()) / 86400000 < INACTIVITY_DAYS
    )
      return
    try {
      localStorage.setItem(STORAGE_INACTIVITY, new Date().toISOString())
    } catch {}
    const message = `${INACTIVITY_MESSAGE} Llevas ${Math.floor(days)} días sin abrir AVISPATE.`
    setNotifications((prev) => [
      {
        id: uid(),
        eventId: "inactividad",
        eventName: "No te olvides de no olvidarte",
        emoji: "🐝",
        ownerId: activeProfileId,
        message,
        createdAt: new Date().toISOString(),
        channel: "Notificación",
        status: "Enviado",
      },
      ...prev,
    ])
    if ("Notification" in window && Notification.permission === "granted")
      new Notification("AVISPATE · Avíspate 🐝", { body: INACTIVITY_MESSAGE })
  }, [activeProfileId])

  // Última visita: se marca al abrir y cada vez que la app pasa a segundo plano o se cierra, para que
  // el aviso de inactividad mida tiempo sin usar AVISPATE y no tiempo sin abrirla.
  useEffect(() => {
    const touch = () => {
      try {
        localStorage.setItem(STORAGE_LAST_SEEN, new Date().toISOString())
      } catch {}
    }
    const onHide = () => {
      if (document.visibilityState === "hidden") touch()
    }
    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", touch)
    return () => {
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", touch)
      touch()
    }
  }, [])

  // V1.5 local reminder engine: checks configured dates on app activity and can show browser notifications.
  useEffect(() => {
    const check = () => {
      const now = new Date()
      events
        .filter((e) => !e.completed)
        .forEach((e) => {
          const eventAt = parseDate(e.date, e.time)
          const alerts = [
            ...e.remindersBefore.map((offset) => ({
              id: `preset-${offset}`,
              offset,
              label: offsetLabel(offset),
            })),
            ...(e.customReminders ?? []).map((r) => ({
              id: r.id,
              offset: alertToDays(r),
              label: unitText(r.unit, r.amount),
            })),
          ]
          alerts.forEach((alert) => {
            const offset = alert.offset
            if (!alertDueAt(eventAt, offset, now)) return
            const key = `${e.id}:${alert.id}:${dateKey()}`
            if (localStorage.getItem(`${SENT_PREFIX}${key}`)) return
            // El aviso sale por los canales que el DUEÑO del recordatorio tiene listos: si a ese usuario
            // todavía no le configuraron WhatsApp o correo, sale por notificación; si apagó del todo las
            // notificaciones y no tiene ningún canal, no hay nada que enviar (y no se marca como
            // enviado, así lo recibe cuando configure su canal).
            const owner =
              profiles.find(
                (p) => p.id === (e.ownerId || DEFAULT_PROFILE_ID),
              ) ?? DEFAULT_PROFILE
            const delivery = deliveryChannels(e, owner)
            if (!delivery.length) return
            localStorage.setItem(`${SENT_PREFIX}${key}`, "1")
            const message = `${e.name} vence ${
              offset === 0 ? "hoy" : `en ${alert.label}`
            }.`
            const channel = delivery.includes("WhatsApp")
              ? "WhatsApp (simulado en V1)"
              : delivery.includes("Correo")
                ? "Correo (simulado en V1)"
                : "Notificación"
            setNotifications((n) => [
              {
                id: uid(),
                eventId: e.id,
                eventName: e.name,
                emoji: e.categoryEmoji,
                ownerId: e.ownerId || DEFAULT_PROFILE_ID,
                message,
                createdAt: new Date().toISOString(),
                channel,
                status: "Enviado",
              },
              ...n,
            ])
            if (
              delivery.includes("Notificación") &&
              "Notification" in window &&
              Notification.permission === "granted"
            )
              new Notification("AVISPATE · Recordatorio", { body: message })
          })
        })
    }
    check()
    const timer = window.setInterval(check, 60000)
    return () => window.clearInterval(timer)
  }, [events, profiles])

  const showNav = ["home", "calendar", "notifications", "settings"].includes(
    screen,
  )
  // Mientras dura la despedida de la abeja, el inicio (pantallas y barra inferior) llega desde el
  // desenfoque y el velo ámbar se va desvaneciendo para dejarlo ver (ver BeeHandoff).
  const reveal = handoff ? "animate-app-reveal" : ""
  return (
    <div className="min-h-full flex items-center justify-center bg-transparent dark:bg-stone-950 p-0 sm:p-4">
      <div
        id="app-frame"
        className="relative w-full sm:w-[390px] h-[100dvh] sm:h-[844px] app-bg dark:bg-stone-950 sm:rounded-[44px] overflow-hidden shadow-2xl border border-white/20 dark:border-stone-800"
      >
        <div className="absolute top-0 left-0 right-0 h-11 flex items-center justify-between px-8 z-30 pointer-events-none">
          <span className="text-[12px] font-semibold text-stone-800 dark:text-stone-100">
            {new Date().toLocaleTimeString("es-CL", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="text-[12px] text-stone-800 dark:text-stone-100">
            ● ●
          </span>
        </div>
        <div className={`absolute inset-0 flex flex-col ${reveal}`}>
          {screen === "onboarding" && (
            <OnboardingScreen
              onDone={doneOnboarding}
              onDefaultProfile={patchOwnProfile}
            />
          )}
          {screen === "home" && (
            <HomeScreen
              events={userEvents}
              notifications={userNotifications}
              profiles={profiles}
              activeProfile={activeProfile}
              onSelectProfile={selectProfile}
              onAddProfile={addProfile}
              onEventClick={(id) => {
                setSelectedId(id)
                setScreen("detail")
              }}
              onAdd={(category) => {
                setEditingId(null)
                setCreateDate(undefined)
                setCreateCategory(category)
                setScreen("create")
              }}
              categories={categories}
              onAddCategory={addCategory}
              onMoveCategory={moveCategory}
              onRemoveCategory={removeCategory}
              clock12={clock12}
            />
          )}
          {screen === "create" && (
            <CreateScreen
              initial={editing ?? undefined}
              initialDate={createDate}
              initialCategory={createCategory}
              onClose={() => setScreen(tab as Screen)}
              onSave={saveEvent}
              profiles={profiles}
              activeProfileId={activeProfile.id}
              categories={categories}
              onAddCategory={addCategory}
              clock12={clock12}
            />
          )}
          {screen === "detail" && selected && (
            <DetailScreen
              event={selected}
              onBack={() => {
                setSelectedId(null)
                setScreen(tab as Screen)
              }}
              onEdit={() => {
                setEditingId(selected.id)
                setCreateDate(undefined)
                setScreen("create")
              }}
              onDelete={deleteEvent}
              onComplete={completeEvent}
              onRemoveAttachment={removeAttachment}
              onCalendar={markCalendar}
              clock12={clock12}
            />
          )}
          {screen === "calendar" && (
            <CalendarScreen
              events={userEvents}
              onEventClick={(id) => {
                setSelectedId(id)
                setScreen("detail")
              }}
              onCreateDate={(d) => {
                setEditingId(null)
                setCreateDate(d)
                setCreateCategory(undefined)
                setScreen("create")
              }}
              clock12={clock12}
            />
          )}
          {screen === "notifications" && (
            <HistorialScreen
              events={userEvents}
              onEventClick={(id) => {
                setSelectedId(id)
                setScreen("detail")
              }}
            />
          )}
          {screen === "settings" && (
            <SettingsScreen
              events={events}
              dark={dark}
              onToggleDark={() => setDark((v) => !v)}
              onReset={reset}
              profiles={profiles}
              activeProfile={activeProfile}
              onSelectProfile={selectProfile}
              onDeleteProfile={deleteProfile}
              onAddProfile={addProfile}
              onReplay={replayOnboarding}
              onUpdateProfile={(patch) =>
                updateProfile(activeProfile.id, patch)
              }
              onTips={() => setScreen("tips")}
              clock12={clock12}
              onClock12={setClock12}
              onBackup={descargarCopia}
              onRestore={restaurarCopia}
            />
          )}
          {screen === "tips" && (
            <TipsScreen onClose={() => setScreen("settings")} />
          )}
        </div>
        {showNav && (
          <div className={`absolute bottom-0 left-0 right-0 z-20 ${reveal}`}>
            <BottomNav
              tab={tab}
              onTab={goTab}
              onAdd={() => {
                setEditingId(null)
                setCreateDate(undefined)
                setCreateCategory(undefined)
                setScreen("create")
              }}
            />
          </div>
        )}
        {versionNueva && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-24 z-40 flex items-center gap-2 rounded-full bg-stone-900/95 dark:bg-stone-100/95 text-white dark:text-stone-900 pl-4 pr-1.5 py-1.5 shadow-lg">
            <span className="text-[11px] font-semibold whitespace-nowrap">
              Hay una versión nueva
            </span>
            <button
              type="button"
              onClick={() => {
                setVersionNueva(false)
                void activarVersionNueva()
              }}
              className="rounded-full bg-amber-500 text-white text-[11px] font-bold px-3 py-1.5"
            >
              Actualizar
            </button>
          </div>
        )}
        {handoff && <BeeHandoff />}
      </div>
    </div>
  )
}
