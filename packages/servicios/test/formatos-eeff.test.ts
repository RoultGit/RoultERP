/**
 * Formatos configurables de estados financieros.
 *
 * Lo que se comprueba, sobre todo, es la salvaguarda: un formato **delata lo
 * que deja fuera**. Sin eso, configurar una plantilla sería la forma más fácil
 * de hacer desaparecer dinero de un balance sin que nadie lo note.
 *
 * Y lo segundo: que el formato de partida diga exactamente lo mismo que el
 * estado que el programa traía cableado. Si no, cambiar de plantilla cambiaría
 * las cifras, y entonces el formato no es presentación sino aritmética.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, registrarCompra, emitirVenta, asentar,
  situacionFinanciera, estadoResultados,
  guardarFormato, listarFormatos, cargarFormato, eliminarFormato,
  generarEstado, prefijosDe, sincronizarFormatos, formatoPredeterminado,
  FormatoInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let cliente = "";
let proveedor = "";
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

/** Un mes con compra y venta, para que los estados tengan algo que decir. */
async function movimiento() {
  await con((db) =>
    registrarCompra(db, empresaId, usuarioId, {
      proveedorId: proveedor, tipoDocumento: "01", serie: "F001", numero: "0000001",
      fechaEmision: "2026-09-01", moneda: "PEN", tipoCambio: "1", almacenId: almacen,
      lineas: [{ productoId: producto, descripcion: "Bomba", cantidad: "100", valorUnitario: "100" }],
    }),
  );
  await con((db) =>
    emitirVenta(db, empresaId, usuarioId, {
      clienteId: cliente, tipoDocumento: "01", serie: "F001",
      fechaEmision: "2026-09-15", moneda: "PEN", tipoCambio: "1", almacenId: almacen,
      lineas: [{ productoId: producto, cantidad: "40", valorUnitario: "180" }],
    }),
  );
}

const buscar = (renglones: { codigo: string | null; importe: string }[], codigo: string) =>
  renglones.find((r) => r.codigo === codigo)?.importe;

const idDe = async (codigo: string) => {
  const lista = await con((db) => listarFormatos(db));
  return lista.find((f) => f.codigo === codigo)!.id;
};

// ─── Selección de cuentas ─────────────────────────────────────────────────

describe("selección de cuentas", () => {
  test("expande rangos de prefijos", () => {
    assert.deepEqual(prefijosDe("12-18"), ["12", "13", "14", "15", "16", "17", "18"]);
    assert.deepEqual(prefijosDe("10, 40111"), ["10", "40111"]);
    assert.deepEqual(prefijosDe("60-62, 69"), ["60", "61", "62", "69"]);
  });

  test("conserva el relleno de ceros", () => {
    assert.deepEqual(prefijosDe("08-10"), ["08", "09", "10"]);
  });

  test("rechaza un rango que mezcla largos", () => {
    assert.throws(() => prefijosDe("12-1899"), /distinto largo/);
  });

  test("rechaza un rango al revés", () => {
    assert.throws(() => prefijosDe("18-12"), /al revés/);
  });

  test("sin cuentas devuelve nada", () => {
    assert.deepEqual(prefijosDe(null), []);
    assert.deepEqual(prefijosDe("  "), []);
  });
});

// ─── Formatos de partida ──────────────────────────────────────────────────

