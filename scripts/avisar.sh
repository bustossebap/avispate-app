#!/usr/bin/env bash
# Aviso de escritorio (macOS) para saber que una tarea terminó.
# Uso: bash scripts/avisar.sh "texto del aviso" [segundos]
# La primera vez macOS pregunta si «Code» puede enviar notificaciones: hay que permitirlo.
set -u

TEXTO="${1:-Tarea terminada}"
EXTRA="${2:-}"

# AppleScript no acepta comillas dobles ni saltos de línea dentro del mensaje.
TEXTO="${TEXTO//\"/}"
TEXTO="${TEXTO//$'\n'/ }"
[ -n "$EXTRA" ] && TEXTO="$TEXTO · $EXTRA"

# El sonido lo pone macOS (Glass); si algo falla, queda la campana del terminal.
if ! osascript -e "display notification \"$TEXTO\" with title \"AVISPATE\" sound name \"Glass\"" >/dev/null 2>&1; then
  printf '\a'
fi

exit 0
