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
    <header className="flex flex-wrap items-start justify-between gap-4 px-6 pb-4 pt-7">
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
      {/*
        * `shrink-0` sólo desde `sm`.
        *
        * Con él siempre puesto, el bloque de acciones conservaba su ancho de
        * contenido y sus propios botones no envolvían nunca: a 400 píxeles la
        * página entera se iba 200 píxeles a la derecha. Desde `sm` sigue sin
        * encogerse —es el título el que debe ceder, no los botones— y por
        * debajo cede y envuelve.
        */}
      {acciones && <div className="flex flex-wrap gap-2 sm:shrink-0">{acciones}</div>}
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
  /*
   * Sin recuadro de puntos.
   *
   * Era la única cosa que seguía pareciendo una tarjeta, y encima vacía: un
   * marco discontinuo de doce píxeles de alto rodeando una frase, flotando solo
   * en la página. Un hueco no necesita que lo enmarquen para que se vea que es
   * un hueco; con la tipografía apagada y aire alrededor se entiende igual y no
   * compite con el contenido de al lado.
   */
  return (
    <div className="px-6 py-10 text-center">
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

/**
 * El cuerpo de la pantalla, y el que manda el ritmo vertical.
 *
 * Con el mismo margen lateral que el encabezado, para que el título y la primera
 * tabla arranquen en la misma vertical.
 *
 * **Sin tope de ancho.** Lo tuvo: 1180 píxeles, con el argumento de que en un
 * monitor de 27 pulgadas una tabla se estira hasta que el ojo pierde la fila.
 * El argumento era razonable y la consecuencia no: en una ventana de 1680 había
 * 1428 píxeles disponibles y se usaban 1180, y ocho pantallas obligaban a
 * arrastrar la tabla en horizontal **teniendo espacio de sobra al lado**. En
 * `/contabilidad/registros` la tabla pedía 1429 y recibía 1130.
 *
 * Elegir entre «una tabla ancha cuesta de leer» y «la tabla no entra» no es
 * elegir: la segunda impide trabajar y la primera molesta. Los párrafos largos
 * se topan ellos, con `max-w-prose`, que es donde el tope sí hace falta.
 *
 * La separación entre bloques la pone aquí, no cada bloque por su cuenta.
 *
 * Antes cada pantalla elegía la suya y salían tres distintas —20, 16 y 12
 * píxeles— a veces en la misma página: `/cxc` alternaba 20 y 16 entre sus cuatro
 * bloques. Nadie lo decidió así; es lo que pasa cuando la separación se escribe
 * en el bloque y no en quien los ordena.
 *
 * `space-y-5` de Tailwind 4 se aplica con `:where()`, o sea con especificidad
 * cero. Eso lo convierte justo en lo que hace falta: un valor por omisión de 20
 * píxeles que cualquier bloque puede sobreescribir con su propio `mb-*` cuando
 * de verdad necesita otra cosa, y entonces se ve que es una excepción.
 */
export function Contenido({ children }: { children: React.ReactNode }) {
  return <div className="contenido space-y-5 px-6 pb-10">{children}</div>;
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

