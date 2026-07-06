# Estado de personas (Activo / Retirado)

Plan de trabajo y seguimiento para implementar el manejo de estado de personas en WebNotas JILIU. Mismo formato que `docs/migracion-bd-oci.md`: cada paso se marca `[x]` cuando queda terminado y verificado en vivo contra la VM de OCI.

## Decisiones tomadas

- **Modelo de datos**: columna `estado text NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo','Retirado'))` en `public.users`. No se toca `auth.users` — el login se bloquea con una consulta adicional a `public.users`, no cambiando el esquema de auth.
- **Login de retirados**: se **bloquea por completo** (decisión de Alex). Se verifica en dos puntos: `POST /auth/login` (rechazo inmediato al intentar entrar) y en el middleware de autenticación (`requireAuth`/`requireUser`/`authMiddleware`), para invalidar también sesiones/JWT ya emitidos antes de retirar a alguien (el JWT dura 7 días y no hay revocación de tokens, así que sin este segundo chequeo alguien retirado podría seguir usando la app hasta que expire su token).
- **Visibilidad en registros históricos** (decisión de Alex): cuando la persona asignada a un registro ya existente (sesión de asistencia, evaluación creada, nota cargada) se marca Retirada:
  - Si es **alumno** (incluye Monitor, porque el rol M siempre implica el rol S en este sistema) → su nombre **desaparece** también de listados/reportes históricos donde aparecía como alumno.
  - Si es **Profesor / Admin / Secretaría** (su identidad en ese registro es de staff, no de alumno) → su nombre **se mantiene** en registros históricos (quién dictó una clase, quién creó una evaluación) — solo deja de aparecer en selectores para asignaciones *nuevas* (ej. dropdown de profesores para asignar a una materia).
- **La única pantalla que ve ambos estados**: Crear/Actualizar persona (búsqueda por cédula, alta, edición) — ahí se puede reactivar a alguien.
- Duplicados de email/código JILIU se siguen validando contra **todas** las personas (activas y retiradas), para no permitir un email repetido aunque el dueño anterior esté retirado.

## Impacto relevado (57 consultas a `users` en 9 archivos)

Categorizadas para decidir si llevan el filtro `estado = 'Activo'`:

| Categoría | Regla | Ejemplos |
|---|---|---|
| A — Listados/selectores/búsquedas | Filtrar siempre | `/teachers`, `/students`, roster de curso, dropdown de monitor |
| B1 — Resolución histórica de un **alumno** conocido (id_student) | Filtrar (se oculta igual) | nombre de alumno en fila de asistencia, en grid de notas, en exam-attempts |
| B2 — Resolución histórica de **staff** conocido (id_teacher) | No filtrar | profesor de una evaluación, profesor de una sesión de asistencia pasada |
| C — Chequeo de duplicados (email/código) | No filtrar | create-user, update-user-by-cedula |
| D — Módulo Crear/Actualizar persona | No filtrar (por diseño) | `/users/search`, `/user-by-cedula`, `/create-user`, `/update-user-by-cedula`, `/delete-user` |

## Estado general

| Fase | Estado |
|---|---|
| Fase 1 — Base de datos | ✅ Completa |
| Fase 2 — Backend: helper + bloqueo de login | ✅ Completa |
| Fase 3 — Backend: filtrar listados (Categoría A + B1) | Pendiente |
| Fase 4 — Backend: Crear/Actualizar persona (alta/edición de estado) | Pendiente |
| Fase 5 — Frontend: UI de Estado + wiring | Pendiente |
| Fase 6 — Validación end-to-end | Pendiente |

---

## Fase 1 — Base de datos

- [x] `ALTER TABLE users ADD COLUMN estado text NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo','Retirado'));` — aplicado, los 66 usuarios existentes quedaron en `Activo` automáticamente por el `DEFAULT`.
- [x] Índices: `idx_users_estado` y `idx_users_id_course_estado` creados.
- [x] Verificado en vivo: columna `estado text NOT NULL DEFAULT 'Activo'::text`; conteo `{Activo: 66}`; el `CHECK` (`users_estado_check`) rechazó correctamente un `UPDATE` a `'Suspendido'`; ambos índices presentes.

## Fase 2 — Backend: helper + bloqueo de login

- [x] Middleware (`backend/src/middlewares/auth.js`): `loadProfileAndRoles` ahora trae `estado`, y `validateTokenAndLoadContext` rechaza (`ok:false`) si `estado !== 'Activo'` — afecta a `requireAuth`/`requireUser`/`authMiddleware` por igual, ya que todos pasan por esa función. De paso se corrigió que `requireUser`/`requireAuth` mostraban un mensaje genérico tapando el error real (`result.error`).
- [x] `POST /auth/login`: tras verificar la contraseña, chequea `estado` en `public.users` y rechaza con 403 si está retirado (si todavía no existe fila en `public.users` — usuario recién creado sin completar `/profile` — no bloquea).
- [x] `POST /auth/resolve-login`: mismo chequeo, rechaza con 403 antes de revelar el email.
- [x] Verificado en vivo con un usuario de prueba real: login y `resolve-login` funcionan en Activo; al marcar Retirado, ambos rechazan con 403; **un JWT ya emitido antes de retirar deja de servir en el siguiente request** (401, vía el middleware); al reactivar, el mismo token vuelve a funcionar. Usuario de prueba eliminado al final.

