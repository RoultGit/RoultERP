/**
 * Da de alta una empresa vacía y escribe sus datos en JSON.
 *
 * Lo usan las pruebas de navegador, que corren en CommonJS y no pueden importar
 * `@roulterp/db` directamente: su cargador de migraciones usa `await` de nivel
 * superior. Aquí, bajo el `package.json` de la raíz, sí se puede.
 *
 *   npx tsx scripts/empresa-de-prueba.ts crear
 *   npx tsx scripts/empresa-de-prueba.ts borrar <correo>
 */
import postgres from "postgres";
import { crearEmpresa } from "@roulterp/servicios";

const URL = process.env["DATABASE_URL"] ?? "postgres://localhost/roulterp_dev";

/** RUC con dígito verificador válido; el alta lo comprueba. */
function rucValido(base: string): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = [...base].reduce((a, d, i) => a + Number(d) * pesos[i]!, 0);
  const r = 11 - (suma % 11);
  return base + (r === 10 ? 0 : r === 11 ? 1 : r);
}

const accion = process.argv[2] ?? "crear";

if (accion === "borrar") {
  /*
   * Purgar una empresa es un acto administrativo, no una operación del ERP.
   *
   * El libro es append-only y un trigger impide borrar líneas de asiento, que
   * es exactamente lo que se quiere para la contabilidad de un cliente: nadie
   * puede hacer desaparecer su historia. Eliminar una empresa entera —una
   * prueba que no cuajó, un cliente que se va— es otra cosa, y por eso se hace
   * desactivando los triggers dentro de la transacción y con permisos de
   * dueño. Dentro del producto no existe esta operación a propósito.
   */
  const correo = process.argv[3]!;
  const raw = postgres(URL, { max: 1, onnotice: () => {} });
  await raw.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM empresas WHERE id IN (
      SELECT ue.empresa_id FROM usuario_empresa ue
      JOIN usuarios u ON u.id = ue.usuario_id WHERE u.email = ${correo})`;
    await tx`DELETE FROM usuarios WHERE email = ${correo}`;
  });
  await raw.end();
  console.log(JSON.stringify({ borrada: correo }));
} else {
  const sufijo = Date.now().toString().slice(-7);
  const ruc = rucValido(`20${sufijo}${"0".repeat(8)}`.slice(0, 10));
  const correo = `prueba${sufijo}@nueva.pe`;
  const password = "prueba-empresa-nueva-2026";
  const e = await crearEmpresa(
    URL,
    { ruc, razonSocial: `EMPRESA DE PRUEBA ${sufijo} S.A.C.` },
    { email: correo, nombre: "Contadora de prueba", password },
  );
  console.log(JSON.stringify({ ...e, ruc, correo, password }));
}
