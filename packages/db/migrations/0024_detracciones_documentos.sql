-- Dos cosas que pidió el cliente al responder el cuestionario.

-- 1. La cuenta de detracciones del Banco de la Nación.
--
-- SERVIDIMAR tiene la suya —00-000-000000— y la necesita impresa en la factura:
-- el cliente deposita ahí el porcentaje detraído y sin el número no puede
-- hacerlo. La del proveedor es el otro lado de la misma operación: cuando
-- SERVIDIMAR compra un servicio sujeto a detracción, deposita en la cuenta de
-- él, y tenerla en el maestro evita buscarla en un correo cada vez.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cuenta_detracciones text;
ALTER TABLE terceros  ADD COLUMN IF NOT EXISTS cuenta_detracciones text;

-- 2. Qué documentos ha recibido cada importación.
--
-- Hoy se lleva a mano sobre la orden de importación. El problema de llevarlo a
-- mano no es el registro, es el aviso: nadie se entera de que falta el
-- certificado de origen hasta que la agencia lo pide y el contenedor ya está en
-- el puerto pagando almacenaje.
--
-- No hay catálogo en base a propósito. La lista de documentos exigibles la
-- define `core/importaciones` y la pantalla la cruza con estas filas: un
-- documento nuevo en la lista no necesita migración ni sembrar nada, y una
-- importación vieja no arrastra filas de algo que entonces no se pedía.
CREATE TABLE IF NOT EXISTS importacion_documentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  importacion_id  uuid NOT NULL REFERENCES importaciones(id) ON DELETE CASCADE,
  /** Clave del catálogo de `core/importaciones`. */
  tipo            text NOT NULL,
  /**
   * Fecha en que se recibió. NULL con la fila existiendo significa «se registró
   * y sigue pendiente»; lo normal es que la fila no exista hasta que llega.
   */
  recibido_en     date,
  /** Número del documento: el del B/L, el del certificado, el de la factura. */
  referencia      text,
  /**
   * Un documento marcado como no exigible para este embarque. Un certificado
   * de origen no se pide si no hay acuerdo comercial, y dejar la casilla en
   * rojo para siempre acabaría en que nadie mira el cuadro.
   */
  no_aplica       boolean NOT NULL DEFAULT false,
  observaciones   text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);

-- Un documento por tipo y por importación: dos filas del mismo tipo dejarían el
-- cuadro diciendo que el packing list llegó y no llegó a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS importacion_documentos_uk
  ON importacion_documentos (importacion_id, tipo);
CREATE INDEX IF NOT EXISTS importacion_documentos_ix
  ON importacion_documentos (empresa_id, importacion_id);
