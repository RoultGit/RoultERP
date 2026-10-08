# Estado del proyecto

Actualizado: 2026-09-26 · 1205 pruebas en verde

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

Pruebas de navegador —envían formularios de verdad—, contra una compilación de
producción y con la base sembrada:

```bash
npm run build
DATABASE_URL=postgres://localhost/roulterp_dev PORT=3100 npm run start  # otra terminal
npm run test:navegador
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
| **Cuentas por pagar** | ✅ | ✅ | ✅ antigüedad, pagos, retención, letras, vencimientos, programación de egresos |
| **Contabilidad** | ✅ | ✅ | ✅ balance, mayor, captura manual, EEFF, cierre mensual y anual, PLE |
| **Ventas** | ✅ | ✅ | ✅ lista, emisión, detalle, notas, guías de remisión |
| **Factron (CPE)** | ✅ | ✅ | ✅ certificado, credenciales, series, envío, resúmenes y bajas, retenciones y percepciones, GRE |
| **Cuentas por cobrar** | ✅ | ✅ | ✅ cartera, cobranzas, límite de crédito, letras |
| **Caja y bancos** | ✅ | ✅ | ✅ cuentas, movimientos, conciliación, arqueos |
| **SIG** | — | ✅ | ✅ tablero |
| *Planillas y RR. HH.* | ✅ | ✅ | ✅ trabajadores, contratos, planillas, boletas, liquidación |
| *Usuarios y roles* | ✅ | ✅ | ✅ invitación, roles propios, segundo factor, sesiones |

### Respuestas del cliente al cuestionario, ya aplicadas

El documento `PREGUNAT SAC.docx` trajo los datos reales y tres funciones nuevas.
Lo aplicado:

| Respuesta | Qué se hizo |
|---|---|
| Cuenta de detracciones 00-000-000000 | Campo en la empresa; sale impresa en la factura sujeta a detracción |
| Series FA01/FA02, BA01, TA01/TA02 | Sembradas; falta el correlativo real del día del cambio |
| Cuatro establecimientos con su código SUNAT | Sembrados; son el punto de partida de cada guía |
| Tres almacenes | Sembrados y ligados a su establecimiento |
| No son agentes de retención ni percepción | Bandera en cero, editable en `/maestros/empresa` |
| Valorizan a promedio | Método de la empresa, congelado en cuanto hay kardex |
| 250 facturas de compra al mes | Carga en serie en `/compras/lote` |
| «Sí» a reportes de importación | `/importaciones/pendientes` y `/importaciones/reportes` |
| Control documental por orden de importación | Expediente en la ficha del embarque |
| Guías con vehículo propio | El formulario ya arranca en transporte privado |
| **Migración: opción b** (resaltada en amarillo) | `/maestros/apertura`: se pegan las tres hojas —deudas de clientes, deudas a proveedores y stock—, se revisa el cuadro y se cargan en una sola transacción |
| Planillas, CTS, gratificaciones, liquidación | Módulo nuevo, fuera del contrato (ver `CONTRATADO.md` §4) |
| Aviso de vencimiento de contratos | `/rrhh/contratos` |
| Historial de remuneraciones | En la ficha del trabajador |

**Lo que falta del cliente, y son datos y no programación:** los correos y los
permisos de las seis personas que van a usar el sistema (pregunta 8, que llegó
sólo con los nombres), el buzón desde el que salen las invitaciones (pregunta 9,
que llegó con el nombre de quien lo administra pero no con la dirección), y el
último número emitido de cada serie, que se toma el día del cambio.

**La marca de los saldos migrados.** Las deudas de clientes viven en
`comprobantes`, que es donde el sistema calcula el saldo por cobrar —una sola
definición, para que ninguna pantalla discrepe de otra—. Pero esa misma tabla
alimenta el registro de ventas, el PLE 14.1 y la liquidación del PDT, y esas
facturas ya se declararon en Starsoft. De ahí la bandera `es_apertura`: entran
en la cartera y quedan fuera de los libros. Sin ella, la empresa pagaría dos
veces el IGV de toda su cartera pendiente, y el error no se vería hasta que
SUNAT cruzara la información. Hay una prueba que lo fija desde los cuatro
ángulos.

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

**Resumen diario y comunicación de baja.** Las boletas se agrupan por día en un
resumen; una factura ya aceptada sólo se anula por comunicación de baja. Los dos
van por `sendSummary`, que devuelve un ticket y no un CDR: enviar y recoger son
dos actos distintos, y entre ellos puede pasar una hora. Un «98 en proceso» no
mueve el estado. El desenlace del resumen se propaga a cada comprobante que
agrupa: un resumen aceptado cuyas boletas siguieran en borrador haría creer al
contribuyente que declaró algo que no declaró.

**Guía de remisión electrónica.** Único módulo que no habla SOAP con SUNAT: va
por la API REST de la GRE, con OAuth2 y credenciales propias —un `client_id` y
un `client_secret` que se generan aparte en el menú SOL; las SOL no sirven—. El
`username` del token es el RUC pegado al usuario SOL, que es el detalle que más
veces devuelve un 401 sin explicación, y hay una prueba que lo fija. El
documento es un `DespatchAdvice` sin importes ni impuestos: lo que sustenta es
el traslado. El transporte público exige transportista; el privado, placa y
conductor, y se valida antes de guardar.

**Retenciones y percepciones.** No se capturan a mano: se generan del pago que
retuvo o de la cobranza de una venta que llevaba percepción, y el importe es el
que se registró entonces —el que el proveedor o el cliente tiene en la mano—, no
uno recalculado. Se declaran siempre en soles, con el tipo de cambio dentro de
cada referencia cuando la operación fue en dólares. En el XML la firma va antes
del identificador, al revés que en la factura: el orden es parte del esquema.

**Letras al vencimiento.** Pago total o parcial, y protesto, que no cancela la
deuda sino que la reclasifica de «no vencidas» a «vencidas» y lleva sus gastos a
gasto financiero. La programación de egresos junta facturas y letras ordenadas
por vencimiento con un acumulado corrido: dice cuánta caja hace falta hasta cada
fecha, no cuánto se debe en total.

**Usuarios, roles y segundo factor.** Invitación con enlace de un solo uso —la
cuenta no sirve hasta que la persona elige su contraseña—, roles propios con una
rejilla de módulo por acción, y el freno que impide dejar la empresa sin ningún
administrador activo. El segundo factor se activa en dos pasos, y sólo después
de que la persona escriba un código de su app: activarlo al generar el secreto
la dejaría fuera de su propia cuenta si el escaneo falló.

**Notas de crédito y débito.** Sobre un comprobante ya enviado, nunca sobre un
borrador ni sobre otra nota. Sin líneas propias copian el comprobante entero, que
es la anulación; con líneas, la devolución parcial. Una nota de crédito no puede
llevarse más de lo que queda vivo del comprobante, y la devolución de mercadería
al almacén es opcional y explícita: reingresa al costo con el que salió, no al
promedio del día, y hay motivos —un error en el RUC— que no mueven una sola
unidad. El saldo por cobrar tiene una única definición que ya descuenta las
notas, así que no puede discrepar entre pantallas.

**Libros electrónicos.** Las estructuras salen del Anexo 2 de la
R.S. 286-2009/SUNAT y sus modificatorias, contrastadas campo por campo contra el
archivo oficial «Estructura del PLE.xls» (PLE 5.0.0). Cada formato declara su
número de campos en la constante `CAMPOS` y el generador verifica cada línea
antes de entregarla: un campo corrido desplaza todos los siguientes y el
validador rebota el archivo sin decir cuál. Al verificarlo aparecieron dos
errores en los formatos que ya estaban escritos —el 8.1 tenía el importe total
en el campo 23 en vez del 24, porque la R.S. 108-2020 insertó el impuesto a las
bolsas de plástico en el 22; el 13.1 tenía casi todo el orden cambiado y le
faltaban tres campos—. Falta validar los archivos con el aplicativo del PLE antes
de la primera presentación real.

**Contabilidad.** Balance de comprobación, mayor por cuenta, captura manual de
asientos en dos tiempos —borrador que se guarda aunque no cuadre, contabilizado
que ya no se edita y sólo se extorna—, estado de situación financiera y estado
de resultados por naturaleza, cierre y reapertura de periodo, y siete libros
electrónicos con el nombre de archivo de 33 caracteres y la codificación Latin-1
que exige el PLE: 5.1 diario, 6.1 mayor, 8.1 registro de compras, 8.2 compras a
no domiciliados, 12.1 inventario en unidades, 13.1 inventario valorizado y 14.1
registro de ventas.

Un periodo cerrado rechaza asientos nuevos, y no se cierra si quedan borradores
sin resolver o si el balance no cuadra: cerrar sobre un descuadre lo vuelve
permanente. La validación de los estados financieros no es cosmética —hay una
prueba que exige que activo iguale a pasivo más patrimonio y que el resultado
del ejercicio coincida con el que sale del estado de resultados.

El cierre anual son dos pasos en ese orden: ajuste por diferencia de cambio de
las partidas monetarias al tipo de cambio de cierre, y cancelación de las
cuentas de resultado contra la 89 con traslado a resultados acumulados, ambos
asientos en el periodo 13. El ajuste se emite en dólares con importe cero en la
moneda de la operación y sólo con el equivalente en soles: eso es lo que permite
repetirlo sin duplicar nada, porque el saldo en dólares no se mueve y el
funcional sí acumula lo ya ajustado. Sólo se revalúan las partidas monetarias;
una existencia comprada en dólares fijó su costo en soles el día que entró al
almacén.

**Pagos y letras.** Aplicación de pagos a varios documentos con validación
contra el saldo real, retención de IGV del 3 % —la deuda se cancela por el bruto
y sale el neto—, reconocimiento de la diferencia de cambio al pagar una factura
en dólares a otro tipo, y canje y renovación de letras.

**Cobranzas.** La contraparte, con el signo de la diferencia de cambio
invertido: una cuenta por cobrar es un activo, así que una subida del dólar es
ganancia. Límite de crédito por cliente, que el sistema informa sin bloquear
—autorizar una venta por encima del tope es una decisión comercial—, y
exposición por cliente separando lo vencido de lo por vencer.

**Importaciones.** Al ciclo de siempre —orden al exterior, gastos, liquidación,
ingreso al almacén y asiento— se le añadió la **póliza**: la DUA con la que se
nacionaliza un despacho, que puede amparar varios embarques. Sus gastos se
reparten entre ellos por valor FOB, cantidad, peso o volumen, con resto mayor,
de modo que lo repartido sea exactamente lo gastado; después, dentro de cada
embarque, se prorratean como siempre. El tipo de cambio de la póliza manda: lo
fija la aduana para la fecha de numeración.

Liquidar una póliza liquida todos sus embarques en una sola transacción. Media
póliza liquidada sería peor que ninguna, porque los embarques que quedaran fuera
arrastrarían un costo sin su parte de la DUA y nadie se enteraría hasta vender.

**Compras.** Requisición → solicitud de cotización → cuadro comparativo → orden
de compra → factura del proveedor. Los tres primeros documentos no tocan
inventario ni contabilidad: son papeles de decisión, y el primer hecho contable
sigue siendo la factura. Sólo se cotiza lo aprobado, un proveedor no puede tener
dos ofertas vigentes sobre la misma solicitud, y el cuadro comparativo convierte
cada oferta con su propio tipo de cambio —comparar soles contra dólares a secas
hace ganar siempre a la oferta en dólares, que es el error que un cuadro
comparativo existe para evitar—. Elegir una oferta emite la orden, descarta las
demás, cierra la solicitud y marca la requisición como atendida.

**Ventas.** Cotización → pedido → comprobante. La cotización congela el precio
hasta su fecha de caducidad y no toca inventario ni contabilidad; convertida en
pedido, conserva esas condiciones. La factura emitida contra un pedido descuenta
su saldo en la misma transacción que la numeración, el kardex y el asiento: si
algo falla, el pedido tampoco se movió. Un pedido facturado a medias queda
«parcial» con su saldo a la vista, y facturar por encima de lo pedido se rechaza
antes de tocar el almacén, para que el usuario lea el problema que tiene y no el
que se derivó de él.

**Estado de resultados por función y asiento de destino.**
`/contabilidad/destino` reclasifica los gastos de la clase 6 —registrados por
naturaleza, como exigen los libros— a las cuentas funcionales de la clase 9,
según reglas por cuenta y centro de costo. Gana la regla más específica. No
cambia el resultado (la clase 9 y la 79 se anulan), no reclasifica dos veces
(se lleva sólo lo pendiente) y **lo que no tiene regla se denuncia**: el estado
por función se declara incompleto mientras quede gasto sin destinar.

Al implementarlo apareció un efecto de fondo: la **79 es clase 7** y se colaba
como ingreso en todo lo que agrupa por primer dígito —estado de resultados por
naturaleza, resultados por centro, ejecución presupuestal y el motor de formatos
de EEFF—. El día que alguien destinara, la utilidad habría caído a cero y el
presupuesto de ingresos habría parecido cumplido de golpe. Las cinco consultas
la excluyen ahora, y las cuentas de orden quedan fuera de los estados
financieros en vez de aparecer como «olvidadas».

**Presupuesto y análisis presupuestal.** `/contabilidad/presupuesto` guarda lo
que la empresa planea gastar e ingresar por centro de costo y por mes, y lo
compara con lo que dice el mayor. No genera asientos: es la vara de medir. Una
partida anual se reparte en doceavas exactas; ingresos y gastos se miden los dos
en positivo para que el avance signifique lo mismo; y **lo gastado fuera de
presupuesto se denuncia en pantalla**, porque un análisis que sólo mira lo
planeado deja fuera justo lo que nadie planeó. Aprobado deja de editarse, pero
se puede reabrir: un plan que no se puede corregir se abandona.

**Formatos configurables de estados financieros.** `/contabilidad/formatos`. La
plantilla decide qué cuentas entran en cada renglón, en qué orden y con qué
subtotales; los saldos siguen saliendo de los asientos. Cada empresa nace con
dos formatos que reproducen los estados cableados, con una prueba que compara
cifra por cifra: si no coincidieran, cambiar de plantilla cambiaría las cifras y
el formato sería aritmética en vez de presentación.

Tres clases de renglón y ninguna más —título, detalle y total— en lugar de un
lenguaje de fórmulas, y un total sólo suma renglones anteriores. Y la
salvaguarda: **el motor delata las cuentas con saldo que ningún renglón
recoge**, y la pantalla de estados lo avisa. Sin eso, una cuenta nueva del plan
desaparecería del informe sin que nadie lo note.

**Cuentas de integración.** `/contabilidad/parametros` decide qué cuenta usa el
programa cuando contabiliza solo: la venta, el IGV, el cliente, el proveedor,
las letras, la diferencia de cambio, el resultado del ejercicio. Estaban
escritas dentro del código —son las del plan general y sirven para la mayoría—,
pero cada contador arma su plan y adaptarse a una empresa exigía tocar el
programa.

Tres decisiones la sostienen. **Sólo se guarda lo que la empresa cambió**: el
catálogo del programa es el valor de partida y la tabla guarda las excepciones,
así que una empresa creada hace un año y una creada hoy se comportan igual sin
sembrar nada. **La cuenta se comprueba al configurar**, no al contabilizar:
apuntar a una que no existe o que no admite movimiento rompería la primera
operación que la usara, cuando ya no está delante quien la puso. Y **volver a la
cuenta de partida borra la excepción**, de modo que la empresa vuelve a seguir al
catálogo si el día de mañana cambia.

Al construirlo se coló un error propio: comprobar si una cuenta admite
movimiento contando sus dígitos. Parecía razonable —la 4212 es divisionaria y la
42 no— y es falso: la 759, la 776 y la 676 tienen tres dígitos y sí admiten
movimiento, así que la pantalla rechazaba sus propios valores de partida. Quien
lo decide es el plan de cuentas, que ya lo dice en cada fila.

**El cheque-voucher.** El cheque lo imprime el banco en su talonario; el voucher
es el comprobante que se archiva con él y dice **qué se está pagando**: las
facturas que cancela, una por una, con lo aplicado a cada una. Sin ese detalle,
quien firma no puede saber si el cheque corresponde a lo que autorizó.

**Lo que se imprime.** Starsoft se usa con la impresora al lado, y eso cambia
qué hay que construir: la orden de compra y la de importación se mandan al
proveedor, la guía viaja con la mercadería, el recibo se firma y la factura se
entrega. Hay una hoja por documento —membrete, datos, detalle y casillas de
firma— y una hoja de estilos de impresión que quita el menú, los botones y los
filtros: en papel sale el documento, no la pantalla.

La **representación impresa** del comprobante lleva lo que exige la norma: el
resumen del XML y el código QR con los nueve campos de la operación en su orden
exacto. El QR se dibuja en la propia hoja, no se trae de la red, porque se
imprime también el día que no haya conexión. El importe en letras no se
recalcula: se toma el que se guardó al emitir, que es el que viaja dentro del
XML, para que la hoja y el archivo no puedan decir cosas distintas.

**Registros de compras y ventas.** `/contabilidad/registros` enseña en forma de
cuadro los dos libros que el contador revisa cada mes, con sus totales. Salen de
**la misma consulta que el archivo del PLE**: lo que se revisa en pantalla es
exactamente lo que se entrega. Las notas de crédito restan, lo anulado figura en
cero —el correlativo no puede saltarse, pero no es una operación— y los
borradores no entran, con un aviso que lo dice: si no, el libro sale vacío
mientras la pantalla de ventas enseña treinta documentos del mes.

**La sucursal se puede editar.** Nacía con la empresa y ya no había pantalla
para completarla, así que su ubigeo quedaba vacío para siempre y **cada guía de
remisión obligaba a teclear el punto de partida a mano**. Ahora se mantiene
desde `/maestros/almacenes`, y la lista marca en amarillo la sucursal a la que
le falta.

**Precios históricos.** `/compras/precios` mira las compras **y los
embarques**. Para un importador eso decide el informe: mirando sólo las compras
locales, la serie de un artículo salía con dos entradas y parecía que casi no se
compra. De la importación se traen dos cifras separadas —el FOB del exportador y
el costo puesto en almacén que sale de la liquidación—, porque compararlas como
si fueran lo mismo lleva a creer que importar sale más barato de lo que sale.

**Antigüedad de saldos y morosidad.** `/cxc/morosidad` reparte la cartera en
cinco tramos, incluye las letras y da la mora media ponderada por importe. No
puntúa al cliente: un número del uno al diez esconde en qué tramo está la deuda,
que es toda la información. Lo que no trae plazo pactado se clasifica por su
emisión —una deuda sin plazo es exigible desde que nace— y se avisa; al
implementarlo se vio que, excluyéndolo, un tercio de la cartera de la base de
pruebas desaparecía del cuadro.

**Libro de bancos.** `/caja-bancos/libro` da saldo inicial, movimientos y saldo
final de una cuenta, y lo contrasta contra su cuenta contable. El libro sale de
los movimientos y el mayor de los asientos: si no coinciden hay un movimiento sin
asiento o al revés. Cuando dos cuentas de efectivo comparten la misma cuenta del
PCGE —dos corrientes en la 1041, que es lo normal— no se afirma que cuadre ni que
no: se dice que el contraste es del conjunto.

**La letra, al pagarse.** Pagar una letra **retiene el IGV** si la empresa es
agente, que es el momento que manda la norma: no al canjear, donde no se pagó
nada, sino al vencimiento o cuando se hace efectiva. El comprobante de retención
acredita las facturas canjeadas, no la letra. Y se cerró un agujero viejo: el
pago de una letra no llegaba a Caja y Bancos, así que el asiento decía que el
banco se había movido y la tesorería seguía marcando lo mismo —dos verdades sobre
el mismo dinero, que es exactamente lo que impide conciliar—.

**Planillas de cobranza.** `/cxc/planillas` reúne facturas y letras en la hoja
con la que se sale a cobrar, y las libera al cerrarla. Se ofrece el saldo libre
—lo entregado en otra planilla no vuelve a aparecer— y lo cobrado se deduce del
saldo del documento en vez de apuntarse: si el cliente pagó por transferencia en
vez de al cobrador, la deuda igual se extinguió.

**Referencia en el kardex.** Cada movimiento dice ahora qué documento lo causó y
con quién: la factura de compra, la de venta, la nota de almacén o la
liquidación de importación. Sin esa columna, una salida es una cantidad y una
fecha, y cuando el conteo físico no cuadra no hay por dónde empezar a preguntar.

**Exportación al PDT.** El botón de `/contabilidad/impuestos` baja la
liquidación en CSV con punto y coma —el separador de un Excel en español— y la
casilla en la primera columna, que es por donde se busca al declarar.

Lo que no hace, y a propósito: escribir el archivo binario que el PDT importa.
Su estructura la publica SUNAT por versión del programa y cambia con cada una;
generarla de memoria sería inventar un formato que el cliente descubriría
rebotado el día 12. Queda pendiente de la estructura de la versión que usa la
empresa.

**Ratios financieros.** `/contabilidad/ratios` calcula quince ratios de
liquidez, solvencia, actividad y rentabilidad **sobre el formato**, no sobre
rangos de cuentas: qué parte del pasivo vence dentro del año no lo dice el
número de cuenta, lo decide el contador al armar la plantilla. Cada renglón del
formato puede declarar qué papel cumple —`activo_corriente`, `existencias`,
`ventas`…— y de ahí salen los ratios.

La regla dura: **un ratio sin sus insumos no se calcula ni se estima**, se
muestra en blanco con la frase de qué falta declarar. Un número inventado es
peor que un hueco porque nadie lo cuestiona. Lo mismo con la división entre
cero, que sale sin calcular en vez de dar infinito, y con el costo de ventas,
que el formato presenta en negativo porque en el estado resta: tomarlo con ese
signo daba rotaciones y días de inventario negativos.

El papel se añadió después de que ya hubiera empresas creadas, y sus formatos de
partida se quedaron sin él —sin un solo ratio calculable—. Sincronizar formatos
ahora **completa los papeles que faltan** sin tocar los que alguien ya colocó a
mano, que es una decisión y no un hueco.

**Análisis contable.** `/contabilidad/anexos` lleva la cuenta corriente de un
tercero por el mayor, separada por cuenta contable y sin netear: lo que se le
debe a un proveedor y lo que él debe por un anticipo no se compensan solos, y
presentarlos juntos esconde las dos cifras que importan. `/contabilidad/centros`
da ingresos, costos, gastos y margen de cada centro de costo, y avisa de los que
están en pérdida — un resultado global positivo puede estar tapando una obra que
pierde todos los meses. Lo que no lleva centro aparece en su propia fila y no se
reparte por una fórmula inventada.

**Liquidación mensual de impuestos.** `/contabilidad/impuestos` arma el borrador
del PDT 621 con las casillas numeradas: débito fiscal, crédito fiscal, saldo a
favor del mes anterior, IGV a pagar y pago a cuenta de renta. Lee las mismas
filas que los formatos 8.1 y 14.1 del PLE y con el mismo filtro —un borrador no
entra en ninguno de los dos—, así que las dos cifras siempre coinciden; hay una
prueba que lo comprueba línea por línea contra el archivo generado.

Tres reglas que evitan las rectificatorias más comunes: un IGV negativo no se
declara —el sobrante viaja al mes siguiente—, la renta se calcula sobre los
ingresos netos y no sobre el total de la factura, y lo retenido o percibido a
terceros va en su propio bloque porque es dinero ajeno que se declara aparte.

**Refinanciación de letras.** Una letra que el cliente no puede pagar se
reemplaza por dos o tres con vencimientos escalonados, en vez de protestarla.
Las cuotas tienen que sumar el saldo más los intereses al céntimo: dejar que no
cuadre convertiría la refinanciación en una condonación parcial silenciosa.

Al hacerlo apareció un defecto de fondo que ya existía en la renovación: **los
intereses se asentaban siempre como gasto financiero contra letras por pagar**,
también cuando la letra era por cobrar. Renovarle una letra a un cliente inflaba
el gasto y el pasivo por una operación que en realidad aumenta el activo y el
ingreso. Los asientos cuadraban igual con el signo cambiado, que es lo que hacía
el error invisible.

**Cuentas por cobrar.** Estado de cuenta del cliente con cargos, abonos y saldo
corriendo, una serie por moneda, y la nota de crédito como abono. Proyección de
cobranzas por tramos que incluye las letras en cartera junto a las facturas y
convierte todo a soles. Cheques recibidos con su propio recorrido: recibido,
depositado, cobrado o rebotado, y rebotar exige motivo porque el cheque devuelto
vuelve a ser deuda.

**Cuentas por pagar.** A la programación de egresos y las letras se añadió la
**orden de pago**: se arma marcando documentos, alguien con permiso de
aprobación la autoriza o la rechaza con motivo, y sólo entonces se ejecuta el
pago con su asiento, su retención y su salida de caja. Dos órdenes no pueden
reclamar el mismo saldo. El estado de cuenta del proveedor lista cargos y abonos
con el saldo corriendo, una serie por moneda.

**Caja y bancos.** Recibos de ingreso y egreso numerados, con el importe en
letras. Cheques con su propia vida —girado, entregado, cobrado— que no tocan el
saldo hasta que el banco los carga, porque descontarlos el día del giro es lo
que hace que el libro de bancos nunca cuadre contra el extracto; la situación de
cheques suma lo que sigue en circulación y señala los diferidos y los añejos.
Entregas a rendir que salen contra la cuenta 14 y se justifican con documentos,
cada uno a su cuenta de gasto y con su propia fecha: el gasto del mes aparece
cuando ocurrió, no cuando salió el dinero.

Cuentas de efectivo con saldo derivado de sus movimientos,
importación del extracto pegando lo que exporta la banca por internet, y
conciliación que propone parejas por tres criterios en orden de confianza
—referencia, fecha e importe exactos, e importe igual con hasta tres días de
diferencia— sin conciliar nada hasta que alguien lo confirma. Arqueo de caja que
contabiliza el faltante o el sobrante y ajusta el libro auxiliar.

## Cómo se prueba

`npm test` corre el dominio, la web y la integración contra Postgres: 241 · 3 ·
862 pruebas. Las 64 de navegador van aparte.

Las de navegador van aparte y **contra una compilación de producción**:

```
npm run build
DATABASE_URL=postgres://localhost/roulterp_dev PORT=3100 npm run start
npm run test:navegador
```

Contra `next dev` tardaban veinte minutos y fallaban por plazo agotado en
rutas que el compilador estaba construyendo por primera vez: fallos del
compilador disfrazados de fallos de la aplicación, que es el peor ruido posible
en una batería de pruebas. Contra el binario de producción tardan veinte
segundos y lo que falla, falla de verdad.

El puerto importa más de lo que parece: las pruebas se saltan solas cuando no
hay servidor, y al mudarse al 3100 quedó un archivo apuntando al 3000. Seis
pruebas —las de lo que una empresa puede hacer el primer día— llevaban corridas
enteras saltándose en silencio. Las dos suites comparten ahora el mismo puerto
por omisión.

## Brecha contra Starsoft

`docs/starsoft-brecha.md` compara función por función contra los manuales de
usuario de Starsoft Gold Edition, publicados por la propia empresa. El resumen
honesto: **el núcleo contable y tributario está completo y probado; el flujo
comercial que precede al documento, no.**

Lo que falta y el cliente usa todos los días:

- ~~**Compras**: requisición → solicitud de cotización → cuadro comparativo~~
  **hecho.** El área pide, alguien con permiso de aprobación autoriza o rechaza
  con motivo, se sale a cotizar y el cuadro comparativo lleva cada oferta a
  soles antes de marcar la más barata. Elegir emite la orden de compra con su
  trazabilidad. Faltan la liquidación de compra (tipo 04) y los reportes.
- ~~**Ventas**: cotización y pedido de venta~~ **hecho.** Se cotiza con precio y
  fecha de caducidad, el cliente acepta, la cotización pasa a pedido con esos
  mismos precios y el almacén despacha contra el pedido: la factura trae el
  saldo pendiente ya puesto, admite despacho parcial y rechaza facturar de más.
  **Ranking de ventas y margen por artículo o cliente también hechos.**
- ~~**Inventario**: notas de almacén~~ **hecho.** Ingreso, salida,
  transferencia y ajuste, con documento numerado, kardex y asiento. **Kits y
  conversión de unidades también hechos, y el control por lotes y series.**
  **Rotación y stock mensual también hechos.**
- ~~**Caja y bancos**: recibos, situación de cheques, rendición de cuentas~~
  **hecho.** Falta sólo la plantilla de impresión del cheque-voucher.
- ~~**Cuentas por pagar**: orden de pago, autorización y estado de cuenta~~
  **hecho.** Falta la retención de IGV en el canje de letras.
- ~~**Cuentas por cobrar**: estado de cuenta, proyección, cheques rebotados y
  refinanciación de letras~~ **hecho.** Faltan las planillas de cobranza.
- ~~**Importaciones**: gastos y liquidación por póliza (DUA)~~ **hecho.** Una
  póliza agrupa los embarques que ampara y reparte entre ellos los gastos
  comunes, con el tipo de cambio de la DUA. Faltan la aprobación de documentos
  y los ocho reportes.

Nada de esto se puede dar por cerrado sin ver el Starsoft del cliente: qué
opciones usa de verdad, con qué numeración y qué documentos imprime.

## Qué falta

Los módulos contratados están completos. Lo que queda no es desarrollo sino
validación contra los sistemas reales de SUNAT, y sólo se puede hacer con las
credenciales del cliente:

1. **Validar los siete libros con el aplicativo del PLE.** Las estructuras están
   contrastadas campo por campo contra el archivo oficial de SUNAT, pero sólo el
   validador dice la última palabra.
2. **Homologar en el entorno beta de SUNAT** con el certificado real: factura,
   boleta, notas, resumen diario, comunicación de baja, retención, percepción y
   guía de remisión. Todo el camino está probado contra dobles; falta el
   servicio de verdad.
3. **Enviar correo de verdad.** La invitación y el restablecimiento generan un
   enlace que hoy hay que copiar a mano desde la pantalla.
4. **Migración de datos desde Starsoft**, cuando el cliente decida si la quiere.

## La prueba que decide si esto sirve

`packages/servicios/test/ciclo-completo.test.ts` encadena un mes de operación
—importar, comprar, vender, devolver, resumir boletas, guiar, cobrar, pagar
reteniendo, conciliar, cerrar el mes y el ejercicio— y después comprueba lo
único que comprueba un contador:

- que el libro cuadre;
- que **el mayor auxiliar coincida con el mayor general**: el valor del kardex
  con la cuenta 20, el auxiliar de proveedores con la 42, el de clientes con la
  12;
- que los estados financieros coincidan entre sí;
- que los libros electrónicos salgan con su estructura exacta.

Las pruebas por módulo pasan todas aunque dos módulos discrepen entre sí. Ésta
es la que ve la discrepancia, y encontró tres defectos que ninguna otra veía:

1. **El kardex y la contabilidad derivaban.** El almacén guardaba importes con
   seis decimales y el libro con dos. Tres milésimas por movimiento, que en un
   año de embarques dejan de ser despreciables y salen a la luz el día que
   SUNAT cruza el inventario valorizado contra el balance. El importe es dinero
   y ahora se redondea a dos decimales al registrarlo; el costo unitario
   conserva seis, que es lo que la propia estructura 13.1 admite.
2. **La deuda de una importación no llegaba al auxiliar.** El asiento abonaba
   la 4212 pero no se creaba el documento por pagar: para un importador, su
   pasivo principal no aparecía en la antigüedad de saldos ni se podía pagar
   desde el módulo de pagos.
3. **El cierre de ejercicio no podía asentar.** Agrupaba las cuentas de
   resultado sólo por cuenta, y las que exigen centro de costo quedaban sin él:
   el cierre anual fallaba en cuanto la empresa usaba centros de costo.

## Lo que apareció al usarlo como una empresa

Se dio de alta una empresa vacía y se recorrió el sistema por la interfaz como
lo haría su contadora: maestros, compra, venta, cobro, pago, banco, planilla,
informes y cierre de mes. Ninguna prueba de servicio veía nada de esto, porque
todas parten de datos ya sembrados:

1. **No se podía facturar sin certificado digital.** La pantalla exigía
   certificado y claves SOL para *emitir*, cuando el propio diseño separa emitir
   de enviar. Una empresa recién dada de alta quedaba sin poder registrar una
   sola venta durante los días que tarda el trámite. Ahora sólo la serie impide
   emitir; lo demás avisa de que el envío espera.
2. **Las cobranzas y los pagos no llegaban a Caja y Bancos.** La contabilidad
   decía que el banco se había movido y la tesorería marcaba cero: dos verdades
   sobre el mismo dinero, y una conciliación bancaria sin nada que casar. Ahora
   la operación elige la cuenta de efectivo, de ahí sale la cuenta contable del
   asiento, y el movimiento queda ligado a su origen y a su asiento.
3. **El plan de cuentas no tenía planilla.** Sin 62 ni 41 no se puede asentar la
   nómina, que es el gasto que toda empresa tiene todos los meses. Y el plan
   sólo se sembraba al crear la empresa: las ya existentes nunca recibían las
   cuentas nuevas. Hay un botón en Maestros que lo pone al día, y el cierre de
   ejercicio lo llama por su cuenta.
4. **El estado de resultados enumeraba tres grupos de gasto** —63, 64 y 65— y
   dejaba fuera la planilla y la depreciación: la utilidad operativa salía
   inflada por el importe de la nómina. Ahora se deriva de lo que hay en el
   libro, así que una cuenta nueva no puede desaparecer del informe.
5. **Una empresa nueva no tenía ningún centro de costo**, y la mayoría de sus
   cuentas de gasto lo exigen: no podía registrar su primer gasto y no había
   pantalla para crearlo. Ahora nace con uno genérico y hay una ficha para los
   suyos.
6. **Dos enlaces de Maestros llevaban a un 404**: plan de cuentas y almacenes.
7. **«No se pudo completar la operación»** era todo lo que decía al vender sin
   stock. Ahora dice cuánto hay y cuánto se pide.

`apps/web/test/empresa-nueva.test.ts` da de alta una empresa vacía en cada
ejecución y comprueba los siete.

**Una empresa no se puede borrar desde el producto, y es deliberado.** El libro
es append-only y un trigger impide borrar líneas de asiento: nadie puede hacer
desaparecer la contabilidad de un cliente. Purgar una empresa —una prueba que no
cuajó— es un acto administrativo que hace `scripts/empresa-de-prueba.ts` con
permisos de dueño.

## La otra lección: la pantalla no puede mentir

Tres fallos distintos con la misma forma —la interfaz seguía enseñando lo de
antes— y los tres invisibles para las pruebas de servicio:

1. **El menú marcaba dos módulos a la vez.** La coincidencia por prefijo
   encendía el padre junto al hijo, y estando en «Programación de egresos»
   seguía iluminado «Cuentas por pagar». Ahora gana la entrada más específica.
2. **Los formularios que no navegan volvían a su valor inicial.** React
   reinicia el formulario al terminar la acción, y un `defaultValue` fijado al
   montar ya no es el vigente: el desplegable de rol enseñaba el rol anterior
   al que acababa de guardarse. Se resuelve con una `key` atada al valor que
   manda el servidor.
3. **El aviso de confirmación se iba con la fila que lo produjo.** Al generar un
   resumen, al emitir una retención o al pagar una letra, la fila desaparecía de
   la lista y el mensaje con ella: el usuario pulsaba y no recibía respuesta. Se
   arregla sacando el aviso del componente que desaparece —a una sección
   completa, o a la propia dirección de la página—.

`apps/web/test/navegador.test.ts` fija los tres: comprueba que sólo una entrada
del menú quede marcada en cada ruta, que el desplegable diga lo que quedó
guardado, y que el aviso siga en pantalla después de que la fila cambie.

## La lección que más veces ha costado corregir

**Nada que escriba estado puede lanzar después dentro de la misma
transacción.** El ROLLBACK se lleva lo escrito y la operación queda como si no
hubiera pasado, salvo que sí pasó. Ha aparecido cuatro veces: el contador de
intentos fallidos de login, el rechazo de SUNAT al enviar un comprobante, el
rechazo del resumen diario al recoger su ticket, y el envío de la guía. El
patrón que la evita está en `enviarASunat`: leer y firmar en una transacción,
hablar con el exterior sin ninguna abierta, y guardar el desenlace en otra. Un
rechazo se **devuelve**, no se lanza: es un resultado legítimo que hay que
registrar.

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

- **Una línea de asiento puede existir sólo en moneda funcional.** Es la
  diferencia de cambio: una deuda de 1180 dólares registrada a 3.75 y pagada a
  3.80 se cancela por los mismos dólares pero cuesta 59 soles más. Al cancelar
  se carga la cuenta del proveedor por su importe **histórico**, no por el de
  hoy; si se convirtiera todo al tipo del pago, la diferencia desaparecería y la
  cuenta 42 quedaría con un saldo residual inexplicable.

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

## Simulación de un mes de operaciones (2026-10-07)

Se recorrió la cadena completa por la interfaz, contra el binario de producción y
una base sembrada: alta de proveedor, cliente y producto; orden de compra;
factura del proveedor con ingreso al almacén; factura de venta con salida de
kardex y cuenta por cobrar; alta de trabajador; planilla del mes; y cierre
—balance, liquidación de impuestos, los siete libros del PLE y el CSV del PDT.

Veintidós pasos, y al final los números coinciden entre sí: el balance cuadra, el
inventario valorizado concuerda con el kardex y la cartera con lo facturado y no
cobrado.

Encontró **cinco fallos que las 1 300 pruebas no veían**, todos en la junta entre
dos piezas que por separado funcionaban. Están corregidos y cada uno dejó su
prueba:

1. **La orden de compra y el registro de la factura estaban bloqueados.**
   `leerLineas` de compras descartaba toda fila cuya descripción estuviera vacía,
   y elegir un producto del desplegable no la rellena —el producto ya trae la
   suya—. Quien elegía producto, cantidad y precio leía «necesita al menos una
   línea con producto» mirando una pantalla que tenía el producto puesto. Era la
   única de las cinco pantallas con líneas que tenía la regla mal.
2. **Las órdenes de compra se guardaban sin número.** La pantalla no pide número
   y el servicio hacía `datos.numero ?? siguienteNumero(...)`; la acción mandaba
   `""`, que no es `undefined`, así que el `??` no entraba. La primera orden
   pasaba y la segunda chocaba contra el índice único quejándose de un número que
   nadie había escrito.
3. **Comprar mercadería sin indicar almacén descuadraba el kardex.** El ingreso
   al almacén vivía bajo un `if (datos.almacenId)`: sin almacén no se movía nada,
   pero el asiento sí cargaba la cuenta 20. Diecisiete mil soles de existencias
   que la contabilidad tenía y el almacén no, sin un aviso, hasta que alguien
   cuenta el almacén a fin de año. Ahora el almacén es obligatorio en cuanto una
   línea es un bien, y sigue siendo opcional para un servicio.
4. **El límite de crédito no se comprobaba al facturar.** `cabeEnElLimite`
   existía con sus pruebas y no la llamaba nadie: el tope se configuraba por
   cliente y se veía en su ficha, y al emitir no se miraba. La simulación facturó
   26 432 soles a un cliente con tope de 20 000 sin una palabra. Se comprueba
   antes de tomar correlativo —un número gastado no se devuelve— y se puede
   autorizar por encima con permiso de aprobación en ventas.
5. **Armar un kit se rechazaba sin motivo.** La comprobación de «todos los
   componentes en la misma cuenta de existencias» comparaba la cuenta del
   producto contra la cadena `"(por defecto)"`, así que un producto con 20111
   escrito y otro sin cuenta salían como cuentas distintas aunque los dos acaben
   en 20111. Pasa siempre que se mezcla un producto del maestro antiguo con uno
   dado de alta en la pantalla, porque el alta no tiene campo para la cuenta.

La simulación queda como prueba permanente en
`apps/web/test/operacion-mes.test.ts` y corre con `npm run test:navegador`.

**Lo que la simulación no puede probar:** el envío real a SUNAT, que necesita el
certificado digital de la empresa y sus credenciales SOL. Todo el camino está
construido y probado contra respuestas simuladas; el juez es la homologación.

## Rediseño sin tarjetas (2026-10-07)

El cliente lo dijo en tres frases y las tres eran medibles:

**«No deja scrolear para ver más abajo».** Era un fallo del layout, no una
impresión. La rejilla del ERP tiene `h-[100dvh]` y `overflow-hidden`, pero su
única fila se dimensionaba por el más alto de sus dos hijos. En una ventana de
700 píxeles la barra lateral pide 864 —su menú no cabe—, así que la fila medía
864, el `main` medía 864, y el `overflow-hidden` recortaba los 164 de más. Se
llegaba al final del scroll y la última fila de la tabla seguía fuera de la
pantalla, sin forma de alcanzarla. En monitores altos no se notaba; en un
portátil con la barra del navegador, sí. Arreglado con
`grid-rows-[minmax(0,1fr)]` y `min-h-0` en los dos hijos.

**«Las cards hacen que horizontalmente no entre todo habiendo espacio».** Cierto
y cuantificable: en una ventana de 1680 había 1428 píxeles disponibles y el
contenido estaba topado a 1180. Ocho pantallas obligaban a arrastrar la tabla en
horizontal con un cuarto de la pantalla vacío al lado. Fuera el tope.

**«Usas demasiadas cards para todo, NO ME GUSTA».** Eran 275 usos. Cada pantalla
de un ERP es cabecera, filtros, tabla y totales; enmarcar cada una no jerarquiza
nada, sólo repite el mismo recuadro cuarenta veces. Ahora el contenido se apoya
en la página, que pasó a ser blanca, y lo que separa es el aire y una línea de un
píxel donde hace falta: encima de la cabecera de la tabla y debajo de la última
fila. La clase se llama `.bloque` y no dibuja nada.

| | antes | después |
|---|---|---|
| Ancho usable (ventana de 1680) | 1180 px | 1428 px |
| Pantallas con scroll horizontal | 8 | 3 (por 28, 129 y 5 px) |
| Contenido inalcanzable al final | sí, 164 px | no |
| Paneles con borde y sombra | 275 | 0 |

Lo que quedaba enmarcado y también se fue: el estado vacío, que era un recuadro
de puntos rodeando una frase. Un hueco no necesita marco para leerse como hueco.

Las tres pantallas que aún se arrastran en horizontal lo hacen por su contenido,
no por el envoltorio: el registro de compras del PLE tiene catorce columnas y no
hay ancho que las meta sin encoger la letra.
