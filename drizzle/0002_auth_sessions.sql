ALTER TYPE "public"."user_role" ADD VALUE 'teacher' BEFORE 'admin';--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"access_token_hash" varchar(64) NOT NULL,
	"refresh_token_hash" varchar(64) NOT NULL,
	"previous_refresh_token_hash" varchar(64),
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"client_name" varchar(64) DEFAULT '未知设备' NOT NULL,
	"client_type" varchar(16) DEFAULT 'web' NOT NULL,
	"ip" varchar(45) DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "auth_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "auth_login_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_login_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer,
	"student_no" varchar(20) NOT NULL,
	"success" boolean NOT NULL,
	"failure_reason" varchar(32),
	"ip" varchar(45) DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"session_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_login_logs" ADD CONSTRAINT "auth_login_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_alive_idx" ON "auth_sessions" USING btree ("user_id") WHERE "auth_sessions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "auth_sessions_refresh_expires_idx" ON "auth_sessions" USING btree ("refresh_expires_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_previous_refresh_idx" ON "auth_sessions" USING btree ("previous_refresh_token_hash") WHERE "auth_sessions"."previous_refresh_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_login_logs_user_idx" ON "auth_login_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_login_logs_attempt_idx" ON "auth_login_logs" USING btree ("student_no","ip","created_at");--> statement-breakpoint
CREATE INDEX "auth_login_logs_created_idx" ON "auth_login_logs" USING btree ("created_at") WHERE "auth_login_logs"."deleted_at" IS NULL;