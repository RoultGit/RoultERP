/**
 * Mantenimiento de maestros.
 *
 * Todo lo que aquí se valida es de negocio, no de aislamiento: de que una ficha
 * pertenezca a la empresa correcta ya se encarga RLS. Lo que sí hay que
 * comprobar es lo que la base no sabe — que un RUC tenga su dígito verificador
 * bien, que una unidad exista, que una cuenta contable admita movimiento.
 *
 * Las fichas no se borran, se desactivan. Un producto con kardex o un proveedor
 * con facturas no puede desaparecer sin dejar huérfanos años de historia.
 */
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { money } from "@roulterp/core";
import { schema as s, type Db } from "@roulterp/db";
import { rucValido } from "./empresas.ts";

const { productos, terceros, unidadesMedida, planCuentas, almacenes, sucursales } = s;

export class MaestroInvalido extends Error {
  constructor(readonly motivos: readonly string[]) {
    super(motivos.join("; "));
    this.name = "MaestroInvalido";
  }
}

const texto = (max: number) => z.string().trim().min(1).max(max);
const decimalOpcional = z
  .string()
  .trim()
  .refine((v) => v === "" || /^-?\d+(\.\d+)?$/.test(v), "debe ser un número")
  .transform((v) => (v === "" ? null : v));

// ─── Productos ────────────────────────────────────────────────────────────

export const productoSchema = z.object({
  codigo: texto(40),
  descripcion: texto(500),
  unidadId: z.string().uuid("elija una unidad de medida"),
  tipo: z.enum(["bien", "servicio"]),
  afectacionIgv: z.string().regex(/^\d{2}$/, "afectación de IGV inválida"),
  codigoSunat: z.string().trim().max(40).optional(),
  partidaArancelaria: z.string().trim().max(20).optional(),
  pesoUnitario: decimalOpcional,
  volumenUnitario: decimalOpcional,
  stockMinimo: decimalOpcional,
  controlLote: z.boolean(),
  controlSerie: z.boolean(),
});

export type DatosProducto = z.input<typeof productoSchema>;

export async function guardarProducto(
  db: Db,
  empresaId: string,
  datos: DatosProducto,
  id?: string,
): Promise<string> {
  const d = productoSchema.parse(datos);

  // El código identifica al producto en las guías, los comprobantes y el PLE;
  // dos productos con el mismo código hacen ilegible el kardex.
  const repetido = await db
    .select({ id: productos.id })
    .from(productos)
    .where(eq(productos.codigo, d.codigo))
    .limit(1);
  if (repetido[0] && repetido[0].id !== id) {
    throw new MaestroInvalido([`ya existe un producto con el código ${d.codigo}`]);
  }

  const valores = {
    empresaId,
    codigo: d.codigo,
    descripcion: d.descripcion,
    unidadId: d.unidadId,
    tipo: d.tipo,
    afectacionIgv: d.afectacionIgv,
    codigoSunat: d.codigoSunat || null,
    partidaArancelaria: d.partidaArancelaria || null,
    pesoUnitario: d.pesoUnitario,
    volumenUnitario: d.volumenUnitario,
    stockMinimo: d.stockMinimo ?? "0",
    controlLote: d.controlLote,
    controlSerie: d.controlSerie,
  };

  if (id) {
    // Cambiar el tipo de un producto que ya tiene kardex dejaría movimientos
    // sobre algo que, según su ficha, no lleva existencias.
    if (d.tipo === "servicio") {
      const [conMovimientos] = (await db.execute(sql`
        SELECT count(*)::int AS n FROM movimientos_inventario WHERE producto_id = ${id}`)) as unknown as [
        { n: number },
      ];
      if (conMovimientos.n > 0) {
        throw new MaestroInvalido([
          "este producto ya tiene movimientos de inventario; no puede pasar a servicio",
        ]);
      }
    }
    await db.update(productos).set(valores).where(eq(productos.id, id));
    return id;
  }

  const [fila] = await db.insert(productos).values(valores).returning({ id: productos.id });
  return fila!.id;
}

