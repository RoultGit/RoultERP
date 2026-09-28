/**
 * Alta de empresas: el camino por el que se incorpora un cliente nuevo al SaaS.
 *
 * Es la operación que hace que vender el sistema a la segunda empresa no
 * requiera tocar código. Crea la empresa, siembra sus catálogos y le deja un
 * administrador que puede entrar y trabajar el mismo día.
 *
 * Corre con privilegios plenos y **fuera** de RLS, porque crear una empresa es
 * por definición un acto que ocurre antes de que exista esa empresa. Por eso no
 * se expone a los usuarios del sistema: la usa el operador del SaaS desde un
 * script o desde el panel de administración, nunca una petición del navegador.
 */
import postgres from "postgres";
import { hashPassword, ROLES_BASE } from "@roulterp/core/auth";
import { DETRACCION_SEED } from "@roulterp/core/tributario";
import { eq, sql } from "drizzle-orm";
import { ErrorDeNegocio, money } from "@roulterp/core";
import { schema, type Db } from "@roulterp/db";
import { PCGE, UNIDADES, nivelDe } from "./pcge.ts";
import { FORMATOS_BASE } from "./formatos-base.ts";

export type DatosEmpresa = {
  ruc: string;
  razonSocial: string;
  nombreComercial?: string;
  direccion?: string;
  monedaFuncional?: string;
  metodoValorizacion?: "promedio" | "peps";
};

export type DatosAdmin = {
  email: string;
  nombre: string;
  password: string;
};

export type EmpresaCreada = {
  empresaId: string;
  usuarioId: string;
  cuentasSembradas: number;
};

const RUC = /^(10|15|16|17|20)\d{9}$/;

/**
 * Valida un RUC peruano: 11 dígitos, prefijo de tipo de contribuyente válido y
 * dígito verificador correcto según el algoritmo de SUNAT.
 *
 * Se valida aquí y no sólo en el formulario porque un RUC mal escrito llega
 * hasta el XML de un comprobante electrónico, y ahí lo rechaza SUNAT después
 * de que el cliente ya facturó.
 */
export function rucValido(ruc: string): boolean {
  if (!RUC.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(ruc[i]), 0);
  const resto = 11 - (suma % 11);
  const esperado = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return esperado === Number(ruc[10]);
}

