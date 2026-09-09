CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid,
	"usuario_id" uuid,
	"tabla" text NOT NULL,
	"registro_id" text,
	"accion" text NOT NULL,
	"antes" jsonb,
	"despues" jsonb,
	"ip" "inet",
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruc" text NOT NULL,
	"razon_social" text NOT NULL,
	"nombre_comercial" text,
	"direccion" text,
	"ubigeo" text,
	"moneda_funcional" text DEFAULT 'PEN' NOT NULL,
	"metodo_valorizacion" text DEFAULT 'promedio' NOT NULL,
	"redondeo_detraccion" text DEFAULT 'cercano' NOT NULL,
	"es_agente_retencion" boolean DEFAULT false NOT NULL,
	"es_agente_percepcion" boolean DEFAULT false NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "intentos_login" (
	"clave" text PRIMARY KEY NOT NULL,
	"fallos" integer DEFAULT 0 NOT NULL,
	"ultimo_fallo_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"permisos" text[] NOT NULL,
	"es_sistema" boolean DEFAULT false NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"empresa_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"ultimo_uso_en" timestamp with time zone DEFAULT now() NOT NULL,
	"revocada_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tipo_cambio" (
	"fecha" date NOT NULL,
	"moneda" text NOT NULL,
	"compra" numeric(18, 6) NOT NULL,
	"venta" numeric(18, 6) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens_un_uso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"tipo" text NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"usado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trabajos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"payload" jsonb NOT NULL,
	"resultado" jsonb,
	"error" text,
	"intentos" integer DEFAULT 0 NOT NULL,
	"ejecutar_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuario_empresa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"rol_id" uuid NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"nombre" text NOT NULL,
	"mfa_secreto" jsonb,
	"mfa_activo" boolean DEFAULT false NOT NULL,
	"mfa_ultimo_paso" integer,
	"mfa_respaldos" text[],
	"activo" boolean DEFAULT true NOT NULL,
	"ultimo_acceso_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "almacenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sucursal_id" uuid,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"es_transito" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "centros_costo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"padre_id" uuid,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "periodos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"periodo" text NOT NULL,
	"estado" text DEFAULT 'abierto' NOT NULL,
	"cerrado_por" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "plan_cuentas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta" text NOT NULL,
	"descripcion" text NOT NULL,
	"nivel" integer NOT NULL,
	"naturaleza" text NOT NULL,
	"es_movimiento" boolean DEFAULT false NOT NULL,
	"moneda" text,
	"exige_anexo" boolean DEFAULT false NOT NULL,
	"exige_centro_costo" boolean DEFAULT false NOT NULL,
	"exige_documento" boolean DEFAULT false NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "productos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"unidad_id" uuid NOT NULL,
	"tipo" text DEFAULT 'bien' NOT NULL,
	"afectacion_igv" text DEFAULT '10' NOT NULL,
	"codigo_sunat" text,
	"cuenta_existencia_id" uuid,
	"cuenta_venta_id" uuid,
	"cuenta_costo_id" uuid,
	"control_lote" boolean DEFAULT false NOT NULL,
	"control_serie" boolean DEFAULT false NOT NULL,
	"peso_unitario" numeric(18, 6),
	"volumen_unitario" numeric(18, 6),
	"partida_arancelaria" text,
	"stock_minimo" numeric(18, 6) DEFAULT '0' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "reglas_detraccion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"tasa" numeric(18, 6) NOT NULL,
	"aplica_minimo" boolean DEFAULT true NOT NULL,
	"vigente_desde" date NOT NULL,
	"vigente_hasta" date,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "series_documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sucursal_id" uuid,
	"tipo_documento" text NOT NULL,
	"serie" text NOT NULL,
	"correlativo" integer DEFAULT 0 NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "sucursales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"direccion" text,
	"ubigeo" text,
	"codigo_sunat" text,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "terceros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo_documento" text NOT NULL,
	"numero_documento" text NOT NULL,
	"razon_social" text NOT NULL,
	"nombre_comercial" text,
	"direccion" text,
	"ubigeo" text,
	"pais" text DEFAULT 'PE' NOT NULL,
	"email" text,
	"telefono" text,
	"es_cliente" boolean DEFAULT false NOT NULL,
	"es_proveedor" boolean DEFAULT false NOT NULL,
	"es_domiciliado" boolean DEFAULT true NOT NULL,
	"es_agente_retencion" boolean DEFAULT false NOT NULL,
	"sujeto_percepcion" boolean DEFAULT false NOT NULL,
	"dias_credito" integer DEFAULT 0 NOT NULL,
	"limite_credito" numeric(18, 6) DEFAULT '0' NOT NULL,
	"moneda_limite" text DEFAULT 'PEN' NOT NULL,
	"cuenta_id" uuid,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "unidades_medida" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "asiento_lineas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"asiento_id" uuid NOT NULL,
	"linea" integer NOT NULL,
	"cuenta" text NOT NULL,
	"glosa" text,
	"debe" numeric(18, 6) DEFAULT '0' NOT NULL,
	"haber" numeric(18, 6) DEFAULT '0' NOT NULL,
	"debe_funcional" numeric(18, 6) DEFAULT '0' NOT NULL,
	"haber_funcional" numeric(18, 6) DEFAULT '0' NOT NULL,
	"centro_costo_id" uuid,
	"anexo_id" uuid,
	"documento_tipo" text,
	"documento_serie" text,
	"documento_numero" text,
	"documento_fecha" date,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "asientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"periodo" text NOT NULL,
	"numero" text NOT NULL,
	"fecha" date NOT NULL,
	"subdiario" text NOT NULL,
	"glosa" text NOT NULL,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"extorna_a" uuid,
	"origen_modulo" text,
	"origen_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "compra_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"compra_id" uuid NOT NULL,
	"linea" integer NOT NULL,
	"producto_id" uuid,
	"descripcion" text NOT NULL,
	"cantidad" numeric(18, 6) NOT NULL,
	"valor_unitario" numeric(18, 6) NOT NULL,
	"descuento" numeric(18, 6) DEFAULT '0' NOT NULL,
	"afectacion_igv" text DEFAULT '10' NOT NULL,
	"valor_venta" numeric(18, 6) DEFAULT '0' NOT NULL,
	"igv" numeric(18, 6) DEFAULT '0' NOT NULL,
	"importe" numeric(18, 6) DEFAULT '0' NOT NULL,
	"centro_costo_id" uuid,
	"cuenta_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "compras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"proveedor_id" uuid NOT NULL,
	"tipo_documento" text NOT NULL,
	"serie" text NOT NULL,
	"numero" text NOT NULL,
	"fecha_emision" date NOT NULL,
	"fecha_vencimiento" date,
	"periodo" text NOT NULL,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"gravadas" numeric(18, 6) DEFAULT '0' NOT NULL,
	"exoneradas" numeric(18, 6) DEFAULT '0' NOT NULL,
	"inafectas" numeric(18, 6) DEFAULT '0' NOT NULL,
	"isc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"igv" numeric(18, 6) DEFAULT '0' NOT NULL,
	"otros_cargos" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"regimen" text DEFAULT 'ninguno' NOT NULL,
	"detraccion_codigo" text,
	"detraccion_tasa" numeric(18, 6),
	"detraccion_monto" numeric(18, 6) DEFAULT '0' NOT NULL,
	"detraccion_constancia" text,
	"detraccion_fecha" date,
	"percepcion_monto" numeric(18, 6) DEFAULT '0' NOT NULL,
	"orden_compra_id" uuid,
	"importacion_id" uuid,
	"asiento_id" uuid,
	"estado" text DEFAULT 'registrada' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "documentos_cxp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"proveedor_id" uuid NOT NULL,
	"compra_id" uuid,
	"tipo_documento" text NOT NULL,
	"serie" text NOT NULL,
	"numero" text NOT NULL,
	"fecha_emision" date NOT NULL,
	"fecha_vencimiento" date NOT NULL,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"total" numeric(18, 6) NOT NULL,
	"saldo" numeric(18, 6) NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "importacion_gastos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"importacion_id" uuid NOT NULL,
	"concepto" text NOT NULL,
	"importe" numeric(18, 6) NOT NULL,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_prorrateo" text DEFAULT 'fob' NOT NULL,
	"afecta_costo" boolean DEFAULT true NOT NULL,
	"item_id" uuid,
	"proveedor_id" uuid,
	"documento" text,
	"fecha" date,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "importacion_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"importacion_id" uuid NOT NULL,
	"linea" integer NOT NULL,
	"producto_id" uuid NOT NULL,
	"descripcion" text NOT NULL,
	"cantidad" numeric(18, 6) NOT NULL,
	"fob_unitario" numeric(18, 6) NOT NULL,
	"peso" numeric(18, 6),
	"volumen" numeric(18, 6),
	"partida_arancelaria" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "importaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"proveedor_id" uuid NOT NULL,
	"almacen_id" uuid,
	"moneda" text DEFAULT 'USD' NOT NULL,
	"tipo_cambio" numeric(18, 6) NOT NULL,
	"incoterm" text,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"fecha_orden" date NOT NULL,
	"fecha_embarque" date,
	"fecha_llegada" date,
	"fecha_nacionalizacion" date,
	"dua_numero" text,
	"dua_fecha" date,
	"factura_exterior" text,
	"conocimiento_embarque" text,
	"puerto_origen" text,
	"puerto_destino" text,
	"observaciones" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "letra_documentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"letra_id" uuid NOT NULL,
	"documento_id" uuid NOT NULL,
	"importe" numeric(18, 6) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "letras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"cartera" text NOT NULL,
	"tercero_id" uuid NOT NULL,
	"fecha_giro" date NOT NULL,
	"fecha_vencimiento" date NOT NULL,
	"moneda" text NOT NULL,
	"importe" numeric(18, 6) NOT NULL,
	"saldo" numeric(18, 6) NOT NULL,
	"estado" text DEFAULT 'girada' NOT NULL,
	"renueva_a" uuid,
	"banco_cuenta_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "liquidacion_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"liquidacion_id" uuid NOT NULL,
	"importacion_item_id" uuid NOT NULL,
	"producto_id" uuid NOT NULL,
	"cantidad" numeric(18, 6) NOT NULL,
	"fob" numeric(18, 6) NOT NULL,
	"total_gastos_costo" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_gastos_no_costo" numeric(18, 6) DEFAULT '0' NOT NULL,
	"costo_total" numeric(18, 6) NOT NULL,
	"costo_unitario" numeric(18, 6) NOT NULL,
	"detalle_gastos" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "liquidaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"importacion_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"fecha" date NOT NULL,
	"fob_total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"gastos_costo_total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"gastos_no_costo_total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"costo_total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"no_costo" jsonb,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"asiento_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "movimientos_inventario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"almacen_id" uuid NOT NULL,
	"producto_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"orden" integer NOT NULL,
	"sentido" text NOT NULL,
	"tipo_operacion" text NOT NULL,
	"cantidad" numeric(18, 6) NOT NULL,
	"costo_unitario" numeric(18, 6) NOT NULL,
	"importe_total" numeric(18, 6) NOT NULL,
	"consumos" jsonb,
	"lote" text,
	"serie" text,
	"origen_modulo" text,
	"origen_id" uuid,
	"anulado_por" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "orden_compra_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"orden_id" uuid NOT NULL,
	"linea" integer NOT NULL,
	"producto_id" uuid NOT NULL,
	"descripcion" text NOT NULL,
	"cantidad" numeric(18, 6) NOT NULL,
	"cantidad_recibida" numeric(18, 6) DEFAULT '0' NOT NULL,
	"valor_unitario" numeric(18, 6) NOT NULL,
	"descuento" numeric(18, 6) DEFAULT '0' NOT NULL,
	"afectacion_igv" text DEFAULT '10' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "ordenes_compra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"proveedor_id" uuid NOT NULL,
	"sucursal_id" uuid,
	"almacen_id" uuid,
	"fecha" date NOT NULL,
	"fecha_entrega" date,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"condicion_pago" text,
	"observaciones" text,
	"subtotal" numeric(18, 6) DEFAULT '0' NOT NULL,
	"igv" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"aprobada_por" uuid,
	"aprobada_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "pago_aplicaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pago_id" uuid NOT NULL,
	"documento_id" uuid NOT NULL,
	"importe_aplicado" numeric(18, 6) NOT NULL,
	"diferencia_cambio" numeric(18, 6) DEFAULT '0' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"proveedor_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"medio_pago" text NOT NULL,
	"cuenta_id" uuid,
	"importe_bruto" numeric(18, 6) NOT NULL,
	"retencion_monto" numeric(18, 6) DEFAULT '0' NOT NULL,
	"importe_neto" numeric(18, 6) NOT NULL,
	"referencia" text,
	"asiento_id" uuid,
	"estado" text DEFAULT 'registrado' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "saldos_inventario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"almacen_id" uuid NOT NULL,
	"producto_id" uuid NOT NULL,
	"cantidad" numeric(18, 6) DEFAULT '0' NOT NULL,
	"valor" numeric(18, 6) DEFAULT '0' NOT NULL,
	"capas" jsonb,
	"actualizado_en_movimiento" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens_un_uso" ADD CONSTRAINT "tokens_un_uso_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trabajos" ADD CONSTRAINT "trabajos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_empresa" ADD CONSTRAINT "usuario_empresa_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_empresa" ADD CONSTRAINT "usuario_empresa_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_empresa" ADD CONSTRAINT "usuario_empresa_rol_id_roles_id_fk" FOREIGN KEY ("rol_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "almacenes" ADD CONSTRAINT "almacenes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "almacenes" ADD CONSTRAINT "almacenes_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "centros_costo" ADD CONSTRAINT "centros_costo_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodos" ADD CONSTRAINT "periodos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_cuentas" ADD CONSTRAINT "plan_cuentas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productos" ADD CONSTRAINT "productos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productos" ADD CONSTRAINT "productos_unidad_id_unidades_medida_id_fk" FOREIGN KEY ("unidad_id") REFERENCES "public"."unidades_medida"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productos" ADD CONSTRAINT "productos_cuenta_existencia_id_plan_cuentas_id_fk" FOREIGN KEY ("cuenta_existencia_id") REFERENCES "public"."plan_cuentas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productos" ADD CONSTRAINT "productos_cuenta_venta_id_plan_cuentas_id_fk" FOREIGN KEY ("cuenta_venta_id") REFERENCES "public"."plan_cuentas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productos" ADD CONSTRAINT "productos_cuenta_costo_id_plan_cuentas_id_fk" FOREIGN KEY ("cuenta_costo_id") REFERENCES "public"."plan_cuentas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglas_detraccion" ADD CONSTRAINT "reglas_detraccion_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_documento" ADD CONSTRAINT "series_documento_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_documento" ADD CONSTRAINT "series_documento_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terceros" ADD CONSTRAINT "terceros_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terceros" ADD CONSTRAINT "terceros_cuenta_id_plan_cuentas_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."plan_cuentas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unidades_medida" ADD CONSTRAINT "unidades_medida_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asiento_lineas" ADD CONSTRAINT "asiento_lineas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asiento_lineas" ADD CONSTRAINT "asiento_lineas_asiento_id_asientos_id_fk" FOREIGN KEY ("asiento_id") REFERENCES "public"."asientos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asiento_lineas" ADD CONSTRAINT "asiento_lineas_centro_costo_id_centros_costo_id_fk" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."centros_costo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asiento_lineas" ADD CONSTRAINT "asiento_lineas_anexo_id_terceros_id_fk" FOREIGN KEY ("anexo_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_centro_costo_id_centros_costo_id_fk" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."centros_costo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_cuenta_id_plan_cuentas_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."plan_cuentas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_proveedor_id_terceros_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_orden_compra_id_ordenes_compra_id_fk" FOREIGN KEY ("orden_compra_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_cxp" ADD CONSTRAINT "documentos_cxp_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_cxp" ADD CONSTRAINT "documentos_cxp_proveedor_id_terceros_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_cxp" ADD CONSTRAINT "documentos_cxp_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacion_gastos" ADD CONSTRAINT "importacion_gastos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacion_gastos" ADD CONSTRAINT "importacion_gastos_importacion_id_importaciones_id_fk" FOREIGN KEY ("importacion_id") REFERENCES "public"."importaciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacion_gastos" ADD CONSTRAINT "importacion_gastos_item_id_importacion_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."importacion_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacion_gastos" ADD CONSTRAINT "importacion_gastos_proveedor_id_terceros_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacion_items" ADD CONSTRAINT "importacion_items_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacion_items" ADD CONSTRAINT "importacion_items_importacion_id_importaciones_id_fk" FOREIGN KEY ("importacion_id") REFERENCES "public"."importaciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacion_items" ADD CONSTRAINT "importacion_items_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importaciones" ADD CONSTRAINT "importaciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importaciones" ADD CONSTRAINT "importaciones_proveedor_id_terceros_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importaciones" ADD CONSTRAINT "importaciones_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letra_documentos" ADD CONSTRAINT "letra_documentos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letra_documentos" ADD CONSTRAINT "letra_documentos_letra_id_letras_id_fk" FOREIGN KEY ("letra_id") REFERENCES "public"."letras"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letras" ADD CONSTRAINT "letras_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letras" ADD CONSTRAINT "letras_tercero_id_terceros_id_fk" FOREIGN KEY ("tercero_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidacion_items" ADD CONSTRAINT "liquidacion_items_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidacion_items" ADD CONSTRAINT "liquidacion_items_liquidacion_id_liquidaciones_id_fk" FOREIGN KEY ("liquidacion_id") REFERENCES "public"."liquidaciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidacion_items" ADD CONSTRAINT "liquidacion_items_importacion_item_id_importacion_items_id_fk" FOREIGN KEY ("importacion_item_id") REFERENCES "public"."importacion_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidacion_items" ADD CONSTRAINT "liquidacion_items_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_importacion_id_importaciones_id_fk" FOREIGN KEY ("importacion_id") REFERENCES "public"."importaciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_orden_id_ordenes_compra_id_fk" FOREIGN KEY ("orden_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_proveedor_id_terceros_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago_aplicaciones" ADD CONSTRAINT "pago_aplicaciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago_aplicaciones" ADD CONSTRAINT "pago_aplicaciones_pago_id_pagos_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pagos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago_aplicaciones" ADD CONSTRAINT "pago_aplicaciones_documento_id_documentos_cxp_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documentos_cxp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_proveedor_id_terceros_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cuenta_id_plan_cuentas_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."plan_cuentas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldos_inventario" ADD CONSTRAINT "saldos_inventario_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldos_inventario" ADD CONSTRAINT "saldos_inventario_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldos_inventario" ADD CONSTRAINT "saldos_inventario_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_empresa_fecha_ix" ON "auditoria" USING btree ("empresa_id","creado_en");--> statement-breakpoint
CREATE INDEX "auditoria_tabla_registro_ix" ON "auditoria" USING btree ("tabla","registro_id");--> statement-breakpoint
CREATE UNIQUE INDEX "empresas_ruc_uk" ON "empresas" USING btree ("ruc");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_empresa_codigo_uk" ON "roles" USING btree ("empresa_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "sesiones_token_uk" ON "sesiones" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sesiones_usuario_ix" ON "sesiones" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tipo_cambio_uk" ON "tipo_cambio" USING btree ("fecha","moneda");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_un_uso_uk" ON "tokens_un_uso" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "trabajos_pendientes_ix" ON "trabajos" USING btree ("estado","ejecutar_en");--> statement-breakpoint
CREATE UNIQUE INDEX "usuario_empresa_uk" ON "usuario_empresa" USING btree ("usuario_id","empresa_id");--> statement-breakpoint
CREATE INDEX "usuario_empresa_usuario_ix" ON "usuario_empresa" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_uk" ON "usuarios" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "almacenes_uk" ON "almacenes" USING btree ("empresa_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "centros_costo_uk" ON "centros_costo" USING btree ("empresa_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "periodos_uk" ON "periodos" USING btree ("empresa_id","periodo");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_cuentas_uk" ON "plan_cuentas" USING btree ("empresa_id","cuenta");--> statement-breakpoint
CREATE INDEX "plan_cuentas_movimiento_ix" ON "plan_cuentas" USING btree ("empresa_id","es_movimiento");--> statement-breakpoint
CREATE UNIQUE INDEX "productos_uk" ON "productos" USING btree ("empresa_id","codigo");--> statement-breakpoint
CREATE INDEX "productos_descripcion_ix" ON "productos" USING btree ("empresa_id","descripcion");--> statement-breakpoint
CREATE UNIQUE INDEX "reglas_detraccion_uk" ON "reglas_detraccion" USING btree ("empresa_id","codigo","vigente_desde");--> statement-breakpoint
CREATE UNIQUE INDEX "series_documento_uk" ON "series_documento" USING btree ("empresa_id","tipo_documento","serie");--> statement-breakpoint
CREATE UNIQUE INDEX "sucursales_uk" ON "sucursales" USING btree ("empresa_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "terceros_uk" ON "terceros" USING btree ("empresa_id","tipo_documento","numero_documento");--> statement-breakpoint
CREATE INDEX "terceros_razon_ix" ON "terceros" USING btree ("empresa_id","razon_social");--> statement-breakpoint
CREATE UNIQUE INDEX "unidades_medida_uk" ON "unidades_medida" USING btree ("empresa_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "asiento_lineas_uk" ON "asiento_lineas" USING btree ("asiento_id","linea");--> statement-breakpoint
CREATE INDEX "asiento_lineas_cuenta_ix" ON "asiento_lineas" USING btree ("empresa_id","cuenta");--> statement-breakpoint
CREATE INDEX "asiento_lineas_anexo_ix" ON "asiento_lineas" USING btree ("empresa_id","anexo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asientos_uk" ON "asientos" USING btree ("empresa_id","periodo","numero");--> statement-breakpoint
CREATE INDEX "asientos_origen_ix" ON "asientos" USING btree ("empresa_id","origen_modulo","origen_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compra_items_uk" ON "compra_items" USING btree ("compra_id","linea");--> statement-breakpoint
CREATE UNIQUE INDEX "compras_uk" ON "compras" USING btree ("empresa_id","proveedor_id","tipo_documento","serie","numero");--> statement-breakpoint
CREATE INDEX "compras_periodo_ix" ON "compras" USING btree ("empresa_id","periodo");--> statement-breakpoint
CREATE UNIQUE INDEX "documentos_cxp_uk" ON "documentos_cxp" USING btree ("empresa_id","proveedor_id","tipo_documento","serie","numero");--> statement-breakpoint
CREATE INDEX "documentos_cxp_vencimiento_ix" ON "documentos_cxp" USING btree ("empresa_id","estado","fecha_vencimiento");--> statement-breakpoint
CREATE INDEX "importacion_gastos_ix" ON "importacion_gastos" USING btree ("importacion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "importacion_items_uk" ON "importacion_items" USING btree ("importacion_id","linea");--> statement-breakpoint
CREATE UNIQUE INDEX "importaciones_uk" ON "importaciones" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE INDEX "importaciones_estado_ix" ON "importaciones" USING btree ("empresa_id","estado");--> statement-breakpoint
CREATE INDEX "letra_documentos_ix" ON "letra_documentos" USING btree ("letra_id");--> statement-breakpoint
CREATE UNIQUE INDEX "letras_uk" ON "letras" USING btree ("empresa_id","cartera","numero");--> statement-breakpoint
CREATE INDEX "letras_vencimiento_ix" ON "letras" USING btree ("empresa_id","estado","fecha_vencimiento");--> statement-breakpoint
CREATE INDEX "liquidacion_items_ix" ON "liquidacion_items" USING btree ("liquidacion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "liquidaciones_uk" ON "liquidaciones" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE INDEX "movimientos_kardex_ix" ON "movimientos_inventario" USING btree ("empresa_id","producto_id","almacen_id","fecha","orden");--> statement-breakpoint
CREATE INDEX "movimientos_origen_ix" ON "movimientos_inventario" USING btree ("empresa_id","origen_modulo","origen_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orden_compra_items_uk" ON "orden_compra_items" USING btree ("orden_id","linea");--> statement-breakpoint
CREATE UNIQUE INDEX "ordenes_compra_uk" ON "ordenes_compra" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE INDEX "ordenes_compra_proveedor_ix" ON "ordenes_compra" USING btree ("empresa_id","proveedor_id");--> statement-breakpoint
CREATE INDEX "pago_aplicaciones_pago_ix" ON "pago_aplicaciones" USING btree ("pago_id");--> statement-breakpoint
CREATE INDEX "pago_aplicaciones_doc_ix" ON "pago_aplicaciones" USING btree ("documento_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pagos_uk" ON "pagos" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "saldos_inventario_uk" ON "saldos_inventario" USING btree ("empresa_id","almacen_id","producto_id");