/**
 * Flujo completo de importación, contra Postgres real.
 *
 * Sigue el camino que recorre SERVIDIMAR con un embarque: orden al proveedor
 * del exterior, gastos que van llegando, liquidación, ingreso al almacén y
 * asiento contable. Es la prueba que demuestra que los módulos encajan, no sólo
 * que cada uno funciona por su lado.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, crearImportacion, agregarItem, agregarGasto,
  previsualizarLiquidacion, confirmarLiquidacion, cambiarEstado, listar, cargar,
  puedeAvanzar, ImportacionInvalida,
  registrarMovimiento, recalcular, kardexDe, existencias, InventarioInvalido,
  balanceComprobacion, extornar, asentar, ContabilizacionInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let proveedorId = "";
const productos: Record<string, string> = {};

before(async () => {
  await migrar(URL, { silencioso: true });
  raw = postgres(URL, { max: 1, onnotice: () => {} });
  app = conectar({ url: URL, rol: "app", max: 4 });
});

after(async () => {
  await raw?.end();
  await app?.cliente.end();
});

beforeEach(async () => {
  await raw`TRUNCATE TABLE empresas, usuarios RESTART IDENTITY CASCADE`;
  const e = await crearEmpresa(
    URL,
    { ruc: "20303051831", razonSocial: "SERVIDIMAR", metodoValorizacion: "promedio" },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const [prov] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          pais, es_proveedor, es_domiciliado)
    VALUES (${empresaId}, '0', 'CN-8891', 'NINGBO TRADING CO. LTD', 'CN', true, false)
    RETURNING id`;
  proveedorId = prov!.id;

  const [unidad] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;

  for (const [codigo, descripcion, peso] of [
    ["P001", "Bomba centrífuga 2HP", "12.5"],
    ["P002", "Válvula de bronce 2\"", "1.8"],
    ["P003", "Manguera reforzada 50m", "8.0"],
  ] as const) {
    const [p] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id, peso_unitario)
      VALUES (${empresaId}, ${codigo}, ${descripcion}, ${unidad!.id}, ${peso})
      RETURNING id`;
    productos[codigo] = p!.id;
  }
});

const ctx = () => ({ empresaId, usuarioId });
const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, ctx(), t);

/** Embarque de referencia: FOB USD 9 500, tipo de cambio 3.75. */
async function embarqueBase(db: Db): Promise<string> {
  const id = await crearImportacion(db, empresaId, usuarioId, {
    numero: "IMP-2026-001",
    proveedorId,
    almacenId,
    moneda: "USD",
    tipoCambio: "3.75",
    incoterm: "FOB",
    fechaOrden: "2026-08-01",
    facturaExterior: "NB-4417",
  });
  await agregarItem(db, empresaId, id, {
    productoId: productos["P001"]!, descripcion: "Bomba centrífuga 2HP",
    cantidad: "100", fobUnitario: "50",
  });
  await agregarItem(db, empresaId, id, {
    productoId: productos["P002"]!, descripcion: "Válvula de bronce 2\"",
    cantidad: "200", fobUnitario: "20",
  });
  await agregarItem(db, empresaId, id, {
    productoId: productos["P003"]!, descripcion: "Manguera reforzada 50m",
    cantidad: "50", fobUnitario: "10",
  });
  return id;
}

const s2 = (v: string) => money.toString(money.dec(v), 2);

// ─── Alta ─────────────────────────────────────────────────────────────────

