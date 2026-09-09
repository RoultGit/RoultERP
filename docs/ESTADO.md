# Estado del proyecto

Actualizado: 2026-09-09 · 421 pruebas en verde

## Cómo levantarlo

```bash
npm install
createdb roulterp_dev
cp .env.example .env.local          # y complete ROULTERP_KEK
DATABASE_URL=postgres://localhost/roulterp_dev npm run migrate
DATABASE_URL=postgres://localhost/roulterp_dev npm run sembrar
npm run dev                          # http://localhost:3000
```

Usuario de desarrollo: `admin@servidimar.pe` / `roulterp-desarrollo-1`

Pruebas:

```bash
createdb roulterp_test
DATABASE_URL=postgres://localhost/roulterp_test npm test
```

## Qué hay construido

### Base (completo)

| Pieza | Estado |
|---|---|
| Monorepo con dominio puro separado de la infraestructura | ✅ |
| Aislamiento entre empresas por RLS forzado en Postgres | ✅ 26 pruebas |
| Dos roles de base de datos: identidad y negocio | ✅ |
| Libros append-only por trigger (asientos, kardex) | ✅ |
| Bitácora de auditoría, sólo inserción y lectura | ✅ |
| Aritmética decimal exacta (nunca `float`) | ✅ 21 pruebas |
| Auth propio: Argon2id, sesiones, MFA TOTP, invitaciones | ✅ 47 pruebas |
| RBAC por empresa con permisos módulo × acción | ✅ |
| Alta de empresas con siembra de PCGE y catálogos | ✅ |

### Módulos contratados

| Módulo | Dominio | Servicio | Pantallas |
|---|---|---|---|
| **Importaciones** | ✅ | ✅ | ✅ lista, detalle, liquidación, alta, ítems, gastos |
| **Inventario** | ✅ | ✅ | ✅ existencias, kardex |
| **Compras** | ✅ | ✅ | ✅ lista, registro; falta detalle de OC |
| **Cuentas por pagar** | — | parcial | ✅ antigüedad de saldos; **faltan pagos y letras** |
| **Contabilidad** | ✅ | ✅ | ✅ balance, mayor, PLE; **faltan captura manual y EEFF** |
| **Ventas** | ✅ | ✅ | ❌ sin pantallas |
| **Factron (CPE)** | ✅ | ✅ | ❌ sin pantallas |
| **Cuentas por cobrar** | — | — | ❌ |
| **Caja y bancos** | — | — | ❌ |
| **SIG** | — | ✅ | ✅ tablero |

### Detalle de lo que sí funciona de punta a punta

**Importaciones.** Orden al exterior → seguimiento de estados → gastos con su
tipo de cambio propio → liquidación con prorrateo por FOB, peso, volumen,
cantidad o directo → ingreso al kardex al costo real → asiento contable. El IGV
y la percepción van a crédito fiscal, no al costo.

**Compras.** Orden de compra con recepciones parciales → registro de la factura
del proveedor → detracción SPOT → ingreso al almacén sin IGV → asiento → cuenta
por pagar con su vencimiento.

**Ventas y Factron.** Emisión con numeración serializada → descarga de kardex al
costo → asiento con venta y costo de ventas → XML UBL 2.1 → firma XMLDSig →
envío al `billService` de SUNAT → CDR persistido. Emitir y enviar están
separados: una caída de SUNAT no impide facturar.

**Contabilidad.** Balance de comprobación, mayor por cuenta, y los libros
electrónicos 8.1 (registro de compras) y 13.1 (inventario valorizado) con el
nombre de archivo de 33 caracteres y la codificación Latin-1 que exige el PLE.

## Qué falta

Por orden de lo que más cerca está de poder usarse:

1. **Pantallas de ventas y de facturación electrónica.** El servicio está hecho
   y probado; falta la interfaz: emitir, ver el estado ante SUNAT, reenviar,
   subir el certificado digital y las credenciales SOL.
2. **Registro de pagos en cuentas por pagar.** Aplicar pagos a documentos,
   retención de IGV al pagar, programación de egresos.
3. **Letras** por pagar y por cobrar: canje, renovación, protesto.
4. **Cuentas por cobrar**: estado de cuenta, antigüedad, límite de crédito.
5. **Caja y bancos**: caja chica, cuentas bancarias, conciliación.
6. **Contabilidad**: captura manual de asientos, estados financieros, cierre de
   periodo y de ejercicio, diferencia de cambio automática.
7. **Más formatos de PLE**: 5.1 diario, 6.1 mayor, 8.2 no domiciliados, 12.1
   inventario en unidades, 14.1 ventas.
8. **Guía de remisión electrónica (GRE)** por su API REST propia.
9. **Resumen diario de boletas** y comunicación de baja.
10. **Pantallas de usuarios, roles y MFA.**

## Decisiones que conviene no revertir sin pensarlo

- **El aislamiento vive en Postgres, no en el código.** Una consulta a la que se
  le olvide el filtro devuelve cero filas ajenas. `9999_rls.sql` se reaplica en
  cada despliegue y protege automáticamente cualquier tabla nueva con
  `empresa_id`; hay una prueba que falla si alguna se queda fuera.

- **Los importes son texto en la base y bigint escalado en el dominio.** Nunca
  `float`. `JSON.stringify` sobre un importe lanza a propósito, para forzar la
  conversión explícita en el borde HTTP.

- **Los libros son append-only por trigger.** Una regla que sólo vive en el
  código se salta con un `UPDATE`.

- **Emitir y enviar a SUNAT son actos separados.** El negocio no puede depender
  de que un servicio ajeno responda.

- **Nada que escriba estado puede lanzar después dentro de la misma
  transacción.** Apareció dos veces: en el contador de intentos de login y en el
  registro del rechazo de SUNAT. En ambos casos el `ROLLBACK` se llevaba lo
  escrito.

## Camino a AWS

Postgres se mueve con `pg_dump`: el esquema es SQL estándar y RLS es del motor,
no de Supabase. El dominio (`packages/core`) es TypeScript puro sin dependencias
de infraestructura. El auth es propio, así que no hay proveedor que migrar. Lo
único atado a Vercel es dónde corre Next, y el mismo dominio se monta en un
contenedor sin tocarlo.

## Pendiente de decisión del cliente

- **Migración de datos desde Starsoft.** Sigue sin definirse si se migran
  maestros y saldos, el histórico completo, o se arranca en limpio. No bloquea
  nada de lo construido.
- **Certificado digital y credenciales SOL** de SERVIDIMAR, para homologar
  contra el entorno beta de SUNAT.
- **Cuenta de detracciones** del Banco de la Nación, que va dentro del XML.
