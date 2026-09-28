#!/usr/bin/env bash
#
# Da de alta una empresa y su primer administrador.
#
# Crear una empresa es un acto administrativo, no una operación del ERP: por
# eso corre desde aquí y no desde ninguna pantalla. Siembra el plan de cuentas,
# los catálogos y los roles.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

read -rp "RUC: " RUC
read -rp "Razón social: " RAZON
read -rp "Correo del administrador: " CORREO
read -rp "Nombre del administrador: " NOMBRE
read -rsp "Contraseña (12 o más): " CLAVE; echo

docker compose exec -T \
  app node alta-empresa.cjs "$RUC" "$RAZON" "$CORREO" "$NOMBRE" "$CLAVE"
