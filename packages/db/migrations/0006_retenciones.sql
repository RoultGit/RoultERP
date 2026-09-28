-- Comprobantes de retención (tipo 20) y de percepción (tipo 40).
--
-- No van en `comprobantes` porque no son ventas: no llevan base imponible ni
-- IGV, y su detalle son documentos ajenos sobre los que se retuvo o percibió.

CREATE TABLE IF NOT EXISTS comprobantes_retencion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo_documento      text NOT NULL,
  serie               text NOT NULL,
  numero              text NOT NULL,
  fecha_emision       date NOT NULL,
  hora_emision        text,
  tercero_id          uuid NOT NULL REFERENCES terceros(id),
  regimen             text NOT NULL,
  tasa                numeric(18,6) NOT NULL,
  importe_total       numeric(18,6) NOT NULL,
  importe_operacion   numeric(18,6) NOT NULL,
  observacion         text,
  estado              text NOT NULL DEFAULT 'borrador',
  xml_firmado         text,
  hash_xml            text,
  cdr_base64          text,
  codigo_sunat        integer,
  mensaje_sunat       text,
  observaciones_sunat text[],
  enviado_en          timestamptz,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por          uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS comprobantes_retencion_uk
  ON comprobantes_retencion (empresa_id, tipo_documento, serie, numero);
CREATE INDEX IF NOT EXISTS comprobantes_retencion_estado_ix
  ON comprobantes_retencion (empresa_id, estado);

CREATE TABLE IF NOT EXISTS retencion_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  retencion_id     uuid NOT NULL REFERENCES comprobantes_retencion(id) ON DELETE CASCADE,
  linea            integer NOT NULL,
  documento_cxp_id uuid REFERENCES documentos_cxp(id),
  comprobante_id   uuid REFERENCES comprobantes(id),
  pago_id          uuid REFERENCES pagos(id),
  cobranza_id      uuid,
  tipo_documento   text NOT NULL,
  serie            text NOT NULL,
  numero           text NOT NULL,
  fecha_documento  date NOT NULL,
  moneda           text NOT NULL,
  total_documento  numeric(18,6) NOT NULL,
  importe_pagado   numeric(18,6) NOT NULL,
  importe          numeric(18,6) NOT NULL,
  neto             numeric(18,6) NOT NULL,
  fecha            date NOT NULL,
  tipo_cambio      numeric(18,6),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS retencion_items_uk ON retencion_items (retencion_id, linea);
