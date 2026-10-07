/**
 * Un mes de operaciones de la empresa, de punta a punta, por la interfaz.
 *
 * Las demás pruebas comprueban funciones: que el IGV se calcula, que el asiento
 * cuadra, que el kardex valora al promedio. Esta comprueba otra cosa: que la
 * cadena se sostiene cuando las piezas se usan en el orden en que las usa una
 * empresa de verdad, y que al final los números coinciden entre sí.
 *
 * Existe porque esa diferencia encontró tres fallos que mil trescientas pruebas
 * no veían, todos en la junta entre dos piezas que por separado funcionaban:
 *
 *  1. Elegir un producto del desplegable y pulsar «Emitir orden» daba «necesita
 *     al menos una línea con producto». `leerLineas` de compras descartaba toda
 *     fila sin descripción, y elegir un producto no la rellena. Bloqueaba la
 *     orden de compra y el registro de la factura, que es por donde entra todo.
 *  2. Comprar mercadería sin indicar almacén registraba la deuda y cargaba la
 *     cuenta 20 de existencias, pero no movía el kardex. Diecisiete mil soles de
 *     mercadería que la contabilidad tenía y el almacén no, sin un aviso.
 *  3. El límite de crédito no se comprobaba al facturar. `cabeEnElLimite`
 *     existía con sus pruebas y no la llamaba nadie.
 *
 * Necesita la aplicación levantada contra una compilación de producción y una
 * base sembrada, igual que `navegador.test.ts`:
 *
 *   DATABASE_URL=postgres://localhost/roulterp_dev npm run sembrar
 *   npm run build
 *   PORT=3100 node apps/web/.next/standalone/apps/web/server.js
 *   npm run test:navegador
 *
 * Se salta sola si no hay nada escuchando.
 */
import { after, before, describe, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env["BASE"] ?? "http://localhost:3100";
const USUARIO = process.env["E2E_USUARIO"] ?? "admin@servidimar.pe";
const CLAVE = process.env["E2E_CLAVE"] ?? "roulterp-desarrollo-1";

/** Dígito verificador del RUC peruano: módulo 11, pesos 5,4,3,2,7,6,5,4,3,2. */
function conDigito(base10: string): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = [...base10].reduce((a, c, i) => a + Number(c) * pesos[i]!, 0);
  let r = 11 - (suma % 11);
  if (r === 10) r = 0;
  if (r === 11) r = 1;
  return base10 + String(r);
}

let navegador: Browser;
let pagina: Page;
let hayServidor = false;

/**
 * Sufijo único: la prueba corre sobre una base que ya tiene datos y puede
 * correrse dos veces sin resembrar.
 *
 * El RUC también sale de aquí. Con uno fijo, la segunda ejecución chocaba contra
 * el tercero que había dejado la primera y el error era «ese documento ya está
 * registrado», que no es lo que la prueba quiere comprobar.
 */
const SUF = String(Date.now()).slice(-6);
/** Base de diez dígitos para el RUC, distinta en cada ejecución. */
const BASE_RUC = `20${SUF}0`;
const hoy = new Date();
const fecha = (dias = 0): string => {
  const x = new Date(hoy);
  x.setDate(x.getDate() + dias);
  return x.toISOString().slice(0, 10);
};
const PERIODO = fecha().slice(0, 4) + fecha().slice(5, 7);

function sinServidor(t: TestContext): boolean {
  if (!hayServidor) {
    t.skip("no hay servidor en " + BASE);
    return true;
  }
  return false;
}

/**
 * Las opciones de un desplegable, esperando a que haya al menos una.
 *
 * La espera no es decorativa: sin ella se lee el DOM del instante, y un
 * desplegable que todavía no acabó de pintarse devuelve una lista vacía que la
 * prueba interpreta como «no hay almacenes».
 */
async function opciones(sel: string) {
  await pagina
    .locator(`${sel} option[value]:not([value=""])`)
    .first()
    .waitFor({ state: "attached", timeout: 30000 })
    .catch(() => {});
  return pagina.$$eval(`${sel} option`, (os) =>
    os
      .map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent?.trim() ?? "" }))
      .filter((o) => o.v),
  );
}

