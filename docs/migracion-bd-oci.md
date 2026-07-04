# Migración de Supabase a Postgres (VM propia en OCI)

Plan de trabajo y seguimiento para migrar WebNotas JILIU de Supabase (DB + Auth + Storage) a una VM PostgreSQL 18 auto-gestionada en Oracle Cloud Infrastructure (OCI).

Este documento es la fuente de verdad del avance. Cada paso se marca `[x]` cuando queda terminado y verificado.

## Contexto / decisiones ya tomadas

- **Motor de BD**: PostgreSQL 18 corriendo en una VM creada manualmente en OCI (no Oracle Autonomous DB). El driver `pg` (ya agregado a `backend/package.json`) es compatible tal cual.
- **Auth**: migra completamente fuera de Supabase. Se construye autenticación propia (JWT firmado por el backend) en vez de `supabaseAdmin.auth.*`.
- **Hashes de contraseña**: el schema `auth.users` de Supabase (con hashes bcrypt) sí fue copiado a la VM, por lo que los usuarios existentes **no** necesitan resetear su contraseña — se puede verificar con `bcrypt.compare` contra el hash migrado.
- **Conectividad**: el backend (hoy en Render) se conecta a la VM por IP pública / allowlist en el Security List o NSG de OCI.
- **Storage**: el único uso de Supabase Storage es el logo público (`assets/brand/logo.png`) en 7 páginas del frontend — bajo esfuerzo, se resuelve como asset estático.
- Inventario de todos los usos de Supabase ya generado en `backend/src/usos/*.txt` (usar como checklist al reescribir cada archivo).

## Estado general

| Fase | Estado |
|---|---|
| Fase 0 — Descubrimiento y decisiones base | ✅ Completa |
| Fase 1 — Capa de datos (`pg`) | ✅ Completa |
| Fase 2 — Autenticación propia | ✅ Completa |
| Fase 3 — Frontend | ✅ Completa |
| Fase 4 — Infraestructura / despliegue | ⏳ Casi completa (bloqueada en el último punto hasta el deploy) |
| Fase 5 — Validación y corte | Pendiente |

---

## Fase 0 — Descubrimiento y decisiones base

- [x] Probar conectividad `psql`/`pg` desde el entorno de desarrollo contra la VM de OCI. **OK** — Postgres 18.4, SSL requerido y funcionando.
- [x] Verificar que el Security List / NSG de OCI permite la IP de salida de Render (o definir alternativa si Render no ofrece IP fija). **Pendiente de endurecer**: el puerto 26432 respondió sin estar en ninguna allowlist conocida — parece abierto a internet. Revisar y restringir a los rangos de salida de Render antes de ir a producción.
- [x] Inventariar la estructura real de `auth.users` migrada a la VM (columnas, formato del hash, constraints). Schema `auth` completo (GoTrue de Supabase) presente, 66 filas, hashes `bcrypt` (`$2a$10$...`) estándar.
- [x] Confirmar integridad de `public.*` en la VM (conteo de filas por tabla vs. Supabase original). 24 tablas en `public`, conteos coherentes (ver registro de avance). No se pudo comparar 1:1 contra Supabase por restricción de red del entorno de desarrollo (DNS de `supabase.co` bloqueado) — pendiente de verificación manual por Alex si se quiere confirmar exacto.
- [x] Decidir modelo de usuarios: mantener `auth.users` + `public.users` separados (como Supabase) o consolidar en una sola tabla. **Decisión**: mantener la forma física actual (`public.users.id` ya es FK a `auth.users.id`). El backend deja de usar la API GoTrue y pasa a leer/escribir `auth.users` (id, email, encrypted_password) y `public.users` directamente con SQL. Las tablas GoTrue no usadas (`refresh_tokens`, `sessions`, `mfa_*`, `sso_*`, `oauth_*`) se ignoran.

## Fase 1 — Capa de datos (`pg`)

