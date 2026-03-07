# WebNotas · JILIU | La Promesa

Plataforma web para **gestión académica** (roles: **Admin / Teacher / Student**) con autenticación en **Supabase**, paneles por rol, y un backend en **Express** que expone APIs para administrar cursos, materias, evaluaciones y notas.

Este repositorio está organizado como **monorepo**:

```
/
├─ backend/      # API Express (Node)
├─ frontend/     # Next.js (App Router) export estático
└─ supabase/     # scripts/config (si aplica)
```

> Nota: En algunas ramas se trabajó una capa de integración con EasyTestMaker/ClassroomClipboard (ETM).  
> Esta guía documenta el proyecto completo y, cuando corresponde, indica qué aplica **solo si ETM está habilitado**.

---

## 1) Arquitectura general

- **Frontend**: Next.js (App Router) con `output: "export"` para despliegue como sitio estático.
- **Backend**: Express (Node) con rutas `/api/*` y middleware de auth.
- **Auth**: Supabase Auth (JWT) desde el frontend; el backend valida el token y deriva el rol.
- **DB**: Supabase Postgres con tablas de usuarios, cursos, materias (class), evaluaciones, notas, etc.
- **(Opcional) Jobs**: scripts tipo cron (ETM weekly sync u otros). Pueden vivir en `backend/src/jobs` o moverse a `job/` como servicio separado (recomendado si quieres aislar deploys).

---

## 2) Estructura de carpetas

### Backend (`/backend`)
```
backend/
├─ src/
│  ├─ jobs/              # scripts (cron/local runner)
│  ├─ middlewares/       # auth middleware
│  ├─ routes/            # admin.js, teacher.js, student.js, auth.js, health.js
│  ├─ schedulers.js      # (si aplica)
│  └─ supabase.js        # supabaseAdmin (service role)
├─ server.js             # entrypoint Express
├─ package.json
└─ .env                  # variables locales (NO se sube a git)

```

