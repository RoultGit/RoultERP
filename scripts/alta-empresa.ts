/**
 * Da de alta una empresa y su primer administrador.
 *
 * Es un programa aparte y no una pantalla, a propósito: crear una empresa
 * ocurre **antes** de que exista esa empresa, así que corre fuera de RLS y con
 * privilegios plenos. Exponerlo dentro del producto significaría tener un
 * camino autenticado que puede escribir sin el filtro de aislamiento, que es
 * justo lo que no debe existir.
 *
 * Se empaqueta en la imagen como un archivo suelto porque la salida autónoma
 * de Next no deja los paquetes del monorepo resolubles desde fuera de ella.
 *
 *   node alta-empresa.js "20303051831" "RAZON S.A.C." correo@x.pe "Nombre" "clave"
 */
/*
 * Se importa del módulo y no de la barra de exportaciones: ésta reexporta todo
 * el paquete y trae de paso media aplicación.
 *
 * Aun así, la cadena acaba tocando `xml-crypto`, que es CommonJS. Por eso el
 * paquete se emite en formato CommonJS y no en ESM: el `require` dinámico que
 * usa ese módulo no tiene equivalente en un archivo ESM empaquetado.
 */
import { crearEmpresa } from "../packages/servicios/src/empresas.ts";

const [ruc, razonSocial, email, nombre, password] = process.argv.slice(2);
const url = process.env["DATABASE_URL"];

if (!url || !ruc || !razonSocial || !email || !nombre || !password) {
  console.error(
    "uso: node alta-empresa.js <ruc> <razón social> <correo> <nombre> <clave>\n" +
      "     (con DATABASE_URL en el entorno)",
  );
  process.exit(1);
}

// Sin `await` de nivel superior: el paquete se emite en CommonJS, que no lo
// admite.
crearEmpresa(url, { ruc, razonSocial }, { email, nombre, password })
  .then((e) => {
    console.log(
      `empresa creada\n  id:      ${e.empresaId}\n  usuario: ${email}\n` +
        `  cuentas sembradas: ${e.cuentasSembradas}`,
    );
    process.exit(0);
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
