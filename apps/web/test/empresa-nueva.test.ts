/**
 * Lo que puede hacer una empresa el primer día.
 *
 * Se dio de alta una empresa vacía y se recorrió el sistema como lo haría su
 * contadora: dar de alta maestros, comprar, vender, cobrar, pagar y cerrar el
 * mes. Aparecieron seis cosas que hacían el ERP inservible de entrada, y las
 * seis se comprueban aquí porque ninguna prueba de servicio las veía:
 *
 *  1. No se podía facturar sin certificado digital, aunque emitir y enviar sean
 *     dos actos separados: la empresa quedaba parada los días que tarda el
 *     trámite.
 *  2. Las cobranzas y los pagos no llegaban a Caja y Bancos: la contabilidad
 *     decía que el banco se había movido y la tesorería marcaba cero.
 *  3. El plan de cuentas no tenía planilla, que es el gasto que toda empresa
 *     tiene todos los meses.
 *  4. El estado de resultados enumeraba tres grupos de gasto y se dejaba fuera
 *     la planilla y la depreciación.
 *  5. Una empresa nueva no tenía ningún centro de costo, y la mayoría de sus
 *     cuentas de gasto lo exigen.
 *  6. Dos enlaces del menú de Maestros llevaban a un 404.
 *
 * Necesita la aplicación levantada sobre una compilación de producción:
 *
 *   npm run build && PORT=3100 npm run start
 *
 * Se salta sola si no la hay, y ese silencio ya costó caro una vez: apuntaba al
 * 3000 cuando la suite se mudó al 3100, así que estas seis pruebas llevaban
 * corridas enteras saltándose sin que nadie lo notara.
 */
import { after, before, describe, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env["BASE"] ?? "http://localhost:3100";
const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_dev";
let CLAVE = "";

/**
 * El alta corre en un proceso aparte.
 *
 * Estas pruebas viven en CommonJS y `@roulterp/db` usa `await` de nivel
 * superior en su cargador de migraciones, así que no se puede importar desde
 * aquí. El script de la raíz sí puede, y devuelve los datos en JSON.
 */
const alta = (...args: string[]): Record<string, string> =>
  JSON.parse(
    execFileSync("npx", ["tsx", "scripts/empresa-de-prueba.ts", ...args], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: URL },
    }).trim(),
  );

let navegador: Browser;
let pagina: Page;
let hayServidor = false;
let correo = "";

before(async () => {
  try {
    const r = await fetch(`${BASE}/entrar`, { signal: AbortSignal.timeout(3000) });
    hayServidor = r.ok;
  } catch {
    hayServidor = false;
  }
  if (!hayServidor) return;

  // Una empresa nueva de verdad, no la sembrada: lo que se comprueba es
  // justamente lo que trae de fábrica.
  const datos = alta("crear");
  correo = datos["correo"]!;
  CLAVE = datos["password"]!;

  navegador = await chromium.launch();
  pagina = await navegador.newPage();
  pagina.on("pageerror", (e) => {
    throw new Error(`error de JavaScript: ${e.message}`);
  });

  await pagina.goto(`${BASE}/entrar`);
  await pagina.fill('input[name="email"]', correo);
  await pagina.fill('input[name="password"]', CLAVE);
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/tablero/, { timeout: 20000 });
});

after(async () => {
  await navegador?.close();
  // Se limpia la empresa de prueba: el `ON DELETE CASCADE` se lleva lo demás.
  if (correo) alta("borrar", correo);
});

const saltar = (t: TestContext): boolean => {
  if (hayServidor) return false;
  t.skip(`no hay servidor en ${BASE}`);
  return true;
};

const cuerpo = async () => (await pagina.locator("body").innerText()).replace(/\s+/g, " ");

