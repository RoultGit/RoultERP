/**
 * Kardex valorizado por producto y almacén.
 *
 * Dos métodos, los dos que usa el mercado peruano: promedio ponderado móvil y
 * PEPS. UEPS no está: la NIC 2 lo prohíbe y SUNAT no lo acepta para efectos
 * tributarios, así que implementarlo sería trabajo para producir un resultado
 * que nadie puede declarar.
 *
 * El módulo es un reductor puro: entra un estado y un movimiento, sale un
 * estado nuevo y la línea del kardex. No sabe de base de datos, lo que permite
 * recalcular un ejercicio entero en memoria y compararlo contra lo almacenado.
 *
 * La valorización se lleva por `(producto, almacén)` porque el formato 13.1 del
 * PLE exige el detalle por establecimiento.
 */
import {
  type Dec, add, sub, mul, div, round, ZERO, gt, gte, lt, isZero, eq, cmp,
} from "../money.ts";

export type MetodoValorizacion = "promedio" | "peps";

/** Catálogo 12 de SUNAT: tipo de operación del kardex. */
export const TIPO_OPERACION = {
  COMPRA: "02",
  VENTA: "01",
  DEVOLUCION_RECIBIDA: "03",
  DEVOLUCION_ENTREGADA: "04",
  TRANSFERENCIA_ENTRADA: "05",
  TRANSFERENCIA_SALIDA: "06",
  CONSUMO: "10",
  AJUSTE_ENTRADA: "16",
  AJUSTE_SALIDA: "17",
  SALDO_INICIAL: "00",
} as const;
export type TipoOperacion = (typeof TIPO_OPERACION)[keyof typeof TIPO_OPERACION];

export type Movimiento = {
  /** Identificador estable del movimiento, para trazar la línea a su origen. */
  id: string;
  fecha: Date;
  sentido: "ingreso" | "salida";
  tipoOperacion: TipoOperacion;
  cantidad: Dec;
  /**
   * Costo unitario del ingreso. Obligatorio al ingresar, ignorado al salir:
   * el costo de salida lo determina el método, nunca el usuario.
   */
  costoUnitario?: Dec;
  /** Documento que sustenta el movimiento, para el PLE. */
  documento?: { tipo: string; serie: string; numero: string };
};

/** Una capa de costo del PEPS: lo que quedó de un ingreso concreto. */
export type Capa = {
  movimientoId: string;
  fecha: Date;
  cantidad: Dec;
  costoUnitario: Dec;
};

export type EstadoKardex = {
  cantidad: Dec;
  /** Valor total del saldo. Es la cifra que cuadra contra la cuenta 20/21. */
  valor: Dec;
  /** Sólo se usa en PEPS; vacío en promedio. */
  capas: readonly Capa[];
};

export const estadoInicial = (): EstadoKardex => ({
  cantidad: ZERO,
  valor: ZERO,
  capas: [],
});

/** Costo unitario del saldo. Cero cuando no hay stock, para no dividir por cero. */
export const costoPromedio = (e: EstadoKardex): Dec =>
  isZero(e.cantidad) ? ZERO : round(div(e.valor, e.cantidad), 6);

/** Consumo de una capa concreta. Una salida PEPS puede tocar varias. */
export type Consumo = { cantidad: Dec; costoUnitario: Dec; importe: Dec };

export type LineaKardex = {
  movimiento: Movimiento;
  entrada: { cantidad: Dec; costoUnitario: Dec; importe: Dec } | null;
  salida: { cantidad: Dec; costoUnitario: Dec; importe: Dec } | null;
  /**
   * Desglose de la salida por capa de costo. En promedio siempre trae un solo
   * elemento; en PEPS trae uno por capa consumida, que es como el formato 13.1
   * espera ver el detalle.
   */
  consumos: readonly Consumo[];
  saldo: { cantidad: Dec; costoUnitario: Dec; importe: Dec };
};

export class StockInsuficiente extends Error {
  constructor(
    readonly disponible: Dec,
    readonly solicitado: Dec,
  ) {
    super("stock insuficiente para la salida");
    this.name = "StockInsuficiente";
  }
}

export class MovimientoInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "MovimientoInvalido";
  }
}

