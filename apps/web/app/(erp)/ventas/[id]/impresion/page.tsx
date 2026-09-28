import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { cargarComprobante, enLetras, VentaInvalida } from "@roulterp/servicios";
import { money, cpe } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Importe } from "@/components/ui";
import { Imprimir } from "@/components/imprimir";

export const metadata = { title: "Representación impresa · RoultERP" };
export const dynamic = "force-dynamic";

const DOCUMENTO: Record<string, string> = {
  "01": "FACTURA ELECTRÓNICA",
  "03": "BOLETA DE VENTA ELECTRÓNICA",
  "07": "NOTA DE CRÉDITO ELECTRÓNICA",
  "08": "NOTA DE DÉBITO ELECTRÓNICA",
};

const TIPO_DOC_CLIENTE: Record<string, string> = {
  "0": "Doc. del país", "1": "DNI", "4": "Carnet de extranjería", "6": "RUC",
  "7": "Pasaporte", "A": "Céd. diplomática",
};

/**
 * Representación impresa del comprobante electrónico.
 *
 * El comprobante es el XML; esto es lo que se le entrega al cliente. La norma
 * fija lo que tiene que llevar —emisor, adquirente, detalle, total en letras,
 * resumen del XML y código QR— y por eso la hoja se arma aquí y no se deja al
 * gusto de cada quien.
 *
 * El QR se dibuja en la propia página: una imagen traída de fuera dejaría la
 * hoja sin código el día que no haya red, que es justo cuando se imprime.
 */
