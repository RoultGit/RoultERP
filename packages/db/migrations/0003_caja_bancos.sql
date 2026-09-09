CREATE TABLE "arqueos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"saldo_libro" numeric(18, 6) NOT NULL,
	"saldo_contado" numeric(18, 6) NOT NULL,
	"diferencia" numeric(18, 6) NOT NULL,
	"observaciones" text,
	"asiento_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "cuentas_efectivo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"moneda" text DEFAULT 'PEN' NOT NULL,
	"cuenta_contable" text NOT NULL,
	"banco" text,
	"numero_cuenta" text,
	"cci" text,
	"fondo_fijo" numeric(18, 6) DEFAULT '0' NOT NULL,
	"responsable_id" uuid,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "extracto_bancario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"descripcion" text NOT NULL,
	"importe" numeric(18, 6) NOT NULL,
	"referencia" text,
	"saldo" numeric(18, 6),
	"movimiento_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "movimientos_efectivo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"sentido" text NOT NULL,
	"concepto" text NOT NULL,
	"importe" numeric(18, 6) NOT NULL,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"referencia" text,
	"tercero_id" uuid,
	"origen_modulo" text,
	"origen_id" uuid,
	"asiento_id" uuid,
	"conciliado_en" date,
	"extracto_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "arqueos" ADD CONSTRAINT "arqueos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arqueos" ADD CONSTRAINT "arqueos_cuenta_id_cuentas_efectivo_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuentas_efectivo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuentas_efectivo" ADD CONSTRAINT "cuentas_efectivo_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracto_bancario" ADD CONSTRAINT "extracto_bancario_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracto_bancario" ADD CONSTRAINT "extracto_bancario_cuenta_id_cuentas_efectivo_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuentas_efectivo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_efectivo" ADD CONSTRAINT "movimientos_efectivo_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_efectivo" ADD CONSTRAINT "movimientos_efectivo_cuenta_id_cuentas_efectivo_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuentas_efectivo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_efectivo" ADD CONSTRAINT "movimientos_efectivo_tercero_id_terceros_id_fk" FOREIGN KEY ("tercero_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arqueos_cuenta_ix" ON "arqueos" USING btree ("empresa_id","cuenta_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "cuentas_efectivo_uk" ON "cuentas_efectivo" USING btree ("empresa_id","codigo");--> statement-breakpoint
CREATE INDEX "extracto_cuenta_fecha_ix" ON "extracto_bancario" USING btree ("empresa_id","cuenta_id","fecha");--> statement-breakpoint
CREATE INDEX "extracto_sin_conciliar_ix" ON "extracto_bancario" USING btree ("cuenta_id","movimiento_id");--> statement-breakpoint
CREATE INDEX "movimientos_efectivo_cuenta_ix" ON "movimientos_efectivo" USING btree ("empresa_id","cuenta_id","fecha");--> statement-breakpoint
CREATE INDEX "movimientos_efectivo_conciliacion_ix" ON "movimientos_efectivo" USING btree ("cuenta_id","conciliado_en");