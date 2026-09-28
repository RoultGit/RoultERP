/**
 * Control documental y reportes de conjunto de importaciones.
 *
 * Las dos cosas que el cliente pidió en las preguntas 16 y 17, contra Postgres
 * real. Lo que se fija aquí no es que las consultas corran, es que digan lo que
 * hay que decidir: a quién se llama hoy porque su embarque se retrasó, y qué
 * papel falta antes de que la agencia lo pida.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import {
  crearEmpresa, crearImportacion, agregarItem, agregarGasto, cambiarEstado,
  confirmarLiquidacion,
  expedienteDe, registrarDocumento, olvidarDocumento, DocumentoInvalido,
  pendientesDeLlegar, gastoPorAgencia, comprasPorProveedorExterior, articulosMasImportados,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacenId = "";
let ningbo = "";
let shanghai = "";
let agencia = "";
let naviera = "";
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
    { ruc: "20303051831", razonSocial: "SERVIDIMAR S.A.C.", metodoValorizacion: "promedio" },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;

  const [alm] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacenId = alm!.id;

  const tercero = async (doc: string, nombre: string, pais: string, domiciliado: boolean) => {
    const [t] = await raw<{ id: string }[]>`
      INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                            pais, es_proveedor, es_domiciliado)
      VALUES (${empresaId}, ${domiciliado ? "6" : "0"}, ${doc}, ${nombre}, ${pais},
              true, ${domiciliado})
      RETURNING id`;
    return t!.id;
  };
  ningbo = await tercero("CN-8891", "NINGBO TRADING CO. LTD", "CN", false);
  shanghai = await tercero("CN-2210", "SHANGHAI VALVE WORKS", "CN", false);
  agencia = await tercero("20512333338", "AGENCIA DE ADUANAS DEL SUR S.A.C.", "PE", true);
  naviera = await tercero("20477771117", "TRANSPORTES MARITIMOS ANDINOS S.A.", "PE", true);

  const [unidad] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  for (const [codigo, descripcion, peso] of [
    ["P001", "Bomba centrífuga 2HP", "12.5"],
    ["P002", "Válvula de bronce 2\"", "1.8"],
  ] as const) {
    const [p] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id, peso_unitario)
      VALUES (${empresaId}, ${codigo}, ${descripcion}, ${unidad!.id}, ${peso})
      RETURNING id`;
    productos[codigo] = p!.id;
  }
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);

/**
 * Un embarque de 100 bombas a USD 50, tipo de cambio 3.75: S/ 18 750 de FOB.
 *
 * La fecha de llegada pactada se fija después de que la transacción cierre. Con
 * el `UPDATE` dentro, corre por otra conexión sobre una fila que todavía no está
 * confirmada y no afecta a nada: la primera versión de esta prueba pasaba por
 * eso, con todos los retrasos saliendo nulos.
 */
async function embarque(
  numero: string,
  proveedorId: string,
  fechaOrden: string,
  extra: { fechaLlegada?: string } = {},
): Promise<string> {
  const id = await con(async (db) => {
    const nuevo = await crearImportacion(db, empresaId, usuarioId, {
      numero, proveedorId, almacenId, moneda: "USD", tipoCambio: "3.75",
      incoterm: "FOB", fechaOrden, puertoOrigen: "NINGBO",
    });
    await agregarItem(db, empresaId, nuevo, {
      productoId: productos["P001"]!, descripcion: "Bomba centrífuga 2HP",
      cantidad: "100", fobUnitario: "50",
    });
    return nuevo;
  });
  if (extra.fechaLlegada) {
    await raw`UPDATE importaciones SET fecha_llegada = ${extra.fechaLlegada} WHERE id = ${id}`;
  }
  return id;
}

/** Lleva el embarque hasta nacionalizada, que es el hito que exige los papeles. */
async function nacionalizar(id: string): Promise<void> {
  for (const e of ["aprobada", "en_transito", "en_aduana", "nacionalizada"] as const) {
    await con((db) => cambiarEstado(db, id, e, { duaNumero: "118-2026-10-001234" }));
  }
}

