#!/usr/bin/env bash
#
# Vacía la cola de envío a SUNAT.
#
# Emitir no habla con SUNAT: el comprobante se numera, descarga inventario y
# se asienta al instante. Informar a SUNAT sí tarda, y eso ocurre aquí, en
# segundo plano, para que nadie espere mirando una pantalla.
#
# Se llama cada cinco minutos desde cron. Es idempotente: si no hay nada
# pendiente, no hace nada.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

if [ -z "${ROULTERP_COLA_SECRETO:-}" ]; then
  echo "$(date '+%F %T')  sin secreto configurado; la cola sólo se vacía a mano"
  exit 0
fi

# Una pasada por empresa. Cada una tiene su propia cola y su propio
# certificado, así que no se pueden mezclar en una sola llamada.
EMPRESAS=$(docker compose exec -T base psql -U roulterp -d roulterp -tAc \
  "SELECT id FROM empresas WHERE activa")

for EMPRESA in $EMPRESAS; do
  RESPUESTA=$(curl -fsS -X POST \
    -H "Authorization: Bearer $ROULTERP_COLA_SECRETO" \
    "https://$DOMINIO/api/cola?empresa=$EMPRESA&limite=10" || echo '{"error":"sin respuesta"}')
  # Sólo se registra cuando hubo trabajo: con cron cada cinco minutos, una
  # línea por pasada llenaría el registro de ruido.
  if ! echo "$RESPUESTA" | grep -q '"intentados":0'; then
    echo "$(date '+%F %T')  $EMPRESA  $RESPUESTA"
  fi
done
