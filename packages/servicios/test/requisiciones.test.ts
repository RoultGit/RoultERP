/**
 * Requisición → solicitud de cotización → cuadro comparativo → orden de compra.
 *
 * Lo que se comprueba es la trazabilidad, que es para lo que sirve toda esta
 * cadena de papeles: que no se cotice lo que nadie aprobó, que el cuadro compare
 * en la misma moneda, y que la orden que sale al final sepa decir de qué
 * requisición y de qué cotización nació.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import { money } from "@roulterp/core";
import {
  crearEmpresa, cargarOrden,
  crearRequisicion, resolverRequisicion, anularRequisicion, listarRequisiciones,
  cargarRequisicion, crearSolicitud, cargarSolicitud, listarSolicitudes, cerrarSolicitud,
  registrarCotizacionProveedor, descartarCotizacion, cuadroComparativo, elegirCotizacion,
  RequisicionInvalida,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";
let almacen = "";
let producto = "";
let productoDos = "";
let provUno = "";
let provDos = "";

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

  const [a1] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresaId} AND codigo = '001'`;
  almacen = a1!.id;

  const [p1] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20100047218', 'FERRETERIA SA', true) RETURNING id`;
  provUno = p1!.id;
  const [p2] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_proveedor)
    VALUES (${empresaId}, '6', '20522458364', 'IMPORTACIONES DEL SUR SAC', true) RETURNING id`;
  provDos = p2!.id;

  const [u] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresaId} AND codigo = 'NIU'`;
  const [pr] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'CEM-42', 'Cemento Portland 42.5 kg', ${u!.id}) RETURNING id`;
  producto = pr!.id;
  const [pr2] = await raw<{ id: string }[]>`
    INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id)
    VALUES (${empresaId}, 'FIE-06', 'Fierro corrugado 6 mm', ${u!.id}) RETURNING id`;
  productoDos = pr2!.id;
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const s2 = (v: string) => money.toString(money.dec(v), 2);

const pedir = () =>
  con((db) =>
    crearRequisicion(db, empresaId, usuarioId, {
      fecha: "2026-09-01",
      fechaRequerida: "2026-09-20",
      area: "Obra San Miguel",
      almacenId: almacen,
      lineas: [
        { productoId: producto, cantidad: "100" },
        { productoId: productoDos, cantidad: "50" },
      ],
    }),
  );

/** Requisición aprobada + solicitud abierta, que es el punto de partida real. */
async function solicitudLista() {
  const req = await pedir();
  await con((db) => resolverRequisicion(db, req.id, usuarioId, { estado: "aprobada" }));
  const sol = await con((db) =>
    crearSolicitud(db, empresaId, usuarioId, { fecha: "2026-09-02", requisicionId: req.id }),
  );
  const { lineas } = await con((db) => cargarSolicitud(db, sol.id));
  return { req, sol, lineas };
}

// ─── Requisición ──────────────────────────────────────────────────────────

