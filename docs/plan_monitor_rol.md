# Plan de Implementación: Rol Monitor (M)
**WebNotas JILIU | La Promesa — Módulo de Asistencia**
Fecha de análisis: 2026-04-21

---

## 1. Observaciones críticas y recomendaciones

### 1.1 No reutilizar la tabla `attendance` existente
La tabla `attendance` actual es una estructura simple: `(id_student, id_class, id_course, date, observation)`. Fue diseñada para que el profesor anote asistencia por estudiante de forma directa, sin cabecera de sesión.

El módulo Monitor necesita un modelo de sesión enriquecido:
- Cabecera de sesión con módulo, materia, fecha, estado del profesor, reemplazo
- Detalle por estudiante con motivo de inasistencia
- Unicidad garantizada por combinación curso+módulo+materia+fecha

**Decisión: crear dos nuevas tablas (`asistencia_sesion` y `asistencia_detalle`). La tabla `attendance` existente no se toca.**

### 1.2 El rol `E` (Secretaría) ya existe en frontend pero no en el DDL publicado
El código en `frontend/src/lib/roles.ts` y `backend/src/middlewares/auth.js` ya referencian el rol `E`, y existe `frontend/src/app/secretaria/page.tsx`. Sin embargo, el DDL tiene `check (code in ('S','T','A'))`. La migración del Monitor debe agregar `'E'` y `'M'` al constraint simultáneamente para no corromper datos existentes.

### 1.3 El Monitor es un estudiante con rol adicional
Un monitor es un estudiante del curso al que se le asigna también el rol `M`. Esto significa:
- `users.id_course` ya almacena su curso (el mismo curso que monitorea)
- Puede tener `roles = ['S', 'M']` simultáneamente
- La prioridad de rol activo debe ser: `A > T > M > S > E`
- El panel Monitor reemplaza al panel Estudiante cuando el rol activo es `M`

### 1.4 Validación de curso en backend: patrón recomendado
Cada endpoint del monitor debe validar:
```js
const monitorCourseId = req.auth.profile?.id_course;
if (!monitorCourseId || Number(body.id_course) !== monitorCourseId) {
  return res.status(403).json({ error: "Solo puedes operar sobre tu curso asignado" });
}
```
Esto es suficiente y no requiere consultar `course.id_monitor` en cada request.

### 1.5 `fecha_clase` debe ser tipo `date` (sin hora)
Evita problemas de timezone. El frontend envía y recibe `YYYY-MM-DD`. El display en español (`05-MAY-2026`) es solo presentación.

### 1.6 Upsert atómico para registrar sesión
El endpoint `POST /api/monitor/attendance` debe:
1. Hacer upsert en `asistencia_sesion` por la clave única `(id_course, id_module, id_class, fecha_clase)`
2. Para cada estudiante, hacer upsert en `asistencia_detalle` por `(id_sesion, id_student)`
3. Si el año lectivo no está activo, devolver 403

### 1.7 Año lectivo activo = editable
El registro y actualización de asistencia solo se permite cuando el año lectivo es activo (`anio_lectivo.activo = true`). La consulta y el reporte funcionan en modo lectura para cualquier año histórico.

### 1.8 Un curso tiene a lo sumo un monitor
Agregar columna `id_monitor uuid` a `course`. Constraint: un usuario no puede ser monitor de dos cursos distintos del mismo año. Implementar con unique index sobre `(id_monitor)` en los cursos activos, o validar en el backend.

---

## 2. Modelo de datos propuesto

Ver archivo `supabase/migration_monitor.sql` para el SQL completo.

### 2.1 Cambios en tablas existentes

| Tabla | Cambio |
|-------|--------|
| `type` | Ampliar check constraint: `code IN ('S','T','A','E','M')` + INSERT Monitor |
| `course` | Nueva columna `id_monitor uuid references users(id) ON DELETE SET NULL` |

### 2.2 Nuevas tablas

#### `asistencia_sesion` — Cabecera de sesión de clase
```
id                 bigserial PK
id_course          bigint FK course         NOT NULL
id_module          bigint FK module         NOT NULL
id_class           bigint FK class          NOT NULL
fecha_clase        date                     NOT NULL
id_teacher         uuid FK users            NOT NULL   -- profesor asignado
profesor_asistio   boolean                  NOT NULL DEFAULT true
profesor_reemplazo text nullable
UNIQUE (id_course, id_module, id_class, fecha_clase)
```

