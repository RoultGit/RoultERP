/**
 * Semilla del Plan Contable General Empresarial.
 *
 * No es el PCGE completo —son miles de cuentas— sino el juego que necesitan los
 * módulos contratados: compras, importaciones, inventario, cuentas por pagar y
 * por cobrar, caja y bancos, ventas. El contador de cada empresa añade lo suyo
 * desde el mantenimiento de cuentas; esto sólo evita que la primera semana se
 * vaya en teclear un plan de cuentas.
 *
 * Las banderas `exige*` son control de calidad del asiento. Una cuenta 42 sin
 * proveedor imputado deja inservible el estado de cuenta por proveedor, así que
 * la cuenta declara qué necesita y la contabilización lo exige.
 */

export type CuentaSemilla = {
  cuenta: string;
  descripcion: string;
  naturaleza: "deudora" | "acreedora";
  /** Sólo las cuentas de último nivel reciben movimiento. */
  esMovimiento?: boolean;
  exigeAnexo?: boolean;
  exigeCentroCosto?: boolean;
  exigeDocumento?: boolean;
  moneda?: string;
};

const d = (
  cuenta: string,
  descripcion: string,
  extra: Partial<CuentaSemilla> = {},
): CuentaSemilla => ({ cuenta, descripcion, naturaleza: "deudora", ...extra });

const a = (
  cuenta: string,
  descripcion: string,
  extra: Partial<CuentaSemilla> = {},
): CuentaSemilla => ({ cuenta, descripcion, naturaleza: "acreedora", ...extra });

/** Movimiento con documento y tercero: lo típico de una cuenta por cobrar o pagar. */
const conTercero = { esMovimiento: true, exigeAnexo: true, exigeDocumento: true } as const;
const mov = { esMovimiento: true } as const;

