// Claves VAPID para el push (Etapa 10): el par que identifica a AVISPATE ante APNs y FCM cuando el
// servidor manda un aviso. Se generan una sola vez y no se regeneran: si cambian, todas las
// suscripciones guardadas dejan de servir y hay que volver a activarlas en cada dispositivo.
//
//   node scripts/generar-vapid.mjs
//
// La pública viaja al navegador (es pública por diseño, como el nombre del remitente); la privada
// SOLO va a los secretos de las funciones de Supabase y nunca al bundle ni al repo. Se usa el JWK de
// Node —que ya entrega las dos coordenadas en base64url— en vez de recortar el DER a mano: el punto
// sin comprimir que espera el navegador es 0x04 + x + y, y así sale sin adivinar offsets.
import { generateKeyPairSync } from "node:crypto"

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
})
const jwk = privateKey.export({ format: "jwk" })
const crudo = publicKey.export({ format: "jwk" })
const b64u = (texto) => Buffer.from(texto, "base64url")

const publica = Buffer.concat([
  Buffer.from([0x04]),
  b64u(crudo.x),
  b64u(crudo.y),
]).toString("base64url")

console.log(`VAPID_PUBLIC_KEY=${publica}`)
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`)