describe("alta de la importación", () => {
  test("se crea con su proveedor del exterior y sus ítems", async () => {
    const id = await con((db) => embarqueBase(db));
    const { cabecera, items } = await con((db) => cargar(db, id));

    assert.equal(cabecera.numero, "IMP-2026-001");
    assert.equal(cabecera.estado, "borrador");
    assert.equal(items.length, 3);
    assert.equal(items[0]!.linea, 1);
    assert.equal(items[2]!.linea, 3);
  });

  test("el peso de cada línea se deduce del peso unitario del producto", async () => {
    const id = await con((db) => embarqueBase(db));
    const { items } = await con((db) => cargar(db, id));
    // 100 unidades × 12.5 kg
    assert.equal(s2(items[0]!.peso!), "1250.00");
    assert.equal(s2(items[1]!.peso!), "360.00");
    assert.equal(s2(items[2]!.peso!), "400.00");
  });

  test("un tercero que no es proveedor se rechaza", async () => {
    const [cliente] = await raw<{ id: string }[]>`
      INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
      VALUES (${empresaId}, '6', '20100000001', 'CLIENTE SA', true) RETURNING id`;
    await assert.rejects(
      () =>
        con((db) =>
          crearImportacion(db, empresaId, usuarioId, {
            numero: "IMP-X", proveedorId: cliente!.id, almacenId,
            moneda: "USD", tipoCambio: "3.75", fechaOrden: "2026-08-01",
          }),
        ),
      /no está marcado como proveedor/,
    );
  });

  test("un tipo de cambio no positivo se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          crearImportacion(db, empresaId, usuarioId, {
            numero: "IMP-X", proveedorId, almacenId,
            moneda: "USD", tipoCambio: "0", fechaOrden: "2026-08-01",
          }),
        ),
      /tipo de cambio debe ser positivo/,
    );
  });

  test("los estados sólo avanzan de uno en uno", () => {
    assert.equal(puedeAvanzar("borrador", "aprobada"), true);
    assert.equal(puedeAvanzar("borrador", "nacionalizada"), false, "no se salta el tránsito");
    assert.equal(puedeAvanzar("nacionalizada", "borrador"), false, "no se retrocede");
    assert.equal(puedeAvanzar("en_aduana", "anulada"), true);
    assert.equal(puedeAvanzar("liquidada", "anulada"), false, "lo liquidado se extorna, no se anula");
  });

  test("el ciclo completo de estados llega hasta nacionalizada", async () => {
    const id = await con((db) => embarqueBase(db));
    for (const estado of ["aprobada", "en_transito", "en_aduana", "nacionalizada"] as const) {
      await con((db) => cambiarEstado(db, id, estado));
    }
    const { cabecera } = await con((db) => cargar(db, id));
    assert.equal(cabecera.estado, "nacionalizada");
  });

  test("la DUA se guarda al nacionalizar", async () => {
    const id = await con((db) => embarqueBase(db));
    await con((db) => cambiarEstado(db, id, "aprobada"));
    await con((db) => cambiarEstado(db, id, "en_transito"));
    await con((db) =>
      cambiarEstado(db, id, "en_aduana", { duaNumero: "235-2026-10-123456", duaFecha: "2026-09-01" }),
    );
    const { cabecera } = await con((db) => cargar(db, id));
    assert.equal(cabecera.duaNumero, "235-2026-10-123456");
  });
});

// ─── Liquidación ──────────────────────────────────────────────────────────

