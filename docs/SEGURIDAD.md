# Estado de seguridad

Revisado el 2026-10-07 contra el código de `master`.

## Lo que protege la aplicación hoy

| Mecanismo | Dónde |
|---|---|
| Aislamiento entre empresas por RLS en 94 de 95 tablas | `packages/db/migrations/9999_rls.sql` |
| Roles de base `NOBYPASSRLS NOSUPERUSER` | la aplicación nunca puede saltarse la política |
| Permiso comprobado en cada acción de servidor | prueba `apps/web/test/permisos.test.ts` |
| Cifrado de sobre para certificados, credenciales SOL y TOTP | KEK en variable de entorno, DEK por secreto |
| CSP con nonce, sin `unsafe-inline` en scripts | `apps/web/middleware.ts` |
| HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin` | idem |
| Cookie de sesión `Secure`, `HttpOnly`, `SameSite=Lax` | `packages/servicios/src/auth.ts` |
| Importes en `bigint`, nunca en coma flotante | `packages/core/src/money.ts` |

## Inyección SQL: corregido

Tres consultas armaban la lista de un `IN (...)` concatenando cadenas:

```ts
sql`${productos.id} IN ${sql.raw(`(${ids.map((i) => `'${i}'`).join(",")})`)}`
```

En `kits.ts` el identificador venía de `datos.productoId`, que llega de un
formulario. Una comilla dentro deja de ser un valor y pasa a ser SQL. Las tres
pasaron a `inArray` y a `= ANY(...::uuid[])`, que parametrizan, y queda una
prueba que mete comillas y `DROP TABLE` por ese campo y comprueba que la base lo
rechaza en vez de ejecutarlo (`packages/servicios/test/kits.test.ts`).

No queda ningún `sql.raw` ni `sql.unsafe` en el código, y
`packages/servicios/test/sin-sql-crudo.test.ts` lee las fuentes y falla si
reaparecen —o si aparece `sql.identifier`, que escapa bien pero significa que
alguien empezó a construir nombres de tabla o columna en tiempo de ejecución.

Ese guardián es la razón por la que no corremos detrás de la versión de Drizzle.
Una comprobación que falla en el acto, señalando archivo y línea, protege mejor
que una versión de la librería que escapa correctamente algo que nunca
deberíamos estar escapando. Y sigue protegiendo si alguien baja la versión.

## Dependencias: cuatro avisos abiertos

`sharp` y `source-map-js` se arreglaron sin romper nada. Los cuatro que quedan
necesitan una decisión, no un comando:

| Aviso | Gravedad | Exposición real | Qué haría falta |
|---|---|---|---|
| `drizzle-orm`: inyección por identificadores mal escapados | alta | **Ninguna.** El aviso trata de identificadores (nombres de tabla y columna) construidos dinámicamente. No construimos ninguno, y hay una prueba que lo impide: ni `sql.raw`, ni `sql.unsafe`, ni `sql.identifier`, ningún `orderBy` que no sea una columna literal del esquema, y ningún nombre de tabla o columna que venga de `searchParams` ni de `FormData`. | Subir a `drizzle-orm@0.45.3`, salto mayor sobre 95 tablas y 935 pruebas. **Cuándo toca:** el día que haga falta un identificador dinámico de verdad (un orden o un filtro por columna que elija el usuario). Ese día es obligatorio y la prueba `sin-sql-crudo` se interpondrá para que la decisión sea consciente. |
| `postcss`: XSS por `</style>` sin escapar | alta | **Ninguna en producción.** PostCSS corre al compilar, sobre CSS que escribimos nosotros. No procesa nada que venga de un usuario. | Llega con `next@16`, salto mayor que cambia el App Router y las Server Actions. **Cuándo toca:** cuando salga un aviso que afecte al runtime del servidor de Next, no a su compilador. Subir hoy no inmuniza contra un CVE de la 16.x mañana; ese día habría que subir otra vez igual. Nunca la semana de una entrega. |
| `next` → `postcss` | media | igual que la anterior | igual |
| `node-forge`: acepta `DigestAlgorithm` anidado de más al verificar RSA PKCS#1 v1.5 | alta | **Baja.** Lo usamos para leer el `.pfx` y pasar el certificado a PEM (`packages/core/src/cpe/firma.ts`), no para verificar firmas de terceros. Quien verifica nuestras firmas es SUNAT. | No hay versión corregida. Vigilar; si aparece, subirla. |

Ninguno de los cuatro es explotable por un usuario de la aplicación con el
código tal como está. Los dos saltos mayores son trabajo pendiente, no un
agujero abierto.

## Lo que sigue sin resolverse con código

1. **Homologación en SUNAT** con el certificado real. Hasta entonces la firma
   está probada contra respuestas simuladas.
2. **La KEK.** Si se pierde, los certificados y los secretos TOTP guardados no
   se pueden volver a abrir. Hay que guardarla fuera del servidor.
3. **Respaldos verificados.** `despliegue/respaldar.sh` hace el `pg_dump`; nadie
   ha probado todavía una restauración completa, que es la única forma de saber
   que el respaldo sirve.
