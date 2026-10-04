# RoultERP

ERP para empresa peruana: compras, importaciones, inventario, ventas,
facturación electrónica (CPE/SUNAT), cuentas por cobrar y pagar, caja y bancos,
contabilidad con PLE, y planillas.

## Levantarlo en local

Hace falta **Node 22+** y **PostgreSQL 17** con un usuario que pueda
`CREATE ROLE`: la migración `9999_rls.sql` crea los roles `roulterp_app` y
`roulterp_auth` con `NOBYPASSRLS`, y son ellos los que aíslan una empresa de
otra. Sin ese permiso la migración falla y no es un detalle que se pueda saltar.

```sh
git clone https://github.com/RoultGit/RoultERP.git
cd RoultERP
npm install

createdb roulterp_dev

# La clave maestra de cifrado. Envuelve los certificados digitales, las
# credenciales SOL y los secretos TOTP. En local sirve una generada al vuelo;
# en producción se guarda fuera del repositorio y no se pierde nunca.
cat > apps/web/.env.local <<EOF
DATABASE_URL=postgres://localhost/roulterp_dev
ROULTERP_KEK=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
ROULTERP_KEK_ID=env-1
EOF

export DATABASE_URL=postgres://localhost/roulterp_dev
npm run migrate    # 29 migraciones, 95 tablas
npm run sembrar    # empresa, plan de cuentas, productos y un usuario

npm run dev        # http://localhost:3000
```

Entrar con **`admin@servidimar.pe`** / **`roulterp-desarrollo-1`**, rol
Administrador. Los otros cuatro roles —Contador, Logística, Ventas, Solo
consulta— vienen creados en la empresa; se asignan desde `/usuarios`.

`npm run sembrar` empieza con un `TRUNCATE` de `empresas` y `usuarios`:
vuelve a dejar la base como recién instalada, así que no se corre sobre datos
que importen.

## Lo que no se puede probar en local

La **facturación electrónica real**. Firmar y enviar a SUNAT necesita el
certificado digital de la empresa y sus credenciales SOL, que todavía no
tenemos. Todo el camino está construido y probado —UBL 2.1, firma XAdES-BES,
`sendBill`, lectura del CDR, reintentos, cola— pero contra respuestas
simuladas. Las pantallas de `/cpe` se ven y se recorren; el envío de verdad
espera la homologación.

Igual el **tipo de cambio**: la tabla existe, nada la llena automáticamente
todavía. Se teclea.

## Pruebas

```sh
createdb roulterp_test
npm test               # 289 dominio + 17 web + 933 integración
npm run test:navegador # 64 en navegador, con la app corriendo en :3000
```

Las de integración usan `postgres://localhost/roulterp_test` y la arrasan en
cada corrida. Las de dominio no tocan la base.

## Cómo está organizado

```
packages/core        dominio puro: dinero exacto, IGV, kardex, UBL, planilla.
                     Sin base de datos y sin red. Es donde viven las reglas.
packages/db          esquema Drizzle, migraciones y las políticas RLS.
packages/servicios   casos de uso: una transacción, una función.
apps/web             Next.js 15, App Router, Server Actions.
```

La dirección de las dependencias no se cruza: `web` → `servicios` → `db` →
`core`. `core` no importa a nadie.

Dos cosas que conviene saber antes de tocar código:

- **El dinero es exacto.** `core/money.ts` trabaja con `bigint` a seis
  decimales. Nunca `number` para un importe.
- **Las fechas son de Lima.** `core/fecha.ts` → `hoyEnPeru()`. Nunca
  `new Date().toISOString().slice(0, 10)`: entre las 19:00 y la medianoche de
  Perú eso devuelve el día siguiente.

## Despliegue

`docs/DESPLIEGUE.md` y la carpeta `despliegue/`: Docker, Postgres y Caddy con
HTTPS automático en una sola máquina. `docs/INFRAESTRUCTURA.md` explica cuándo
dejar de usar eso y pasar a RDS.

## Qué está hecho y qué no

- `docs/CONTRATADO.md` — función por función de lo que el cliente pagó.
- `docs/ESTADO.md` — estado real del proyecto.
- `docs/starsoft-brecha.md` — comparación contra el sistema que se reemplaza.
