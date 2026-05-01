--> Enables the pgvector extension for transcript and summary embeddings.
--> Idempotent so the migration is safe to re-run.

--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