export async function crearEmpresa(
  url: string,
  empresa: DatosEmpresa,
  admin: DatosAdmin,
): Promise<EmpresaCreada> {
  if (!rucValido(empresa.ruc)) {
    throw new Error(`el RUC ${empresa.ruc} no es válido`);
  }
  const email = admin.email.trim().toLowerCase();
  const passwordHash = await hashPassword(admin.password);

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const [emp] = await tx<{ id: string }[]>`
        INSERT INTO empresas (ruc, razon_social, nombre_comercial, direccion,
                              moneda_funcional, metodo_valorizacion)
        VALUES (${empresa.ruc}, ${empresa.razonSocial},
                ${empresa.nombreComercial ?? null}, ${empresa.direccion ?? null},
                ${empresa.monedaFuncional ?? "PEN"},
                ${empresa.metodoValorizacion ?? "promedio"})
        RETURNING id`;
      const empresaId = emp!.id;

      // Roles predefinidos. Son punto de partida, no jaula: el administrador
      // puede copiarlos y ajustarlos desde el mantenimiento de roles.
      const rolesInsertados = new Map<string, string>();
      for (const [codigo, def] of Object.entries(ROLES_BASE)) {
        const [rol] = await tx<{ id: string }[]>`
          INSERT INTO roles (empresa_id, codigo, nombre, permisos, es_sistema)
          VALUES (${empresaId}, ${codigo}, ${def.nombre}, ${def.permisos}, true)
          RETURNING id`;
        rolesInsertados.set(codigo, rol!.id);
      }

      // El administrador. Si el correo ya existe —la misma persona lleva la
      // contabilidad de dos empresas— se reutiliza la cuenta y sólo se añade la
      // membresía; su contraseña no se toca.
      const [existente] = await tx<{ id: string }[]>`
        SELECT id FROM usuarios WHERE email = ${email}`;
      const usuarioId =
        existente?.id ??
        (
          await tx<{ id: string }[]>`
            INSERT INTO usuarios (email, password_hash, nombre)
            VALUES (${email}, ${passwordHash}, ${admin.nombre})
            RETURNING id`
        )[0]!.id;

      await tx`
        INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id)
        VALUES (${usuarioId}, ${empresaId}, ${rolesInsertados.get("admin")!})`;

      for (const u of UNIDADES) {
        await tx`
          INSERT INTO unidades_medida (empresa_id, codigo, nombre)
          VALUES (${empresaId}, ${u.codigo}, ${u.nombre})`;
      }

      for (const c of PCGE) {
        await tx`
          INSERT INTO plan_cuentas
            (empresa_id, cuenta, descripcion, nivel, naturaleza, es_movimiento,
             exige_anexo, exige_centro_costo, exige_documento, moneda)
          VALUES (${empresaId}, ${c.cuenta}, ${c.descripcion}, ${nivelDe(c.cuenta)},
                  ${c.naturaleza}, ${c.esMovimiento ?? false},
                  ${c.exigeAnexo ?? false}, ${c.exigeCentroCosto ?? false},
                  ${c.exigeDocumento ?? false}, ${c.moneda ?? null})`;
      }

      for (const r of DETRACCION_SEED) {
        await tx`
          INSERT INTO reglas_detraccion
            (empresa_id, codigo, descripcion, tasa, aplica_minimo, vigente_desde)
          VALUES (${empresaId}, ${r.codigo}, ${r.descripcion},
                  ${money.toString(r.tasa, 6)}, ${r.aplicaMinimo}, '2000-01-01')`;
      }

      // Una sucursal y un almacén, para que se pueda registrar la primera
      // compra sin pasar antes por tres mantenimientos.
      const [suc] = await tx<{ id: string }[]>`
        INSERT INTO sucursales (empresa_id, codigo, nombre, direccion, codigo_sunat)
        VALUES (${empresaId}, '001', 'Oficina principal', ${empresa.direccion ?? null}, '0000')
        RETURNING id`;
      await tx`
        INSERT INTO almacenes (empresa_id, sucursal_id, codigo, nombre)
        VALUES (${empresaId}, ${suc!.id}, '001', 'Almacén principal')`;
      await tx`
        INSERT INTO almacenes (empresa_id, sucursal_id, codigo, nombre, es_transito)
        VALUES (${empresaId}, ${suc!.id}, 'TRA', 'Mercadería en tránsito', true)`;

      /*
       * Un centro de costo de partida.
       *
       * Buena parte de las cuentas de gasto del PCGE lo exigen al contabilizar
       * —la planilla, los servicios, la depreciación—, así que sin ninguno la
       * empresa no podía registrar su primer gasto y no había forma de crearlo
       * salvo tocando la base. Uno genérico la deja operar desde el minuto
       * cero; los suyos los crea después en Maestros.
       */
      await tx`
        INSERT INTO centros_costo (empresa_id, codigo, nombre)
        VALUES (${empresaId}, 'GEN', 'Gastos generales')`;

      /*
       * Los dos formatos de estados financieros de partida.
       *
       * Reproducen los estados que el programa traía cableados, de modo que una
       * empresa que no configura nada ve lo mismo que antes. El contador los
       * edita después, o crea los suyos.
       */
      for (const f of FORMATOS_BASE) {
        const [formato] = await tx<{ id: string }[]>`
          INSERT INTO formatos_eeff (empresa_id, codigo, nombre, tipo, es_predeterminado)
          VALUES (${empresaId}, ${f.codigo}, ${f.nombre}, ${f.tipo},
                  ${f.esPredeterminado ?? false})
          RETURNING id`;
        for (const [i, l] of f.lineas.entries()) {
          await tx`
            INSERT INTO formato_eeff_lineas
              (empresa_id, formato_id, orden, codigo, concepto, clase, nivel,
               cuentas, signo, suma, columna, papel)
            VALUES (${empresaId}, ${formato!.id}, ${i + 1}, ${l.codigo ?? null},
                    ${l.concepto}, ${l.clase ?? "detalle"}, ${l.nivel ?? 1},
                    ${l.cuentas ?? null}, ${l.signo ?? "deudor"},
                    ${l.suma?.length ? l.suma.join(",") : null}, ${l.columna ?? null},
                    ${l.papel ?? null})`;
        }
      }

      return { empresaId, usuarioId, cuentasSembradas: PCGE.length };
    });
  } finally {
    await sql.end();
  }
}

/**
 * Abre un periodo contable. Un periodo cerrado no admite asientos nuevos, que
 * es lo que impide que alguien toque un mes ya declarado a SUNAT.
 */
