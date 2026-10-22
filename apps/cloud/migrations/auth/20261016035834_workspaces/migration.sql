CREATE TABLE "auth"."team_owner" (
	"id" text PRIMARY KEY,
	"team_member_id" text NOT NULL UNIQUE,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."organization" ADD COLUMN "invite_policy" text DEFAULT 'admins';--> statement-breakpoint
ALTER TABLE "auth"."organization" ADD COLUMN "team_creation_policy" text DEFAULT 'members';--> statement-breakpoint
CREATE INDEX "teamOwner_teamId_idx" ON "auth"."team_owner" ("team_id");--> statement-breakpoint
CREATE INDEX "teamOwner_userId_idx" ON "auth"."team_owner" ("user_id");--> statement-breakpoint
ALTER TABLE "auth"."team_owner" ADD CONSTRAINT "team_owner_team_member_id_team_member_id_fkey" FOREIGN KEY ("team_member_id") REFERENCES "auth"."team_member"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."team_owner" ADD CONSTRAINT "team_owner_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "auth"."team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."team_owner" ADD CONSTRAINT "team_owner_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;