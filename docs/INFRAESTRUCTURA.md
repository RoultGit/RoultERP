# Infraestructura

Qué hace falta para que esto corra en la nube, cuánto cuesta y cuándo hay que
cambiar de escalón. Decidido para AWS.

## Qué exige el sistema

La arquitectura decide la infraestructura, no al revés. Estas cinco
propiedades son las que mandan:

| Propiedad | Consecuencia |
|---|---|
| **Cómputo sin estado.** No escribe nada en disco; la sesión vive en la base | Se puede mover de máquina, correr dos copias y reemplazarlas sin migrar archivos. No hace falta disco compartido |
| **Cada transacción hace `SET LOCAL ROLE` y fija la empresa** | Si se usa un *pooler*, tiene que ser en **modo transacción**. Ya está previsto (`prepare: false`) |
| **Multiempresa por RLS.** 94 de 95 tablas con aislamiento en Postgres | Un cliente nuevo es una fila en `empresas`, no otro despliegue ni otra base |
| **Llamadas a SUNAT de hasta 60 s** | Están fuera de la petición desde que existe la cola (`/api/cola`). Deja de ser una restricción para elegir servicio |
| **Sin colas ni tareas propias** | No hace falta SQS ni contenedores aparte. La cola de SUNAT es la propia tabla de comprobantes |

## Volumen real

Medido sobre la base de desarrollo y proyectado con lo que declaró el cliente
(250 facturas de compra al mes):

```
  memoria de la aplicación en marcha     127 MB
  imagen del contenedor                  366 MB
  arranque                                78 ms
  base con un año de datos                18 MB
  proyección a 5 años                435 000 filas  (~2 GB con índices)
```

Para Postgres esto es una base pequeña: la tabla más grande cabe entera en
memoria. **El rendimiento no es la restricción de este proyecto**, y por eso
ninguna decisión de infraestructura debería tomarse pensando en él.

## Los tres escalones

| Clientes | Qué usar | Costo/mes | Por qué se cambia |
|---|---|---|---|
| **1–2** | Una EC2 con Postgres en la misma máquina | ~60 soles | — |
| **3–10** | EC2 + **RDS aparte** | ~110 soles | Los respaldos |
| **10+** | App Runner + RDS | ~206 soles | Dejar de ser el que reinicia de madrugada |

Una `t4g.small` aguanta técnicamente **30 o 40 clientes**. El límite nunca va
a ser la máquina.

### El único cambio que urge: sacar la base a RDS

Llega al tercer cliente y **no es por rendimiento**. Postgres en la misma
máquina significa que si esa máquina se corrompe se pierde la contabilidad de
tres empresas a la vez. RDS trae respaldos automáticos y recuperación a un
punto en el tiempo; son unos 50 soles y es el seguro más barato del proyecto.

### El paso a App Runner se puede posponer

Es comodidad, no necesidad. Lo que se compra por esos ~150 soles de diferencia
es: certificado HTTPS gestionado, parches del sistema operativo, y que si la
máquina muere la reemplace la plataforma en vez de una persona. Con un cliente
no compensa; con diez empresas dependiendo del sistema, sí.

**El argumento que *no* vale para elegir App Runner** es el tope de tiempo de
las peticiones. Lo tenía cuando el envío a SUNAT ocurría dentro de la petición;
desde que existe la cola, ya no. EC2 además no tiene ningún tope.

## Desglose del escalón 1 (el de la prueba)

| Concepto | USD | Soles |
|---|---|---|
| EC2 `t4g.small` (2 vCPU, 2 GB) | $12 | 45 |
| Disco gp3 de 20 GB | $1.6 | 6 |
| IP fija | $3.6 | 14 |
| Transferencia | ~$1 | 4 |
| **Total** | **~$18** | **~69** |

**Con capa gratuita puede salir en cero.** AWS cambió el modelo en 2025: las
cuentas antiguas tienen los 12 meses clásicos (750 h de EC2 al mes), las
nuevas reciben créditos con caducidad. Hay que mirar cuál aplica antes de
elegir el tamaño.

No incluido: el dominio, unos 50 soles al año.

## Región

**`us-east-1`**. Es entre un 30 % y un 40 % más barata que `sa-east-1`
(São Paulo) y la diferencia de latencia desde Lima es de unos 20 ms, que en un
ERP no se nota. São Paulo sólo tendría sentido si hubiera una exigencia legal
de mantener los datos en la región, y no la hay.

## Lo que no se puede ahorrar

**El respaldo de la clave maestra.** Cifra el certificado digital, las
credenciales SOL y los segundos factores. Va en las variables de entorno del
servidor y una copia en un gestor de contraseñas — **nunca en el mismo sitio
que los respaldos de la base**, porque juntos el cifrado no protege de nada.

Perderla no es catastrófico si los originales existen fuera (el `.pfx` está en
el correo de quien lo tramitó), pero obliga a volver a cargarlo todo.
