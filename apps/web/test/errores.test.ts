/**
 * La traducción de errores es la única puerta entre lo que falla dentro y lo
 * que lee la persona. Lo que se fija aquí son las dos reglas que la sostienen:
 * un error de negocio se muestra tal cual venga de donde venga, y lo que no se
 * reconoce **no sale**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ErrorDeNegocio } from "@roulterp/core";
import { ErrorSunat } from "@roulterp/core/cpe";
import { traducirError, NoAutorizado } from "../lib/errores";

const ctx = { contexto: "la prueba" };

test("un error de negocio del año que viene ya se muestra bien", () => {
  // La clase no está enumerada en ninguna parte: se reconoce por su raíz. Esto
  // es lo que hace que un módulo nuevo no tenga que tocar la capa web.
  class ModuloQueAunNoExiste extends ErrorDeNegocio {
    constructor(motivos: readonly string[]) {
      super(motivos, "ModuloQueAunNoExiste");
    }
  }
  const r = traducirError(
    new ModuloQueAunNoExiste(["falta el almacén", "la fecha está en un periodo cerrado"]),
    ctx,
  );
  assert.equal(r.error, "falta el almacén");
  assert.deepEqual(r.motivos, ["falta el almacén", "la fecha está en un periodo cerrado"]);
});

test("lo que no se reconoce no llega a la pantalla", () => {
  // Un fallo de Postgres lleva dentro nombres de tabla y trozos de consulta.
  const original = console.error;
  const registrado: unknown[] = [];
  console.error = (...a: unknown[]) => void registrado.push(a);
  try {
    const r = traducirError(new TypeError('null value in column "empresa_id"'), ctx);
    assert.ok(!r.error!.includes("empresa_id"), "no puede filtrar el detalle interno");
    assert.equal(r.motivos, undefined);
    assert.equal(registrado.length, 1, "pero sí queda en el registro del servidor");
  } finally {
    console.error = original;
  }
});

test("un índice único se traduce con la primera regla que case", () => {
  const r = traducirError(new Error('duplicate key value violates unique constraint "letras_uk"'), {
    contexto: "cuentas por pagar",
    choques: [
      [/letras_uk/, "Ya existe una letra con ese número."],
      [/pagos_uk|duplicate key/, "Ya existe un pago con ese número."],
    ],
  });
  // La regla específica va primero a propósito: el mensaje de Postgres contiene
  // «duplicate key» siempre, así que una regla genérica delante taparía a todas
  // las de detrás. Era el caso de compras y de cuentas por pagar.
  assert.equal(r.error, "Ya existe una letra con ese número.");
});

test("SUNAT: no contestar y rechazar son dos avisos distintos", () => {
  const caida = traducirError(new ErrorSunat(1033, "socket timeout", true), {
    contexto: "ventas",
    documento: "el comprobante",
  });
  assert.match(caida.error!, /quedó registrado/, "una caída se resuelve reintentando");

  const rechazo = traducirError(new ErrorSunat(2335, "el RUC no existe", false), {
    contexto: "ventas",
    documento: "el comprobante",
  });
  assert.match(rechazo.error!, /rechazó el comprobante con el error 2335/);
  assert.doesNotMatch(rechazo.error!, /reintente/, "un rechazo hay que corregirlo, no reintentarlo");
});

test("falta de permiso y error de validación no se confunden", () => {
  assert.equal(
    traducirError(new NoAutorizado("ventas:crear"), ctx).error,
    "No tiene permiso para esta operación.",
  );
  const zod = z.object({ ruc: z.string().length(11, "el RUC debe tener 11 dígitos") });
  const fallo = zod.safeParse({ ruc: "123" });
  const r = traducirError(fallo.error, ctx);
  assert.equal(r.error, "el RUC debe tener 11 dígitos");
  assert.equal(r.campo, "ruc", "la pantalla salta al campo que está mal");
});
