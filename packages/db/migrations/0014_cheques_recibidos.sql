-- Cheques recibidos de clientes: diferidos y rebotados.
--
-- La misma tabla sirve a las dos carteras porque el problema es idéntico: un
-- papel que vale dinero y todavía no se ha convertido en dinero. Lo que cambia
-- son los estados por los que pasa.

ALTER TABLE cheques ADD COLUMN IF NOT EXISTS cartera text NOT NULL DEFAULT 'emitido';
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS motivo_rechazo text;
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS cobranza_id uuid;
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS banco_girador text;

DROP INDEX IF EXISTS cheques_uk;
CREATE UNIQUE INDEX IF NOT EXISTS cheques_uk ON cheques (empresa_id, cartera, cuenta_id, numero);
DROP INDEX IF EXISTS cheques_estado_ix;
CREATE INDEX IF NOT EXISTS cheques_estado_ix ON cheques (empresa_id, cartera, estado);
