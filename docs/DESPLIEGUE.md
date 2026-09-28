# Despliegue

La aplicación es un contenedor sin estado: todo vive en Postgres. Se puede
mover de sitio sin migrar archivos, y arrancar dos copias no rompe nada.

## Lo que hace el contenedor al arrancar

1. Pone la base al día con las migraciones. Si fallan, **no arranca**: servir
   con el esquema a medias haría que la mitad de las pantallas devolviera
   errores que nadie sabría interpretar.
2. Levanta el servidor de Next en el puerto 3000.

Las migraciones son idempotentes y llevan su propio registro, así que dos
contenedores arrancando a la vez no las aplican dos veces.

## Variables de entorno

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DATABASE_URL` | sí | Cadena de Postgres. En un pooler, usar el modo **transacción** |
| `ROULTERP_KEK` | sí | Clave maestra, 32 bytes en base64. Ver abajo |
| `ROULTERP_KEK_ID` | sí | Identificador de la clave, para poder rotarla. `env-1` vale |
| `ROULTERP_COLA_SECRETO` | no | Secreto con el que la tarea programada vacía la cola de SUNAT |

Si falta una obligatoria, el arranque falla de inmediato. Es deliberado: un
despliegue a medias debe romperse en el primer segundo, no la primera vez que
alguien intente activar su segundo factor.

### Generar la clave maestra

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Una nueva para producción**, nunca la de desarrollo. Cifra el certificado
digital, las credenciales SOL y los segundos factores. Guardar una copia en un
gestor de contraseñas y **nunca junto a los respaldos de la base**: juntos, el
cifrado no sirve de nada.

## Desplegar en EC2, paso a paso

Todo lo necesario está en `despliegue/`. Es el escalón 1 de
`docs/INFRAESTRUCTURA.md`: una sola máquina con la aplicación, Postgres y
HTTPS. Al tercer cliente la base sale a RDS; sólo cambia `DATABASE_URL`.

**1. La máquina.** EC2 `t4g.small` (arm64) con Ubuntu 24.04, IP fija, y el
grupo de seguridad abriendo 22, 80 y 443. Con capa gratuita, una `t4g.micro`
también sirve para la prueba.

**2. Preparar.** En la máquina:

```bash
curl -fsSL <repo>/despliegue/instalar.sh | bash
```

Instala Docker, crea `/opt/roulterp`, **genera los secretos** y deja
programados el respaldo diario y el vaciado de la cola de SUNAT.

**3. Apuntar el dominio** a la IP (registro A) y poner `DOMINIO` en
`/opt/roulterp/.env`.

**4. Copiar la clave maestra** de ese archivo a un gestor de contraseñas.
Es el único paso que no se puede deshacer si se olvida.

**5. Subir la imagen.** Se construye fuera —compilar en la máquina de
producción gasta su memoria en algo que no es servir:

```bash
# en el portátil
docker build -t roulterp:actual .
docker save roulterp:actual | gzip > erp.tgz
scp erp.tgz ubuntu@<ip>:/opt/roulterp/
scp despliegue/* ubuntu@<ip>:/opt/roulterp/
```

**6. Arrancar y crear la empresa:**

```bash
cd /opt/roulterp && ./actualizar.sh && ./crear-empresa.sh
```

### Qué hay en `despliegue/`

| Archivo | Qué hace |
|---|---|
| `compose.yaml` | Aplicación, Postgres y Caddy |
| `Caddyfile` | HTTPS automático de Let's Encrypt, se renueva solo |
| `instalar.sh` | Prepara una EC2 recién creada. Una sola vez |
| `actualizar.sh` | Despliega una versión nueva, con respaldo previo y comprobación |
| `respaldar.sh` | Volcado diario, verificado y rotado a 14 días |
| `vaciar-cola.sh` | Vacía la cola de SUNAT cada 5 minutos |
| `crear-empresa.sh` | Alta de una empresa y su administrador |

### Medido en una prueba real

Se construyó la imagen, se levantó contra una base vacía y se recorrió con
navegador:

```
  imagen                       366 MB
  arranque                      73 ms
  memoria en marcha            127 MB
  base desde cero    95 tablas, 29 migraciones aplicadas solas
  alta de empresa    128 cuentas del PCGE sembradas
  respaldo           44 KB comprimido, restaurado y verificado
```

## La cola de envío a SUNAT

Emitir no habla con SUNAT; informar sí, y eso tarda. Una tarea programada
vacía la cola cada pocos minutos:

```
POST https://<dominio>/api/cola?empresa=<uuid>&limite=10
Authorization: Bearer <ROULTERP_COLA_SECRETO>
```

En AWS, con **EventBridge Scheduler → destino HTTP**. Sin la tarea el sistema
funciona igual, pero alguien tiene que pulsar el botón de enviar.

## Primer arranque

1. Crear la base vacía. El contenedor crea el esquema solo.
2. Dar de alta la empresa y su primer administrador:

```bash
DATABASE_URL="…" npx tsx scripts/empresa-de-prueba.ts crear
```

   Devuelve el correo y la clave por la que entrar. Para datos de demostración,
   `npm run sembrar` en su lugar.

## Respaldos

Lo único que hay que respaldar es Postgres: no hay estado en disco. Con RDS,
los respaldos automáticos y la recuperación a un punto en el tiempo bastan.

**La clave maestra va aparte.** Un respaldo de la base sin ella no permite
abrir el certificado ni los segundos factores; los dos juntos en el mismo sitio
significan que el cifrado no protege de nada.
