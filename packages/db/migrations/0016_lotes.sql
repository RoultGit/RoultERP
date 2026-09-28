-- Lote de un producto: sólo lo que no se deduce del kardex.
--
-- El saldo de cada lote se deriva de los movimientos, igual que el del almacén:
-- un saldo guardado en dos sitios acaba siendo dos saldos distintos. Lo que sí
-- hay que declarar es cuándo se fabricó y cuándo vence.

CREATE TABLE IF NOT EXISTS lotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  producto_id        uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  codigo             text NOT NULL,
  fecha_fabricacion  date,
  fecha_vencimiento  date,
  observaciones      text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS lotes_uk ON lotes (producto_id, codigo);
CREATE INDEX IF NOT EXISTS lotes_vencimiento_ix ON lotes (empresa_id, fecha_vencimiento);

-- Buscar el saldo de un lote recorre sus movimientos: conviene el índice.
CREATE INDEX IF NOT EXISTS movimientos_lote_ix
  ON movimientos_inventario (empresa_id, producto_id, lote) WHERE lote IS NOT NULL;
CREATE INDEX IF NOT EXISTS movimientos_serie_ix
  ON movimientos_inventario (empresa_id, producto_id, serie) WHERE serie IS NOT NULL;
