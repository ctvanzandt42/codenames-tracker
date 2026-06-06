.PHONY: setup dev dev-bg stop reset status logs functions build

# Copy env file templates (safe — won't overwrite existing files)
setup:
	@cp -n .env.example .env 2>/dev/null && echo "Created .env" || echo ".env already exists"
	@cp -n .env.local.example .env.local 2>/dev/null && echo "Created .env.local" || echo ".env.local already exists"
	@cp -n supabase/functions/.env.example supabase/functions/.env 2>/dev/null && echo "Created supabase/functions/.env" || echo "supabase/functions/.env already exists"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Fill in Google OAuth credentials in .env"
	@echo "  2. Run: make dev"
	@echo "  3. Run: make status  (in another tab) to get the anon key for .env.local"

# Start the full local stack (Supabase + React dev server)
dev:
	supabase start
	docker compose up

# Same but detached
dev-bg:
	supabase start
	docker compose up -d

# Stop everything
stop:
	docker compose down
	supabase stop

# Wipe local DB and re-apply migrations + seed
reset:
	supabase db reset

# Print local URLs and JWT keys
status:
	supabase status --output env

# Stream React dev server logs
logs:
	docker compose logs -f app

# Run edge functions locally with hot reload
functions:
	supabase functions serve

# Rebuild the React Docker image (use after Dockerfile changes)
build:
	docker compose build --no-cache