describe("formatos de partida", () => {
  test("cada empresa nace con los dos", async () => {
    const lista = await con((db) => listarFormatos(db));
    assert.deepEqual(lista.map((f) => f.codigo).sort(), ["EFS", "ERN"]);
    assert.ok(lista.every((f) => f.esPredeterminado));
    assert.ok(lista.every((f) => Number(f.renglones) > 0));
  });

  /**
   * Si el formato de partida no dijera lo mismo que el estado cableado,
   * cambiar de plantilla cambiaría las cifras: el formato sería aritmética y no
   * presentación.
   */
  test("el de situación dice lo mismo que el estado cableado", async () => {
    await movimiento();
    const cableado = await con((db) => situacionFinanciera(db, "202609"));
    const generado = await con(async (db) => generarEstado(db, await idDe("EFS"), "202609"));

    const totalCableado = cableado.activo.find((l) => l.concepto === "TOTAL ACTIVO")!.importe;
    assert.equal(
      buscar(generado.renglones, "total_activo"),
      money.toString(totalCableado, 2),
    );
    assert.equal(
      buscar(generado.renglones, "total_pas_pat"),
      money.toString(totalCableado, 2),
      "el generado tiene que cuadrar igual que el cableado",
    );
    assert.equal(
      buscar(generado.renglones, "existencias"),
      money.toString(
        cableado.activo.find((l) => l.concepto === "Existencias")!.importe,
        2,
      ),
    );
  });

  test("el de resultados dice lo mismo que el estado cableado", async () => {
    await movimiento();
    const cableado = await con((db) => estadoResultados(db, "202609"));
    const generado = await con(async (db) => generarEstado(db, await idDe("ERN"), "202609"));

    assert.equal(buscar(generado.renglones, "resultado"), money.toString(cableado.resultado, 2));
    const bruta = cableado.lineas.find((l) => /utilidad bruta/i.test(l.concepto))!;
    assert.equal(buscar(generado.renglones, "bruta"), money.toString(bruta.importe, 2));
  });

  test("no deja el balance sin clasificar", async () => {
    await movimiento();
    const generado = await con(async (db) => generarEstado(db, await idDe("EFS"), "202609"));
    assert.deepEqual(
      generado.sinClasificar,
      [],
      `el formato de partida deja cuentas fuera: ${JSON.stringify(generado.sinClasificar)}`,
    );
  });

  test("sincronizar no pisa lo que ya existe", async () => {
    const r = await con((db) => sincronizarFormatos(db, empresaId, usuarioId));
    assert.deepEqual(r.agregados, []);
  });

  /**
   * El papel se añadió después de que hubiera empresas creadas, y sus formatos
   * de partida se quedaron sin él: con el formato ya existente, sincronizar no
   * hacía nada y no salía ni un ratio. Es el mismo agujero que tenían las
   * cuentas nuevas del plan.
   */
  test("sincronizar completa los papeles que el formato viejo no tenía", async () => {
    await raw`UPDATE formato_eeff_lineas SET papel = NULL WHERE empresa_id = ${empresaId}`;

    const r = await con((db) => sincronizarFormatos(db, empresaId, usuarioId));
    assert.deepEqual(r.agregados, [], "no debía crear formatos nuevos");
    assert.ok(r.completados.includes("EFS.activo_corriente"), r.completados.join(", "));

    const estado = await con(async (db) => generarEstado(db, await idDe("EFS"), "202609"));
    assert.ok(estado.renglones.some((x) => x.papel === "pasivo_corriente"));
  });

  /** Un papel puesto a mano es una decisión del contador, no un hueco. */
  test("sincronizar no mueve un papel que el contador ya colocó", async () => {
    await raw`
      UPDATE formato_eeff_lineas SET papel = NULL
      WHERE empresa_id = ${empresaId} AND papel = 'activo_corriente'`;
    const [otra] = await raw<{ id: string }[]>`
      UPDATE formato_eeff_lineas SET papel = 'activo_corriente'
      WHERE id = (
        SELECT l.id FROM formato_eeff_lineas l
        JOIN formatos_eeff f ON f.id = l.formato_id
        WHERE f.codigo = 'EFS' AND l.papel IS NULL AND l.clase = 'detalle'
        ORDER BY l.orden LIMIT 1)
      RETURNING id`;

    await con((db) => sincronizarFormatos(db, empresaId, usuarioId));

    const [quien] = await raw<{ id: string }[]>`
      SELECT l.id FROM formato_eeff_lineas l
      JOIN formatos_eeff f ON f.id = l.formato_id
      WHERE f.codigo = 'EFS' AND l.papel = 'activo_corriente'`;
    assert.equal(quien!.id, otra!.id);
  });

  test("el predeterminado es el que se ofrece primero", async () => {
    const id = await con((db) => formatoPredeterminado(db, "situacion"));
    assert.equal(id, await idDe("EFS"));
  });
});

// ─── La salvaguarda ───────────────────────────────────────────────────────

describe("cuentas sin clasificar", () => {
  /**
   * La razón de ser del módulo: una plantilla que olvida un grupo de cuentas no
   * puede pasar desapercibida.
   */
  test("un formato que olvida cuentas lo dice", async () => {
    await movimiento();
    await con((db) =>
      guardarFormato(db, empresaId, usuarioId, {
        codigo: "PARCIAL",
        nombre: "Sólo el efectivo",
        tipo: "situacion",
        lineas: [{ codigo: "caja", concepto: "Efectivo", cuentas: "10" }],
      }),
    );

    const generado = await con(async (db) => generarEstado(db, await idDe("PARCIAL"), "202609"));
    assert.ok(generado.sinClasificar.length > 0, "no delató las cuentas que deja fuera");
    assert.ok(generado.sinClasificar.some((c) => c.cuenta.startsWith("20")));
    // El neto puede dar cero —el balance cuadra, y lo omitido se compensa entre
    // sí—, así que lo que delata el olvido es la lista, no la suma.
    assert.ok(generado.sinClasificar.length > 3);
  });

  test("una cuenta con saldo cero no se cuenta como olvidada", async () => {
    await con((db) =>
      asentar(db, empresaId, usuarioId, {
        periodo: "202609", fecha: "2026-09-10", subdiario: "01",
        glosa: "Traspaso entre bancos", moneda: "PEN", tipoCambio: "1",
        lineas: [
          { cuenta: "1041", glosa: "Sale", haber: "500.00" },
          { cuenta: "1042", glosa: "Entra", debe: "500.00" },
        ],
      }),
    );
    // Las dos cuentas de la 10 quedan con saldo, pero el neto de la 104 es cero
    // y la plantilla recoge la 10 entera.
    const generado = await con(async (db) => generarEstado(db, await idDe("EFS"), "202609"));
    assert.deepEqual(generado.sinClasificar, []);
  });
});

