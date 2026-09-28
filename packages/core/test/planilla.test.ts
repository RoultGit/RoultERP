/**
 * El cálculo de la planilla, con números a mano.
 *
 * Cada caso de aquí es uno que se puede verificar con una calculadora y
 * contrastar contra la planilla que SERVIDIMAR lleva hoy, que es lo que el
 * cliente pidió: «las mismas fórmulas y criterios». Mientras no se vea su
 * planilla real, esto es lo que dice la ley.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { money } from "../src/index.ts";
import {
  parametrosEn, ParametroFaltante, vigenteEn, UIT,
  CONCEPTOS_BASE, calcularBoleta, quintaCategoria, impuestoPorEscala,
  gratificacion, cts, computableCts, vacacionesTruncas, mesesYDias,
  liquidacionBeneficios,
} from "../src/planilla/index.ts";

const p = parametrosEn("2025-09-01");
const n = (v: string) => Number(v);

/** Un operario del régimen general, en AFP Integra con comisión por flujo. */
const operario = {
  id: "t1",
  nombre: "Wilder Inga",
  basico: "2500.00",
  regimen: { sistema: "afp", afp: "integra", comision: "flujo" } as const,
  tieneHijos: true,
};

const mesCompleto = { periodo: "2025-09", fecha: "2025-09-01", diasTrabajados: 30 };

// ─── Parámetros ─────────────────────────────────────────────────────────────

describe("parámetros con vigencia", () => {
  test("cada periodo usa el valor que regía ese día, no el de hoy", () => {
    // Es lo que permite reabrir diciembre en febrero sin que cambien las cifras.
    assert.equal(vigenteEn(UIT, "2024-06-30"), "5150.00");
    assert.equal(vigenteEn(UIT, "2025-01-01"), "5350.00");
  });

  test("un parámetro que falta rompe en vez de suponer el del año pasado", () => {
    // Correr enero con la UIT vieja retiene de menos todo el año y el trabajador
    // se entera en la regularización, con una deuda que no esperaba.
    assert.throws(() => parametrosEn("1999-01-01"), ParametroFaltante);
  });

  test("lo que la empresa cargó manda sobre el valor de partida", () => {
    const propio = parametrosEn("2025-09-01", { uit: "5600.00" });
    assert.equal(money.toString(propio.uit, 2), "5600.00");
    // Y lo que no cargó sigue siendo el de la ley.
    assert.equal(money.toString(propio.rmv, 2), "1130.00");
  });
});

// ─── Boleta mensual ─────────────────────────────────────────────────────────