export const PCGE: readonly CuentaSemilla[] = [
  // ── Elemento 1: activo disponible y exigible ──────────────────────────
  d("10", "Efectivo y equivalentes de efectivo"),
  d("101", "Caja"),
  d("1011", "Caja general", mov),
  d("1012", "Caja chica", mov),
  d("104", "Cuentas corrientes en instituciones financieras"),
  d("1041", "Cuentas corrientes operativas", mov),
  d("1042", "Cuentas corrientes para fines específicos", mov),
  d("107", "Fondos sujetos a restricción"),
  // La cuenta de detracciones del Banco de la Nación: el dinero existe pero
  // sólo se puede usar para pagar tributos.
  d("1071", "Fondos sujetos a restricción — detracciones", mov),

  d("12", "Cuentas por cobrar comerciales — terceros"),
  d("121", "Facturas, boletas y otros comprobantes por cobrar"),
  d("1212", "Emitidas en cartera", conTercero),
  d("123", "Letras por cobrar"),
  d("1232", "En cartera", conTercero),
  d("1233", "En descuento", conTercero),
  d("1234", "En cobranza", conTercero),

  d("16", "Cuentas por cobrar diversas — terceros"),
  d("1673", "Préstamos y otros", { ...mov, exigeAnexo: true }),

  // ── Elemento 2: existencias ───────────────────────────────────────────
  d("20", "Mercaderías"),
  d("201", "Mercaderías manufacturadas"),
  d("2011", "Mercaderías manufacturadas"),
  d("20111", "Costo", mov),

  d("28", "Existencias por recibir"),
  // La mercadería embarcada y aún no nacionalizada vive aquí hasta que la
  // liquidación de importación la traslada a la 20.
  d("281", "Mercaderías en tránsito", mov),

  // ── Elemento 3: activo inmovilizado ───────────────────────────────────
  d("33", "Propiedad, planta y equipo"),
  d("335", "Muebles y enseres", mov),
  d("336", "Equipos diversos", mov),
  a("39", "Depreciación, amortización y agotamiento acumulados"),
  a("3913", "Depreciación acumulada — equipos diversos", mov),

  // ── Elemento 4: pasivo ────────────────────────────────────────────────
  a("40", "Tributos, contraprestaciones y aportes al sistema de pensiones y de salud por pagar"),
  a("401", "Gobierno central"),
  a("4011", "Impuesto general a las ventas"),
  // El IGV de compras e importaciones va aquí, nunca al costo: es crédito
  // fiscal, y sumarlo al inventario lo infla en un 18 %.
  a("40111", "IGV — cuenta propia", mov),
  a("40113", "IGV — régimen de percepciones", mov),
  a("40114", "IGV — régimen de retenciones", mov),
  a("4017", "Impuesto a la renta"),
  a("40171", "Renta de tercera categoría", mov),

  a("42", "Cuentas por pagar comerciales — terceros"),
  a("421", "Facturas, boletas y otros comprobantes por pagar"),
  a("4212", "Emitidas", conTercero),
  a("423", "Letras por pagar"),
  a("4231", "No vencidas", conTercero),
  a("4232", "Vencidas", conTercero),

  a("46", "Cuentas por pagar diversas — terceros"),
  a("4699", "Otras cuentas por pagar", { ...mov, exigeAnexo: true }),

  // ── Elemento 5: patrimonio ────────────────────────────────────────────
  a("50", "Capital"),
  a("5011", "Acciones", mov),
  a("59", "Resultados acumulados"),
  a("5911", "Utilidades acumuladas", mov),
  a("5921", "Pérdidas acumuladas", mov),

  // ── Elemento 6: gastos por naturaleza ─────────────────────────────────
  d("60", "Compras"),
  d("601", "Mercaderías"),
  d("6011", "Mercaderías manufacturadas", mov),
  d("609", "Costos vinculados con las compras"),
  d("6091", "Costos vinculados con las compras de mercaderías"),
  // El desglose que alimenta la liquidación de importación: cada gasto
  // prorrateado aterriza en su divisionaria y de ahí al costo de la mercadería.
  d("60911", "Transporte", mov),
  d("60912", "Seguros", mov),
  d("60913", "Derechos aduaneros", mov),
  d("60914", "Comisiones", mov),
  d("60919", "Otros costos vinculados con las compras de mercaderías", mov),

  d("61", "Variación de existencias"),
  d("611", "Mercaderías"),
  d("6111", "Mercaderías manufacturadas", mov),

  d("63", "Gastos de servicios prestados por terceros"),
  d("6311", "Transporte de carga", { ...mov, exigeCentroCosto: true }),
  d("634", "Mantenimiento y reparaciones", { ...mov, exigeCentroCosto: true }),
  d("6351", "Alquiler de locales", { ...mov, exigeCentroCosto: true }),
  d("6361", "Energía eléctrica", { ...mov, exigeCentroCosto: true }),
  d("6363", "Agua", { ...mov, exigeCentroCosto: true }),
  d("6364", "Teléfono e internet", { ...mov, exigeCentroCosto: true }),
  d("639", "Otros servicios prestados por terceros", { ...mov, exigeCentroCosto: true }),

  d("64", "Gastos por tributos"),
  d("6431", "Impuesto predial", mov),
  d("6434", "Licencia de funcionamiento", mov),

  d("65", "Otros gastos de gestión"),
  d("6591", "Donaciones", mov),
  d("6592", "Sanciones administrativas", mov),

  d("67", "Gastos financieros"),
  d("6711", "Préstamos de instituciones financieras", mov),
  d("6373", "Comisiones y gastos bancarios", mov),
  // Contrapartida de la 776. La diferencia de cambio de un ejercicio se
  // determina partida por partida, no por el neto.
  d("676", "Diferencia de cambio", mov),

  d("69", "Costo de ventas"),
  d("691", "Mercaderías"),
  d("69111", "Terceros", mov),

  // ── Elemento 7: ingresos ──────────────────────────────────────────────
  a("70", "Ventas"),
  a("701", "Mercaderías"),
  a("70111", "Terceros", mov),
  a("709", "Devoluciones sobre ventas"),
  a("70911", "Mercaderías — terceros", mov),

  a("75", "Otros ingresos de gestión"),
  a("759", "Otros ingresos de gestión", mov),

  a("77", "Ingresos financieros"),
  a("776", "Diferencia de cambio", mov),
];

/** Nivel derivado de la longitud del código, como manda el propio PCGE. */
export const nivelDe = (cuenta: string): number => cuenta.length;

/** Unidades de medida más usadas del catálogo 03 de SUNAT. */
export const UNIDADES: readonly { codigo: string; nombre: string }[] = [
  { codigo: "NIU", nombre: "Unidad (bienes)" },
  { codigo: "ZZ", nombre: "Unidad (servicios)" },
  { codigo: "KGM", nombre: "Kilogramo" },
  { codigo: "GRM", nombre: "Gramo" },
  { codigo: "TNE", nombre: "Tonelada" },
  { codigo: "LTR", nombre: "Litro" },
  { codigo: "MTR", nombre: "Metro" },
  { codigo: "MTK", nombre: "Metro cuadrado" },
  { codigo: "MTQ", nombre: "Metro cúbico" },
  { codigo: "BX", nombre: "Caja" },
  { codigo: "PK", nombre: "Paquete" },
  { codigo: "SET", nombre: "Juego" },
  { codigo: "GLL", nombre: "Galón" },
  { codigo: "BG", nombre: "Bolsa" },
  { codigo: "CEN", nombre: "Ciento" },
  { codigo: "DZN", nombre: "Docena" },
  { codigo: "PR", nombre: "Par" },
  { codigo: "ROL", nombre: "Rollo" },
];
