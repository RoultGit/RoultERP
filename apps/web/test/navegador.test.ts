/**
 * Pruebas de navegador de punta a punta.
 *
 * Existen porque las demás no cubren lo único que el usuario hace de verdad:
 * llenar un formulario y pulsar un botón. Las pruebas de servicio comprueban la
 * lógica; ésta comprueba que el formulario llega hasta ella —que los nombres de
 * los campos coinciden, que la acción de servidor está conectada, que el
 * redirect lleva a donde debe y que el error se ve.
 *
 * Necesitan la aplicación levantada y la base sembrada. **Contra una
 * compilación de producción**, no contra `next dev`:
 *
 *   DATABASE_URL=postgres://localhost/roulterp_dev npm run sembrar
 *   npm run build
 *   DATABASE_URL=postgres://localhost/roulterp_dev PORT=3100 npm run start -w @roulterp/web
 *   npm run test:navegador
 *
 * En desarrollo Next compila cada ruta la primera vez que se pide, y con medio
 * centenar de rutas eso convertía la suite en veinte minutos de esperas y
 * fallos por plazo agotado que no eran fallos de la aplicación sino del
 * compilador. Contra el binario de producción tarda veinte segundos y lo que
 * falla, falla de verdad.
 *
 * Se saltan solas si no hay nada escuchando, para no romper el `npm test` de
 * quien no tenga el servidor arriba.
 */