export type OpcionesKardex = {
  metodo: MetodoValorizacion;
  /**
   * Permitir que el saldo quede negativo. Por defecto no: un stock negativo
   * corrompe la valorización y suele ser un error de captura, no un hecho. Las
   * empresas que facturan antes de registrar la compra lo activan a sabiendas.
   */
  permitirNegativo?: boolean;
};

/**
 * Aplica un movimiento y devuelve el estado resultante junto con la línea del
 * kardex.
 *
 * No muta el estado recibido: recalcular es reproducir la secuencia desde el
 * saldo inicial, y eso exige que cada paso sea independiente del anterior.
 */
export function aplicar(
  estado: EstadoKardex,
  mov: Movimiento,
  opts: OpcionesKardex,
): { estado: EstadoKardex; linea: LineaKardex } {
  if (lt(mov.cantidad, ZERO)) {
    throw new MovimientoInvalido("la cantidad de un movimiento no puede ser negativa");
  }
  if (isZero(mov.cantidad)) {
    throw new MovimientoInvalido("un movimiento de cantidad cero no tiene efecto");
  }
  return mov.sentido === "ingreso"
    ? ingresar(estado, mov, opts)
    : salir(estado, mov, opts);
}

function ingresar(
  estado: EstadoKardex,
  mov: Movimiento,
  opts: OpcionesKardex,
): { estado: EstadoKardex; linea: LineaKardex } {
  const costo = mov.costoUnitario;
  if (costo === undefined) {
    throw new MovimientoInvalido("un ingreso necesita costo unitario");
  }
  if (lt(costo, ZERO)) {
    throw new MovimientoInvalido("el costo unitario no puede ser negativo");
  }

  const importe = round(mul(mov.cantidad, costo), 6);
  const cantidad = add(estado.cantidad, mov.cantidad);
  const valor = add(estado.valor, importe);

  const capas =
    opts.metodo === "peps"
      ? [
          ...estado.capas,
          { movimientoId: mov.id, fecha: mov.fecha, cantidad: mov.cantidad, costoUnitario: costo },
        ]
      : [];

  const nuevo: EstadoKardex = { cantidad, valor, capas };
  return {
    estado: nuevo,
    linea: {
      movimiento: mov,
      entrada: { cantidad: mov.cantidad, costoUnitario: costo, importe },
      salida: null,
      consumos: [],
      saldo: resumen(nuevo),
    },
  };
}

function salir(
  estado: EstadoKardex,
  mov: Movimiento,
  opts: OpcionesKardex,
): { estado: EstadoKardex; linea: LineaKardex } {
  if (!opts.permitirNegativo && gt(mov.cantidad, estado.cantidad)) {
    throw new StockInsuficiente(estado.cantidad, mov.cantidad);
  }

  const consumos =
    opts.metodo === "peps"
      ? consumirCapas(estado.capas, mov.cantidad, estado)
      : [consumoPromedio(estado, mov.cantidad)];

  const importe = consumos.reduce<Dec>((a, c) => add(a, c.importe), ZERO);
  const cantidad = sub(estado.cantidad, mov.cantidad);
  const valor = sub(estado.valor, importe);

  const capas = opts.metodo === "peps" ? descontarCapas(estado.capas, mov.cantidad) : [];

  const nuevo: EstadoKardex = {
    cantidad,
    // Si el saldo queda en cero, el valor también: arrastrar céntimos sobre un
    // saldo cero es el origen clásico del descuadre entre kardex y contabilidad.
    valor: isZero(cantidad) ? ZERO : valor,
    capas,
  };

  const costoUnitario = isZero(mov.cantidad) ? ZERO : round(div(importe, mov.cantidad), 6);

  return {
    estado: nuevo,
    linea: {
      movimiento: mov,
      entrada: null,
      salida: { cantidad: mov.cantidad, costoUnitario, importe },
      consumos,
      saldo: resumen(nuevo),
    },
  };
}

function consumoPromedio(estado: EstadoKardex, cantidad: Dec): Consumo {
  const costoUnitario = costoPromedio(estado);
  return { cantidad, costoUnitario, importe: round(mul(cantidad, costoUnitario), 6) };
}

/**
 * Consume capas de la más antigua a la más nueva.
 *
 * Si las capas no alcanzan (sólo posible con `permitirNegativo`), el faltante
 * se valoriza al costo de la última capa conocida, o al promedio si no hay
 * ninguna. Es una convención: no existe un costo «correcto» para mercadería
 * que salió antes de entrar, y esta al menos es estable y auditable.
 */