describe("boleta mensual", () => {
  test("un mes completo en AFP: ingresos, descuentos y aportes", () => {
    const b = calcularBoleta({
      trabajador: operario,
      periodo: mesCompleto,
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });

    // Básico 2 500 + asignación familiar 113 (10 % de la RMV de 1 130).
    assert.equal(b.totalIngresos, "2613.00");
    assert.equal(b.baseRemunerativa, "2613.00");

    const linea = (c: string) => b.lineas.find((l) => l.codigo === c);
    assert.equal(linea("ASIGFAM")!.importe, "113.00");
    // AFP Integra: 10 % de aporte, 1.55 % de comisión, 1.74 % de prima.
    assert.equal(linea("AFP_APORTE")!.importe, "261.30");
    assert.equal(linea("AFP_COMISION")!.importe, "40.50");
    assert.equal(linea("AFP_PRIMA")!.importe, "45.47");
    assert.equal(linea("ONP"), undefined, "quien está en AFP no paga ONP");
    // EsSalud es aporte del empleador: 9 % de 2 613.
    assert.equal(linea("ESSALUD")!.importe, "235.17");

    assert.equal(b.neto, money.toString(
      money.sub(money.dec(b.totalIngresos), money.dec(b.totalDescuentos)), 2));
    assert.equal(b.costoEmpleador, "2848.17", "sueldo más lo que la empresa pone encima");
    assert.deepEqual(b.avisos, []);
  });

  test("la asignación familiar no se prorratea por días, el básico sí", () => {
    // Quien entra el 16 cobra medio sueldo, pero la asignación familiar es un
    // monto fijo por tener hijos, no una contraprestación por el tiempo.
    const b = calcularBoleta({
      trabajador: operario,
      periodo: { ...mesCompleto, diasTrabajados: 15 },
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });
    const linea = (c: string) => b.lineas.find((l) => l.codigo === c);
    assert.equal(linea("BASICO")!.importe, "1250.00");
    assert.equal(linea("ASIGFAM")!.importe, "113.00");
  });

  test("sin hijos no hay asignación familiar", () => {
    const b = calcularBoleta({
      trabajador: { ...operario, tieneHijos: false },
      periodo: mesCompleto,
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });
    assert.equal(b.baseRemunerativa, "2500.00");
  });

  test("la movilidad de reparto no engorda ninguna base", () => {
    // Es condición de trabajo: no paga pensión, ni EsSalud, ni CTS, ni
    // gratificación. Marcarla como remunerativa infla todos los beneficios y el
    // error no aparece hasta que alguien se va.
    const b = calcularBoleta({
      trabajador: { ...operario, tieneHijos: false },
      periodo: mesCompleto,
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      manuales: { MOVILIDAD: "300.00" },
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });
    assert.equal(b.totalIngresos, "2800.00", "sí llega al bolsillo");
    assert.equal(b.baseRemunerativa, "2500.00", "pero no a la base de pensiones");
    const essalud = b.lineas.find((l) => l.codigo === "ESSALUD")!;
    assert.equal(essalud.importe, "225.00", "9 % de 2 500, no de 2 800");
  });

  test("en ONP se descuenta el 13 % y ninguna línea de AFP", () => {
    const b = calcularBoleta({
      trabajador: { ...operario, regimen: { sistema: "onp" }, tieneHijos: false },
      periodo: mesCompleto,
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });
    assert.equal(b.lineas.find((l) => l.codigo === "ONP")!.importe, "325.00");
    assert.ok(!b.lineas.some((l) => l.codigo.startsWith("AFP")));
  });

  test("una AFP desconocida avisa; no se pasa a ONP ni se deja en cero", () => {
    // Dejarlo en cero le daría al trabajador un neto mayor que el suyo, y la
    // diferencia la acabaría poniendo la empresa.
    const b = calcularBoleta({
      trabajador: { ...operario, regimen: { sistema: "afp", afp: "inexistente", comision: "flujo" } },
      periodo: mesCompleto,
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });
    assert.ok(b.avisos.length > 0);
    assert.ok(b.lineas.some((l) => l.codigo === "AFP_APORTE" && l.aviso));
  });

  test("la comisión mixta no descuenta sobre la remuneración", () => {
    // Se cobra sobre el saldo del fondo y la cobra la AFP, no la planilla.
    const b = calcularBoleta({
      trabajador: { ...operario, regimen: { sistema: "afp", afp: "habitat", comision: "mixta" } },
      periodo: mesCompleto,
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });
    assert.equal(b.lineas.find((l) => l.codigo === "AFP_COMISION"), undefined);
    assert.ok(b.lineas.find((l) => l.codigo === "AFP_APORTE"));
  });

  test("EsSalud tiene piso en la RMV aunque el sueldo sea menor", () => {
    const b = calcularBoleta({
      trabajador: { ...operario, basico: "600.00", tieneHijos: false, regimen: { sistema: "onp" } },
      periodo: mesCompleto,
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });
    // 9 % de 1 130, no de 600.
    assert.equal(b.lineas.find((l) => l.codigo === "ESSALUD")!.importe, "101.70");
  });

  test("la prima de la AFP se topa en la remuneración máxima asegurable", () => {
    // Sin el tope, un gerente paga prima sobre todo su sueldo y se le descuenta
    // de más justo donde más se revisa la boleta.
    const b = calcularBoleta({
      trabajador: { ...operario, basico: "20000.00", tieneHijos: false },
      periodo: mesCompleto,
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    });
    // 1.74 % de 12 933.32, no de 20 000.
    assert.equal(b.lineas.find((l) => l.codigo === "AFP_PRIMA")!.importe, "225.04");
    assert.equal(b.lineas.find((l) => l.codigo === "AFP_APORTE")!.importe, "2000.00");
  });

  test("la segunda quincena descuenta el adelanto, sin recalcular pensiones", () => {
    // Descontar media ONP dos veces no suma lo mismo que el mes entero por el
    // redondeo, y la declaración se hace sobre el mes.
    const base = {
      trabajador: { ...operario, regimen: { sistema: "onp" } as const, tieneHijos: false },
      conceptos: CONCEPTOS_BASE,
      parametros: p,
      acumulado: { rentaPagada: "0", retenido: "0", mesesRestantes: 4, gratificacionesRestantes: 1 },
    };
    const mes = calcularBoleta({ ...base, periodo: mesCompleto });
    const cierre = calcularBoleta({
      ...base,
      periodo: { ...mesCompleto, quincena: 2, adelantoQuincena: "1000.00" },
    });
    assert.equal(
      n(cierre.neto),
      n(mes.neto) - 1000,
      "el mes se liquida entero y se resta lo ya entregado",
    );
  });
});

// ─── Quinta categoría ───────────────────────────────────────────────────────

