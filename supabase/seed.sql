-- Seed data for local development.
-- Add any test data here — it runs after migrations on `supabase db reset`.

-- Enable pgTAP for database-level RLS tests (supabase test db).
create extension if not exists pgtap;
