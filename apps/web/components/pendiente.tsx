import { Contenido, Encabezado } from "@/components/ui";

/**
 * Módulo contratado pero todavía no implementado.
 *
 * Se muestra en el menú y dice con precisión qué falta, en vez de esconderse.
 * Un módulo ausente que el cliente descubre buscándolo cuesta más confianza que
 * uno que declara su estado.
 */
export function Pendiente({
  titulo,
  descripcion,
  incluye,
}: {
  titulo: string;
  descripcion: string;
  incluye: string[];
}) {
  return (
    <>
      <Encabezado titulo={titulo} descripcion={descripcion} />
      <Contenido>
        <div
          className="max-w-2xl rounded-md border border-dashed p-6"
          style={{ borderColor: "var(--borde-fuerte)" }}
        >
          <p className="font-medium">En construcción</p>
          <p className="mt-1 text-sm" style={{ color: "var(--texto-suave)" }}>
            Este módulo está en el alcance contratado y aún no se ha implementado. Cubrirá:
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {incluye.map((i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: "var(--texto-suave)" }}>·</span>
                <span>{i}</span>
              </li>
            ))}
          </ul>
        </div>
      </Contenido>
    </>
  );
}