describe("renta de quinta categoría", () => {
  test("hasta 7 UIT no se retiene nada", () => {
    // 7 × 5 350 = 37 450 al año, unos 2 675 al mes contando gratificaciones.
    const { retencion } = quintaCategoria(
      money.dec("2500"),
      { rentaPagada: "0", retenido: "0", mesesRestantes: 12, gratificacionesRestantes: 2 },
      p,
    );
    assert.equal(money.toString(retencion, 2), "0.00");
  });

  test("cada tramo paga su tasa sólo sobre su parte", () => {
    // 10 UIT de renta neta: 5 UIT al 8 % y 5 UIT al 14 %.
    const uit = money.dec("5350");
    const esperado = 5 * 5350 * 0.08 + 5 * 5350 * 0.14;
    assert.equal(n(money.toString(impuestoPorEscala(money.mul(uit, money.dec("10")), uit), 2)),
      Number(esperado.toFixed(2)));
  });

  test("proyecta el año entero y reparte lo que falta entre los meses que quedan", () => {
    // Un sueldo de 10 000 con 14 pagas: 140 000 al año.
    const a = { rentaPagada: "0", retenido: "0", mesesRestantes: 12, gratificacionesRestantes: 2 };
    const { proyeccion, impuestoAnual, retencion } = quintaCategoria(money.dec("10000"), a, p);
    assert.equal(money.toString(proyeccion, 2), "140000.00");
    // Neta: 140 000 − 37 450 = 102 550. Tramos: 5 UIT al 8 %, 15 al 14 %,
    // 15 al 17 % y el resto al 20 %.
    assert.equal(money.toString(retencion, 2),
      money.toString(money.round(money.div(impuestoAnual, money.dec("12")), 2), 2));
  });

  test("lo ya retenido se descuenta: no se cobra dos veces", () => {
    const sinRetener = quintaCategoria(
      money.dec("10000"),
      { rentaPagada: "110000", retenido: "0", mesesRestantes: 3, gratificacionesRestantes: 0 },
      p,
    );
    const conRetenido = quintaCategoria(
      money.dec("10000"),
      { rentaPagada: "110000", retenido: "9000", mesesRestantes: 3, gratificacionesRestantes: 0 },
      p,
    );
    assert.ok(n(money.toString(conRetenido.retencion, 2)) < n(money.toString(sinRetener.retencion, 2)));
    assert.equal(
      n(money.toString(sinRetener.retencion, 2)) - n(money.toString(conRetenido.retencion, 2)),
      3000,
      "9 000 ya retenidos repartidos entre los 3 meses que quedan",
    );
  });

  test("si ya se retuvo de más, la retención es cero y no negativa", () => {
    const { retencion } = quintaCategoria(
      money.dec("3000"),
      { rentaPagada: "36000", retenido: "99999", mesesRestantes: 1, gratificacionesRestantes: 0 },
      p,
    );
    assert.equal(money.toString(retencion, 2), "0.00");
  });
});

// ─── Cómputo de tiempo ──────────────────────────────────────────────────────

describe("cómputo de meses y días", () => {
  test("de 1 de enero a 30 de junio son seis meses exactos", () => {
    assert.deepEqual(mesesYDias("2025-01-01", "2025-06-30"), { meses: 6, dias: 0 });
  });

  test("el 31 se cuenta como el 30: el mes está completo, no sobra un día", () => {
    assert.deepEqual(mesesYDias("2025-01-01", "2025-01-31"), { meses: 1, dias: 0 });
  });

  test("un mes incompleto deja sus días en treintavos", () => {
    assert.deepEqual(mesesYDias("2025-01-01", "2025-03-15"), { meses: 2, dias: 15 });
  });

  test("febrero no descuadra el cómputo", () => {
    // Por calendario serían 28 días; el cómputo laboral cuenta el mes.
    assert.deepEqual(mesesYDias("2025-02-01", "2025-02-28"), { meses: 0, dias: 28 });
  });
});

// ─── Gratificación y CTS ────────────────────────────────────────────────────

describe("gratificación", () => {
  test("semestre completo: un sueldo más el 9 % de la Ley 30334", () => {
    const g = gratificacion("2613.00", 6, p);
    assert.equal(g.gratificacion, "2613.00");
    assert.equal(g.bonificacion, "235.17");
    assert.equal(g.total, "2848.17");
  });

  test("medio semestre: tantos sextos como meses completos", () => {
    const g = gratificacion("2613.00", 3, p);
    assert.equal(g.gratificacion, "1306.50");
  });

  test("los días sueltos no cuentan: la norma habla de meses completos", () => {
    // Es el error que sale solo al copiar la fórmula de la CTS, que sí los
    // cuenta. Copiarla paga de más.
    assert.equal(gratificacion("2613.00", 0, p).total, "0.00");
  });
});

