# Brecha contra Starsoft Gold Edition

Comparación función por función entre RoultERP y Starsoft, limitada a los módulos
que SERVIDIMAR contrató. El objetivo del proyecto es que el cliente conserve su
flujo de trabajo, así que lo que importa aquí no es si RoultERP hace bien la
contabilidad —eso está probado— sino si **hace lo mismo, en el mismo orden y con
los mismos documentos**.

## De dónde sale esta comparación

1. `MODULOS_CLIENTE.md`, con las funciones que el cliente contrató.
2. La ficha pública de Starsoft Gold Edition, que enumera las funciones de cada
   módulo (starsoft.com.pe).
3. **Los manuales de usuario de Starsoft Gold Edition**, publicados por la
   propia empresa, que dan el árbol de menú y el flujo real de cada módulo:
   Compras, Contabilidad, Inventarios, Importaciones y Facturación.

Lo que **no** hay es la instalación del cliente. Un clon exacto del *flujo* no se
deduce de un manual: depende de qué opciones usa SERVIDIMAR de verdad, con qué
numeración, qué campos llena y cuáles ignora. Eso está pendiente y se anota al
final.

> **La lista que manda es `MODULOS_CLIENTE.md`.** Lo que el cliente contrató
> está revisado función por función en `docs/CONTRATADO.md`, y todo está hecho.
> Este documento compara contra Starsoft **entero**, que es más de lo que se
> contrató: lo que aquí siga en ❌ y no esté en el contrato puede esperar.

## Resumen

| Módulo | Núcleo | Flujo previo al documento | Reportes | Veredicto |
|---|---|---|---|---|
| Contabilidad | ✅ | ✅ | ✅ **completa** | — |
| Compras | ✅ | ✅ **requisición → cuadro comparativo** | ✅ **precios históricos** | Falta la liquidación de compra (fuera de lo contratado) |
| Ventas | ✅ | ✅ **cotización y pedido hechos** | ✅ **ranking y margen** | — |
| Inventario | ✅ | ✅ **notas, kits, conversiones, lotes y series** | ✅ | — |
| Cuentas por cobrar | ✅ | ✅ **estado de cuenta, proyección, cheques, planillas y refinanciación** | ✅ | — |
| Cuentas por pagar | ✅ | ✅ **orden de pago y autorización** | ✅ | — |
| Caja y bancos | ✅ | ✅ **recibos, cheques y rendiciones** | ✅ **libro de bancos** | — |
| Importaciones | ✅ | ✅ **póliza (DUA) hecha** | ❌ | Faltan aprobación de documentos y 8 reportes |
| Factron | ✅ | ✅ | — | Completo |

---

## 1. Compras

Starsoft (menú real del manual):

```
3. GESTIÓN COMPRAS
   3.1 Requisiciones          (de compras · de servicio)
   3.2 Cotizaciones           (solicitud · actualiza · registro · cuadro comparativo)
   3.3 Órdenes de compra      (emisión · actualizar estado)
   3.4 Órdenes de servicio    (emisión · actualizar estado · nota de ingreso por servicio)
   3.5 Liquidaciones de compra
4. FACTURAS                   (registro · asiento contable · registro de guía de servicio)
5. CONSULTAS                  (cotizaciones · órdenes de compra · órdenes de servicio)
6. REPORTES                   (requisiciones · OC · facturas · guías por proveedor ·
                               estadísticas de ingresos · registro de compras ·
                               registro por proveedor · consistencia de asientos)
```

RoultERP: **requisición → solicitud de cotización → registro de las respuestas →
cuadro comparativo → orden de compra → registro de la factura** (que hace el
ingreso al almacén, el asiento y la cuenta por pagar en un paso).

**Hecho.** `/compras/requisiciones` y `/compras/cotizaciones`. Un área levanta la
requisición —de bienes o de servicio, y puede pedir algo que todavía no existe
como producto—, alguien con permiso de aprobación la autoriza o la rechaza con
motivo, se sale a cotizar a varios proveedores y el cuadro comparativo lleva
cada oferta a soles con su propio tipo de cambio antes de marcar la más barata.
Elegir una emite la orden de compra, descarta las demás y deja la trazabilidad
puesta: la orden dice de qué cotización y de qué requisición salió, y la pantalla
de la orden enlaza a las dos.