export default async function Impresion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const datos = await conEmpresa(async (db) => {
    const doc = await cargarComprobante(db, id).catch((e) => {
      if (e instanceof VentaInvalida) return null;
      throw e;
    });
    if (!doc) return null;

    const [empresa] = (await db.execute(sql`
      SELECT razon_social, nombre_comercial, ruc, direccion, cuenta_detracciones
        FROM empresas`)) as unknown as [
      {
        razon_social: string;
        nombre_comercial: string | null;
        ruc: string;
        direccion: string | null;
        cuenta_detracciones: string | null;
      },
    ];

    // El documento que una nota modifica: la hoja tiene que decir a qué se
    // refiere, o el cliente recibe una nota de crédito huérfana.
    const original = doc.cabecera.modificaA
      ? ((await db.execute(sql`
          SELECT tipo_documento, serie, numero, fecha_emision::text AS fecha
          FROM comprobantes WHERE id = ${doc.cabecera.modificaA}`)) as unknown as [
          { tipo_documento: string; serie: string; numero: string; fecha: string } | undefined,
        ])[0]
      : undefined;

    return { ...doc, empresa, original };
  }, "ventas:ver");

  if (!datos) notFound();
  const { cabecera, items, cliente, empresa, original } = datos;

  /*
   * El SVG se inyecta como HTML, así que conviene decir por qué es seguro: lo
   * produce el generador de QR a partir de cifras y documentos —nunca de texto
   * libre del usuario—, y su salida son trazos, no el texto de entrada. Aun así
   * se comprueba que sea un SVG antes de ponerlo en la hoja.
   */
  const qrCrudo = await cpe.qrSvg(
    cpe.contenidoQr({
      rucEmisor: empresa?.ruc ?? "",
      tipoComprobante: cabecera.tipoDocumento,
      serie: cabecera.serie,
      numero: cabecera.numero,
      igv: money.toString(money.dec(cabecera.igv), 2),
      total: money.toString(money.dec(cabecera.total), 2),
      fechaEmision: cabecera.fechaEmision,
      tipoDocAdquirente: cliente?.tipoDocumento ?? "0",
      numeroDocAdquirente: cliente?.numeroDocumento ?? "",
      hash: cabecera.hashXml,
    }),
  );
  const qr = qrCrudo.startsWith("<svg") ? qrCrudo : "";

  /*
   * El importe en letras es el que se guardó al emitir, que es el mismo que
   * viaja dentro del XML. Recalcularlo aquí podría dar una hoja que dijera una
   * cosa y un archivo que dijera otra sobre el mismo comprobante.
   *
   * El «SON» es de la hoja: en el XML va sin él.
   */
  const guardadas = cabecera.totalEnLetras ?? enLetras(money.dec(cabecera.total), cabecera.moneda);
  const letras = guardadas.startsWith("SON ") ? guardadas : `SON ${guardadas}`;

  const lineas: [string, string][] = [
    ["Op. gravadas", cabecera.gravadas],
    ["Op. exoneradas", cabecera.exoneradas],
    ["Op. inafectas", cabecera.inafectas],
    ["Op. de exportación", cabecera.exportacion],
    ["ISC", cabecera.isc],
    ["IGV (18 %)", cabecera.igv],
    ["Otros cargos", cabecera.otrosCargos],
  ];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="no-imprimir mb-5 flex justify-end gap-2">
        <Imprimir />
        <Link href={`/ventas/${id}` as Route} className="boton boton-secundario">
          Volver al comprobante
        </Link>
      </div>

      <header
        className="flex items-start justify-between gap-6 border-b pb-4"
        style={{ borderColor: "var(--borde-fuerte)" }}
      >
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{empresa?.razon_social}</h1>
          {empresa?.nombre_comercial && (
            <p className="text-sm" style={{ color: "var(--texto-suave)" }}>
              {empresa.nombre_comercial}
            </p>
          )}
          {empresa?.direccion && <p className="text-sm">{empresa.direccion}</p>}
        </div>
        <div
          className="shrink-0 border px-4 py-2 text-center"
          style={{ borderColor: "var(--borde-fuerte)" }}
        >
          <p className="cifra text-sm font-medium" style={{ textAlign: "center" }}>
            RUC {empresa?.ruc}
          </p>
          <p className="mt-1 text-sm font-semibold uppercase">
            {DOCUMENTO[cabecera.tipoDocumento] ?? "COMPROBANTE ELECTRÓNICO"}
          </p>
          <p className="cifra text-base font-medium" style={{ textAlign: "center" }}>
            {cabecera.serie}-{cabecera.numero}
          </p>
        </div>
      </header>

      <section className="grid gap-x-6 gap-y-1 border-b py-3 text-sm sm:grid-cols-2" style={{ borderColor: "var(--borde)" }}>
        <p>
          <span style={{ color: "var(--texto-suave)" }}>Señor(es): </span>
          {cliente?.razonSocial}
        </p>
        <p>
          <span style={{ color: "var(--texto-suave)" }}>
            {TIPO_DOC_CLIENTE[cliente?.tipoDocumento ?? "0"] ?? "Documento"}:{" "}
          </span>
          <span className="cifra">{cliente?.numeroDocumento}</span>
        </p>
        {cliente?.direccion && (
          <p className="sm:col-span-2">
            <span style={{ color: "var(--texto-suave)" }}>Dirección: </span>
            {cliente.direccion}
          </p>
        )}
        <p>
          <span style={{ color: "var(--texto-suave)" }}>Fecha de emisión: </span>
          <span className="cifra">{cabecera.fechaEmision}</span>
        </p>
        {cabecera.fechaVencimiento && (
          <p>
            <span style={{ color: "var(--texto-suave)" }}>Vencimiento: </span>
            <span className="cifra">{cabecera.fechaVencimiento}</span>
          </p>
        )}
        <p>
          <span style={{ color: "var(--texto-suave)" }}>Moneda: </span>
          {cabecera.moneda}
        </p>
        {cabecera.moneda !== "PEN" && (
          <p>
            <span style={{ color: "var(--texto-suave)" }}>Tipo de cambio: </span>
            <span className="cifra">{money.toString(money.dec(cabecera.tipoCambio), 3)}</span>
          </p>
        )}
        {original && (
          <p className="sm:col-span-2">
            <span style={{ color: "var(--texto-suave)" }}>Modifica al comprobante: </span>
            <span className="cifra">
              {original.serie}-{original.numero}
            </span>{" "}
            del {original.fecha}
            {cabecera.descripcionMotivo ? ` · ${cabecera.descripcionMotivo}` : ""}
          </p>
        )}
      </section>

      <table className="tabla mt-3">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th className="text-right">Cant.</th>
            <th>Unidad</th>
            <th>Descripción</th>
            <th className="text-right">V. unitario</th>
            <th className="text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="cifra" style={{ textAlign: "left" }}>{i.linea}</td>
              <td><Importe valor={i.cantidad} /></td>
              <td>{i.unidad}</td>
              <td>{i.descripcion}</td>
              <td><Importe valor={i.valorUnitario} decimales={4} /></td>
              <td><Importe valor={i.valorVenta} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-3 flex flex-wrap justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          {lineas
            .filter(([, v]) => !money.isZero(money.dec(v)))
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt style={{ color: "var(--texto-suave)" }}>{k}</dt>
                <dd><Importe valor={v} /></dd>
              </div>
            ))}
          <div
            className="flex justify-between gap-4 border-t pt-1 font-semibold"
            style={{ borderColor: "var(--borde)" }}
          >
            <dt>Importe total</dt>
            <dd><Importe valor={cabecera.total} moneda={cabecera.moneda} /></dd>
          </div>
        </dl>
      </section>

      <p className="mt-3 text-sm font-medium">{letras}</p>

      {/*
        El número de la cuenta de detracciones va en la hoja, no en un correo
        aparte: sin él el cliente no puede depositar el importe detraído, y la
        factura vuelve con la pregunta. Es la cuenta del Banco de la Nación de la
        empresa, y se mantiene en los datos de la empresa.
      */}
      {!money.isZero(money.dec(cabecera.detraccionMonto)) && (
        <div className="mt-2 text-sm">
          <p>
            Operación sujeta al Sistema de Pago de Obligaciones Tributarias.{" "}
            <span className="cifra">
              {money.toString(money.dec(cabecera.detraccionTasa ?? "0"), 2)} %
            </span>{" "}
            · <Importe valor={cabecera.detraccionMonto} />
          </p>
          {empresa?.cuenta_detracciones && (
            <p>
              Depositar en la cuenta de detracciones del Banco de la Nación{" "}
              <span className="cifra font-medium">{empresa.cuenta_detracciones}</span>.
            </p>
          )}
        </div>
      )}

      <footer
        className="mt-6 flex flex-wrap items-start justify-between gap-6 border-t pt-4"
        style={{ borderColor: "var(--borde)" }}
      >
        <div className="max-w-md text-xs" style={{ color: "var(--texto-suave)" }}>
          <p>
            Representación impresa del comprobante de pago electrónico. Consulte su validez en el
            portal de SUNAT.
          </p>
          {cabecera.hashXml && (
            <p className="cifra mt-1 break-all" style={{ textAlign: "left" }}>
              Resumen: {cabecera.hashXml}
            </p>
          )}
          {!cabecera.hashXml && (
            <p className="mt-1" style={{ color: "var(--alerta)" }}>
              Este comprobante todavía no está firmado: la hoja sale sin resumen y sin valor
              tributario hasta que se emita.
            </p>
          )}
        </div>
        {/* El QR va dibujado en la hoja, no traído de la red: se imprime también
            el día que no haya conexión, que es cuando hace falta. */}
        <div
          className="h-32 w-32 shrink-0"
          aria-label="Código QR del comprobante"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
      </footer>
    </div>
  );
}
