-- Cuentas de integración: qué cuenta usa cada operación automática.
--
-- Hasta aquí estaban escritas dentro del programa: la venta iba a la 70111, el
-- banco a la 1041, el cliente a la 1212. Son las del plan general, pero cada
-- contador arma su plan y muchos abren divisionarias propias; con las cuentas
-- fijas, adaptarse a una empresa exigía tocar el código.
--
-- La tabla guarda **sólo lo que la empresa cambió**. Lo que no está aquí usa el
-- valor de partida que declara el catálogo del programa, así que una empresa
-- nueva y una vieja se comportan igual sin necesidad de sembrar nada.

CREATE TABLE IF NOT EXISTS parametros_contables (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  -- Clave del catálogo: ventas_mercaderia, clientes, igv_ventas…
  clave          text NOT NULL,
  cuenta         text NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS parametros_contables_uk
  ON parametros_contables (empresa_id, clave);