De paso quedaron cubiertas dos pantallas que el menú prometía y no existían:
`/compras/ordenes/nueva` y `/compras/ordenes/[id]`, ambas eran 404.

Lo que sigue faltando de este módulo (texto original):

**Falta lo que ocurre antes de la orden de compra**, que es donde el área
de logística pasa la mayor parte del tiempo:

| Función de Starsoft | RoultERP |
|---|---|
| Requisición de compras / de servicio | ✅ |
| Solicitud de cotización a proveedores | ✅ |
| Registro de cotizaciones recibidas | ✅ |
| Cuadro comparativo de precios | ✅ |
| Orden de compra | ✅ |
| Orden de servicio (documento aparte) | ⚠️ la OC admite servicios, pero no es un documento distinto |
| Nota de ingreso por servicio | ❌ |
| Liquidación de compra (comprobante tipo 04) | ❌ |
| Registro de factura + asiento | ✅ |
| Precios históricos por proveedor | ✅ compras e importaciones |
| Consultas y 9 reportes | ❌ |

## 2. Ventas

Starsoft: «cotizaciones, pedidos, boleta de venta, facturas, notas de crédito,
notas de débito, letras, guías y tickets», más «ranking de ventas por artículo y
clientes», «utilidad de ventas», «cuadres de caja» y «control de obsequios».

| Función | RoultERP |
|---|---|
| Cotización / proforma | ✅ |
| Pedido de venta | ✅ |
| Factura, boleta | ✅ |
| Nota de crédito y débito | ✅ |
| Guía de remisión | ✅ |
| Letras | ✅ (desde CxC) |
| Ticket | ❌ (fuera de alcance razonable: es punto de venta) |
| Factura de exportación | ⚠️ el dominio la calcula, no hay flujo |
| Control de obsequios (gratuitas) | ⚠️ ídem |
| Ranking por artículo y cliente | ✅ |
| Utilidad de ventas (margen) | ✅ |

**Hecho.** `/ventas/cotizaciones` y `/ventas/pedidos`. El flujo es el de Starsoft:
se cotiza con precio y fecha de caducidad, el cliente acepta, la cotización se
convierte en pedido conservando esos precios, y el almacén despacha contra el
pedido. Facturar desde el pedido trae el detalle pendiente ya puesto, admite
despacho parcial —el pedido queda «parcial» con su saldo— y rechaza facturar de
más. Una cotización convertida no se vuelve a pedir.

**Ranking y margen, hechos.** `/ventas/ranking`. Agrupa por artículo o por
cliente, y el costo sale del costo unitario que la venta guardó al descargar el
kardex —el mismo importe que fue al asiento como costo de ventas—, de modo que
el margen de este reporte y el del estado de resultados coinciden al céntimo.
Hay una prueba que lo comprueba: calcular el margen con una lista de precios
daría dos números distintos y nadie sabría cuál creer.

## 3. Inventario

Starsoft (menú real):

```
3. TRANSACCIONES
   3.1 Nota de ingreso        3.5 Nota de ajuste
   3.2 Nota de salida         3.6 Proceso de guías (remisión · ventas por facturar ·
   3.3 Transferencia directa      ventas contra factura · transferencia)
   3.4 Transferencia por conversión de unidades
   3.7 Ingreso por compras (por orden de compra · por importación · guía de compras)
   3.8 Manejo de kits (armado · desarmado)
```

RoultERP: los movimientos **sólo** nacen de una compra, una venta o una
liquidación de importación. No hay forma de:

| Función | RoultERP |
|---|---|
| Nota de ingreso manual | ✅ |
| Nota de salida manual (consumo, merma) | ✅ |
| Transferencia entre almacenes | ✅ |
| Transferencia por conversión de unidades | ✅ |
| Nota de ajuste (inventario físico) | ✅ |
| Control por lotes y series | ✅ |
| Kits (armado / desarmado) | ✅ |
| Consultas de stock y documentos | ⚠️ existencias y kardex |
| Reportes: por lote y por serie | ✅ |
| Reportes: stock mensual y rotación | ✅ |
| Reporte: kardex con referencias | ✅ |

