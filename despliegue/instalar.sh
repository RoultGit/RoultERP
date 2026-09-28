#!/usr/bin/env bash
#
# Prepara una EC2 recién creada (Ubuntu 24.04, arquitectura arm64) para correr
# el ERP. Se ejecuta una sola vez, como usuario `ubuntu`.
#
#   curl -fsSL <url-del-repo>/despliegue/instalar.sh | bash
#
# Lo que hace: instala Docker, crea el directorio de trabajo, genera los
# secretos que faltan y deja el servicio listo para arrancar. No arranca nada:
# antes hay que apuntar el dominio y revisar el archivo de variables.
set -euo pipefail

DESTINO=/opt/roulterp

echo "── Paquetes del sistema ──────────────────────────────────────────"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl gnupg postgresql-client

echo "── Docker ────────────────────────────────────────────────────────"
if ! command -v docker >/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker "$USER"
fi

echo "── Directorio de trabajo ─────────────────────────────────────────"
sudo mkdir -p "$DESTINO"
sudo chown "$USER:$USER" "$DESTINO"

echo "── Variables de entorno ──────────────────────────────────────────"
if [ ! -f "$DESTINO/.env" ]; then
  # Los secretos se generan aquí y no se escriben en ningún otro sitio.
  # La clave maestra hay que copiarla a un gestor de contraseñas AHORA:
  # sin ella no se pueden abrir los certificados guardados.
  cat > "$DESTINO/.env" <<VARS
# Dominio con el que se sirve. Tiene que apuntar ya a la IP de esta máquina.
DOMINIO=cambiar.ejemplo.pe

# Clave maestra de cifrado. Protege el certificado digital, las credenciales
# SOL y los segundos factores. GUARDE UNA COPIA EN UN GESTOR DE CONTRASEÑAS,
# y nunca junto a los respaldos de la base.
ROULTERP_KEK=$(openssl rand -base64 32)
ROULTERP_KEK_ID=env-1

# Clave de la base. Sólo la usan los contenedores entre sí.
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

# Secreto con el que la tarea programada vacía la cola de envío a SUNAT.
ROULTERP_COLA_SECRETO=$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)
VARS
  chmod 600 "$DESTINO/.env"
  echo "  generado $DESTINO/.env — falta poner el DOMINIO"
else
  echo "  ya existía; no se toca"
fi

echo "── Respaldos automáticos ─────────────────────────────────────────"
sudo tee /etc/cron.d/roulterp-respaldo >/dev/null <<CRON
# Respaldo diario de la base, a las 03:15 hora de Lima.
15 3 * * * $USER cd $DESTINO && ./respaldar.sh >> /var/log/roulterp-respaldo.log 2>&1
CRON

echo "── Vaciado de la cola de SUNAT ───────────────────────────────────"
sudo tee /etc/cron.d/roulterp-cola >/dev/null <<CRON
# Cada cinco minutos. Emitir no espera a SUNAT; informar sí, y esto lo hace
# en segundo plano para que nadie se quede mirando una pantalla.
*/5 * * * * $USER cd $DESTINO && ./vaciar-cola.sh >> /var/log/roulterp-cola.log 2>&1
CRON

cat <<FIN

Listo. Lo que falta, en este orden:

  1. Apuntar el dominio a la IP de esta máquina (registro A).
  2. Editar $DESTINO/.env y poner el DOMINIO.
  3. COPIAR ROULTERP_KEK de ese archivo a un gestor de contraseñas.
  4. Subir la imagen y arrancar:  cd $DESTINO && ./actualizar.sh
  5. Crear la empresa:            ./crear-empresa.sh

Si acaba de instalarse Docker, cierre la sesión y vuelva a entrar para que
el usuario quede en el grupo.
FIN
