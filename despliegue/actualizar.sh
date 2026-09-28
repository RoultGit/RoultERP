#!/usr/bin/env bash
#
# Despliega una versión nueva.
#
# La imagen se construye fuera —en el portátil o en la integración continua—
# y llega aquí como archivo. Construirla en la máquina de producción gastaría
# su memoria y su disco en compilar, que es justo lo que no tiene de sobra.
#
#   Desde el portátil:
#     docker build -t roulterp:actual . && docker save roulterp:actual | gzip > erp.tgz
#     scp erp.tgz ubuntu@<ip>:/opt/roulterp/
#   En la máquina:
#     ./actualizar.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ -f erp.tgz ]; then
  echo "── Cargando la imagen nueva ──"
  gunzip -c erp.tgz | docker load
  mv erp.tgz "erp-$(date +%Y%m%d-%H%M).tgz.usada"
fi

# Un respaldo antes de tocar nada. Las migraciones corren al arrancar el
# contenedor y no se deshacen solas; si una sale mal, esto es la vuelta atrás.
if docker compose ps base --status running >/dev/null 2>&1; then
  echo "── Respaldo previo ──"
  ./respaldar.sh
fi

echo "── Arrancando ──"
docker compose up -d --remove-orphans

echo "── Esperando a que responda ──"
for _ in $(seq 1 60); do
  if docker compose exec -T app node -e \
      "fetch('http://localhost:3000/entrar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      2>/dev/null; then
    echo "  listo"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

echo "  NO respondió. Registro:" >&2
docker compose logs --tail 40 app >&2
exit 1
