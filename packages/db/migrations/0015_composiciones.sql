-- Composición de un producto: kits y conversión de unidades.
--
-- Los dos casos que Starsoft separa en el menú son el mismo problema: un
-- artículo que se convierte en otros sin comprar ni vender nada. Un saco de
-- 50 kg que pasa a 50 bolsas de 1 kg es un kit de un solo componente.

CREATE TABLE IF NOT EXISTS composiciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  producto_id    uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  tipo           text NOT NULL DEFAULT 'kit',
  componente_id  uuid NOT NULL REFERENCES productos(id),
  cantidad       numeric(18,6) NOT NULL,
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS composiciones_uk ON composiciones (producto_id, componente_id);
CREATE INDEX IF NOT EXISTS composiciones_producto_ix ON composiciones (empresa_id, producto_id);
