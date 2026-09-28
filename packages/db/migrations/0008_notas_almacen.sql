-- Notas de almacén: los movimientos que no vienen de otro módulo.
--
-- Ingreso por donación, salida por merma o consumo, transferencia entre
-- almacenes y ajuste por inventario físico. Sin ellas el almacén sólo se mueve
-- al comprar o vender.

CREATE TABLE IF NOT EXISTS notas_almacen (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo                text NOT NULL,
  numero              text NOT NULL,
  fecha               date NOT NULL,
  almacen_id          uuid NOT NULL REFERENCES almacenes(id),
  almacen_destino_id  uuid REFERENCES almacenes(id),
  tipo_operacion      text NOT NULL,
  glosa               text NOT NULL,
  cuenta_contrapartida text,
  centro_costo_id     uuid REFERENCES centros_costo(id),
  tercero_id          uuid REFERENCES terceros(id),
  referencia          text,
  asiento_id          uuid,
  importe             numeric(18,6) NOT NULL DEFAULT 0,
  estado              text NOT NULL DEFAULT 'registrada',
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por          uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS notas_almacen_uk ON notas_almacen (empresa_id, tipo, numero);
CREATE INDEX IF NOT EXISTS notas_almacen_fecha_ix ON notas_almacen (empresa_id, fecha);

CREATE TABLE IF NOT EXISTS nota_almacen_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nota_id        uuid NOT NULL REFERENCES notas_almacen(id) ON DELETE CASCADE,
  linea          integer NOT NULL,
  producto_id    uuid NOT NULL REFERENCES productos(id),
  cantidad       numeric(18,6) NOT NULL,
  costo_unitario numeric(18,6),
  importe_linea  numeric(18,6) NOT NULL DEFAULT 0,
  lote           text,
  serie          text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS nota_almacen_items_uk ON nota_almacen_items (nota_id, linea);
