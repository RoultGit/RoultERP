/**
 * Cuentas de integración: qué cuenta contable usa cada operación automática.
 *
 * Cuando se registra una venta, alguien tiene que decidir que el cliente va a
 * la 1212, el IGV a la 40111 y la venta a la 70111. Hasta aquí esa decisión
 * estaba escrita dentro del programa. Son las cuentas del plan general y sirven
 * para la mayoría, pero cada contador arma el suyo —divisionarias por línea de
 * negocio, por moneda, por local— y con las cuentas fijas adaptarse a una
 * empresa exigía tocar el código.
 *
 * Dos decisiones que sostienen el módulo:
 *
 * - **Sólo se guarda lo que la empresa cambió.** El catálogo de aquí abajo es
 *   el valor de partida; la tabla guarda las excepciones. Así una empresa
 *   creada hace un año y una creada hoy se comportan igual, y no hay que
 *   sembrar nada ni recordar sincronizar a nadie.
 * - **La cuenta se comprueba contra el plan de la empresa.** Apuntar a una
 *   cuenta que no existe, o a una que no admite movimiento, rompería el primer
 *   asiento que la use: es mejor rechazarlo al configurar, cuando quien está
 *   delante sabe lo que quería poner.
 */
import { eq, inArray } from "drizzle-orm";
import { schema as s, type Db } from "@roulterp/db";
import { ErrorDeNegocio } from "@roulterp/core";

const { parametrosContables, planCuentas } = s;

export class ParametroInvalido extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "ParametroInvalido");
  }
}

export type ParametroContable = {
  clave: string;
  /** Cómo se llama para quien lo configura. */
  nombre: string;
  /** Cuándo la usa el programa. */
  descripcion: string;
  /** Grupo con el que se presenta. */
  modulo: string;
  /** La del plan general, que es la que se usa mientras nadie la cambie. */
  porDefecto: string;
};

/**
 * El catálogo.
 *
 * Cada entrada es una decisión que el programa toma solo al contabilizar. Lo
 * que **no** está aquí es porque ya se elige en otro sitio: la cuenta de cada
 * caja o banco vive en su ficha, la contrapartida de un gasto la escoge quien
 * registra el movimiento, y las cuentas de la clase 9 salen de las reglas del
 * asiento de destino.
 */
