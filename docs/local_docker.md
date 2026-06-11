# DOCNOW Local Docker Development

This Docker setup is for local development and onboarding only. It does not replace the current EC2, PM2, Nginx, and Let's Encrypt production deployment.

## Services

- `client`: Next.js development server on `http://localhost:3000`
- `server`: Express API on `http://localhost:5000`
- `postgres`: local PostgreSQL on `localhost:5432`
- `redis`: local Redis on `localhost:6379`
- `redis-http`: Upstash-compatible HTTP bridge on `localhost:8079`

The backend uses the Upstash Redis REST SDK, so Docker runs both Redis and an HTTP bridge. This keeps local rate limiting and worker locks close to production without requiring a real Upstash account.

## Start Everything

```bash
docker compose up --build
```

The server container runs:

```bash
npx prisma generate
npx prisma migrate deploy
npm run dev
```

That applies committed Prisma migrations to the local Docker database. It does not create new migration files.

## Stop Everything

```bash
docker compose down
```

To also remove local database and Redis volumes:

```bash
docker compose down -v
```

## Environment Files

Docker Compose uses:

- `server/.env.docker.example`
- `client/.env.docker.example`

These files contain safe local placeholders. Keep real production secrets in the existing deployment environment, not in Docker example files.

## Useful Commands

Run server tests:

```bash
docker compose exec server npm test
```

Run server Prisma validation:

```bash
docker compose exec server npm run prisma:validate
```

Open a database shell:

```bash
docker compose exec postgres psql -U docnow -d docnow
```

## Production Note

The current production deployment remains EC2 + PM2 + Nginx. Use the Dockerfiles for local development and future deployment experiments only until a production Docker rollout is tested, documented, and reversible.
