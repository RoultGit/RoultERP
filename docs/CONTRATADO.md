# Lo que el cliente contrató

Fuente: `MODULOS_CLIENTE.md`, en la raíz del proyecto. Es la lista de funciones
por las que SERVIDIMAR paga, y **manda sobre cualquier otra prioridad**: una
función de Starsoft que no esté aquí puede esperar; una que esté aquí tiene que
funcionar bien antes que nada.

Este documento se revisa función por función. `docs/starsoft-brecha.md` compara
contra Starsoft entero, que es un superconjunto de esto.

Estado a 2026-09-11. Todo lo marcado ✅ tiene pantalla, servicio y pruebas.

**Lo que se imprime.** Starsoft se usa con la impresora al lado, así que las
hojas son parte de la función, no un extra: la orden de importación y la de
compra se mandan al proveedor, la guía viaja con la mercadería, el recibo se
firma, y la factura, la boleta y las notas se entregan con su código QR y el
resumen del XML. Las consultas que se archivan —registros de compras y ventas,
antigüedad de saldos, libro de bancos, kardex, estados financieros, estado de
cuenta— llevan su botón de imprimir y salen en papel sin el menú ni los botones.

## 1. Importaciones — S/ 637.20

| Función contratada | Estado | Dónde |
|---|---|---|
| Creación y emisión de órdenes de importación | ✅ | `/importaciones` · hoja en `…/orden` |
| Registro y gestión de proveedores del exterior | ✅ | `/maestros/terceros` (no domiciliado) |
| Registro de productos y precios históricos | ✅ | `/maestros/productos`, `/compras/precios` |
| Seguimiento del estado de cada importación | ✅ | `/importaciones`, `/importaciones/polizas` |
| Registro de gastos relacionados con la importación | ✅ | `/importaciones/[id]` |
| Liquidación de importaciones | ✅ | `/importaciones/[id]` |
| Valorización de la mercadería importada | ✅ | liquidación → kardex y cuenta 20 |
| *Control documental del embarque* (pregunta 17) | ✅ | `/importaciones/[id]`, expediente |
| *Reportes de conjunto* (pregunta 16) | ✅ | `/importaciones/pendientes`, `…/reportes` |

Los precios históricos miran **las compras y los embarques**. Para un importador
eso no es un detalle: mirando sólo las compras locales, la serie de precios de un
artículo salía con dos entradas y parecía que casi no se compra. De la
importación se traen dos cifras distintas y separadas: el **FOB** que cobra el
exportador y el **costo puesto en almacén** que sale de la liquidación, con
flete, derechos y agencia prorrateados. Confundirlos es el camino corto para
creer que importar sale más barato de lo que sale.

## 2. Módulo general — S/ 5,468.68

### Contabilidad

| Función contratada | Estado | Dónde |
|---|---|---|
| Asientos contables | ✅ | `/contabilidad/asiento`, cuentas en `/contabilidad/parametros` |
| Libros y registros | ✅ | `/contabilidad/registros`, `/contabilidad/mayor`, `/contabilidad/ple` |
| Estados financieros | ✅ | `/contabilidad/estados`, `/contabilidad/formatos` |
| PLE | ✅ | 7 formatos, `/api/ple` |
| Impuestos | ✅ | `/contabilidad/impuestos` (+ CSV para el PDT) |
| Conciliación bancaria | ✅ | `/caja-bancos/conciliar` |
| Centros de costo | ✅ | `/contabilidad/centros`, `/contabilidad/presupuesto` |
| Análisis contable | ✅ | `/contabilidad/anexos`, `/contabilidad/ratios` |

### Cuentas por cobrar

| Función contratada | Estado | Dónde |
|---|---|---|
| Control de clientes | ✅ | `/maestros/terceros`, `/cxc` |
| Estados de cuenta | ✅ | `/cxc/estado-cuenta` |
| Vencimientos | ✅ | `/cxc/proyeccion`, `/cxc/morosidad` |
| Cobranzas | ✅ | `/cxc/cobrar`, `/cxc/planillas` |
| Letras | ✅ | canje, renovación, refinanciación, protesto |
| Morosidad | ✅ | `/cxc/morosidad` |
| Límites de crédito | ✅ | por cliente, se comprueba al facturar |
| Proyección de cobranzas | ✅ | `/cxc/proyeccion` |