- [x] Completar `backend/src/db.js` con env vars `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/DB_SSL`. Probado end-to-end contra la VM de OCI.
- [x] Reescribir `backend/src/lib/anioLectivo.js` (Supabase → SQL con `pg`). Verificado en vivo contra la VM (año vigente 2026, `requireAnioVigenteForCourse`/`ForRecord` OK, whitelist de tablas bloqueando nombres no permitidos).
- [x] Reescribir `backend/src/lib/gradesBootstrap.js`. Verificado en vivo: inserción bulk con `ON CONFLICT (id_student, id_exam) DO NOTHING` es idempotente (582 filas en `grades` antes y después de dos corridas).
- [x] Reescribir `backend/src/lib/examClosure.js`. Corrido en vivo: sin errores SQL contra las 24 filas de `examen_programacion` (todas ya vencidas). ⚠️ Las ramas de escritura (`closeStartedExam`, marcar ausente, actualizar calificación tardía) no se ejercitaron en vivo porque todos los datos migrados ya estaban cerrados desde Supabase — reusan patrones SQL ya verificados en `gradesBootstrap.js`. Recomendado: reverificar cuando haya un examen real pendiente de cierre, antes del cutover final.
- [x] Reescribir `backend/src/routes/admin.js` (consultas de datos, no auth). El archivo más grande (3299 líneas, 53 endpoints). Verificado en vivo: 21 endpoints GET con datos reales, y todos los endpoints de escritura (courses, classes, evaluation-types, assign/unassign-teacher, evaluations, grades, evaluations/bulk, exams + examen_detalle, exam-schedules, exam-attempts, anio-lectivo, save-assignment-grid) probados dentro de transacciones con `ROLLBACK`. Confirmado por diff de rutas que ningún endpoint se perdió (53/53 idénticos al original). Quedan **intencionalmente sin migrar** 4 handlers acoplados a Supabase Auth (`/upload-users`, `/create-user`, `/update-user-by-cedula`, `/delete-user` ×2 — el segundo es código muerto duplicado que ya existía en el original) — se migran en bloque en la Fase 2.
- [x] Reescribir `backend/src/routes/teacher.js`. Verificado en vivo: 12 endpoints GET (dashboard, classes, courses, levels, evaluations, class/group-grade-grid, grade-grids-batch, attendance) responden con datos reales. Escrituras (crear/editar/borrar evaluación, subir nota, crear examen+preguntas) validadas dentro de una transacción con `ROLLBACK`.
  - **Bug real encontrado y corregido**: `bigint`/`numeric` de Postgres vienen como *string* con el driver `pg` (Supabase los devolvía como número JSON), lo que rompía un `Map` keyed por `class.id` en `grade-grids-batch`. Corregido centralizadamente en `backend/src/db.js` con `pg.types.setTypeParser` para `int8` (20) y `numeric` (1700) → number, restaurando el comportamiento anterior para todo el código ya migrado.
- [x] Reescribir `backend/src/routes/student.js`. Verificado en vivo: 10 endpoints GET (incluyendo joins anidados de `exam-available`, `grades`, `subjects-summary`, `my-courses`) responden con datos reales. Los endpoints de escritura (`start`/`save-answer`/`submit`) no tienen ninguna ventana de examen activa en los datos migrados para probarlos orgánicamente — se validó el SQL exacto dentro de una transacción con `ROLLBACK` (sin persistir nada).
- [x] Reescribir `backend/src/routes/secretaria.js`. Verificado en vivo: los 7 endpoints (todos de solo lectura) responden correctamente con datos reales.
- [x] Reescribir `backend/src/routes/monitor.js`. Verificado en vivo invocando los 12 handlers directamente (sin pasar por `requireAuth`, ya que Supabase Auth no es alcanzable desde este entorno): todos los GET responden con datos reales, y el `POST /attendance` (upsert sesión+detalle) probado con echo de datos existentes sin alterar nada.
- [x] Convertir embeds de Supabase (`.select("course:course!fk(...)")`) a JOIN explícitos donde aparezcan. Hecho archivo por archivo a medida que se migraba cada uno (incluye joins anidados de 3 niveles en `student.js`/`admin.js`, ej. evaluation→class→module).
- [x] Reescribir `backend/src/routes/auth.js` (no estaba en la lista original, encontrado al auditar: usa `supabaseAdmin.from()` puro, sin tocar `auth.admin.*`, así que correspondía a esta fase). Verificado en vivo: `/resolve-login` e `/impersonate` con datos reales; `/profile` (upsert perfil + rol S) validado en transacción con `ROLLBACK`.

## Fase 2 — Autenticación propia

