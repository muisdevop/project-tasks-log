# Project Tasks Log

Single-user web app for:
- Login
- Create/select projects
- Create/select tasks
- Auto time logging using configured working hours and work days
- Complete/cancel/resume task flow

## Tech Stack

- Next.js (App Router) + TypeScript
- Prisma + SQLite
- Cookie session auth with `jose`

## Setup

1. Install dependencies:
   - `npm install`
2. Configure environment variables (copy `.env.example` to `.env` if needed):
   - `DATABASE_URL`
   - `APP_USERNAME`
   - `APP_PASSWORD`
   - `SESSION_SECRET`
3. Run migration:
   - `npm run db:migrate`
4. Seed default settings:
   - `npm run db:seed`

## Run

- Development: `npm run dev`
- Lint: `npm run lint`
- Tests: `npm run test`

## Task Time Rules

- New task starts in `in_progress`.
- On complete/cancel, elapsed time is calculated with working-window overlap only.
- Non-working hours are excluded.
- Cross-day handling works with settings:
  - Example: start 1h before day end and complete next day after 3h from day start -> total 4h.
- Cancelled tasks can be resumed; prior elapsed time is preserved.

## Password behavior

- Login checks DB password hash first (`UserSettings.passwordHash`).
- If no DB password hash exists yet, it falls back to `.env` `APP_PASSWORD`.
- You can change password from the `Settings` page; this updates the DB hash without redeploying.

## Deploy (standalone build)

After `npm run build`, upload the folder:
- `.next/standalone`

Run on the target machine:
- `node server.js`

The standalone folder already includes `dev.db` and `.env` for the defaults (you can edit `.env` in that folder for real deployments).

## Docker / Coolify

This project includes a production `Dockerfile` and `docker-compose.yml`.

### Local (Docker)
- `docker compose up --build`
- Open: `http://localhost:3000`

### Environment variables
The container uses SQLite at `file:/data/dev.db` (stored in a Docker volume).
At minimum, set:
- `APP_USERNAME`
- `APP_PASSWORD` (initial password; after that, password is stored in DB and can be changed from Settings)
- `SESSION_SECRET`

Coolify can build/run using the `Dockerfile` automatically.