describe("liquidación", () => {
  async function conGastos(db: Db): Promise<string> {
    const id = await embarqueBase(db);
    // Flete por peso, ad valorem y agente por FOB, IGV y percepción fuera del costo.
    await agregarGasto(db, empresaId, id, {
      concepto: "Flete internacional", importe: "2800.00", moneda: "USD",
      tipoCambio: "3.78", baseProrrateo: "peso", afectaCosto: true,
    });
    await agregarGasto(db, empresaId, id, {
      concepto: "Seguro de transporte", importe: "142.50", moneda: "USD",
      tipoCambio: "3.78", baseProrrateo: "fob", afectaCosto: true,
    });
    await agregarGasto(db, empresaId, id, {
      concepto: "Ad valorem", importe: "2493.75", moneda: "PEN",
      tipoCambio: "1", baseProrrateo: "fob", afectaCosto: true,
    });
    await agregarGasto(db, empresaId, id, {
      concepto: "Agente de aduanas", importe: "1180.00", moneda: "PEN",
      tipoCambio: "1", baseProrrateo: "fob", afectaCosto: true,
    });
    await agregarGasto(db, empresaId, id, {
      concepto: "IGV de importación", importe: "7929.11", moneda: "PEN",
      tipoCambio: "1", baseProrrateo: "fob", afectaCosto: false,
    });
    await agregarGasto(db, empresaId, id, {
      concepto: "Percepción del IGV", importe: "1762.02", moneda: "PEN",
      tipoCambio: "1", baseProrrateo: "fob", afectaCosto: false,
    });
    return id;
  }

  test("sin gastos, el costo es el FOB convertido a soles", async () => {
    const id = await con((db) => embarqueBase(db));
    const { liquidacion } = await con((db) => previsualizarLiquidacion(db, id));
    // 9 500 USD × 3.75
    assert.equal(s2(money.toString(liquidacion.costoTotal)), "35625.00");
  });

  test("el prorrateo cuadra al céntimo con cada gasto", async () => {
    const id = await con((db) => conGastos(db));
    const vista = await con((db) => previsualizarLiquidacion(db, id));
    assert.equal(vista.cuadra, true, JSON.stringify(vista.diferencias));
  });

  test("el IGV y la percepción no entran al costo de la mercadería", async () => {
    const id = await con((db) => conGastos(db));
    const { liquidacion } = await con((db) => previsualizarLiquidacion(db, id));

    // 7929.11 + 1762.02
    assert.equal(s2(money.toString(liquidacion.gastosNoCostoTotal)), "9691.13");
    assert.deepEqual(
      liquidacion.noCosto.map((n) => n.concepto).sort(),
      ["IGV de importación", "Percepción del IGV"],
    );
    // El costo es FOB + sólo los gastos que sí son costo.
    const esperado = money.add(liquidacion.fobTotal, liquidacion.gastosCostoTotal);
    assert.equal(s2(money.toString(liquidacion.costoTotal)), s2(money.toString(esperado)));
  });

  test("cada gasto se convierte con su propio tipo de cambio", async () => {
    const id = await con((db) => conGastos(db));
    const { liquidacion } = await con((db) => previsualizarLiquidacion(db, id));
    // Flete 2800 USD a 3.78 = 10 584, aunque el FOB se valorizó a 3.75.
    const flete = liquidacion.items
      .flatMap((i) => i.gastos)
      .filter((g) => g.concepto === "Flete internacional")
      .reduce((a, g) => money.add(a, g.importe), money.ZERO);
    assert.equal(s2(money.toString(flete)), "10584.00");
  });

  test("el costo unitario sube respecto del FOB, que es todo el punto", async () => {
    const id = await con((db) => conGastos(db));
    const { liquidacion } = await con((db) => previsualizarLiquidacion(db, id));
    const bomba = liquidacion.items.find((i) => i.item.productoId === productos["P001"])!;
    // FOB unitario: 50 USD × 3.75 = 187.50
    assert.ok(
      money.gt(bomba.costoUnitario, money.dec("187.50")),
      "el costo con gastos tiene que superar al FOB",
    );
  });

  test("liquidar una importación sin ítems se rechaza", async () => {
    const id = await con((db) =>
      crearImportacion(db, empresaId, usuarioId, {
        numero: "IMP-VACIA", proveedorId, almacenId,
        moneda: "USD", tipoCambio: "3.75", fechaOrden: "2026-08-01",
      }),
    );
    await assert.rejects(
      () => con((db) => previsualizarLiquidacion(db, id)),
      /no tiene ítems/,
    );
  });

  test("un gasto directo se carga íntegro al ítem que lo generó", async () => {
    const id = await con(async (db) => {
      const i = await embarqueBase(db);
      const { items } = await cargar(db, i);
      await agregarGasto(db, empresaId, i, {
        concepto: "Certificación técnica", importe: "900.00", moneda: "PEN",
        tipoCambio: "1", baseProrrateo: "directo", afectaCosto: true,
        itemId: items[1]!.id,
      });
      return i;
    });
    const { liquidacion } = await con((db) => previsualizarLiquidacion(db, id));
    assert.equal(s2(money.toString(liquidacion.items[0]!.totalGastosCosto)), "0.00");
    assert.equal(s2(money.toString(liquidacion.items[1]!.totalGastosCosto)), "900.00");
  });

  test("un gasto directo sin ítem se rechaza al capturarlo", async () => {
    const id = await con((db) => embarqueBase(db));
    await assert.rejects(
      () =>
        con((db) =>
          agregarGasto(db, empresaId, id, {
            concepto: "X", importe: "10", moneda: "PEN", tipoCambio: "1",
            baseProrrateo: "directo", afectaCosto: true,
          }),
        ),
      /a qué ítem se carga/,
    );
  });
});

