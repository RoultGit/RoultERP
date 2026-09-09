/**
 * Piezas de interfaz compartidas.
 *
 * Se quedan en el mínimo a propósito. Un ERP se construye repitiendo la misma
 * pantalla —cabecera, filtros, tabla, totales— cincuenta veces; lo que hace
 * falta son cuatro piezas consistentes, no una librería de componentes.
 */
import Link from "next/link";

export function Encabezado({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: React.ReactNode;
}) {
  return (
    <header
      className="flex items-start justify-between gap-4 border-b px-6 py-4"
      style={{ borderColor: "var(--borde)", background: "var(--superficie)" }}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{titulo}</h1>
        {descripcion && (
          <p className="mt-0.5 text-sm" style={{ color: "var(--texto-suave)" }}>
            {descripcion}
          </p>
        )}
      </div>
      {acciones && <div className="flex shrink-0 gap-2">{acciones}</div>}
    </header>
  );
}

export function Vacio({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border border-dashed px-6 py-12 text-center"
      style={{ borderColor: "var(--borde-fuerte)" }}
    >
      <p className="font-medium">{titulo}</p>
      {descripcion && (
        <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--texto-suave)" }}>
          {descripcion}
        </p>
      )}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}

/**
 * Formatea un importe que viene de la base como texto.
 *
 * Entra texto y sale texto: el valor nunca pasa por `number`, ni siquiera para
 * mostrarlo. `Intl.NumberFormat` acepta cadenas decimales justamente para esto,
 * y así un importe de trece dígitos se ve correcto en vez de redondeado.
 */
export function formatearImporte(valor: string | null | undefined, decimales = 2): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  try {
    return new Intl.NumberFormat("es-PE", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(valor as unknown as number);
  } catch {
    return valor;
  }
}

export function Importe({
  valor,
  decimales = 2,
  moneda,
}: {
  valor: string | null | undefined;
  decimales?: number;
  moneda?: string;
}) {
  const negativo = typeof valor === "string" && valor.trimStart().startsWith("-");
  return (
    <span className={`cifra${negativo ? " negativo" : ""}`}>
      {moneda && <span className="mr-1 opacity-60">{moneda === "PEN" ? "S/" : moneda}</span>}
      {formatearImporte(valor, decimales)}
    </span>
  );
}

const TONOS = {
  neutro: {},
  exito: { color: "var(--exito)", borderColor: "color-mix(in srgb, var(--exito) 35%, transparent)" },
  alerta: { color: "var(--alerta)", borderColor: "color-mix(in srgb, var(--alerta) 35%, transparent)" },
  peligro: { color: "var(--peligro)", borderColor: "color-mix(in srgb, var(--peligro) 35%, transparent)" },
} as const;

export function Insignia({
  children,
  tono = "neutro",
}: {
  children: React.ReactNode;
  tono?: keyof typeof TONOS;
}) {
  return (
    <span className="insignia" style={TONOS[tono]}>
      {children}
    </span>
  );
}

/** Estados de documento, con el tono que le corresponde a cada uno. */
export function EstadoDoc({ estado }: { estado: string }) {
  const tono =
    estado === "anulada" || estado === "anulado" || estado === "protestada"
      ? "peligro"
      : estado === "borrador" || estado === "pendiente"
        ? "alerta"
        : estado === "liquidada" || estado === "contabilizado" || estado === "pagado"
          ? "exito"
          : "neutro";
  return <Insignia tono={tono}>{estado.replace(/_/g, " ")}</Insignia>;
}

export function Contenido({ children }: { children: React.ReactNode }) {
  return <div className="p-6">{children}</div>;
}

export function BotonEnlace({
  href,
  children,
  variante = "primario",
}: {
  href: string;
  children: React.ReactNode;
  variante?: "primario" | "secundario";
}) {
  return (
    <Link href={href} className={`boton boton-${variante}`}>
      {children}
    </Link>
  );
}

/** Aviso de que el usuario no tiene permiso, sin filtrar por qué. */
export function SinPermiso() {
  return (
    <Contenido>
      <Vacio
        titulo="No tiene acceso a esta sección"
        descripcion="Si cree que debería tenerlo, pida a un administrador de su empresa que revise su rol."
      />
    </Contenido>
  );
}