**Era lo más grave del listado y ya está hecho.** Las cuatro notas —ingreso,
salida, transferencia y ajuste— existen con documento numerado, kardex y
asiento. Tres decisiones que conviene no revertir:

- **La transferencia no genera asiento.** La mercadería no cambia de cuenta,
  sólo de sitio; un asiento que carga y abona la 20 por el mismo importe ensucia
  el mayor sin informar de nada.
- **El costo de una salida lo pone el kardex, no quien captura.** Quien saca
  mercadería no decide cuánto valía.
- **Un periodo cerrado no admite ni siquiera una transferencia**, aunque no
  genere asiento: mueve el kardex, y el kardex alimenta el inventario valorizado
  de un mes que quizá ya se declaró.

**Kits y conversión de unidades, hechos.** `/inventario/kits`. Los dos casos que
Starsoft separa en el menú son el mismo problema —un artículo que se convierte en
otros sin comprar ni vender nada—, así que comparten tabla y código: una
conversión es un kit de un solo componente.

La regla dura es que el valor se conserve. Armar diez botiquines no crea
riqueza: el kit entra por la suma exacta de lo que costaron sus componentes
según el kardex, y desarmar reparte ese costo entre ellos con resto mayor para
que la suma vuelva a cuadrar al céntimo. Como la cuenta 20 no se mueve, **no se
genera asiento**, igual que en una transferencia; y si los productos no
comparten cuenta de existencias el proceso se planta en vez de descuadrar el
mayor en silencio.

**Lotes y series, hechos.** `/inventario/lotes`. Las columnas existían desde el
principio y nadie las obligaba: un producto marcado «controla lote» se movía sin
lote y la trazabilidad quedaba en una intención. Ahora la comprobación vive en
`registrarMovimiento`, que es por donde pasan todos los módulos —compras,
ventas, notas, kits, importaciones—, y no en cada uno por separado.

Tres reglas que conviene no revertir:

- **No se saca de un lote más de lo que ese lote tiene**, aunque el stock total
  del producto alcance. Sin esto el saldo cuadra y la trazabilidad miente.
- **Un movimiento con serie es de una unidad.** Dos unidades con la misma serie
  no son dos unidades: son un error de captura.
- **El saldo de cada lote se deriva del kardex**, no se guarda aparte. Un saldo
  almacenado en dos sitios acaba siendo dos saldos distintos.

La ficha del lote guarda sólo lo que el kardex no sabe —fabricación y
vencimiento— y la pantalla avisa de lo vencido y de lo que caduca en noventa
días.

**Stock mensual y rotación, hechos.** `/inventario/rotacion`. El stock mensual es
el resumen que un jefe de almacén mira el día 1 —qué había, qué entró, qué salió
y qué queda—; la rotación contesta lo que más plata mueve en un importador:
cuánto tiempo duerme la mercadería antes de venderse, y qué artículos son
capital inmovilizado que en el balance figura como activo. Se mide sobre costos,
no sobre precios, porque mezclarlos infla el resultado por el margen.

Sigue faltando: la columna de referencia en el kardex.

## 4. Contabilidad

Lo que Starsoft tiene y RoultERP no:

| Función | RoultERP |
|---|---|
| Plan de cuentas nacional y extranjero | ⚠️ uno solo, bimonetario por asiento |
| **Formatos configurables** de balance y EEGGPP | ✅ |
| Ratios sobre los formatos | ✅ |
| EEGGPP **por función** (clase 9, asientos de destino) | ✅ |
| Subdiarios configurables | ⚠️ se usan códigos fijos del catálogo 8 |
| Parámetros de integración (cuenta ventas / compras / caja / bancos) | ✅ configurables por empresa |
| Presupuesto por centro de costos y análisis presupuestal | ✅ |
| Cuenta corriente por anexo (movimientos y saldos por anexo / cuenta / documento) | ✅ |
| EEFF por centro de costo | ✅ |
| Liquidación de impuestos mensuales | ✅ |
| Exportación al PDT / PDB | ⚠️ las casillas en CSV; el archivo binario del PDT, no |
| Asiento de apertura del siguiente año | ⚠️ innecesario aquí: los saldos son continuos |
| Mayorizar | ⚠️ innecesario: el mayor es en línea |
| Impresión de comprobante (voucher) | ✅ representación impresa con QR |
| Ingreso rápido de documentos | ❌ |
| Cierre y reapertura mensual | ✅ |
| Cierre del ejercicio | ✅ |
| Ajuste de tipo de cambio | ✅ |
| Conciliación bancaria | ✅ |
| Libros y PLE | ✅ |