// ─── Confirmación: kardex y contabilidad ──────────────────────────────────

describe("confirmación de la liquidación", () => {
  async function liquidar(): Promise<{ id: string; resultado: Awaited<ReturnType<typeof confirmarLiquidacion>> }> {
    const id = await con(async (db) => {
      const i = await embarqueBase(db);
      await agregarGasto(db, empresaId, i, {
        concepto: "Flete internacional", importe: "10584.00", moneda: "PEN",
        tipoCambio: "1", baseProrrateo: "peso", afectaCosto: true,
      });
      await agregarGasto(db, empresaId, i, {
        concepto: "Ad valorem", importe: "2493.75", moneda: "PEN",
        tipoCambio: "1", baseProrrateo: "fob", afectaCosto: true,
      });
      await agregarGasto(db, empresaId, i, {
        concepto: "IGV de importación", importe: "7929.11", moneda: "PEN",
        tipoCambio: "1", baseProrrateo: "fob", afectaCosto: false,
      });
      return i;
    });

    const resultado = await con((db) =>
      confirmarLiquidacion(db, empresaId, usuarioId, id, {
        numero: "LIQ-2026-001", fecha: "2026-09-05", periodo: "202609",
      }),
    );
    return { id, resultado };
  }

  test("la mercadería entra al almacén con su costo real", async () => {
    const { resultado } = await liquidar();
    assert.equal(resultado.movimientos.length, 3);

    const saldos = await con((db) => existencias(db, almacenId));
    assert.equal(saldos.length, 3);

    const bomba = saldos.find((s) => s.codigo === "P001")!;
    assert.equal(s2(bomba.cantidad), "100.00");
    // FOB 18 750 + flete y ad valorem prorrateados: por encima del FOB.
    assert.ok(Number(bomba.valor) > 18750, `el valor debía superar el FOB, fue ${bomba.valor}`);
  });

  test("la suma de existencias cuadra con el costo total de la liquidación", async () => {
    const { resultado } = await liquidar();
    const saldos = await con((db) => existencias(db, almacenId));
    const total = saldos.reduce((a, s) => money.add(a, money.dec(s.valor)), money.ZERO);
    assert.equal(s2(money.toString(total)), resultado.costoTotal);
  });

  test("el asiento cuadra y carga el IGV a crédito fiscal, no al inventario", async () => {
    await liquidar();
    const balance = await con((db) => balanceComprobacion(db, "202609"));

    const total = balance.reduce((a, b) => money.add(a, money.dec(b.saldo)), money.ZERO);
    assert.equal(s2(money.toString(total)), "0.00", "el asiento tiene que cuadrar");

    const mercaderia = balance.find((b) => b.cuenta === "20111")!;
    const igv = balance.find((b) => b.cuenta === "40111")!;
    const proveedor = balance.find((b) => b.cuenta === "4212")!;

    assert.equal(s2(igv.saldo), "7929.11", "el IGV va a la 40111");
    assert.ok(
      !money.eq(money.dec(mercaderia.saldo), money.ZERO),
      "la mercadería se carga a la 20",
    );
    // Lo abonado al proveedor es todo lo cargado.
    assert.equal(
      s2(money.toString(money.neg(money.dec(proveedor.saldo)))),
      s2(money.toString(money.add(money.dec(mercaderia.saldo), money.dec(igv.saldo)))),
    );
  });

  test("el costo del inventario no incluye el IGV", async () => {
    await liquidar();
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const mercaderia = money.dec(balance.find((b) => b.cuenta === "20111")!.saldo);
    const saldos = await con((db) => existencias(db, almacenId));
    const inventario = saldos.reduce((a, s) => money.add(a, money.dec(s.valor)), money.ZERO);
    // El kardex y la cuenta 20 tienen que decir lo mismo. Si el IGV se hubiera
    // colado al costo, esta igualdad seguiría cumpliéndose pero ambos estarían
    // inflados; por eso la prueba de arriba comprueba además dónde fue el IGV.
    assert.equal(s2(money.toString(inventario)), s2(money.toString(mercaderia)));
  });

  test("una importación liquidada no se liquida dos veces", async () => {
    const { id } = await liquidar();
    await assert.rejects(
      () =>
        con((db) =>
          confirmarLiquidacion(db, empresaId, usuarioId, id, {
            numero: "LIQ-2026-002", fecha: "2026-09-05", periodo: "202609",
          }),
        ),
      /ya fue liquidada/,
    );
  });

  test("una importación liquidada ya no admite gastos nuevos", async () => {
    const { id } = await liquidar();
    await assert.rejects(
      () =>
        con((db) =>
          agregarGasto(db, empresaId, id, {
            concepto: "Tardío", importe: "100", moneda: "PEN", tipoCambio: "1",
            baseProrrateo: "fob", afectaCosto: true,
          }),
        ),
      /ya no admite cambios/,
    );
  });

  test("el extorno del asiento devuelve el balance a cero", async () => {
    await liquidar();
    const [asiento] = await raw<{ id: string }[]>`
      SELECT id FROM asientos WHERE origen_modulo = 'importaciones' AND estado = 'contabilizado'`;
    await con((db) =>
      extornar(db, empresaId, usuarioId, asiento!.id, { fecha: "2026-09-06", periodo: "202609" }),
    );
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    for (const fila of balance) {
      assert.equal(s2(fila.saldo), "0.00", `la cuenta ${fila.cuenta} debía quedar en cero`);
    }
  });

  test("el periodo cerrado impide contabilizar", async () => {
    await raw`
      INSERT INTO periodos (empresa_id, periodo, estado)
      VALUES (${empresaId}, '202609', 'cerrado')`;
    await assert.rejects(
      () => liquidar(),
      (e: unknown) => e instanceof ContabilizacionInvalida && /cerrado/.test(e.message),
    );
  });
});

