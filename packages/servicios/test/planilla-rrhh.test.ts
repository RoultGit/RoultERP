/**
 * Planillas y recursos humanos, contra Postgres real.
 *
 * El cálculo ya está probado con números a mano en `core/test/planilla`. Aquí se
 * fija lo que sólo se ve con base de datos: que el sueldo vigente sea el de la
 * fecha y no el último, que recalcular rehaga en vez de acumular, que el asiento
 * cuadre, y que cesar a alguien deje su liquidación en la misma transacción.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { conectar, enEmpresa, migrar, type Conexion, type Db } from "@roulterp/db";
import {
  crearEmpresa, abrirPeriodo,
  guardarTrabajador, listarTrabajadores, cargarTrabajador, basicoEn,
  guardarRemuneracion, historialRemuneraciones,
  guardarContrato, contratosPorVencer, renovarContrato,
  guardarParametroLaboral, parametrosDeEmpresa, catalogoConceptos, guardarConcepto,
  calcularPlanillaSueldos, cerrarPlanillaSueldos, cargarPlanillaSueldos, listarPlanillasSueldos,
  anularPlanillaSueldos, cesarTrabajador,
  balanceComprobacion,
  PlanillaSueldosInvalida, TrabajadorInvalido,
} from "../src/index.ts";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_test";

let raw: postgres.Sql;
let app: Conexion;
let empresaId = "";
let usuarioId = "";

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
    { ruc: "20303051831", razonSocial: "SERVIDIMAR S.A.C." },
    { email: "ana@servidimar.pe", nombre: "Ana", password: "contraseña-de-prueba-1" },
  );
  empresaId = e.empresaId;
  usuarioId = e.usuarioId;
  for (const periodo of ["202508", "202509", "202510", "202511", "202512"]) {
    await abrirPeriodo(URL, empresaId, periodo).catch(() => {});
  }
});

const con = <T>(t: (db: Db) => Promise<T>) => enEmpresa(app, { empresaId, usuarioId }, t);
const n = (v: string) => Number(v);

/** Julio Ramírez, operario en AFP Integra, con hijos, desde marzo de 2022. */
async function contratar(over: Record<string, unknown> = {}): Promise<string> {
  const [cc] = await raw<{ id: string }[]>`
    SELECT id FROM centros_costo WHERE empresa_id = ${empresaId} LIMIT 1`;
  return con((db) =>
    guardarTrabajador(db, empresaId, usuarioId, {
      numeroDocumento: "45678912",
      apellidoPaterno: "Inga",
      apellidoMaterno: "Campos",
      nombres: "Julio César",
      fechaIngreso: "2022-03-01",
      cargo: "Operario de almacén",
      regimenPension: "afp",
      afpCodigo: "integra",
      afpComision: "flujo",
      tieneHijos: true,
      basico: "2500.00",
      centroCostoId: cc!.id,
      ...over,
    } as never),
  );
}

// ─── Maestro de trabajadores ────────────────────────────────────────────────

describe("trabajadores", () => {
  test("el alta abre el historial de remuneraciones con la fecha de ingreso", async () => {
    // Con la fecha de hoy, un alta hecha en setiembre dejaría marzo a agosto sin
    // sueldo vigente y esas planillas saldrían en cero.
    const id = await contratar();
    const h = await con((db) => historialRemuneraciones(db, id));
    assert.equal(h.length, 1);
    assert.equal(h[0]!.vigenteDesde, "2022-03-01");
    assert.equal(h[0]!.basico, "2500.00");
    assert.equal(h[0]!.anterior, null);
  });

  test("un DNI de siete dígitos se rechaza aquí y no en la PLAME", async () => {
    await assert.rejects(() => contratar({ numeroDocumento: "4567891" }), TrabajadorInvalido);
  });

  test("un trabajador en AFP sin AFP se rechaza", async () => {
    // Dejarlo pasar daría un neto mayor que el real, y la diferencia habría que
    // reclamársela al trabajador el mes siguiente.
    await assert.rejects(
      () => contratar({ regimenPension: "afp", afpCodigo: undefined }),
      TrabajadorInvalido,
    );
  });
});