describe("requisición", () => {
  test("nace pendiente, numerada y con su solicitante", async () => {
    const r = await pedir();
    assert.equal(r.numero, "REQ2026-000001");

    const { cabecera, lineas } = await con((db) => cargarRequisicion(db, r.id));
    assert.equal(cabecera.estado, "pendiente");
    assert.equal(cabecera.solicitanteId, usuarioId);
    assert.equal(cabecera.area, "Obra San Miguel");
    assert.equal(lineas.length, 2);
    // El maestro completa lo que el área no escribió.
    assert.equal(lineas[0]!.descripcion, "Cemento Portland 42.5 kg");
    assert.equal(lineas[0]!.unidad, "NIU");
  });

  test("admite pedir algo que todavía no es un producto", async () => {
    const r = await con((db) =>
      crearRequisicion(db, empresaId, usuarioId, {
        tipo: "servicio",
        fecha: "2026-09-01",
        lineas: [{ descripcion: "Mantenimiento del montacargas", cantidad: "1" }],
      }),
    );
    const { cabecera, lineas } = await con((db) => cargarRequisicion(db, r.id));
    assert.equal(cabecera.tipo, "servicio");
    assert.equal(lineas[0]!.productoId, null);
    assert.equal(lineas[0]!.descripcion, "Mantenimiento del montacargas");
  });

  test("rechazar exige motivo y lo guarda", async () => {
    const r = await pedir();
    await assert.rejects(
      () => con((db) => resolverRequisicion(db, r.id, usuarioId, { estado: "rechazada" })),
      /motivo del rechazo/,
    );
    await con((db) =>
      resolverRequisicion(db, r.id, usuarioId, {
        estado: "rechazada",
        motivo: "Hay stock en el almacén 002",
      }),
    );
    const { cabecera } = await con((db) => cargarRequisicion(db, r.id));
    assert.equal(cabecera.estado, "rechazada");
    assert.equal(cabecera.motivoRechazo, "Hay stock en el almacén 002");
    assert.equal(cabecera.aprobadaPor, usuarioId);
  });

  test("no se resuelve dos veces", async () => {
    const r = await pedir();
    await con((db) => resolverRequisicion(db, r.id, usuarioId, { estado: "aprobada" }));
    await assert.rejects(
      () => con((db) => resolverRequisicion(db, r.id, usuarioId, { estado: "rechazada", motivo: "x" })),
      /ya no se resuelve/,
    );
  });

  test("se anula mientras nadie la atendió", async () => {
    const r = await pedir();
    await con((db) => anularRequisicion(db, r.id));
    const [fila] = await con((db) => listarRequisiciones(db, "anulada"));
    assert.equal(fila!.numero, r.numero);
  });

  test("rechaza cantidad cero", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          crearRequisicion(db, empresaId, usuarioId, {
            fecha: "2026-09-01",
            lineas: [{ productoId: producto, cantidad: "0" }],
          }),
        ),
      /cantidad debe ser positiva/,
    );
  });
});

// ─── Solicitud de cotización ──────────────────────────────────────────────

describe("solicitud de cotización", () => {
  test("sólo se cotiza lo aprobado", async () => {
    const r = await pedir();
    await assert.rejects(
      () =>
        con((db) =>
          crearSolicitud(db, empresaId, usuarioId, { fecha: "2026-09-02", requisicionId: r.id }),
        ),
      /sólo se cotiza lo aprobado/,
    );
  });

  test("copia las líneas de la requisición aprobada", async () => {
    const { sol, lineas } = await solicitudLista();
    assert.equal(sol.numero, "SDC2026-000001");
    assert.equal(lineas.length, 2);
    assert.equal(s2(lineas[0]!.cantidad), "100.00");
  });

  test("también se abre sin requisición", async () => {
    const sol = await con((db) =>
      crearSolicitud(db, empresaId, usuarioId, {
        fecha: "2026-09-02",
        lineas: [{ productoId: producto, cantidad: "10" }],
      }),
    );
    const { cabecera } = await con((db) => cargarSolicitud(db, sol.id));
    assert.equal(cabecera.requisicionId, null);
  });

  test("cerrada, ya no admite respuestas", async () => {
    const { sol, lineas } = await solicitudLista();
    await con((db) => cerrarSolicitud(db, sol.id, true));
    await assert.rejects(
      () =>
        con((db) =>
          registrarCotizacionProveedor(db, empresaId, usuarioId, {
            solicitudId: sol.id,
            proveedorId: provUno,
            fecha: "2026-09-05",
            moneda: "PEN",
            tipoCambio: "1",
            lineas: [{ solicitudItemId: lineas[0]!.id, valorUnitario: "24" }],
          }),
        ),
      /ya no admite respuestas/,
    );
  });

  test("cuenta las respuestas recibidas", async () => {
    const { sol, lineas } = await solicitudLista();
    await con((db) =>
      registrarCotizacionProveedor(db, empresaId, usuarioId, {
        solicitudId: sol.id,
        proveedorId: provUno,
        fecha: "2026-09-05",
        moneda: "PEN",
        tipoCambio: "1",
        lineas: [{ solicitudItemId: lineas[0]!.id, valorUnitario: "24" }],
      }),
    );
    const [fila] = await con((db) => listarSolicitudes(db));
    assert.equal(Number(fila!.respuestas), 1);
  });
});

// ─── Cotizaciones de proveedor ────────────────────────────────────────────

