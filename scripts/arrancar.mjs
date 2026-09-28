/**
 * Arranque del contenedor: migrar y después servir.
 *
 * Las migraciones corren aquí y no como un paso aparte del despliegue por una
 * razón práctica: en App Runner, en Lightsail o en una máquina suelta no hay
 * un «paso previo» donde colgarlas, y olvidarlas deja la aplicación hablando
 * con un esquema viejo. El error que produce eso —una columna que no existe—
 * aparece en la primera pantalla que la use, no al desplegar.
 *
 * Son idempotentes y llevan su propio registro de aplicadas, así que arrancar
 * dos contenedores a la vez no las corre dos veces.
 *
 * Si fallan, el proceso **no arranca**. Servir con el esquema a medias es peor
 * que no servir: la primera mitad de las pantallas funcionaría y la segunda
 * devolvería errores que nadie sabría interpretar.
 */
import { spawn } from "node:child_process";

const { migrar } = await import("./migraciones/dist/migrate.js");

try {
  // El módulo busca las migraciones en `../migrations` relativo a sí mismo, y
  // el Dockerfile las copia justo ahí: `migraciones/dist` y `migraciones/migrations`.
  await migrar(process.env.DATABASE_URL);
} catch (e) {
  console.error("no se pudo poner la base al día; el servidor no arranca:", e);
  process.exit(1);
}

// El servidor de la salida autónoma. Se lanza como hijo y se le reenvían las
// señales: sin esto, al detener el contenedor el proceso quedaría vivo hasta
// que lo matasen a la fuerza, cortando peticiones en curso.
const hijo = spawn("node", ["apps/web/server.js"], { stdio: "inherit" });
for (const senal of ["SIGTERM", "SIGINT"]) {
  process.on(senal, () => hijo.kill(senal));
}
hijo.on("exit", (codigo) => process.exit(codigo ?? 0));
