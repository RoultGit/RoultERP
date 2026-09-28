-- Planilla de cobranza: la hoja de ruta del cobrador.
--
-- Reúne los documentos que alguien sale a cobrar —o que se entregan al banco—,
-- se imprime, se firma al entregarla y se liquida al volver. No mueve dinero ni
-- contabilidad: eso lo sigue haciendo la cobranza. Lo que aporta es saber quién
-- tiene qué, que es lo que falta cuando una factura lleva tres semanas «en
-- gestión» y nadie sabe en manos de quién está.

CREATE TABLE IF NOT EXISTS planillas_cobranza (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero         text NOT NULL,
  fecha          date NOT NULL,
  -- 'cobrador' o 'banco'.
  tipo           text NOT NULL DEFAULT 'cobrador',
  -- A quién se le entrega: el nombre del cobrador o el del banco.
  responsable    text NOT NULL,
  moneda         text NOT NULL,
  importe        numeric(18,6) NOT NULL,
  -- abierta, cerrada, anulada.
  estado         text NOT NULL DEFAULT 'abierta',
  observaciones  text,
  entregada_por  uuid,
  cerrada_por    uuid,
  cerrada_en     timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS planillas_cobranza_uk
  ON planillas_cobranza (empresa_id, numero);
CREATE INDEX IF NOT EXISTS planillas_cobranza_estado_ix
  ON planillas_cobranza (empresa_id, estado);

-- Qué lleva la planilla. Un renglón es una factura o una letra, nunca las dos:
-- las dos formas en que un cliente puede deber, y el cobrador sale con ambas.
CREATE TABLE IF NOT EXISTS planilla_cobranza_documentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  planilla_id    uuid NOT NULL REFERENCES planillas_cobranza(id) ON DELETE CASCADE,
  comprobante_id uuid REFERENCES comprobantes(id),
  letra_id       uuid REFERENCES letras(id),
  importe        numeric(18,6) NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid,
  CONSTRAINT planilla_documento_uno CHECK (num_nonnulls(comprobante_id, letra_id) = 1)
);
-- Un documento no puede ir dos veces en la misma planilla. Van por separado
-- porque Postgres 14 no tiene NULLS NOT DISTINCT: con un índice sobre las dos
-- columnas, dos letras distintas —ambas con comprobante nulo— no colisionarían
-- pero dos veces la misma tampoco.
CREATE UNIQUE INDEX IF NOT EXISTS planilla_documentos_comprobante_uk
  ON planilla_cobranza_documentos (planilla_id, comprobante_id)
  WHERE comprobante_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS planilla_documentos_letra_uk
  ON planilla_cobranza_documentos (planilla_id, letra_id)
  WHERE letra_id IS NOT NULL;