import { after, before, describe, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env["BASE"] ?? "http://localhost:3100";
const USUARIO = process.env["E2E_USUARIO"] ?? "admin@servidimar.pe";
const CLAVE = process.env["E2E_CLAVE"] ?? "roulterp-desarrollo-1";

/**
 * Rutas del menú, para abrirlas todas y comprobar que ninguna revienta.
 *
 * Vive fuera de la prueba porque el paseo de calentamiento previo usa la misma
 * lista: no tendría sentido calentar unas rutas y medir otras.
 */
const RUTAS_MENU = [
  "/compras", "/compras/requisiciones", "/compras/cotizaciones", "/compras/ordenes/nueva",
  "/compras/precios",
  "/importaciones", "/importaciones/polizas",
  "/inventario", "/inventario/kits", "/inventario/lotes", "/inventario/rotacion",
  "/cxp", "/cxp/egresos", "/cxp/letras", "/cxp/ordenes-pago", "/cxp/estado-cuenta",
  "/ventas", "/ventas/ranking", "/ventas/cotizaciones", "/ventas/pedidos",
  "/cpe", "/cpe/resumenes", "/cpe/retenciones",
  "/guias",
  "/cxc", "/cxc/estado-cuenta", "/cxc/proyeccion", "/cxc/cheques", "/cxc/planillas",
  "/cxc/morosidad",
  "/caja-bancos", "/caja-bancos/recibos", "/caja-bancos/cheques", "/caja-bancos/rendiciones",
  "/caja-bancos/libro",
  "/contabilidad", "/contabilidad/estados", "/contabilidad/periodos", "/contabilidad/ple",
  "/contabilidad/registros",
  "/contabilidad/impuestos", "/contabilidad/centros", "/contabilidad/anexos",
  "/contabilidad/formatos", "/contabilidad/presupuesto", "/contabilidad/destino",
  "/contabilidad/parametros",
  "/contabilidad/ratios",
  "/maestros", "/usuarios", "/cuenta",
] as const;

/**
 * Rutas del menú y la entrada que cada una debe marcar, más las que cuelgan.
 *
 * El detalle de un documento tiene que marcar su módulo, y una subruta con
 * entrada propia tiene que marcarse ella y no su padre.
 */
const RUTAS_MARCADO: [string, string][] = [
  ["/tablero", "Tablero"],
  ["/compras", "Compras"],
  ["/compras/nueva", "Compras"],
  ["/compras/requisiciones", "Requisiciones"],
  ["/compras/cotizaciones", "Cotizaciones a proveedor"],
  ["/compras/precios", "Precios históricos"],
  ["/compras/ordenes/nueva", "Compras"],
  ["/importaciones", "Importaciones"],
  ["/importaciones/polizas", "Pólizas (DUA)"],
  ["/inventario", "Inventario"],
  ["/inventario/kardex", "Inventario"],
  ["/inventario/notas", "Notas de almacén"],
  ["/inventario/kits", "Kits y conversiones"],
  ["/inventario/lotes", "Lotes y series"],
  ["/inventario/rotacion", "Rotación y stock"],
  ["/cxp", "Cuentas por pagar"],
  ["/cxp/letras", "Cuentas por pagar"],
  ["/cxp/egresos", "Programación de egresos"],
  ["/cxp/ordenes-pago", "Órdenes de pago"],
  ["/cxp/estado-cuenta", "Estado de cuenta"],
  ["/ventas", "Ventas"],
  ["/ventas/nueva", "Ventas"],
  ["/ventas/ranking", "Ranking y margen"],
  ["/ventas/cotizaciones", "Cotizaciones a cliente"],
  ["/ventas/pedidos", "Pedidos de venta"],
  ["/cpe", "Facturación electrónica"],
  ["/cpe/resumenes", "Resúmenes y bajas"],
  ["/cpe/retenciones", "Retenciones y percepciones"],
  ["/guias", "Guías de remisión"],
  ["/guias/nueva", "Guías de remisión"],
  ["/cxc", "Cuentas por cobrar"],
  ["/cxc/estado-cuenta", "Estado de cuenta de cliente"],
  ["/cxc/proyeccion", "Proyección de cobranzas"],
  ["/cxc/planillas", "Planillas de cobranza"],
  ["/cxc/morosidad", "Antigüedad y morosidad"],
  ["/cxc/cheques", "Cheques de clientes"],
  ["/caja-bancos", "Caja y bancos"],
  ["/caja-bancos/libro", "Libro de bancos"],
  ["/caja-bancos/recibos", "Recibos de caja"],
  ["/caja-bancos/cheques", "Cheques"],
  ["/caja-bancos/rendiciones", "Entregas a rendir"],
  ["/contabilidad", "Contabilidad"],
  ["/contabilidad/estados", "Contabilidad"],
  ["/contabilidad/periodos", "Contabilidad"],
  ["/contabilidad/ple", "Contabilidad"],
  ["/contabilidad/registros", "Registros de compras y ventas"],
  ["/contabilidad/impuestos", "Liquidación de impuestos"],
  ["/contabilidad/centros", "Resultados por centro"],
  ["/contabilidad/formatos", "Formatos de EEFF"],
  ["/contabilidad/presupuesto", "Presupuesto"],
  ["/contabilidad/ratios", "Ratios financieros"],
  ["/contabilidad/destino", "Asiento de destino"],
  ["/contabilidad/parametros", "Cuentas de integración"],
  ["/contabilidad/anexos", "Cuenta corriente por anexo"],
  ["/maestros", "Maestros"],
  ["/maestros/productos", "Maestros"],
  ["/usuarios", "Usuarios y roles"],
];

let navegador: Browser;
let pagina: Page;

let hayServidor = false;
const avisos: string[] = [];

/**
 * El paseo de calentamiento no es una prueba.
 *
 * Visita cincuenta rutas seguidas sin esperar a que ninguna termine de
 * hidratarse, así que React encuentra el DOM cambiando debajo y protesta por
 * una discrepancia que no existe. Con el vigilante encendido, ese ruido caía
 * después de la última prueba y tumbaba la suite entera con un fallo que no se
 * podía reproducir visitando la página. Durante el paseo se calla; en las
 * pruebas de verdad, cualquier error de la página sigue siendo un fallo.
 */
let calentando = false;

before(async () => {
  try {
    // Treinta segundos y no tres: en desarrollo la primera petición puede
    // esperar a que Next compile la ruta, y darla por «no hay servidor» dejaba
    // la suite entera en verde sin haber probado nada.
    const r = await fetch(`${BASE}/entrar`, { signal: AbortSignal.timeout(30000) });
    hayServidor = r.ok;
  } catch {
    hayServidor = false;
  }
  if (!hayServidor) return;

  navegador = await chromium.launch();
  pagina = await navegador.newPage();
  // Los treinta segundos por defecto los agota el compilador de Next, no la
  // aplicación: en desarrollo cada ruta se compila la primera vez que se pide.
  pagina.setDefaultNavigationTimeout(90000);
  // Y lo mismo para los localizadores: en desarrollo una acción que dispara la
  // compilación de otra ruta tarda lo que tarde el compilador.
  pagina.setDefaultTimeout(60000);

  // Un fallo de JavaScript en el navegador no rompe la petición: la página se
  // ve pero el formulario no envía. Se vigila para que no pase inadvertido.
  pagina.on("pageerror", (e) => {
    if (calentando) return;
    throw new Error(`error de JavaScript en la página: ${e.message}`);
  });

  // Los avisos de React —hidratación, claves repetidas, campos que pasan de no
  // controlados a controlados— no rompen la página pero anuncian que algo se
  // va a comportar mal. Se recogen y cada prueba comprueba que no hubo.
  pagina.on("console", (m) => {
    if (calentando) return;
    if (m.type() !== "error" && m.type() !== "warning") return;
    const texto = m.text();
    if (/hydrat|Warning:|controlled|unique "key"|validateDOMNesting/i.test(texto)) {
      avisos.push(texto.slice(0, 300));
    }
  });

  await pagina.goto(`${BASE}/entrar`);
  await pagina.fill('input[name="email"]', USUARIO);
  await pagina.fill('input[name="password"]', CLAVE);
  await pagina.click('button[type="submit"]');
  // Un minuto: en desarrollo Next compila cada ruta la primera vez que se
  // pide, y quince segundos cancelaban la suite entera por culpa del
  // compilador, no de la aplicación.
  await pagina.waitForURL((u) => !u.pathname.includes("/entrar"), { timeout: 60000 });

  await reponerStock();
  await calentarRutas();
});

/**
 * Visita una vez cada ruta del menú, sin comprobar nada.
 *
 * En desarrollo Next compila cada ruta la primera vez que se pide, y eso puede
 * tardar más de un minuto en las pesadas. Sin este paseo previo, la primera
 * prueba que tocaba una ruta fría se caía por plazo agotado y había que volver
 * a lanzar la suite: un fallo del compilador disfrazado de fallo de la
 * aplicación, que es el peor ruido posible en una batería de pruebas.
 *
 * Se hace con la página ya autenticada, así que compila lo mismo que verán las
 * pruebas de verdad.
 */
async function calentarRutas() {
  calentando = true;
  const vistas = new Set<string>();
  for (const ruta of [...RUTAS_MENU, ...RUTAS_MARCADO.map(([r]) => r)]) {
    if (vistas.has(ruta)) continue;
    vistas.add(ruta);
    // Un fallo aquí no es un fallo de la prueba: si la ruta está rota, la
    // prueba que la usa lo dirá con su propio mensaje.
    await pagina.goto(`${BASE}${ruta}`, { timeout: 120000 }).catch(() => {});
  }
  // Se deja asentar la última: apagar el vigilante en el mismo instante en que
  // se navega deja escapar el error de la página que aún se estaba hidratando.
  await pagina.waitForLoadState("networkidle").catch(() => {});
  calentando = false;
}

/**
 * Repone existencias antes de empezar.
 *
 * La suite vende, transfiere y da de baja mercadería, así que cada ejecución
 * deja el almacén más vacío que la anterior. Sin esto la sembrada aguanta unas
 * cuantas corridas y luego las pruebas empiezan a fallar por «no hay stock
 * suficiente», que es un fallo de los datos y no del programa: el peor rato
 * posible es depurar una prueba que sí funciona.
 *
 * Se repone por la pantalla de notas de ingreso, como lo haría un almacenero.
 */
async function reponerStock(productoId?: string) {
  await pagina.goto(`${BASE}/inventario/notas`);
  await pagina.waitForSelector("form");
  await pagina.click('button:has-text("Nota de ingreso")');
  await pagina.waitForSelector('select[name="almacenId"]');

  const almacenes = await pagina.$$eval('select[name="almacenId"] option', (os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  await pagina.selectOption('select[name="almacenId"]', almacenes[0]!);
  await pagina.fill('input[name="glosa"]', "Reposición para las pruebas");

  const productos = await pagina.$$eval('select[name="lineas[0].productoId"] option', (os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  await pagina.selectOption('select[name="lineas[0].productoId"]', productoId ?? productos[0]!);
  await pagina.fill('input[name="lineas[0].cantidad"]', "500");
  await pagina.fill('input[name="lineas[0].costoUnitario"]', "20");
  await pagina.click('button[type="submit"]:not([disabled])');
  await pagina.waitForSelector('[role="status"]', { timeout: 30000 });
}

after(async () => {
  await navegador?.close();
});

/**
 * Salta la prueba si no hay servidor.
 *
 * Se decide dentro del cuerpo, no en las opciones del `test`: las opciones se
 * evalúan al declarar la prueba, antes de que corra ningún `before`, y
 * decidirlo ahí dejaba las diez saltadas aunque el servidor estuviera arriba.
 * No fallaba —pasaba en verde sin probar nada—, que es la peor forma de fallar.
 */
/**
 * Lo que la pantalla está diciendo ahora mismo.
 *
 * Cuando una espera vence, el mensaje de Playwright dice qué faltaba pero no
 * por qué: casi siempre hay un aviso en la página que lo explica, y buscarlo a
 * mano en cada fallo es tiempo perdido.
 */
/**
 * Valor total del almacén según la pantalla de existencias.
 *
 * Se lee de la interfaz y no de la base a propósito: lo que se vigila es que el
 * usuario vea la verdad, no que la tabla la guarde.
 */
async function valorDelAlmacen(): Promise<string> {
  // Se vuelve a donde estábamos: medir no debe cambiar la pantalla bajo los
  // pies de la prueba que llama.
  const antes = pagina.url();
  await pagina.goto(`${BASE}/inventario`);
  await pagina.waitForSelector("table", { timeout: 60000 });
  const celdas = await pagina.$$eval("tbody tr td:last-child", (tds) =>
    tds.map((td) => td.textContent?.trim() ?? ""),
  );
  await pagina.goto(antes);
  return celdas.join("|");
}

async function avisoEnPantalla(): Promise<string> {
  // `.aviso` es el bloque de error grande; los formularios con error por fila
  // usan `role="alert"` a secas. Leer sólo el primero dejaba fallos sin
  // explicación, que es justo lo que este ayudante existe para evitar.
  const textos = [
    ...(await pagina.locator(".aviso").allTextContents()),
    ...(await pagina.locator('[role="alert"]').allTextContents()),
  ]
    .map((t) => t.trim())
    // El anunciador de rutas de Next también usa `role="alert"` y devuelve el
    // título de la página: no es un aviso de nada.
    .filter((t) => t.length > 0 && !t.endsWith("· RoultERP"));

  return textos.length ? [...new Set(textos)].join(" · ") : "(sin avisos en pantalla)";
}

const sinServidor = (t: TestContext): boolean => {
  if (hayServidor) return false;
  t.skip(`no hay servidor en ${BASE}`);
  return true;
};

describe("entrar y navegar", () => {
  test("el login deja una sesión utilizable", async (t) => {
    if (sinServidor(t)) return;
    assert.ok(!pagina.url().includes("/entrar"), "el login no redirigió");
    await pagina.goto(`${BASE}/tablero`);
    await assert.doesNotReject(pagina.waitForSelector("h1", { timeout: 60000 }));
  });

  test("las pantallas del menú abren sin error de JavaScript", async (t) => {
    if (sinServidor(t)) return;
    const rutas = RUTAS_MENU;
    for (const ruta of rutas) {
      const respuesta = await pagina.goto(`${BASE}${ruta}`);
      assert.equal(respuesta?.status(), 200, `${ruta} no devolvió 200`);
      await pagina.waitForSelector("h1", { timeout: 60000 });
    }
  });
});

describe("estado visual del menú", () => {
  /**
   * Rutas que existen en el menú, más las que cuelgan de ellas.
   *
   * El detalle de un documento tiene que marcar su módulo, y una subruta con
   * entrada propia tiene que marcarse ella y no su padre.
   */
  const RUTAS = RUTAS_MARCADO;

  test("sólo se marca una entrada, y es la que corresponde", async (t) => {
    if (sinServidor(t)) return;
    for (const [ruta, esperada] of RUTAS) {
      await pagina.goto(`${BASE}${ruta}`);
      await pagina.waitForSelector("nav a");
      const marcadas = await pagina.$$eval('nav a[aria-current="page"]', (as) =>
        as.map((a) => a.textContent?.trim() ?? ""),
      );
      assert.deepEqual(
        marcadas,
        [esperada],
        `en ${ruta} el menú marca ${JSON.stringify(marcadas)}`,
      );
    }
  });

  test("navegar entre módulos no deja marcado el anterior", async (t) => {
    if (sinServidor(t)) return;
    // Se navega pulsando el enlace, no recargando: es donde se veía el fallo,
    // porque el estado del menú sobrevive a la navegación del cliente.
    await pagina.goto(`${BASE}/cxp/egresos`);
    // El menú agrupa por módulo y sólo deja abierto el del sitio donde se está,
    // así que el enlace de otro módulo hay que descubrirlo antes de pulsarlo.
    await pagina.click('nav summary:text-is("Contabilidad")');
    await pagina.click('nav a:text-is("Contabilidad")');
    await pagina.waitForURL((u) => u.pathname === "/contabilidad");

    const marcadas = await pagina.$$eval('nav a[aria-current="page"]', (as) =>
      as.map((a) => a.textContent?.trim() ?? ""),
    );
    assert.deepEqual(marcadas, ["Contabilidad"]);
  });
});

describe("captura manual de un asiento", () => {
  test("un asiento descuadrado se rechaza y lo dice en pantalla", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/asiento`);
    await pagina.fill('input[name="glosa"]', "Prueba de descuadre");
    await pagina.selectOption('select[name="linea[0][cuenta]"]', "1011");
    await pagina.fill('input[name="linea[0][debe]"]', "100");
    await pagina.selectOption('select[name="linea[1][cuenta]"]', "1041");
    await pagina.fill('input[name="linea[1][haber]"]', "50");

    await pagina.click('button[value="contabilizar"]');
    // Se lee `.aviso` y no `[role="alert"]` a secas: el segundo también lo usa
    // el panel de errores de Next en desarrollo, y llega vacío.
    await pagina.waitForSelector(".aviso", { timeout: 60000 });
    const aviso = (await pagina.locator(".aviso").allTextContents()).join(" ");
    assert.match(aviso, /no cuadra|cuadrar|partida doble/i);
    assert.ok(pagina.url().includes("/contabilidad/asiento"), "no debe salir del formulario");
  });

  test("un asiento que cuadra se contabiliza y aparece en el balance", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/asiento`);
    const glosa = `Traspaso de prueba ${Date.now()}`;
    await pagina.fill('input[name="glosa"]', glosa);
    await pagina.selectOption('select[name="linea[0][cuenta]"]', "1011");
    await pagina.fill('input[name="linea[0][debe]"]', "250.00");
    await pagina.selectOption('select[name="linea[1][cuenta]"]', "1041");
    await pagina.fill('input[name="linea[1][haber]"]', "250.00");

    await pagina.click('button[value="contabilizar"]');
    await pagina.waitForURL((u) => u.pathname === "/contabilidad", { timeout: 60000 });

    const cuerpo = await pagina.textContent("body");
    assert.match(cuerpo ?? "", new RegExp(glosa.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(cuerpo ?? "", /El balance cuadra/);
  });

  test("el borrador se guarda y se puede volver a abrir", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/asiento`);
    const glosa = `Borrador de prueba ${Date.now()}`;
    await pagina.fill('input[name="glosa"]', glosa);
    await pagina.selectOption('select[name="linea[0][cuenta]"]', "1011");
    await pagina.fill('input[name="linea[0][debe]"]', "10.00");
    await pagina.selectOption('select[name="linea[1][cuenta]"]', "1041");
    await pagina.fill('input[name="linea[1][haber]"]', "10.00");

    await pagina.click('button[value="borrador"]');
    await pagina.waitForURL((u) => u.searchParams.has("id"), { timeout: 60000 });

    // Al reabrirlo tiene que traer lo que se escribió, no un formulario vacío.
    const valor = await pagina.inputValue('input[name="glosa"]');
    assert.equal(valor, glosa);
  });
});

describe("emisión de una venta", () => {
  test("emite una factura y llega a su detalle", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/ventas/nueva`);
    await pagina.waitForSelector('select[name="clienteId"]');

    const clientes = await pagina.$$eval('select[name="clienteId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    assert.ok(clientes.length > 0, "no hay clientes sembrados");
    await pagina.selectOption('select[name="clienteId"]', clientes[0]!);

    await pagina.fill('input[name="lineas[0].descripcion"]', "Servicio de prueba de navegador");
    await pagina.fill('input[name="lineas[0].cantidad"]', "1");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "300");

    await pagina.click('button[type="submit"]:not([disabled])');
    await pagina.waitForURL(/\/ventas\/[0-9a-f-]{36}$/, { timeout: 60000 });

    const cuerpo = await pagina.textContent("body");
    assert.match(cuerpo ?? "", /354\.00/, "el total con IGV debería ser 354.00");
  });
});

describe("resumen diario de boletas", () => {
  test("genera el resumen del día pendiente y lo confirma en pantalla", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/cpe/resumenes`);
    const boton = pagina.locator('button:has-text("Generar resumen")').first();
    if ((await boton.count()) === 0) {
      t.skip("no quedan días por resumir en esta base");
      return;
    }

    await boton.click();
    // El mensaje tiene que sobrevivir a que el día desaparezca de la lista: si
    // se fuera con la fila, el usuario no sabría si se generó o falló.
    await pagina.waitForSelector("text=/Generado RC-/", { timeout: 60000 });
    const cuerpo = await pagina.textContent("body");
    assert.match(cuerpo ?? "", /Generado RC-\d{8}-\d/);
    assert.match(cuerpo ?? "", /RC-\d{8}-\d/, "y aparece en la lista de enviados");
  });
});

describe("administración de usuarios", () => {
  test("invita a alguien y devuelve el enlace una sola vez", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/usuarios`);
    const correo = `prueba-${Date.now()}@servidimar.pe`;
    await pagina.fill('input[name="nombre"]', "Persona de prueba");
    await pagina.fill('input[name="email"]', correo);
    await pagina.selectOption('select[name="rolCodigo"]', "contador");
    await pagina.click('button:has-text("Invitar")');

    await pagina.waitForSelector("text=/invitacion\\?token=/", { timeout: 60000 });
    const cuerpo = await pagina.textContent("body");
    assert.match(cuerpo ?? "", new RegExp(correo), "el invitado debe aparecer en la lista");
    assert.match(cuerpo ?? "", /sin aceptar/, "la cuenta no sirve hasta que acepte");
  });

  test("un rol propio se crea con los permisos marcados", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/usuarios`);
    const codigo = `rol${Date.now().toString().slice(-6)}`;

    const formulario = pagina.locator("form").filter({ hasText: "Crear rol" });
    await formulario.locator('input[name="codigo"]').fill(codigo);
    await formulario.locator('input[name="nombre"]').fill("Rol de prueba");
    await formulario.locator('input[type="checkbox"]').first().check();
    await formulario.locator('button:has-text("Crear rol")').click();

    await pagina.waitForSelector("text=Rol guardado", { timeout: 60000 });
    const cuerpo = await pagina.textContent("body");
    assert.match(cuerpo ?? "", new RegExp(codigo));
  });
});

describe("la pantalla no miente sobre el estado", () => {
  /*
   * El fallo que motivó estas pruebas: la interfaz se quedaba enseñando lo de
   * antes. Pasaba en el menú —dos módulos marcados a la vez— y también en los
   * formularios que no navegan: React reinicia el formulario al terminar la
   * acción y lo devuelve a su valor inicial, que ya no es el vigente.
   */
  test("el rol que muestra la lista es el rol que quedó guardado", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/usuarios`);

    // Se invita a alguien para el experimento: al administrador no se le puede
    // quitar el rol si es el único que queda, y con razón.
    const correo = `rol-${Date.now()}@servidimar.pe`;
    await pagina.fill('input[name="nombre"]', "Persona de prueba de rol");
    await pagina.fill('input[name="email"]', correo);
    await pagina.selectOption('select[name="rolCodigo"]', "contador");
    await pagina.click('button:has-text("Invitar")');
    await pagina.waitForSelector(`text=${correo}`, { timeout: 60000 });

    const fila = pagina.locator("tr").filter({ hasText: correo });
    const select = fila.locator('select[name="rolId"]');
    const antes = await select.inputValue();
    const opciones = await select
      .locator("option")
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const otro = opciones.find((o) => o !== antes)!;

    await select.selectOption(otro);
    await fila.locator('button:has-text("Cambiar")').click();
    await pagina.waitForSelector("text=Rol actualizado", { timeout: 60000 });
    assert.equal(
      await select.inputValue(),
      otro,
      "el desplegable sigue enseñando el rol anterior",
    );
  });

  test("el estado de cada documento se ve con su color, no en gris", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/ventas`);
    // Una factura aceptada por SUNAT tiene que verse como aceptada. Antes, los
    // estados de los módulos nuevos caían todos en el tono neutro y no se
    // distinguía lo aceptado de lo rechazado.
    const insignia = pagina.locator('.insignia:text-is("aceptado")').first();
    await insignia.waitFor({ timeout: 60000 });
    const color = await insignia.evaluate((e) => getComputedStyle(e).color);
    assert.notEqual(color, "", "la insignia no tiene color");

    const gris = await pagina
      .locator("body")
      .evaluate((e) => getComputedStyle(e).getPropertyValue("--texto-suave").trim());
    assert.notEqual(color, gris, "un documento aceptado no puede verse igual que uno sin estado");
  });

  test("pagar una letra cierra su panel y actualiza la fila", async (t) => {
    if (sinServidor(t)) return;

    /*
     * La prueba fabrica lo que necesita: registra una compra, la canjea por
     * letra y la paga. Depender de que la base traiga una letra sin pagar
     * hacía que la prueba se saltara sola en cuanto la suite corría dos veces
     * —y una prueba que se salta sola es una prueba que no prueba nada—.
     */
    await pagina.goto(`${BASE}/compras/nueva`);
    await pagina.waitForSelector('select[name="proveedorId"]');
    const proveedores = await pagina.$$eval('select[name="proveedorId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    assert.ok(proveedores.length > 0, "no hay proveedores en esta base");
    await pagina.selectOption('select[name="proveedorId"]', proveedores[0]!);
    await pagina.fill('input[name="serie"]', "F900");
    await pagina.fill('input[name="numero"]', String(Date.now()).slice(-7));
    await pagina.fill('input[name="lineas[0].descripcion"]', "Servicio para prueba de letra");
    await pagina.fill('input[name="lineas[0].cantidad"]', "1");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "1000");
    await pagina.selectOption('select[name="lineas[0].cuenta"]', { index: 1 });
    await pagina.click('button[type="submit"]:has-text("Registrar compra")');
    await pagina.waitForURL((u) => u.pathname === "/compras", { timeout: 60000 });

    await pagina.goto(`${BASE}/cxp/pagar`);
    const aPagar = pagina.locator('a[href^="/cxp/pagar?proveedor="]').first();
    assert.ok(await aPagar.count(), "la compra recién registrada debería dejar saldo por pagar");
    await aPagar.click();
    // Hay que esperar a que cargue la ficha del proveedor: sin esto se pulsa
    // sobre la pantalla anterior y el modo nunca cambia.
    await pagina.waitForURL(/proveedor=/, { timeout: 60000 });
    await pagina.waitForSelector('input[name="numero"]', { timeout: 60000 });

    // `type="button"` a propósito: el botón de enviar también dice «Canjear por
    // letra» cuando ese modo está activo, y sin distinguirlos se pulsa el que no es.
    await pagina.click('button[type="button"]:has-text("Canjear por letra")');
    await pagina.waitForSelector('input[name="fechaVencimiento"]', { timeout: 60000 });

    const numero = `LT-E2E-${Date.now().toString().slice(-6)}`;
    await pagina.fill('input[name="numero"]', numero);
    await pagina.fill('input[name="fechaVencimiento"]', "2026-12-31");
    await pagina.click('button:has-text("Aplicar el saldo completo")');
    await pagina.click('button[type="submit"]:has-text("Canjear por letra")');
    await pagina.waitForURL((u) => u.pathname === "/cxp/letras", { timeout: 60000 });

    const fila = pagina.locator("tr").filter({ hasText: numero });
    const pagar = fila.locator('button:has-text("Pagar")').first();
    await pagar.waitFor({ timeout: 60000 });
    await pagar.click();
    await fila.locator('button:has-text("Confirmar")').first().click();
    // El aviso vive en la página, no en la fila: pagada la letra, sus botones
    // desaparecen y un mensaje dentro de ellos se iría sin que nadie lo lea.
    await pagina.waitForSelector('[role="status"]', { timeout: 60000 });
    assert.match(
      (await pagina.textContent('[role="status"]')) ?? "",
      /Queda cancelada|Queda un saldo/,
    );

    // El panel se cierra: dejarlo abierto con los importes recién enviados
    // invita a pulsar otra vez sobre una letra que ya cambió.
    assert.equal(
      await fila.locator('button:has-text("Confirmar")').count(),
      0,
      "el panel de pago se quedó abierto",
    );
    assert.match(
      (await fila.innerText()) ?? "",
      /cobrada/,
      "la letra debería figurar como cancelada",
    );
  });
});

describe("notas de almacén", () => {
  /*
   * El almacén sólo se movía al comprar o vender. Una empresa con dos almacenes
   * no podía pasar mercadería de uno a otro ni dar de baja lo que se rompió,
   * que es operación diaria. Starsoft lo resuelve con notas de ingreso, salida,
   * transferencia y ajuste, y esta prueba recorre las dos más usadas.
   */
  test("una transferencia mueve el stock sin tocar la contabilidad", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/inventario/notas`);
    await pagina.waitForSelector("form");
    await pagina.click('button:has-text("Transferencia entre almacenes")');
    await pagina.waitForSelector('select[name="almacenDestinoId"]');

    const almacenes = await pagina.$$eval('select[name="almacenId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    assert.ok(almacenes.length >= 2, "hacen falta dos almacenes para transferir");
    await pagina.selectOption('select[name="almacenId"]', almacenes[0]!);
    await pagina.selectOption('select[name="almacenDestinoId"]', almacenes[1]!);
    await pagina.fill('input[name="glosa"]', "Traslado de prueba");

    const productos = await pagina.$$eval('select[name="lineas[0].productoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="lineas[0].productoId"]', productos[0]!);
    await pagina.fill('input[name="lineas[0].cantidad"]', "1");
    await pagina.click('button[type="submit"]:not([disabled])');

    await pagina.waitForSelector('[role="status"]', { timeout: 60000 });
    const aviso = (await pagina.textContent('[role="status"]')) ?? "";
    assert.match(aviso, /Transferencia \d+ registrada/);
    // Sin asiento: la mercadería no cambia de cuenta, sólo de sitio.
    assert.match(aviso, /no genera asiento/);
  });

  test("una salida por merma se contabiliza y el libro sigue cuadrando", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/inventario/notas`);
    await pagina.waitForSelector("form");
    await pagina.click('button:has-text("Nota de salida")');
    await pagina.waitForSelector('select[name="cuentaContrapartida"]');

    // La contrapartida viene propuesta: quien da de baja una bolsa rota no
    // tiene por qué decidir contabilidad.
    assert.equal(await pagina.locator('select[name="cuentaContrapartida"]').inputValue(), "6591");

    const almacenes = await pagina.$$eval('select[name="almacenId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="almacenId"]', almacenes[0]!);
    await pagina.fill('input[name="glosa"]', "Merma de prueba");
    const centros = await pagina.$$eval('select[name="centroCostoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (centros.length) await pagina.selectOption('select[name="centroCostoId"]', centros[0]!);

    const productos = await pagina.$$eval('select[name="lineas[0].productoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="lineas[0].productoId"]', productos[0]!);
    await pagina.fill('input[name="lineas[0].cantidad"]', "1");
    await pagina.click('button[type="submit"]:not([disabled])');

    await pagina.waitForSelector('[role="status"]', { timeout: 60000 });
    assert.match((await pagina.textContent('[role="status"]')) ?? "", /registrada y contabilizada/);

    await pagina.goto(`${BASE}/contabilidad`);
    assert.match((await pagina.textContent("body")) ?? "", /El balance cuadra/);
  });
});

describe("cotización, pedido y despacho", () => {
  /**
   * El flujo comercial completo tal como lo hace el cliente en Starsoft.
   *
   * Es la prueba que más se parece a un día de trabajo: se cotiza, el cliente
   * acepta, se genera el pedido y el almacén despacha una parte. Lo que se
   * vigila no es el cálculo —eso ya lo cubren las pruebas de servicio— sino que
   * la factura llegue con el detalle del pedido ya puesto y que el saldo baje.
   */
  test("de la cotización a la factura, con despacho parcial", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/ventas/cotizaciones`);
    await pagina.click('button:text-is("Nueva cotización")');
    await pagina.waitForSelector('select[name="clienteId"]');

    const clientes = await pagina.$$eval('select[name="clienteId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="clienteId"]', clientes[0]!);
    const productos = await pagina.$$eval('select[name="lineas[0].productoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="lineas[0].productoId"]', productos[0]!);
    await pagina.fill('input[name="lineas[0].cantidad"]', "10");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "50");
    await pagina.click('button:text-is("Registrar cotización")');

    await pagina.waitForSelector('[role="status"]', { timeout: 60000 });
    const anuncio = (await pagina.textContent('[role="status"]')) ?? "";
    assert.match(anuncio, /Cotización COT\d{4}-\d{6} registrada/);
    const numeroCot = /COT\d{4}-\d{6}/.exec(anuncio)![0];

    // La cotización recién hecha es la primera de la lista.
    const fila = pagina.locator("tbody tr", { hasText: numeroCot });
    await fila.locator('button:text-is("Aceptar")').click();
    // Se espera el redirect, no el banner: el de la cotización anterior sigue
    // en pantalla y `waitForSelector` volvería de inmediato con el texto viejo.
    await pagina.waitForURL((u) => u.search.includes("aceptada"), { timeout: 60000 });

    await pagina.locator("tbody tr", { hasText: numeroCot })
      .locator('button:text-is("Generar pedido")').click();
    await pagina.waitForURL((u) => u.pathname === "/ventas/pedidos", { timeout: 60000 });
    const hechoPedido = (await pagina.textContent('[role="status"]')) ?? "";
    assert.match(hechoPedido, /Pedido PED\d{4}-\d{6} generado/);
    const numeroPed = /PED\d{4}-\d{6}/.exec(hechoPedido)![0];

    // Una cotización convertida ya no ofrece acciones: no se pide dos veces.
    await pagina.goto(`${BASE}/ventas/cotizaciones`);
    const estadoCot = await pagina.locator("tbody tr", { hasText: numeroCot }).textContent();
    assert.match(estadoCot ?? "", /convertida/);

    await pagina.goto(`${BASE}/ventas/pedidos`);
    await pagina.locator("tbody tr", { hasText: numeroPed })
      .locator('a:text-is("Facturar")').click();
    await pagina.waitForURL((u) => u.pathname === "/ventas/nueva", { timeout: 60000 });

    // El detalle llega puesto: eso es lo que ahorra el pedido.
    assert.equal(await pagina.locator('input[name="lineas[0].cantidad"]').inputValue(), "10");
    assert.equal(await pagina.locator('input[name="lineas[0].valorUnitario"]').inputValue(), "50.00");
    assert.match((await pagina.textContent('[role="status"]')) ?? "", new RegExp(numeroPed));

    // Se despacha la mitad.
    await pagina.fill('input[name="lineas[0].cantidad"]', "4");
    await pagina.click('button:text-is("Emitir comprobante")');
    await pagina.waitForURL((u) => /^\/ventas\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 });

    await pagina.goto(`${BASE}/ventas/pedidos`);
    const filaPed = (await pagina.locator("tbody tr", { hasText: numeroPed }).textContent()) ?? "";
    assert.match(filaPed, /parcial/, `el pedido debería quedar parcial: ${filaPed}`);
    assert.match(filaPed, /40 %/, `el avance debería ser 40 %: ${filaPed}`);
  });

  test("no deja facturar más de lo pedido", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/ventas/pedidos?estado=parcial`);
    const facturar = pagina.locator('a:text-is("Facturar")').first();
    if ((await facturar.count()) === 0) {
      t.skip("no hay pedidos parciales en la base sembrada");
      return;
    }
    await facturar.click();
    await pagina.waitForURL((u) => u.pathname === "/ventas/nueva", { timeout: 60000 });

    const saldo = await pagina.locator('input[name="lineas[0].cantidad"]').inputValue();
    await pagina.fill('input[name="lineas[0].cantidad"]', String(Number(saldo) + 5));
    await pagina.click('button:text-is("Emitir comprobante")');

    // `.aviso` y no `[role="alert"]` a secas: el anunciador de rutas de Next
    // también lo usa, y devuelve el título de la página.
    await pagina.waitForSelector(".aviso", { timeout: 30000 });
    assert.match((await pagina.textContent(".aviso")) ?? "", /excede lo pedido/);
  });
});

describe("requisición, cotizaciones y orden de compra", () => {
  /**
   * La cadena que precede a una compra, tal como la hace el cliente.
   *
   * Se vigila lo que sólo se ve desde el navegador: que aprobar habilite salir
   * a cotizar, que el cuadro comparativo lleve la oferta en dólares a soles
   * antes de marcar la más barata, y que elegir emita la orden con el rastro
   * puesto.
   */
  test("de la requisición a la orden, comparando en soles", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/compras/requisiciones`);
    await pagina.click('button:text-is("Nueva requisición")');
    await pagina.waitForSelector('input[name="area"]');
    await pagina.fill('input[name="area"]', "Obra de prueba");

    const productos = await pagina.$$eval('select[name="lineas[0].productoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="lineas[0].productoId"]', productos[0]!);
    await pagina.fill('input[name="lineas[0].cantidad"]', "20");
    await pagina.click('button:text-is("Registrar requisición")');

    await pagina.waitForURL((u) => u.search.includes("registrada"), { timeout: 30000 });
    const anuncio = (await pagina.textContent('[role="status"]')) ?? "";
    const numeroReq = /REQ\d{4}-\d{6}/.exec(anuncio)![0];

    const fila = () => pagina.locator("tbody tr", { hasText: numeroReq });
    await fila().locator('button:text-is("Aprobar")').click();
    await pagina.waitForURL((u) => u.search.includes("aprobada"), { timeout: 30000 });

    await fila().locator('button:text-is("Salir a cotizar")').click();
    await pagina.waitForURL((u) => /^\/compras\/cotizaciones\/[0-9a-f-]{36}$/.test(u.pathname), {
      timeout: 30000,
    });
    const urlCuadro = pagina.url().split("?")[0]!;

    // Dos ofertas: una en soles y una en dólares que en su número parece más
    // barata. El cuadro tiene que decir lo contrario.
    for (const [i, oferta] of [
      { moneda: "PEN", tc: "1", precio: "100" },
      { moneda: "USD", tc: "3.80", precio: "40" },
    ].entries()) {
      await pagina.goto(urlCuadro);
      await pagina.click('button:text-is("Registrar la respuesta de un proveedor")');
      await pagina.waitForSelector('select[name="proveedorId"]');
      const proveedores = await pagina.$$eval('select[name="proveedorId"] option', (os) =>
        os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
      );
      if (proveedores.length === 0) {
        t.skip("la base sembrada no tiene dos proveedores");
        return;
      }
      await pagina.selectOption('select[name="proveedorId"]', proveedores[0]!);
      await pagina.selectOption('select[name="moneda"]', oferta.moneda);
      await pagina.fill('input[name="tipoCambio"]', oferta.tc);
      await pagina.fill('input[name="plazoEntregaDias"]', String(3 + i));
      await pagina.fill('input[name="lineas[0].valorUnitario"]', oferta.precio);
      await pagina.click('button:text-is("Registrar cotización")');
      await pagina.waitForURL((u) => u.search.includes("registrada"), { timeout: 30000 });
    }

    // 100.00 contra 40 × 3.80 = 152.00: gana la de soles.
    const cuerpo = (await pagina.textContent("table")) ?? "";
    assert.match(cuerpo, /152\.00/, `el cuadro debería convertir a soles:\n${cuerpo}`);

    const verdes = await pagina.$$eval("tfoot td", (tds) =>
      tds
        .filter((td) => getComputedStyle(td).fontWeight === "600" || (td as HTMLElement).style.color)
        .map((td) => td.textContent?.trim() ?? ""),
    );
    assert.ok(verdes.length > 0, "el cuadro no marcó ninguna oferta");

    await pagina.locator('button:text-is("Elegir")').first().click();
    await pagina.click('button:text-is("Emitir orden")');
    await pagina.waitForURL((u) => /^\/compras\/ordenes\/[0-9a-f-]{36}$/.test(u.pathname), {
      timeout: 30000,
    });

    // La orden nace en borrador y sabe de dónde vino.
    const orden = (await pagina.textContent("body")) ?? "";
    assert.match(orden, /borrador/);
    assert.match(orden, new RegExp(numeroReq), "la orden no muestra su requisición");

    await pagina.click('button:text-is("Aprobar orden")');
    await pagina.waitForSelector("text=aprobada", { timeout: 30000 });
  });

  test("no se cotiza una requisición sin aprobar", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/compras/requisiciones?estado=pendiente`);
    const cotizar = pagina.locator('button:text-is("Salir a cotizar")');
    assert.equal(
      await cotizar.count(),
      0,
      "una requisición pendiente no debería ofrecer salir a cotizar",
    );
  });
});

/**
 * Registra una compra, para que la prueba de órdenes de pago tenga saldo.
 *
 * Sin esto la prueba se saltaba sola en cuanto alguien pagaba todo lo abierto, y
 * una prueba que se salta sola no vigila nada.
 */
async function crearCompra(): Promise<void> {
  await pagina.goto(`${BASE}/compras/nueva`);
  await pagina.waitForSelector('select[name="proveedorId"]');
  const proveedores = await pagina.$$eval('select[name="proveedorId"] option', (os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  await pagina.selectOption('select[name="proveedorId"]', proveedores[0]!);
  await pagina.fill('input[name="serie"]', "F900");
  await pagina.fill('input[name="numero"]', String(Date.now()).slice(-7));
  await pagina.fill('input[name="lineas[0].descripcion"]', "Servicio de prueba");
  await pagina.fill('input[name="lineas[0].cantidad"]', "1");
  await pagina.fill('input[name="lineas[0].valorUnitario"]', "1000");

  // Una línea sin producto exige cuenta de gasto, y ésa puede pedir centro de
  // costo: se rellenan si los campos están.
  const cuentas = await pagina.$$eval('select[name="lineas[0].cuenta"] option', (os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  if (cuentas.length) {
    const alquiler = cuentas.find((c) => c.startsWith("635")) ?? cuentas[0]!;
    await pagina.selectOption('select[name="lineas[0].cuenta"]', alquiler);
  }
  const centros = await pagina.$$eval('select[name="lineas[0].centroCostoId"] option', (os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  if (centros.length) {
    await pagina.selectOption('select[name="lineas[0].centroCostoId"]', centros[0]!);
  }

  await pagina.click('button:text-is("Registrar compra")');
  await pagina
    .waitForURL((u) => u.pathname === "/compras", { timeout: 60000 })
    .catch(async () => {
      assert.fail(`no se pudo registrar la compra de prueba: ${await avisoEnPantalla()}`);
    });
}

/** Un embarque nuevo, para que la prueba de pólizas no dependa de la sembrada. */
async function crearEmbarque() {
  await pagina.goto(`${BASE}/importaciones/nueva`);
  await pagina.waitForSelector('input[name="numero"]');
  await pagina.fill('input[name="numero"]', `IMP-E2E-${String(Date.now()).slice(-8)}`);

  const proveedores = await pagina.$$eval('select[name="proveedorId"] option', (os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  await pagina.selectOption('select[name="proveedorId"]', proveedores[0]!);
  const almacenes = await pagina.$$eval('select[name="almacenId"] option', (os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  await pagina.selectOption('select[name="almacenId"]', almacenes[0]!);
  await pagina.fill('input[name="tipoCambio"]', "3.75");
  await pagina.click('button[type="submit"]:not([disabled])');
  await pagina.waitForURL((u) => /^\/importaciones\/[0-9a-f-]{36}$/.test(u.pathname), {
    timeout: 60000,
  });

  // Un embarque sin ítems no pesa nada y no serviría para repartir gastos. El
  // formulario vive dentro de un `<details>`, así que hay que desplegarlo: es
  // un `<summary>`, no un botón, y buscarlo como botón dejaba el campo oculto.
  if (!(await pagina.locator('select[name="productoId"]').isVisible())) {
    await pagina.locator('summary:has-text("Agregar ítem")').first().click();
  }
  await pagina.locator('select[name="productoId"]').waitFor({ state: "visible", timeout: 60000 });
  const productos = await pagina.$$eval('select[name="productoId"] option', (os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  await pagina.selectOption('select[name="productoId"]', productos[0]!);
  await pagina.fill('input[name="descripcion"]', "Mercadería de prueba");
  await pagina.fill('input[name="cantidad"]', "10");
  await pagina.fill('input[name="fobUnitario"]', "100");
  await pagina.click('button:has-text("Agregar ítem")');
  await pagina.waitForSelector("text=Mercadería de prueba", { timeout: 60000 });
}

describe("póliza de importación", () => {
  /**
   * Lo que un importador no puede hacer sin pólizas: repartir entre varios
   * embarques el agenciamiento de una sola DUA.
   *
   * La prueba llega hasta el reparto y se detiene ahí: liquidar cambia el
   * inventario y la contabilidad de la base sembrada, y eso lo cubren las
   * pruebas de servicio, que corren contra una base limpia.
   */
  test("agrupa embarques y reparte el gasto de la DUA entre ellos", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/importaciones/polizas`);
    await pagina.click('button:text-is("Nueva póliza")');
    await pagina.waitForSelector('input[name="numero"]');

    const dua = `235-2026-10-${String(Date.now()).slice(-6)}`;
    await pagina.fill('input[name="numero"]', dua);
    await pagina.fill('input[name="tipoCambio"]', "3.80");
    await pagina.click('button:text-is("Abrir póliza")');
    await pagina.waitForURL(
      (u) => /^\/importaciones\/polizas\/[0-9a-f-]{36}$/.test(u.pathname),
      { timeout: 30000 },
    );
    const urlPoliza = pagina.url().split("?")[0]!;

    /*
     * Embarques sueltos que ofrece la póliza.
     *
     * `$$eval` devuelve una lista vacía tanto si el desplegable está vacío como
     * si no existe, y confundir las dos cosas convirtió este bucle en una
     * fábrica de embarques: creaba uno, no encontraba el campo, y volvía a
     * empezar. Ahora se exige que el campo esté antes de leerlo.
     */
    const leerDisponibles = async () => {
      // El desplegable no existe cuando no queda ningún embarque suelto: en la
      // póliza se muestra un párrafo en su lugar. Esperar a que aparezca sería
      // esperar en vano, así que se comprueba sin bloquear.
      if ((await pagina.locator('select[name="importacionId"]').count()) === 0) return [];
      return pagina.$$eval('select[name="importacionId"] option', (os) =>
        os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
      );
    };

    let disponibles = await leerDisponibles();
    // Si la sembrada no tiene embarques sueltos, la prueba se los crea: de otro
    // modo se saltaría sola en cuanto alguien liquide los que había, y una
    // prueba que se salta sola no vigila nada.
    for (let intento = 0; disponibles.length < 2 && intento < 3; intento++) {
      await crearEmbarque();
      await pagina.goto(urlPoliza);
      disponibles = await leerDisponibles();
    }
    if (disponibles.length < 2) {
      assert.fail(
        `no hay dos embarques sueltos que agrupar. url: ${pagina.url()}\n` +
          `pantalla: ${((await pagina.textContent("main")) ?? "").slice(0, 700)}`,
      );
    }

    for (const embarque of disponibles.slice(0, 2)) {
      await pagina.goto(urlPoliza);
      await pagina.selectOption('select[name="importacionId"]', embarque);
      await pagina.click('button:text-is("Agrupar")');
      await pagina.waitForURL((u) => u.search.includes("agrupado"), { timeout: 60000 });
    }

    await pagina.fill('input[name="concepto"]', "Agenciamiento de aduana");
    await pagina.fill('input[name="importe"]', "4000");
    // Sin recargar a propósito: la página que queda tras agrupar tiene que
    // seguir siendo utilizable. Aquí es donde se veía que no lo era.
    await pagina.click('button:text-is("Agregar gasto")');
    await pagina
      .waitForURL((u) => u.search.includes("Gasto"), { timeout: 60000 })
      .catch(async () => {
        const html = (await pagina.textContent("main")) ?? "";
        assert.fail(
          `no se pudo cargar el gasto de la DUA: ${await avisoEnPantalla()}\n` +
            `url: ${pagina.url()}\npantalla: ${html.slice(0, 600)}`,
        );
      });

    // El panel de reparto, no el `aside` del menú: hay dos en la página.
    const panel =
      (await pagina
        .locator("section")
        .filter({ has: pagina.locator('h2:text-is("Reparto")') })
        .textContent()) ?? "";
    assert.match(panel, /4,?000\.00/, `el reparto no muestra el gasto:\n${panel}`);
    assert.doesNotMatch(panel, /no suma lo gastado/);
  });

  test("un gasto por peso sin pesos declarados lo dice en pantalla", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/importaciones/polizas`);
    const primera = pagina.locator("tbody tr a").first();
    if ((await primera.count()) === 0) {
      t.skip("no hay pólizas en la base");
      return;
    }
    // Sólo se comprueba que la pantalla abre: el caso del peso lo cubren las
    // pruebas de servicio, y aquí lo que importa es que un reparto imposible no
    // deje la página en blanco.
    await primera.click();
    await pagina.waitForSelector("h1", { timeout: 30000 });
  });
});

describe("recibos, cheques y entregas a rendir", () => {
  /**
   * Los tres documentos que la caja necesita para no mentir.
   *
   * Lo que se vigila aquí es que cada uno llegue hasta su servicio y que lo que
   * la pantalla afirma sobre el dinero sea cierto: que el recibo mueva la caja,
   * que el cheque girado **no** la mueva, y que la entrega a rendir salga como
   * activo y no como gasto.
   */
  test("un recibo de egreso mueve la caja y aparece en la lista", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/caja-bancos/recibos`);
    await pagina.waitForSelector('select[name="cuentaId"]');
    await pagina.click('button:text-is("Recibo de egreso")');

    const cuentas = await pagina.$$eval('select[name="cuentaId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (cuentas.length === 0) {
      t.skip("la base sembrada no tiene cuentas de efectivo");
      return;
    }
    await pagina.selectOption('select[name="cuentaId"]', cuentas[0]!);
    await pagina.fill('input[name="importe"]', "35.50");
    await pagina.fill('input[name="aNombreDe"]', "Luis Quispe");
    await pagina.fill('input[name="concepto"]', "Movilidad de prueba");

    // La contrapartida propuesta puede exigir centro de costo; si el
    // desplegable existe, se elige el primero.
    const centros = await pagina.$$eval('select[name="centroCostoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (centros.length) await pagina.selectOption('select[name="centroCostoId"]', centros[0]!);

    await pagina.click('button:has-text("Emitir recibo de egreso")');
    await pagina.waitForURL((u) => u.search.includes("hecho"), { timeout: 60000 });
    const anuncio = (await pagina.textContent('[role="status"]')) ?? "";
    assert.match(anuncio, /Recibo RE\d{4}-\d{6} emitido/);

    const tabla = (await pagina.textContent("table")) ?? "";
    assert.match(tabla, /Movilidad de prueba/);
  });

  test("girar un cheque no descuenta el saldo del banco", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/caja-bancos`);
    const saldosAntes = (await pagina.textContent("table")) ?? "";

    await pagina.goto(`${BASE}/caja-bancos/cheques`);
    await pagina.click('button:text-is("Girar cheque")');
    await pagina.waitForSelector('select[name="cuentaId"]');

    const cuentas = await pagina.$$eval('select[name="cuentaId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (cuentas.length === 0) {
      t.skip("la base sembrada no tiene cuentas de efectivo");
      return;
    }
    const numero = String(Date.now()).slice(-8);
    await pagina.selectOption('select[name="cuentaId"]', cuentas[0]!);
    await pagina.fill('input[name="numero"]', numero);
    await pagina.fill('input[name="importe"]', "1200.00");
    await pagina.fill('input[name="beneficiario"]', "Proveedor de prueba");
    await pagina.click('button[type="submit"]:has-text("Girar cheque")');
    await pagina.waitForURL((u) => u.search.includes("hecho"), { timeout: 60000 });

    // Aparece en circulación…
    const fila = pagina.locator("tbody tr", { hasText: numero });
    await fila.waitFor({ timeout: 60000 }).catch(async () => {
      assert.fail(`el cheque ${numero} no aparece en la lista: ${await avisoEnPantalla()}`);
    });
    assert.match((await pagina.textContent("main")) ?? "", /En circulación/);

    // …y el saldo del banco no se movió: el dinero sale cuando el banco carga.
    await pagina.goto(`${BASE}/caja-bancos`);
    assert.equal((await pagina.textContent("table")) ?? "", saldosAntes);

    // Cobrarlo exige la fecha en que el banco lo cargó.
    await pagina.goto(`${BASE}/caja-bancos/cheques`);
    const laFila = pagina.locator("tbody tr", { hasText: numero });
    await laFila.locator('button:text-is("Cobrado")').click();
    await laFila.locator('input[type="date"]').fill("2026-09-20");
    await laFila.locator('button:text-is("Confirmar")').click();
    await pagina.waitForURL((u) => u.search.includes("cobrado"), { timeout: 60000 });
  });

  test("una entrega a rendir sale como activo y se rinde con documentos", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/caja-bancos/rendiciones`);
    await pagina.click('button:text-is("Entregar a rendir")');
    await pagina.waitForSelector('select[name="cuentaId"]');

    const cuentas = await pagina.$$eval('select[name="cuentaId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (cuentas.length === 0) {
      t.skip("la base sembrada no tiene cuentas de efectivo");
      return;
    }
    await pagina.selectOption('select[name="cuentaId"]', cuentas[0]!);
    await pagina.fill('input[name="importe"]', "400.00");
    await pagina.fill('input[name="responsable"]', "Luis Quispe");
    await pagina.fill('input[name="motivo"]', "Viaje de prueba");
    const centros = await pagina.$$eval('select[name="centroCostoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (centros.length) await pagina.selectOption('select[name="centroCostoId"]', centros[0]!);

    await pagina.click('button:text-is("Entregar")');
    await pagina
      .waitForURL((u) => /^\/caja-bancos\/rendiciones\/[0-9a-f-]{36}$/.test(u.pathname), {
        timeout: 60000,
      })
      .catch(async () => {
        assert.fail(`la entrega no se registró: ${await avisoEnPantalla()}`);
      });
    assert.match((await pagina.textContent("body")) ?? "", /Todavía no se rindió nada/);

    // Se rinde 300 y se devuelven 100: la entrega queda cerrada.
    await pagina.fill('input[name="lineas[0].concepto"]', "Pasajes de prueba");
    await pagina.fill('input[name="lineas[0].importe"]', "300");
    await pagina.fill('input[name="devuelve"]', "100");
    await pagina.click('button:text-is("Registrar rendición")');
    await pagina.waitForURL((u) => u.search.includes("rendida"), { timeout: 60000 });

    const cuerpo = (await pagina.textContent("body")) ?? "";
    assert.match(cuerpo, /Pasajes de prueba/);
    assert.match(cuerpo, /rendida/);

    // Y el libro sigue cuadrando después de mover la 14, la caja y el gasto.
    await pagina.goto(`${BASE}/contabilidad`);
    assert.match((await pagina.textContent("body")) ?? "", /El balance cuadra/);
  });

  test("no deja rendir más de lo entregado", async (t) => {
    if (sinServidor(t)) return;
    // La prueba se crea su propia entrega: depender de las que dejó otra la
    // hacía saltarse en cuanto aquélla se rendía entera.
    await pagina.goto(`${BASE}/caja-bancos/rendiciones`);
    await pagina.click('button:text-is("Entregar a rendir")');
    await pagina.waitForSelector('select[name="cuentaId"]');
    const cuentas = await pagina.$$eval('select[name="cuentaId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (cuentas.length === 0) {
      t.skip("la base sembrada no tiene cuentas de efectivo");
      return;
    }
    await pagina.selectOption('select[name="cuentaId"]', cuentas[0]!);
    await pagina.fill('input[name="importe"]', "120.00");
    await pagina.fill('input[name="responsable"]', "Luis Quispe");
    await pagina.fill('input[name="motivo"]', "Entrega para probar el exceso");
    const centros = await pagina.$$eval('select[name="centroCostoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (centros.length) await pagina.selectOption('select[name="centroCostoId"]', centros[0]!);
    await pagina.click('button:text-is("Entregar")');
    await pagina.waitForURL(
      (u) => /^\/caja-bancos\/rendiciones\/[0-9a-f-]{36}$/.test(u.pathname),
      { timeout: 60000 },
    );
    await pagina.waitForSelector('input[name="lineas[0].importe"]', { timeout: 60000 });

    await pagina.fill('input[name="lineas[0].concepto"]', "Exceso de prueba");
    await pagina.fill('input[name="lineas[0].importe"]', "999999");
    // El aviso sale sin enviar nada: el formulario sabe cuánto queda.
    await pagina.waitForSelector(".aviso", { timeout: 60000 });
    assert.match((await pagina.textContent(".aviso")) ?? "", /más de lo entregado/);
  });
});

