import { notFound } from "next/navigation";
import { cargarRecibo, enLetras, CajaInvalida } from "@roulterp/servicios";
import { money } from "@roulterp/core";
import { conEmpresa } from "@/lib/sesion";
import { Importe } from "@/components/ui";
import { Documento, Datos } from "@/components/documento";

export const metadata = { title: "Recibo de caja · RoultERP" };
export const dynamic = "force-dynamic";

/**
 * El recibo de caja, en forma de documento.
 *
 * Es la hoja que se firma al entregar o recibir el dinero, y la que queda en el
 * talonario: sin ella, un movimiento de caja chica es una anotación sin respaldo
 * y el arqueo no tiene contra qué cotejarse.
 */
export default async function ReciboImpreso({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const r = await conEmpresa(
    (db) =>
      cargarRecibo(db, id).catch((e) => {
        if (e instanceof CajaInvalida) return null;
        throw e;
      }),
    "caja_bancos:ver",
  );
  if (!r) notFound();

  const ingreso = r.tipo === "ingreso";
  // Lo guardado al emitir; si faltara, se calcula con el mismo texto que usan
  // los comprobantes, para no tener dos formas de decir el mismo importe.
  const guardadas = r.importeEnLetras ?? enLetras(money.dec(r.importe), r.moneda);
  const letras = guardadas.startsWith("SON ") ? guardadas : `SON ${guardadas}`;

  return (
    <Documento
      titulo={ingreso ? "Recibo de ingreso" : "Recibo de egreso"}
      numero={r.numero}
      fecha={r.fecha}
      volverA="/caja-bancos/recibos"
      volverTexto="Volver a recibos"
      firmas={ingreso ? ["Recibí conforme", "Entregué conforme"] : ["Entregué conforme", "Recibí conforme"]}
    >
      <Datos
        pares={[
          [ingreso ? "Recibido de" : "Entregado a", r.aNombreDe ?? r.tercero ?? "—"],
          ["Documento", <span className="cifra">{r.documentoTercero ?? "—"}</span>],
          ["Cuenta", `${r.cuenta} · ${r.cuentaContable}`],
          ["Moneda", r.moneda],
          ["Estado", r.estado],
        ]}
      />

      <section className="mt-4 space-y-3">
        <div>
          <p className="text-xs uppercase" style={{ color: "var(--texto-suave)" }}>Por concepto de</p>
          <p className="text-sm">{r.concepto}</p>
        </div>

        <div
          className="flex items-end justify-between gap-6 border-t pt-3"
          style={{ borderColor: "var(--borde)" }}
        >
          <p className="text-sm font-medium">{letras}</p>
          <p className="text-xl font-semibold">
            <Importe valor={r.importe} moneda={r.moneda} />
          </p>
        </div>
      </section>

      {r.estado === "anulado" && (
        <p className="mt-4 text-sm" style={{ color: "var(--peligro)" }}>
          Recibo anulado. La hoja se conserva porque el correlativo no puede saltarse, pero no
          respalda ningún movimiento.
        </p>
      )}
    </Documento>
  );
}