describe("historial de remuneraciones", () => {
  test("la variación se deriva de la fila anterior, no se guarda", async () => {
    const id = await contratar();
    await con((db) =>
      guardarRemuneracion(db, empresaId, usuarioId, {
        trabajadorId: id, vigenteDesde: "2024-01-01", basico: "2800.00", motivo: "Aumento anual",
      }),
    );
    await con((db) =>
      guardarRemuneracion(db, empresaId, usuarioId, {
        trabajadorId: id, vigenteDesde: "2025-07-01", basico: "3150.00", motivo: "Promoción",
      }),
    );

    const h = await con((db) => historialRemuneraciones(db, id));
    assert.equal(h.length, 3, "de la más reciente a la más antigua");
    assert.equal(h[0]!.basico, "3150.00");
    assert.equal(h[0]!.anterior, "2800.00");
    assert.equal(h[0]!.variacion, "350.00");
    assert.equal(h[0]!.variacionPorcentaje, "12.50");
    assert.equal(h[0]!.motivo, "Promoción");
    assert.equal(h[2]!.anterior, null, "el primero no tiene con qué compararse");
  });

  test("el sueldo vigente es el de la fecha, no el último", async () => {
    // Es lo que permite recalcular un mes viejo y que salga lo que salió.
    const id = await contratar();
    await con((db) =>
      guardarRemuneracion(db, empresaId, usuarioId, {
        trabajadorId: id, vigenteDesde: "2025-07-01", basico: "3150.00",
      }),
    );
    assert.equal(n((await con((db) => basicoEn(db, id, "2025-06-30")))!), 2500);
    assert.equal(n((await con((db) => basicoEn(db, id, "2025-07-01")))!), 3150);
  });

  test("una vigencia anterior al ingreso se rechaza", async () => {
    const id = await contratar();
    await assert.rejects(
      () =>
        con((db) =>
          guardarRemuneracion(db, empresaId, usuarioId, {
            trabajadorId: id, vigenteDesde: "2021-01-01", basico: "2000.00",
          }),
        ),
      PlanillaSueldosInvalida,
    );
  });
});

// ─── Contratos ──────────────────────────────────────────────────────────────

describe("contratos y sus vencimientos", () => {
  test("los vencidos van primero y no se esconden nunca", async () => {
    // Un plazo fijo que expiró sin renovar convierte la relación en
    // indeterminada por ley. Si sólo se listara «lo que vence pronto», eso ya no
    // aparecería y la empresa se enteraría cuando el trabajador lo reclama.
    const id = await contratar();
    await con((db) =>
      guardarContrato(db, empresaId, usuarioId, {
        trabajadorId: id, tipo: "plazo_fijo", modalidad: "necesidad de mercado",
        fechaInicio: "2025-01-01", fechaFin: "2025-08-31",
      }),
    );
    const lista = await con((db) => contratosPorVencer(db, 60, new Date("2025-09-26")));
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.vencido, true);
    assert.equal(lista[0]!.diasParaVencer, -26);
  });

  test("un plazo fijo sin fecha de fin es un indeterminado disfrazado y se rechaza", async () => {
    const id = await contratar();
    await assert.rejects(
      () =>
        con((db) =>
          guardarContrato(db, empresaId, usuarioId, {
            trabajadorId: id, tipo: "plazo_fijo", fechaInicio: "2025-01-01",
          }),
        ),
      PlanillaSueldosInvalida,
    );
  });

  test("el indeterminado no aparece en los avisos", async () => {
    const id = await contratar();
    await con((db) =>
      guardarContrato(db, empresaId, usuarioId, {
        trabajadorId: id, tipo: "indeterminado", fechaInicio: "2022-03-01",
      }),
    );
    assert.deepEqual(await con((db) => contratosPorVencer(db, 365, new Date("2025-09-26"))), []);
  });

  test("renovar encadena y una renovación con vacío se rechaza", async () => {
    const id = await contratar();
    const c1 = await con((db) =>
      guardarContrato(db, empresaId, usuarioId, {
        trabajadorId: id, tipo: "plazo_fijo", fechaInicio: "2025-01-01", fechaFin: "2025-06-30",
      }),
    );
    // Un hueco entre contratos rompe la continuidad y cambia el cómputo de los
    // beneficios sociales.
    await assert.rejects(
      () =>
        con((db) =>
          renovarContrato(db, empresaId, usuarioId, c1, {
            fechaInicio: "2025-08-01", fechaFin: "2025-12-31",
          }),
        ),
      PlanillaSueldosInvalida,
    );

    const c2 = await con((db) =>
      renovarContrato(db, empresaId, usuarioId, c1, {
        fechaInicio: "2025-07-01", fechaFin: "2025-12-31",
      }),
    );
    const { contratos } = await con((db) => cargarTrabajador(db, id));
    assert.equal(contratos.length, 2);
    assert.equal(contratos.find((c) => c.id === c1)!.estado, "renovado");
    assert.equal(contratos.find((c) => c.id === c1)!.renuevaA, c2);
  });
});

