/**
 * Estado de cuenta del cliente, proyección de cobranzas y cheques recibidos.
 *
 * Lo que se comprueba es que las tres respondan la pregunta que les toca sin
 * mentir: por qué debe, cuándo entra, y qué de eso todavía no es dinero.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, crearCuenta, registrarCompra, emitirVenta, emitirNota,
  registrarCobranza, canjearPorLetra,
  estadoCuentaCliente, proyeccionCobranzas, antiguedadCartera,
  recibirCheque, cambiarEstadoCheque, situacionCheques, CajaInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let cliente = "";
let otroCliente = "";
let producto = "";
let bancoId = "";

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
    { ruc: "20303051831", razonSocial: "SERVIDIMAR" },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_cliente, dias_credito, limite_credito)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR SAC', true, 30, '200000')
    RETURNING id`;
  cliente = c!.id;

  const [o] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20100066603', 'OTRO CLIENTE SAC', true) RETURNING id`;
  otroCliente = o!.id;

  const [prov] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba centrífuga', ${u!.id}) RETURNING id`;
  producto = p!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0), (${empresaId}, '07', 'FC01', 0)`;

  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: prov!.id, tipoDocumento: "01", serie: "F001", numero: "0000001",
      fechaEmision: "2026-08-01", moneda: "PEN", tipoCambio: "1", almacenId,
      lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "500", valorUnitario: "300" }],
    }),
  );

  bancoId = await con((db) =>
    crearCuenta(db, empresaId, usuarioId, {
      codigo: "BCP", nombre: "BCP soles", tipo: "banco",
      moneda: "PEN", cuentaContable: "1041",
      banco: "BCP", numeroCuenta: "191-1234567-0-11",
    }),
  );
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

async function venta(
  opts: {
    clienteId?: string;
    moneda?: string;
    tipoCambio?: string;
    valorUnitario?: string;
    fechaEmision?: string;
    fechaVencimiento?: string;
  } = {},
): Promise<string> {
  const r = await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: opts.clienteId ?? cliente,
      tipoDocumento: "01",
      serie: "F001",
      fechaEmision: opts.fechaEmision ?? "2026-09-01",
      fechaVencimiento: opts.fechaVencimiento ?? "2026-10-01",
      moneda: opts.moneda ?? "PEN",
      tipoCambio: opts.tipoCambio ?? "1",
      almacenId,
      lineas: [{ productoId: producto, cantidad: "10", valorUnitario: opts.valorUnitario ?? "500" }],
    }),
  );
  return r.comprobanteId;
}

const cobrar = (comprobanteId: string, importe: string, fecha = "2026-09-20") =>
  con((db) =>
    registrarCobranza(db, empresaId, usuarioId, {
      numero: `CB-${importe}-${fecha}`,
      clienteId: cliente,
      fecha,
      moneda: "PEN",
      tipoCambio: "1",
      medioCobro: "transferencia",
      cuentaDestino: "1041",
      cuentaEfectivoId: bancoId,
      aplicaciones: [{ comprobanteId, importe }],
    }),
  );

// ─── Estado de cuenta ─────────────────────────────────────────────────────

describe("estado de cuenta del cliente", () => {
  test("explica el saldo con cargos, abonos y el saldo corriendo", async () => {
    const uno = await venta();
    await venta({ valorUnitario: "200" });
    await cobrar(uno, "3000.00");

    const [cuenta] = await con((db) => estadoCuentaCliente(db, cliente));
    assert.equal(cuenta!.moneda, "PEN");
    assert.equal(cuenta!.movimientos.length, 3);
    // 5900 + 2360 de cargos, 3000 de abono.
    assert.equal(cuenta!.saldoFinal, "5260.00");
    assert.deepEqual(
      cuenta!.movimientos.map((m) => m.tipo),
      ["comprobante", "comprobante", "cobranza"],
    );
  });

  /** Una nota de crédito descuenta: es abono, no cargo negativo. */
  test("la nota de crédito entra como abono", async () => {
    const v = await venta();
    // La nota exige que el original ya esté informado: emitir una nota sobre un
    // borrador sería corregirlo, no anularlo.
    await raw`UPDATE comprobantes SET estado = 'aceptado' WHERE id = ${v}`;
    await con((db) =>
      emitirNota(db, empresaId, usuarioId, {
        comprobanteId: v,
        tipoDocumento: "07",
        serie: "FC01",
        fechaEmision: "2026-09-05",
        motivo: "01",
        descripcionMotivo: "Anulación de la operación",
      }),
    );

    const [cuenta] = await con((db) => estadoCuentaCliente(db, cliente));
    const nota = cuenta!.movimientos.find((m) => m.glosa === "Nota de crédito")!;
    assert.equal(nota.cargo, "0.00");
    assert.equal(s2(nota.abono), "5900.00");
    assert.equal(cuenta!.saldoFinal, "0.00");
  });

  test("separa las monedas en vez de sumarlas", async () => {
    await venta();
    await venta({ moneda: "USD", tipoCambio: "3.80", valorUnitario: "100" });
    const cuentas = await con((db) => estadoCuentaCliente(db, cliente));
    assert.deepEqual(cuentas.map((c) => c.moneda), ["PEN", "USD"]);
  });

  test("el comprobante va antes que su cobranza del mismo día", async () => {
    const v = await venta();
    await cobrar(v, "5900.00", "2026-09-01");
    const [cuenta] = await con((db) => estadoCuentaCliente(db, cliente));
    assert.deepEqual(cuenta!.movimientos.map((m) => m.tipo), ["comprobante", "cobranza"]);
    assert.equal(cuenta!.movimientos[0]!.saldo, "5900.00");
    assert.equal(cuenta!.saldoFinal, "0.00");
  });

  test("un cliente sin movimientos devuelve nada, no un error", async () => {
    assert.deepEqual(await con((db) => estadoCuentaCliente(db, otroCliente)), []);
  });
});

