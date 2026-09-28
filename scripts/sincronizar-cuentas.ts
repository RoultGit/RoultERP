/**
 * Lleva a cada empresa lo que el programa añadió después de crearla: las
 * cuentas nuevas del PCGE y los formatos de estados financieros.
 *
 * Una empresa creada el mes pasado no tiene las cuentas que se añadieron al
 * plan esta semana, y lo descubre cuando un asiento se rechaza por «no está en
 * el plan de cuentas». La pantalla de maestros tiene el botón; esto es lo mismo
 * para todas las empresas de una base, que es lo que hace falta al desplegar.
 *
 *   DATABASE_URL=postgres://localhost/roulterp_dev npx tsx scripts/sincronizar-cuentas.ts
 */
import { conectar, enEmpresa } from "@roulterp/db";
import { sincronizarPlanCuentas, sincronizarFormatos } from "@roulterp/servicios";
import postgres from "postgres";

const URL = process.env["DATABASE_URL"]!;
const raw = postgres(URL, { max: 1, onnotice: () => {} });
const app = conectar({ url: URL, rol: "app", max: 2 });

const empresas = await raw<{ id: string; razon_social: string }[]>`SELECT id, razon_social FROM empresas`;
const [u] = await raw<{ id: string }[]>`SELECT id FROM usuarios LIMIT 1`;

for (const e of empresas) {
  const { agregadas, agregados, completados } = await enEmpresa(
    app,
    { empresaId: e.id, usuarioId: u!.id },
    async (db) => ({
      ...(await sincronizarPlanCuentas(db, e.id)),
      ...(await sincronizarFormatos(db, e.id, u!.id)),
    }),
  );
  const partes = [
    agregadas.length ? `${agregadas.length} cuentas (${agregadas.join(", ")})` : null,
    agregados.length ? `formatos ${agregados.join(", ")}` : null,
    completados.length ? `papeles ${completados.join(", ")}` : null,
  ].filter(Boolean);
  console.log(
    partes.length === 0 ? `${e.razon_social}: al día` : `${e.razon_social}: ${partes.join(" · ")}`,
  );
}

await raw.end();
await app.cliente.end();