// ─── Parámetros y catálogo ──────────────────────────────────────────────────

describe("parámetros laborales", () => {
  test("lo que carga la empresa manda, y con su vigencia", async () => {
    await con((db) =>
      guardarParametroLaboral(db, empresaId, usuarioId, {
        clave: "uit", vigenteDesde: "2026-01-01", valor: "5600.00",
      }),
    );
    const antes = await con((db) => parametrosDeEmpresa(db, empresaId, "2025-12-31"));
    const despues = await con((db) => parametrosDeEmpresa(db, empresaId, "2026-01-01"));
    // Reabrir diciembre en enero tiene que dar lo mismo que dio en diciembre.
    assert.equal(n(String(antes.uit / 1000000n)), 5350);
    assert.equal(n(String(despues.uit / 1000000n)), 5600);
  });

  test("una clave inventada se rechaza en vez de guardarse e ignorarse", async () => {
    await assert.rejects(
      () =>
        con((db) =>
          guardarParametroLaboral(db, empresaId, usuarioId, {
            clave: "tasa_inventada", vigenteDesde: "2026-01-01", valor: "0.05",
          }),
        ),
      PlanillaSueldosInvalida,
    );
  });
});

describe("catálogo de conceptos", () => {
  test("sale el del programa sin sembrar nada, y lo propio lo pisa", async () => {
    const base = await con((db) => catalogoConceptos(db));
    assert.ok(base.some((c) => c.codigo === "BASICO"));
    assert.ok(base.some((c) => c.codigo === "ESSALUD"));

    await con((db) =>
      guardarConcepto(db, empresaId, usuarioId, {
        codigo: "BONOPROD", nombre: "Bono de producción", tipo: "ingreso", calculo: "manual",
        remunerativo: true, afectaQuinta: true, computableCts: true, cuenta: "6215",
      }),
    );
    const conPropio = await con((db) => catalogoConceptos(db));
    assert.equal(conPropio.length, base.length + 1);
    assert.ok(conPropio.some((c) => c.codigo === "BONOPROD"));
  });

  test("un aporte del empleador no puede marcarse como remuneración", async () => {
    // Entraría en la base de pensiones y en la CTS del trabajador; no es su
    // remuneración, es un costo de la empresa.
    await assert.rejects(
      () =>
        con((db) =>
          guardarConcepto(db, empresaId, usuarioId, {
            codigo: "SCTRX", nombre: "SCTR salud", tipo: "aporte", calculo: "manual",
            remunerativo: true, afectaQuinta: false, computableCts: false,
          }),
        ),
      PlanillaSueldosInvalida,
    );
  });
});

// ─── Planilla mensual ───────────────────────────────────────────────────────