// ─── Proyección ───────────────────────────────────────────────────────────

describe("proyección de cobranzas", () => {
  test("reparte por tramos según el vencimiento", async () => {
    // Vencida, de esta semana y de dentro de un mes.
    await venta({ fechaEmision: "2026-08-01", fechaVencimiento: "2026-09-01" });
    await venta({ fechaEmision: "2026-09-01", fechaVencimiento: "2026-09-18", valorUnitario: "200" });
    await venta({ fechaEmision: "2026-09-01", fechaVencimiento: "2026-11-15", valorUnitario: "300" });

    const p = await con((db) => proyeccionCobranzas(db, "2026-09-15"));
    const porTramo = new Map(p.tramos.map((t) => [t.etiqueta, t]));

    assert.equal(s2(porTramo.get("vencido")!.importe), "5900.00");
    assert.equal(s2(porTramo.get("esta semana")!.importe), "2360.00");
    assert.equal(s2(porTramo.get("más adelante")!.importe), "3540.00");
    assert.equal(p.totalSoles, "11800.00");
  });

  test("lleva a soles lo que está en dólares", async () => {
    await venta({ moneda: "USD", tipoCambio: "3.80", valorUnitario: "100" });
    const p = await con((db) => proyeccionCobranzas(db, "2026-09-15"));
    // USD 1 180 × 3.80.
    assert.equal(p.totalSoles, "4484.00");
    const linea = p.detalle[0]!;
    assert.equal(linea.moneda, "USD");
    assert.equal(s2(linea.saldo), "1180.00");
    assert.equal(s2(linea.saldoSoles), "4484.00");
  });

  test("descuenta lo ya cobrado", async () => {
    const v = await venta();
    await cobrar(v, "2000.00");
    const p = await con((db) => proyeccionCobranzas(db, "2026-09-15"));
    assert.equal(p.totalSoles, "3900.00");
  });

  /** Dejar las letras fuera daría una proyección optimista en la empresa que más las usa. */
  test("incluye las letras en cartera", async () => {
    const v = await venta();
    await con((db) =>
      canjearPorLetra(db, empresaId, usuarioId, {
        numero: "LT-001",
        cartera: "cobrar",
        terceroId: cliente,
        fechaGiro: "2026-09-10",
        fechaVencimiento: "2026-10-20",
        moneda: "PEN",
        documentos: [{ documentoId: v, importe: "5900.00" }],
      }),
    );

    const p = await con((db) => proyeccionCobranzas(db, "2026-09-15"));
    const letras = p.detalle.filter((l) => l.tipo === "letra");
    assert.equal(letras.length, 1);
    assert.equal(s2(letras[0]!.saldo), "5900.00");
    // Y el comprobante canjeado ya no cuenta dos veces.
    assert.equal(p.totalSoles, "5900.00");
  });

  test("no inventa tramos sin documentos", async () => {
    await venta({ fechaVencimiento: "2026-09-18" });
    const p = await con((db) => proyeccionCobranzas(db, "2026-09-15"));
    assert.deepEqual(p.tramos.map((t) => t.etiqueta), ["esta semana"]);
  });

  test("cuenta los días que faltan para vencer", async () => {
    await venta({ fechaVencimiento: "2026-09-18" });
    const p = await con((db) => proyeccionCobranzas(db, "2026-09-15"));
    assert.equal(p.detalle[0]!.diasParaVencer, 3);
  });
});

// ─── Cheques recibidos ────────────────────────────────────────────────────

