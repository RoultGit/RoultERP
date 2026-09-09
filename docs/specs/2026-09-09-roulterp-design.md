# RoultERP — Diseño de arquitectura

Clon SaaS multi-empresa del ERP peruano STARSOFT Gold Edition, limitado a los
módulos contratados por el cliente.

- **Fecha:** 2026-09-09
- **Cliente inicial:** SERVIDIVERSOS MARINA S.R.LTDA. (SERVIDIMAR), RUC 20303051831 — importador
- **Estado:** aprobado para implementación

## 1. Alcance

Módulos derivados de `MODULOS_CLIENTE.md` y de los tres convenios de renovación
firmados con Enterprise Solutions S.A. (STARSOFT):

| Módulo | Fuente | Incluido |
|---|---|---|
| Importaciones | ConvenioRenovacion.pdf | sí |
| Contabilidad, CxC, Ventas, CxP, Inventario, Compras, Caja y Bancos | ConvenioRenovacion2.pdf | sí |
| SIG (tablero gerencial) | ConvenioRenovacion2.pdf | sí |
| Factron (emisión electrónica) | ConvenioRenovacion2 (1).pdf | sí |
| Planillas, Activo Fijo, Costos de Producción, E-commerce | brochure STARSOFT | **no** — fuera de contrato |

`MODULOS_CLIENTE.md` lista 7 submódulos en «Módulo General»; el convenio cubre 8.
La diferencia es **SIG**, que se incluye.

### Fuera de alcance (por ahora)

- Migración de datos históricos desde STARSOFT. El cliente aún no define si migra
  maestros + saldos, histórico completo, o arranca en limpio. Se trata como
  proyecto aparte. El diseño no lo impide: la carga de maestros por plantilla es
  parte del onboarding de cualquier empresa nueva.

## 2. Decisiones de arquitectura

### 2.1 Stack

- **Monorepo** con workspaces de npm.
- `apps/web` — Next.js App Router (React, TypeScript strict). Un solo despliegue
  en Vercel: UI + Route Handlers.
- `packages/core` — lógica de negocio en TypeScript puro, **sin I/O**. No importa
  Next, Vercel ni Supabase.
- `packages/db` — esquema Drizzle, migraciones, políticas RLS, cliente Postgres.

Se descartó Express: con Next.js ya existe un runtime de servidor en el mismo
despliegue; interponer Express agrega un servicio y una capa de contratos manual
sin contrapartida. La lógica vive en `packages/core`, así que montarla dentro de
un Express en ECS el día de la migración es un `import`, no una reescritura.

### 2.2 Aislamiento entre empresas (multi-tenant)

