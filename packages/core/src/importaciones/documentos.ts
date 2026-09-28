/**
 * Los documentos que sustentan una importación.
 *
 * SERVIDIMAR lleva hoy este control a mano sobre la orden de importación. El
 * registro no es el problema: el problema es el aviso. Nadie descubre que falta
 * el certificado de origen hasta que la agencia de aduanas lo pide, y en ese
 * momento el contenedor ya está en el puerto devengando almacenaje. Un cuadro
 * que diga «faltan dos» el día que se embarca cuesta lo que cuesta mirarlo.
 *
 * El catálogo vive aquí y no en base a propósito. Añadir un documento es una
 * línea en esta lista, sin migración y sin sembrar nada en las empresas que ya
 * existen; y una importación de hace dos años no arrastra filas de un documento
 * que entonces no se pedía.
 *
 * `exigible` es el valor de partida, no una regla: cada embarque puede marcar
 * un documento como no aplicable —un certificado de origen sin acuerdo
 * comercial, un permiso sanitario para mercadería que no lo necesita—. Dejarlo
 * en rojo para siempre acaba en que nadie mira el cuadro, que es peor que no
 * tenerlo.
 */
export type TipoDocumentoImportacion = {
  clave: string;
  nombre: string;
  /** Se pide en todas las importaciones salvo que el embarque diga lo contrario. */
  exigible: boolean;
  /**
   * Antes de qué hito hace falta. Es lo que convierte la lista en un aviso:
   * el packing list se necesita para numerar la DUA, no para embarcar.
   */
  antesDe: "embarque" | "llegada" | "numeracion" | "liquidacion";
  /** Por qué se pide. Sale en la pantalla como ayuda. */
  nota?: string;
};

export const DOCUMENTOS_IMPORTACION: readonly TipoDocumentoImportacion[] = [
  {
    clave: "factura_exterior",
    nombre: "Factura comercial del exterior",
    exigible: true,
    antesDe: "numeracion",
    nota: "Es el valor FOB que declara la aduana; sin ella no se numera la DUA.",
  },
  {
    clave: "conocimiento_embarque",
    nombre: "Conocimiento de embarque (B/L o guía aérea)",
    exigible: true,
    antesDe: "llegada",
    nota: "El original se endosa para retirar la mercadería del terminal.",
  },
  {
    clave: "packing_list",
    nombre: "Packing list",
    exigible: true,
    antesDe: "numeracion",
    nota: "Bultos, pesos y contenido. Es contra lo que se afora físicamente.",
  },
  {
    clave: "certificado_origen",
    nombre: "Certificado de origen",
    exigible: false,
    antesDe: "numeracion",
    nota: "Sólo con acuerdo comercial. Es lo que da la preferencia arancelaria.",
  },
  {
    clave: "poliza_seguro",
    nombre: "Póliza de seguro de transporte",
    exigible: false,
    antesDe: "llegada",
    nota: "Su prima entra al valor en aduana; sin póliza la aduana la presume.",
  },
  {
    clave: "dua",
    nombre: "DAM / DUA numerada",
    exigible: true,
    antesDe: "liquidacion",
    nota: "Fija el tipo de cambio y los derechos. Sin ella no hay costo final.",
  },
  {
    clave: "liquidacion_agencia",
    nombre: "Liquidación de la agencia de aduanas",
    exigible: true,
    antesDe: "liquidacion",
    nota: "Trae los gastos que faltan por prorratear al costo de la mercadería.",
  },
  {
    clave: "volante_despacho",
    nombre: "Volante de despacho del terminal",
    exigible: false,
    antesDe: "liquidacion",
    nota: "Acredita el retiro y suele traer el almacenaje cobrado.",
  },
  {
    clave: "permisos",
    nombre: "Permisos o certificaciones del sector",
    exigible: false,
    antesDe: "llegada",
    nota: "DIGESA, SENASA, MTC… según la mercadería. Se pide antes de aforar.",
  },
] as const;

const PORCLAVE = new Map(DOCUMENTOS_IMPORTACION.map((d) => [d.clave, d]));

export const tipoDocumentoImportacion = (
  clave: string,
): TipoDocumentoImportacion | undefined => PORCLAVE.get(clave);

/** Orden de los hitos. Sirve para decir qué falta *ya* y qué falta *aún*. */
export const HITOS = ["embarque", "llegada", "numeracion", "liquidacion"] as const;

/**
 * Qué estado tiene el expediente de una importación.
 *
 * `vencidos` son los que ya hacían falta: el embarque salió y no está el
 * conocimiento, la DUA se numeró y no está el packing list. Son los que cuestan
 * dinero. `pendientes` son los que harán falta más adelante y todavía no.
 *
 * El hito alcanzado lo decide quien llama, porque lo sabe el estado de la
 * importación y no este módulo.
 */
export function expediente(
  registrados: readonly { tipo: string; recibidoEn: string | null; noAplica: boolean }[],
  hitoAlcanzado: (typeof HITOS)[number],
): {
  recibidos: readonly string[];
  vencidos: readonly TipoDocumentoImportacion[];
  pendientes: readonly TipoDocumentoImportacion[];
  completo: boolean;
} {
  const porTipo = new Map(registrados.map((r) => [r.tipo, r]));
  const alcanzado = HITOS.indexOf(hitoAlcanzado);

  const recibidos: string[] = [];
  const vencidos: TipoDocumentoImportacion[] = [];
  const pendientes: TipoDocumentoImportacion[] = [];

  for (const doc of DOCUMENTOS_IMPORTACION) {
    const fila = porTipo.get(doc.clave);
    if (fila?.recibidoEn) {
      recibidos.push(doc.clave);
      continue;
    }
    // Lo que el embarque marcó como no aplicable no falta ni faltará.
    if (fila?.noAplica) continue;
    if (!doc.exigible && !fila) continue;
    (HITOS.indexOf(doc.antesDe) <= alcanzado ? vencidos : pendientes).push(doc);
  }

  return { recibidos, vencidos, pendientes, completo: vencidos.length === 0 };
}