describe("planilla mensual", () => {
  test("calcula, guarda la boleta y cuadra los totales", async () => {
    const id = await contratar();
    const r = await con((db) =>
      calcularPlanillaSueldos(db, empresaId, usuarioId, {
        numero: "PL-2025-09", periodo: "202509", fecha: "2025-09-30",
      }),
    );
    assert.equal(r.trabajadores, 1);
    assert.deepEqual(r.avisos, []);
    // 2 500 de básico + 113 de asignación familiar.
    assert.equal(r.totalIngresos, "2613.00");

    const { cabecera, boletas } = await con((db) => cargarPlanillaSueldos(db, r.planillaId));
    assert.equal(cabecera.estado, "borrador");
    assert.equal(boletas.length, 1);
    assert.ok(boletas[0]!.lineas.some((l) => l.codigo === "AFP_APORTE"));
    assert.ok(boletas[0]!.lineas.some((l) => l.codigo === "ESSALUD" && l.tipo === "aporte"));
    assert.equal(
      n(boletas[0]!.neto),
      n(boletas[0]!.totalIngresos) - n(boletas[0]!.totalDescuentos),
      "el aporte del empleador no sale del bolsillo del trabajador",
    );
  });

  test("recalcular rehace en vez de acumular", async () => {
    // Es lo que hace que corregir un sueldo y volver a calcular funcione como
    // espera cualquiera. Acumulando, el segundo cálculo duplicaría las boletas.
    const id = await contratar();
    const base = { numero: "PL-2025-09", periodo: "202509", fecha: "2025-09-30" };
    await con((db) => calcularPlanillaSueldos(db, empresaId, usuarioId, base));
    await con((db) =>
      guardarRemuneracion(db, empresaId, usuarioId, {
        trabajadorId: id, vigenteDesde: "2025-09-01", basico: "3000.00", motivo: "Aumento",
      }),
    );
    const r = await con((db) => calcularPlanillaSueldos(db, empresaId, usuarioId, base));

    assert.equal((await con((db) => listarPlanillasSueldos(db))).length, 1);
    assert.equal(r.totalIngresos, "3113.00");
    const { boletas } = await con((db) => cargarPlanillaSueldos(db, r.planillaId));
    assert.equal(boletas.length, 1);
    assert.equal(
      boletas[0]!.lineas.filter((l) => l.codigo === "BASICO").length,
      1,
      "una sola línea de básico, no dos",
    );
  });

  test("un trabajador sin sueldo vigente avisa en vez de salir en cero", async () => {
    // Una boleta en cero parece pagada y no lo está.
    const [cc] = await raw<{ id: string }[]>`
      SELECT id FROM centros_costo WHERE empresa_id = ${empresaId} LIMIT 1`;
    await con((db) =>
      guardarTrabajador(db, empresaId, usuarioId, {
        numeroDocumento: "11223344", apellidoPaterno: "Ayala", nombres: "Rosa",
        fechaIngreso: "2025-09-01", regimenPension: "onp", centroCostoId: cc!.id,
      }),
    );
    await contratar();
    const r = await con((db) =>
      calcularPlanillaSueldos(db, empresaId, usuarioId, {
        numero: "PL-2025-09", periodo: "202509", fecha: "2025-09-30",
      }),
    );
    assert.equal(r.trabajadores, 1, "el que sí tiene sueldo entra");
    assert.match(r.avisos.join(" "), /no tiene remuneración vigente/);
    assert.ok(r.avisos.join(" ").includes("AYALA"));
  });

  test("el asiento cuadra y la planilla queda cerrada", async () => {
    await contratar();
    const r = await con((db) =>
      calcularPlanillaSueldos(db, empresaId, usuarioId, {
        numero: "PL-2025-09", periodo: "202509", fecha: "2025-09-30",
      }),
    );
    const { asientoId } = await con((db) => cerrarPlanillaSueldos(db, empresaId, usuarioId, r.planillaId));
    assert.ok(asientoId);

    const { cabecera } = await con((db) => cargarPlanillaSueldos(db, r.planillaId));
    assert.equal(cabecera.estado, "cerrada");

    const balance = await con((db) => balanceComprobacion(db, "202509"));
    const debe = balance.reduce((a, l) => a + n(l.debe), 0);
    const haber = balance.reduce((a, l) => a + n(l.haber), 0);
    assert.equal(Math.round(debe * 100), Math.round(haber * 100), "el asiento cuadra");

    // Gasto de personal al debe, deuda con el trabajador al haber.
    const p4111 = balance.find((l) => l.cuenta === "4111");
    assert.ok(p4111 && n(p4111.haber) > 0, "el neto queda como deuda, no como pago");
    const p6211 = balance.find((l) => l.cuenta === "6211");
    assert.ok(p6211 && n(p6211.debe) > 0);
  });

  test("una planilla cerrada no se recalcula", async () => {
    await contratar();
    const base = { numero: "PL-2025-09", periodo: "202509", fecha: "2025-09-30" };
    const r = await con((db) => calcularPlanillaSueldos(db, empresaId, usuarioId, base));
    await con((db) => cerrarPlanillaSueldos(db, empresaId, usuarioId, r.planillaId));
    await assert.rejects(
      () => con((db) => calcularPlanillaSueldos(db, empresaId, usuarioId, base)),
      (e: unknown) => e instanceof PlanillaSueldosInvalida && /extórnela/.test(e.message),
    );
  });
});