La antigüedad de saldos reparte en cinco tramos, incluye **las letras en
cartera** —dejarlas fuera daría una cartera sana justo en la empresa que más las
usa— y da la mora media **ponderada por importe**: sin ponderar, una factura
chica muy atrasada pesaría lo mismo que una grande recién vencida y el número
diría lo contrario de lo que pasa.

### Ventas

| Función contratada | Estado | Dónde |
|---|---|---|
| Cotizaciones | ✅ | `/ventas/cotizaciones` |
| Pedidos | ✅ | `/ventas/pedidos` |
| Facturas y boletas | ✅ | `/ventas/nueva` · hoja en `…/impresion` |
| Notas de crédito y débito | ✅ | `/ventas/[id]/nota` |
| Guías | ✅ | `/guias` · hoja en `…/impresion` |

### Cuentas por pagar

| Función contratada | Estado | Dónde |
|---|---|---|
| Control de proveedores | ✅ | `/maestros/terceros`, `/cxp` |
| Obligaciones pendientes | ✅ | `/cxp` |
| Vencimientos | ✅ | `/cxp/egresos` |
| Programación de pagos | ✅ | `/cxp/egresos` |
| Órdenes de pago | ✅ | `/cxp/ordenes-pago` (con autorización) |
| Letras | ✅ | `/cxp/letras` |
| Estados de cuenta | ✅ | `/cxp/estado-cuenta` |

Pagar una letra retiene el IGV cuando la empresa es agente, que es el momento
que manda la norma: no al canjear —ahí no se pagó nada— sino cuando la letra se
hace efectiva. El comprobante de retención acredita **las facturas canjeadas**,
que es lo que el proveedor necesita ver: la letra es la forma de la deuda, no su
origen.

### Inventario

| Función contratada | Estado | Dónde |
|---|---|---|
| Stock por almacén | ✅ | `/inventario` |
| Kardex | ✅ | `/inventario/kardex` (con la columna de referencia) |
| Movimientos | ✅ | `/inventario/notas`, kits, lotes y series |
| Valorización | ✅ | promedio o PEPS, por empresa |
| Control de existencias | ✅ | `/inventario/rotacion` |

### Compras

| Función contratada | Estado | Dónde |
|---|---|---|
| Cotizaciones | ✅ | `/compras/cotizaciones` (+ cuadro comparativo) |
| Órdenes de compra | ✅ | `/compras/ordenes/nueva` · hoja en `…/impresion` |
| Proveedores | ✅ | `/maestros/terceros` |
| Precios históricos | ✅ | `/compras/precios` |
| Registro de compras | ✅ | `/compras/nueva` |
| *Carga en serie* (pregunta 15: 250 facturas/mes) | ✅ | `/compras/lote` |
| Valorización de ingresos al almacén | ✅ | kardex al registrar la compra |

### Caja y bancos

| Función contratada | Estado | Dónde |
|---|---|---|
| Caja chica | ✅ | fondo fijo, `/caja-bancos/rendiciones` |
| Bancos | ✅ | `/caja-bancos` |
| Movimientos | ✅ | `/caja-bancos/[id]` |
| Conciliación bancaria | ✅ | `/caja-bancos/conciliar` |
| Cheques | ✅ | girados y recibidos, con sus estados · cheque-voucher imprimible |
| Arqueos | ✅ | `/caja-bancos/[id]` |
| Recibos | ✅ | `/caja-bancos/recibos` · hoja por recibo |
| Control de cuentas bancarias | ✅ | `/caja-bancos/libro` |

El libro de bancos se contrasta contra la cuenta contable de la cuenta. El libro
sale de los movimientos y el mayor de los asientos: son dos caminos para el mismo
dinero, y si no coinciden hay un movimiento sin asiento o un asiento sin
movimiento. Conviene enterarse ahí y no tres meses después al cerrar.