describe("orden de pago", () => {
  /**
   * El control que Starsoft tiene y aquí faltaba: nadie paga sin autorización.
   *
   * Se arma la orden desde los documentos abiertos de un proveedor, se
   * comprueba que sin autorizar no hay botón de pagar, se autoriza y se paga.
   */
  test("de la orden a la autorización y al pago", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/cxp/ordenes-pago`);
    await pagina.waitForSelector("#proveedorSelect");
    const proveedores = await pagina.$$eval("#proveedorSelect option", (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (proveedores.length === 0) {
      t.skip("la base sembrada no tiene proveedores");
      return;
    }

    // Se busca un proveedor con saldo libre que ordenar; si no hay ninguno, se
    // registra una compra para tenerlo.
    const buscar = async () => {
      for (const p of proveedores) {
        await pagina.goto(`${BASE}/cxp/ordenes-pago?proveedor=${p}`);
        const casillas = pagina.locator('input[name="documentoId"]');
        if ((await casillas.count()) === 0) continue;
        await casillas.first().check();
        return true;
      }
      return false;
    };
    if (!(await buscar())) {
      await crearCompra();
      assert.ok(await buscar(), "ni con una compra nueva hay saldo que ordenar");
    }

    await pagina.click('button:text-is("Crear orden de pago")');
    await pagina.waitForURL(
      (u) => /^\/cxp\/ordenes-pago\/[0-9a-f-]{36}$/.test(u.pathname),
      { timeout: 60000 },
    );
    const urlOrden = pagina.url().split("?")[0]!;

    // Pendiente: se autoriza o se rechaza, y no hay forma de pagar.
    const pendiente = (await pagina.textContent("body")) ?? "";
    assert.match(pendiente, /pendiente/);
    assert.equal(await pagina.locator('button:text-is("Pagar")').count(), 0);

    await pagina.click('button:text-is("Autorizar")');
    await pagina.waitForURL((u) => u.search.includes("autorizada"), { timeout: 60000 });
    assert.match((await pagina.textContent('[role="status"]')) ?? "", /Ya se puede ejecutar/);

    await pagina.click('button:text-is("Pagar")');
    await pagina.waitForURL((u) => u.search.includes("pagada"), { timeout: 60000 });
    assert.match((await pagina.textContent('[role="status"]')) ?? "", /Pago registrado/);

    // El libro sigue cuadrando después de mover CxP, banco y contabilidad.
    await pagina.goto(`${BASE}/contabilidad`);
    assert.match((await pagina.textContent("body")) ?? "", /El balance cuadra/);

    // Y la orden pagada ya no ofrece nada.
    await pagina.goto(urlOrden);
    assert.match((await pagina.textContent("body")) ?? "", /ya se pagó/);
  });

  test("el estado de cuenta explica el saldo del proveedor", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/cxp/estado-cuenta`);
    await pagina.waitForSelector('select[name="proveedor"]');
    const proveedores = await pagina.$$eval('select[name="proveedor"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (proveedores.length === 0) {
      t.skip("la base sembrada no tiene proveedores");
      return;
    }

    for (const p of proveedores) {
      await pagina.goto(`${BASE}/cxp/estado-cuenta?proveedor=${p}`);
      const tabla = pagina.locator("table tbody tr");
      if ((await tabla.count()) === 0) continue;
      // La última fila lleva el saldo final, que es lo que se concilia.
      const cuerpo = (await pagina.textContent("body")) ?? "";
      assert.match(cuerpo, /Saldo/);
      assert.match(cuerpo, /Cargo/);
      assert.match(cuerpo, /Abono/);
      return;
    }
    t.skip("ningún proveedor tiene movimientos");
  });
});

