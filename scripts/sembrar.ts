/**
 * Datos de trabajo para desarrollo.
 *
 * Crea la empresa del cliente con un embarque realista a medio camino, para
 * poder abrir la aplicación y ver pantallas con contenido en vez de vacíos.
 *
 *   npx tsx scripts/sembrar.ts
 *
 * Es idempotente por la vía rápida: borra las empresas y las vuelve a crear.
 * Sólo para desarrollo, evidentemente.
 */
import postgres from "postgres";
import { conectar, enEmpresa } from "@roulterp/db";
import {
  crearEmpresa, crearImportacion, agregarItem, agregarGasto, cambiarEstado,
  confirmarLiquidacion, registrarMovimiento,
} from "@roulterp/servicios";
import { money } from "@roulterp/core";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_dev";
const CLAVE = "roulterp-desarrollo-1";

const PRODUCTOS = [
  ["P001", "Bomba centrífuga 2HP monofásica", "12.5", "0.08"],
  ["P002", 'Válvula de bronce 2" roscada', "1.8", "0.004"],
  ["P003", "Manguera reforzada PVC 50 m", "8.0", "0.05"],
  ["P004", "Motor eléctrico trifásico 5HP", "38.0", "0.15"],
  ["P005", "Rodamiento SKF 6204-2RS", "0.12", "0.0002"],
] as const;