## 3. Factron — US$ 377.60

| Función contratada | Estado |
|---|---|
| Emisión electrónica de facturas | ✅ con su representación impresa |
| Boletas | ✅ (con resumen diario) |
| Notas de crédito y débito | ✅ |
| Guías de remisión | ✅ |

Firma XAdES-BES con el certificado de la empresa, envío por `sendBill`, lectura
del CDR y reintento. Las bajas y los resúmenes van por ticket.

## 4. Añadido a petición del cliente — fuera del contrato original

El documento de respuestas al cuestionario pidió, en sus observaciones, cuatro
cosas que **no figuran en `MODULOS_CLIENTE.md`** y por tanto no están cubiertas
por los S/ 6 105.88 + US$ 377.60 contratados. Se construyeron a pedido expreso;
queda por acordar su precio.

| Función pedida | Estado | Dónde |
|---|---|---|
| Planillas quincenales (PLL) | ✅ | `/planillas`, tipo mensual con quincena |
| Gratificaciones (julio y diciembre) | ✅ | `/planillas`, tipo gratificación |
| CTS (mayo y noviembre) | ✅ | `/planillas`, tipo CTS |
| Liquidación automática al dar de baja | ✅ | `/rrhh/[id]` → cesar y liquidar |
| Aviso de vencimiento de contratos | ✅ | `/rrhh/contratos` |
| Historial de remuneraciones | ✅ | `/rrhh/[id]` |

La decisión que ordena el módulo: **la gratificación, la CTS y la liquidación
son planillas**, no tablas aparte. Las cuatro reúnen trabajadores, calculan
conceptos, dejan un asiento y un pago; separarlas habría duplicado cabecera,
detalle, cierre, extorno y pantallas por cuatro. Lo único que cambia es el tipo.

**Lo que hay que capturar antes de usarlo en producción.** El cliente pidió
«mantener las mismas fórmulas y criterios de cálculo que se vienen utilizando
actualmente». Lo construido son las fórmulas **de la ley**: RMV, UIT, ONP 13 %,
tasas de AFP de la SBS, EsSalud 9 %, asignación familiar, quinta categoría por
proyección, gratificación con la bonificación de la Ley 30334, CTS con el sexto
de gratificación en la computable. Todo ello es editable por empresa y con fecha
de vigencia, en `/planillas/configuracion`. Comparar una planilla real de
SERVIDIMAR contra la que calcula el sistema —un mes, trabajador por trabajador—
es lo único que convierte «calcula lo que dice la ley» en «calcula lo que ellos
calculan». Esa media jornada está pendiente, igual que la de la contadora.

**Lo que no incluye y hay que decidir:** la PLAME (el archivo que se declara),
el T-Registro, el registro de asistencia y control de horas, vacaciones como
proceso (solicitud, aprobación, goce), y el SCTR más allá de un importe tecleado.

## Lo que falta y no es programación

Nada de la lista contratada está sin construir. Lo que queda no se resuelve
escribiendo código:

1. **Homologación en SUNAT** con el certificado real de SERVIDIMAR, en beta y
   después en producción. Hasta hacerla, la facturación electrónica está probada
   contra respuestas simuladas, no contra SUNAT.
2. **Validar los siete archivos del PLE** con el aplicativo de SUNAT. La
   estructura está tomada del anexo oficial y hay pruebas de formato, pero el
   único juez es el validador.
3. **Las series y correlativos reales** que usa hoy la empresa, para continuarlos
   y no empezar de cero.
4. **Los saldos de apertura.** El cliente eligió la opción b —traer sólo los
   saldos del día del cambio—, y la pantalla que los carga ya está en
   `/maestros/apertura`. Lo que queda es el trabajo de sacar las tres hojas de
   Starsoft y elegir la fecha de corte.
5. **Ver trabajar a su contadora y a su jefe de logística** media jornada. Es lo
   único que convierte «tiene las mismas funciones» en «es el mismo flujo»:
   qué campos llenan, cuáles ignoran y en qué orden hacen las cosas.