/** Liquida el embarque con el número y el periodo que pide el servicio. */
async function liquidar(id: string, numero = "LIQ-001"): Promise<void> {
  await con((db) =>
    confirmarLiquidacion(db, empresaId, usuarioId, id, {
      numero, fecha: "2026-09-20", periodo: "202609",
    }),
  );
}

// ─── Control documental ───────────────────────────────────────────────────

describe("expediente documental del embarque", () => {
  test("un embarque nuevo no debe nada todavía, pero sabe qué va a deber", async () => {
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    const e = await con((db) => expedienteDe(db, id));

    assert.equal(e.hito, "embarque");
    assert.equal(e.completo, true, "recién ordenado no falta nada exigible");
    assert.ok(
      e.pendientes.some((d) => d.clave === "factura_exterior"),
      "pero ya sabe que la factura del exterior hará falta",
    );
    // El catálogo entero se enseña siempre: la pantalla es una lista de acuse,
    // no sólo un aviso de lo que falta.
    assert.equal(e.filas.length, 9);
    assert.ok(e.filas.every((f) => f.recibidoEn === null));
  });

  test("nacionalizar sin los papeles los pone en rojo, y registrarlos los apaga", async () => {
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    await nacionalizar(id);

    const antes = await con((db) => expedienteDe(db, id));
    assert.equal(antes.hito, "numeracion");
    assert.deepEqual(
      antes.vencidos.map((d) => d.clave).sort(),
      ["conocimiento_embarque", "factura_exterior", "packing_list"],
      "los tres que la aduana necesitaba antes de numerar",
    );

    for (const [tipo, referencia] of [
      ["factura_exterior", "NB-4417"],
      ["conocimiento_embarque", "MSCU-778812"],
      ["packing_list", "PL-4417"],
    ] as const) {
      await con((db) =>
        registrarDocumento(db, empresaId, usuarioId, {
          importacionId: id, tipo, referencia, recibidoEn: "2026-09-10",
        }),
      );
    }

    const despues = await con((db) => expedienteDe(db, id));
    assert.equal(despues.completo, true);
    const bl = despues.filas.find((f) => f.clave === "conocimiento_embarque")!;
    assert.equal(bl.referencia, "MSCU-778812");
    assert.equal(bl.recibidoEn, "2026-09-10");
    assert.equal(bl.vencido, false);
  });

  test("volver a registrar el mismo documento lo corrige, no lo duplica", async () => {
    // El flujo real: se anota que se espera el B/L y días después llega con su
    // número. Si insertara una fila nueva, el cuadro diría que llegó y no llegó.
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    await con((db) =>
      registrarDocumento(db, empresaId, usuarioId, {
        importacionId: id, tipo: "conocimiento_embarque", observaciones: "lo manda el lunes",
      }),
    );
    await con((db) =>
      registrarDocumento(db, empresaId, usuarioId, {
        importacionId: id, tipo: "conocimiento_embarque",
        referencia: "MSCU-778812", recibidoEn: "2026-09-12",
      }),
    );

    const [{ n }] = await raw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM importacion_documentos WHERE importacion_id = ${id}`;
    assert.equal(n, 1);
    const e = await con((db) => expedienteDe(db, id));
    const bl = e.filas.find((f) => f.clave === "conocimiento_embarque")!;
    assert.equal(bl.recibidoEn, "2026-09-12");
    assert.equal(bl.observaciones, null, "el registro nuevo reemplaza al anterior entero");
  });

  test("no aplicable y recibido a la vez se rechaza", async () => {
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    await assert.rejects(
      () =>
        con((db) =>
          registrarDocumento(db, empresaId, usuarioId, {
            importacionId: id, tipo: "certificado_origen",
            noAplica: true, recibidoEn: "2026-09-01",
          }),
        ),
      DocumentoInvalido,
    );
  });

  test("un documento inventado se rechaza en vez de guardarse", async () => {
    // Sin esto, una errata en el nombre crearía una fila que ninguna pantalla
    // vuelve a mostrar: el documento quedaría «registrado» e invisible.
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    await assert.rejects(
      () =>
        con((db) =>
          registrarDocumento(db, empresaId, usuarioId, {
            importacionId: id, tipo: "packing_lst", recibidoEn: "2026-09-01",
          }),
        ),
      DocumentoInvalido,
    );
  });

  test("olvidar la anotación no es lo mismo que marcarla no aplicable", async () => {
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    await con((db) =>
      registrarDocumento(db, empresaId, usuarioId, {
        importacionId: id, tipo: "poliza_seguro", observaciones: "se pidió a la corredora",
      }),
    );
    // Un opcional anotado sí se espera.
    await con((db) => cambiarEstado(db, id, "aprobada"));
    await con((db) => cambiarEstado(db, id, "en_transito"));
    await con((db) => cambiarEstado(db, id, "en_aduana"));
    let e = await con((db) => expedienteDe(db, id));
    assert.ok(e.vencidos.some((d) => d.clave === "poliza_seguro"));

    await con((db) => olvidarDocumento(db, id, "poliza_seguro"));
    e = await con((db) => expedienteDe(db, id));
    assert.ok(!e.vencidos.some((d) => d.clave === "poliza_seguro"));
    assert.ok(!e.pendientes.some((d) => d.clave === "poliza_seguro"), "vuelve a ser invisible");
  });
});

// ─── Reportes de conjunto ─────────────────────────────────────────────────

describe("pendientes de llegar", () => {
  test("ordena por retraso y distingue «a tiempo» de «sin fecha»", async () => {
    const atrasado = await embarque("IMP-001", ningbo, "2026-06-01", {
      fechaLlegada: "2026-07-15",
    });
    const aTiempo = await embarque("IMP-002", shanghai, "2026-09-01", {
      fechaLlegada: "2026-11-30",
    });
    const sinFecha = await embarque("IMP-003", ningbo, "2026-08-15");

    const lista = await con((db) => pendientesDeLlegar(db, new Date("2026-09-26")));
    assert.equal(lista.length, 3);
    assert.equal(lista[0]!.id, atrasado, "el que más tarde va primero: es a quien se llama hoy");
    assert.equal(lista[0]!.diasRetraso, 73);

    const aT = lista.find((f) => f.id === aTiempo)!;
    assert.equal(aT.diasRetraso, 0);
    const sF = lista.find((f) => f.id === sinFecha)!;
    assert.equal(sF.diasRetraso, null, "«no se sabe cuándo» no es «llega a tiempo»");
    assert.equal(sF.diasEnCurso, 42);
  });

  test("el FOB sale en su moneda y en soles, y lo liquidado desaparece", async () => {
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    const [fila] = await con((db) => pendientesDeLlegar(db, new Date("2026-09-26")));
    // 100 × USD 50 = USD 5 000, al 3.75 = S/ 18 750.
    assert.equal(fila!.fob, "5000.00");
    assert.equal(fila!.fobSoles, "18750.00");

    await nacionalizar(id);
    await con((db) => agregarGasto(db, empresaId, id, {
      concepto: "Flete marítimo", importe: "1200", moneda: "USD", tipoCambio: "3.78",
      baseProrrateo: "peso", proveedorId: naviera, fecha: "2026-09-05",
    }));
    await liquidar(id);

    const despues = await con((db) => pendientesDeLlegar(db, new Date("2026-09-26")));
    assert.equal(despues.length, 0, "un embarque liquidado ya no es una pregunta abierta");
  });
});

describe("gasto por agencia de aduanas", () => {
  test("agrupa por proveedor y aparta lo recuperable del costo", async () => {
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    await con((db) => agregarGasto(db, empresaId, id, {
      concepto: "Agenciamiento de aduana", importe: "850", moneda: "PEN", tipoCambio: "1",
      baseProrrateo: "fob", proveedorId: agencia, fecha: "2026-09-02",
    }));
    await con((db) => agregarGasto(db, empresaId, id, {
      concepto: "Gastos operativos", importe: "420", moneda: "PEN", tipoCambio: "1",
      baseProrrateo: "fob", proveedorId: agencia, fecha: "2026-09-03",
    }));
    await con((db) => agregarGasto(db, empresaId, id, {
      concepto: "IGV de importación", importe: "3375", moneda: "PEN", tipoCambio: "1",
      baseProrrateo: "fob", afectaCosto: false, proveedorId: agencia, fecha: "2026-09-03",
    }));
    await con((db) => agregarGasto(db, empresaId, id, {
      concepto: "Flete marítimo", importe: "1200", moneda: "USD", tipoCambio: "3.78",
      baseProrrateo: "peso", proveedorId: naviera, fecha: "2026-09-05",
    }));

    const lista = await con((db) =>
      gastoPorAgencia(db, { desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    const ag = lista.find((f) => f.proveedorId === agencia)!;
    assert.equal(ag.importe, "1270.00", "850 + 420, sin el IGV");
    assert.equal(
      ag.importeRecuperable, "3375.00",
      "el IGV se declara aparte: es crédito fiscal, no lo que cobra la agencia",
    );
    assert.equal(ag.conceptos, 3);

    const nav = lista.find((f) => f.proveedorId === naviera)!;
    // USD 1 200 × 3.78: cada gasto lleva su propio tipo de cambio.
    assert.equal(nav.importe, "4536.00");
  });
});

describe("compras por proveedor del exterior y artículos importados", () => {
  test("el FOB y el costo puesto en almacén no se confunden", async () => {
    const id = await embarque("IMP-001", ningbo, "2026-08-01");
    await nacionalizar(id);
    await con((db) => agregarGasto(db, empresaId, id, {
      concepto: "Flete y agencia", importe: "1875", moneda: "PEN", tipoCambio: "1",
      baseProrrateo: "fob", proveedorId: agencia, fecha: "2026-09-05",
    }));
    await liquidar(id);

    // Un segundo embarque sin liquidar, para que se vea el contador.
    await embarque("IMP-002", ningbo, "2026-09-01");

    const rango = { desde: "2026-01-01", hasta: "2026-12-31" };
    const [prov] = await con((db) => comprasPorProveedorExterior(db, rango));
    assert.equal(prov!.proveedor, "NINGBO TRADING CO. LTD");
    assert.equal(prov!.pais, "CN");
    assert.equal(prov!.embarques, 2);
    assert.equal(prov!.embarquesLiquidados, 1, "sin este contador la cifra engañaría");
    assert.equal(prov!.fobSoles, "37500.00", "dos embarques de S/ 18 750");
    // Sólo el liquidado: FOB 18 750 + gastos 1 875.
    assert.equal(prov!.costoAlmacen, "20625.00");

    const [art] = await con((db) => articulosMasImportados(db, rango));
    assert.equal(art!.codigo, "P001");
    assert.equal(art!.cantidad, "200.00", "cien de cada embarque");
    assert.equal(art!.cantidadLiquidada, "100.00");
    // 20 625 sobre 18 750 son diez puntos: es el encarecimiento del viaje, y se
    // mide sólo contra el FOB del embarque liquidado.
    assert.equal(art!.sobrecosto, "10.00");
  });

  test("sin nada liquidado el sobrecosto sale en blanco, no en cero", async () => {
    // Un cero diría «importar no encarece nada», que es lo contrario de «aún no
    // se sabe». Es la diferencia entre un hueco y una cifra inventada.
    await embarque("IMP-001", ningbo, "2026-08-01");
    const [art] = await con((db) =>
      articulosMasImportados(db, { desde: "2026-01-01", hasta: "2026-12-31" }),
    );
    assert.equal(art!.sobrecosto, null);
    assert.equal(art!.costoAlmacen, "0.00");
  });
});
