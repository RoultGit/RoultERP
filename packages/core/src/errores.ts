/**
 * Raíz de los errores que una persona puede leer y corregir.
 *
 * Un error de negocio no es un fallo del programa. Describe algo que quien usa
 * el sistema hizo y puede arreglar —una factura sin líneas, un pago mayor que
 * la deuda, un periodo cerrado— y por eso su texto se muestra tal cual. Un
 * `TypeError`, una conexión caída o un índice único violado son otra cosa: van
 * al registro del servidor y el usuario ve una frase genérica, porque el
 * detalle no le sirve y puede filtrar datos de dentro.
 *
 * Tenerlos todos bajo una raíz común es lo que permite que la capa web los
 * traduzca con **una** comprobación en vez de enumerar treinta y cinco clases.
 * Antes, cada módulo repetía su propia función `mensaje()` con su propia lista,
 * y el módulo que nacía mañana empezaba por copiar la del vecino y olvidarse de
 * alguna: sus errores salían por la rama genérica y el usuario leía «revise los
 * datos» en vez de qué dato. Ahora un error nuevo se muestra bien sin tocar la
 * pantalla.
 */
export class ErrorDeNegocio extends Error {
  /**
   * Una entrada por cada cosa que hay que corregir. Nunca vacío.
   *
   * El formulario enseña la primera arriba y la lista entera debajo: quien
   * carga una factura con tres problemas prefiere verlos los tres que
   * descubrirlos de uno en uno.
   */
  readonly motivos: readonly string[];

  constructor(motivos: string | readonly string[], nombre: string) {
    const lista = typeof motivos === "string" ? [motivos] : motivos;
    super(lista.join("; "));
    this.name = nombre;
    this.motivos = lista;
  }
}
