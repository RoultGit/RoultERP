-- Aislamiento entre empresas y separación de privilegios.
--
-- Este archivo se aplica siempre al final de las migraciones y es idempotente:
-- crear una tabla nueva y volver a correrlo basta para que quede protegida.
--
-- La idea central: el aislamiento vive en Postgres, no en el código de la
-- aplicación. Una consulta a la que se le olvide filtrar por empresa devuelve
-- cero filas ajenas en vez de devolverlas. Un descuido se degrada a resultado
-- vacío, nunca a fuga de datos.
--
-- Hay dos roles, y esa separación es tan importante como las políticas:
--
--   roulterp_auth  Sólo ve las tablas de identidad. Es el rol con el que corre
--                  el login, que necesariamente trabaja antes de que exista una
--                  empresa activa. No tiene permiso sobre ninguna tabla de
--                  negocio, así que comprometer el camino de autenticación no
--                  expone ni una factura.
--
--   roulterp_app   Todo lo demás, siempre con RLS aplicado. Nunca se le da
--                  BYPASSRLS. La aplicación jamás se conecta con el rol
--                  `service_role` de Supabase, que ignora RLS por diseño.

-- ─── Roles ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roulterp_app') THEN
    CREATE ROLE roulterp_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roulterp_auth') THEN
    CREATE ROLE roulterp_auth NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Defensa en profundidad: aunque alguien altere los roles más adelante, esto
-- los devuelve al estado correcto en cada despliegue.
ALTER ROLE roulterp_app  NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE roulterp_auth NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO roulterp_app, roulterp_auth;

