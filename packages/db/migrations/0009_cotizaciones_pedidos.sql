-- Cotización y pedido de venta: el trabajo comercial anterior a la factura.
--
-- Es el flujo que el cliente usa en Starsoft: se cotiza, el cliente acepta, se
-- convierte en pedido y el almacén despacha contra él.

CREATE TABLE IF NOT EXISTS cotizaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero          text NOT NULL,
  cliente_id      uuid NOT NULL REFERENCES terceros(id),
  fecha           date NOT NULL,
  valida_hasta    date,
  moneda          text NOT NULL,
  tipo_cambio     numeric(18,6) NOT NULL DEFAULT 1,
  estado          text NOT NULL DEFAULT 'pendiente',
  condicion_pago  text,
  observaciones   text,
  gravadas        numeric(18,6) NOT NULL DEFAULT 0,
  igv             numeric(18,6) NOT NULL DEFAULT 0,
  total           numeric(18,6) NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS cotizaciones_uk ON cotizaciones (empresa_id, numero);
CREATE INDEX IF NOT EXISTS cotizaciones_cliente_ix ON cotizaciones (empresa_id, cliente_id);

CREATE TABLE IF NOT EXISTS cotizacion_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cotizacion_id   uuid NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  linea           integer NOT NULL,
  producto_id     uuid REFERENCES productos(id),
  codigo          text NOT NULL,
  descripcion     text NOT NULL,
  unidad          text NOT NULL,
  cantidad        numeric(18,6) NOT NULL,
  valor_unitario  numeric(18,6) NOT NULL,
  descuento       numeric(18,6) NOT NULL DEFAULT 0,
  afectacion_igv  text NOT NULL DEFAULT '10',
  importe_linea   numeric(18,6) NOT NULL DEFAULT 0,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS cotizacion_items_uk ON cotizacion_items (cotizacion_id, linea);

CREATE TABLE IF NOT EXISTS pedidos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero          text NOT NULL,
  cliente_id      uuid NOT NULL REFERENCES terceros(id),
  cotizacion_id   uuid REFERENCES cotizaciones(id),
  fecha           date NOT NULL,
  fecha_entrega   date,
  almacen_id      uuid REFERENCES almacenes(id),
  moneda          text NOT NULL,
  tipo_cambio     numeric(18,6) NOT NULL DEFAULT 1,
  estado          text NOT NULL DEFAULT 'pendiente',
  condicion_pago  text,
  observaciones   text,
  gravadas        numeric(18,6) NOT NULL DEFAULT 0,
  igv             numeric(18,6) NOT NULL DEFAULT 0,
  total           numeric(18,6) NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_uk ON pedidos (empresa_id, numero);
CREATE INDEX IF NOT EXISTS pedidos_cliente_ix ON pedidos (empresa_id, cliente_id);
CREATE INDEX IF NOT EXISTS pedidos_estado_ix ON pedidos (empresa_id, estado);

CREATE TABLE IF NOT EXISTS pedido_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  pedido_id         uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  linea             integer NOT NULL,
  producto_id       uuid REFERENCES productos(id),
  codigo            text NOT NULL,
  descripcion       text NOT NULL,
  unidad            text NOT NULL,
  cantidad          numeric(18,6) NOT NULL,
  cantidad_atendida numeric(18,6) NOT NULL DEFAULT 0,
  valor_unitario    numeric(18,6) NOT NULL,
  descuento         numeric(18,6) NOT NULL DEFAULT 0,
  afectacion_igv    text NOT NULL DEFAULT '10',
  importe_linea     numeric(18,6) NOT NULL DEFAULT 0,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  creado_por        uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS pedido_items_uk ON pedido_items (pedido_id, linea);

-- La venta recuerda qué pedido atendió.
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS pedido_id uuid REFERENCES pedidos(id);