describe("CTS", () => {
  test("la computable incluye un sexto de la gratificación", () => {
    // Sin ese sexto la CTS sale un 8 % corta, y el trabajador lo nota al
    // compararla con la del año anterior.
    const rc = computableCts("2500.00", "113.00", "2613.00");
    assert.equal(rc, "3048.50");
    assert.equal(n(rc) - 2613, 435.5, "2 613 / 6");
  });

  test("un semestre completo deposita la mitad de la computable", () => {
    const c = cts("3048.50", 6, 0);
    assert.equal(c.total, "1524.25");
  });

  test("los días sueltos se pagan en treintavos del dozavo", () => {
    const c = cts("3048.50", 4, 15);
    // 4/12 de 3 048.50 más medio dozavo.
    assert.equal(c.porMeses, "1016.17");
    assert.equal(c.porDias, "127.02");
    assert.equal(c.total, "1143.19");
  });
});

// ─── Liquidación de beneficios sociales ─────────────────────────────────────

describe("liquidación de beneficios sociales", () => {
  const base = {
    fechaIngreso: "2022-03-01",
    fechaCese: "2025-09-15",
    remuneracion: "2500.00",
    asignacionFamiliar: "113.00",
    ultimaGratificacion: "2613.00",
    ctsDesde: "2025-05-01",
    vacacionesDesde: "2025-03-01",
    diasDelMes: 15,
  };

  test("reúne los cinco conceptos y no se olvida ninguno", () => {
    const l = liquidacionBeneficios({ ...base, motivo: "renuncia" }, p);
    const codigos = l.conceptos.map((c) => c.codigo);
    assert.ok(codigos.includes("REM_CESE"));
    assert.ok(codigos.includes("CTS_TRUNCA"));
    assert.ok(codigos.includes("GRATI_TRUNCA"));
    assert.ok(codigos.includes("BONIF_GRATI"));
    assert.ok(codigos.includes("VAC_TRUNCAS"));
    assert.ok(!codigos.includes("INDEMNIZACION"), "una renuncia no se indemniza");

    assert.deepEqual(l.tiempoServicio, { anios: 3, meses: 6, dias: 15 });
    // Quince días del mes del cese: la mitad de 2 613.
    assert.equal(l.conceptos.find((c) => c.codigo === "REM_CESE")!.importe, "1306.50");
    assert.equal(n(l.neto), n(l.totalBruto));
  });

  test("la falta grave quita la indemnización, no lo ya ganado", () => {
    // Es el error que más se comete al liquidar enfadado.
    const l = liquidacionBeneficios({ ...base, motivo: "falta_grave" }, p);
    assert.ok(!l.conceptos.some((c) => c.codigo === "INDEMNIZACION"));
    assert.ok(l.conceptos.some((c) => c.codigo === "CTS_TRUNCA"));
    assert.ok(l.conceptos.some((c) => c.codigo === "VAC_TRUNCAS"));
  });

  test("el despido arbitrario indemniza, con tope y con aviso", () => {
    const l = liquidacionBeneficios({ ...base, motivo: "despido_arbitrario" }, p);
    const ind = l.conceptos.find((c) => c.codigo === "INDEMNIZACION")!;
    // 1.5 sueldos por año: 3 años y medio sobre 2 613.
    assert.ok(n(ind.importe) > 13000 && n(ind.importe) < 14000);
    assert.match(ind.nota!, /decisión legal/, "la califica una persona, no el sistema");
  });

  test("el tope de doce remuneraciones se respeta", () => {
    const l = liquidacionBeneficios(
      { ...base, motivo: "despido_arbitrario", fechaIngreso: "1998-01-01" },
      p,
    );
    const ind = l.conceptos.find((c) => c.codigo === "INDEMNIZACION")!;
    assert.equal(n(ind.importe), 2613 * 12);
  });

  test("los adelantos se descuentan del neto", () => {
    const l = liquidacionBeneficios(
      {
        ...base,
        motivo: "renuncia",
        descuentos: [{ codigo: "PRESTAMO", nombre: "Saldo de préstamo", importe: "800.00" }],
      },
      p,
    );
    assert.equal(l.totalDescuentos, "800.00");
    assert.equal(n(l.neto), n(l.totalBruto) - 800);
  });

  test("las vacaciones ganadas y no gozadas van además de las truncas", () => {
    const l = liquidacionBeneficios({ ...base, motivo: "renuncia", diasVacacionesPendientes: 30 }, p);
    assert.equal(l.conceptos.find((c) => c.codigo === "VAC_PENDIENTES")!.importe, "2613.00");
    assert.ok(l.conceptos.some((c) => c.codigo === "VAC_TRUNCAS"), "y el periodo en curso también");
  });
});

describe("vacaciones truncas", () => {
  test("un doceavo por mes completo y treintavos por los días", () => {
    const v = vacacionesTruncas("2613.00", 6, 15);
    assert.equal(v.total, "1415.38");
  });
});
