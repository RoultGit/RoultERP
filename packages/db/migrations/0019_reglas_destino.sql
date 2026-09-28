-- Reglas de destino: a qué función va cada gasto.
--
-- El PCGE registra los gastos por naturaleza en la clase 6; la vista funcional
-- —cuánto costó vender, cuánto administrar— vive en la clase 9. El paso de una
-- a otra es el asiento de destino, y estas reglas dicen cómo hacerlo.

CREATE TABLE IF NOT EXISTS reglas_destino (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta          text,
  centro_costo_id uuid REFERENCES centros_costo(id),
  cuenta_destino  text NOT NULL,
  activa          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE INDEX IF NOT EXISTS reglas_destino_ix ON reglas_destino (empresa_id, cuenta);

-- Una sola regla por combinación: dos que digan cosas distintas para el mismo
-- gasto harían que el destino dependiera del orden de las filas.
CREATE UNIQUE INDEX IF NOT EXISTS reglas_destino_uk
  ON reglas_destino (empresa_id, coalesce(cuenta, ''), centro_costo_id)
  WHERE centro_costo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reglas_destino_sin_centro_uk
  ON reglas_destino (empresa_id, coalesce(cuenta, ''))
  WHERE centro_costo_id IS NULL;
