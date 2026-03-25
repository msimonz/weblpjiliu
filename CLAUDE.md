# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WebNotas JILIU | La Promesa** — Academic management platform (grades, courses, subjects, evaluations) for a church school. Three roles: Admin (A), Teacher (T), Student (S). Internal use only.

## Monorepo Structure

- **`backend/`** — Express 5 API (ES modules, `"type": "module"`)
- **`frontend/`** — Next.js 16 (App Router) with static export (`output: "export"`)
- **`supabase/`** — DDL scripts and ERD reference

## Development Commands

### Backend (port 3001)
```bash
cd backend && npm install && npm run dev
```

### Frontend (port 3000)
```bash
cd frontend && npm install && npm run dev
```

### Frontend lint
```bash
cd frontend && npm run lint
```

### Frontend production build (static export to `frontend/out/`)
```bash
cd frontend && npm run build
```

### Run ETM sync job manually
```bash
cd backend && npm run job:etm
```

## Architecture

### Auth Flow
1. Frontend authenticates via Supabase Auth (JWT)
2. `apiFetch` (`frontend/src/lib/api.ts`) attaches the Bearer token to every backend call
3. Backend `authMiddleware` (`backend/src/middlewares/auth.js`) validates JWT via `supabaseAdmin.auth.getUser(token)`, loads the user's profile from `users` table and roles from `user_type` bridge table
4. Route guards: `requireAuth` (needs profile), `requireUser` (needs token only), `requireRole(...codes)` (checks role codes)

### Role System
- Roles are stored in `user_type` bridge table linking users to `type` table
- Role codes: `"A"` (Admin), `"T"` (Teacher), `"S"` (Student)
- Priority: A > T > S (when user has multiple roles, highest wins)
- Frontend role helpers in `frontend/src/lib/roles.ts`

### Backend
- Entrypoint: `backend/server.js`
- Uses `supabaseAdmin` (service role key) for all DB operations — no direct Postgres driver
- Routes: `admin.js`, `teacher.js`, `student.js`, `auth.js`, `health.js` under `backend/src/routes/`
- File uploads handled with `multer`; Excel parsing with `xlsx`
- Validation with `zod`
- Optional cron jobs via `node-cron` (`backend/src/schedulers.js`)

### Frontend
- Static export — no server-side rendering in production
- `apiFetch` reads `NEXT_PUBLIC_API_BASE_URL` env var (defaults to `http://localhost:3001`)
- Tailwind CSS v4 for styling
- Pages: `/login`, `/dashboard` (student), `/admin`, `/teacher`, `/update-password`
- Shared components: `Header`, `Footer`, `ChangePasswordButton`
- Supabase client initialized in `frontend/src/lib/supabaseClient.ts`

### Database
- Supabase Postgres with key tables: `users`, `user_type`, `type`, `course`, `class` (subjects), evaluations, grades
- ERD available at `supabase/DER.png`, DDL at `supabase/SupabaseDDL.sql`

## Deployment

- **Backend**: Render Web Service (Node), listens on `process.env.PORT`
- **Frontend**: Render Static Site, publishes `out/` directory
- CORS origins configured in `backend/server.js` — must include the frontend's Render domain
- `NEXT_PUBLIC_*` env vars are baked into the static build at build time

## Key Conventions

- Backend uses ES module imports (`import`/`export`, `.js` extensions in import paths)
- The project and its README are written in Spanish
- `next.config.ts` uses `module.exports` (CommonJS export despite `.ts` extension)

## Aditional Recommendations
- Don't modify code or files if Alex or Simon haven't told you to do so.
- We are building the virtual campus for a christian university.
- Alway mantain the styles as they are, dont modify the styles unless Simon or Alex tell you to do so.