#### `asistencia_detalle` — Asistencia por estudiante por sesión
```
id          bigserial PK
id_sesion   bigint FK asistencia_sesion  NOT NULL  CASCADE DELETE
id_student  uuid FK users               NOT NULL
asistio     boolean                     NOT NULL DEFAULT false
motivo      text                        NOT NULL DEFAULT 'sin información'
UNIQUE (id_sesion, id_student)
```

### 2.3 Índices
```sql
idx_asistencia_sesion_course        ON asistencia_sesion (id_course)
idx_asistencia_sesion_class_module  ON asistencia_sesion (id_class, id_module)
idx_asistencia_sesion_fecha         ON asistencia_sesion (fecha_clase)
idx_asistencia_detalle_sesion       ON asistencia_detalle (id_sesion)
idx_asistencia_detalle_student      ON asistencia_detalle (id_student)
```

---

## 3. Backend — Endpoints y validaciones

### 3.1 Nuevo archivo: `backend/src/routes/monitor.js`

Middleware interno:
```js
function requireMonitor(req, res, next) {
  const roles = req.auth?.roles || [];
  if (!roles.includes("M")) return res.status(403).json({ error: "Solo Monitor" });
  return next();
}
```

#### Endpoints de datos maestros

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/monitor/me` | Perfil del monitor + info del curso asignado |
| GET | `/api/monitor/students` | Estudiantes del curso del monitor |
| GET | `/api/monitor/modules` | Módulos del año lectivo activo |
| GET | `/api/monitor/classes?module_id=X` | Materias del módulo (filtradas por nivel del curso) |
| GET | `/api/monitor/teacher?class_id=X` | Profesor asignado a class+course del monitor |

#### Endpoints de asistencia — Registro

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/monitor/attendance/session?module_id=X&class_id=Y&fecha=YYYY-MM-DD` | Carga sesión existente con su detalle |
| POST | `/api/monitor/attendance` | Crear o actualizar sesión + detalle (upsert) |

**Body POST:**
```json
{
  "id_course": 12,
  "id_module": 3,
  "id_class": 7,
  "fecha_clase": "2026-04-21",
  "id_teacher": "uuid",
  "profesor_asistio": true,
  "profesor_reemplazo": null,
  "detalle": [
    { "id_student": "uuid", "asistio": true, "motivo": "sin información" }
  ]
}
```
```

**Validaciones backend:**
1. `id_course` == monitor's `profile.id_course`
2. El año del curso debe estar activo (`anio_lectivo.activo = true`)
3. `fecha_clase` ≤ fecha actual
4. `id_teacher` debe tener asignación en `class_teacher` para `id_class` + `id_course`
5. Todos los `id_student` deben pertenecer al curso

#### Endpoints de asistencia — Consulta

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/monitor/attendance/fechas?module_id=X&class_id=Y` | Fechas con sesiones registradas para módulo+materia (para dropdown) |
| GET | `/api/monitor/attendance/consulta?module_id=X&class_id=Y&fecha=YYYY-MM-DD` | Sesión + detalle en modo lectura |
| GET | `/api/monitor/attendance/consulta/download?module_id=X&class_id=Y&fecha=YYYY-MM-DD` | Descarga Excel de la sesión |

#### Endpoints de reporte

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/monitor/attendance/reporte` | Reporte consolidado: estudiantes × materias con total inasistencias |
| GET | `/api/monitor/attendance/reporte/download` | Descarga Excel del reporte |

**Lógica del reporte:**
```sql
SELECT 
  u.id, u.name, u.cedula,
  c.name AS class_name,
  COUNT(*) FILTER (WHERE ad.asistio = false) AS inasistencias
FROM asistencia_detalle ad
JOIN asistencia_sesion s ON s.id = ad.id_sesion
JOIN users u ON u.id = ad.id_student
JOIN class c ON c.id = s.id_class
WHERE s.id_course = :id_course
GROUP BY u.id, u.name, u.cedula, c.id, c.name
ORDER BY u.name, c.name;
```

### 3.2 Cambios en `backend/src/routes/admin.js`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/admin/courses/:id/students` | Estudiantes del curso (para dropdown Monitor en UI) |
| PUT | `/api/admin/courses/:id/monitor` | Asignar/desasignar monitor `{ id_monitor: uuid\|null }` |

El GET de cursos existente (`/api/admin/courses`) debe incluir `id_monitor` y el nombre del monitor en su respuesta.

### 3.3 Cambios en `backend/src/middlewares/auth.js`