- [x] Construir `POST /auth/login` (verifica bcrypt contra `auth.users`, emite JWT propio). Usa `bcryptjs` (puro JS, compatible con hashes `$2a$` generados por GoTrue) y `jsonwebtoken`. Agregadas `JWT_SECRET`/`JWT_EXPIRES_IN` (7 días) a `.env`. Verificado: rechaza contraseña incorrecta contra un hash real migrado sin errores; sanity check de `bcryptjs` hash/compare confirmado. **Nota**: 7 días es un valor pragmático sin infraestructura de refresh token — ajustar si se quiere una sesión más corta.
- [x] Middleware de verificación de JWT propio, reemplazando `supabaseAdmin.auth.getUser` en `backend/src/middlewares/auth.js`. `loadProfileAndRoles` migrado a SQL directo. Verificado: token válido carga perfil/roles correctamente, token con firma inválida y token expirado se rechazan con 401.
- [x] Confirmar que `backend/src/lib/impToken.js` (impersonación) sigue funcionando sin cambios sobre el nuevo middleware. Verificado en vivo: token de impersonación pasa por `requireAuth` y resuelve rol/roles correctamente.
- [x] Reescribir gestión de usuarios (`createUser`/`updateUserById`/`deleteUser`/`listUsers`) en `admin.js` como SQL directo. Nuevos helpers `createAuthUser`/`updateAuthUser`/`deleteAuthUser` en `admin.js` (usan `bcryptjs` + SQL contra `auth.users`; `gen_random_uuid()` vía extensión `pgcrypto` ya presente en la VM). `admin.js` ya no importa `supabaseAdmin` en absoluto. Verificado extremo a extremo con los handlers reales: crear usuario → login con clave por defecto → actualizar (email/nombre/roles) → login de nuevo → borrar → confirmado sin filas huérfanas en `auth.users`/`public.users`.
- [x] Reescribir `backend/src/changePsswd.js` (script de mantenimiento aparte, resetea todas las contraseñas a `123456`; migrado a SQL pero no ejecutado por ser destructivo).
- [x] Reescribir el flujo de `/update-password` (backend). Como Supabase Auth ya no envía el correo de recuperación, se construyó un flujo propio: tabla `password_reset_tokens` (un solo uso, expira en 30 min) + envío por Gmail SMTP (`nodemailer`, credenciales en `.env`: `SMTP_*`). Nuevos endpoints `POST /auth/forgot-password` y `POST /auth/reset-password`. Verificado extremo a extremo con un usuario de prueba real: pedir reseteo → envío SMTP aceptado por Gmail sin error → token capturado → reset exitoso → reuso del token bloqueado → login con la nueva contraseña. **Pendiente para la Fase 3**: reconectar `ChangePasswordButton.tsx` y `/update-password/page.tsx` del frontend a estos nuevos endpoints (hoy siguen llamando a `supabase.auth.resetPasswordForEmail`/`updateUser`).

## Fase 3 — Frontend

- [x] Nuevo módulo `frontend/src/lib/auth.ts`: reemplaza la sesión de supabase-js. Guarda el JWT propio en `sessionStorage` (aislado por pestaña, igual que antes), lo decodifica en el cliente (sin verificar firma, eso lo hace el backend) para leer `email`/`exp`, y expone `getSession()`/`setToken()`/`signOut()` síncronos (ya no hace falta refrescar sesión — no hay refresh token, el JWT dura 7 días).
- [x] `frontend/src/lib/api.ts` simplificado: ya no depende de Supabase para obtener/refrescar el token; un 401 del backend implica sign-out inmediato (no hay retry-tras-refresh porque no hay refresh token).
- [x] Reemplazado `supabase.auth.signInWithPassword` en `login/page.tsx` por `POST /api/auth/login`, y `resetPasswordForEmail` por `POST /api/auth/forgot-password`.
- [x] Reemplazado el guard de sesión (`supabase.auth.getSession()`) y el logout (`supabase.auth.signOut()`) en las 5 páginas de rol (`dashboard`, `monitor`, `secretaria`, `teacher`, `admin`) por `getSession()`/`signOut()` propios.
- [x] `admin/page.tsx`: los dos `fetch` manuales de descarga/subida de Excel (`downloadTemplate`, `uploadExcelUsers`) ahora usan `getToken()` en vez de `supabase.auth.getSession()`.
- [x] `update-password/page.tsx` reescrito de fondo: ya no depende de la sesión temporal de Supabase — lee el `token` de un solo uso de la URL (`?token=...`, generado por `/auth/forgot-password`) y llama a `POST /api/auth/reset-password`.
- [x] `ChangePasswordButton.tsx` actualizado para llamar a `POST /api/auth/forgot-password` (se eliminó el prop `redirectPath`, ya sin uso — el link lo arma el backend con `FRONTEND_URL`).
- [x] Movido el logo de Supabase Storage a un asset estático (`frontend/public/logo.png` ya existía) — quitados los 7 usos de `supabase.storage.from("assets")`.
- [x] Eliminado `frontend/src/lib/supabaseClient.ts` y la dependencia `@supabase/supabase-js` del frontend (`npm uninstall`). Limpiadas `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` de `.env.local` (ya no las lee nadie).
- [x] `npm run lint` y `npx tsc --noEmit` pasan limpios.
- [x] **Verificado en un navegador real** (Firefox vía Playwright, headless — Chromium no arrancó por librerías faltantes sin acceso root en este entorno): login end-to-end contra un usuario de prueba creado vía API (`/teacher` cargó con datos reales, JWT en `sessionStorage`), logout (limpia el token, redirige a `/login`), y el modal "¿Olvidó su contraseña?" (envía sin error). Sin errores de consola. Usuario de prueba eliminado al final.

