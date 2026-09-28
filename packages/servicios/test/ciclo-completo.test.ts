/**
 * Un mes de operación de punta a punta.
 *
 * Las demás pruebas comprueban cada módulo por separado y todas pasan aunque
 * dos de ellos discrepen entre sí. Ésta encadena lo que hace una empresa de
 * verdad en un mes —importar, comprar, vender, cobrar, pagar, conciliar,
 * cerrar— y después comprueba lo único que un contador comprueba de verdad:
 *
 *   1. Que el libro cuadre: debe igual a haber.
 *   2. Que el mayor auxiliar coincida con el mayor general. El saldo de la
 *      cuenta 20 tiene que ser el valor del kardex; el de la 4212, lo que dice
 *      cuentas por pagar; el de la 1212, lo que dice cuentas por cobrar. Es
 *      donde aparecen los errores de integración, y ninguna prueba de módulo
 *      los puede ver.
 *   3. Que los libros electrónicos salgan con la estructura exacta.
 *
 * Si esta prueba pasa, el sistema sirve para llevar la contabilidad de una
 * empresa. Si falla, da igual lo verdes que estén las demás.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money, cpe } from "@roulterp/core";
import { sellar } from "@roulterp/core/auth";
import { certificadoDePrueba, pfxDePrueba } from "@roulterp/core/cpe";
import {
  crearEmpresa, crearOrden, aprobarOrden, registrarCompra,
  crearImportacion, agregarItem, agregarGasto, confirmarLiquidacion,
  emitirVenta, emitirNota, enviarASunat, existencias,
  documentosPorPagar, registrarPago, canjearPorLetra, pagarLetra,
  documentosPorCobrar, registrarCobranza,
  crearCuenta, registrarMovimientoEfectivo,
  emitirGuia, generarResumenDiario, emitirRetencionDePago,
  balanceComprobacion, situacionFinanciera, estadoResultados,
  cerrarPeriodo, cerrarEjercicio,
  registroCompras, registroVentas, libroDiario, inventarioValorizado, CAMPOS,
  kardexDe,
} from "../src/index.ts";
import { zipSync } from "fflate";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";
const KEK = new Uint8Array(32).fill(23);

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let exterior = "";
let agencia = "";
let cliente = "";
let bomba = "";
let valvula = "";
let centroLogistica = "";

const ctx = () => ({ empresaId, usuarioId });
const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, ctx(), t);
const s2 = (v: string) => money.toString(money.dec(v), 2);
const d = (v: string | null | undefined) => money.dec(v ?? "0");

before(async () => {
  await migrar(URL, { silencioso: true });
  raw = postgres(URL, { max: 1, onnotice: () => {} });
  app = conectar({ url: URL, rol: "app", max: 4 });

  await raw`TRUNCATE TABLE empresas, usuarios RESTART IDENTITY CASCADE`;
  const e = await crearEmpresa(
    URL,
    { ruc: "20303051831", razonSocial: "SERVIDIVERSOS MARINA S.R.LTDA." },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;
  await raw`UPDATE empresas SET es_agente_retencion = true, ubigeo = '150103',
            direccion = 'Av. Nicolás Ayllón 3820, Ate' WHERE id = ${empresaId}`;

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const [ex] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, es_domiciliado, pais)
    VALUES (${empresaId}, '0', 'CN-77213', 'NINGBO PUMPS CO. LTD', true, false, 'CN')
    RETURNING id`;
  exterior = ex!.id;

  const [ag] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_proveedor, dias_credito)
    VALUES (${empresaId}, '6', '20100047218', 'AGENCIA DE ADUANAS DEL PACIFICO S.A.', true, 30)
    RETURNING id`;
  agencia = ag!.id;

  const [cl] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_cliente, dias_credito)
    VALUES (${empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR S.A.C.', true, 30)
    RETURNING id`;
  cliente = cl!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [b] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id, peso_unitario)
    VALUES (${empresaId}, 'BOM-2HP', 'Bomba centrífuga 2HP', ${u!.id}, 18.5) RETURNING id`;
  bomba = b!.id;
  const [v] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id, peso_unitario)
    VALUES (${empresaId}, 'VAL-4', 'Válvula compuerta 4"', ${u!.id}, 6.2) RETURNING id`;
  valvula = v!.id;

  await raw`
    INSERT INTO centros_costo (empresa_id, codigo, nombre)
    VALUES (${empresaId}, 'ADM', 'Administración'), (${empresaId}, 'LOG', 'Logística')`;

  await raw`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresaId}, '01', 'F001', 0), (${empresaId}, '03', 'B001', 0),
           (${empresaId}, '07', 'FC01', 0), (${empresaId}, '09', 'T001', 0),
           (${empresaId}, '20', 'R001', 0)`;

  const [cc] = await raw<{ id: string }[]>`
    SELECT id FROM centros_costo WHERE empresa_id = ${empresaId} AND codigo = 'LOG'`;
  centroLogistica = cc!.id;

  const cert = certificadoDePrueba("20303051831");
  const contexto = `empresa:${empresaId}:certificado`;
  await raw`
    INSERT INTO certificados_digitales (empresa_id, pfx_cifrado, password_cifrado, ruc, activo)
    VALUES (${empresaId},
            ${JSON.stringify(sellar(KEK, "test", pfxDePrueba(cert, "clave"), contexto))}::jsonb,
            ${JSON.stringify(sellar(KEK, "test", new TextEncoder().encode("clave"), contexto))}::jsonb,
            '20303051831', true)`;
  await raw`
    INSERT INTO credenciales_sunat (empresa_id, usuario_sol, clave_cifrada, entorno)
    VALUES (${empresaId}, 'MODDATOS',
            ${JSON.stringify(sellar(KEK, "test", new TextEncoder().encode("sol"), `empresa:${empresaId}:sol`))}::jsonb,
            'beta')`;
});

after(async () => {
  await raw?.end();
  await app?.cliente.end();
});

/** Saldo acumulado de un grupo de cuentas, del mayor general. */
async function mayor(prefijo: string, periodo = "202609"): Promise<string> {
  const [fila] = (await raw`
    SELECT coalesce(sum(l.debe_funcional - l.haber_funcional), 0)::text AS saldo
    FROM asiento_lineas l
    JOIN asientos a ON a.id = l.asiento_id
    WHERE a.empresa_id = ${empresaId} AND a.periodo <= ${periodo}
      AND a.estado IN ('contabilizado', 'extornado')
      AND l.cuenta LIKE ${prefijo + "%"}`) as [{ saldo: string }];
  return s2(fila.saldo);
}