function consumirCapas(capas: readonly Capa[], cantidad: Dec, estado: EstadoKardex): Consumo[] {
  const out: Consumo[] = [];
  let restante = cantidad;

  for (const capa of ordenarCapas(capas)) {
    if (!gt(restante, ZERO)) break;
    const toma = gte(capa.cantidad, restante) ? restante : capa.cantidad;
    out.push({
      cantidad: toma,
      costoUnitario: capa.costoUnitario,
      importe: round(mul(toma, capa.costoUnitario), 6),
    });
    restante = sub(restante, toma);
  }

  if (gt(restante, ZERO)) {
    const ultima = ordenarCapas(capas).at(-1);
    const costo = ultima ? ultima.costoUnitario : costoPromedio(estado);
    out.push({
      cantidad: restante,
      costoUnitario: costo,
      importe: round(mul(restante, costo), 6),
    });
  }
  return out;
}

function descontarCapas(capas: readonly Capa[], cantidad: Dec): Capa[] {
  const out: Capa[] = [];
  let restante = cantidad;
  for (const capa of ordenarCapas(capas)) {
    if (!gt(restante, ZERO)) {
      out.push(capa);
      continue;
    }
    if (gte(capa.cantidad, restante)) {
      const queda = sub(capa.cantidad, restante);
      restante = ZERO;
      if (gt(queda, ZERO)) out.push({ ...capa, cantidad: queda });
    } else {
      restante = sub(restante, capa.cantidad);
    }
  }
  return out;
}

/**
 * Orden PEPS: por fecha y, a igualdad de fecha, por el orden en que llegaron.
 * Dos ingresos del mismo día tienen que consumirse en el orden en que se
 * registraron, o el recálculo no reproduce el kardex original.
 */
const ordenarCapas = (capas: readonly Capa[]): Capa[] =>
  [...capas]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.fecha.getTime() - b.c.fecha.getTime() || a.i - b.i)
    .map((x) => x.c);

const resumen = (e: EstadoKardex) => ({
  cantidad: e.cantidad,
  costoUnitario: costoPromedio(e),
  importe: round(e.valor, 6),
});

/**
 * Construye el kardex completo de un periodo.
 *
 * Los movimientos se ordenan por fecha y, a igualdad, por su orden de entrada;
 * no se confía en que lleguen ordenados desde la base.
 */
export function construir(
  movimientos: readonly Movimiento[],
  opts: OpcionesKardex,
  desde: EstadoKardex = estadoInicial(),
): { lineas: LineaKardex[]; estado: EstadoKardex } {
  const ordenados = [...movimientos]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.fecha.getTime() - b.m.fecha.getTime() || a.i - b.i)
    .map((x) => x.m);

  const lineas: LineaKardex[] = [];
  let estado = desde;
  for (const mov of ordenados) {
    const r = aplicar(estado, mov, opts);
    estado = r.estado;
    lineas.push(r.linea);
  }
  return { lineas, estado };
}

/**
 * Comprueba que el kardex cuadra: saldo = entradas − salidas, en cantidad y en
 * valor. Es la verificación que se corre antes de cerrar un mes; si falla, hay
 * un movimiento que no pasó por el reductor.
 */
export function cuadra(
  lineas: readonly LineaKardex[],
  inicial: EstadoKardex = estadoInicial(),
): boolean {
  const final = lineas.at(-1);
  // Sin movimientos no hay nada que descuadrar.
  if (!final) return true;

  let cant = inicial.cantidad;
  let val = inicial.valor;
  for (const l of lineas) {
    if (l.entrada) {
      cant = add(cant, l.entrada.cantidad);
      val = add(val, l.entrada.importe);
    }
    if (l.salida) {
      cant = sub(cant, l.salida.cantidad);
      val = sub(val, l.salida.importe);
    }
  }
  if (isZero(cant)) val = ZERO;
  return eq(cant, final.saldo.cantidad) && cmp(round(val, 6), final.saldo.importe) === 0;
}

/** Valorización de un conjunto de saldos, para el reporte de existencias. */
export const valorTotal = (estados: readonly EstadoKardex[]): Dec =>
  estados.reduce<Dec>((a, e) => add(a, e.valor), ZERO);