**Formatos configurables, hechos.** `/contabilidad/formatos`. Cada empresa nace
con dos plantillas que reproducen exactamente los estados que el programa traía
cableados —hay una prueba que compara cifra por cifra—, y a partir de ahí el
contador las edita o crea las suyas.

Lo que se configura es la **presentación**, nunca la aritmética: hay tres clases
de renglón y ninguna más —título, detalle y total— en vez de un lenguaje de
fórmulas, porque con fórmulas se puede escribir un estado que no cuadre. Un
total sólo puede sumar renglones anteriores; referirse hacia adelante haría que
el orden cambiara los importes.

La salvaguarda que sostiene todo esto: **un formato delata lo que deja fuera**.
Una cuenta con saldo que ningún renglón recoge aparece en la pantalla de estados
con un aviso. Sin eso, configurar una plantilla sería la forma más fácil de
hacer desaparecer dinero de un balance sin que nadie lo note, y una cuenta nueva
del plan desaparecería del informe en silencio.

El cuadre —activo igual a pasivo más patrimonio— se sigue comprobando contra el
mayor y no contra la plantilla: es la verificación de que la contabilidad está
bien, no de que el formato esté bien escrito.

**Presupuesto y análisis presupuestal, hechos.** `/contabilidad/presupuesto`.
Lo que la empresa planea gastar e ingresar, por centro de costo y por mes,
contra lo que dice el mayor. Es lo que convierte el resultado por obra en una
herramienta de gestión: saber que una obra perdió 3 000 dice poco; saber que
perdió 3 000 sobre un plan de ganar 5 000 dice qué hacer.

Cuatro decisiones que sostienen el módulo:

- **Lo ejecutado sale del mayor.** Un presupuesto que se compara contra cifras
  propias no compara nada.
- **Lo gastado fuera de presupuesto se denuncia.** Un análisis que sólo mira las
  partidas presupuestadas deja fuera justo lo que nadie planeó, que suele ser lo
  que más duele.
- **Ingresos y gastos se miden los dos en positivo**, para que «avance»
  signifique lo mismo en los dos casos. Sin eso, un ingreso presupuestado en
  10 000 y cobrado en 12 000 saldría con avance negativo.
- **Una partida anual se reparte en doceavas exactas**, con resto mayor:
  repartir por redondeo dejaría la suma del año descuadrada respecto del total
  que alguien aprobó.

Un presupuesto aprobado deja de editarse —para eso está el estado— pero se puede
reabrir: un plan que no se puede corregir se abandona, y la alternativa a
reabrirlo es que nadie vuelva a mirarlo.

**EEGGPP por función y asiento de destino, hechos.**
`/contabilidad/destino`. El PCGE registra los gastos por naturaleza en la clase
6 —que es lo que exigen los libros— y la vista funcional vive en la clase 9. El
asiento de destino es el puente: carga las cuentas 92, 94, 95 y 97 según unas
reglas y abona la 79 por el total.

Tres propiedades que el módulo garantiza:

- **No cambia el resultado.** La clase 9 y la 79 se anulan entre sí. El balance
  y la utilidad siguen siendo los de antes; lo único que cambia es cómo se
  presenta.
- **No reclasifica dos veces.** Se mide lo ya destinado y sólo se lleva la
  diferencia, así que correrlo de nuevo el mismo mes no duplica nada y es seguro
  dejarlo en manos de quien cierra.
- **Lo que no tiene regla se denuncia.** Un gasto sin destino no se reparte por
  una regla inventada: aparece aparte, y el estado por función se declara
  incompleto mientras quede algo sin destinar. Presentar un estado funcional al
  que le faltan gastos es peor que no presentarlo.

Gana la regla más específica: el centro de costo pesa más que la cuenta, y entre
dos cuentas gana el prefijo más largo. Sin ese orden explícito, el destino
dependería de cómo estén guardadas las filas.

El costo de ventas (69) no se reclasifica: ya está por función.

## 5. Cuentas por cobrar