// ─── Gratificación y CTS ────────────────────────────────────────────────────

describe("gratificación y CTS", () => {
  test("la gratificación de julio paga el semestre completo más el 9 %", async () => {
    await contratar();
    const r = await con((db) =>
      calcularPlanillaSueldos(db, empresaId, usuarioId, {
        numero: "GRA-2025-07", tipo: "gratificacion", periodo: "202507", fecha: "2025-07-15",
      }),
    );
    const { boletas } = await con((db) => cargarPlanillaSueldos(db, r.planillaId));
    const lineas = boletas[0]!.lineas;
    assert.equal(n(lineas.find((l) => l.codigo === "GRATIFICACION")!.importe), 2613);
    assert.equal(n(lineas.find((l) => l.codigo === "BONIF_GRATI")!.importe), 235.17);
  });

  test("la CTS incluye un sexto de la última gratificación", async () => {
    // Sin ese sexto sale un 8 % corta y el trabajador lo nota al compararla con
    // la del año anterior.
    await contratar();
    const g = await con((db) =>
      calcularPlanillaSueldos(db, empresaId, usuarioId, {
        numero: "GRA-2025-07", tipo: "gratificacion", periodo: "202507", fecha: "2025-07-15",
      }),
    );
    await con((db) => cerrarPlanillaSueldos(db, empresaId, usuarioId, g.planillaId));

    const r = await con((db) =>
      calcularPlanillaSueldos(db, empresaId, usuarioId, {
        numero: "CTS-2025-11", tipo: "cts", periodo: "202511", fecha: "2025-11-15",
      }),
    );
    const { boletas } = await con((db) => cargarPlanillaSueldos(db, r.planillaId));
    const linea = boletas[0]!.lineas.find((l) => l.codigo === "CTS")!;
    // Computable 2 500 + 113 + 2 613/6 = 3 048.50; semestre completo, la mitad.
    assert.match(linea.nota!, /3048\.50/);
    assert.equal(n(linea.importe), 1524.25);
  });
});

// ─── Cese y liquidación ─────────────────────────────────────────────────────

