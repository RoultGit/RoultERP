#!/usr/bin/env bash
#
# Respaldo diario de la base.
#
# Mientras Postgres viva en esta misma máquina, este archivo es lo único que
# separa al cliente de perder su contabilidad. Al tercer cliente la base debe
# irse a RDS y esto deja de hacer falta: ver `docs/INFRAESTRUCTURA.md`.
#
# El respaldo **no lleva la clave maestra**, y es a propósito: juntos en el
# mismo sitio, el cifrado del certificado no protege de nada.
set -euo pipefail
cd "$(dirname "$0")"

DESTINO=./respaldos
CONSERVAR_DIAS=14
ARCHIVO="$DESTINO/roulterp-$(date +%Y%m%d-%H%M).sql.gz"

mkdir -p "$DESTINO"

# `--clean --if-exists` deja un volcado que se puede restaurar sobre una base
# que ya tiene datos, que es el caso real: se restaura encima, no en vacío.
docker compose exec -T base pg_dump -U roulterp --clean --if-exists roulterp \
  | gzip -9 > "$ARCHIVO"

# Un volcado que no se puede descomprimir no es un respaldo, es un archivo.
# Comprobarlo ahora cuesta un segundo; descubrirlo el día de la restauración
# cuesta la contabilidad.
gzip -t "$ARCHIVO"
TAMANO=$(du -h "$ARCHIVO" | cut -f1)
echo "$(date '+%F %T')  respaldo $ARCHIVO ($TAMANO)"

# Rotación. Sin esto el disco se llena y la máquina deja de arrancar.
find "$DESTINO" -name 'roulterp-*.sql.gz' -mtime +$CONSERVAR_DIAS -delete

# Copia fuera de la máquina, si hay un bucket configurado. Un respaldo que
# vive en el mismo disco que la base no sobrevive a la pérdida del disco.
if [ -n "${RESPALDO_S3:-}" ]; then
  aws s3 cp "$ARCHIVO" "$RESPALDO_S3/" --only-show-errors
  echo "$(date '+%F %T')  copiado a $RESPALDO_S3"
fi