export const PARAMETROS_CONTABLES: readonly ParametroContable[] = [
  // ── Ventas ───────────────────────────────────────────────────────────
  {
    clave: "clientes",
    nombre: "Cuentas por cobrar comerciales",
    descripcion: "Se carga al emitir una factura o boleta y se abona al cobrarla.",
    modulo: "Ventas",
    porDefecto: "1212",
  },
  {
    clave: "ventas_mercaderia",
    nombre: "Ventas",
    descripcion: "El ingreso de cada comprobante emitido.",
    modulo: "Ventas",
    porDefecto: "70111",
  },
  {
    clave: "ventas_devoluciones",
    nombre: "Devoluciones sobre ventas",
    descripcion: "Lo que revierte una nota de crédito.",
    modulo: "Ventas",
    porDefecto: "70911",
  },
  {
    clave: "igv_ventas",
    nombre: "IGV por pagar",
    descripcion: "El IGV que se cobra en cada venta.",
    modulo: "Ventas",
    porDefecto: "40111",
  },
  {
    clave: "costo_ventas",
    nombre: "Costo de ventas",
    descripcion: "El costo de la mercadería que sale del almacén al vender.",
    modulo: "Ventas",
    porDefecto: "69111",
  },

  // ── Compras e inventario ─────────────────────────────────────────────
  {
    clave: "existencias",
    nombre: "Mercaderías",
    descripcion:
      "El almacén. Se carga al comprar o al liquidar una importación y se abona al vender.",
    modulo: "Compras e inventario",
    porDefecto: "20111",
  },
  {
    clave: "igv_compras",
    nombre: "IGV crédito fiscal",
    descripcion: "El IGV de las compras y de las importaciones.",
    modulo: "Compras e inventario",
    porDefecto: "40111",
  },
  {
    clave: "proveedores",
    nombre: "Cuentas por pagar comerciales",
    descripcion: "Se abona al registrar la factura del proveedor y se carga al pagarla.",
    modulo: "Compras e inventario",
    porDefecto: "4212",
  },

  // ── Tesorería ────────────────────────────────────────────────────────
  {
    clave: "retencion_igv",
    nombre: "Retenciones de IGV por pagar",
    descripcion: "Lo retenido al proveedor cuando la empresa es agente de retención.",
    modulo: "Tesorería",
    porDefecto: "40114",
  },
  {
    clave: "caja_por_defecto",
    nombre: "Caja",
    descripcion: "De dónde sale el dinero cuando no se indica una cuenta concreta.",
    modulo: "Tesorería",
    porDefecto: "1011",
  },
  {
    clave: "banco_por_defecto",
    nombre: "Bancos",
    descripcion:
      "La cuenta de bancos que se usa cuando la operación no dice de qué cuenta sale: el pago de una letra o los gastos de un protesto.",
    modulo: "Tesorería",
    porDefecto: "1041",
  },
  {
    clave: "gastos_bancarios",
    nombre: "Gastos y comisiones bancarias",
    descripcion: "Los gastos que cobra el banco, como el protesto de una letra.",
    modulo: "Tesorería",
    porDefecto: "6373",
  },
  {
    clave: "sobrante_caja",
    nombre: "Sobrante de caja",
    descripcion: "Se abona cuando el arqueo encuentra más dinero del que debía haber.",
    modulo: "Tesorería",
    porDefecto: "759",
  },
  {
    clave: "faltante_caja",
    nombre: "Faltante de caja",
    descripcion: "Se carga cuando el arqueo encuentra menos dinero del que debía haber.",
    modulo: "Tesorería",
    porDefecto: "6592",
  },

  // ── Letras ───────────────────────────────────────────────────────────
  {
    clave: "letras_por_pagar",
    nombre: "Letras por pagar no vencidas",
    descripcion: "Donde vive la deuda cuando la factura del proveedor se canjea por una letra.",
    modulo: "Letras",
    porDefecto: "4231",
  },
  {
    clave: "letras_por_pagar_vencidas",
    nombre: "Letras por pagar vencidas",
    descripcion: "Donde pasa la letra cuando se protesta.",
    modulo: "Letras",
    porDefecto: "4232",
  },
  {
    clave: "letras_por_cobrar_vencidas",
    nombre: "Letras por cobrar vencidas",
    descripcion: "Donde pasa la letra del cliente cuando se protesta.",
    modulo: "Letras",
    porDefecto: "1234",
  },
  {
    clave: "letras_por_cobrar",
    nombre: "Letras por cobrar en cartera",
    descripcion: "Donde vive la deuda del cliente cuando su factura se canjea por una letra.",
    modulo: "Letras",
    porDefecto: "1232",
  },
  {
    clave: "intereses_gasto",
    nombre: "Intereses pagados",
    descripcion: "Los intereses de una letra propia que se renueva o se refinancia.",
    modulo: "Letras",
    porDefecto: "6711",
  },
  {
    clave: "intereses_ingreso",
    nombre: "Intereses ganados",
    descripcion: "Los intereses que se le cobran al cliente al renovar su letra.",
    modulo: "Letras",
    porDefecto: "7721",
  },

  // ── Resultado ────────────────────────────────────────────────────────
  {
    clave: "ganancia_cambio",
    nombre: "Ganancia por diferencia de cambio",
    descripcion: "Cuando el tipo de cambio mueve a favor una deuda o una cobranza en moneda.",
    modulo: "Resultado",
    porDefecto: "776",
  },
  {
    clave: "perdida_cambio",
    nombre: "Pérdida por diferencia de cambio",
    descripcion: "Cuando el tipo de cambio mueve en contra.",
    modulo: "Resultado",
    porDefecto: "676",
  },
  {
    clave: "utilidad_ejercicio",
    nombre: "Utilidad del ejercicio",
    descripcion: "Donde se acumula el resultado al cerrar el año.",
    modulo: "Resultado",
    porDefecto: "5911",
  },
  {
    clave: "perdida_ejercicio",
    nombre: "Pérdida del ejercicio",
    descripcion: "Ídem, cuando el ejercicio cierra en pérdida.",
    modulo: "Resultado",
    porDefecto: "5921",
  },
  {
    clave: "apertura_contrapartida",
    nombre: "Contrapartida de los saldos de apertura",
    descripcion:
      "Contra qué cuadra el asiento con el que se traen los saldos del sistema " +
      "anterior. No es una operación del ejercicio: es el patrimonio con el que " +
      "la empresa empieza en este sistema.",
    modulo: "Resultado",
    porDefecto: "5911",
  },
] as const;

const POR_DEFECTO = new Map(PARAMETROS_CONTABLES.map((p) => [p.clave, p.porDefecto]));

/** Las claves, con el tipo estrecho para que un error de dedo no compile. */
export type ClaveContable = (typeof PARAMETROS_CONTABLES)[number]["clave"];

/**
 * Las cuentas que usa esta empresa.
 *
 * Se resuelve una vez por operación y se pasa al armador del asiento. Leerla
 * dentro de cada línea sería una consulta por línea, y además abriría la puerta
 * a que dos líneas del mismo asiento usaran valores distintos si alguien
 * cambiara la configuración en medio.
 */
export class Cuentas {
  constructor(private readonly propias: Map<string, string>) {}

  get(clave: ClaveContable): string {
    const propia = this.propias.get(clave);
    if (propia) return propia;
    const porDefecto = POR_DEFECTO.get(clave);
    // Un catálogo sin la clave es un error de programación, no de datos: mejor
    // que reviente aquí que armar un asiento contra una cuenta vacía.
    if (!porDefecto) throw new Error(`parámetro contable desconocido: ${clave}`);
    return porDefecto;
  }
}

