#!/usr/bin/env bash
# Bucle de verificación, en el orden que importa:
#
#   1. tipos            npx tsc --noEmit
#   2. build            npm run build            (deja dist/ al día)
#   3. batería local    node tests/run.mjs       (con LIVE_BASE limpio: nunca pega a producción por error)
#
#   — solo con --deploy — (publicar es caro y lento, se hace a pedido y no en cada cambio)
#   4. despliegue       npx vercel --prod        (alias recuerdapapi.vercel.app)
#   5. bundle en vivo   compara el sha256 del JS publicado con el local
#   6. batería en vivo  LIVE_BASE=https://recuerdapapi.vercel.app node tests/run.mjs
#
# Cada paso es secuencial a propósito: construir y probar a la vez hace que la batería lea un dist/ a
# medio escribir (eso dio fallas fantasma). Los registros quedan en tests/.logs/ (se conservan los últimos).
#
# Uso: npm run verificar                  · tipos + build + batería local (sin publicar)
#      npm run verificar -- --deploy      · el bucle completo, incluye publicar en Vercel
set -euo pipefail
cd "$(dirname "$0")/.."

ALIAS="https://recuerdapapi.vercel.app"
LOG_DIR="tests/.logs"
SELLO="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"
LOCAL_LOG="$LOG_DIR/$SELLO-local.txt"
LIVE_LOG="$LOG_DIR/$SELLO-live.txt"
DEPLOY_LOG="$LOG_DIR/$SELLO-deploy.txt"

echo "== 1/6 tipos"
npx tsc --noEmit

echo "== 2/6 build"
npm run build | tail -4

echo "== 3/6 batería local"
env -u LIVE_BASE node tests/run.mjs | tee "$LOCAL_LOG" | tail -12

if [ "${1:-}" != "--deploy" ] && [ "${1:-}" != "deploy" ]; then
  echo "== 4/6 despliegue (omitido: no se publica salvo que pidas «--deploy»)"
  rm -f "$LOCAL_LOG" && echo "   registros: (no se guardaron)"
  exit 0
fi

echo "== 4/6 despliegue"
# El CLI de Vercel devuelve «Not authorized» de vez en cuando sin motivo (sesión que se refresca a
# medias): se reintenta una vez antes de darse por vencido.
if ! npx vercel --prod --yes > "$DEPLOY_LOG" 2>&1; then
  echo "   el despliegue falló; se reintenta en 5 s…"
  tail -3 "$DEPLOY_LOG" | sed 's/^/   /'
  sleep 5
  npx vercel --prod --yes > "$DEPLOY_LOG" 2>&1
fi
grep -E "Production|Aliased|Ready" "$DEPLOY_LOG" | head -3

echo "== 5/6 bundle en vivo"
# El alias tarda unos segundos en servir la entrega nueva (y Vercel le pone al archivo otro nombre
# aunque el contenido sea el mismo), así que se espera a que el JS publicado sea idéntico al local.
JS_LOCAL="dist/assets/$(ls dist/assets | grep '\.js$')"
IGUAL=""
for _ in $(seq 1 30); do
  JS_LIVE="$(curl -s "$ALIAS/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)"
  curl -s "$ALIAS/$JS_LIVE" -o "$LOG_DIR/$SELLO-live.js"
  if [ "$(shasum -a 256 "$LOG_DIR/$SELLO-live.js" | cut -d' ' -f1)" = "$(shasum -a 256 "$JS_LOCAL" | cut -d' ' -f1)" ]; then IGUAL="si"; break; fi
  sleep 4
done
if [ -n "$IGUAL" ]; then
  echo "   $JS_LIVE es idéntico al local ($JS_LOCAL)"
else
  echo "   OJO: el JS publicado ($JS_LIVE) NO es idéntico a $JS_LOCAL (revisá el despliegue)"
fi

echo "== 6/6 batería en vivo"
LIVE_BASE="$ALIAS" node tests/run.mjs | tee "$LIVE_LOG" | tail -12

# Se conservan los últimos registros y se borra lo viejo, para que la carpeta no crezca sin control.
ls -t "$LOG_DIR"/*.txt "$LOG_DIR"/*.js 2>/dev/null | tail -n +7 | while read -r viejo; do rm -f "$viejo"; done

echo
echo "listo · registros en $LOG_DIR/$SELLO-{local,live,deploy}.txt"
