-- Saldos de apertura: lo que se trae de Starsoft el día del cambio.
--
-- El cliente eligió la opción b del cuestionario: traer sólo los saldos del día
-- del cambio —deudas de clientes, deudas a proveedores y stock—, no el
-- histórico. Esta migración prepara lo único que hacía falta en base para
-- poder hacerlo sin romper nada.
--
-- **Las deudas de clientes tienen que vivir en `comprobantes`.** Ahí es donde
-- el sistema calcula el saldo por cobrar, y esa definición es única a
-- propósito: descuenta cobranzas, letras y notas de crédito en un solo sitio
-- para que ninguna pantalla pueda discrepar de otra. Una tabla aparte para los
-- saldos migrados obligaría a unirla en siete consultas, y la primera que
-- alguien escribiera mañana se olvidaría de hacerlo.
--
-- El problema de meterlos ahí es fiscal, no técnico: `comprobantes` alimenta el
-- registro de ventas, el PLE 14.1 y la liquidación del PDT, y esas facturas ya
-- se declararon en Starsoft. Declararlas otra vez sería pagar dos veces el IGV
-- de todo lo que quedó pendiente de cobro.
--
-- De ahí la marca. Es una bandera y no un estado nuevo porque el estado ya
-- significa otra cosa —dónde está el documento frente a SUNAT— y una factura
-- migrada no está en ningún punto de ese camino: nunca se envía.
ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS es_apertura boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN comprobantes.es_apertura IS
  'Saldo traído de otro sistema al migrar. Cuenta para la cartera y no para los libros: ya se declaró allá.';

-- Los libros filtran por este índice parcial, que es el camino que recorren
-- todas las consultas fiscales.
CREATE INDEX IF NOT EXISTS comprobantes_apertura_ix
  ON comprobantes (empresa_id, periodo) WHERE es_apertura;
