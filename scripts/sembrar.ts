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
  confirmarLiquidacion, registrarCompra, crearOrden,
  emitirVenta, cargarCertificado, guardarCredencialesSol,
  documentosPorPagar, canjearPorLetra,
  crearCuenta, registrarMovimientoEfectivo, importarExtracto,
} from "@roulterp/servicios";
import { certificadoDePrueba, pfxDePrueba } from "@roulterp/core/cpe";


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
      direccion: "Urb. Los Sauces, Av. Prolongación Mariscal Nieto 263",
      // Respondido por el cliente en el cuestionario: valorizan a promedio.
      metodoValorizacion: "promedio",
    },
    { email: "admin@servidimar.pe", nombre: "Administrador", password: CLAVE },
  );

  const raw = postgres(URL, { max: 1, onnotice: () => {} });

  const [unidad] = await raw<{ id: string }[]>`
    SELECT id FROM unidades_medida WHERE empresa_id = ${empresa.empresaId} AND codigo = 'NIU'`;
  /*
   * Datos reales que respondió SERVIDIMAR en el cuestionario.
   *
   * Los establecimientos van con su código ante SUNAT porque es lo que la guía
   * de remisión electrónica exige como punto de partida; sin él, cada guía
   * obliga a teclear la dirección a mano y el rechazo llega después.
   */
  await raw`UPDATE empresas SET cuenta_detracciones = '00-000-000000'
             WHERE id = ${empresa.empresaId}`;

  /*
   * El UBIGEO es un dato PENDIENTE del cliente.
   *
   * Respondió las direcciones y los códigos de establecimiento, pero no el
   * ubigeo de cada local, y es obligatorio: viaja en cada guía de remisión como
   * punto de partida y la GRE la rechaza sin él. Lo que va abajo son los
   * distritos que se deducen de la dirección —Moquegua para Mariscal Nieto,
   * Ate para Separadora Industrial— y hay que confirmarlos antes de emitir de
   * verdad. Sin ningún valor, el módulo de guías no se puede ni enseñar.
   */
  const ESTABLECIMIENTOS = [
    ["0003", "Prolongación Mariscal Nieto", "URB. LOS SAUCES AV. PROLONGACION MARISCAL NIETO 263", "180101"],
    ["0001", "Santa María", "URB. INDUSTRIAL LA AURORA AV. SANTA MARIA 165", "150103"],
    ["0002", "Mariscal Nieto 108", "URB. LOS SAUCES AV. MARISCAL NIETO 108", "180101"],
    ["0008", "Separadora Industrial", "URB. MIGUEL GRAU AV. SEPARADORA INDUSTRIAL 719", "150103"],
  ] as const;
  for (const [codigo, nombre, direccion, ubigeo] of ESTABLECIMIENTOS) {
    await raw`
      INSERT INTO sucursales (empresa_id, codigo, nombre, direccion, ubigeo, codigo_sunat)
      VALUES (${empresa.empresaId}, ${codigo}, ${nombre}, ${direccion}, ${ubigeo}, ${codigo})
      ON CONFLICT (empresa_id, codigo) DO UPDATE
        SET nombre = excluded.nombre, direccion = excluded.direccion,
            ubigeo = excluded.ubigeo, codigo_sunat = excluded.codigo_sunat`;
  }

  // Los tres almacenes que maneja la empresa. El 001 nace con la empresa y se
  // renombra; los otros dos se crean contra su establecimiento.
  await raw`
    UPDATE almacenes SET nombre = 'Almacén Principal',
           sucursal_id = (SELECT id FROM sucursales
                           WHERE empresa_id = ${empresa.empresaId} AND codigo = '0003')
     WHERE empresa_id = ${empresa.empresaId} AND codigo = '001'`;
  for (const [codigo, nombre, sucursal] of [
    ["002", "Almacén Santa María", "0001"],
    ["003", "Almacén Separadora", "0008"],
  ] as const) {
    await raw`
      INSERT INTO almacenes (empresa_id, codigo, nombre, sucursal_id)
      VALUES (${empresa.empresaId}, ${codigo}, ${nombre},
              (SELECT id FROM sucursales
                WHERE empresa_id = ${empresa.empresaId} AND codigo = ${sucursal}))
      ON CONFLICT (empresa_id, codigo) DO NOTHING`;
  }

  /*
   * La sucursal que nace con la empresa sobra: sus cuatro establecimientos
   * reales ya están. Dejarla sería un quinto punto de partida vacío en el
   * desplegable de cada guía de remisión, y el que se elige por descuido es el
   * que SUNAT rechaza por no corresponder al establecimiento anexo.
   */
  await raw`
    UPDATE almacenes SET sucursal_id = (SELECT id FROM sucursales
                                         WHERE empresa_id = ${empresa.empresaId} AND codigo = '0003')
     WHERE empresa_id = ${empresa.empresaId}
       AND sucursal_id IN (SELECT id FROM sucursales
                            WHERE empresa_id = ${empresa.empresaId} AND codigo = '001')`;
  await raw`DELETE FROM sucursales
             WHERE empresa_id = ${empresa.empresaId} AND codigo = '001'`;

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

  // Centros de costo: la cuenta 639 los exige al contabilizar, que es
  // exactamente la clase de control de calidad que el plan de cuentas aporta.
  const centros: string[] = [];
  for (const [codigo, nombre] of [
    ["ADM", "Administración"],
    ["LOG", "Logística e importaciones"],
    ["COM", "Comercial"],
  ] as const) {
    const [c] = await raw<{ id: string }[]>`
      INSERT INTO centros_costo (empresa_id, codigo, nombre)
      VALUES (${empresa.empresaId}, ${codigo}, ${nombre}) RETURNING id`;
    centros.push(c!.id);
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

  // Compras nacionales: dejan cuentas por pagar con distintos vencimientos para
  // ver la antigüedad de saldos con contenido.
  // La conexión se cierra: dejarla abierta impedía que el proceso terminara y
  // había que matar el script a mano después de sembrar.
  const rawAgencia = postgres(URL, { max: 1, onnotice: () => {} });
  const [agencia] = await rawAgencia<{ id: string }[]>`
    SELECT id FROM terceros
    WHERE empresa_id = ${empresa.empresaId} AND numero_documento = '20100047218'`;
  await rawAgencia.end();

  await enEmpresa(app, ctx, async (db) => {
    await registrarCompra(db, ctx.empresaId, ctx.usuarioId, {
      proveedorId: agencia!.id,
      tipoDocumento: "01",
      serie: "FA01",
      numero: "0004417",
      fechaEmision: "2026-06-18",
      moneda: "PEN",
      tipoCambio: "1",
      detraccionCodigo: "022",
      lineas: [
        {
          descripcion: "Servicio de agenciamiento de aduanas — IMP-2026-0011",
          cantidad: "1",
          valorUnitario: "800.00",
          cuenta: "639",
          centroCostoId: centros[1]!,
        },
      ],
    });

    await registrarCompra(db, ctx.empresaId, ctx.usuarioId, {
      proveedorId: agencia!.id,
      tipoDocumento: "01",
      serie: "FA01",
      numero: "0004602",
      fechaEmision: "2026-09-02",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen!.id,
      lineas: [
        {
          productoId: productos[4]!,
          descripcion: "Rodamiento SKF 6204-2RS",
          cantidad: "300",
          valorUnitario: "4.20",
        },
      ],
    });

    await crearOrden(db, ctx.empresaId, ctx.usuarioId, {
      numero: "OC-2026-0042",
      proveedorId: agencia!.id,
      almacenId: almacen!.id,
      fecha: "2026-09-08",
      fechaEntrega: "2026-09-25",
      moneda: "PEN",
      tipoCambio: "1",
      lineas: [
        {
          productoId: productos[1]!,
          descripcion: 'Válvula de bronce 2" roscada',
          cantidad: "120",
          valorUnitario: "38.50",
        },
      ],
    });
  });

  // Facturación electrónica: series, certificado de pruebas y credenciales del
  // entorno beta, para poder ver el módulo funcionando de punta a punta.
  const KEK = new Uint8Array(Buffer.from(process.env["ROULTERP_KEK"]!, "base64"));
  const certPrueba = certificadoDePrueba("20303051831");

  await enEmpresa(app, ctx, async (db) => {
    await cargarCertificado(
      db, ctx.empresaId, ctx.usuarioId,
      pfxDePrueba(certPrueba, "clave-de-prueba"), "clave-de-prueba",
      KEK, process.env["ROULTERP_KEK_ID"] ?? "env-1",
    );
    await guardarCredencialesSol(
      db, ctx.empresaId, ctx.usuarioId,
      { usuarioSol: "MODDATOS", claveSol: "MODDATOS", entorno: "beta" },
      KEK, process.env["ROULTERP_KEK_ID"] ?? "env-1",
    );
  });

  const raw2 = postgres(URL, { max: 1, onnotice: () => {} });
  /*
   * Las series con las que la empresa emite hoy, tal como las respondió.
   *
   * Continuar sus correlativos —y no empezar de cero— es lo que evita que SUNAT
   * rechace el primer comprobante por número repetido. El correlativo real hay
   * que tomarlo del último emitido en Starsoft el día del cambio; aquí quedan en
   * cero porque esto es la base de desarrollo.
   */
  await raw2`
    INSERT INTO series_documento (empresa_id, tipo_documento, serie, correlativo)
    VALUES (${empresa.empresaId}, '01', 'FA01', 0),
           (${empresa.empresaId}, '01', 'FA02', 0),
           (${empresa.empresaId}, '03', 'BA01', 0),
           -- Las notas van con la serie de la factura que modifican, que es como
           -- las lleva la empresa: la 07 y la 08 se distinguen por el tipo.
           (${empresa.empresaId}, '07', 'FA01', 0),
           (${empresa.empresaId}, '08', 'FA01', 0),
           (${empresa.empresaId}, '09', 'TA01', 0),
           (${empresa.empresaId}, '09', 'TA02', 0),
           -- No son agentes de retención ni de percepción; las series quedan
           -- para el día que SUNAT los designe.
           (${empresa.empresaId}, '20', 'R001', 0),
           (${empresa.empresaId}, '40', 'P001', 0)`;
  const [clienteVentas] = await raw2<{ id: string }[]>`
    SELECT id FROM terceros WHERE empresa_id = ${empresa.empresaId} AND numero_documento = '20522633721'`;
  await raw2.end();

  // Una venta ya emitida, todavía sin informar a SUNAT: es el estado en el que
  // el usuario más veces encuentra un comprobante al abrir la pantalla.
  await enEmpresa(app, ctx, (db) =>
    emitirVenta(db, ctx.empresaId, ctx.usuarioId, {
      clienteId: clienteVentas!.id,
      tipoDocumento: "01",
      serie: "FA01",
      fechaEmision: "2026-08-22",
      moneda: "PEN",
      tipoCambio: "1",
      almacenId: almacen!.id,
      lineas: [
        { productoId: productos[0]!, cantidad: "12", valorUnitario: "395.00" },
        { descripcion: "Instalación y puesta en marcha", cantidad: "1", valorUnitario: "850.00" },
      ],
    }),
  );

  // Dos boletas del mismo día, que es lo que alimenta el resumen diario: las
  // boletas no se envían de una en una.
  for (const importe of ["120.00", "260.00"]) {
    await enEmpresa(app, ctx, (db) =>
      emitirVenta(db, ctx.empresaId, ctx.usuarioId, {
        clienteId: clienteVentas!.id,
        tipoDocumento: "03",
        serie: "BA01",
        fechaEmision: "2026-08-23",
        moneda: "PEN",
        tipoCambio: "1",
        // Sin almacén: son servicios de mostrador y no descargan inventario.
        lineas: [{ descripcion: "Servicio de mantenimiento", cantidad: "1", valorUnitario: importe }],
      }),
    );
  }

  // Una factura de compra canjeada por letra, para que la cartera y la
  // programación de egresos tengan algo que mostrar.
  await enEmpresa(app, ctx, async (db) => {
    const pendientes = await documentosPorPagar(db, agencia!.id);
    const doc = pendientes.at(-1);
    if (doc) {
      await canjearPorLetra(db, ctx.empresaId, ctx.usuarioId, {
        numero: "LT-2026-001",
        cartera: "pagar",
        terceroId: agencia!.id,
        fechaGiro: "2026-09-05",
        fechaVencimiento: "2026-10-20",
        moneda: "PEN",
        documentos: [{ documentoId: doc.id, importe: doc.saldo }],
      });
    }
  });

  // La factura de venta queda aceptada por SUNAT: es lo único que se puede dar
  // de baja, y sin ella esa pantalla se ve siempre vacía.
  const raw3 = postgres(URL, { max: 1, onnotice: () => {} });
  await raw3`
    UPDATE comprobantes SET estado = 'aceptado', codigo_sunat = 0,
                            mensaje_sunat = 'La Factura numero FA01-00000001, ha sido aceptada'
    WHERE empresa_id = ${empresa.empresaId} AND tipo_documento = '01'`;
  await raw3.end();

  // Caja y bancos, con un extracto que deja parejas por conciliar y una línea
  // que el banco cobró sin que nadie la registrara.
  await enEmpresa(app, ctx, async (db) => {
    const bcp = await crearCuenta(db, ctx.empresaId, ctx.usuarioId, {
      codigo: "BCP-SOL",
      nombre: "BCP cuenta corriente soles",
      tipo: "banco",
      moneda: "PEN",
      cuentaContable: "1041",
      banco: "BCP",
      numeroCuenta: "193-1934567-0-88",
      cci: "00219300193456708812",
    });

    await crearCuenta(db, ctx.empresaId, ctx.usuarioId, {
      codigo: "CCH-ADM",
      nombre: "Caja chica administración",
      tipo: "caja_chica",
      moneda: "PEN",
      cuentaContable: "1012",
      fondoFijo: "1500",
    });

    await registrarMovimientoEfectivo(db, ctx.empresaId, ctx.usuarioId, {
      cuentaId: bcp,
      fecha: "2026-09-02",
      sentido: "ingreso",
      concepto: "Aporte de capital de trabajo",
      importe: "40000.00",
      referencia: "OP-880114",
      cuentaContrapartida: "5011",
    });

    await registrarMovimientoEfectivo(db, ctx.empresaId, ctx.usuarioId, {
      cuentaId: bcp,
      fecha: "2026-09-04",
      sentido: "egreso",
      concepto: "Transferencia al agente de aduanas",
      importe: "944.00",
      referencia: "OP-880233",
      // La 4212 exige imputar el tercero, y con razón: sin él, el estado de
      // cuenta por proveedor quedaría incompleto.
      terceroId: agencia!.id,
      cuentaContrapartida: "4212",
    });

    await importarExtracto(db, ctx.empresaId, ctx.usuarioId, bcp, [
      // Casa por referencia.
      { fecha: "2026-09-02", descripcion: "ABONO TRANSFERENCIA", importe: "40000.00", referencia: "OP-880114" },
      // Casa por fecha e importe exactos.
      { fecha: "2026-09-04", descripcion: "CARGO TRANSFERENCIA", importe: "-944.00" },
      // El banco lo cobró y nadie lo registró: aparece en «sin registrar».
      { fecha: "2026-09-30", descripcion: "COMISION MANTENIMIENTO CTA", importe: "-15.00", saldo: "39041.00" },
    ]);
  });

  await app.cliente.end();

  console.log("Datos de desarrollo listos.");
  console.log(`  Empresa:    SERVIDIMAR (RUC 20303051831)`);
  console.log(`  Usuario:    admin@servidimar.pe`);
  console.log(`  Contraseña: ${CLAVE}`);
}

await main();
