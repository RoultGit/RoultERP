/**
 * Liquidación mensual de impuestos.
 *
 * Lo que se comprueba es que las cifras salgan de las mismas filas que los
 * libros electrónicos, y que las tres reglas que más rectificatorias causan se
 * respeten: el IGV negativo no se declara, la renta no se calcula sobre el
 * total de la factura, y lo retenido a terceros no es crédito.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta, liquidacionMensual, exportarLiquidacion,
  registroVentas, registroCompras,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let cliente = "";
let proveedor = "";
let exterior = "";
let producto = "";

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

  const [a] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacen = a!.id;

  const [c] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR SAC', true) RETURNING id`;
  cliente = c!.id;
  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, es_domiciliado)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true, true) RETURNING id`;
  proveedor = pr!.id;
  const [ex] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          pais, es_proveedor, es_domiciliado)
    VALUES (${empresaId}, '0', 'CN-8891', 'NINGBO TRADING', 'CN', true, false) RETURNING id`;
  exterior = ex!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [p] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'P001', 'Bomba', ${u!.id}) RETURNING id`;
  producto = p!.id;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0)`;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const d = (v: string) => money.dec(v);
const s2 = (v: string) => money.toString(d(v), 2);

const comprar = (valor: string, numero: string, opts: { proveedorId?: string } = {}) =>
  con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: opts.proveedorId ?? proveedor,
      tipoDocumento: "01",
      serie: "F001",
      numero,
      fechaEmision: "2026-09-05",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen,
      lineas: [
        { productoId: producto, descripcion: "Bomba", cantidad: "10", valorUnitario: valor },
      ],
    }),
  );

/**
 * Emite y marca el comprobante como aceptado.
 *
 * Un borrador no entra ni al registro de ventas ni a la liquidación: son ventas
 * hechas que todavía no se informaron. Para probar la declaración hace falta
 * que estén informadas.
 */
const vender = async (valor: string, opts: { afectacion?: string } = {}) => {
  const r = await emitir(valor, opts);
  await raw`UPDATE comprobantes SET estado = 'aceptado' WHERE id = ${r.comprobanteId}`;
  return r;
};

const emitir = (valor: string, opts: { afectacion?: string } = {}) =>
  con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: cliente,
      tipoDocumento: "01",
      serie: "F001",
      fechaEmision: "2026-09-15",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen,
      lineas: [
        {
          productoId: producto,
          cantidad: "5",
          valorUnitario: valor,
          ...(opts.afectacion ? { afectacionIgv: opts.afectacion } : {}),
        },
      ],
    }),
  );

const buscar = (casillas: { numero: string; importe: string }[], numero: string) =>
  casillas.find((c) => c.numero === numero)?.importe;

// ─── IGV ──────────────────────────────────────────────────────────────────

describe("liquidación del IGV", () => {
  test("débito menos crédito da lo que se paga", async () => {
    await comprar("100", "0000001"); // 1 000 + 180 de IGV
    await vender("400"); // 2 000 + 360 de IGV

    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.equal(buscar(l.ventas, "100"), "2000.00");
    assert.equal(buscar(l.ventas, "101"), "360.00");
    assert.equal(buscar(l.compras, "107"), "1000.00");
    assert.equal(buscar(l.compras, "108"), "180.00");
    assert.equal(l.igvAPagar, "180.00");
    assert.equal(l.saldoAFavorSiguiente, "0.00");
  });

  /** Declarar un importe negativo no existe: el sobrante viaja al mes siguiente. */
  test("si el crédito supera al débito no se paga nada y queda saldo a favor", async () => {
    await comprar("500", "0000001"); // 5 000 + 900
    await vender("200"); // 1 000 + 180

    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.equal(l.igvAPagar, "0.00");
    assert.equal(l.saldoAFavorSiguiente, "720.00");
  });

  test("el saldo a favor del mes anterior descuenta", async () => {
    await comprar("100", "0000001");
    await vender("400");
    const l = await con((db) =>
      liquidacionMensual(db, "202609", { saldoAFavorAnterior: "50.00" }),
    );
    assert.equal(buscar(l.igv, "145"), "-50.00");
    assert.equal(l.igvAPagar, "130.00");
  });

  test("las cifras coinciden con los libros del PLE", async () => {
    await comprar("100", "0000001");
    await vender("400");

    const l = await con((db) => liquidacionMensual(db, "202609"));
    const ventas = await con((db) => registroVentas(db, empresaId, "202609"));
    const compras = await con((db) => registroCompras(db, empresaId, "202609"));

    // El IGV va en el campo 16 del formato 14.1 y en el 15 del 8.1. Si la
    // liquidación dijera otra cosa, el error estaría en este cálculo y no en los
    // datos: las dos leen las mismas filas.
    const sumarCampo = (contenido: string, campo: number) =>
      contenido
        .trim()
        .split("\r\n")
        .filter(Boolean)
        .map((f) => d(f.split("|")[campo - 1] ?? "0"))
        .reduce((a, x) => money.add(a, x), money.ZERO);

    const igvVentas = sumarCampo(ventas.contenido, 16);
    const igvCompras = sumarCampo(compras.contenido, 15);

    assert.equal(money.toString(igvVentas, 2), buscar(l.ventas, "101"));
    assert.equal(money.toString(igvCompras, 2), buscar(l.compras, "108"));
  });

  test("una compra al exterior no da crédito fiscal", async () => {
    // El módulo de compras rechaza a un no domiciliado a propósito: esas
    // facturas entran por importaciones. Aquí se inserta la fila directamente
    // porque lo que se prueba es la liquidación, no el camino de entrada.
    await raw`
      INSERT INTO compras (empresa_id, proveedor_id, tipo_documento, serie, numero,
                           fecha_emision, periodo, moneda, tipo_cambio,
                           gravadas, igv, total, estado)
      VALUES (${empresaId}, ${exterior}, '91', 'IMP', '0000001', '2026-09-05', '202609',
              'USD', '3.80', '1000', '0', '1000', 'registrada')`;
    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.equal(buscar(l.compras, "108"), "0.00");
    assert.ok(l.avisos.some((a) => /no domiciliados/.test(a)));
  });

  test("una venta exonerada no genera débito", async () => {
    await comprar("100", "0000001");
    await vender("400", { afectacion: "20" });
    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.equal(buscar(l.ventas, "100"), "0.00");
    assert.equal(buscar(l.ventas, "105"), "2000.00");
    assert.equal(buscar(l.ventas, "101"), "0.00");
  });

  test("un borrador no se declara, pero se avisa de él", async () => {
    await comprar("100", "0000001");
    await emitir("400"); // queda en borrador: no se informó a SUNAT
    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.equal(buscar(l.ventas, "101"), "0.00");
    assert.ok(l.avisos.some((a) => /en borrador por 360\.00 de IGV/.test(a)));
  });

  test("un periodo vacío se declara en cero y lo dice", async () => {
    const l = await con((db) => liquidacionMensual(db, "202610"));
    assert.equal(l.igvAPagar, "0.00");
    assert.ok(l.avisos.some((a) => /va en cero, pero se presenta igual/.test(a)));
  });

  test("exige el formato del periodo", async () => {
    await assert.rejects(() => con((db) => liquidacionMensual(db, "2026-09")), /AAAAMM/);
  });
});

