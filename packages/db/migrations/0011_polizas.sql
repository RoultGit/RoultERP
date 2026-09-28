-- Póliza (DUA): la unidad con la que Starsoft organiza los gastos de una
-- nacionalización.
--
-- Una DUA ampara varias órdenes de importación, y los gastos que llegan
-- —agenciamiento, almacenaje, flete interno— son de la póliza entera. Sin esta
-- tabla había que cargárselos a un embarque cualquiera, que es inventar el
-- costo de los demás.

CREATE TABLE IF NOT EXISTS polizas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero            text NOT NULL,
  fecha             date NOT NULL,
  fecha_numeracion  date,
  aduana            text,
  regimen           text,
  agente_id         uuid REFERENCES terceros(id),
  tipo_cambio       numeric(18,6) NOT NULL,
  estado            text NOT NULL DEFAULT 'abierta',
  observaciones     text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  creado_por        uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS polizas_uk ON polizas (empresa_id, numero);
CREATE INDEX IF NOT EXISTS polizas_estado_ix ON polizas (empresa_id, estado);

ALTER TABLE importaciones ADD COLUMN IF NOT EXISTS poliza_id uuid REFERENCES polizas(id);
CREATE INDEX IF NOT EXISTS importaciones_poliza_ix ON importaciones (empresa_id, poliza_id);

-- Un gasto pertenece a un embarque o a una póliza, nunca a los dos.
ALTER TABLE importacion_gastos ALTER COLUMN importacion_id DROP NOT NULL;
ALTER TABLE importacion_gastos ADD COLUMN IF NOT EXISTS poliza_id uuid
  REFERENCES polizas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS importacion_gastos_poliza_ix ON importacion_gastos (poliza_id);

ALTER TABLE importacion_gastos DROP CONSTRAINT IF EXISTS importacion_gastos_dueno_ck;
ALTER TABLE importacion_gastos ADD CONSTRAINT importacion_gastos_dueno_ck
  CHECK ((importacion_id IS NOT NULL) <> (poliza_id IS NOT NULL));
