-- Lo que ocurre antes de la orden de compra.
--
-- Requisición del área → solicitud de cotización a varios proveedores →
-- registro de cada respuesta → cuadro comparativo → orden de compra. Es el
-- flujo del manual de Starsoft, y el que da trazabilidad a una compra.

CREATE TABLE IF NOT EXISTS requisiciones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero           text NOT NULL,
  tipo             text NOT NULL DEFAULT 'compra',
  fecha            date NOT NULL,
  fecha_requerida  date,
  area             text,
  solicitante_id   uuid,
  almacen_id       uuid REFERENCES almacenes(id),
  centro_costo_id  uuid REFERENCES centros_costo(id),
  estado           text NOT NULL DEFAULT 'pendiente',
  observaciones    text,
  aprobada_por     uuid,
  aprobada_en      timestamptz,
  motivo_rechazo   text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS requisiciones_uk ON requisiciones (empresa_id, numero);
CREATE INDEX IF NOT EXISTS requisiciones_estado_ix ON requisiciones (empresa_id, estado);

CREATE TABLE IF NOT EXISTS requisicion_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  requisicion_id    uuid NOT NULL REFERENCES requisiciones(id) ON DELETE CASCADE,
  linea             integer NOT NULL,
  producto_id       uuid REFERENCES productos(id),
  descripcion       text NOT NULL,
  unidad            text NOT NULL DEFAULT 'ZZ',
  cantidad          numeric(18,6) NOT NULL,
  cantidad_atendida numeric(18,6) NOT NULL DEFAULT 0,
  observaciones     text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  creado_por        uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS requisicion_items_uk ON requisicion_items (requisicion_id, linea);

CREATE TABLE IF NOT EXISTS solicitudes_cotizacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero          text NOT NULL,
  requisicion_id  uuid REFERENCES requisiciones(id),
  fecha           date NOT NULL,
  fecha_limite    date,
  estado          text NOT NULL DEFAULT 'abierta',
  observaciones   text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS solicitudes_cotizacion_uk ON solicitudes_cotizacion (empresa_id, numero);

CREATE TABLE IF NOT EXISTS solicitud_cotizacion_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  solicitud_id    uuid NOT NULL REFERENCES solicitudes_cotizacion(id) ON DELETE CASCADE,
  linea           integer NOT NULL,
  producto_id     uuid REFERENCES productos(id),
  descripcion     text NOT NULL,
  unidad          text NOT NULL DEFAULT 'ZZ',
  cantidad        numeric(18,6) NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS solicitud_cotizacion_items_uk
  ON solicitud_cotizacion_items (solicitud_id, linea);

CREATE TABLE IF NOT EXISTS cotizaciones_proveedor (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero                text NOT NULL,
  solicitud_id          uuid NOT NULL REFERENCES solicitudes_cotizacion(id) ON DELETE CASCADE,
  proveedor_id          uuid NOT NULL REFERENCES terceros(id),
  referencia_proveedor  text,
  fecha                 date NOT NULL,
  valida_hasta          date,
  moneda                text NOT NULL,
  tipo_cambio           numeric(18,6) NOT NULL DEFAULT 1,
  condicion_pago        text,
  plazo_entrega_dias    integer,
  estado                text NOT NULL DEFAULT 'registrada',
  observaciones         text,
  subtotal              numeric(18,6) NOT NULL DEFAULT 0,
  igv                   numeric(18,6) NOT NULL DEFAULT 0,
  total                 numeric(18,6) NOT NULL DEFAULT 0,
  orden_compra_id       uuid,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por            uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS cotizaciones_proveedor_uk
  ON cotizaciones_proveedor (empresa_id, numero);
CREATE INDEX IF NOT EXISTS cotizaciones_proveedor_solicitud_ix
  ON cotizaciones_proveedor (empresa_id, solicitud_id);

CREATE TABLE IF NOT EXISTS cotizacion_proveedor_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cotizacion_id      uuid NOT NULL REFERENCES cotizaciones_proveedor(id) ON DELETE CASCADE,
  solicitud_item_id  uuid REFERENCES solicitud_cotizacion_items(id),
  linea              integer NOT NULL,
  producto_id        uuid REFERENCES productos(id),
  descripcion        text NOT NULL,
  unidad             text NOT NULL DEFAULT 'ZZ',
  cantidad           numeric(18,6) NOT NULL,
  valor_unitario     numeric(18,6) NOT NULL,
  descuento          numeric(18,6) NOT NULL DEFAULT 0,
  afectacion_igv     text NOT NULL DEFAULT '10',
  importe_linea      numeric(18,6) NOT NULL DEFAULT 0,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS cotizacion_proveedor_items_uk
  ON cotizacion_proveedor_items (cotizacion_id, linea);

-- La orden de compra recuerda de dónde salió.
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS requisicion_id uuid REFERENCES requisiciones(id);
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS cotizacion_proveedor_id uuid
  REFERENCES cotizaciones_proveedor(id);
