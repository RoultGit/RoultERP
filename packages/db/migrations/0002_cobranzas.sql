CREATE TABLE "cobranza_aplicaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cobranza_id" uuid NOT NULL,
	"comprobante_id" uuid NOT NULL,
	"importe" numeric(18, 6) NOT NULL,
	"diferencia_cambio" numeric(18, 6) DEFAULT '0' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "cobranzas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"moneda" text NOT NULL,
	"tipo_cambio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"medio_cobro" text NOT NULL,
	"importe" numeric(18, 6) NOT NULL,
	"referencia" text,
	"asiento_id" uuid,
	"estado" text DEFAULT 'registrada' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "cobranza_aplicaciones" ADD CONSTRAINT "cobranza_aplicaciones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranza_aplicaciones" ADD CONSTRAINT "cobranza_aplicaciones_cobranza_id_cobranzas_id_fk" FOREIGN KEY ("cobranza_id") REFERENCES "public"."cobranzas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranza_aplicaciones" ADD CONSTRAINT "cobranza_aplicaciones_comprobante_id_comprobantes_id_fk" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranzas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranzas" ADD CONSTRAINT "cobranzas_cliente_id_terceros_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."terceros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cobranza_aplicaciones_cobranza_ix" ON "cobranza_aplicaciones" USING btree ("cobranza_id");--> statement-breakpoint
CREATE INDEX "cobranza_aplicaciones_comprobante_ix" ON "cobranza_aplicaciones" USING btree ("comprobante_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cobranzas_uk" ON "cobranzas" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE INDEX "cobranzas_cliente_ix" ON "cobranzas" USING btree ("empresa_id","cliente_id");