describe("respuesta del proveedor", () => {
  test("totaliza con IGV y se ata a las líneas pedidas", async () => {
    const { sol, lineas } = await solicitudLista();
    const c = await con((db) =>
      registrarCotizacionProveedor(db, empresaId, usuarioId, {
        solicitudId: sol.id,
        proveedorId: provUno,
        referenciaProveedor: "COT-9912",
        fecha: "2026-09-05",
        moneda: "PEN",
        tipoCambio: "1",
        plazoEntregaDias: 5,
        lineas: [
          { solicitudItemId: lineas[0]!.id, valorUnitario: "24" },
          { solicitudItemId: lineas[1]!.id, valorUnitario: "18" },
        ],
      }),
    );
    assert.equal(c.numero, "CTP2026-000001");

    const [fila] = await raw<{ subtotal: string; igv: string; total: string }[]>`
      SELECT subtotal, igv, total FROM cotizaciones_proveedor WHERE id = ${c.id}`;
    // 100 × 24 + 50 × 18 = 3300; IGV 594; total 3894.
    assert.equal(s2(fila!.subtotal), "3300.00");
    assert.equal(s2(fila!.igv), "594.00");
    assert.equal(s2(fila!.total), "3894.00");
  });

  test("no acepta una línea de otra solicitud", async () => {
    const { sol } = await solicitudLista();
    const otra = await solicitudLista();
    await assert.rejects(
      () =>
        con((db) =>
          registrarCotizacionProveedor(db, empresaId, usuarioId, {
            solicitudId: sol.id,
            proveedorId: provUno,
            fecha: "2026-09-05",
            moneda: "PEN",
            tipoCambio: "1",
            lineas: [{ solicitudItemId: otra.lineas[0]!.id, valorUnitario: "24" }],
          }),
        ),
      /no corresponde a esta solicitud/,
    );
  });

  test("un proveedor no cotiza dos veces la misma solicitud", async () => {
    const { sol, lineas } = await solicitudLista();
    const primera = await con((db) =>
      registrarCotizacionProveedor(db, empresaId, usuarioId, {
        solicitudId: sol.id, proveedorId: provUno, fecha: "2026-09-05",
        moneda: "PEN", tipoCambio: "1",
        lineas: [{ solicitudItemId: lineas[0]!.id, valorUnitario: "24" }],
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          registrarCotizacionProveedor(db, empresaId, usuarioId, {
            solicitudId: sol.id, proveedorId: provUno, fecha: "2026-09-06",
            moneda: "PEN", tipoCambio: "1",
            lineas: [{ solicitudItemId: lineas[0]!.id, valorUnitario: "22" }],
          }),
        ),
      /ya cotizó esta solicitud/,
    );

    // Descartada la anterior, la mejora sí entra.
    await con((db) => descartarCotizacion(db, primera.id));
    await assert.doesNotReject(() =>
      con((db) =>
        registrarCotizacionProveedor(db, empresaId, usuarioId, {
          solicitudId: sol.id, proveedorId: provUno, fecha: "2026-09-06",
          moneda: "PEN", tipoCambio: "1",
          lineas: [{ solicitudItemId: lineas[0]!.id, valorUnitario: "22" }],
        }),
      ),
    );
  });

  test("rechaza a quien no es proveedor", async () => {
    const { sol, lineas } = await solicitudLista();
    const [c] = await raw<{ id: string }[]>`
      INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social, es_cliente)
      VALUES (${empresaId}, '6', '20111111111', 'CLIENTE SAC', true) RETURNING id`;
    await assert.rejects(
      () =>
        con((db) =>
          registrarCotizacionProveedor(db, empresaId, usuarioId, {
            solicitudId: sol.id, proveedorId: c!.id, fecha: "2026-09-05",
            moneda: "PEN", tipoCambio: "1",
            lineas: [{ solicitudItemId: lineas[0]!.id, valorUnitario: "24" }],
          }),
        ),
      /no está marcado como proveedor/,
    );
  });
});

// ─── Cuadro comparativo ───────────────────────────────────────────────────

describe("cuadro comparativo", () => {
  /**
   * Dos ofertas por lo mismo, una en soles y otra en dólares.
   *
   * En dólares el número es más chico y parece la ganga; llevado a soles con su
   * tipo de cambio, es la cara. Es exactamente el error que el cuadro evita.
   */
  async function dosOfertas() {
    const { sol, lineas, req } = await solicitudLista();
    const pen = await con((db) =>
      registrarCotizacionProveedor(db, empresaId, usuarioId, {
        solicitudId: sol.id, proveedorId: provUno, fecha: "2026-09-05",
        moneda: "PEN", tipoCambio: "1", plazoEntregaDias: 10,
        lineas: [
          { solicitudItemId: lineas[0]!.id, valorUnitario: "24" },
          { solicitudItemId: lineas[1]!.id, valorUnitario: "18" },
        ],
      }),
    );
    const usd = await con((db) =>
      registrarCotizacionProveedor(db, empresaId, usuarioId, {
        solicitudId: sol.id, proveedorId: provDos, fecha: "2026-09-05",
        moneda: "USD", tipoCambio: "3.80", plazoEntregaDias: 3,
        lineas: [
          { solicitudItemId: lineas[0]!.id, valorUnitario: "7" },
          { solicitudItemId: lineas[1]!.id, valorUnitario: "5" },
        ],
      }),
    );
    return { sol, lineas, req, pen, usd };
  }

  test("compara en soles, no en el número que trae cada oferta", async () => {
    const { sol, pen, usd } = await dosOfertas();
    const cuadro = await con((db) => cuadroComparativo(db, sol.id));

    assert.equal(cuadro.columnas.length, 2);
    const colPen = cuadro.columnas.find((c) => c.cotizacionId === pen.id)!;
    const colUsd = cuadro.columnas.find((c) => c.cotizacionId === usd.id)!;

    // 3894.00 en soles contra USD 1121.00 × 3.80 = 4259.80.
    assert.equal(colPen.totalSoles, "3894.00");
    assert.equal(colUsd.totalSoles, "4259.80");
    assert.equal(colPen.esMejorTotal, true);
    assert.equal(colUsd.esMejorTotal, false);

    // Y línea por línea: 24.00 contra 7 × 3.80 = 26.60.
    const fila = cuadro.filas[0]!;
    const oPen = fila.ofertas.find((o) => o.cotizacionId === pen.id)!;
    const oUsd = fila.ofertas.find((o) => o.cotizacionId === usd.id)!;
    assert.equal(s2(oUsd.valorUnitarioSoles), "26.60");
    assert.equal(oPen.esMejor, true);
    assert.equal(oUsd.esMejor, false);
  });

  test("una fila sin oferta queda vacía, no rota", async () => {
    const { sol, lineas } = await solicitudLista();
    await con((db) =>
      registrarCotizacionProveedor(db, empresaId, usuarioId, {
        solicitudId: sol.id, proveedorId: provUno, fecha: "2026-09-05",
        moneda: "PEN", tipoCambio: "1",
        // Sólo cotiza la primera línea: es lo normal.
        lineas: [{ solicitudItemId: lineas[0]!.id, valorUnitario: "24" }],
      }),
    );
    const cuadro = await con((db) => cuadroComparativo(db, sol.id));
    assert.equal(cuadro.filas[0]!.ofertas.length, 1);
    assert.equal(cuadro.filas[1]!.ofertas.length, 0);
  });

  test("no muestra las descartadas", async () => {
    const { sol, pen } = await dosOfertas();
    await con((db) => descartarCotizacion(db, pen.id));
    const cuadro = await con((db) => cuadroComparativo(db, sol.id));
    assert.equal(cuadro.columnas.length, 1);
  });

  test("sin respuestas, el cuadro sale vacío y con sus filas", async () => {
    const { sol } = await solicitudLista();
    const cuadro = await con((db) => cuadroComparativo(db, sol.id));
    assert.equal(cuadro.columnas.length, 0);
    assert.equal(cuadro.filas.length, 2);
    assert.equal(cuadro.filas[0]!.ofertas.length, 0);
  });
});

// ─── Elección y orden de compra ───────────────────────────────────────────

describe("elegir cotización", () => {
  async function conDosOfertas() {
    const { sol, lineas, req } = await solicitudLista();
    const pen = await con((db) =>
      registrarCotizacionProveedor(db, empresaId, usuarioId, {
        solicitudId: sol.id, proveedorId: provUno, fecha: "2026-09-05",
        moneda: "PEN", tipoCambio: "1", condicionPago: "30 días",
        lineas: [
          { solicitudItemId: lineas[0]!.id, valorUnitario: "24" },
          { solicitudItemId: lineas[1]!.id, valorUnitario: "18" },
        ],
      }),
    );
    const otra = await con((db) =>
      registrarCotizacionProveedor(db, empresaId, usuarioId, {
        solicitudId: sol.id, proveedorId: provDos, fecha: "2026-09-05",
        moneda: "PEN", tipoCambio: "1",
        lineas: [{ solicitudItemId: lineas[0]!.id, valorUnitario: "26" }],
      }),
    );
    return { req, sol, pen, otra };
  }

  test("genera la orden con los precios cotizados y deja el rastro", async () => {
    const { req, sol, pen } = await conDosOfertas();
    const r = await con((db) =>
      elegirCotizacion(db, empresaId, usuarioId, pen.id, {
        fecha: "2026-09-08",
        fechaEntrega: "2026-09-18",
        almacenId: almacen,
      }),
    );
    assert.equal(r.numeroOrden, "OC2026-000001");

    const { cabecera, lineas } = await con((db) => cargarOrden(db, r.ordenId));
    assert.equal(cabecera.proveedorId, provUno);
    assert.equal(cabecera.condicionPago, "30 días");
    assert.equal(s2(cabecera.total), "3894.00");
    assert.equal(lineas.length, 2);
    assert.equal(s2(lineas[0]!.valorUnitario), "24.00");

    // El rastro: la orden sabe de qué cotización y de qué requisición salió.
    const [oc] = await raw<{ requisicion_id: string; cotizacion_proveedor_id: string }[]>`
      SELECT requisicion_id, cotizacion_proveedor_id FROM ordenes_compra WHERE id = ${r.ordenId}`;
    assert.equal(oc!.cotizacion_proveedor_id, pen.id);
    assert.equal(oc!.requisicion_id, req.id);

    // Y hacia el otro lado: la requisición queda atendida y la solicitud cerrada.
    const { cabecera: reqFinal } = await con((db) => cargarRequisicion(db, req.id));
    assert.equal(reqFinal.estado, "atendida");
    const { cabecera: solFinal } = await con((db) => cargarSolicitud(db, sol.id));
    assert.equal(solFinal.estado, "cerrada");
  });

  test("las demás ofertas quedan descartadas", async () => {
    const { sol, pen, otra } = await conDosOfertas();
    await con((db) => elegirCotizacion(db, empresaId, usuarioId, pen.id, { fecha: "2026-09-08" }));

    const [fila] = await raw<{ estado: string }[]>`
      SELECT estado FROM cotizaciones_proveedor WHERE id = ${otra.id}`;
    assert.equal(fila!.estado, "descartada");

    const cuadro = await con((db) => cuadroComparativo(db, sol.id));
    assert.equal(cuadro.columnas.length, 1);
    assert.equal(cuadro.columnas[0]!.estado, "elegida");
    assert.ok(cuadro.columnas[0]!.ordenCompraId);
  });

  test("no se elige dos veces", async () => {
    const { pen } = await conDosOfertas();
    await con((db) => elegirCotizacion(db, empresaId, usuarioId, pen.id, { fecha: "2026-09-08" }));
    await assert.rejects(
      () => con((db) => elegirCotizacion(db, empresaId, usuarioId, pen.id, { fecha: "2026-09-09" })),
      /ya generó su orden de compra/,
    );
  });

  test("no se elige una descartada", async () => {
    const { otra } = await conDosOfertas();
    await con((db) => descartarCotizacion(db, otra.id));
    await assert.rejects(
      () => con((db) => elegirCotizacion(db, empresaId, usuarioId, otra.id, { fecha: "2026-09-08" })),
      /fue descartada/,
    );
  });

  test("una requisición atendida ya no se anula", async () => {
    const { req, pen } = await conDosOfertas();
    await con((db) => elegirCotizacion(db, empresaId, usuarioId, pen.id, { fecha: "2026-09-08" }));
    await assert.rejects(() => con((db) => anularRequisicion(db, req.id)), /ya fue atendida/);
  });
});