Actualizar prioridad de rol en `loadProfileAndRoles`:
```js
const role = roles.includes("A") ? "A"
           : roles.includes("T") ? "T"
           : roles.includes("M") ? "M"   // ← nuevo
           : roles.includes("S") ? "S"
           : roles.includes("E") ? "E"
           : null;
```

### 3.4 Registrar en `backend/server.js`
```js
import { monitorRouter } from './src/routes/monitor.js';
app.use('/api/monitor', monitorRouter);
```

---

## 4. Frontend — Cambios por archivo

### 4.1 `frontend/src/lib/roles.ts`
- Agregar `"M"` a `RoleCode`
- `primaryRole()`: incluir 'M' después de 'T' y antes de 'S'
- `roleLabelFromRole()`: `"M"` → `"Monitor"`

### 4.2 `frontend/src/lib/activeRole.ts`
- `getActiveRole()`: fallback `M` entre T y S
- `roleToRoute()`: `"M"` → `"/monitor"`

### 4.3 `frontend/src/app/dashboard/page.tsx`
- Ya redirige si `activeRole !== "S"`: el monitor será redirigido a `/monitor` automáticamente con el cambio en `roleToRoute`

### 4.4 `frontend/src/app/admin/page.tsx` — Vista COURSES
- Cambiar label botón/título "Crear curso" → "Crear/Editar curso"
- En el formulario de curso: agregar dropdown **Monitor**
  - Pobla con estudiantes del curso (`GET /api/admin/courses/:id/students`)
  - Para nuevo curso: el dropdown se activa después de crear el curso
  - Para editar: carga el monitor actual
  - Al seleccionar: llama `PUT /api/admin/courses/:id/monitor`
- En la tabla de cursos: agregar columna "Monitor" con el nombre del monitor asignado

### 4.5 Nueva página: `frontend/src/app/monitor/page.tsx`
Guard: si `activeRole !== "M"` → redirect.

Menú principal "¿Qué quieres hacer?":
- Registrar asistencia
- Consultar asistencia
- Reporte de inasistencia

Renderiza el componente según selección.

### 4.6 Nuevo componente: `RegistrarAsistencia.tsx`

**Cabecera (campos):**
| Campo | Tipo | Comportamiento |
|-------|------|----------------|
| Curso | texto readonly | Cargado de `me.course.name` |
| Año lectivo | texto readonly | Año activo |
| Fecha clase | `<input type="date">` + display `DD-MMM-YYYY` en español | Max = hoy |
| Módulo | dropdown | Carga módulos del año activo |
| Materia | dropdown | Se actualiza al cambiar Módulo |
| Profesor asignado | texto readonly | Se carga al seleccionar Materia |
| Estado profesor | radio `Asistió / No asistió` | Default: Asistió |
| Profesor reemplazo | text input | Visible solo si `Estado profesor = No asistió` |

**Comportamiento de carga:**
- Cuando Módulo + Materia + Fecha están todos seleccionados → llamar `GET /api/monitor/attendance/session`
- Si existe sesión → cargar datos en cabecera y grilla
- Si no existe → grilla con todos los estudiantes, todos en `No asistió`, motivo `sin información`

**Grilla de estudiantes:**
| Columna | Detalle |
|---------|---------|
| Curso | texto (del curso del monitor) |
| Cédula | `user.cedula` |
| Nombre | `user.name` |
| Materia | nombre de la materia seleccionada |
| Asistió / No asistió | radiobutton por fila; default = No asistió |
| Motivo no asistió | text input; visible solo cuando = No asistió; default = `sin información` |

**Botón Guardar:**
- Llama `POST /api/monitor/attendance`
- Si año no activo → deshabilitar Guardar, mostrar aviso

### 4.7 Nuevo componente: `ConsultarAsistencia.tsx`

Todos los campos y la grilla en **modo solo lectura**.

Campos:
| Campo | Tipo |
|-------|------|
| Curso | texto readonly |
| Módulo | dropdown |
| Materia | dropdown (se actualiza con Módulo) |
| Fecha clase | dropdown con fechas registradas (se actualiza con Materia) |
| Profesor que dictó la clase | texto readonly (se carga al seleccionar Fecha) |

Grilla = misma estructura que Registrar pero readonly + sin motivo editable.

Botón **Descargar**: `GET /api/monitor/attendance/consulta/download`

### 4.8 Nuevo componente: `ReporteInasistencia.tsx`

