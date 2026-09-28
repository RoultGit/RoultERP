-- Formatos configurables de estados financieros.
--
-- El formato es la plantilla; los saldos siguen saliendo de los asientos. No se
-- puede configurar un estado que diga algo distinto de lo que dice el mayor:
-- sólo cómo se presenta.

CREATE TABLE IF NOT EXISTS formatos_eeff (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo            text NOT NULL,
  nombre            text NOT NULL,
  tipo              text NOT NULL,
  es_predeterminado boolean NOT NULL DEFAULT false,
  activo            boolean NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  creado_por        uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS formatos_eeff_uk ON formatos_eeff (empresa_id, codigo);
CREATE INDEX IF NOT EXISTS formatos_eeff_tipo_ix ON formatos_eeff (empresa_id, tipo);

CREATE TABLE IF NOT EXISTS formato_eeff_lineas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  formato_id     uuid NOT NULL REFERENCES formatos_eeff(id) ON DELETE CASCADE,
  orden          integer NOT NULL,
  codigo         text,
  concepto       text NOT NULL,
  clase          text NOT NULL DEFAULT 'detalle',
  nivel          integer NOT NULL DEFAULT 1,
  cuentas        text,
  signo          text NOT NULL DEFAULT 'deudor',
  suma           text,
  columna        text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS formato_eeff_lineas_uk ON formato_eeff_lineas (formato_id, orden);