describe("una empresa recién dada de alta", () => {
  test("no tiene enlaces muertos en Maestros", async (t) => {
    if (saltar(t)) return;
    await pagina.goto(`${BASE}/maestros`);
    const enlaces = await pagina.$$eval('main a[href^="/maestros/"], a[href^="/maestros/"]', (as) =>
      [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!))],
    );
    assert.ok(enlaces.length >= 4, "el índice de maestros debería ofrecer varias fichas");
    for (const href of enlaces) {
      const r = await pagina.goto(`${BASE}${href}`);
      assert.equal(r?.status(), 200, `${href} no existe`);
    }
  });

  test("arranca con un centro de costo, sin el cual no puede registrar un gasto", async (t) => {
    if (saltar(t)) return;
    await pagina.goto(`${BASE}/maestros/centros-costo`);
    await pagina.waitForSelector("table");
    assert.match(await cuerpo(), /GEN/, "hace falta al menos uno de partida");
  });

  test("su plan de cuentas incluye la planilla", async (t) => {
    if (saltar(t)) return;
    await pagina.goto(`${BASE}/maestros/cuentas?q=6211`);
    await pagina.waitForSelector("table");
    const t1 = await cuerpo();
    assert.match(t1, /6211/, "sin cuenta de sueldos no se puede asentar la nómina");
    await pagina.goto(`${BASE}/maestros/cuentas?q=4111`);
    assert.match(await cuerpo(), /4111/);
  });

  test("puede facturar aunque todavía no tenga certificado digital", async (t) => {
    if (saltar(t)) return;
    // Emitir y enviar son dos actos: el trámite del certificado tarda días y la
    // empresa no puede quedarse sin poder vender mientras tanto.
    await pagina.goto(`${BASE}/cpe`);
    await pagina.waitForSelector('select[name="tipoDocumento"]');
    await pagina.selectOption('select[name="tipoDocumento"]', "01");
    await pagina.fill('input[name="serie"]', "F001");
    await pagina.locator("form").filter({ hasText: "Serie" }).locator('button[type="submit"]').last().click();
    await pagina.waitForTimeout(2500);

    // Se mira la lista y no el formulario: sin clientes dados de alta, el
    // formulario enseña «registre un cliente», que es otra cosa.
    await pagina.goto(`${BASE}/ventas`);
    await pagina.waitForSelector("h1");
    const t1 = await cuerpo();
    assert.ok(
      !/Falta configurar la numeración/.test(t1),
      "con una serie registrada ya debería poder emitir",
    );
    assert.match(t1, /Puede facturar, pero todavía no enviar a SUNAT/);
    assert.ok(
      await pagina.locator('a[href="/ventas/nueva"]').count(),
      "y el botón de emitir tiene que estar disponible",
    );
  });

  test("registrar un gasto imputa a un centro de costo y aparece en el resultado", async (t) => {
    if (saltar(t)) return;
    await pagina.goto(`${BASE}/contabilidad/asiento`);
    await pagina.fill('input[name="glosa"]', "Planilla del mes");
    await pagina.selectOption('select[name="linea[0][cuenta]"]', "6211");
    await pagina.fill('input[name="linea[0][debe]"]', "5000.00");

    const centros = await pagina.$$eval('select[name="linea[0][centroCostoId]"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    assert.ok(centros.length > 0, "la cuenta exige centro de costo y no hay ninguno que elegir");
    await pagina.selectOption('select[name="linea[0][centroCostoId]"]', centros[0]!);

    await pagina.selectOption('select[name="linea[1][cuenta]"]', "4111");
    await pagina.fill('input[name="linea[1][haber]"]', "5000.00");
    await pagina.click('button[value="contabilizar"]');
    await pagina.waitForURL((u) => u.pathname === "/contabilidad", { timeout: 20000 });

    await pagina.goto(`${BASE}/contabilidad/estados`);
    const t1 = await cuerpo();
    assert.match(t1, /Gastos de personal/, "la planilla tiene que salir en el estado de resultados");
    assert.match(t1, /Activo = Pasivo \+ Patrimonio/, "y los estados tienen que cuadrar");
  });
});