describe("cese y liquidación de beneficios sociales", () => {
  test("cesar deja la liquidación hecha, en la misma transacción", async () => {
    const id = await contratar();
    const r = await con((db) =>
      cesarTrabajador(db, empresaId, usuarioId, {
        trabajadorId: id, fechaCese: "2025-09-15", motivo: "renuncia",
      }),
    );
    assert.ok(r.conceptos >= 4, "días del mes, CTS trunca, gratificación trunca y vacaciones");
    assert.ok(n(r.neto) > 0);

    const { trabajador, contratos } = await con((db) => cargarTrabajador(db, id));
    assert.equal(trabajador.situacion, "cesado");
    assert.equal(trabajador.fechaCese, "2025-09-15");
    assert.deepEqual(contratos.filter((c) => c.estado === "vigente"), [],
      "sus contratos dejan de aparecer en el aviso de vencimientos");

    const { cabecera, boletas } = await con((db) => cargarPlanillaSueldos(db, r.planillaId));
    assert.equal(cabecera.tipo, "liquidacion");
    assert.equal(boletas[0]!.motivoCese, "renuncia");
    const codigos = boletas[0]!.lineas.map((l) => l.codigo);
    assert.ok(codigos.includes("CTS_TRUNCA"));
    assert.ok(codigos.includes("GRATI_TRUNCA"));
    assert.ok(codigos.includes("VAC_TRUNCAS"));
    assert.ok(!codigos.includes("INDEMNIZACION"), "una renuncia no se indemniza");
  });

  test("el despido arbitrario añade la indemnización con su aviso", async () => {
    const id = await contratar();
    const r = await con((db) =>
      cesarTrabajador(db, empresaId, usuarioId, {
        trabajadorId: id, fechaCese: "2025-09-15", motivo: "despido_arbitrario",
      }),
    );
    const { boletas } = await con((db) => cargarPlanillaSueldos(db, r.planillaId));
    const ind = boletas[0]!.lineas.find((l) => l.codigo === "INDEMNIZACION")!;
    assert.ok(n(ind.importe) > 0);
    assert.match(ind.nota!, /decisión legal/);
  });

  test("no se cesa dos veces", async () => {
    const id = await contratar();
    await con((db) =>
      cesarTrabajador(db, empresaId, usuarioId, {
        trabajadorId: id, fechaCese: "2025-09-15", motivo: "renuncia",
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          cesarTrabajador(db, empresaId, usuarioId, {
            trabajadorId: id, fechaCese: "2025-10-15", motivo: "renuncia",
          }),
        ),
      TrabajadorInvalido,
    );
  });

  test("el cesado no entra en la planilla del mes siguiente", async () => {
    const id = await contratar();
    await con((db) =>
      cesarTrabajador(db, empresaId, usuarioId, {
        trabajadorId: id, fechaCese: "2025-09-15", motivo: "renuncia",
      }),
    );
    await assert.rejects(
      () =>
        con((db) =>
          calcularPlanillaSueldos(db, empresaId, usuarioId, {
            numero: "PL-2025-10", periodo: "202510", fecha: "2025-10-31",
          }),
        ),
      (e: unknown) => e instanceof PlanillaSueldosInvalida && /no hay trabajadores/.test(e.message),
    );
  });

  test("los descuentos pendientes salen de la liquidación", async () => {
    const id = await contratar();
    const r = await con((db) =>
      cesarTrabajador(db, empresaId, usuarioId, {
        trabajadorId: id, fechaCese: "2025-09-15", motivo: "renuncia",
        descuentos: [{ codigo: "PRESTAMO", nombre: "Saldo de préstamo", importe: "800.00" }],
      }),
    );
    const { cabecera } = await con((db) => cargarPlanillaSueldos(db, r.planillaId));
    assert.equal(n(cabecera.totalDescuentos), 800);
    assert.equal(
      Math.round(n(cabecera.totalNeto) * 100),
      Math.round((n(cabecera.totalIngresos) - 800) * 100),
    );
  });
});

describe("anulación", () => {
  test("una planilla pagada no se anula", async () => {
    // Ya salió del banco: anularla dejaría el dinero fuera sin nada que lo
    // sustente.
    await contratar();
    const r = await con((db) =>
      calcularPlanillaSueldos(db, empresaId, usuarioId, {
        numero: "PL-2025-09", periodo: "202509", fecha: "2025-09-30",
      }),
    );
    await raw`UPDATE planillas_sueldos SET estado = 'pagada' WHERE id = ${r.planillaId}`;
    await assert.rejects(
      () => con((db) => anularPlanillaSueldos(db, r.planillaId, "prueba")),
      PlanillaSueldosInvalida,
    );
  });
});