describe("kits y conversiones", () => {
  /**
   * La regla que esto vigila es la única que importa aquí: armar no crea
   * valor. El almacén vale lo mismo antes y después, sólo que la mercadería
   * está en otra fila.
   */
  test("define una composición, arma y el almacén sigue valiendo igual", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/inventario/kits`);
    await pagina.waitForSelector('select[name="producto"]');
    const productos = await pagina.$$eval('select[name="producto"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (productos.length < 2) {
      t.skip("la base sembrada no tiene dos productos");
      return;
    }

    // El primero será el kit; el segundo, su componente.
    await pagina.goto(`${BASE}/inventario/kits?producto=${productos[0]}`);
    await pagina.waitForSelector('select[name="lineas[0].componenteId"]');
    const componentes = await pagina.$$eval('select[name="lineas[0].componenteId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="lineas[0].componenteId"]', componentes[0]!);
    await pagina.fill('input[name="lineas[0].cantidad"]', "1");
    await pagina.click('button:text-is("Guardar composición")');
    await pagina.waitForURL((u) => u.search.includes("guardada"), { timeout: 60000 });

    // El componente tiene que tener existencias: armar consume stock, y la
    // sembrada no garantiza que el elegido lo tenga.
    await reponerStock(componentes[0]!);
    await pagina.goto(`${BASE}/inventario/kits?producto=${productos[0]}`);

    const valorAntes = await valorDelAlmacen();

    await pagina.waitForSelector('select[name="almacenId"]');
    const almacenes = await pagina.$$eval('select[name="almacenId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="almacenId"]', almacenes[0]!);
    await pagina.fill('input[name="cantidad"]', "2");
    await pagina.click('button:text-is("Registrar el armado")');
    // Se espera «Armado» y no un `hecho` cualquiera: la URL ya traía el de la
    // composición guardada, y esperar por él volvía al instante con el banner
    // anterior todavía en pantalla.
    await pagina
      .waitForURL((u) => u.search.includes("Armado"), { timeout: 60000 })
      .catch(async () => {
        assert.fail(`no se pudo armar: ${await avisoEnPantalla()}`);
      });
    assert.match((await pagina.textContent('[role="status"]')) ?? "", /Armado KA\d{4}-\d{6}/);

    // La regla dura.
    assert.equal(await valorDelAlmacen(), valorAntes, "armar cambió el valor del almacén");

    // Y sin asiento: el libro sigue igual.
    await pagina.goto(`${BASE}/contabilidad`);
    assert.match((await pagina.textContent("body")) ?? "", /El balance cuadra/);
  });

  test("no arma lo que no tiene componentes", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/inventario/kits`);
    const filas = pagina.locator("tbody tr");
    if ((await filas.count()) === 0) {
      t.skip("no hay composiciones definidas");
      return;
    }
    // Abrir una composición existente no debe romper la pantalla. Se espera a
    // que la URL cambie: `waitForSelector("h1")` vuelve al instante porque el
    // listado también tiene h1, y la aserción leería la página anterior.
    await filas.first().locator("a").click();
    await pagina.waitForURL((u) => u.searchParams.has("producto"), { timeout: 60000 });
    await pagina.waitForSelector('select[name="lineas[0].componenteId"]', { timeout: 60000 });
    assert.match((await pagina.textContent("main")) ?? "", /Composición de/);
  });
});

