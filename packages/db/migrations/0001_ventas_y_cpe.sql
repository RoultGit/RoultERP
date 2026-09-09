CREATE TABLE "certificados_digitales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"pfx_cifrado" jsonb NOT NULL,
	"password_cifrado" jsonb NOT NULL,
	"ruc" text,
	"vigente_hasta" date,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "comprobante_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"comprobante_id" uuid NOT NULL,
	"linea" integer NOT NULL,
	"producto_id" uuid,
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"unidad" text NOT NULL,
	"cantidad" numeric(18, 6) NOT NULL,
	"valor_unitario" numeric(18, 6) NOT NULL,
	"precio_unitario" numeric(18, 6) NOT NULL,
	"descuento" numeric(18, 6) DEFAULT '0' NOT NULL,
	"afectacion_igv" text DEFAULT '10' NOT NULL,
	"valor_venta" numeric(18, 6) DEFAULT '0' NOT NULL,
	"igv" numeric(18, 6) DEFAULT '0' NOT NULL,
	"importe_linea" numeric(18, 6) DEFAULT '0' NOT NULL,
	"costo_unitario" numeric(18, 6),
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "comprobantes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo_documento" text NOT NULL,
	"serie" text NOT NULL,
	"numero" text NOT NULL,
	"fecha_emision" date NOT NULL,
	"hora_emision" text,
	"fecha_vencimiento" date,
	"periodo" text NOT NULL,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"tipo_operacion" text DEFAULT '0101' NOT NULL,
	"gravadas" numeric(18, 6) DEFAULT '0' NOT NULL,
	"exoneradas" numeric(18, 6) DEFAULT '0' NOT NULL,
	"inafectas" numeric(18, 6) DEFAULT '0' NOT NULL,
	"exportacion" numeric(18, 6) DEFAULT '0' NOT NULL,
	"gratuitas" numeric(18, 6) DEFAULT '0' NOT NULL,
	"isc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"igv" numeric(18, 6) DEFAULT '0' NOT NULL,
	"igv_gratuitas" numeric(18, 6) DEFAULT '0' NOT NULL,
	"otros_cargos" numeric(18, 6) DEFAULT '0' NOT NULL,
	"descuento_global" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total" numeric(18, 6) NOT NULL,
	"total_en_letras" text,
	"detraccion_codigo" text,
	"detraccion_tasa" numeric(18, 6),
	"detraccion_monto" numeric(18, 6) DEFAULT '0' NOT NULL,
	"percepcion_monto" numeric(18, 6) DEFAULT '0' NOT NULL,
	"modifica_a" uuid,
	"motivo_nota" text,
	"descripcion_motivo" text,
	"almacen_id" uuid,
	"asiento_id" uuid,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"xml_firmado" text,
	"hash_xml" text,
	"cdr_base64" text,
	"codigo_sunat" integer,
	"mensaje_sunat" text,
	"observaciones_sunat" text[],
	"ticket_sunat" text,
	"enviado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "credenciales_sunat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usuario_sol" text NOT NULL,
	"clave_cifrada" jsonb NOT NULL,
	"entorno" text DEFAULT 'beta' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "certificados_digitales" ADD CONSTRAINT "certificados_digitales_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_comprobante_id_comprobantes_id_fk" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobantes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_cliente_id_terceros_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_almacen_id_almacenes_id_fk" FOREIGN KEY ("almacen_id") REFERENCES "public"."almacenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credenciales_sunat" ADD CONSTRAINT "credenciales_sunat_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificados_empresa_ix" ON "certificados_digitales" USING btree ("empresa_id","activo");--> statement-breakpoint
CREATE UNIQUE INDEX "comprobante_items_uk" ON "comprobante_items" USING btree ("comprobante_id","linea");--> statement-breakpoint
CREATE UNIQUE INDEX "comprobantes_uk" ON "comprobantes" USING btree ("empresa_id","tipo_documento","serie","numero");--> statement-breakpoint
CREATE INDEX "comprobantes_periodo_ix" ON "comprobantes" USING btree ("empresa_id","periodo");--> statement-breakpoint
CREATE INDEX "comprobantes_cliente_ix" ON "comprobantes" USING btree ("empresa_id","cliente_id");--> statement-breakpoint
CREATE INDEX "comprobantes_estado_ix" ON "comprobantes" USING btree ("empresa_id","estado");--> statement-breakpoint
CREATE UNIQUE INDEX "credenciales_sunat_uk" ON "credenciales_sunat" USING btree ("empresa_id");