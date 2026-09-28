-- El papel de cada renglón, para calcular ratios sobre el formato.
--
-- Hay cosas que el número de cuenta no dice: qué parte del pasivo es corriente
-- lo decide el contador al armar la plantilla. El papel es cómo se lo cuenta al
-- programa.

ALTER TABLE formato_eeff_lineas ADD COLUMN IF NOT EXISTS papel text;

-- Un papel no se puede repetir dentro del mismo formato: dos renglones que
-- dijeran ser «el activo corriente» harían que el ratio dependiera de cuál se
-- leyera primero.
CREATE UNIQUE INDEX IF NOT EXISTS formato_eeff_lineas_papel_uk
  ON formato_eeff_lineas (formato_id, papel) WHERE papel IS NOT NULL;
