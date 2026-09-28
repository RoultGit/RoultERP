-- Guías de remisión electrónicas.
--
-- Van en su propia tabla porque no son comprobantes: no llevan importes ni
-- impuestos, viajan por la API REST de la GRE y su desenlace es un ticket.

CREATE TABLE IF NOT EXISTS guias_remision (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo_guia               text NOT NULL DEFAULT '09',
  serie                   text NOT NULL,
  numero                  text NOT NULL,
  fecha_emision           date NOT NULL,
  hora_emision            text,
  destinatario_id         uuid NOT NULL REFERENCES terceros(id),
  motivo                  text NOT NULL,
  descripcion_motivo      text NOT NULL,
  peso_bruto              numeric(18,6) NOT NULL,
  unidad_peso             text NOT NULL DEFAULT 'KGM',
  bultos                  integer,
  modo_transporte         text NOT NULL,
  fecha_traslado          date NOT NULL,
  partida_ubigeo          text NOT NULL,
  partida_direccion       text NOT NULL,
  partida_establecimiento text,
  llegada_ubigeo          text NOT NULL,
  llegada_direccion       text NOT NULL,
  llegada_establecimiento text,
  transportista_id        uuid REFERENCES terceros(id),
  registro_mtc            text,
  placa                   text,
  conductor_tipo_doc      text,
  conductor_num_doc       text,
  conductor_nombres       text,
  conductor_apellidos     text,
  conductor_licencia      text,
  comprobante_id          uuid REFERENCES comprobantes(id),
  almacen_id              uuid REFERENCES almacenes(id),
  observaciones           text,
  estado                  text NOT NULL DEFAULT 'borrador',
  xml_firmado             text,
  hash_xml                text,
  ticket                  text,
  cdr_base64              text,
  codigo_sunat            text,
  mensaje_sunat           text,
  enviado_en              timestamptz,
  creado_en               timestamptz NOT NULL DEFAULT now(),
  actualizado_en          timestamptz NOT NULL DEFAULT now(),
  creado_por              uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS guias_remision_uk
  ON guias_remision (empresa_id, tipo_guia, serie, numero);
CREATE INDEX IF NOT EXISTS guias_remision_estado_ix ON guias_remision (empresa_id, estado);

CREATE TABLE IF NOT EXISTS guia_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  guia_id        uuid NOT NULL REFERENCES guias_remision(id) ON DELETE CASCADE,
  linea          integer NOT NULL,
  producto_id    uuid REFERENCES productos(id),
  codigo         text NOT NULL,
  descripcion    text NOT NULL,
  unidad         text NOT NULL,
  cantidad       numeric(18,6) NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS guia_items_uk ON guia_items (guia_id, linea);

-- Credenciales de la API GRE: distintas de las SOL, se generan aparte.
ALTER TABLE credenciales_sunat ADD COLUMN IF NOT EXISTS gre_client_id text;
ALTER TABLE credenciales_sunat ADD COLUMN IF NOT EXISTS gre_client_secret_cifrado jsonb;