/**
 * Elige del desplegable la opción cuyo texto contiene lo que se pide.
 *
 * Espera a que la opción exista antes de leerla. `$$eval` no espera nada: mira
 * el DOM tal como está en ese instante. Corriendo la prueba sola, justo después
 * de sembrar, el desplegable se leía antes de acabar de pintarse y el fallo era
 * «el cliente no sale», con el cliente perfectamente guardado en la base. En la
 * suite completa no pasaba porque las rutas ya estaban calientes, que es la
 * clase de prueba que falla sólo cuando nadie la está mirando.
 */
async function elegir(sel: string, contiene: string) {
  await pagina
    .locator(`${sel} option`, { hasText: contiene })
    .first()
    .waitFor({ state: "attached", timeout: 30000 })
    .catch(() => {});
  const o = (await opciones(sel)).find((x) => x.t.includes(contiene));
  assert.ok(o, `«${contiene}» no sale en ${sel}`);
  await pagina.selectOption(sel, o.v);
  return o.v;
}

/**
 * Pulsa y exige que la pantalla cambie de dirección.
 *
 * Si no cambia, el motivo está en `[role="alert"]`, que es donde el formulario
 * pone el error. Buscarlo en el texto de la pantalla de destino sólo encuentra
 * ruido: la primera versión de esta prueba leía el título de la página y daba
 * por buenas tres altas que habían fallado.
 */
async function enviar(boton: string) {
  const antes = pagina.url();
  await pagina.click(`button:text-is("${boton}")`);
  await pagina
    .waitForFunction((u) => location.href !== u, antes, { timeout: 30000 })
    .catch(() => {});
  if (pagina.url() !== antes) return;
  const err = await pagina
    .locator('[role="alert"]')
    .first()
    .textContent({ timeout: 2000 })
    .catch(() => null);
  assert.fail(`«${boton}» no hizo nada: ${err?.trim() ?? "sin mensaje"}`);
}