| Función | RoultERP |
|---|---|
| Estados de cuenta de cliente | ✅ |
| Proyección de cobranzas | ✅ |
| Morosidad de la cartera | ✅ antigüedad por tramos, mora ponderada y límites |
| Canje y renovación de letras | ✅ |
| Refinanciación de letras | ✅ |
| Cheques diferidos y rebotados | ✅ |
| Límites de crédito | ✅ |
| Planillas de cobranza | ✅ |
| Notificaciones a clientes | ❌ |

**Hecho.** `/cxc/estado-cuenta`, `/cxc/proyeccion` y `/cxc/cheques`.

El estado de cuenta lleva una serie por moneda con el saldo corriendo, y trata
la nota de crédito como abono —que es lo que es para la cuenta del cliente— en
vez de como otro comprobante suelto.

La proyección reparte por tramos —vencido, cada semana próxima, más adelante— y
mete **las letras en cartera junto a las facturas**: dejarlas fuera daría una
proyección optimista justo en la empresa que más las usa. Todo se lleva a soles
con el tipo de cambio de cada documento, porque una proyección con dos monedas
sin convertir no se puede sumar.

**Planillas de cobranza.** `/cxc/planillas`. La hoja con la que un cobrador
sale a la calle, o con la que se entregan letras al banco. Reúne facturas y
letras —las dos formas en que un cliente puede deber—, se imprime y se liquida
al volver. No mueve dinero: eso lo sigue haciendo la cobranza.

Dos reglas la sostienen. **Una planilla no toma lo que ya está en otra**: se
ofrece el saldo libre, igual que en la orden de pago, porque dos cobradores con
la misma factura acaban en que no la cobra ninguno. Y **lo cobrado no se apunta,
se mide**: sale del saldo vivo del documento, de modo que si el cliente pagó por
transferencia en vez de al cobrador, la planilla también lo refleja. Cerrarla no
cobra nada: libera lo que quedó pendiente para la siguiente salida.

Los cheques recibidos tienen su propio recorrido —recibido, depositado, cobrado
o rebotado— separado del de los que la empresa gira. Rebotar exige motivo: un
cheque devuelto vuelve a ser deuda, y por eso es un estado y no una observación.

## 6. Cuentas por pagar

| Función | RoultERP |
|---|---|
| Programación de pagos | ✅ |
| Proyección de pagos | ✅ |
| **Autorización de pagos** | ✅ |
| **Orden de pago** (documento) | ✅ |
| Pago con cheque | ✅ |
| Estados de cuenta por proveedor | ✅ |
| Letras: canje, renovación | ✅ |
| Retención de IGV en el pago | ✅ |
| Retención de IGV **en el pago de la letra** | ✅ (el canje no paga nada: la norma retiene al hacerse efectiva) |

**Hecho.** `/cxp/ordenes-pago` y `/cxp/estado-cuenta`.

La orden de pago se arma marcando documentos del proveedor y ofrece el saldo
**libre**, no el total: lo que ya está en otra orden aparece descontado, porque
mostrar el saldo entero cuando la mitad está comprometida es la forma de acabar
pagando dos veces la misma factura. Sólo se paga lo autorizado —la comprobación
está en el servicio, no en la pantalla— y rechazar exige motivo.

El estado de cuenta lleva una serie por moneda con el saldo corriendo, y pone el
documento antes que su pago cuando caen el mismo día: un abono que aparece antes
del cargo deja el saldo en negativo un renglón y quien lo lee cree que se pagó de
más.

## 7. Caja y bancos

| Función | RoultERP |
|---|---|
| Múltiples cajas y bancos, MN y ME | ✅ |
| Caja chica | ✅ |
| Conciliación bancaria | ✅ |
| Arqueo de caja | ✅ |
| **Emisión de recibos** (ingreso / egreso) | ✅ |
| **Impresión de cheque-voucher** | ✅ |
| **Situación de cheques** | ✅ |
| **Rendición de cuentas** | ✅ |
| Libro de bancos | ✅ con contraste contra la cuenta contable |
| Comprobantes de retención | ✅ |

**Hecho.** `/caja-bancos/recibos`, `/caja-bancos/cheques` y
`/caja-bancos/rendiciones`.

