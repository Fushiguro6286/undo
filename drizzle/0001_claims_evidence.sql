ALTER TABLE "claims" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "delivery_contested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "photo" "bytea" NOT NULL;