export async function listarProductos(db: Db, filtro?: { busqueda?: string; soloActivos?: boolean }) {
  const condiciones = [];
  if (filtro?.soloActivos !== false) condiciones.push(eq(productos.activo, true));
  if (filtro?.busqueda) {
    const patron = `%${filtro.busqueda}%`;
    condiciones.push(
      or(ilike(productos.codigo, patron), ilike(productos.descripcion, patron))!,
    );
  }
  return db
    .select({
      id: productos.id,
      codigo: productos.codigo,
      descripcion: productos.descripcion,
      tipo: productos.tipo,
      unidad: unidadesMedida.codigo,
      afectacionIgv: productos.afectacionIgv,
      pesoUnitario: productos.pesoUnitario,
      stockMinimo: productos.stockMinimo,
      activo: productos.activo,
    })
    .from(productos)
    .innerJoin(unidadesMedida, eq(unidadesMedida.id, productos.unidadId))
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(asc(productos.codigo))
    .limit(500);
}

/**
 * Desactiva un producto. No se borra: tendría kardex, compras y comprobantes
 * apuntándole, y borrarlo dejaría años de historia sin poder explicarse.
 */
export async function desactivarProducto(db: Db, id: string): Promise<void> {
  await db.update(productos).set({ activo: false }).where(eq(productos.id, id));
}

// ─── Terceros ─────────────────────────────────────────────────────────────

/** Catálogo 06 de SUNAT, con la longitud que exige cada tipo. */
const LONGITUD_DOCUMENTO: Record<string, number | null> = {
  "0": null, // sin documento (proveedor del exterior)
  "1": 8, // DNI
  "4": null, // carné de extranjería
  "6": 11, // RUC
  "7": null, // pasaporte
  A: null, // cédula diplomática
};

export const terceroSchema = z
  .object({
    tipoDocumento: z.enum(["0", "1", "4", "6", "7", "A"]),
    numeroDocumento: texto(20),
    razonSocial: texto(300),
    nombreComercial: z.string().trim().max(300).optional(),
    direccion: z.string().trim().max(300).optional(),
    pais: z.string().trim().length(2).toUpperCase(),
    email: z.union([z.string().trim().email(), z.literal("")]).optional(),
    telefono: z.string().trim().max(40).optional(),
    esCliente: z.boolean(),
    esProveedor: z.boolean(),
    esDomiciliado: z.boolean(),
    // Llega como texto desde el formulario y como número desde el código.
    diasCredito: z.union([z.number(), z.string()]).pipe(z.coerce.number().int().min(0).max(365)),
    limiteCredito: decimalOpcional,
    monedaLimite: z.string().trim().length(3).toUpperCase(),
  })
  .superRefine((d, ctx) => {
    if (!d.esCliente && !d.esProveedor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "marque al menos si es cliente o proveedor",
        path: ["esCliente"],
      });
    }
    const largo = LONGITUD_DOCUMENTO[d.tipoDocumento];
    if (largo && d.numeroDocumento.length !== largo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `el documento tipo ${d.tipoDocumento} debe tener ${largo} dígitos`,
        path: ["numeroDocumento"],
      });
    }
    // Un RUC mal escrito viaja hasta el XML del comprobante y lo rechaza SUNAT
    // después de que el cliente ya facturó.
    if (d.tipoDocumento === "6" && !rucValido(d.numeroDocumento)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "el RUC no es válido: revise el dígito verificador",
        path: ["numeroDocumento"],
      });
    }
    if (d.pais !== "PE" && d.esDomiciliado) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "un tercero del exterior no puede estar marcado como domiciliado",
        path: ["esDomiciliado"],
      });
    }
  });

export type DatosTercero = z.input<typeof terceroSchema>;