// ─── Renta ────────────────────────────────────────────────────────────────

describe("pago a cuenta del impuesto a la renta", () => {
  /** El error clásico es calcularlo sobre el total de la factura, con IGV. */
  test("se calcula sobre los ingresos netos, sin IGV", async () => {
    await comprar("100", "0000001");
    await vender("400"); // 2 000 netos, 2 360 con IGV
    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.equal(buscar(l.renta, "301"), "2000.00");
    // 1.5 % de 2 000.
    assert.equal(l.pagoACuentaRenta, "30.00");
  });

  test("suma exoneradas, inafectas y exportación a la base", async () => {
    await comprar("100", "0000001");
    await vender("400");
    await vender("100", { afectacion: "20" });
    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.equal(buscar(l.renta, "301"), "2500.00");
  });

  test("admite el coeficiente de la empresa", async () => {
    await comprar("100", "0000001");
    await vender("400");
    const l = await con((db) => liquidacionMensual(db, "202609", { tasaRenta: "2.0" }));
    assert.equal(l.pagoACuentaRenta, "40.00");
  });
});

// ─── Agente de retención ──────────────────────────────────────────────────

describe("retenciones efectuadas", () => {
  /** Dinero de terceros, no crédito: se declara y se paga aparte. */
  test("lo retenido va en su propio bloque y avisa", async () => {
    await raw`
      INSERT INTO comprobantes_retencion
        (empresa_id, tipo_documento, serie, numero, fecha_emision, tercero_id,
         regimen, tasa, importe_total, importe_operacion, estado)
      VALUES (${empresaId}, '20', 'R001', '00000001', '2026-09-20', ${proveedor},
              '01', '3', '150.00', '5000.00', 'aceptado')`;

    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.equal(l.agente.length, 1);
    assert.equal(s2(l.agente[0]!.importe), "150.00");
    assert.match(l.agente[0]!.concepto, /PDT 626/);
    assert.ok(l.avisos.some((a) => /no es crédito de este formulario/.test(a)));

    // Y no se coló en el IGV del mes.
    assert.equal(l.igvAPagar, "0.00");
  });

  test("un borrador no cuenta", async () => {
    await raw`
      INSERT INTO comprobantes_retencion
        (empresa_id, tipo_documento, serie, numero, fecha_emision, tercero_id,
         regimen, tasa, importe_total, importe_operacion, estado)
      VALUES (${empresaId}, '20', 'R001', '00000002', '2026-09-20', ${proveedor},
              '01', '3', '150.00', '5000.00', 'borrador')`;
    const l = await con((db) => liquidacionMensual(db, "202609"));
    assert.deepEqual(l.agente, []);
  });
});

// ─── La exportación ───────────────────────────────────────────────────────

describe("exportación al PDT", () => {
  test("el CSV lleva las mismas cifras que la pantalla", async () => {
    await comprar("100", "0000001");
    await vender("400");

    const [l, csv] = await con(async (db) => [
      await liquidacionMensual(db, "202609"),
      await exportarLiquidacion(db, empresaId, "202609"),
    ]);

    assert.equal(csv.nombre, "PDT621-20303051831-202609.csv");
    const filas = csv.contenido.trimEnd().split("\r\n");
    assert.equal(filas[0], "SECCION;CASILLA;CONCEPTO;IMPORTE");
    assert.equal(filas.length - 1, csv.filas);

    // La casilla 101 es el IGV de las ventas: tiene que decir lo mismo.
    const cien = filas.find((f) => f.startsWith("VENTAS;101;"));
    assert.ok(cien, csv.contenido);
    assert.equal(cien!.split(";")[3], buscar(l.ventas, "101"));
  });

  /** El punto y coma separa: una glosa que lo llevara partiría la fila. */
  test("ninguna fila tiene más columnas de las que debe", async () => {
    await comprar("100", "0000001");
    await vender("400");
    const csv = await con((db) => exportarLiquidacion(db, empresaId, "202609"));
    for (const fila of csv.contenido.trimEnd().split("\r\n")) {
      assert.equal(fila.split(";").length, 4, fila);
    }
  });
});