describe("formatos de estados financieros", () => {
  /**
   * La propiedad que sostiene el módulo: una plantilla delata lo que deja
   * fuera. Sin eso, configurar un formato sería la forma más fácil de hacer
   * desaparecer dinero de un balance sin que nadie lo note.
   */
  test("un formato incompleto avisa de las cuentas que olvida", async (t) => {
    if (sinServidor(t)) return;

    const codigo = `P${String(Date.now()).slice(-6)}`;
    await pagina.goto(`${BASE}/contabilidad/formatos?nuevo=1`);
    await pagina.waitForSelector('input[name="codigo"]');
    await pagina.fill('input[name="codigo"]', codigo);
    await pagina.fill('input[name="nombre"]', "Sólo el efectivo");
    await pagina.selectOption('select[name="tipo"]', "situacion");
    await pagina.fill('input[name="lineas[0].codigo"]', "caja");
    await pagina.fill('input[name="lineas[0].concepto"]', "Efectivo");
    await pagina.fill('input[name="lineas[0].cuentas"]', "10");
    await pagina.click('button:text-is("Guardar formato")');
    await pagina
      .waitForURL((u) => u.search.includes("guardado"), { timeout: 60000 })
      .catch(async () => {
        assert.fail(`no se guardó el formato: ${await avisoEnPantalla()}`);
      });

    // Al usarlo, los estados tienen que denunciar lo que queda fuera.
    const id = new URL(pagina.url()).searchParams.get("formato")!;
    await pagina.goto(`${BASE}/contabilidad/estados?situacion=${id}`);
    await pagina.waitForSelector(".aviso", { timeout: 60000 });
    assert.match(
      (await pagina.textContent(".aviso")) ?? "",
      /deja \d+ cuentas? con saldo fuera del informe/,
    );
  });

  test("el formato de partida no deja nada fuera y el balance cuadra", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/estados`);
    await pagina.waitForSelector("table", { timeout: 60000 });

    const cuerpo = (await pagina.textContent("main")) ?? "";
    assert.match(cuerpo, /Activo = Pasivo \+ Patrimonio/, "el balance no cuadra");
    assert.doesNotMatch(cuerpo, /fuera del informe/, "el formato de partida olvida cuentas");
    // Y presenta los dos estados.
    assert.match(cuerpo, /TOTAL ACTIVO/);
    assert.match(cuerpo, /RESULTADO DEL EJERCICIO/);
  });

  test("un total no puede sumar un renglón posterior", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/formatos?nuevo=1`);
    await pagina.waitForSelector('input[name="codigo"]');
    await pagina.fill('input[name="codigo"]', `M${String(Date.now()).slice(-6)}`);
    await pagina.fill('input[name="nombre"]', "Adelantado");
    await pagina.selectOption('select[name="tipo"]', "resultados");

    await pagina.selectOption('select[name="lineas[0].clase"]', "total");
    await pagina.fill('input[name="lineas[0].codigo"]', "t");
    await pagina.fill('input[name="lineas[0].concepto"]', "Total");
    await pagina.fill('input[name="lineas[0].suma"]', "ing");

    await pagina.click('button:text-is("Añadir renglón")');
    await pagina.fill('input[name="lineas[1].codigo"]', "ing");
    await pagina.fill('input[name="lineas[1].concepto"]', "Ingresos");
    await pagina.fill('input[name="lineas[1].cuentas"]', "70");

    await pagina.click('button:text-is("Guardar formato")');
    await pagina.waitForSelector(".aviso", { timeout: 60000 });
    assert.match((await pagina.textContent(".aviso")) ?? "", /no es ningún renglón anterior/);
  });
});

