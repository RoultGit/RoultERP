-- Pagos de una letra, uno por cada vez que se amortiza.
--
-- Antes el pago de una letra sólo dejaba su asiento: no había dónde anotar con
-- qué cuenta se pagó, ni cuánto se retuvo, ni a qué movimiento de banco
-- corresponde. Sin esa fila tampoco se puede emitir el comprobante de retención
-- de una letra, que es lo que un agente de retención tiene que entregar.

CREATE TABLE IF NOT EXISTS letra_pagos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  letra_id            uuid NOT NULL REFERENCES letras(id) ON DELETE CASCADE,
  fecha               date NOT NULL,
  -- Lo que se amortiza de la letra, antes de la retención.
  importe             numeric(18,6) NOT NULL,
  retencion_monto     numeric(18,6) NOT NULL DEFAULT 0,
  -- Lo que sale del banco: el importe menos la retención.
  importe_neto        numeric(18,6) NOT NULL,
  moneda              text NOT NULL,
  tipo_cambio         numeric(18,6) NOT NULL DEFAULT 1,
  cuenta_efectivo_id  uuid REFERENCES cuentas_efectivo(id),
  referencia          text,
  asiento_id          uuid,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por          uuid
);
CREATE INDEX IF NOT EXISTS letra_pagos_ix ON letra_pagos (empresa_id, letra_id, fecha);

-- El comprobante de retención de una letra referencia las facturas que se
-- canjearon, igual que el de un pago referencia las que cancela.
ALTER TABLE retencion_items
  ADD COLUMN IF NOT EXISTS letra_pago_id uuid REFERENCES letra_pagos(id);
