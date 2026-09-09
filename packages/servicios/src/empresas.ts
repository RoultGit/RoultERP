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
import { money } from "@roulterp/core";
import { PCGE, UNIDADES, nivelDe } from "./pcge.ts";

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