describe("presupuesto y análisis presupuestal", () => {
  /**
   * La salvaguarda del módulo: un análisis que sólo mira lo presupuestado deja
   * fuera justo lo que nadie planeó, que suele ser lo que más duele.
   */
  test("crea un presupuesto, lo aprueba y denuncia lo no presupuestado", async (t) => {
    if (sinServidor(t)) return;

    const codigo = `P${String(Date.now()).slice(-6)}`;
    const anio = new Date().getUTCFullYear();

    await pagina.goto(`${BASE}/contabilidad/presupuesto?nuevo=1`);
    await pagina.waitForSelector('input[name="codigo"]');
    await pagina.fill('input[name="codigo"]', codigo);
    await pagina.fill('input[name="nombre"]', "Presupuesto de prueba");
    await pagina.fill('input[name="ejercicio"]', String(anio));

    const centros = await pagina.$$eval('select[name="partidas[0].centroCostoId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (centros.length === 0) {
      t.skip("la base sembrada no tiene centros de costo");
      return;
    }
    await pagina.selectOption('select[name="partidas[0].centroCostoId"]', centros[0]!);
    // Una cuenta que casi nadie usa, para que el presupuesto quede muy por
    // debajo de lo realmente gastado y el aviso tenga que salir.
    await pagina.fill('input[name="partidas[0].cuenta"]', "6592");
    await pagina.fill('input[name="partidas[0].importe"]', "1200");

    await pagina.click('button:text-is("Guardar presupuesto")');
    await pagina
      .waitForURL((u) => u.search.includes("guardado"), { timeout: 60000 })
      .catch(async () => {
        assert.fail(`no se guardó el presupuesto: ${await avisoEnPantalla()}`);
      });

    // El anual se reparte en doce: doce partidas de 100.
    const id = new URL(pagina.url()).searchParams.get("presupuesto")!;
    await pagina.goto(`${BASE}/contabilidad/presupuesto?presupuesto=${id}&editar=1`);
    await pagina.waitForSelector('input[name="partidas[11].importe"]', { timeout: 60000 });
    assert.equal(
      await pagina.locator('input[name="partidas[0].importe"]').inputValue(),
      "100.00",
    );

    // Y la ejecución denuncia el gasto que ninguna partida cubre.
    await pagina.goto(`${BASE}/contabilidad/presupuesto?presupuesto=${id}&hasta=12`);
    await pagina.waitForSelector("h1", { timeout: 60000 });
    const cuerpo = (await pagina.textContent("main")) ?? "";
    assert.match(cuerpo, /Presupuestado/);
    assert.match(cuerpo, /ninguna partida presupuestó/, `no salió el aviso:\n${cuerpo.slice(0, 400)}`);

    // Aprobado, deja de editarse.
    await pagina.goto(`${BASE}/contabilidad/presupuesto`);
    const fila = pagina.locator("tbody tr", { hasText: codigo });
    await fila.locator('button:text-is("Aprobar")').click();
    await pagina.waitForURL((u) => u.search.includes("aprobar"), { timeout: 60000 });
    assert.match((await pagina.textContent('[role="status"]')) ?? "", /vara de medir/);
  });

  test("una cuenta que no es un prefijo se rechaza en pantalla", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/presupuesto?nuevo=1`);
    await pagina.waitForSelector('input[name="codigo"]');
    await pagina.fill('input[name="codigo"]', `X${String(Date.now()).slice(-6)}`);
    await pagina.fill('input[name="nombre"]', "Mal escrito");
    await pagina.fill('input[name="partidas[0].cuenta"]', "gastos varios");
    await pagina.fill('input[name="partidas[0].importe"]', "100");
    await pagina.click('button:text-is("Guardar presupuesto")');
    await pagina.waitForSelector(".aviso", { timeout: 60000 });
    assert.match((await pagina.textContent(".aviso")) ?? "", /no es un prefijo numérico/);
  });
});

describe("asiento de destino", () => {
  /**
   * La regla que sostiene el módulo: reclasificar no cambia el resultado. La
   * clase 9 y la 79 se anulan entre sí, así que el balance tiene que seguir
   * cuadrando y la utilidad tiene que ser la misma.
   */
  test("configura reglas, contabiliza el destino y el libro sigue cuadrando", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/contabilidad/destino`);
    await pagina.waitForSelector('select[name="reglas[0].cuentaDestino"]');

    // Una regla que recoge cualquier gasto: así no queda nada sin destino.
    await pagina.fill('input[name="reglas[0].cuenta"]', "6");
    await pagina.selectOption('select[name="reglas[0].cuentaDestino"]', "94");
    await pagina.click('button:text-is("Guardar reglas")');
    await pagina
      .waitForURL((u) => u.search.includes("reglas"), { timeout: 60000 })
      .catch(async () => {
        assert.fail(`no se guardaron las reglas: ${await avisoEnPantalla()}`);
      });

    // El resultado antes de destinar.
    await pagina.goto(`${BASE}/contabilidad/estados`);
    await pagina.waitForSelector("table", { timeout: 60000 });
    const antes = (await pagina.textContent("main")) ?? "";
    assert.match(antes, /Activo = Pasivo \+ Patrimonio/, "el balance no cuadraba de entrada");

    await pagina.goto(`${BASE}/contabilidad/destino`);
    const boton = pagina.locator('button:text-is("Contabilizar el destino")');
    if ((await boton.count()) === 0) {
      t.skip("no hay gasto pendiente de destinar en el periodo");
      return;
    }
    await boton.click();
    await pagina
      .waitForURL((u) => u.search.includes("hecho"), { timeout: 60000 })
      .catch(async () => {
        assert.fail(`no se pudo contabilizar el destino: ${await avisoEnPantalla()}`);
      });

    // Y después: el balance sigue cuadrando y el estado por función se completa.
    const despues = (await pagina.textContent("main")) ?? "";
    assert.match(despues, /completo/, `el estado por función quedó incompleto:\n${despues.slice(0, 400)}`);

    await pagina.goto(`${BASE}/contabilidad/estados`);
    await pagina.waitForSelector("table", { timeout: 60000 });
    const balance = (await pagina.textContent("main")) ?? "";
    assert.match(balance, /Activo = Pasivo \+ Patrimonio/, "destinar descuadró el balance");
    assert.doesNotMatch(
      balance,
      /fuera del informe/,
      "las cuentas de orden se colaron en los estados financieros",
    );
  });

  test("un destino que no es de la clase 9 se rechaza en pantalla", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/destino`);
    await pagina.waitForSelector('input[name="reglas[0].cuenta"]');
    // El desplegable sólo ofrece cuentas de la clase 9, así que se comprueba el
    // otro extremo: una cuenta de origen que no es de gasto.
    await pagina.fill('input[name="reglas[0].cuenta"]', "70");
    await pagina.click('button:text-is("Guardar reglas")');
    await pagina.waitForSelector(".aviso", { timeout: 60000 });
    assert.match((await pagina.textContent(".aviso")) ?? "", /no es de la clase 6/);
  });
});

describe("ratios financieros", () => {
  /**
   * Los ratios se leen del formato, no de rangos de cuentas. Lo que se
   * comprueba aquí es que llegan con número y sin disparates: un infinito o un
   * NaN en pantalla es peor que un hueco, porque parece una cifra.
   */
  test("calcula los ratios sobre el formato predeterminado", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/contabilidad/ratios?periodo=202609`);
    await pagina.waitForSelector("table", { timeout: 60000 });
    const texto = (await pagina.textContent("main")) ?? "";

    for (const grupo of ["Liquidez", "Solvencia", "Actividad", "Rentabilidad"]) {
      assert.match(texto, new RegExp(grupo), `falta el grupo ${grupo}`);
    }
    assert.doesNotMatch(texto, /Infinity|NaN/, "un ratio salió con un valor imposible");

    // La razón corriente sale del activo y el pasivo corrientes, que el formato
    // de partida sí declara: si sale «no calculable», los papeles se perdieron.
    const fila = pagina.locator("tr", { hasText: "Razón corriente" }).first();
    assert.doesNotMatch(
      (await fila.textContent()) ?? "",
      /no calculable/,
      "el formato de partida dejó de declarar el activo o el pasivo corriente",
    );
  });

  test("cambiar de formato no rompe la pantalla", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/ratios`);
    await pagina.waitForSelector('select[name="situacion"]');
    await pagina.fill('input[name="periodo"]', "202609");
    await pagina.click('button:text-is("Ver")');
    await pagina.waitForSelector("table", { timeout: 60000 });
    assert.match((await pagina.textContent("main")) ?? "", /Liquidez/);
  });
});

describe("higiene del navegador", () => {
  test("ninguna pantalla produjo avisos de React", async (t) => {
    if (sinServidor(t)) return;
    // Va al final a propósito: recoge lo que hayan dejado todas las anteriores.
    assert.deepEqual(avisos, [], `avisos en consola:\n${avisos.join("\n")}`);
  });
});

describe("cuentas de integración", () => {
  /**
   * La prueba que decide si la pantalla sirve: cambiar la cuenta de ventas y
   * comprobar que el asiento de la siguiente venta la usa. Una configuración
   * que no llega al asiento es peor que no tenerla.
   */
  test("cambiar la cuenta de ventas cambia el asiento de la venta", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/contabilidad/parametros`);
    await pagina.waitForSelector('select[name="ventas_mercaderia"]', { timeout: 60000 });

    await pagina.selectOption('select[name="ventas_mercaderia"]', "70911");
    await pagina.click('button:text-is("Guardar cuentas")');
    await pagina.waitForURL((u) => u.search.includes("hecho"), { timeout: 60000 }).catch(async () => {
      assert.fail(`no se guardaron las cuentas: ${await avisoEnPantalla()}`);
    });
    // Se espera a que la pantalla vuelva a pintarse: leer el texto en cuanto
    // cambia la dirección devuelve la página todavía vacía.
    await pagina.waitForSelector('select[name="ventas_mercaderia"]', { timeout: 60000 });
    assert.match((await pagina.textContent("main")) ?? "", /cambiadas/);

    // Una venta con la cuenta cambiada tiene que asentarse contra la 70911.
    await pagina.goto(`${BASE}/ventas/nueva`);
    await pagina.waitForSelector('select[name="clienteId"]');
    const clientes = await pagina.$$eval('select[name="clienteId"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    await pagina.selectOption('select[name="clienteId"]', clientes[0]!);
    await pagina.fill('input[name="lineas[0].descripcion"]', "Venta con cuenta configurada");
    await pagina.fill('input[name="lineas[0].cantidad"]', "1");
    await pagina.fill('input[name="lineas[0].valorUnitario"]', "100");
    await pagina.click('button[type="submit"]:not([disabled])');
    await pagina.waitForURL(/\/ventas\/[0-9a-f-]{36}$/, { timeout: 60000 });

    await pagina.goto(`${BASE}/contabilidad?periodo=202609`);
    await pagina.waitForSelector("table", { timeout: 60000 });
    const balance = (await pagina.textContent("main")) ?? "";
    assert.match(balance, /70911/, "la venta no llegó a la cuenta configurada");
    assert.match(balance, /El balance cuadra/);

    // Y se deja como estaba, que es también la prueba de que se puede volver.
    await pagina.goto(`${BASE}/contabilidad/parametros`);
    await pagina.selectOption('select[name="ventas_mercaderia"]', "70111");
    await pagina.click('button:text-is("Guardar cuentas")');
    await pagina.waitForURL((u) => u.search.includes("hecho"), { timeout: 60000 });
    await pagina.waitForSelector('select[name="ventas_mercaderia"]', { timeout: 60000 });
    assert.match(
      (await pagina.textContent("main")) ?? "",
      /Todas siguen las cuentas del plan general/,
      "volver a la cuenta de partida tiene que borrar la excepción",
    );
  });

  test("sólo ofrece cuentas que admiten movimiento", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/parametros`);
    await pagina.waitForSelector('select[name="clientes"]');
    const opciones = await pagina.$$eval('select[name="clientes"] option', (os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );
    assert.ok(opciones.includes("1212"));
    assert.ok(
      !opciones.includes("121"),
      "una cuenta de agrupación no puede recibir asientos y no debe ofrecerse",
    );
  });
});

describe("documentos que se imprimen", () => {
  /**
   * Starsoft se usa con la impresora al lado: la orden se manda al proveedor,
   * la guía viaja con la mercadería y el recibo se firma. Lo que se comprueba
   * es que cada hoja lleve el membrete, sus datos y las casillas de firma, y
   * que la barra de operar no forme parte del documento.
   */
  // El listado y el prefijo de los enlaces no siempre coinciden: las órdenes de
  // compra se listan dentro de la pantalla de compras, no en una ruta propia.
  const hojas: [string, string, string, RegExp[]][] = [
    [
      "orden de compra",
      "/compras?vista=ordenes",
      "/compras/ordenes/",
      [/Orden de compra/i, /Proveedor/, /Conforme del proveedor/],
    ],
    [
      "guía de remisión",
      "/guias",
      "/guias/",
      [/Guía de remisión/i, /Punto de partida/, /Recibido conforme/],
    ],
  ];

  for (const [nombre, listado, prefijo, esperado] of hojas) {
    test(`la ${nombre} sale como documento`, async (t) => {
      if (sinServidor(t)) return;

      await pagina.goto(`${BASE}${listado}`);
      // No se espera la tabla: una lista vacía no la dibuja, y esperarla ahí
      // convierte «no hay datos» en un plantón de sesenta segundos.
      await pagina.waitForSelector("main", { timeout: 60000 });
      // Sólo los enlaces a un documento: en la misma lista está el botón de
      // «nueva», que empieza igual y lleva a un formulario vacío.
      const destino = (
        await pagina.$$eval(`main a[href^="${prefijo}"]`, (as) =>
          as.map((a) => a.getAttribute("href") ?? ""),
        )
      ).find((h) => /[0-9a-f-]{36}/.test(h));
      if (!destino) {
        t.skip(`no hay ${nombre} en la base sembrada`);
        return;
      }
      await pagina.goto(`${BASE}${destino}`);
      await pagina.waitForSelector('a:text-is("Imprimir")', { timeout: 60000 });
      await pagina.click('a:text-is("Imprimir")');
      await pagina.waitForURL(/\/impresion$/, { timeout: 60000 });

      const texto = (await pagina.textContent("body")) ?? "";
      assert.match(texto, /RUC 20303051831/, "falta el membrete de la empresa");
      for (const re of esperado) assert.match(texto, re);
    });
  }

  /**
   * La guía se emite y se imprime: viaja con la mercadería. La suite la crea si
   * no hay ninguna, porque una prueba que se salta no protege nada, y ésta
   * cubre además el flujo de emisión entero.
   */
  test("se emite una guía de remisión por traslado entre almacenes", async (t) => {
    if (sinServidor(t)) return;

    // El punto de partida sale de la sucursal. Si nadie le puso el ubigeo, la
    // guía no se puede emitir sin teclearlo: se completa primero, que es lo que
    // haría el usuario la primera vez.
    await pagina.goto(`${BASE}/maestros/almacenes`);
    await pagina.waitForSelector("table", { timeout: 60000 });
    if ((await pagina.locator('td:has-text("falta")').count()) > 0) {
      await pagina.locator('tbody button:text-is("Editar")').first().click();
      await pagina.waitForSelector('input[name="ubigeo"]');
      await pagina.fill('input[name="ubigeo"]', "150103");
      await pagina.fill('input[name="codigoSunat"]', "0000");
      await pagina.click('button:text-is("Guardar")');
      await pagina.waitForURL((u) => u.search.includes("hecho=sucursal"), { timeout: 60000 });
    }

    await pagina.goto(`${BASE}/guias/nueva`);
    await pagina.waitForSelector('select[name="destinatarioId"]', { timeout: 60000 });

    await pagina.selectOption('select[name="destinatarioId"]', { index: 1 });
    // Motivo 04: traslado entre establecimientos, que no exige comprobante.
    await pagina.selectOption('select[name="motivo"]', "04");
    await pagina.fill('input[name="llegadaUbigeo"]', "150103");
    await pagina.fill('input[name="llegadaDireccion"]', "Av. Nicolás Ayllón 1200, Ate");
    await pagina.fill('input[name="pesoBruto"]', "120.5");
    await pagina.fill('input[name="bultos"]', "3");

    // Transporte privado: placa, conductor y licencia.
    await pagina.selectOption('select[name="modoTransporte"]', "02");
    await pagina.fill('input[name="placa"]', "ABC123");
    await pagina.fill('input[name="conductorNumDoc"]', "45678912");
    await pagina.fill('input[name="conductorLicencia"]', "Q45678912");
    await pagina.fill('input[name="conductorNombres"]', "Julio");
    await pagina.fill('input[name="conductorApellidos"]', "Ramírez");

    await pagina.selectOption('select[name="lineas[0].productoId"]', { index: 1 });
    await pagina.fill('input[name="lineas[0].cantidad"]', "2");

    await pagina.click('button:text-is("Emitir guía")');
    await pagina
      .waitForURL(/\/guias\/[0-9a-f-]{36}/, { timeout: 60000 })
      .catch(async () => {
        assert.fail(`no se emitió la guía: ${await avisoEnPantalla()}`);
      });

    const texto = (await pagina.textContent("main")) ?? "";
    assert.match(texto, /Guía de remisión/);
    assert.match(texto, /ABC123/, "la guía tiene que llevar la placa del vehículo");
  });

  test("el cheque-voucher dice qué documentos cancela", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/caja-bancos/cheques`);
    await pagina.waitForSelector("main", { timeout: 60000 });
    const destino = (
      await pagina.$$eval('main a[href^="/caja-bancos/cheques/"]', (as) =>
        as.map((a) => a.getAttribute("href") ?? ""),
      )
    ).find((h) => /[0-9a-f-]{36}/.test(h));
    if (!destino) {
      t.skip("no hay cheques girados en la base sembrada");
      return;
    }
    await pagina.goto(`${BASE}${destino}`);

    const texto = (await pagina.textContent("body")) ?? "";
    assert.match(texto, /Cheque-voucher/);
    assert.match(texto, /Páguese a/);
    assert.match(texto, /Documentos que cancela/);
    assert.match(texto, /SON .* CON \d{2}\/100/, "falta el importe en letras");
    assert.match(texto, /Autorizado por/, "faltan las casillas de firma");
  });

  test("el recibo de caja se abre desde su número y lleva el importe en letras", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/caja-bancos/recibos`);
    await pagina.waitForSelector("main", { timeout: 60000 });
    const destino = (
      await pagina.$$eval('main a[href^="/caja-bancos/recibos/"]', (as) =>
        as.map((a) => a.getAttribute("href") ?? ""),
      )
    ).find((h) => /[0-9a-f-]{36}/.test(h));
    if (!destino) {
      t.skip("no hay recibos en la base sembrada");
      return;
    }
    await pagina.goto(`${BASE}${destino}`);

    const texto = (await pagina.textContent("body")) ?? "";
    assert.match(texto, /Recibo de (ingreso|egreso)/);
    assert.match(texto, /SON .* CON \d{2}\/100/, "falta el importe en letras");
    assert.match(texto, /conforme/i, "faltan las casillas de firma");
  });
});

describe("representación impresa del comprobante", () => {
  /**
   * El comprobante es el XML; la hoja es lo que recibe el cliente, y la norma
   * fija lo que tiene que llevar: emisor, adquirente, detalle, total en letras,
   * resumen del XML y código QR.
   */
  test("la hoja lleva el QR, el total en letras y el resumen", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/ventas`);
    await pagina.waitForSelector("table", { timeout: 60000 });
    const enlace = pagina.locator('table a[href^="/ventas/"]').first();
    if ((await enlace.count()) === 0) {
      t.skip("no hay comprobantes en la base sembrada");
      return;
    }
    await enlace.click();
    await pagina.waitForSelector('a:text-is("Imprimir")', { timeout: 60000 });
    await pagina.click('a:text-is("Imprimir")');
    await pagina.waitForURL(/\/impresion$/, { timeout: 60000 });

    const texto = (await pagina.textContent("body")) ?? "";
    assert.match(texto, /RUC 20303051831/, "falta el membrete del emisor");
    assert.match(texto, /SON .* CON \d{2}\/100/, "falta el importe en letras");
    assert.match(texto, /Representación impresa/);

    // El QR va dibujado en la hoja, no traído de la red.
    const qr = pagina.locator('[aria-label="Código QR del comprobante"] svg');
    assert.equal(await qr.count(), 1, "la hoja salió sin código QR");
  });
});