### Frontend (`/frontend`)
```
frontend/
├─ src/
│  ├─ app/   
│  │  ├─ admin/
│  │  ├─ dashboard/
│  │  ├─ login/
│  │  ├─ teacher/
│  │  ├─ update-password/
│  │  ├─ globals.css
│  │  ├─ layout.tsx
│  │  └─ page.tsx
│  ├─ components/ 
│  └─ lib/        
├─ next.config.ts
├─ package.json
└─ .env.local            # variables locales (NO se sube a git)
````
---

## 3) Backend (Express) — qué hace

- Expone APIs bajo `/api/*`
- Middleware `authMiddleware` valida JWT de Supabase (`Authorization: Bearer <token>`)
- Resuelve `req.auth.user`, `req.auth.profile`, `req.auth.role`, etc.
- Rutas principales:
  - `/api/auth/*`
  - `/api/admin/*`
  - `/api/teacher/*`
  - `/api/student/*`
  - `/health` (health check para Render + UptimeRobot)

### Health endpoint
- **GET** `/health` → `{"ok": true}`

---

## 4) Frontend (Next.js) — qué hace

- Login con Supabase Auth
- Redirección por rol (Admin/Teacher/Student)
- Dashboard del estudiante:
  - Resumen por año
  - Consulta de materias/notas por año
- UI global con Header/Footer

### API client (frontend → backend)
La función `apiFetch` centraliza llamadas al backend, adjunta el token y maneja errores.

---

## 5) Variables de entorno

### Backend (`backend/.env` en dev)
Mínimas (sin ETM):
```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
JOB_TZ=America/Bogota
````

Opcionales (solo si ETM está habilitado):

```env
ETM_BASE_URL=...
ETM_LOGIN_URL=...
ETM_USERNAME=...
ETM_PASSWORD=...
ETM_GET_RESULTS_PATH=...
ETM_CLASSROOM_BASE=https://www.classroomclipboard.com
ETM_CLASSROOM_BASE_PATH_TES=api/tests
ETM_CLASSROOM_ID=...
ETM_PUBLIC_PIN=...
ETM_REAL_ACCESS_CODE=...
```

> Importante: En Render estas variables se configuran en el panel del servicio (no con `.env`).

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_BASE=http://localhost:3001
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

En producción:

* `NEXT_PUBLIC_API_BASE` debe ser el dominio del backend desplegado (Render).
* Las variables `NEXT_PUBLIC_*` quedan embebidas en el build estático.

---

## 6) Correr para Desarrollo Local

### 6.1 Backend

```bash
cd backend
npm install
npm run dev
```

Debe levantar en `http://localhost:3001`

Probar health:

```bash
curl http://localhost:3001/health
```

### 6.2 Frontend

```bash
cd frontend
npm install
npm run dev
```

Debe levantar en `http://localhost:3000`

---

## 7) Build estático del frontend (producción)

Este proyecto usa export estático con Next.js.

### 7.1 Config de Next

En `frontend/next.config.js`:

* `output: "export"`
* `images.unoptimized: true`
* `remotePatterns` para imágenes de Supabase Storage

### 7.2 Build

```bash
cd frontend
npm install
npm run build
```

> Si tu pipeline aún tiene un script viejo con `next export`, elimínalo.
> En Next moderno, `output: "export"` ya hace el export estático durante el build.

El output queda en:

* `frontend/out/` (sitio estático)

---

## 8) Despliegue en Render (cómo está desplegado)

### 8.1 Backend → Web Service (Node)

En Render:

* **Service Type**: Web Service
* **Language**: Node
* **Branch**: `prod` (o la rama que uses)
* **Root Directory**: `backend`
* **Build Command**: `npm ci`
* **Start Command**: `npm start` (o `node server.js` si así está)
* **Health Check Path**: `/health`
* **Env Vars**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

✅ Render asigna un puerto dinámico en `PORT`.
Tu backend debe escuchar:

```js
const port = Number(process.env.PORT || 3001);
app.listen(port, ...)
```

### 8.2 Frontend → Static Site

En Render:

* **Service Type**: Static Site
* **Root Directory**: `frontend`
* **Build Command**: `npm ci && npm run build`
* **Publish Directory**: `out`

**Environment Variables (Build-time):**

* `NEXT_PUBLIC_API_BASE=https://<tu-backend>.onrender.com`
* `NEXT_PUBLIC_SUPABASE_URL=...`
* `NEXT_PUBLIC_SUPABASE_ANON_KEY=...`

### 8.3 Cron Job 

Opción 1 (jobs dentro del backend):

* **Service Type**: Cron Job
* **Root Directory**: `backend`
* **Build Command**: `npm ci`
* **Start Command**: `node src/jobs/run_etm_weekly.js` (ajusta al script real)
* **Schedule**: el que definas


## 9) CORS en producción (backend)

Si el frontend está en otro dominio, el backend debe permitirlo en CORS.

Ejemplo recomendado:

```js
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://feLaPromesaxJILIU.onrender.com"
  ],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
}));
```

> En Render el error típico es: falta permitir el dominio del frontend en `origin`.

---

## 10) Troubleshooting rápido

### 10.1 “CORS blocked”

* Agrega el dominio del frontend en `origin` del backend.
* Verifica que el frontend apunte a `NEXT_PUBLIC_API_BASE` correcto.

### 10.2 Render deploy falla por `PORT`

* Asegúrate de escuchar `process.env.PORT` (no un puerto fijo).

### 10.3 Next build: `next export has been removed`

* Elimina scripts que hagan `next export`.
* Deja `output: "export"` en `next.config.js`.
* Usa `npm run build`.

### 10.4 `zsh: command not found: next`

* Falta instalar dependencias:

  * `npm install`
  * luego `npm run build`

---

## 11) Scripts útiles

### Backend

* `npm run dev` → desarrollo
* `npm start` → producción

### Frontend

* `npm run dev` → desarrollo
* `npm run build` → build estático (producción)

---

## 12) Seguridad y buenas prácticas

* Nunca subir `.env` / `.env.local`
* Usar `SUPABASE_SERVICE_ROLE_KEY` solo en backend/jobs (nunca en frontend)
* Validar que un usuario solo consulte/actualice datos permitidos por rol
* En producción, limitar CORS a dominios necesarios

---

## 13) Licencia

Uso interno / Iglesia La Promesa.

---

## 14) UptimeRobot (Health monitor):
* URL: `https://beLaPromesaxJILIU.onrender.com/health`
* Método: GET
* Intervalo: 5 min (free)
* Alert contacts: email