El recibo numera y envuelve un movimiento de caja, guarda el importe en letras
—que es lo que impide alterar un papel firmado— y se contabiliza en el acto. El
cheque **no** descuenta el saldo al girarse: el dinero sale cuando el banco lo
carga, que es lo que permite que el libro cuadre contra el extracto; la lista
marca los diferidos y los que llevan más de treinta días sin cobrar, y suma lo
que sigue en circulación. La entrega a rendir sale de caja contra la cuenta 14 y
no contra un gasto: el gasto aparece cuando se rinde, con la fecha del documento
que lo sustenta, que puede ser de otro mes.

## 8. Importaciones

Starsoft organiza todo **por póliza (DUA)**, no por orden:

| Función | RoultERP |
|---|---|
| Orden de importación | ✅ |
| Tipos de orden de importación configurables | ❌ |
| Gastos generales de importación | ✅ |
| **Gastos por póliza** | ✅ |
| **Gasto por póliza consolidada** | ✅ |
| **Liquidación por póliza** | ✅ |
| **Liquidación por agrupación de pólizas** | ✅ |
| Registro y aprobación de documentos de importación | ❌ |
| Partida arancelaria | ✅ se mantiene en la ficha del producto |
| Catálogo de aduanas | ⚠️ las cuatro intendencias usuales, sin mantenimiento |
| Precios históricos del proveedor | ✅ |
| 8 reportes (por proveedor, por artículo, pendientes, llegadas, gastos de agencia…) | ❌ |
| Asiento de provisión y su modificación | ⚠️ el asiento se genera al liquidar |
| Seguimiento del estado | ✅ |
| Valorización del ingreso al almacén | ✅ |

**Hecho.** `/importaciones/polizas`. Una póliza es la DUA: se abre con su
número, su aduana, su régimen, su agente y su tipo de cambio, y se le agrupan
los embarques que ampara. Los gastos que son de la DUA entera —agenciamiento,
almacenaje, flete interno, IGV de importación— se cargan a la póliza, no a un
embarque cualquiera.

El reparto va en dos pasos y los dos son exactos: el gasto se reparte entre los
embarques por la base que le toca (valor FOB, cantidad, peso o volumen) con
resto mayor, y la parte de cada embarque se prorratea dentro de él con la
maquinaria de siempre. Como los dos cuadran al céntimo, el total repartido es el
gasto: no hay deriva. El tipo de cambio de la DUA manda sobre el de cada factura
del exterior, que es lo que hace comparables dos embarques comprados en semanas
distintas.

De paso apareció un defecto de fondo en la liquidación que ya existía: **toda la
deuda se cargaba al proveedor del exterior**, incluida la factura del agente de
aduanas. El agente quedaba con saldo cero y el exportador con la deuda de todos,
así que al pagar no cuadraba ninguno de los dos. Ahora el haber del asiento se
abre por acreedor y se emite un documento por pagar para cada uno.

## 9. Factron

| Función | RoultERP |
|---|---|
| Factura, boleta | ✅ |
| Notas de crédito y débito | ✅ |
| Guías de remisión (GRE) | ✅ |
| Comprobantes de retención y percepción | ✅ |
| Resumen diario y comunicación de baja | ✅ |

Único módulo sin brecha.

---

## Lo que hace falta para cerrar esto de verdad

La lista de arriba sale de los manuales de Starsoft, no del uso que le da
SERVIDIMAR. Antes de construir nada conviene saber **qué usa el cliente**,
porque media lista puede no importarle y otra media puede ser su día a día:

1. **Capturas de pantalla de su Starsoft**, módulo por módulo: el menú abierto y
   una pantalla de cada documento que emiten.
2. **Un ejemplar de cada documento impreso**: orden de compra, pedido, guía,
   recibo, cheque-voucher, estado de cuenta.
3. **Qué opciones del menú usan y cuáles nunca abren.** Lo más rápido es una
   sesión de media hora viendo a su contadora y a su jefe de logística trabajar.
4. **Su numeración**: series y correlativos de cada documento, para arrancar
   donde ellos van y no desde cero.
5. **Un respaldo o una exportación** de su base, aunque sea de una tabla, para
   ver nombres de campo y catálogos propios.

Sin eso, «clon exacto» es una afirmación que no puedo sostener, y prefiero
decirlo antes que darlo por hecho.