// ─── Formatos propios ─────────────────────────────────────────────────────

describe("formatos propios", () => {
  const propio = () =>
    con((db) =>
      guardarFormato(db, empresaId, usuarioId, {
        codigo: "MIO",
        nombre: "Resultados resumido",
        tipo: "resultados",
        lineas: [
          { codigo: "ing", concepto: "Ingresos", cuentas: "70-79", signo: "acreedor" },
          { codigo: "gas", concepto: "Gastos", cuentas: "60-69", signo: "acreedor" },
          {
            codigo: "res",
            concepto: "Resultado",
            clase: "total",
            nivel: 0,
            suma: ["ing", "gas"],
          },
        ],
      }),
    );

  test("un formato propio da el mismo resultado que el de partida", async () => {
    await movimiento();
    await propio();
    const mio = await con(async (db) => generarEstado(db, await idDe("MIO"), "202609"));
    const base = await con(async (db) => generarEstado(db, await idDe("ERN"), "202609"));
    assert.equal(buscar(mio.renglones, "res"), buscar(base.renglones, "resultado"));
  });

  test("guardar dos veces reemplaza los renglones enteros", async () => {
    await propio();
    await con((db) =>
      guardarFormato(db, empresaId, usuarioId, {
        codigo: "MIO",
        nombre: "Resultados resumido",
        tipo: "resultados",
        lineas: [{ codigo: "ing", concepto: "Sólo ingresos", cuentas: "70", signo: "acreedor" }],
      }),
    );
    const { lineas } = await con(async (db) => cargarFormato(db, await idDe("MIO")));
    assert.equal(lineas.length, 1);
    assert.equal(lineas[0]!.concepto, "Sólo ingresos");
  });

  /** Referirse hacia adelante haría que el orden cambiara los importes. */
  test("un total sólo suma renglones anteriores", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarFormato(db, empresaId, usuarioId, {
            codigo: "MALO",
            nombre: "Adelantado",
            tipo: "resultados",
            lineas: [
              { codigo: "t", concepto: "Total", clase: "total", suma: ["ing"] },
              { codigo: "ing", concepto: "Ingresos", cuentas: "70", signo: "acreedor" },
            ],
          }),
        ),
      /no es ningún renglón anterior/,
    );
  });

  test("un detalle tiene que decir qué cuentas recoge", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarFormato(db, empresaId, usuarioId, {
            codigo: "MALO",
            nombre: "Sin cuentas",
            tipo: "resultados",
            lineas: [{ concepto: "Algo" }],
          }),
        ),
      /necesita decir qué cuentas recoge/,
    );
  });

  test("no admite códigos repetidos", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarFormato(db, empresaId, usuarioId, {
            codigo: "MALO",
            nombre: "Repetido",
            tipo: "resultados",
            lineas: [
              { codigo: "x", concepto: "Uno", cuentas: "70" },
              { codigo: "x", concepto: "Otro", cuentas: "60" },
            ],
          }),
        ),
      /está repetido/,
    );
  });

  test("rechaza un rango mal escrito con el número de renglón", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarFormato(db, empresaId, usuarioId, {
            codigo: "MALO",
            nombre: "Rango imposible",
            tipo: "resultados",
            lineas: [{ concepto: "Ingresos", cuentas: "70-6999" }],
          }),
        ),
      /renglón 1:.*distinto largo/,
    );
  });

  test("un título no lleva importe", async () => {
    await movimiento();
    const generado = await con(async (db) => generarEstado(db, await idDe("ERN"), "202609"));
    const titulo = generado.renglones.find((r) => r.clase === "titulo")!;
    assert.equal(titulo.importe, "0.00");
  });

  test("marcar otro predeterminado desmarca el anterior", async () => {
    await con((db) =>
      guardarFormato(db, empresaId, usuarioId, {
        codigo: "MIO2",
        nombre: "Otro de resultados",
        tipo: "resultados",
        esPredeterminado: true,
        lineas: [{ codigo: "ing", concepto: "Ingresos", cuentas: "70", signo: "acreedor" }],
      }),
    );
    const lista = await con((db) => listarFormatos(db, "resultados"));
    const predeterminados = lista.filter((f) => f.esPredeterminado);
    assert.equal(predeterminados.length, 1);
    assert.equal(predeterminados[0]!.codigo, "MIO2");
  });

  test("no se elimina el predeterminado sin poner otro", async () => {
    await assert.rejects(
      () => con(async (db) => eliminarFormato(db, await idDe("EFS"))),
      /marque otro como predeterminado/,
    );
  });

  test("uno propio sí se elimina", async () => {
    await propio();
    await con(async (db) => eliminarFormato(db, await idDe("MIO")));
    const lista = await con((db) => listarFormatos(db));
    assert.equal(lista.find((f) => f.codigo === "MIO"), undefined);
  });
});