export async function abrirPeriodo(
  url: string,
  empresaId: string,
  periodo: string,
): Promise<void> {
  if (!/^\d{6}$/.test(periodo)) throw new Error("el periodo debe tener el formato AAAAMM");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO periodos (empresa_id, periodo, estado)
      VALUES (${empresaId}, ${periodo}, 'abierto')
      ON CONFLICT (empresa_id, periodo) DO NOTHING`;
  } finally {
    await sql.end();
  }
}

// ─── Datos de la propia empresa ───────────────────────────────────────────

/**
 * Lo que la empresa puede corregir de sí misma, ya en marcha y dentro de RLS.
 *
 * El alta ocurre fuera de RLS porque crea la empresa; esto es lo contrario:
 * corre con la empresa activa y sólo puede tocar la suya. Hasta ahora estos
 * datos se fijaban al dar de alta y ya no había forma de cambiarlos, así que una
 * empresa que se mudaba de local o que la SUNAT designaba agente de retención
 * tenía que pedir que le tocaran la base.
 *
 * El RUC y la razón social **no** están aquí a propósito. La razón social viaja
 * dentro de cada XML ya firmado y enviado; cambiarla sin más dejaría los
 * comprobantes viejos diciendo una cosa y la pantalla otra. Un cambio de razón
 * social es un trámite, no un campo de formulario, y se hace desde fuera junto
 * con la revisión de lo que ya se emitió.
 */
export type AjustesEmpresa = {
  nombreComercial?: string;
  direccion?: string;
  ubigeo?: string;
  metodoValorizacion?: "promedio" | "peps";
  redondeoDetraccion?: "cercano" | "arriba";
  /** Cuenta de detracciones del Banco de la Nación. Va impresa en la factura. */
  cuentaDetracciones?: string;
  esAgenteRetencion?: boolean;
  esAgentePercepcion?: boolean;
};

export class EmpresaInvalida extends ErrorDeNegocio {
  constructor(motivos: readonly string[]) {
    super(motivos, "EmpresaInvalida");
  }
}

/** Sólo dígitos, guiones y espacios; entre 8 y 25 caracteres. */
const CUENTA_BN = /^[\d\s-]{8,25}$/;

export async function ajustesDeEmpresa(db: Db, empresaId: string) {
  const [e] = await db
    .select()
    .from(schema.empresas)
    .where(eq(schema.empresas.id, empresaId))
    .limit(1);
  if (!e) throw new EmpresaInvalida(["la empresa no existe"]);
  return e;
}

export async function guardarAjustesEmpresa(
  db: Db,
  empresaId: string,
  datos: AjustesEmpresa,
): Promise<void> {
  const motivos: string[] = [];
  if (datos.ubigeo && !/^\d{6}$/.test(datos.ubigeo)) {
    // El ubigeo va en cada guía de remisión como punto de partida; uno de cinco
    // dígitos lo rechaza la GRE con un error que no dice cuál es el campo.
    motivos.push("el ubigeo son seis dígitos");
  }
  if (datos.cuentaDetracciones && !CUENTA_BN.test(datos.cuentaDetracciones)) {
    motivos.push("la cuenta de detracciones lleva sólo dígitos, espacios y guiones");
  }
  if (datos.metodoValorizacion && !["promedio", "peps"].includes(datos.metodoValorizacion)) {
    motivos.push("el método de valorización es «promedio» o «peps»");
  }
  if (datos.redondeoDetraccion && !["cercano", "arriba"].includes(datos.redondeoDetraccion)) {
    motivos.push("el redondeo de la detracción es «cercano» o «arriba»");
  }
  if (motivos.length) throw new EmpresaInvalida(motivos);

  /*
   * Cambiar el método de valorización a mitad de ejercicio reescribiría el costo
   * de todo lo que ya salió del almacén, y con él el costo de ventas de meses ya
   * declarados. Se frena si hay movimientos: cambiarlo es una decisión contable
   * que se toma al abrir el ejercicio, no un desplegable.
   */
  if (datos.metodoValorizacion) {
    const actual = await ajustesDeEmpresa(db, empresaId);
    if (datos.metodoValorizacion !== actual.metodoValorizacion) {
      const [{ hay }] = (await db.execute(
        sql`SELECT EXISTS (SELECT 1 FROM movimientos_inventario WHERE empresa_id = ${empresaId}) AS hay`,
      )) as unknown as [{ hay: boolean }];
      if (hay) {
        throw new EmpresaInvalida([
          "no se cambia el método de valorización con movimientos en el kardex: " +
            "reescribiría el costo de ventas de periodos ya declarados",
        ]);
      }
    }
  }

  const limpio = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  await db
    .update(schema.empresas)
    .set({
      ...(datos.nombreComercial !== undefined
        ? { nombreComercial: limpio(datos.nombreComercial) }
        : {}),
      ...(datos.direccion !== undefined ? { direccion: limpio(datos.direccion) } : {}),
      ...(datos.ubigeo !== undefined ? { ubigeo: limpio(datos.ubigeo) } : {}),
      ...(datos.cuentaDetracciones !== undefined
        ? { cuentaDetracciones: limpio(datos.cuentaDetracciones) }
        : {}),
      ...(datos.metodoValorizacion ? { metodoValorizacion: datos.metodoValorizacion } : {}),
      ...(datos.redondeoDetraccion ? { redondeoDetraccion: datos.redondeoDetraccion } : {}),
      ...(datos.esAgenteRetencion !== undefined
        ? { esAgenteRetencion: datos.esAgenteRetencion }
        : {}),
      ...(datos.esAgentePercepcion !== undefined
        ? { esAgentePercepcion: datos.esAgentePercepcion }
        : {}),
      actualizadoEn: new Date(),
    })
    .where(eq(schema.empresas.id, empresaId));
}