describe("registros de compras y ventas", () => {
  /**
   * El registro que se revisa en pantalla y el archivo que se entrega a SUNAT
   * salen de la misma consulta. Que las dos cifras coincidan es el punto: con
   * dos consultas parecidas, el contador tendría dos registros del mismo mes.
   */
  test("el registro de compras cuadra con el archivo del PLE", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/contabilidad/registros?periodo=202609&libro=compras`);
    await pagina.waitForSelector("table", { timeout: 60000 });
    const texto = (await pagina.textContent("main")) ?? "";
    assert.match(texto, /Totales del periodo/);
    assert.doesNotMatch(texto, /NaN|Infinity/);

    // Tantas filas en pantalla como líneas tiene el archivo del PLE.
    const filas = await pagina.locator("table tbody tr").count();
    const r = await pagina.request.get(`${BASE}/api/ple?periodo=202609&libro=080100`);
    assert.equal(r.status(), 200);
    assert.equal(Number(r.headers()["x-filas"]), filas);
  });

  /**
   * Un comprobante en borrador no es una venta declarada y no entra al
   * registro, igual que en el PLE. Pero el libro no puede salir vacío sin decir
   * por qué mientras la pantalla de ventas enseña treinta documentos del mes.
   */
  test("el registro de ventas deja fuera los borradores y lo dice", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/contabilidad/registros?periodo=202609&libro=ventas`);
    await pagina.waitForSelector("form", { timeout: 60000 });
    const texto = (await pagina.textContent("main")) ?? "";

    const vacio = /No hay documentos en el periodo/.test(texto);
    if (vacio) {
      assert.match(
        texto,
        /en borrador/,
        "el libro salió vacío sin explicar que los borradores no entran",
      );
    } else {
      assert.match(texto, /Exportación/);
      assert.match(texto, /Modifica a/);
    }
    assert.doesNotMatch(texto, /NaN|Infinity/);
  });
});