async function main() {
  const sql = postgres(URL, { max: 1, onnotice: () => {} });
  await sql`TRUNCATE TABLE empresas, usuarios RESTART IDENTITY CASCADE`;
  await sql.end();

  const empresa = await crearEmpresa(
    URL,
    {
      ruc: "20303051831",
      razonSocial: "SERVIDIVERSOS MARINA S.R.LTDA.",
      nombreComercial: "SERVIDIMAR",
      direccion: "Av. Prolong. Mariscal Nieto 108, Urb. Los Sauces, Ate - Lima",
      metodoValorizacion: "promedio",
    },
    { email: "admin@servidimar.pe", nombre: "Administrador", password: CLAVE },
  );

  const raw = postgres(URL, { max: 1, onnotice: () => {} });

  const [unidad] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresa.empresaId} AND codigo = 'NIU'`;
  const [almacen] = await raw<{ id: string }[]>`
    SELECT id FROM almacenes WHERE empresa_id = ${empresa.empresaId} AND codigo = '001'`;

  const productos: string[] = [];
  for (const [codigo, descripcion, peso, volumen] of PRODUCTOS) {
    const [p] = await raw<{ id: string }[]>`
      INSERT INTO productos (empresa_id, codigo, descripcion, unidad_id,
                             peso_unitario, volumen_unitario, cuenta_existencia_id)
      VALUES (${empresa.empresaId}, ${codigo}, ${descripcion}, ${unidad!.id},
              ${peso}, ${volumen},
              (SELECT id FROM plan_cuentas
                WHERE empresa_id = ${empresa.empresaId} AND cuenta = '20111'))
      RETURNING id`;
    productos.push(p!.id);
  }

  const [proveedor] = await raw<{ id: string }[]>`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          pais, es_proveedor, es_domiciliado, dias_credito)
    VALUES (${empresa.empresaId}, '0', 'CN-8891', 'NINGBO PUMP TRADING CO. LTD',
            'CN', true, false, 60)
    RETURNING id`;

  await raw`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          pais, es_proveedor, dias_credito)
    VALUES (${empresa.empresaId}, '6', '20100047218', 'AGENCIA DE ADUANAS DEL PACIFICO S.A.',
            'PE', true, 30)`;
  await raw`
    INSERT INTO terceros (empresa_id, tipo_documento, numero_documento, razon_social,
                          es_cliente, dias_credito, limite_credito)
    VALUES (${empresa.empresaId}, '6', '20522633721', 'HIDRAULICA DEL SUR S.A.C.',
            true, 30, '50000')`;

  await raw.end();

  const app = conectar({ url: URL, rol: "app", max: 2 });
  const ctx = { empresaId: empresa.empresaId, usuarioId: empresa.usuarioId };

  await enEmpresa(app, ctx, async (db) => {
    // Embarque en aduana, con los gastos ya cargados y listo para liquidar:
    // es el estado en el que más tiempo pasa una importación real.
    const imp = await crearImportacion(db, ctx.empresaId, ctx.usuarioId, {
      numero: "IMP-2026-0014",
      proveedorId: proveedor!.id,
      almacenId: almacen!.id,
      moneda: "USD",
      tipoCambio: "3.752",
      incoterm: "FOB",
      fechaOrden: "2026-07-18",
      facturaExterior: "NB-2026-4417",
      puertoOrigen: "Ningbo, CN",
      puertoDestino: "Callao, PE",
    });

    const items: [number, string, string, string][] = [
      [0, "Bomba centrífuga 2HP monofásica", "120", "48.50"],
      [1, 'Válvula de bronce 2" roscada', "500", "9.80"],
      [3, "Motor eléctrico trifásico 5HP", "40", "162.00"],
    ];
    for (const [idx, descripcion, cantidad, fob] of items) {
      await agregarItem(db, ctx.empresaId, imp, {
        productoId: productos[idx]!,
        descripcion,
        cantidad,
        fobUnitario: fob,
      });
    }

    const gastos: [string, string, string, string, string, boolean][] = [
      ["Flete internacional", "3200.00", "USD", "3.781", "peso", true],
      ["Seguro de transporte", "168.00", "USD", "3.781", "fob", true],
      ["Ad valorem", "3084.20", "PEN", "1", "fob", true],
      ["Agente de aduanas", "1416.00", "PEN", "1", "fob", true],
      ["Gastos portuarios", "980.50", "PEN", "1", "peso", true],
      ["Transporte interno", "620.00", "PEN", "1", "peso", true],
      ["IGV de importación", "9812.44", "PEN", "1", "fob", false],
      ["Percepción del IGV", "2180.55", "PEN", "1", "fob", false],
    ];
    for (const [concepto, importe, moneda, tipoCambio, base, afectaCosto] of gastos) {
      await agregarGasto(db, ctx.empresaId, imp, {
        concepto,
        importe,
        moneda,
        tipoCambio,
        baseProrrateo: base as "fob" | "peso",
        afectaCosto,
      });
    }

    for (const estado of ["aprobada", "en_transito"] as const) {
      await cambiarEstado(db, imp, estado);
    }
    await cambiarEstado(db, imp, "en_aduana", {
      duaNumero: "235-2026-10-448271",
      duaFecha: "2026-09-02",
      fechaLlegada: "2026-08-29",
    });

    // Un embarque anterior ya liquidado: deja el inventario con existencias y
    // la contabilidad con su asiento, que es lo que se quiere ver al abrir las
    // pantallas de inventario y de kardex.
    const previo = await crearImportacion(db, ctx.empresaId, ctx.usuarioId, {
      numero: "IMP-2026-0011",
      proveedorId: proveedor!.id,
      almacenId: almacen!.id,
      moneda: "USD",
      tipoCambio: "3.744",
      incoterm: "FOB",
      fechaOrden: "2026-05-12",
    });
    await agregarItem(db, ctx.empresaId, previo, {
      productoId: productos[0]!, descripcion: "Bomba centrífuga 2HP monofásica",
      cantidad: "80", fobUnitario: "47.20",
    });
    await agregarItem(db, ctx.empresaId, previo, {
      productoId: productos[2]!, descripcion: "Manguera reforzada PVC 50 m",
      cantidad: "150", fobUnitario: "22.40",
    });
    await agregarGasto(db, ctx.empresaId, previo, {
      concepto: "Flete internacional", importe: "1850.00", moneda: "USD",
      tipoCambio: "3.769", baseProrrateo: "peso", afectaCosto: true,
    });
    await agregarGasto(db, ctx.empresaId, previo, {
      concepto: "Ad valorem", importe: "1420.60", moneda: "PEN",
      tipoCambio: "1", baseProrrateo: "fob", afectaCosto: true,
    });
    await agregarGasto(db, ctx.empresaId, previo, {
      concepto: "Agente de aduanas", importe: "944.00", moneda: "PEN",
      tipoCambio: "1", baseProrrateo: "fob", afectaCosto: true,
    });
    await agregarGasto(db, ctx.empresaId, previo, {
      concepto: "IGV de importación", importe: "4521.88", moneda: "PEN",
      tipoCambio: "1", baseProrrateo: "fob", afectaCosto: false,
    });
    for (const estado of ["aprobada", "en_transito"] as const) {
      await cambiarEstado(db, previo, estado);
    }
    await cambiarEstado(db, previo, "en_aduana", {
      duaNumero: "235-2026-10-311204", duaFecha: "2026-06-18",
    });
    await cambiarEstado(db, previo, "nacionalizada");
    await confirmarLiquidacion(db, ctx.empresaId, ctx.usuarioId, previo, {
      numero: "LIQ-2026-0007", fecha: "2026-06-20", periodo: "202606",
    });

    // Una venta posterior, para que el kardex tenga entradas y salidas y se vea
    // el costo de salida calculado por el método de la empresa.
    await registrarMovimiento(db, ctx.empresaId, {
      almacenId: almacen!.id,
      productoId: productos[0]!,
      fecha: "2026-07-15",
      sentido: "salida",
      tipoOperacion: "01",
      cantidad: money.dec("25"),
      origenModulo: "ventas",
    });

    // Un segundo embarque más pequeño, todavía en borrador.
    const imp2 = await crearImportacion(db, ctx.empresaId, ctx.usuarioId, {
      numero: "IMP-2026-0015",
      proveedorId: proveedor!.id,
      almacenId: almacen!.id,
      moneda: "USD",
      tipoCambio: "3.748",
      incoterm: "CIF",
      fechaOrden: "2026-09-04",
    });
    await agregarItem(db, ctx.empresaId, imp2, {
      productoId: productos[4]!,
      descripcion: "Rodamiento SKF 6204-2RS",
      cantidad: "2000",
      fobUnitario: "1.35",
    });
  });

  await app.cliente.end();

  console.log("Datos de desarrollo listos.");
  console.log(`  Empresa:    SERVIDIMAR (RUC 20303051831)`);
  console.log(`  Usuario:    admin@servidimar.pe`);
  console.log(`  Contraseña: ${CLAVE}`);
}

await main();