Cabecera: Curso (texto readonly).

Tabla pivot:
- Filas: estudiantes del curso (Cédula, Nombre)
- Columnas dinámicas: una por cada materia que tenga sesiones registradas
- Columna **Total inasistencias** (suma de todas las materias)
- Celdas: número de inasistencias del estudiante en esa materia

Botón **Descargar**: `GET /api/monitor/attendance/reporte/download`

---

## 5. Validaciones de negocio (resumen)

| Regla | Dónde validar |
|-------|--------------|
| Monitor opera solo sobre su curso | Backend: `id_course === profile.id_course` |
| No duplicar sesiones | BD: UNIQUE constraint; Backend: upsert |
| Si sesión existe, cargar datos | Frontend: GET session al completar filtros |
| Solo registrar si año activo | Backend: `anio_lectivo.activo = true` |
| `fecha_clase` ≤ hoy | Backend: `fecha_clase <= CURRENT_DATE` |
| Profesor reemplazo solo si no asistió | Frontend: visibilidad condicional |
| Motivo visible solo en No asistió | Frontend: visibilidad condicional |
| Default No asistió | Frontend: inicialización de estado |
| Default motivo `sin información` | Frontend + BD: `DEFAULT 'sin información'` |
| Consulta y reporte son solo lectura | Frontend: inputs deshabilitados + no hay PUT/POST en esas vistas |

---

## 6. Plan de ejecución por tareas

### Bloque 0 — Base de datos (migración)

| # | Tarea | Archivo |
|---|-------|---------|
| T01 | Ampliar check constraint `type.code` para incluir `'E'` y `'M'` | `migration_monitor.sql` |
| T02 | Insertar rol `M` (Monitor) en tabla `type` | `migration_monitor.sql` |
| T03 | Agregar columna `id_monitor` a `course` | `migration_monitor.sql` |
| T04 | Crear tabla `asistencia_sesion` con constraint UNIQUE | `migration_monitor.sql` |
| T05 | Crear tabla `asistencia_detalle` con constraint UNIQUE | `migration_monitor.sql` |
| T06 | Crear índices en `asistencia_sesion` y `asistencia_detalle` | `migration_monitor.sql` |
| T07 | Crear función `is_monitor()` (helper RLS) | `migration_monitor.sql` |
| T08 | Habilitar RLS y crear políticas en nuevas tablas | `migration_monitor.sql` |

### Bloque 1 — Backend: Auth y rol M

| # | Tarea | Archivo |
|---|-------|---------|
| T10 | Agregar prioridad `'M'` en `loadProfileAndRoles` | `auth.js` |
| T11 | Crear `monitor.js` con `requireMonitor` middleware | `routes/monitor.js` (nuevo) |
| T12 | Registrar `monitorRouter` en server.js | `server.js` |

### Bloque 2 — Backend: Admin — asignación monitor

| # | Tarea | Archivo |
|---|-------|---------|
| T13 | Agregar `id_monitor` + nombre monitor en GET `/api/admin/courses` | `admin.js` |
| T14 | Nuevo endpoint `GET /api/admin/courses/:id/students` | `admin.js` |
| T15 | Nuevo endpoint `PUT /api/admin/courses/:id/monitor` | `admin.js` |

### Bloque 3 — Backend: Monitor — datos maestros

| # | Tarea | Archivo |
|---|-------|---------|
| T16 | `GET /api/monitor/me` | `monitor.js` |
| T17 | `GET /api/monitor/students` | `monitor.js` |
| T18 | `GET /api/monitor/modules` | `monitor.js` |
| T19 | `GET /api/monitor/classes?module_id=X` | `monitor.js` |
| T20 | `GET /api/monitor/teacher?class_id=X` | `monitor.js` |

### Bloque 4 — Backend: Monitor — registrar asistencia

| # | Tarea | Archivo |
|---|-------|---------|
| T21 | `GET /api/monitor/attendance/session` (carga sesión existente) | `monitor.js` |
| T22 | `POST /api/monitor/attendance` (upsert sesión + detalles) | `monitor.js` |

### Bloque 5 — Backend: Monitor — consultar asistencia

| # | Tarea | Archivo |
|---|-------|---------|
| T23 | `GET /api/monitor/attendance/fechas` | `monitor.js` |
| T24 | `GET /api/monitor/attendance/consulta` | `monitor.js` |
| T25 | `GET /api/monitor/attendance/consulta/download` (Excel) | `monitor.js` |

