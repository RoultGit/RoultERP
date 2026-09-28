-- Presupuesto por centro de costo y análisis presupuestal.
--
-- Lo que la empresa planea gastar e ingresar. No es contabilidad: no genera
-- asientos ni toca saldos. Su único trabajo es servir de vara de medir contra
-- lo que de verdad ocurrió.

CREATE TABLE IF NOT EXISTS presupuestos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo         text NOT NULL,
  nombre         text NOT NULL,
  ejercicio      integer NOT NULL,
  estado         text NOT NULL DEFAULT 'borrador',
  observaciones  text,
  aprobado_por   uuid,
  aprobado_en    timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS presupuestos_uk ON presupuestos (empresa_id, codigo);
CREATE INDEX IF NOT EXISTS presupuestos_ejercicio_ix ON presupuestos (empresa_id, ejercicio);

CREATE TABLE IF NOT EXISTS presupuesto_lineas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  presupuesto_id  uuid NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  centro_costo_id uuid REFERENCES centros_costo(id),
  cuenta          text NOT NULL,
  mes             integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  importe         numeric(18,6) NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
-- Un NULL no es igual a otro NULL: sin esto, una partida sin centro de costo
-- podría repetirse cuantas veces quisiera. `NULLS NOT DISTINCT` lo resolvería
-- en Postgres 15, pero aquí corremos sobre 14, así que van dos índices
-- parciales: uno para las partidas con centro y otro para las que no.
CREATE UNIQUE INDEX IF NOT EXISTS presupuesto_lineas_uk
  ON presupuesto_lineas (presupuesto_id, centro_costo_id, cuenta, mes)
  WHERE centro_costo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS presupuesto_lineas_sin_centro_uk
  ON presupuesto_lineas (presupuesto_id, cuenta, mes)
  WHERE centro_costo_id IS NULL;
CREATE INDEX IF NOT EXISTS presupuesto_lineas_ix ON presupuesto_lineas (empresa_id, presupuesto_id);
