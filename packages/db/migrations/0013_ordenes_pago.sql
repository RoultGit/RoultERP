-- Orden de pago: el documento con el que se autoriza un desembolso.
--
-- Separa a quien decide pagar de quien firma el cheque. Sin ella, la única
-- huella de por qué salió el dinero es que alguien lo sacó.

CREATE TABLE IF NOT EXISTS ordenes_pago (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero              text NOT NULL,
  fecha               date NOT NULL,
  fecha_programada    date,
  proveedor_id        uuid NOT NULL REFERENCES terceros(id),
  moneda              text NOT NULL,
  tipo_cambio         numeric(18,6) NOT NULL DEFAULT 1,
  importe             numeric(18,6) NOT NULL,
  medio_pago          text NOT NULL DEFAULT 'transferencia',
  cuenta_efectivo_id  uuid REFERENCES cuentas_efectivo(id),
  retener_igv         boolean NOT NULL DEFAULT false,
  estado              text NOT NULL DEFAULT 'pendiente',
  observaciones       text,
  solicitada_por      uuid,
  autorizada_por      uuid,
  autorizada_en       timestamptz,
  motivo_rechazo      text,
  pago_id             uuid,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por          uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS ordenes_pago_uk ON ordenes_pago (empresa_id, numero);
CREATE INDEX IF NOT EXISTS ordenes_pago_estado_ix ON ordenes_pago (empresa_id, estado);

CREATE TABLE IF NOT EXISTS orden_pago_documentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orden_id       uuid NOT NULL REFERENCES ordenes_pago(id) ON DELETE CASCADE,
  documento_id   uuid NOT NULL REFERENCES documentos_cxp(id),
  importe        numeric(18,6) NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS orden_pago_documentos_uk
  ON orden_pago_documentos (orden_id, documento_id);
