-- Control de reintentos del envío a SUNAT.
--
-- Emitir y enviar ya eran dos actos separados: el comprobante se numera, se
-- descarga el inventario y se asienta sin hablar con nadie, así que una caída
-- de SUNAT nunca impide facturar. Lo que faltaba era vaciar la cola sola.
--
-- SUNAT tarda lo que tarda —hasta un minuto en un mal día— y eso no está en
-- nuestras manos. Lo que sí está: que nadie se quede mirando una pantalla
-- mientras tanto, y que un documento que falla no se reintente para siempre
-- ni se quede olvidado en silencio.
ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS intentos_envio integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_error text,
  /*
   * Cuándo puede volver a intentarse. Con espera creciente: reintentar cada
   * segundo contra un servicio caído lo único que consigue es que SUNAT corte
   * por abuso y que el registro se llene de la misma línea mil veces.
   */
  ADD COLUMN IF NOT EXISTS reintentar_desde timestamptz;

COMMENT ON COLUMN comprobantes.intentos_envio IS
  'Envíos fallidos acumulados. A partir de cierto número deja de reintentarse solo y lo tiene que mirar una persona.';

-- El índice por el que pregunta la cola: sólo las filas que esperan turno.
CREATE INDEX IF NOT EXISTS comprobantes_cola_ix
  ON comprobantes (empresa_id, reintentar_desde)
  WHERE estado IN ('borrador', 'firmado', 'enviado');