export async function guardarTercero(
  db: Db,
  empresaId: string,
  datos: DatosTercero,
  id?: string,
): Promise<string> {
  const d = terceroSchema.parse(datos);

  const repetido = await db
    .select({ id: terceros.id, razon: terceros.razonSocial })
    .from(terceros)
    .where(
      and(
        eq(terceros.tipoDocumento, d.tipoDocumento),
        eq(terceros.numeroDocumento, d.numeroDocumento),
      ),
    )
    .limit(1);
  if (repetido[0] && repetido[0].id !== id) {
    throw new MaestroInvalido([
      `ese documento ya está registrado a nombre de ${repetido[0].razon}`,
    ]);
  }

  const valores = {
    empresaId,
    tipoDocumento: d.tipoDocumento,
    numeroDocumento: d.numeroDocumento,
    razonSocial: d.razonSocial,
    nombreComercial: d.nombreComercial || null,
    direccion: d.direccion || null,
    pais: d.pais,
    email: d.email || null,
    telefono: d.telefono || null,
    esCliente: d.esCliente,
    esProveedor: d.esProveedor,
    esDomiciliado: d.esDomiciliado,
    diasCredito: d.diasCredito,
    limiteCredito: d.limiteCredito ?? "0",
    monedaLimite: d.monedaLimite,
  };

  if (id) {
    await db.update(terceros).set(valores).where(eq(terceros.id, id));
    return id;
  }
  const [fila] = await db.insert(terceros).values(valores).returning({ id: terceros.id });
  return fila!.id;
}

export async function listarTerceros(
  db: Db,
  filtro?: { busqueda?: string; rol?: "cliente" | "proveedor" },
) {
  const condiciones = [eq(terceros.activo, true)];
  if (filtro?.rol === "cliente") condiciones.push(eq(terceros.esCliente, true));
  if (filtro?.rol === "proveedor") condiciones.push(eq(terceros.esProveedor, true));
  if (filtro?.busqueda) {
    const patron = `%${filtro.busqueda}%`;
    condiciones.push(
      or(ilike(terceros.razonSocial, patron), ilike(terceros.numeroDocumento, patron))!,
    );
  }
  return db
    .select()
    .from(terceros)
    .where(and(...condiciones))
    .orderBy(asc(terceros.razonSocial))
    .limit(500);
}

// ─── Consultas de apoyo ───────────────────────────────────────────────────

export const listarUnidades = (db: Db) =>
  db.select().from(unidadesMedida).orderBy(asc(unidadesMedida.codigo));

export const listarAlmacenes = (db: Db) =>
  db
    .select({
      id: almacenes.id,
      codigo: almacenes.codigo,
      nombre: almacenes.nombre,
      esTransito: almacenes.esTransito,
      activo: almacenes.activo,
      sucursal: sucursales.nombre,
    })
    .from(almacenes)
    .leftJoin(sucursales, eq(sucursales.id, almacenes.sucursalId))
    .orderBy(asc(almacenes.codigo));

export const listarCuentas = (db: Db, soloMovimiento = false) =>
  db
    .select()
    .from(planCuentas)
    .where(
      soloMovimiento
        ? and(eq(planCuentas.activa, true), eq(planCuentas.esMovimiento, true))
        : eq(planCuentas.activa, true),
    )
    .orderBy(asc(planCuentas.cuenta));

/** Saldo actual del tercero, para mostrarlo en su ficha. */
export async function saldoTercero(db: Db, terceroId: string) {
  const [fila] = (await db.execute(sql`
    SELECT coalesce(sum(saldo), 0)::text AS por_pagar,
           count(*)::int AS documentos
    FROM documentos_cxp
    WHERE proveedor_id = ${terceroId} AND estado IN ('pendiente', 'parcial')`)) as unknown as [
    { por_pagar: string; documentos: number },
  ];
  return {
    porPagar: fila?.por_pagar ?? "0",
    documentos: fila?.documentos ?? 0,
  };
}

export { money };