// ─── Kardex sobre la base ─────────────────────────────────────────────────

describe("kardex", () => {
  const ingreso = (fecha: string, cantidad: string, costo: string) => ({
    almacenId, productoId: productos["P001"]!, fecha,
    sentido: "ingreso" as const, tipoOperacion: "02",
    cantidad: money.dec(cantidad), costoUnitario: money.dec(costo),
  });
  const salida = (fecha: string, cantidad: string) => ({
    almacenId, productoId: productos["P001"]!, fecha,
    sentido: "salida" as const, tipoOperacion: "01", cantidad: money.dec(cantidad),
  });

  test("la salida se valoriza al promedio del momento", async () => {
    await con(async (db) => {
      await registrarMovimiento(db, empresaId, ingreso("2026-09-01", "100", "10"));
      await registrarMovimiento(db, empresaId, ingreso("2026-09-02", "100", "20"));
      const s = await registrarMovimiento(db, empresaId, salida("2026-09-03", "50"));
      assert.equal(s2(s.costoUnitario), "15.00");
      assert.equal(s2(s.saldoValor), "2250.00");
    });
  });

  test("no se puede sacar más de lo que hay", async () => {
    await assert.rejects(
      () =>
        con(async (db) => {
          await registrarMovimiento(db, empresaId, ingreso("2026-09-01", "10", "5"));
          await registrarMovimiento(db, empresaId, salida("2026-09-02", "11"));
        }),
      /stock insuficiente/i,
    );
  });

  test("un registro atrasado recalcula los costos de todo lo posterior", async () => {
    await con(async (db) => {
      await registrarMovimiento(db, empresaId, ingreso("2026-09-05", "100", "20"));
      const primeraSalida = await registrarMovimiento(db, empresaId, salida("2026-09-06", "50"));
      assert.equal(s2(primeraSalida.costoUnitario), "20.00");

      // Llega tarde la factura de una compra anterior, más barata.
      const atrasado = await registrarMovimiento(db, empresaId, ingreso("2026-09-01", "100", "10"));
      assert.equal(atrasado.recalculado, true);

      // Aquella salida ya no costó 20: ahora sale al promedio de las dos compras.
      const lineas = await kardexDe(db, almacenId, productos["P001"]!);
      const salidaCorregida = lineas.find((l) => l.sentido === "salida")!;
      assert.equal(s2(salidaCorregida.costoUnitario), "15.00");
      assert.equal(s2(salidaCorregida.importeTotal), "750.00");
    });
  });

  test("recalcular deja el saldo igual que el incremental", async () => {
    await con(async (db) => {
      await registrarMovimiento(db, empresaId, ingreso("2026-09-01", "100", "12.5"));
      await registrarMovimiento(db, empresaId, salida("2026-09-02", "30"));
      await registrarMovimiento(db, empresaId, ingreso("2026-09-03", "50", "13.75"));
      await registrarMovimiento(db, empresaId, salida("2026-09-04", "70"));

      const antes = await existencias(db, almacenId);
      const r = await recalcular(db, empresaId, almacenId, productos["P001"]!);
      const bomba = antes.find((x) => x.codigo === "P001")!;

      assert.equal(s2(bomba.cantidad), s2(money.toString(r.estado.cantidad)));
      assert.equal(s2(bomba.valor), s2(money.toString(r.estado.valor)));
    });
  });

  test("un servicio no lleva kardex", async () => {
    const [unidad] = await raw<{ id: string }[]>`
      SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'ZZ'`;
    const [servicio] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id, tipo)
      VALUES (${empresaId}, 'S001', 'Asesoría técnica', ${unidad!.id}, 'servicio')
      RETURNING id`;
    await assert.rejects(
      () =>
        con((db) =>
          registrarMovimiento(db, empresaId, {
            almacenId, productoId: servicio!.id, fecha: "2026-09-01",
            sentido: "ingreso", tipoOperacion: "02",
            cantidad: money.dec("1"), costoUnitario: money.dec("100"),
          }),
        ),
      /es un servicio y no lleva kardex/,
    );
  });

  test("un producto dado de baja no recibe movimientos", async () => {
    await raw`UPDATE productos SET activo = false WHERE id = ${productos["P002"]}`;
    await assert.rejects(
      () =>
        con((db) =>
          registrarMovimiento(db, empresaId, {
            almacenId, productoId: productos["P002"]!, fecha: "2026-09-01",
            sentido: "ingreso", tipoOperacion: "02",
            cantidad: money.dec("1"), costoUnitario: money.dec("10"),
          }),
        ),
      InventarioInvalido,
    );
  });

  test("una cantidad de cero se rechaza", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          registrarMovimiento(db, empresaId, {
            ...ingreso("2026-09-01", "0", "10"),
          }),
        ),
      /mayor que cero/,
    );
  });

  test("PEPS consume la capa más antigua y lo deja registrado", async () => {
    await raw`UPDATE empresas SET metodo_valorizacion = 'peps' WHERE id = ${empresaId}`;
    await con(async (db) => {
      await registrarMovimiento(db, empresaId, ingreso("2026-09-01", "100", "10"));
      await registrarMovimiento(db, empresaId, ingreso("2026-09-02", "100", "20"));
      const s = await registrarMovimiento(db, empresaId, salida("2026-09-03", "150"));
      // 100 a 10 + 50 a 20 = 2000
      assert.equal(s2(s.importeTotal), "2000.00");

      const lineas = await kardexDe(db, almacenId, productos["P001"]!);
      const ultima = lineas.at(-1)!;
      assert.equal(
        (ultima.consumos as unknown[]).length,
        2,
        "el 13.1 necesita el detalle por capa",
      );
    });
  });
});

// ─── Aislamiento en el flujo real ─────────────────────────────────────────

describe("aislamiento en las operaciones", () => {
  test("una empresa no ve las importaciones de otra", async () => {
    await con((db) => embarqueBase(db));

    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    const desdeOtra = await enEmpresa(
      app,
      { empresaId: otra.empresaId, usuarioId: otra.usuarioId },
      (db) => listar(db),
    );
    assert.deepEqual(desdeOtra, []);

    const propias = await con((db) => listar(db));
    assert.equal(propias.length, 1);
  });

  test("cargar una importación ajena por su id no la encuentra", async () => {
    const id = await con((db) => embarqueBase(db));
    const otra = await crearEmpresa(
      URL,
      { ruc: "20100066603", razonSocial: "OTRA" },
      { email: "beto@otra.pe", nombre: "Beto", password: "contraseña-de-prueba-1" },
    );
    await assert.rejects(
      () =>
        enEmpresa(app, { empresaId: otra.empresaId, usuarioId: otra.usuarioId }, (db) =>
          cargar(db, id),
        ),
      ImportacionInvalida,
      "para la otra empresa, esa importación no existe",
    );
  });
});
