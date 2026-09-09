/** Token de sesión para probar la app con curl. Sólo desarrollo. */
import { conectar } from "@roulterp/db";
import { login } from "@roulterp/servicios";

async function main() {
  const auth = conectar({ url: process.env["DATABASE_URL"]!, rol: "auth", max: 1 });
  const kek = new Uint8Array(Buffer.from(process.env["ROULTERP_KEK"]!, "base64"));
  const r = await login(
    { auth, kek, kekId: "env-1" },
    { email: "admin@servidimar.pe", password: "roulterp-desarrollo-1", ip: "127.0.0.1" },
  );
  console.log(r.estado === "ok" ? r.token : "MFA");
  await auth.cliente.end();
}
main();
