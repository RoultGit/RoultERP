/**
 * Piezas de interfaz compartidas.
 *
 * Se quedan en el mínimo a propósito. Un ERP se construye repitiendo la misma
 * pantalla —cabecera, filtros, tabla, totales— cincuenta veces; lo que hace
 * falta son cuatro piezas consistentes, no una librería de componentes.
 */
import Link from "next/link";
import type { Route } from "next";

export function Encabezado({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: React.ReactNode;
}) {
  /*
   * El título de pantalla, grande y con tracking cerrado.
   *
   * Ya no va sobre una banda blanca con borde inferior: se apoya directo sobre
   * el gris de la página, como el contenido. La banda separaba el título del
   * cuerpo con una raya y hacía que cada pantalla arrancara con dos cajas
   * apiladas antes del primer dato.
   */
  return (
    <header className="mx-auto flex max-w-[1180px] flex-wrap items-start justify-between gap-4 px-6 pb-4 pt-7">
      <div className="min-w-0">
        <h1 className="text-[clamp(24px,3.2vw,32px)] font-semibold leading-[1.1] tracking-[-0.035em]">
          {titulo}
        </h1>
        {descripcion && (
          <p className="mt-2 max-w-3xl text-[13.5px]" style={{ color: "var(--texto-suave)" }}>
            {descripcion}
          </p>
        )}
      </div>
      {acciones && <div className="flex shrink-0 flex-wrap gap-2">{acciones}</div>}
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
      className="border border-dashed px-6 py-12 text-center"
      style={{ borderColor: "var(--borde-fuerte)", borderRadius: "var(--radio-panel)" }}
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

/**
 * Estados de documento, con el tono que le corresponde a cada uno.
 *
 * Los estados llegan en masculino o en femenino según el documento —una guía
 * está «aceptada», un comprobante «aceptado»— y el tono es el mismo. Se listan
 * los dos géneros en vez de recortar la última letra: hay estados que no se
 * distinguen por ella y adivinar produciría el color equivocado, que en esta
 * pantalla es peor que no dar ninguno.
 */
const TONO_ESTADO: Record<string, "exito" | "alerta" | "peligro" | "neutro"> = {
  // Terminó bien.
  aceptado: "exito",
  aceptada: "exito",
  aceptado_con_observaciones: "exito",
  contabilizado: "exito",
  liquidada: "exito",
  atendido: "exito",
  atendida: "exito",
  pagado: "exito",
  pagada: "exito",
  cobrada: "exito",
  conciliado: "exito",
  activo: "exito",
  activa: "exito",

  // Todavía no terminó, o alguien tiene que hacer algo.
  borrador: "alerta",
  pendiente: "alerta",
  parcial: "alerta",
  firmado: "alerta",
  enviado: "alerta",
  enviada: "alerta",
  girada: "alerta",
  aceptada_letra: "alerta",
  en_cartera: "alerta",
  baja_solicitada: "alerta",
  registrado: "alerta",
  registrada: "alerta",

  // Terminó mal, o ya no vale.
  rechazado: "peligro",
  rechazada: "peligro",
  anulado: "peligro",
  anulada: "peligro",
  protestada: "peligro",
  vencido: "peligro",
  vencida: "peligro",

  // Cerrado sin más: ni bueno ni malo.
  dado_de_baja: "neutro",
  extornado: "neutro",
  renovada: "neutro",
  canjeado: "neutro",
  convertida: "neutro",
  cerrado: "neutro",
  descontada: "neutro",
};

export function EstadoDoc({ estado }: { estado: string }) {
  return (
    <Insignia tono={TONO_ESTADO[estado] ?? "neutro"}>{estado.replace(/_/g, " ")}</Insignia>
  );
}

/*
 * El cuerpo de la pantalla.
 *
 * Con el mismo ancho máximo y el mismo margen lateral que el encabezado, para
 * que el título y la primera tabla arranquen en la misma vertical. Sin el tope
 * de ancho, en un monitor de 27 pulgadas una tabla de seis columnas se estira
 * hasta que el ojo pierde la fila entre la primera celda y la última.
 */
export function Contenido({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1180px] px-6 pb-10">{children}</div>;
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
    <Link href={href as Route} className={`boton boton-${variante}`}>
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