-- La aplicación se conecta con el rol que le dé el proveedor —en Supabase,
-- `postgres`, que tiene BYPASSRLS— y baja a estos roles con SET LOCAL ROLE en
-- cada transacción. Para poder hacerlo tiene que ser miembro de ellos.
DO $$
BEGIN
  EXECUTE format('GRANT roulterp_app, roulterp_auth TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  -- Ya es miembro, o es superusuario y no lo necesita.
  NULL;
END $$;

-- ─── Contexto de la petición ──────────────────────────────────────────────

-- Se fijan con SET LOCAL dentro de la transacción, para que no se filtren entre
-- conexiones reutilizadas del pool. El segundo argumento `true` devuelve NULL
-- en vez de lanzar cuando no están fijadas, y como `columna = NULL` es NULL
-- —nunca verdadero—, olvidar el SET LOCAL deja al usuario sin ver nada.

CREATE OR REPLACE FUNCTION app_empresa() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.empresa_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_usuario() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.usuario_id', true), '')::uuid $$;

-- ─── Política de aislamiento por empresa ──────────────────────────────────

-- Se aplica a toda tabla que tenga una columna `empresa_id`, salvo las que se
-- listan abajo con su motivo. El criterio es deliberadamente automático: una
-- tabla nueva queda protegida sin que nadie tenga que acordarse de añadirla.
-- La prueba `rls.test.ts` falla si alguna tabla de negocio se queda fuera.

DO $$
DECLARE
  t text;
  excepciones text[] := ARRAY[
    -- Necesarias antes de que exista una empresa activa: el selector de empresa
    -- tiene que poder listar a cuáles puede entrar el usuario. Llevan su propia
    -- política, basada en el usuario y no en la empresa.
    'usuario_empresa',
    'sesiones',
    -- Append-only con reglas propias: se puede insertar y leer, jamás modificar.
    'auditoria'
  ];
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'empresa_id'
      AND NOT a.attisdropped
      AND c.relname <> ALL (excepciones)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aislamiento_empresa ON public.%I', t);
    -- WITH CHECK es tan necesario como USING: sin él, un INSERT podría escribir
    -- filas marcadas con el empresa_id de otra empresa.
    EXECUTE format(
      'CREATE POLICY aislamiento_empresa ON public.%I FOR ALL TO roulterp_app
         USING (empresa_id = app_empresa())
         WITH CHECK (empresa_id = app_empresa())', t);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO roulterp_app', t);
  END LOOP;
END $$;

-- ─── La tabla `empresas` ──────────────────────────────────────────────────

-- Su identificador es `id`, no `empresa_id`, así que va aparte. Un usuario sólo
-- ve la empresa que tiene activa; crear empresas es tarea del operador del SaaS
-- y no pasa por este rol.

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS empresa_activa ON public.empresas;
CREATE POLICY empresa_activa ON public.empresas FOR SELECT TO roulterp_app
  USING (id = app_empresa());
DROP POLICY IF EXISTS empresa_actualizar ON public.empresas;
CREATE POLICY empresa_actualizar ON public.empresas FOR UPDATE TO roulterp_app
  USING (id = app_empresa()) WITH CHECK (id = app_empresa());
GRANT SELECT, UPDATE ON public.empresas TO roulterp_app;

-- ─── Identidad ────────────────────────────────────────────────────────────

-- `roulterp_auth` es el único rol que toca estas tablas durante el login. No
-- tiene ningún permiso sobre tablas de negocio, lo que acota el daño de una
-- falla en el camino de autenticación a los datos de autenticación.

ALTER TABLE public.usuarios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.sesiones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.usuario_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_empresa FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.tokens_un_uso   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokens_un_uso   FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.intentos_login  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intentos_login  FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.usuarios, public.sesiones, public.usuario_empresa,
     public.tokens_un_uso, public.intentos_login
  TO roulterp_auth;
-- Los roles se leen en el login y se administran desde la pantalla de usuarios,
-- que también corre con este rol: la definición de quién puede qué es parte de
-- la identidad, no del negocio.
GRANT SELECT, INSERT, UPDATE ON public.roles TO roulterp_auth;

-- El rol de autenticación necesita ver todas las filas de identidad, porque
-- busca por correo antes de saber quién es nadie.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','sesiones','usuario_empresa','tokens_un_uso','intentos_login']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_total ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY auth_total ON public.%I FOR ALL TO roulterp_auth
         USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS auth_lee_roles ON public.roles;
DROP POLICY IF EXISTS auth_administra_roles ON public.roles;
-- Sin restricción de empresa: este rol busca por correo antes de saber a qué
-- empresa pertenece nadie. El filtro por empresa lo pone cada consulta del
-- servicio, que es la única puerta a estas tablas.
CREATE POLICY auth_administra_roles ON public.roles FOR ALL TO roulterp_auth
  USING (true) WITH CHECK (true);

-- Para `roulterp_app`, en cambio, la identidad está acotada: se ve a sí mismo y
-- a los compañeros de la empresa activa.

DROP POLICY IF EXISTS usuarios_visibles ON public.usuarios;
CREATE POLICY usuarios_visibles ON public.usuarios FOR SELECT TO roulterp_app
  USING (
    id = app_usuario()
    OR EXISTS (
      SELECT 1 FROM public.usuario_empresa ue
      WHERE ue.usuario_id = usuarios.id AND ue.empresa_id = app_empresa()
    )
  );

DROP POLICY IF EXISTS usuario_propio ON public.usuarios;
CREATE POLICY usuario_propio ON public.usuarios FOR UPDATE TO roulterp_app
  USING (id = app_usuario()) WITH CHECK (id = app_usuario());

GRANT SELECT, UPDATE ON public.usuarios TO roulterp_app;

DROP POLICY IF EXISTS membresias_visibles ON public.usuario_empresa;
CREATE POLICY membresias_visibles ON public.usuario_empresa FOR ALL TO roulterp_app
  USING (usuario_id = app_usuario() OR empresa_id = app_empresa())
  WITH CHECK (empresa_id = app_empresa());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usuario_empresa TO roulterp_app;

DROP POLICY IF EXISTS sesiones_propias ON public.sesiones;
CREATE POLICY sesiones_propias ON public.sesiones FOR ALL TO roulterp_app
  USING (usuario_id = app_usuario())
  WITH CHECK (usuario_id = app_usuario());
GRANT SELECT, UPDATE ON public.sesiones TO roulterp_app;

-- `intentos_login` no la toca la aplicación: sólo el rol de autenticación.
REVOKE ALL ON public.intentos_login FROM roulterp_app;

-- ─── Auditoría: sólo se escribe hacia adelante ────────────────────────────

ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auditoria_lectura ON public.auditoria;
CREATE POLICY auditoria_lectura ON public.auditoria FOR SELECT TO roulterp_app
  USING (empresa_id = app_empresa());

DROP POLICY IF EXISTS auditoria_escritura ON public.auditoria;
CREATE POLICY auditoria_escritura ON public.auditoria FOR INSERT TO roulterp_app
  WITH CHECK (true);

-- Sin política de UPDATE ni de DELETE: no existen, así que están prohibidos.
-- Una bitácora que se puede editar no prueba nada.
GRANT SELECT, INSERT ON public.auditoria TO roulterp_app;
REVOKE UPDATE, DELETE ON public.auditoria FROM roulterp_app, roulterp_auth;

-- ─── Tipo de cambio: catálogo global de sólo lectura ──────────────────────

ALTER TABLE public.tipo_cambio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_cambio FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tipo_cambio_lectura ON public.tipo_cambio;
CREATE POLICY tipo_cambio_lectura ON public.tipo_cambio FOR SELECT TO roulterp_app
  USING (true);
GRANT SELECT ON public.tipo_cambio TO roulterp_app;
REVOKE INSERT, UPDATE, DELETE ON public.tipo_cambio FROM roulterp_app;

-- ─── Libros inmutables ────────────────────────────────────────────────────

-- Un asiento contabilizado y un movimiento de inventario no se editan ni se
-- borran: se extornan. Es requisito de un libro legal, y es también lo que hace
-- que el sistema sirva como prueba ante una fiscalización. La regla se aplica
-- en la base y no sólo en el dominio, porque una regla que vive únicamente en
-- el código se salta con un UPDATE.

CREATE OR REPLACE FUNCTION impedir_modificacion_libro() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  -- Un borrador todavía no es contabilidad: se corrige y se borra. A partir de
  -- que se contabiliza, el asiento es inmutable y sólo se revierte extornándolo.
  IF OLD.estado = 'borrador' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'un asiento contabilizado no se borra; use un extorno'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND NEW.estado IN ('extornado', 'anulado')
     AND to_jsonb(NEW) - 'estado' - 'actualizado_en'
         = to_jsonb(OLD) - 'estado' - 'actualizado_en' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'el asiento % ya está %; use un extorno', OLD.id, OLD.estado
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS asientos_inmutables ON public.asientos;
CREATE TRIGGER asientos_inmutables
  BEFORE UPDATE OR DELETE ON public.asientos
  FOR EACH ROW EXECUTE FUNCTION impedir_modificacion_libro();

CREATE OR REPLACE FUNCTION impedir_borrado() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  RAISE EXCEPTION 'los registros de % no se borran; corrija con un movimiento inverso', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS movimientos_sin_borrado ON public.movimientos_inventario;
CREATE TRIGGER movimientos_sin_borrado
  BEFORE DELETE ON public.movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION impedir_borrado();

-- Las líneas de un asiento **contabilizado** son inmutables. Las de un borrador
-- no: el contador escribe veinte líneas, las corrige y las reescribe, y esa es
-- justamente la razón de que exista el estado borrador.
CREATE OR REPLACE FUNCTION impedir_borrado_lineas_contabilizadas() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  estado_asiento text;
BEGIN
  SELECT estado INTO estado_asiento FROM public.asientos WHERE id = OLD.asiento_id;

  -- Si el asiento ya no existe, el borrado viene en cascada desde la cabecera,
  -- que tiene su propio control.
  IF estado_asiento IS NULL OR estado_asiento = 'borrador' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'el asiento está %; sus líneas no se borran, use un extorno', estado_asiento
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS lineas_asiento_sin_borrado ON public.asiento_lineas;
CREATE TRIGGER lineas_asiento_sin_borrado
  BEFORE DELETE ON public.asiento_lineas
  FOR EACH ROW EXECUTE FUNCTION impedir_borrado_lineas_contabilizadas();

-- ─── actualizado_en ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tocar_actualizado_en() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND a.attname = 'actualizado_en' AND NOT a.attisdropped
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tocar_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER tocar_%I BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en()', t, t);
  END LOOP;
END $$;

-- ─── Secuencias y permisos por defecto ────────────────────────────────────

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO roulterp_app, roulterp_auth;

-- Nada de permisos amplios por si acaso: lo que una tabla nueva necesite se
-- concede al volver a correr este archivo, que es lo que hace el despliegue.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
