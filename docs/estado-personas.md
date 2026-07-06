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
| Fase 4 — Backend: Crear/Actualizar persona (alta/edición de estado) | ✅ Completa |
| Fase 5 — Frontend: UI de Estado + wiring | ✅ Completa |
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

- [x] `backend/src/lib/gradesBootstrap.js` — `getCourseStudentIds` filtrado.
- [x] `backend/src/lib/examClosure.js` — `getStudentIdsByCourseIds` filtrado (la segunda consulta que resuelve curso por alumno ya opera sobre una lista previamente filtrada, no necesitó cambio).
- [x] `backend/src/routes/monitor.js` — roster de alumnos (`/students`, `/attendance/reporte`), `/teachers` filtrados. Detalle de asistencia (`/attendance/session`, `/attendance/consulta-todas`): el alumno retirado ahora se excluye de la fila completa (no solo el nombre en blanco). Nombres de profesor: sin cambios (histórico).
- [x] `backend/src/routes/secretaria.js` — mismo patrón que monitor.js: roster filtrado, detalle de asistencia excluye la fila del alumno retirado, nombres de profesor sin cambios.
- [x] `backend/src/routes/teacher.js` — `getStudentsByCourseIds` filtrado, detalle de asistencia excluye fila de alumno retirado, `POST /grades` rechaza con mensaje claro si el alumno está retirado. Nombres de profesor sin cambios.
- [x] `backend/src/routes/admin.js` — `getStudentsByCourseIds`, `/teachers`, `/students`, `/courses/:id/students`, conteo de alumnos activos para bloquear borrado de curso, nombre de monitor en `/courses` (filtrado, el monitor es alumno), alumnos en `exam-attempts` — todos filtrados. `PUT /courses/:id/monitor` rechaza asignar un candidato retirado. `POST /grades` rechaza cargar nota a un alumno retirado. Nombres de profesor en evaluaciones/exámenes sin cambios.
- [x] `backend/src/routes/student.js` — sin cambios (solo resuelve nombre de profesor, staff).
- [x] Verificado en vivo con 3 alumnos de prueba reales (creados y borrados vía API): `admin /students`, `admin /courses/:id/students`, `monitor /students`, `teacher /class-grade-grid` — los 4 muestran al alumno activo, lo excluyen al marcarlo Retirado, y vuelve a aparecer al reactivarlo. `PUT /courses/:id/monitor` y `POST /admin/grades` rechazan correctamente con mensaje claro a un alumno retirado.

## Fase 4 — Backend: Crear/Actualizar persona (alta/edición de estado)

- [x] `POST /admin/create-user`: acepta `estado` en el body; si no viene o no es `'Activo'`/`'Retirado'`, default `'Activo'`. Se agregó la columna al INSERT (y a `ON CONFLICT DO UPDATE`).
- [x] `POST /admin/update-user-by-cedula`: acepta y actualiza `estado`; si no viene en el body (o el valor no es válido), **mantiene el estado actual** del usuario en vez de sobreescribirlo — así una edición que no toca el campo Estado no reactiva/retira a nadie por accidente.
- [x] `GET /admin/user-by-cedula` (ambos handlers registrados bajo esa ruta — el segundo es código muerto por duplicado de ruta, ya señalado como tal en un comentario previo de la migración, pero se actualizó igual por consistencia), `GET /admin/users/search`: ahora devuelven el campo `estado`. Ninguno filtra por estado (Categoría D, sin cambios de alcance).
- [x] `POST /admin/upload-users` (carga masiva por Excel): no requirió cambio de lógica — el INSERT nunca incluyó la columna `estado`, así que el `DEFAULT 'Activo'` de la BD ya aplica a las altas nuevas, y como `ON CONFLICT DO UPDATE` tampoco toca esa columna, una persona ya marcada Retirada **no se reactiva** por una re-carga del Excel. Se agregó `estado` al `RETURNING` para que quede visible en la respuesta.
- [x] Verificado en vivo con un usuario de prueba real (creado y borrado vía los propios endpoints): crear sin mandar `estado` → queda `Activo`; `user-by-cedula` y `users/search` devuelven el campo; editar mandando `estado: "Retirado"` → se guarda; editar de nuevo **sin** mandar `estado` → se mantiene `Retirado` (no se pisa); editar mandando `estado: "Activo"` → vuelve a `Activo`.

## Fase 5 — Frontend: UI de Estado + wiring

- [x] `frontend/src/app/admin/page.tsx`: agregado grupo visual "Estado" (Activo/Retirado) junto al de Rol, mismo estilo de checkboxes, separado por un divisor vertical. Lógica de selección única implementada con un estado `uEstado: "Activo" | "Retirado"` (no un array): al marcar una opción se llama `setUEstado(o.value)`, nunca se pueden marcar ambas.
- [x] Al crear: `uEstado` inicia en `"Activo"` (`resetManualUserForm` lo fija por defecto) y se envía en el payload.
- [x] Al editar: `searchUserByCedula` carga el `estado` real devuelto por `GET /user-by-cedula` y marca el checkbox correspondiente.
- [x] `estado: uEstado` agregado al payload de `createUserManual` (usado tanto para crear como para actualizar).
- [x] Columna "Estado" agregada a la tabla de resultados de `GET /users/search` dentro del propio panel de Crear/Actualizar persona (Categoría D: ahí deben verse ambos estados), con el texto en rojo cuando es "Retirado".
- [x] Verificado en un navegador real (Firefox vía Playwright, contra el dev server local con datos reales de la BD de OCI): login como admin, apertura del panel "Crear/Actualizar persona" con "Activo" premarcado por defecto; se creó un alumno de prueba (quedó `Activo`, visible en la búsqueda con esa etiqueta); se lo trajo a edición (cargó `Activo` correctamente); se marcó "Retirado" y se guardó; una nueva búsqueda mostró el mismo registro con "Retirado" (Categoría D, sigue visible ahí); se confirmó en la tabla `users` que el cambio persistió; se eliminó el registro de prueba al final. La verificación de que un alumno Retirado desaparece de otros módulos (profesor/monitor/secretaría) y de que no puede loguear ya se hizo en vivo en las Fases 2 y 3 — Fase 6 hará el recorrido end-to-end integrando todo.

## Fase 6 — Validación end-to-end

- [ ] Recorrido manual: alumno retirado no aparece en roster de monitor/secretaría/profesor/admin, no puede loguear, sí aparece en Crear/Actualizar persona.
- [ ] Profesor retirado: no aparece en selectores de asignación nueva, sí mantiene su nombre en evaluaciones/asistencias ya creadas, no puede loguear.
- [ ] Confirmar que reactivar (Retirado → Activo) revierte todo correctamente.
- [ ] Mergear a `qa` y repetir el recorrido contra el deploy real (mismo patrón que la migración: usuarios de prueba por API, navegador real, limpieza al final).

---

## Registro de avance

_(Una entrada breve por sesión, con fecha, qué se hizo y qué quedó pendiente.)_

- **2026-07-05**: Plan creado. Relevados 57 usos de la tabla `users` en 9 archivos del backend, categorizados en 4 grupos. Decisiones confirmadas por Alex: login se bloquea por completo para retirados (incluyendo invalidar JWTs ya emitidos); en registros históricos se mantiene el nombre de staff (profesor/admin/secretaría) pero se oculta el de alumnos (el rol Monitor se trata como alumno, porque siempre implica el rol S).
