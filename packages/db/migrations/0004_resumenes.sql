-- Resúmenes diarios de boletas (RC) y comunicaciones de baja (RA).
--
-- Comparten tabla porque comparten el ciclo de vida: se envían por sendSummary,
-- SUNAT devuelve un ticket y el resultado se recoge después.

CREATE TABLE IF NOT EXISTS resumenes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo                 text NOT NULL,
  identificador        text NOT NULL,
  fecha_referencia     date NOT NULL,
  fecha_emision        date NOT NULL,
  correlativo          integer NOT NULL,
  estado               text NOT NULL DEFAULT 'borrador',
  xml_firmado          text,
  hash_xml             text,
  ticket               text,
  cdr_base64           text,
  codigo_sunat         integer,
  mensaje_sunat        text,
  observaciones_sunat  text[],
  enviado_en           timestamptz,
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por           uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS resumenes_uk ON resumenes (empresa_id, identificador);
CREATE INDEX IF NOT EXISTS resumenes_estado_ix ON resumenes (empresa_id, estado);

CREATE TABLE IF NOT EXISTS resumen_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  resumen_id      uuid NOT NULL REFERENCES resumenes(id) ON DELETE CASCADE,
  comprobante_id  uuid REFERENCES comprobantes(id),
  linea           integer NOT NULL,
  estado_item     text NOT NULL DEFAULT '1',
  motivo          text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS resumen_items_uk ON resumen_items (resumen_id, linea);