export async function cuentasDe(db: Db): Promise<Cuentas> {
  const filas = await db
    .select({ clave: parametrosContables.clave, cuenta: parametrosContables.cuenta })
    .from(parametrosContables);
  return new Cuentas(new Map(filas.map((f) => [f.clave, f.cuenta])));
}

export type ParametroConfigurado = ParametroContable & {
  /** La que usa hoy la empresa. */
  cuenta: string;
  /** Si la cambió alguien o sigue siendo la de partida. */
  personalizada: boolean;
  /** Descripción de la cuenta en el plan, o null si la cuenta ya no existe. */
  descripcionCuenta: string | null;
};

export async function listarParametrosContables(db: Db): Promise<ParametroConfigurado[]> {
  const propias = new Map(
    (
      await db
        .select({ clave: parametrosContables.clave, cuenta: parametrosContables.cuenta })
        .from(parametrosContables)
    ).map((f) => [f.clave, f.cuenta]),
  );

  const usadas = PARAMETROS_CONTABLES.map((p) => propias.get(p.clave) ?? p.porDefecto);
  const plan = new Map(
    (
      await db
        .select({ cuenta: planCuentas.cuenta, descripcion: planCuentas.descripcion })
        .from(planCuentas)
        .where(inArray(planCuentas.cuenta, usadas))
    ).map((c) => [c.cuenta, c.descripcion]),
  );

  return PARAMETROS_CONTABLES.map((p) => {
    const cuenta = propias.get(p.clave) ?? p.porDefecto;
    return {
      ...p,
      cuenta,
      personalizada: propias.has(p.clave),
      descripcionCuenta: plan.get(cuenta) ?? null,
    };
  });
}

/**
 * Cambia las cuentas de integración.
 *
 * Cada cuenta se comprueba contra el plan de la empresa: que exista y que
 * admita movimiento. Una cuenta de nivel superior —la 42 en vez de la 4212—
 * parece razonable al escribirla y rompe el primer asiento que la use, cuando
 * ya no está delante quien la puso.
 *
 * Poner de nuevo la cuenta de partida borra la excepción en lugar de guardarla:
 * así la empresa vuelve a seguir al catálogo si el día de mañana cambia.
 */
export async function guardarParametrosContables(
  db: Db,
  empresaId: string,
  usuarioId: string,
  cambios: Record<string, string>,
): Promise<{ guardados: number }> {
  const motivos: string[] = [];
  const entradas = Object.entries(cambios)
    .map(([clave, cuenta]) => [clave, cuenta.trim()] as const)
    .filter(([, cuenta]) => cuenta !== "");

  for (const [clave] of entradas) {
    if (!POR_DEFECTO.has(clave)) motivos.push(`el parámetro ${clave} no existe`);
  }
  if (motivos.length) throw new ParametroInvalido(motivos);

  const cuentas = [...new Set(entradas.map(([, c]) => c))];
  const plan = cuentas.length
    ? await db
        .select({
          cuenta: planCuentas.cuenta,
          descripcion: planCuentas.descripcion,
          esMovimiento: planCuentas.esMovimiento,
        })
        .from(planCuentas)
        .where(inArray(planCuentas.cuenta, cuentas))
    : [];
  const existentes = new Map(plan.map((c) => [c.cuenta, c]));

  for (const [clave, cuenta] of entradas) {
    const nombre = PARAMETROS_CONTABLES.find((p) => p.clave === clave)!.nombre;
    const enPlan = existentes.get(cuenta);
    if (!enPlan) {
      motivos.push(`${nombre}: la cuenta ${cuenta} no está en el plan de la empresa`);
      continue;
    }
    /*
     * Quien decide si una cuenta recibe asientos es el plan, no su largo.
     *
     * Contar dígitos parecía razonable —la 4212 es divisionaria, la 42 no— y
     * era falso: en el PCGE la 759, la 776 y la 676 tienen tres dígitos y
     * admiten movimiento. Con la regla del largo, la pantalla rechazaba sus
     * propios valores de partida.
     */
    if (!enPlan.esMovimiento) {
      motivos.push(
        `${nombre}: la cuenta ${cuenta} es de agrupación y no admite movimiento; use una divisionaria`,
      );
    }
  }
  if (motivos.length) throw new ParametroInvalido(motivos);

  let guardados = 0;
  for (const [clave, cuenta] of entradas) {
    if (cuenta === POR_DEFECTO.get(clave)) {
      await db.delete(parametrosContables).where(eq(parametrosContables.clave, clave));
      continue;
    }
    await db
      .insert(parametrosContables)
      .values({ empresaId, clave, cuenta, creadoPor: usuarioId })
      .onConflictDoUpdate({
        target: [parametrosContables.empresaId, parametrosContables.clave],
        set: { cuenta, actualizadoEn: new Date() },
      });
    guardados++;
  }
  return { guardados };
}