## Fase 4 — Infraestructura / despliegue

- [x] Actualizar variables de entorno en Render (backend, servicio DEV/QA): quitadas `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, agregadas `DB_*`, `JWT_*`, `SMTP_*`, `FRONTEND_URL` (`https://qa-sofialapromesa.onrender.com`). Confirmado que DEV/QA comparten un solo servicio de Render, separado de `prod` (no tocado). Falta: pushear/mergear el código para que el redeploy tome estas variables.
- [x] Actualizar variables de entorno en Render (frontend, servicio DEV/QA): quitadas `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`NEXT_PUBLIC_USERS_TEMPLATE_URL` (código muerto, confirmado por búsqueda en el código — nada las lee). Queda solo `NEXT_PUBLIC_API_BASE_URL` (correcta, apunta al backend `qa-belapromesaxjiliu.onrender.com`). Aclarado el malentendido de nombres: `qa-belapromesaxjiliu` es el **backend**, `qa-sofialapromesa` es el **frontend**.
- [x] Revisar CORS: `CORS_ORIGINS` en Render incluye el dominio real del frontend DEV/QA.
- [ ] Revisar configuración SSL de la conexión a la VM desde Render (ya confirmado que funciona desde este entorno de desarrollo; **bloqueado hasta que se despliegue el código** — requiere push/merge, que Alex pidió no hacer todavía).

- **2026-07-04**: Corridas `changePsswd.js` a pedido de Alex — las 66 contraseñas de `auth.users` reseteadas a `123456`, para poder validar login con usuarios reales durante la Fase 5.

## Fase 5 — Validación y corte

- [x] Probar flujo completo en local contra la VM de OCI (login, notas, cierre de exámenes, reportes). Validado manualmente por Alex — `dev` levanta bien en local (resuelto de paso un error de Next.js por Dropbox bloqueando `frontend/.next`).
- [ ] Probar en QA/staging.
- [ ] Cutover en producción.
- [ ] Mantener Supabase activo de solo lectura como respaldo por un período prudencial.
- [ ] Eliminar `backend/src/supabase.js`, la dependencia `@supabase/supabase-js` del backend, y los archivos temporales de inventario en `backend/src/usos/`.

---

## Registro de avance

_(Se agrega una entrada breve por sesión de trabajo, con fecha, qué se hizo y qué quedó pendiente.)_

- **2026-07-04**: Plan creado. Definidas las decisiones base de la Fase 0 (motor Postgres 18, auth propio, hashes bcrypt migrados, conectividad por IP pública).
- **2026-07-04**: Fase 0 completada. Credenciales agregadas a `backend/.env` (`DB_HOST/PORT/NAME/USER/PASSWORD/SSL`; ojo con caracteres especiales en `DB_PASSWORD`, requieren comillas en `.env`). Conexión verificada por `psql` y por `pg`/`db.js`. Confirmado schema `auth` completo migrado (66 usuarios, hashes bcrypt válidos) y 24 tablas en `public` con conteos coherentes. Decidido mantener `auth.users`/`public.users` separados. Pendiente: restringir el Security List de OCI a las IPs de Render (hoy parece abierto), y que Alex confirme conteos exactos contra Supabase si lo considera necesario.
- Conteos de `public.*` en OCI (referencia): anio_lectivo 1, asistencia_detalle 366, asistencia_sesion 26, attendance 0, aux 271, class 156, class_teacher 156, course 4, evaluation 47, evaluation_type 4, exam_grades 0, examen_detalle 242, examen_programacion 24, grades 582, group 14, level 4, materias 156, module 52, notas 256, rta_examen 150, type 5, user_history 52, user_type 77, users 66.
- **2026-07-04**: Confirmado por Alex que el puerto/IP de la VM no están expuestos abiertamente — la IP de este entorno fue agregada manualmente al Security List de OCI. `backend/src/lib/anioLectivo.js` reescrito a `pg` y verificado end-to-end contra la VM. Siguiente: continuar con el resto de archivos de la Fase 1.
- **2026-07-04**: Fase 2 completada. Login propio (`POST /auth/login`) + middleware JWT (`jsonwebtoken`) reemplazando `supabaseAdmin.auth.getUser`. Gestión de usuarios en `admin.js` migrada a SQL directo contra `auth.users` con helpers `createAuthUser`/`updateAuthUser`/`deleteAuthUser` (`bcryptjs` + `gen_random_uuid()`) — `admin.js` ya no importa `supabaseAdmin` en absoluto. Flujo de "olvidé mi contraseña" reconstruido desde cero (Supabase ya no lo puede hacer): tabla nueva `password_reset_tokens` en la VM + envío de correo real por Gmail SMTP (cuenta `sofialapromesa@gmail.com`, contraseña de aplicación en `.env`). Todo verificado extremo a extremo con usuarios de prueba reales, sin dejar residuos. Único pendiente de esta fase: reconectar el frontend (`ChangePasswordButton.tsx`, `/update-password`) a los nuevos endpoints — queda para la Fase 3.
- **2026-07-04**: Commit `302318d` en `dev` con todo el trabajo de las Fases 1-3 (backend + frontend). **Sin pushear y sin mergear a `qa`** — Alex pidió explícitamente no mergear todavía. Confirmado que hay servicios de Render separados por rama (dev/qa comparten uno solo, y `prod` es aparte) — los cambios de variables de entorno de la Fase 4 son solo para ese servicio de dev/qa. Acceso de red ya configurado por Alex en el Security List de OCI para las IPs de salida de Render.
- **2026-07-04**: Corregido `FRONTEND_URL` en Render (DEV/QA) a `https://qa-sofialapromesa.onrender.com` — es el dominio real del frontend (`qa-belapromesaxjiliu.onrender.com` era un nombre viejo). `CORS_ORIGINS` quedó con ambos dominios, sin problema. Variables de entorno del backend DEV/QA en Render cargadas por Alex (`DB_*`, `JWT_*`, `SMTP_*`, `FRONTEND_URL`); código todavía no pusheado/mergeado.
- **2026-07-04**: Push de `dev` a `origin/dev` (`9985620..302318d`). **Sin mergear a `qa` todavía** — el deploy de Render sale de la rama `qa`, así que esto no dispara nada en Render aún.
- **2026-07-04**: Fase 3 completada. Todo el frontend migrado de `supabase-js` al JWT propio y a los nuevos endpoints de auth. Probado en un navegador real (Firefox headless vía Playwright — Chromium no pudo correr en este entorno por faltar librerías del sistema sin acceso root; Firefox sí, extrayendo `libasound.so` de un `.deb` descargado sin instalar). Login, logout y "olvidé mi contraseña" verificados end-to-end sin errores de consola. `@supabase/supabase-js` ya no es dependencia del frontend.
- **2026-07-04**: Fase 1 completada. Migrados `gradesBootstrap.js`, `examClosure.js`, `monitor.js`, `secretaria.js`, `student.js`, `teacher.js`, `admin.js` (3299 líneas, el más grande) y `routes/auth.js` (encontrado al auditar, no estaba en la lista original). Todos verificados en vivo contra la VM — GETs con datos reales, escrituras dentro de transacciones con `ROLLBACK` cuando no eran idempotentes de forma segura. Bug real encontrado y corregido: `pg` devuelve `bigint`/`numeric` como string (Supabase los devolvía como número JSON); se agregó `pg.types.setTypeParser` en `db.js` para restaurar el comportamiento anterior en todo el código ya migrado. Confirmado por `grep` que solo quedan referencias a `supabaseAdmin` en `supabase.js`, `middlewares/auth.js` y los 4 handlers de `admin.js` reservados para la Fase 2 (más `routes/teacher copy.js`, un archivo suelto no importado por `server.js`, sin tocar).