before(async () => {
  try {
    const r = await fetch(`${BASE}/entrar`);
    hayServidor = r.ok;
  } catch {
    hayServidor = false;
  }
  if (!hayServidor) return;

  navegador = await chromium.launch();
  pagina = await (await navegador.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await pagina.goto(`${BASE}/entrar`);
  await pagina.fill('input[name="email"]', USUARIO);
  await pagina.fill('input[name="password"]', CLAVE);
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL((u) => !u.pathname.includes("entrar"), { timeout: 60000 });
});

after(async () => {
  await navegador?.close();
});

const PROVEEDOR = `BOMBAS SUR ${SUF}`;
const CLIENTE = `MINERA CONTRATISTAS ${SUF}`;
const PRODUCTO = `BOM-${SUF}`;

describe("un mes de operaciones", () => {
  test("alta de proveedor, cliente y producto", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/maestros/terceros/nuevo`);
    await pagina.selectOption('select[name="tipoDocumento"]', "6");
    await pagina.fill('input[name="numeroDocumento"]', conDigito(`${BASE_RUC}1`));
    await pagina.fill('input[name="razonSocial"]', PROVEEDOR);
    await pagina.check('input[name="esProveedor"]');
    // La casilla de cliente viene marcada en el alta. Un proveedor que se queda
    // también como cliente acaba en el desplegable de la pantalla de venta.
    await pagina.uncheck('input[name="esCliente"]');
    await pagina.fill('input[name="diasCredito"]', "30");
    await enviar("Guardar");

    await pagina.goto(`${BASE}/maestros/terceros/nuevo`);
    await pagina.selectOption('select[name="tipoDocumento"]', "6");
    await pagina.fill('input[name="numeroDocumento"]', conDigito(`${BASE_RUC}2`));
    await pagina.fill('input[name="razonSocial"]', CLIENTE);
    await pagina.fill('input[name="diasCredito"]', "30");
    await pagina.fill('input[name="limiteCredito"]', "20000");
    await enviar("Guardar");

    await pagina.goto(`${BASE}/maestros/productos/nuevo`);
    await pagina.fill('input[name="codigo"]', PRODUCTO);
    await pagina.fill('input[name="descripcion"]', "Bomba sumergible 3HP");
    const u = await opciones('select[name="unidadId"]');
    await pagina.selectOption('select[name="unidadId"]', u[0]!.v);
    await enviar("Guardar");
  });

  test("orden de compra y factura del proveedor: la mercadería entra al almacén", async (t) => {
    if (sinServidor(t)) return;

    // Elegir el producto del desplegable y no teclear descripción tiene que
    // bastar: es el fallo 1 de la cabecera.
    await pagina.goto(`${BASE}/compras/ordenes/nueva`);
    await elegir('select[name="proveedorId"]', PROVEEDOR);
    await pagina.fill('input[name="fecha"]', fecha(-10));
    await elegir('select[name="lineas[0].productoId"]', PRODUCTO);
    await pagina.fill('input[name="lineas[0].cantidad"]', "20");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "850");
    await enviar("Emitir orden");

    await pagina.goto(`${BASE}/compras/nueva`);
    await elegir('select[name="proveedorId"]', PROVEEDOR);
    await pagina.fill('input[name="serie"]', "F001");
    await pagina.fill('input[name="numero"]', SUF);
    await pagina.fill('input[name="fechaEmision"]', fecha(-3));
    await elegir('select[name="lineas[0].productoId"]', PRODUCTO);
    await pagina.fill('input[name="lineas[0].cantidad"]', "20");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "850");
    const alm = await opciones('select[name="almacenId"]');
    await pagina.selectOption('select[name="almacenId"]', alm[0]!.v);
    await enviar("Registrar compra");

    await pagina.goto(`${BASE}/inventario`, { waitUntil: "networkidle" });
    assert.match((await pagina.textContent("main")) ?? "", new RegExp(PRODUCTO));

    await pagina.goto(`${BASE}/cxp`, { waitUntil: "networkidle" });
    assert.match((await pagina.textContent("main")) ?? "", new RegExp(PROVEEDOR));
  });

  test("comprar mercadería sin almacén se rechaza en vez de descuadrar el kardex", async (t) => {
    if (sinServidor(t)) return;

    // Fallo 2: antes registraba la deuda, cargaba la cuenta 20 y no movía nada.
    await pagina.goto(`${BASE}/compras/nueva`);
    await elegir('select[name="proveedorId"]', PROVEEDOR);
    await pagina.fill('input[name="serie"]', "F001");
    await pagina.fill('input[name="numero"]', `9${SUF.slice(-6)}`);
    await pagina.fill('input[name="fechaEmision"]', fecha(-2));
    await elegir('select[name="lineas[0].productoId"]', PRODUCTO);
    await pagina.fill('input[name="lineas[0].cantidad"]', "5");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "850");
    await pagina.selectOption('select[name="almacenId"]', "");
    await pagina.click('button:text-is("Registrar compra")');
    await pagina.waitForTimeout(2000);

    const err = await pagina
      .locator('[role="alert"]')
      .first()
      .textContent({ timeout: 3000 })
      .catch(() => null);
    assert.ok(err, "tenía que avisar de que falta el almacén");
    assert.match(err, /almac[ée]n/i);
  });

  test("factura de venta: descarga el stock y deja la cuenta por cobrar", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/ventas/nueva`);
    await elegir('select[name="clienteId"]', CLIENTE);
    const series = await opciones('select[name="serie"]');
    const factura = series.find((s) => s.t.startsWith("F")) ?? series[0]!;
    await pagina.selectOption('select[name="serie"]', factura.v);
    await pagina.fill('input[name="fechaEmision"]', fecha());
    await elegir('select[name="lineas[0].productoId"]', PRODUCTO);
    await pagina.fill('input[name="lineas[0].cantidad"]', "6");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "1400");
    const alm = await opciones('select[name="almacenId"]');
    await pagina.selectOption('select[name="almacenId"]', alm[0]!.v);
    await enviar("Emitir comprobante");
    assert.match(pagina.url(), /\/ventas\/[0-9a-f-]{36}/);

    await pagina.goto(`${BASE}/cxc`, { waitUntil: "networkidle" });
    assert.match((await pagina.textContent("main")) ?? "", new RegExp(CLIENTE.slice(0, 18)));
  });

  test("el límite de crédito se comprueba al facturar, con las cifras del cliente", async (t) => {
    if (sinServidor(t)) return;

    // Fallo 3: el tope existía, se veía en la ficha, y al facturar no se miraba.
    // 6 × 1400 + IGV = 9912 ya usados de 20 000; 10 × 1400 + IGV = 16 520 no cabe.
    await pagina.goto(`${BASE}/ventas/nueva`);
    await elegir('select[name="clienteId"]', CLIENTE);
    const series = await opciones('select[name="serie"]');
    await pagina.selectOption(
      'select[name="serie"]',
      (series.find((s) => s.t.startsWith("F")) ?? series[0]!).v,
    );
    await pagina.fill('input[name="fechaEmision"]', fecha());
    await elegir('select[name="lineas[0].productoId"]', PRODUCTO);
    await pagina.fill('input[name="lineas[0].cantidad"]', "10");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "1400");
    await pagina.click('button:text-is("Emitir comprobante")');
    await pagina.waitForTimeout(2000);

    assert.doesNotMatch(
      pagina.url(),
      /\/ventas\/[0-9a-f-]{36}/,
      "aceptó una factura que pasa del límite de crédito",
    );
    const err = await pagina
      .locator('[role="alert"]')
      .first()
      .textContent({ timeout: 3000 })
      .catch(() => null);
    assert.ok(err, "tenía que decir por qué");
    assert.match(err, /l[íi]mite/i);
    // El motivo trae las tres cifras: sin ellas quien vende no sabe qué pedir.
    assert.match(err, /20000\.00|20,000\.00/, "el límite del cliente");
    assert.match(err, /9912\.00|9,912\.00/, "lo que ya usa");
  });

  test("planilla del mes: el número se sugiere y el cálculo sale", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/rrhh/nuevo`);
    await pagina.selectOption('select[name="tipoDocumento"]', "1").catch(() => {});
    await pagina.fill('input[name="numeroDocumento"]', `4${SUF.padStart(7, "0")}`);
    await pagina.fill('input[name="apellidoPaterno"]', "Quispe");
    await pagina.fill('input[name="apellidoMaterno"]', "Mamani");
    await pagina.fill('input[name="nombres"]', "Rosa Elena");
    await pagina.fill('input[name="fechaNacimiento"]', "1992-04-18");
    await pagina.fill('input[name="fechaIngreso"]', fecha(-400));
    await pagina.fill('input[name="cargo"]', "Asistente de almacén");
    await pagina.fill('input[name="basico"]', "1500");
    await enviar("Dar de alta");

    await pagina.goto(`${BASE}/planillas`);
    // El número lo propone la pantalla: era el único documento que obligaba a
    // inventárselo, y vacío el navegador bloqueaba el envío sin decir nada.
    const sugerido = await pagina.inputValue('input[name="numero"]');
    assert.match(sugerido, /^PL-\d{4}-\d{2}$/, `el número no se sugiere: «${sugerido}»`);

    await pagina.fill('input[name="fecha"]', fecha());
    await pagina.fill('input[name="fechaPago"]', fecha(2));
    await pagina.click('button:text-is("Calcular")');
    await pagina.waitForTimeout(4000);
    assert.match(pagina.url(), /\/planillas\/[0-9a-f-]{36}/, "la planilla no se creó");
  });

  test("al cerrar el mes, el balance cuadra y los libros salen", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/contabilidad?periodo=${PERIODO}`, { waitUntil: "networkidle" });
    const balance = (await pagina.textContent("main")) ?? "";
    assert.match(balance, /El balance cuadra/, "el balance del periodo no cuadra");
    // Los asientos de cada módulo llegaron solos, sin captura manual.
    assert.match(balance, /compras/);
    assert.match(balance, /ventas/);

    await pagina.goto(`${BASE}/contabilidad/ple?periodo=${PERIODO}`, { waitUntil: "networkidle" });
    const libros = await pagina.$$eval("table tbody tr", (ts) => ts.length);
    assert.equal(libros, 7, "los siete formatos del PLE tienen que estar");

    // Descargar uno de verdad es lo único que prueba que el archivo sale.
    const compras = await pagina.request.get(`${BASE}/api/ple?periodo=${PERIODO}&libro=080100`);
    assert.ok(compras.ok(), `el registro de compras devolvió ${compras.status()}`);
    assert.ok((await compras.body()).length > 0, "el archivo salió vacío");

    const pdt = await pagina.request.get(`${BASE}/api/pdt?periodo=${PERIODO}`);
    assert.ok(pdt.ok(), `el PDT devolvió ${pdt.status()}`);

    for (const ruta of [
      `/contabilidad/impuestos?periodo=${PERIODO}`,
      `/contabilidad/estados?periodo=${PERIODO}`,
      `/inventario`,
      `/cxc`,
    ]) {
      await pagina.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
      const t2 = (await pagina.textContent("main")) ?? "";
      assert.doesNotMatch(t2, /NaN|Infinity/, `${ruta} muestra una cifra rota`);
    }
  });
});
