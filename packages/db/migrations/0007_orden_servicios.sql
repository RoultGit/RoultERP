-- Una orden de compra puede ser de un servicio.
--
-- La factura de compra ya admitía líneas sin producto de catálogo; la orden no,
-- y obligaba a inventar un producto para ordenar un agenciamiento de aduana o
-- un mantenimiento.

ALTER TABLE orden_compra_items ALTER COLUMN producto_id DROP NOT NULL;
