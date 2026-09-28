-- Planillas y recursos humanos.
--
-- Lo pidió el cliente al responder el cuestionario: planillas quincenales, CTS,
-- gratificaciones, y que dar de baja a un trabajador genere su liquidación de
-- beneficios sociales. Con dos añadidos suyos: aviso de vencimiento de contratos
-- e historial de remuneraciones.
--
-- La decisión que ordena todo esto: **la gratificación, la CTS y la liquidación
-- son planillas, no tablas aparte**. Las tres hacen lo mismo —tomar unos
-- trabajadores, calcular conceptos, dejar un asiento y un pago— y separarlas
-- habría duplicado la cabecera, el detalle, el cierre, el extorno, la
-- contabilización y las pantallas por cuatro. Lo que cambia es el tipo y qué
-- conceptos se calculan.

-- ─── Trabajadores ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trabajadores (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  /* Catálogo 06 de SUNAT, igual que en terceros: 1 DNI, 4 CE, 7 pasaporte. */
  tipo_documento     text NOT NULL DEFAULT '1',
  numero_documento   text NOT NULL,
  apellido_paterno   text NOT NULL,
  apellido_materno   text,
  nombres            text NOT NULL,
  fecha_nacimiento   date,
  sexo               text,
  nacionalidad       text NOT NULL DEFAULT 'PE',
  email              text,
  telefono           text,
  direccion          text,
  /* Situación: activo o cesado. Un cesado no entra en la planilla del mes. */
  situacion          text NOT NULL DEFAULT 'activo',
  fecha_ingreso      date NOT NULL,
  fecha_cese         date,
  motivo_cese        text,
  cargo              text,
  area               text,
  centro_costo_id    uuid REFERENCES centros_costo(id),
  /* onp, afp o ninguno. */
  regimen_pension    text NOT NULL DEFAULT 'onp',
  afp_codigo         text,
  /* flujo o mixta. Con mixta no hay comisión sobre la remuneración. */
  afp_comision       text,
  /* Código único del afiliado al SPP. Va en la PLAME. */
  cuspp              text,
  /* Da derecho a asignación familiar: hijos menores de 18, o hasta 24 estudiando. */
  tiene_hijos        boolean NOT NULL DEFAULT false,
  afiliado_eps       boolean NOT NULL DEFAULT false,
  /* Cuenta interbancaria donde se abona el sueldo. */
  cci                text,
  banco              text,
  /* Cuenta y banco del depósito semestral de CTS; son distintos del sueldo. */
  cts_banco          text,
  cts_cuenta         text,
  observaciones      text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS trabajadores_uk
  ON trabajadores (empresa_id, tipo_documento, numero_documento);
CREATE INDEX IF NOT EXISTS trabajadores_situacion_ix ON trabajadores (empresa_id, situacion);

-- ─── Contratos ────────────────────────────────────────────────────────────
--
-- Se separan del trabajador porque tienen historia y porque el cliente pidió
-- avisos de vencimiento: un contrato a plazo fijo que vence sin renovar
-- convierte la relación en indeterminada por ley, y eso se descubre tarde.

CREATE TABLE IF NOT EXISTS contratos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  trabajador_id   uuid NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  /* indeterminado, plazo_fijo, parcial, practicas. */
  tipo            text NOT NULL,
  /* Modalidad del plazo fijo: por inicio de actividad, por necesidad de mercado… */
  modalidad       text,
  fecha_inicio    date NOT NULL,
  /* NULL en el indeterminado. Es la fecha que dispara el aviso. */
  fecha_fin       date,
  cargo           text,
  /* Horas semanales. Menos de 24 es jornada parcial y cambia los beneficios. */
  jornada_horas   numeric(5,2),
  /* vigente, renovado, vencido, terminado. */
  estado          text NOT NULL DEFAULT 'vigente',
  /* El contrato que renueva a éste, cuando lo hay. */
  renueva_a       uuid REFERENCES contratos(id),
  observaciones   text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE INDEX IF NOT EXISTS contratos_trabajador_ix ON contratos (trabajador_id, fecha_inicio DESC);
CREATE INDEX IF NOT EXISTS contratos_vencimiento_ix
  ON contratos (empresa_id, fecha_fin) WHERE estado = 'vigente' AND fecha_fin IS NOT NULL;

-- ─── Historial de remuneraciones ──────────────────────────────────────────
--
-- Una fila por cambio de sueldo, con su fecha. El sueldo vigente es la fila más
-- reciente que no sea posterior a la fecha que se pregunte.
--
-- No se guarda el «monto anterior»: es el de la fila de antes. Guardarlo
-- permitiría que las dos cifras se contradijeran, y entonces habría que decidir
-- cuál creer.

CREATE TABLE IF NOT EXISTS remuneraciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  trabajador_id   uuid NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  vigente_desde   date NOT NULL,
  basico          numeric(18,6) NOT NULL,
  /* Aumento, promoción, ajuste por ley, reingreso… */
  motivo          text,
  observaciones   text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
-- Un solo sueldo por fecha: dos filas del mismo día dejarían el vigente al azar.
CREATE UNIQUE INDEX IF NOT EXISTS remuneraciones_uk
  ON remuneraciones (trabajador_id, vigente_desde);

-- ─── Catálogo de conceptos ────────────────────────────────────────────────
--
-- Sólo lo que la empresa cambió o añadió. El catálogo del programa
-- (`core/planilla/conceptos`) es el valor de partida, igual que con el plan de
-- cuentas y las cuentas de integración: así una empresa creada hoy y una de hace
-- un año se comportan igual sin sembrar nada.

CREATE TABLE IF NOT EXISTS conceptos_planilla (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo          text NOT NULL,
  nombre          text NOT NULL,
  /* ingreso, descuento o aporte. */
  tipo            text NOT NULL,
  /* fijo, manual, porcentaje o legal. */
  calculo         text NOT NULL,
  remunerativo    boolean NOT NULL DEFAULT false,
  afecta_quinta   boolean NOT NULL DEFAULT false,
  computable_cts  boolean NOT NULL DEFAULT false,
  tasa            numeric(18,6),
  regla           text,
  cuenta          text,
  orden           integer NOT NULL DEFAULT 500,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS conceptos_planilla_uk ON conceptos_planilla (empresa_id, codigo);

-- Conceptos fijos de un trabajador: una bonificación permanente, el descuento
-- mensual de un préstamo. Con vigencia, para que dejen de aplicarse solos.
CREATE TABLE IF NOT EXISTS trabajador_conceptos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  trabajador_id   uuid NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  codigo          text NOT NULL,
  importe         numeric(18,6) NOT NULL,
  vigente_desde   date NOT NULL,
  vigente_hasta   date,
  observaciones   text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE INDEX IF NOT EXISTS trabajador_conceptos_ix ON trabajador_conceptos (trabajador_id, codigo);

-- ─── Parámetros laborales de la empresa ───────────────────────────────────
--
-- Las excepciones a los valores de la ley que trae el programa. Con vigencia,
-- porque reabrir un mes viejo tiene que dar las mismas cifras que dio entonces:
-- recalcular diciembre con la UIT de enero cambiaría una quinta ya declarada.

CREATE TABLE IF NOT EXISTS parametros_laborales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  /* rmv, uit, tasa_onp, tasa_essalud, tasa_senati… */
  clave           text NOT NULL,
  vigente_desde   date NOT NULL,
  valor           numeric(18,6) NOT NULL,
  observaciones   text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS parametros_laborales_uk
  ON parametros_laborales (empresa_id, clave, vigente_desde);

-- ─── Planillas ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS planillas_sueldos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero          text NOT NULL,
  /* mensual, gratificacion, cts o liquidacion. */
  tipo            text NOT NULL DEFAULT 'mensual',
  /* AAAAMM. Decide qué parámetros rigen y en qué periodo contable asienta. */
  periodo         text NOT NULL,
  /*
   * 1 es el adelanto de mitad de mes y 2 el cierre. NULL en las planillas que no
   * son mensuales. La ley y los aportes son mensuales: la primera quincena es un
   * adelanto a cuenta, no una planilla con su propia ONP.
   */
  quincena        integer,
  fecha           date NOT NULL,
  fecha_pago      date,
  /* borrador, cerrada, pagada o anulada. Un borrador se recalcula; una cerrada no. */
  estado          text NOT NULL DEFAULT 'borrador',
  total_ingresos  numeric(18,6) NOT NULL DEFAULT 0,
  total_descuentos numeric(18,6) NOT NULL DEFAULT 0,
  total_aportes   numeric(18,6) NOT NULL DEFAULT 0,
  total_neto      numeric(18,6) NOT NULL DEFAULT 0,
  asiento_id      uuid,
  observaciones   text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS planillas_sueldos_uk ON planillas_sueldos (empresa_id, numero);
-- Una sola planilla por tipo, periodo y quincena: dos mensuales de setiembre
-- declararían el doble en la PLAME y nadie sabría cuál es la buena.
CREATE UNIQUE INDEX IF NOT EXISTS planillas_sueldos_periodo_uk
  ON planillas_sueldos (empresa_id, tipo, periodo, coalesce(quincena, 0))
  WHERE estado <> 'anulada' AND tipo <> 'liquidacion';

CREATE TABLE IF NOT EXISTS planilla_trabajadores (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  planilla_id        uuid NOT NULL REFERENCES planillas_sueldos(id) ON DELETE CASCADE,
  trabajador_id      uuid NOT NULL REFERENCES trabajadores(id),
  dias_trabajados    integer NOT NULL DEFAULT 30,
  /* Copia del régimen del día del cálculo: si cambia después, la boleta no. */
  regimen_pension    text NOT NULL,
  afp_codigo         text,
  base_remunerativa  numeric(18,6) NOT NULL DEFAULT 0,
  total_ingresos     numeric(18,6) NOT NULL DEFAULT 0,
  total_descuentos   numeric(18,6) NOT NULL DEFAULT 0,
  total_aportes      numeric(18,6) NOT NULL DEFAULT 0,
  neto               numeric(18,6) NOT NULL DEFAULT 0,
  /* Sólo en las planillas de liquidación. */
  motivo_cese        text,
  fecha_cese         date,
  observaciones      text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS planilla_trabajadores_uk
  ON planilla_trabajadores (planilla_id, trabajador_id);

CREATE TABLE IF NOT EXISTS planilla_lineas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  planilla_trabajador_id   uuid NOT NULL
                             REFERENCES planilla_trabajadores(id) ON DELETE CASCADE,
  codigo                   text NOT NULL,
  /* Se copia el nombre: renombrar un concepto no debe reescribir boletas viejas. */
  nombre                   text NOT NULL,
  tipo                     text NOT NULL,
  importe                  numeric(18,6) NOT NULL,
  nota                     text,
  orden                    integer NOT NULL DEFAULT 0,
  creado_en                timestamptz NOT NULL DEFAULT now(),
  actualizado_en           timestamptz NOT NULL DEFAULT now(),
  creado_por               uuid
);
CREATE INDEX IF NOT EXISTS planilla_lineas_ix ON planilla_lineas (planilla_trabajador_id);

-- ─── Permisos ─────────────────────────────────────────────────────────────
--
-- El módulo es nuevo, y los roles de las empresas que ya existen se quedaron sin
-- sus permisos. Se los añade sólo al rol de administrador del sistema: quién
-- más ve las planillas es una decisión de cada empresa, y los sueldos no son un
-- dato que se reparta por omisión.
UPDATE roles
   SET permisos = ARRAY(
         SELECT DISTINCT unnest(
           permisos || ARRAY['planillas:ver', 'planillas:crear', 'planillas:editar',
                             'planillas:anular', 'planillas:aprobar']))
 WHERE es_sistema AND codigo = 'admin'
   AND NOT ('planillas:ver' = ANY (permisos));