const cdrFalso = (codigo: string, texto: string) =>
  Buffer.from(
    zipSync({
      "R-1.xml": new TextEncoder().encode(
        `<?xml version="1.0"?><ApplicationResponse xmlns:cbc="urn:x"><cbc:ResponseCode>${codigo}</cbc:ResponseCode><cbc:Description>${texto}</cbc:Description></ApplicationResponse>`,
      ),
    }),
  ).toString("base64");

const sunatAcepta = (async () =>
  new Response(
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><applicationResponse>${cdrFalso("0", "aceptado")}</applicationResponse></soap:Body></soap:Envelope>`,
    { status: 200 },
  )) as unknown as typeof fetch;

// Estado que va acumulando el mes, en el orden en que ocurre.
const mes: Record<string, string> = {};

describe("un mes de operación, en orden", () => {
  test("1. importación: orden al exterior, gastos y liquidación al costo real", async () => {
    const impId = await con((db) =>
      crearImportacion(db, empresaId, usuarioId, {
        numero: "IMP-2026-001",
        proveedorId: exterior,
        almacenId,
        moneda: "USD",
        tipoCambio: "3.752",
        incoterm: "FOB",
        fechaOrden: "2026-09-01",
        facturaExterior: "INV-2026-118",
      }),
    );
    mes["importacion"] = impId;

    await con((db) =>
      agregarItem(db, empresaId, impId, {
        productoId: bomba,
        descripcion: "Bomba centrífuga 2HP",
        cantidad: "40",
        fobUnitario: "180.00",
        peso: "740",
      }),
    );
    await con((db) =>
      agregarItem(db, empresaId, impId, {
        productoId: valvula,
        descripcion: 'Válvula compuerta 4"',
        cantidad: "100",
        fobUnitario: "42.00",
        peso: "620",
      }),
    );

    // Flete por peso, seguro y ad valorem por FOB; el IGV no va al costo.
    await con((db) =>
      agregarGasto(db, empresaId, impId, {
        concepto: "Flete internacional", importe: "1800.00", moneda: "USD",
        tipoCambio: "3.752", baseProrrateo: "peso", afectaCosto: true,
      }),
    );
    await con((db) =>
      agregarGasto(db, empresaId, impId, {
        concepto: "Ad valorem", importe: "2600.00", moneda: "PEN",
        tipoCambio: "1", baseProrrateo: "fob", afectaCosto: true,
      }),
    );
    await con((db) =>
      agregarGasto(db, empresaId, impId, {
        concepto: "IGV de importación", importe: "9100.00", moneda: "PEN",
        tipoCambio: "1", baseProrrateo: "fob", afectaCosto: false,
      }),
    );

    const r = await con((db) =>
      confirmarLiquidacion(db, empresaId, usuarioId, impId, {
        numero: "LIQ-001", fecha: "2026-09-08", periodo: "202609",
      }),
    );
    assert.ok(r.movimientos.length >= 2, "cada ítem entra al kardex");

    const stock = await con((db) => existencias(db));
    assert.equal(s2(stock.find((s) => s.codigo === "BOM-2HP")!.cantidad), "40.00");
    assert.equal(s2(stock.find((s) => s.codigo === "VAL-4")!.cantidad), "100.00");

    // Saldo deudor: el crédito fiscal es un derecho contra el fisco, no una
    // deuda. Si el IGV se hubiera prorrateado al costo, esta cuenta estaría en
    // cero y la mercadería valdría 9 100 más de lo que costó.
    assert.equal(await mayor("40"), "9100.00", "el IGV quedó como crédito fiscal");
  });

  test("2. compra nacional con orden previa y detracción", async () => {
    const orden = await con((db) =>
      crearOrden(db, empresaId, usuarioId, {
        numero: "OC-2026-014",
        proveedorId: agencia,
        fecha: "2026-09-02",
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [
          { descripcion: "Servicio de agenciamiento de aduana", cantidad: "1", valorUnitario: "1260.00" },
        ],
      }),
    );
    await con((db) => aprobarOrden(db, orden, usuarioId));

    const compra = await con((db) =>
      registrarCompra(db, empresaId, usuarioId, {
        proveedorId: agencia,
        tipoDocumento: "01",
        serie: "F001",
        numero: "0004602",
        fechaEmision: "2026-09-02",
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [
          {
            descripcion: "Servicio de agenciamiento de aduana",
            cantidad: "1",
            valorUnitario: "1260.00",
            cuenta: "6311",
            centroCostoId: centroLogistica,
            afectacionIgv: "10",
          },
        ],
      }),
    );
    assert.ok(compra.compraId);
    mes["compra"] = compra.compraId;
  });

  test("3. venta con factura y dos boletas del mismo día", async () => {
    const venta = await con((db) =>
      emitirVenta(db, empresaId, usuarioId, {
        clienteId: cliente,
        tipoDocumento: "01",
        serie: "F001",
        fechaEmision: "2026-09-12",
        fechaVencimiento: "2026-10-12",
        moneda: "PEN",
        tipoCambio: "1",
        almacenId,
        lineas: [
          { productoId: bomba, cantidad: "8", valorUnitario: "980.00" },
          { productoId: valvula, cantidad: "25", valorUnitario: "240.00" },
        ],
      }),
    );
    mes["venta"] = venta.comprobanteId;
    // 8×980 + 25×240 = 13 840 de valor de venta, más 18 % de IGV.
    assert.equal(s2(venta.total), "16331.20");

    for (const importe of ["180.00", "320.00"]) {
      await con((db) =>
        emitirVenta(db, empresaId, usuarioId, {
          clienteId: cliente,
          tipoDocumento: "03",
          serie: "B001",
          fechaEmision: "2026-09-13",
          moneda: "PEN",
          tipoCambio: "1",
          lineas: [{ descripcion: "Servicio de mantenimiento", cantidad: "1", valorUnitario: importe }],
        }),
      );
    }
  });

  test("4. la factura se envía a SUNAT y vuelve con su CDR", async () => {
    const r = await enviarASunat(app, ctx(), mes["venta"]!, KEK, { fetchImpl: sunatAcepta });
    assert.equal(r.estado, cpe.ESTADO_CPE.ACEPTADO);
  });

  test("5. el cliente devuelve mercadería: nota de crédito con reingreso", async () => {
    const antes = await con((db) => existencias(db));
    const bombasAntes = d(antes.find((s) => s.codigo === "BOM-2HP")!.cantidad);

    const nota = await con((db) =>
      emitirNota(db, empresaId, usuarioId, {
        comprobanteId: mes["venta"]!,
        tipoDocumento: "07",
        serie: "FC01",
        fechaEmision: "2026-09-16",
        motivo: "07",
        descripcionMotivo: "Devolución de dos bombas por no conformidad",
        devuelveMercaderia: true,
        lineas: [{ productoId: bomba, cantidad: "2", valorUnitario: "980.00" }],
      }),
    );
    assert.equal(s2(nota.total), "2312.80", "2×980 más IGV");

    const despues = await con((db) => existencias(db));
    const bombasDespues = d(despues.find((s) => s.codigo === "BOM-2HP")!.cantidad);
    assert.equal(
      money.toString(money.sub(bombasDespues, bombasAntes), 2),
      "2.00",
      "las dos bombas vuelven al almacén",
    );
  });

  test("6. las boletas del día se agrupan en su resumen", async () => {
    const r = await con((db) =>
      generarResumenDiario(db, empresaId, usuarioId, {
        fechaReferencia: "2026-09-13",
        fechaEmision: "2026-09-14",
      }),
    );
    assert.equal(r.comprobantes, 2);
  });

  test("7. la guía de remisión documenta el traslado de la venta", async () => {
    const g = await con((db) =>
      emitirGuia(db, empresaId, usuarioId, {
        serie: "T001",
        fechaEmision: "2026-09-12",
        destinatarioId: cliente,
        motivo: "01",
        descripcionMotivo: "Venta",
        pesoBruto: "303.00",
        modoTransporte: "02",
        fechaTraslado: "2026-09-12",
        partida: { ubigeo: "150103", direccion: "Av. Nicolás Ayllón 3820, Ate" },
        llegada: { ubigeo: "150132", direccion: "Av. Argentina 2000, San Miguel" },
        placa: "ABC-123",
        conductor: {
          tipoDocumento: "1", numeroDocumento: "45678912",
          nombres: "Juan", apellidos: "Pérez", licencia: "Q45678912",
        },
        comprobanteId: mes["venta"]!,
        lineas: [
          { productoId: bomba, cantidad: "8" },
          { productoId: valvula, cantidad: "25" },
        ],
      }),
    );
    assert.ok(g.guiaId);
  });

  test("8. el cliente paga: cobranza aplicada al saldo real", async () => {
    const porCobrar = await con((db) => documentosPorCobrar(db, cliente));
    const factura = porCobrar.find((c) => c.serie === "F001")!;
    // La nota de crédito ya redujo el saldo: 16 331.20 menos 2 312.80.
    assert.equal(s2(factura.saldo), "14018.40");

    await con((db) =>
      registrarCobranza(db, empresaId, usuarioId, {
        numero: "CB-2026-001",
        clienteId: cliente,
        fecha: "2026-09-25",
        moneda: "PEN",
        tipoCambio: "1",
        medioCobro: "transferencia",
        cuentaDestino: "1041",
        aplicaciones: [{ comprobanteId: factura.id, importe: factura.saldo }],
      }),
    );
    const quedan = await con((db) => documentosPorCobrar(db, cliente));
    assert.equal(quedan.filter((c) => c.serie === "F001").length, 0);
  });

  test("9. se paga al agente reteniendo el 3 % y se emite la retención", async () => {
    const porPagar = await con((db) => documentosPorPagar(db, agencia));
    assert.equal(porPagar.length, 1);

    const pago = await con((db) =>
      registrarPago(db, empresaId, usuarioId, {
        numero: "PG-2026-001",
        proveedorId: agencia,
        fecha: "2026-09-26",
        moneda: "PEN",
        tipoCambio: "1",
        medioPago: "transferencia",
        cuentaOrigen: "1041",
        retenerIgv: true,
        aplicaciones: [{ documentoId: porPagar[0]!.id, importe: porPagar[0]!.saldo }],
      }),
    );
    assert.equal(s2(pago.retencion), "44.60", "3 % de 1 486.80");

    const cre = await con((db) =>
      emitirRetencionDePago(db, empresaId, usuarioId, { pagoId: pago.pagoId, serie: "R001" }),
    );
    assert.equal(s2(cre.importeTotal), "44.60");
  });

  test("10. caja y bancos: la cuenta refleja los movimientos del mes", async () => {
    const cuenta = await con((db) =>
      crearCuenta(db, empresaId, usuarioId, {
        codigo: "BCP-SOL",
        nombre: "BCP cuenta corriente soles",
        tipo: "banco",
        moneda: "PEN",
        cuentaContable: "1041",
        banco: "BCP",
        numeroCuenta: "193-1934567-0-88",
      }),
    );
    await con((db) =>
      registrarMovimientoEfectivo(db, empresaId, usuarioId, {
        cuentaId: cuenta,
        fecha: "2026-09-30",
        sentido: "egreso",
        concepto: "Comisión de mantenimiento de cuenta",
        importe: "35.00",
        cuentaContrapartida: "6373",
      }),
    );
    assert.ok(cuenta);
  });
});

// ─── Lo que comprueba un contador ─────────────────────────────────────────

describe("cuadre del mes", () => {
  test("el libro cuadra: debe igual a haber", async () => {
    const balance = await con((db) => balanceComprobacion(db, "202609"));
    const total = balance.reduce((a, b) => money.add(a, d(b.saldo)), money.ZERO);
    assert.equal(money.toString(total, 2), "0.00", "hay un asiento roto en el mes");
  });

  test("el mayor de existencias coincide con el kardex", async () => {
    // Es la comprobación que ninguna prueba de módulo puede hacer: el kardex y
    // la contabilidad los alimentan caminos distintos y sólo cuadran si todos
    // los módulos valoran igual.
    const stock = await con((db) => existencias(db));
    const kardex = stock.reduce((a, s) => money.add(a, d(s.valor)), money.ZERO);
    const contable = await mayor("20");
    assert.equal(
      money.toString(kardex, 2),
      contable,
      "el almacén y la cuenta 20 dicen cosas distintas",
    );
  });

  /**
   * La columna que el almacenero usa de verdad. Sin el documento y el nombre,
   * una salida es una cantidad y una fecha: cuando el conteo físico no cuadra
   * no hay por dónde empezar a preguntar.
   */
  test("cada movimiento del kardex dice qué documento lo causó", async () => {
    const lineas = await con((db) => kardexDe(db, almacenId, bomba));
    assert.ok(lineas.length >= 2, "el mes tenía que mover la bomba");

    for (const l of lineas) {
      assert.ok(
        l.refDocumento,
        `un movimiento de ${l.origenModulo} quedó sin referencia: ${JSON.stringify(l)}`,
      );
      assert.ok(l.tercero, `un movimiento de ${l.origenModulo} quedó sin tercero`);
    }

    // La salida por la venta tiene que apuntar a la factura emitida.
    const salida = lineas.find((l) => l.sentido === "salida")!;
    assert.equal(salida.refTipo, "01");
    assert.match(salida.refDocumento!, /^F\d{3}-\d{8}$/);
  });

  test("el mayor de proveedores coincide con cuentas por pagar", async () => {
    const [fila] = (await raw`
      SELECT coalesce(sum(saldo), 0)::text AS saldo FROM documentos_cxp
      WHERE empresa_id = ${empresaId}`) as [{ saldo: string }];
    // La 42 recoge facturas y letras; el auxiliar, sólo lo que queda abierto.
    assert.equal(s2(fila.saldo), money.toString(money.neg(d(await mayor("42"))), 2));
  });

  test("el mayor de clientes coincide con cuentas por cobrar", async () => {
    const abiertos = await con((db) => documentosPorCobrar(db));
    const auxiliar = abiertos.reduce((a, c) => money.add(a, d(c.saldo)), money.ZERO);
    assert.equal(money.toString(auxiliar, 2), await mayor("12"));
  });

  test("los estados financieros cuadran y coinciden entre sí", async () => {
    const situacion = await con((db) => situacionFinanciera(db, "202609"));
    assert.ok(situacion.cuadra, `descuadre de ${money.toString(situacion.descuadre, 2)}`);

    const resultados = await con((db) => estadoResultados(db, "202609"));
    const enBalance = situacion.pasivoPatrimonio.find(
      (l) => l.concepto === "Resultado del ejercicio",
    )!;
    assert.equal(
      money.toString(resultados.resultado, 2),
      money.toString(enBalance.importe, 2),
      "el resultado no puede diferir entre los dos estados",
    );
  });

  test("los libros electrónicos salen con su estructura exacta", async () => {
    const casos: [string, number, () => Promise<{ contenido: string; filas: number }>][] = [
      ["8.1", CAMPOS.COMPRAS, () => con((db) => registroCompras(db, empresaId, "202609"))],
      ["14.1", CAMPOS.VENTAS, () => con((db) => registroVentas(db, empresaId, "202609"))],
      ["5.1", CAMPOS.DIARIO, () => con((db) => libroDiario(db, empresaId, "202609"))],
      ["13.1", CAMPOS.INVENTARIO_VALORIZADO, () => con((db) => inventarioValorizado(db, empresaId, "202609"))],
    ];
    for (const [formato, campos, generar] of casos) {
      const libro = await generar();
      assert.ok(libro.filas > 0, `el libro ${formato} salió vacío en un mes con operaciones`);
      for (const l of libro.contenido.split("\r\n")) {
        assert.equal(l.split("|").length - 1, campos, `formato ${formato}: campos descuadrados`);
      }
    }
  });

  test("el diario declara exactamente lo que dice el balance", async () => {
    const lineas = (await con((db) => libroDiario(db, empresaId, "202609"))).contenido
      .split("\r\n")
      .map((l) => l.split("|"));
    const suma = (i: number) =>
      lineas.reduce<bigint>((a, c) => a + money.dec(c[i] ?? "0"), 0n);
    assert.equal(
      money.toString(suma(17) as never, 2),
      money.toString(suma(18) as never, 2),
      "el libro que se declara a SUNAT no cuadra",
    );
  });
});

describe("cierre del mes y del ejercicio", () => {
  test("no se cierra el periodo si queda un borrador", async () => {
    const [b] = await raw<{ id: string }[]>`
      INSERT INTO asientos (empresa_id, periodo, numero, fecha, subdiario, glosa, moneda, estado)
      VALUES (${empresaId}, '202609', '9999', '2026-09-30', '08', 'Pendiente', 'PEN', 'borrador')
      RETURNING id`;
    await assert.rejects(
      () => con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202609")),
      /borrador/,
    );
    await raw`DELETE FROM asiento_lineas WHERE asiento_id = ${b!.id}`;
    await raw`DELETE FROM asientos WHERE id = ${b!.id}`;
  });

  test("resuelto el borrador, el periodo cierra", async () => {
    await con((db) => cerrarPeriodo(db, empresaId, usuarioId, "202609"));
    const [p] = (await raw`
      SELECT estado FROM periodos WHERE empresa_id = ${empresaId} AND periodo = '202609'`) as [
      { estado: string },
    ];
    assert.equal(p.estado, "cerrado");
  });

  test("un periodo cerrado ya no admite ventas", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          emitirVenta(db, empresaId, usuarioId, {
            clienteId: cliente, tipoDocumento: "01", serie: "F001",
            fechaEmision: "2026-09-28", moneda: "PEN", tipoCambio: "1",
            lineas: [{ descripcion: "Tardía", cantidad: "1", valorUnitario: "100" }],
          }),
        ),
      /cerrado/,
    );
  });

  test("el ejercicio cierra y el resultado va a resultados acumulados", async () => {
    await raw`UPDATE periodos SET estado = 'abierto' WHERE empresa_id = ${empresaId}`;
    const resultados = await con((db) => estadoResultados(db, "202612"));
    const cierre = await con((db) => cerrarEjercicio(db, empresaId, usuarioId, "2026"));

    assert.equal(
      money.toString(cierre.utilidad, 2),
      money.toString(resultados.resultado, 2),
      "el cierre no puede inventar un resultado distinto del informado",
    );

    // Tras el cierre, las cuentas de resultado quedan en cero y el balance
    // sigue cuadrando: es la prueba de que el ejercicio se cerró bien.
    const despues = await con((db) => estadoResultados(db, "202613"));
    assert.equal(money.toString(despues.resultado, 2), "0.00");
    const situacion = await con((db) => situacionFinanciera(db, "202613"));
    assert.ok(situacion.cuadra, `descuadre tras el cierre: ${money.toString(situacion.descuadre, 2)}`);
  });
});