### Bloque 6 — Backend: Monitor — reporte

| # | Tarea | Archivo |
|---|-------|---------|
| T26 | `GET /api/monitor/attendance/reporte` (pivot por curso) | `monitor.js` |
| T27 | `GET /api/monitor/attendance/reporte/download` (Excel) | `monitor.js` |

### Bloque 7 — Frontend: Infraestructura de roles

| # | Tarea | Archivo |
|---|-------|---------|
| T28 | Agregar `"M"` a `RoleCode`, `primaryRole`, `roleLabelFromRole` | `roles.ts` |
| T29 | Agregar `"M"` a `getActiveRole` y `roleToRoute("/monitor")` | `activeRole.ts` |
| T30 | Verificar redirect en dashboard (automático con T29) | `dashboard/page.tsx` |

### Bloque 8 — Frontend: Admin — asignación monitor en UI

| # | Tarea | Archivo |
|---|-------|---------|
| T31 | Cambiar label "Crear curso" → "Crear/Editar curso" | `admin/page.tsx` |
| T32 | Agregar columna Monitor en tabla de cursos | `admin/page.tsx` |
| T33 | Agregar dropdown Monitor en formulario de curso (estudiantes del curso) | `admin/page.tsx` |
| T34 | Conectar dropdown a `PUT /api/admin/courses/:id/monitor` | `admin/page.tsx` |

### Bloque 9 — Frontend: Panel Monitor

| # | Tarea | Archivo |
|---|-------|---------|
| T35 | Crear `monitor/page.tsx` con menú y guard de rol | `app/monitor/page.tsx` (nuevo) |
| T36 | Crear `RegistrarAsistencia.tsx` (cabecera + grilla + upsert) | `app/monitor/RegistrarAsistencia.tsx` (nuevo) |
| T37 | Crear `ConsultarAsistencia.tsx` (cascada + readonly + descarga) | `app/monitor/ConsultarAsistencia.tsx` (nuevo) |
| T38 | Crear `ReporteInasistencia.tsx` (pivot + descarga) | `app/monitor/ReporteInasistencia.tsx` (nuevo) |

**Total: 37 tareas en 10 bloques.**

---

## 7. Recomendaciones técnicas

### 7.1 Orden de implementación obligatorio
- Bloque 0 (BD) debe ejecutarse antes de cualquier bloque de backend o frontend.
- Bloque 1 (Auth) debe completarse antes de los Bloques 2–6.
- Bloques 3–6 (Monitor backend) son independientes entre sí y pueden hacerse en paralelo.
- Bloque 7 (roles frontend) debe completarse antes de Bloques 8–9.

### 7.2 Excel con ExcelJS
El backend ya tiene `ExcelJS` instalado (visible en `admin.js`). Usar la misma librería para las descargas del Monitor.

### 7.3 Componentes por vistas, no en un solo archivo
El panel Monitor tiene tres vistas funcionales pesadas. Crear un componente por vista (`RegistrarAsistencia`, `ConsultarAsistencia`, `ReporteInasistencia`) y renderizarlos condicionalmente desde `monitor/page.tsx`, siguiendo el patrón de `CrearExamen` y `HabilitarExamenes` en el panel Admin.

### 7.4 Estado de sesión existente en Registrar
Al completar los tres filtros (módulo + materia + fecha), el componente debe hacer el GET automáticamente. Si hay sesión → rellenar estado. Si no → inicializar con defaults. No mostrar un botón "Buscar".

### 7.5 Dropdown de fechas en Consultar
Las fechas deben mostrarse formateadas en español (`05-MAY-2026`) en el dropdown, pero enviar `YYYY-MM-DD` al backend. Mapear internamente en el frontend.

### 7.6 Pivot table en Reporte
La query de reporte devuelve filas planas `(student, class, inasistencias)`. El frontend debe pivotar: construir un mapa `studentId → { [classId]: count }` para renderizar la tabla dinámica.

### 7.7 Verificación de monitor único por curso
Antes de asignar un nuevo monitor, el backend debe verificar que el estudiante seleccionado no sea ya monitor de otro curso en el mismo año lectivo. Implementar en el endpoint `PUT /api/admin/courses/:id/monitor`.

### 7.8 Un monitor puede seguir usando su panel Estudiante
Como tiene roles `['S','M']`, puede cambiar de rol activo (si se implementa el selector de rol). No es bloqueante para la primera implementación: por defecto activa el rol `M` con mayor prioridad.