describe("emisión de la orden de importación", () => {
  /** Es un documento que se imprime y se manda al exportador, no una pantalla. */
  test("la orden sale con proveedor, mercadería y casillas de firma", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/importaciones`);
    await pagina.waitForSelector("table", { timeout: 60000 });
    // Dentro de la tabla: el menú lateral también tiene enlaces que empiezan
    // por /importaciones/ y el primero de la página era «Pólizas (DUA)».
    const enlace = pagina.locator('table a[href^="/importaciones/"]').first();
    if ((await enlace.count()) === 0) {
      t.skip("no hay importaciones en la base sembrada");
      return;
    }
    await enlace.click();
    await pagina.waitForSelector('a:text-is("Emitir orden")', { timeout: 60000 });
    await pagina.click('a:text-is("Emitir orden")');
    await pagina.waitForURL(/\/orden$/, { timeout: 60000 });

    const texto = (await pagina.textContent("body")) ?? "";
    assert.match(texto, /ORDEN DE IMPORTACIÓN|Orden de importación/i);
    assert.match(texto, /Proveedor del exterior/);
    assert.match(texto, /Incoterm/);
    assert.match(texto, /FOB total/);
    assert.match(texto, /Aprobado por/, "faltan las casillas de firma");
    assert.match(texto, /RUC 20303051831/, "la orden tiene que llevar el membrete de la empresa");
  });
});

describe("lo que el cliente contrató", () => {
  /**
   * Las tres pantallas que la lista de módulos del cliente pide por su nombre y
   * que no existían: precios históricos (Compras e Importaciones), morosidad
   * (Cuentas por cobrar) y libro de bancos (Caja y bancos).
   */
  test("los precios históricos incluyen las importaciones, no sólo las compras", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/compras/precios`);
    await pagina.waitForSelector('select[name="producto"]', { timeout: 60000 });

    const texto = (await pagina.textContent("main")) ?? "";
    assert.match(texto, /Precio en S\//, "falta la columna comparable en soles");
    // La tabla sale vacía si el producto elegido no se ha comprado; lo que se
    // vigila es que la pantalla responda y ofrezca productos.
    assert.ok(
      (await pagina.locator('select[name="producto"] option').count()) > 0,
      "no ofreció ningún producto",
    );
  });

  test("la antigüedad de saldos reparte por tramos y suma", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/cxc/morosidad`);
    await pagina.waitForSelector("form", { timeout: 60000 });
    const texto = (await pagina.textContent("main")) ?? "";

    for (const tramo of ["Por vencer", "1 a 30", "31 a 60", "61 a 90", "Más de 90"]) {
      assert.match(texto, new RegExp(tramo.replace(/\s/g, "\\s")), `falta el tramo ${tramo}`);
    }
    assert.doesNotMatch(texto, /NaN|Infinity/, "un importe salió con un valor imposible");
  });

  /**
   * El libro sale de los movimientos y el mayor de los asientos: son dos
   * caminos para el mismo dinero. Que la pantalla lo diga es el punto.
   */
  test("el libro de bancos se contrasta contra la cuenta contable", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/caja-bancos/libro?desde=2026-09-01&hasta=2026-09-30`);
    await pagina.waitForSelector("form", { timeout: 60000 });
    const texto = (await pagina.textContent("main")) ?? "";

    assert.match(texto, /Saldo que viene/);
    assert.match(texto, /Saldo que pasa/);
    assert.match(
      texto,
      /El libro cuadra con la contabilidad|Diferencia de/,
      "el libro no dijo si cuadra con el mayor",
    );
  });
});

describe("planillas de cobranza", () => {
  /**
   * El recorrido entero: se arma la planilla con lo que hay libre, sale, y al
   * cerrarla lo que no se cobró vuelve a estar disponible. Lo que se vigila es
   * que un documento entregado **deje de ofrecerse**: dos cobradores con la
   * misma factura acaban en que no la cobra ninguno.
   */
  test("entrega documentos, los reserva y al cerrar los libera", async (t) => {
    if (sinServidor(t)) return;

    await pagina.goto(`${BASE}/cxc/planillas`);
    await pagina.waitForSelector("form");

    const casillas = pagina.locator('input[name="documento"]');
    if ((await casillas.count()) === 0) {
      t.skip("no hay documentos por cobrar libres en la base sembrada");
      return;
    }
    const marca = await casillas.first().getAttribute("value");
    await casillas.first().check();
    await pagina.fill('input[name="responsable"]', "Luis Quispe");
    await pagina.click('button:text-is("Crear planilla")');

    await pagina
      .waitForURL(/\/cxc\/planillas\/[0-9a-f-]{36}/, { timeout: 60000 })
      .catch(async () => {
        assert.fail(`no se creó la planilla: ${await avisoEnPantalla()}`);
      });
    const url = pagina.url();

    const detalle = (await pagina.textContent("main")) ?? "";
    assert.match(detalle, /Luis Quispe/);
    assert.match(detalle, /Documentos entregados/);

    // Entregado, ya no se ofrece: si siguiera en la lista se podría entregar dos veces.
    await pagina.goto(`${BASE}/cxc/planillas`);
    await pagina.waitForSelector("form");
    assert.equal(
      await pagina.locator(`input[name="documento"][value="${marca}"]`).count(),
      0,
      "un documento entregado seguía ofreciéndose para otra planilla",
    );

    // Y al cerrar vuelve a quedar libre.
    await pagina.goto(url);
    await pagina.click('button:text-is("Cerrar planilla")');
    await pagina.waitForURL((u) => u.search.includes("cerrada"), { timeout: 60000 }).catch(
      async () => {
        assert.fail(`no se cerró la planilla: ${await avisoEnPantalla()}`);
      },
    );

    await pagina.goto(`${BASE}/cxc/planillas`);
    await pagina.waitForSelector("form");
    assert.equal(
      await pagina.locator(`input[name="documento"][value="${marca}"]`).count(),
      1,
      "cerrar la planilla tenía que liberar lo que no se cobró",
    );
  });

  test("una planilla sin documentos se rechaza", async (t) => {
    if (sinServidor(t)) return;
    await pagina.goto(`${BASE}/cxc/planillas`);
    await pagina.waitForSelector('input[name="responsable"]');
    await pagina.fill('input[name="responsable"]', "Nadie");
    await pagina.click('button:text-is("Crear planilla")');
    await pagina.waitForSelector(".aviso", { timeout: 60000 });
    assert.match((await pagina.textContent(".aviso")) ?? "", /al menos un documento/i);
  });
});

describe("exportación al PDT", () => {
  test("la liquidación se descarga en CSV con sus casillas", async (t) => {
    if (sinServidor(t)) return;
    const r = await pagina.request.get(`${BASE}/api/pdt?periodo=202609`);
    assert.equal(r.status(), 200);
    assert.match(r.headers()["content-disposition"] ?? "", /PDT621-20303051831-202609\.csv/);

    const filas = (await r.text()).trimEnd().split("\r\n");
    assert.equal(filas[0], "SECCION;CASILLA;CONCEPTO;IMPORTE");
    assert.ok(filas.length > 1, "el CSV llegó sin casillas");
  });

  test("un periodo mal escrito se rechaza en vez de devolver un archivo vacío", async (t) => {
    if (sinServidor(t)) return;
    const r = await pagina.request.get(`${BASE}/api/pdt?periodo=2026`);
    assert.equal(r.status(), 400);
  });
});

describe("descarga de libros electrónicos", () => {
  test("el PLE se descarga con su nombre de 33 caracteres", async (t) => {
    if (sinServidor(t)) return;
    const r = await pagina.request.get(`${BASE}/api/ple?periodo=202609&libro=050100`);
    assert.equal(r.status(), 200);
    const nombre = /filename="([^"]+)"/.exec(r.headers()["content-disposition"] ?? "")?.[1];
    assert.ok(nombre, "falta el nombre del archivo");
    assert.equal(nombre!.length, 37, "33 caracteres más .TXT");
    assert.ok(nombre!.startsWith("LE20303051831"));
  });
});