describe("cheques recibidos de clientes", () => {
  const recibir = (extra?: Partial<Parameters<typeof recibirCheque>[3]>) =>
    con((db) =>
      recibirCheque(db, empresaId, usuarioId, {
        cuentaId: bancoId,
        numero: "77001122",
        fechaGiro: "2026-09-10",
        clienteId: cliente,
        bancoGirador: "Interbank",
        importe: "5900.00",
        ...extra,
      }),
    );

  test("un cheque recibido no es dinero todavía", async () => {
    await recibir();
    const sit = await con((db) => situacionCheques(db, "2026-09-20", { cartera: "recibido" }));
    assert.equal(sit.cheques.length, 1);
    assert.equal(sit.cheques[0]!.estado, "recibido");
    assert.equal(sit.cheques[0]!.bancoGirador, "Interbank");
    assert.deepEqual(sit.enCirculacion, [{ moneda: "PEN", importe: "5900.00" }]);

    // Y no se mezcla con los que giramos nosotros.
    const emitidos = await con((db) => situacionCheques(db, "2026-09-20"));
    assert.equal(emitidos.cheques.length, 0);
  });

  test("recorre recibido → depositado → cobrado", async () => {
    const id = await recibir();
    await con((db) => cambiarEstadoCheque(db, id, "depositado"));
    await con((db) => cambiarEstadoCheque(db, id, "cobrado", { fechaCobrado: "2026-09-22" }));
    const sit = await con((db) => situacionCheques(db, "2026-09-25", { cartera: "recibido" }));
    assert.equal(sit.cheques[0]!.estado, "cobrado");
    // Cobrado, ya no está en circulación.
    assert.deepEqual(sit.enCirculacion, []);
  });

  /** Un cheque rebotado vuelve a ser deuda, y por eso es un estado. */
  test("rebotar exige motivo y lo guarda", async () => {
    const id = await recibir();
    await con((db) => cambiarEstadoCheque(db, id, "depositado"));
    await assert.rejects(
      () => con((db) => cambiarEstadoCheque(db, id, "rebotado")),
      /por qué el banco devolvió/,
    );
    await con((db) =>
      cambiarEstadoCheque(db, id, "rebotado", { motivoRechazo: "Sin fondos" }),
    );
    const sit = await con((db) => situacionCheques(db, "2026-09-25", { cartera: "recibido" }));
    assert.equal(sit.cheques[0]!.estado, "rebotado");
    assert.equal(sit.cheques[0]!.motivoRechazo, "Sin fondos");
    assert.deepEqual(sit.enCirculacion, []);
  });

  test("un diferido se marca como tal", async () => {
    await recibir({ numero: "77009999", fechaCobro: "2026-10-30" });
    const sit = await con((db) => situacionCheques(db, "2026-09-20", { cartera: "recibido" }));
    assert.equal(sit.cheques[0]!.diferido, true);
  });

  test("no sigue el recorrido de los emitidos", async () => {
    const id = await recibir();
    await assert.rejects(
      () => con((db) => cambiarEstadoCheque(db, id, "entregado")),
      /un cheque recibido no pasa a entregado/,
    );
  });

  test("toma el nombre del girador del maestro", async () => {
    const id = await recibir({ girador: "" });
    const sit = await con((db) => situacionCheques(db, "2026-09-20", { cartera: "recibido" }));
    assert.equal(sit.cheques[0]!.beneficiario, "HIDRAULICA DEL SUR SAC");
    assert.ok(id);
  });

  test("exige importe positivo", async () => {
    await assert.rejects(() => recibir({ numero: "77007777", importe: "0" }), CajaInvalida);
  });
});

// ─── Antigüedad de saldos ─────────────────────────────────────────────────

