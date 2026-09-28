-- Caja y bancos: recibos, cheques y entregas a rendir.
--
-- Los tres documentos que Starsoft tiene y aquí faltaban. El recibo es el papel
-- firmado que sustenta un movimiento de caja; el cheque es dinero comprometido
-- que el saldo del banco todavía no refleja; la entrega a rendir es un activo
-- (cuenta 14) hasta que alguien la justifica con documentos.

CREATE TABLE IF NOT EXISTS recibos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero             text NOT NULL,
  tipo               text NOT NULL,
  fecha              date NOT NULL,
  cuenta_id          uuid NOT NULL REFERENCES cuentas_efectivo(id),
  tercero_id         uuid REFERENCES terceros(id),
  a_nombre_de        text,
  concepto           text NOT NULL,
  importe            numeric(18,6) NOT NULL,
  moneda             text NOT NULL,
  importe_en_letras  text,
  movimiento_id      uuid,
  asiento_id         uuid,
  estado             text NOT NULL DEFAULT 'emitido',
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS recibos_uk ON recibos (empresa_id, numero);
CREATE INDEX IF NOT EXISTS recibos_fecha_ix ON recibos (empresa_id, fecha);

CREATE TABLE IF NOT EXISTS cheques (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta_id        uuid NOT NULL REFERENCES cuentas_efectivo(id),
  numero           text NOT NULL,
  fecha_giro       date NOT NULL,
  fecha_cobro      date,
  beneficiario_id  uuid REFERENCES terceros(id),
  beneficiario     text NOT NULL,
  importe          numeric(18,6) NOT NULL,
  moneda           text NOT NULL,
  estado           text NOT NULL DEFAULT 'girado',
  fecha_cobrado    date,
  pago_id          uuid,
  movimiento_id    uuid,
  observaciones    text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS cheques_uk ON cheques (empresa_id, cuenta_id, numero);
CREATE INDEX IF NOT EXISTS cheques_estado_ix ON cheques (empresa_id, estado);

CREATE TABLE IF NOT EXISTS entregas_rendir (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero           text NOT NULL,
  fecha            date NOT NULL,
  cuenta_id        uuid NOT NULL REFERENCES cuentas_efectivo(id),
  responsable_id   uuid,
  responsable      text NOT NULL,
  motivo           text NOT NULL,
  importe          numeric(18,6) NOT NULL,
  rendido          numeric(18,6) NOT NULL DEFAULT 0,
  devuelto         numeric(18,6) NOT NULL DEFAULT 0,
  moneda           text NOT NULL,
  centro_costo_id  uuid REFERENCES centros_costo(id),
  estado           text NOT NULL DEFAULT 'pendiente',
  movimiento_id    uuid,
  asiento_id       uuid,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS entregas_rendir_uk ON entregas_rendir (empresa_id, numero);
CREATE INDEX IF NOT EXISTS entregas_rendir_estado_ix ON entregas_rendir (empresa_id, estado);

CREATE TABLE IF NOT EXISTS rendicion_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  entrega_id       uuid NOT NULL REFERENCES entregas_rendir(id) ON DELETE CASCADE,
  fecha            date NOT NULL,
  tipo_documento   text,
  serie            text,
  numero           text,
  proveedor_id     uuid REFERENCES terceros(id),
  concepto         text NOT NULL,
  cuenta           text NOT NULL,
  centro_costo_id  uuid REFERENCES centros_costo(id),
  importe          numeric(18,6) NOT NULL,
  igv              numeric(18,6) NOT NULL DEFAULT 0,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid
);
CREATE INDEX IF NOT EXISTS rendicion_items_ix ON rendicion_items (entrega_id);