Esquema compartido, `empresa_id` en toda tabla de negocio, y el aislamiento
aplicado **en Postgres**, no en el código de aplicación:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
  USING      (empresa_id = current_setting('app.empresa_id', true)::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id', true)::uuid);
```

Tres condiciones sin las cuales esto no sirve:

1. `FORCE ROW LEVEL SECURITY` — sin él, el dueño de la tabla se salta la política.
2. La aplicación se conecta con un rol dedicado **sin `BYPASSRLS`**. Nunca con el
   rol `service_role` de Supabase, que ignora RLS por diseño.
3. `app.empresa_id` se fija con `SET LOCAL` dentro de la transacción, para que no
   se filtre entre conexiones reutilizadas del pool.

Consecuencia buscada: una consulta a la que se le olvide el filtro por empresa
devuelve cero filas ajenas en vez de devolverlas. Un descuido se degrada a
resultado vacío, no a fuga de datos.

`WITH CHECK` es tan necesario como `USING`: sin él, un `INSERT` podría escribir
filas con el `empresa_id` de otra empresa.

### 2.3 Autenticación y autorización

Auth propio, implementado en `packages/core/auth`. Sin proveedor externo.

- **Contraseñas:** Argon2id, parámetros OWASP (m=19456 KiB, t=2, p=1), en JS puro
  (`@noble/hashes`) para no depender de binarios nativos en serverless.
- **Sesiones:** token opaco de 256 bits, almacenado **hasheado** (SHA-256) en la
  base. Cookie `httpOnly` + `Secure` + `SameSite=Lax`. No JWT: en un ERP la
  revocación inmediata de una sesión importa más que evitar un SELECT.
- **MFA:** TOTP (RFC 6238) implementado con `node:crypto`, verificado contra los
  vectores de prueba del RFC.
- **Fuerza bruta:** conteo de intentos en Postgres, por cuenta y por IP.
- **Autorización:** RBAC por empresa. Un usuario pertenece a N empresas con rol
  distinto en cada una. Permisos con granularidad módulo × acción
  (ver / crear / editar / anular / aprobar).

### 2.4 Datos y dinero

- Importes en `numeric(18,6)` en la base y en enteros de céntimos en el dominio.
  Nunca `float`.
- **Libro mayor append-only.** Los asientos no se editan ni se borran: se
  extornan con un asiento inverso. Es requisito contable, no preferencia.
- Bitácora de auditoría inmutable (usuario, IP, tabla, antes, después) sobre toda
  tabla transaccional.

### 2.5 Trabajos largos

Tabla de trabajos en Postgres + Vercel Cron. Sin Redis ni broker externo. Cubre
generación de PLE, recálculo de kardex, envío de resúmenes diarios a SUNAT y
cierres contables.

> ponytail: cola en tabla, un worker por cron. Techo: si la concurrencia de
> envíos a SUNAT supera lo que una función serverless aguanta, mover a un
> contenedor con SKIP LOCKED y varios workers.

### 2.6 Emisión electrónica (Factron)

Integración **directa** con SUNAT, sin OSE:

1. Construcción del XML UBL 2.1 (factura, boleta, NC, ND, resumen diario,
   comunicación de baja, retención, percepción).
2. Firma XMLDSig enveloped con el certificado digital del emisor.
3. Envío al `billService` SOAP (`sendBill` / `sendSummary` / `getStatus`).
4. GRE por su API REST propia con OAuth2.
5. Persistencia del CDR y del ticket.

El certificado `.pfx` de cada empresa se guarda cifrado con AES-256-GCM; la clave
maestra vive fuera de la base (variable de entorno hoy, KMS en AWS). El emisor
está detrás de la interfaz `EmisorCPE`, de modo que un adaptador de OSE es un
archivo nuevo y no una reescritura, si algún día conviene tercerizarlo.

### 2.7 Camino a AWS

| Pieza | Portabilidad |
|---|---|
| Postgres | `pg_dump`. Esquema SQL estándar; RLS es de Postgres, no de Supabase |
| Dominio | TS puro, sin dependencias de infraestructura |
| Auth | propio, en el repo. Nada que migrar |
| Storage | detrás del puerto `Storage` (S3 o Supabase Storage) |
| Web | Next.js corre en Fargate/Lambda igual que en Vercel |

No se usa ninguna función propietaria de Supabase salvo Postgres y Storage,
ambas con equivalente directo en AWS.

## 3. Modelo de dominio

### 3.1 Maestros

`empresas`, `usuarios`, `usuario_empresa`, `roles`, `permisos`, `sucursales`,
`almacenes`, `monedas`, `tipo_cambio`, `plan_cuentas` (PCGE), `centros_costo`,
`clientes`, `proveedores` (nacionales y del exterior), `productos`,
`unidades_medida`, `series_documento`.

### 3.2 Fase 1 — cadena de abastecimiento

**Compras:** requisición → cotización → matriz comparativa → orden de compra →
recepción → registro de compras. Precios históricos por proveedor.

**Importaciones:** orden de importación → embarque → llegada → **liquidación**.
La liquidación prorratea flete, seguro, ad valorem, gastos de agente de aduanas
y demás gastos sobre el costo unitario de cada ítem según el criterio elegido
(valor FOB, peso o volumen), y produce el costo de ingreso al almacén conforme a
NIC 2. Estados: borrador, en tránsito, en aduana, nacionalizada, liquidada.

**Inventario:** movimientos por almacén, kardex en unidades y valorizado,
valorización por promedio ponderado móvil y PEPS, lotes y series, formatos PLE
12.1 y 13.1.

**CxP:** documentos por pagar, vencimientos, programación de pagos, órdenes de
pago, letras por pagar (canje, renovación), retención de IGV, detracciones.

### 3.3 Transversal tributario

IGV 18%, detracciones (SPOT) con sus porcentajes por bien/servicio, régimen de
retenciones, régimen de percepciones, tipo de cambio SUNAT compra/venta, y
ajuste automático por diferencia de cambio.

## 4. Fases

| Fase | Contenido |
|---|---|
| 0 | Monorepo, base de datos, RLS, auth, RBAC, maestros, shell de la UI |
| 1 | Compras → Importaciones → Inventario → CxP |
| 2 | Contabilidad: asientos, PCGE, EEFF, PLE |
| 3 | Ventas → Factron (CPE + GRE) → CxC |
| 4 | Caja y Bancos, conciliación bancaria |
| 5 | SIG (tablero gerencial) |

## 5. Pruebas

- Dominio puro: pruebas unitarias con `node:test`, sin base de datos. Cubren
  kardex, prorrateo de importación, cálculo de IGV/detracciones, partida doble.
- Aislamiento entre empresas: prueba de integración que intenta leer y escribir
  datos de otra empresa y exige cero filas y error de política.
- Auth: vectores RFC 6238 para TOTP; verificación de que el hash de contraseña
  nunca sale de la capa de auth.
- Emisión CPE: XMLs de referencia validados contra los XSD de SUNAT y envío
  contra el endpoint beta.