## Fase 3 — Backend: filtrar listados (Categoría A + B1)

Agregar `AND estado = 'Activo'` (o el JOIN equivalente) en los siguientes archivos/funciones. Alumnos (incluye Monitor) se filtran siempre, incluso en vistas históricas; staff (profesor/admin/secretaría) solo en selectores de asignación nueva, no en resoluciones históricas de nombre.

- [ ] `backend/src/lib/gradesBootstrap.js` — `getCourseStudentIds` (alumnos del curso).
- [ ] `backend/src/lib/examClosure.js` — `getStudentIdsByCourseIds`, resolución de `id_course` por alumno.
- [ ] `backend/src/routes/monitor.js` — roster de alumnos, `/teachers` (selector), `/students`. **No tocar**: nombre de profesor en sesión de asistencia (histórico).
- [ ] `backend/src/routes/secretaria.js` — roster de alumnos, nombres de alumno en detalle de asistencia. **No tocar**: nombre de profesor.
- [ ] `backend/src/routes/teacher.js` — `getStudentsByCourseIds`, nombres de alumno en asistencia, chequeo de estado al cargar nota manual por cédula (rechazar con mensaje claro si el alumno está retirado). **No tocar**: nombres de profesor.
- [ ] `backend/src/routes/admin.js` — `getStudentsByCourseIds`, `/teachers`, `/students`, `/courses/:id/students`, conteo de alumnos para bloquear borrado de curso, nombre de monitor en `/courses` (el monitor es alumno → se oculta si retirado), validación de candidato a monitor en `PUT /courses/:id/monitor` (rechazar si el candidato está retirado), chequeo de estado al cargar nota manual por cédula, alumnos en `exam-attempts`. **No tocar**: nombres de profesor en evaluaciones/exámenes.
- [ ] `backend/src/routes/student.js` — no requiere cambios (el nombre de profesor que se le muestra al alumno es de staff, no se filtra).
- [ ] Verificar en vivo cada archivo: crear un alumno de prueba activo, confirmar que aparece en roster/selector correspondiente, marcarlo retirado, confirmar que desaparece.

## Fase 4 — Backend: Crear/Actualizar persona (alta/edición de estado)

- [ ] `POST /admin/create-user`: default `estado = 'Activo'` si no viene en el body (o si viene, validar que sea `'Activo'`/`'Retirado'`).
- [ ] `POST /admin/update-user-by-cedula`: aceptar y actualizar `estado`.
- [ ] `GET /admin/user-by-cedula`, `GET /admin/users/search`: devolver el campo `estado` (para que el frontend sepa qué radio marcar) — estos endpoints **no** filtran por estado (ya es la Categoría D).
- [ ] `POST /admin/upload-users` (carga masiva por Excel): default `estado = 'Activo'` para altas nuevas (la plantilla de Excel no gestiona retiros masivos, queda fuera de alcance).
- [ ] Verificar en vivo: crear persona sin mandar estado → queda Activo; editar y cambiar a Retirado → se guarda; volver a Activo → se guarda.

## Fase 5 — Frontend: UI de Estado + wiring

- [ ] `frontend/src/app/admin/page.tsx`: agregar grupo visual "Estado de la persona" (Activo/Retirado) junto al de roles, mismo estilo. Checkboxes visualmente, pero lógica de selección única (un solo `estado` en el state, no un array).
- [ ] Al crear: enviar `estado: "Activo"` por defecto (checkbox Activo premarcado).
- [ ] Al editar: cargar el `estado` real de la persona (vía `user-by-cedula`/`users/search`) y marcar el checkbox correspondiente.
- [ ] Enviar `estado` en el payload de crear/actualizar.
- [ ] Verificar en un navegador real: crear persona (queda Activo), editarla a Retirado, confirmar que desaparece de un selector (ej. lista de profesores) y que ya no puede loguear.

## Fase 6 — Validación end-to-end

- [ ] Recorrido manual: alumno retirado no aparece en roster de monitor/secretaría/profesor/admin, no puede loguear, sí aparece en Crear/Actualizar persona.
- [ ] Profesor retirado: no aparece en selectores de asignación nueva, sí mantiene su nombre en evaluaciones/asistencias ya creadas, no puede loguear.
- [ ] Confirmar que reactivar (Retirado → Activo) revierte todo correctamente.
- [ ] Mergear a `qa` y repetir el recorrido contra el deploy real (mismo patrón que la migración: usuarios de prueba por API, navegador real, limpieza al final).

---

## Registro de avance

_(Una entrada breve por sesión, con fecha, qué se hizo y qué quedó pendiente.)_

- **2026-07-05**: Plan creado. Relevados 57 usos de la tabla `users` en 9 archivos del backend, categorizados en 4 grupos. Decisiones confirmadas por Alex: login se bloquea por completo para retirados (incluyendo invalidar JWTs ya emitidos); en registros históricos se mantiene el nombre de staff (profesor/admin/secretaría) pero se oculta el de alumnos (el rol Monitor se trata como alumno, porque siempre implica el rol S).