describe("antigüedad de saldos", () => {
  /** Cada documento en su tramo, contado desde la fecha que se le pida. */
  test("reparte la deuda por tramos de atraso", async () => {
    await venta({ fechaEmision: "2026-01-05", fechaVencimiento: "2026-02-05" }); // +222 días
    await venta({ fechaEmision: "2026-07-01", fechaVencimiento: "2026-08-01", valorUnitario: "200" }); // +45
    await venta({ fechaEmision: "2026-09-01", fechaVencimiento: "2026-09-10", valorUnitario: "300" }); // +5
    await venta({ fechaEmision: "2026-09-01", fechaVencimiento: "2026-11-01", valorUnitario: "400" }); // por vencer

    const a = await con((db) => antiguedadCartera(db, "2026-09-15"));
    assert.equal(a.clientes.length, 1);
    const c = a.clientes[0]!;

    assert.equal(s2(c.mas90), "5900.00");
    assert.equal(s2(c.de31a60), "2360.00");
    assert.equal(s2(c.de1a30), "3540.00");
    assert.equal(s2(c.porVencer), "4720.00");
    assert.equal(s2(c.total), "16520.00");
    assert.equal(s2(c.vencido), "11800.00");
    assert.equal(a.totales.total, "16520.00");
  });

  /**
   * Sin ponderar, una factura chica muy atrasada pesaría lo mismo que una
   * grande recién vencida, y el número diría lo contrario de lo que pasa.
   */
  test("los días de atraso se ponderan por importe", async () => {
    // 5 900 con 10 días y 590 con 100 días: el promedio simple daría 55.
    await venta({ fechaEmision: "2026-08-01", fechaVencimiento: "2026-09-05" });
    await venta({ fechaEmision: "2026-05-01", fechaVencimiento: "2026-06-07", valorUnitario: "50" });

    const a = await con((db) => antiguedadCartera(db, "2026-09-15"));
    const c = a.clientes[0]!;
    // (5900×10 + 590×100) / 6490 = 18.18…
    assert.equal(c.diasPromedioMora, "18.2");
    assert.equal(c.documentoMasAntiguo!.dias, 100);
  });

  test("el porcentaje vencido sale sobre el total del cliente", async () => {
    await venta({ fechaEmision: "2026-08-01", fechaVencimiento: "2026-09-01" });
    await venta({ fechaEmision: "2026-09-01", fechaVencimiento: "2026-11-01" });
    const a = await con((db) => antiguedadCartera(db, "2026-09-15"));
    assert.equal(a.clientes[0]!.porcentajeVencido, "50.00");
    assert.equal(a.totales.porcentajeVencido, "50.00");
  });

  /** Dejar las letras fuera daría una cartera sana en la empresa que más las usa. */
  test("las letras en cartera cuentan como deuda", async () => {
    const v = await venta({ fechaEmision: "2026-08-01", fechaVencimiento: "2026-09-01" });
    await con((db) =>
      canjearPorLetra(db, empresaId, usuarioId, {
        numero: "LT-ANT-1",
        cartera: "cobrar",
        terceroId: cliente,
        fechaGiro: "2026-09-02",
        fechaVencimiento: "2026-09-05",
        moneda: "PEN",
        documentos: [{ documentoId: v, importe: "5900.00" }],
      }),
    );

    const a = await con((db) => antiguedadCartera(db, "2026-09-15"));
    const c = a.clientes[0]!;
    assert.equal(s2(c.total), "5900.00", "la deuda no se duplica al canjear");
    assert.equal(s2(c.de1a30), "5900.00");
    assert.equal(c.documentoMasAntiguo!.referencia, "Letra LT-ANT-1");
  });

  /**
   * Una factura sin plazo pactado no se esconde ni se mete en «por vencer»: una
   * deuda sin plazo es exigible desde que nace, así que se clasifica por su
   * emisión y se dice que se hizo. Dejarla fuera enseñaría una cartera más sana
   * de lo que es, y es justo lo que pasaba: un tercio de la cartera de la base
   * de pruebas desaparecía del cuadro.
   */
  test("lo que no trae plazo se clasifica por la emisión y se avisa", async () => {
    const v = await venta({ fechaEmision: "2026-08-01" });
    await raw`UPDATE comprobantes SET fecha_vencimiento = NULL WHERE id = ${v}`;

    const a = await con((db) => antiguedadCartera(db, "2026-09-15"));
    assert.equal(a.clientes.length, 1);
    assert.equal(s2(a.totales.total), "5900.00", "la deuda no puede desaparecer del cuadro");
    // 45 días desde el 1 de agosto.
    assert.equal(s2(a.clientes[0]!.de31a60), "5900.00");
    assert.ok(a.avisos.some((x) => /no tienen plazo|no tiene plazo/.test(x)), a.avisos.join(" | "));
  });

  test("avisa de quien debe más que su límite de crédito", async () => {
    await raw`UPDATE terceros SET limite_credito = '1000' WHERE id = ${cliente}`;
    await venta({ fechaEmision: "2026-08-01", fechaVencimiento: "2026-09-01" });

    const a = await con((db) => antiguedadCartera(db, "2026-09-15"));
    assert.equal(a.clientes[0]!.excedeLimite, true);
    assert.ok(a.avisos.some((x) => /límite de crédito/.test(x)));
  });

  test("se puede mirar un solo cliente", async () => {
    await venta();
    await venta({ clienteId: otroCliente });
    const a = await con((db) => antiguedadCartera(db, "2026-09-15", { clienteId: cliente }));
    assert.equal(a.clientes.length, 1);
    assert.equal(a.clientes[0]!.clienteId, cliente);
  });
});
