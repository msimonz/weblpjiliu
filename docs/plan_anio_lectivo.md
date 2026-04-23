# Plan de Implementación: Gestión por Año Lectivo
**WebNotas JILIU | La Promesa**

---

## Premisas clave

- Cada año lectivo tiene su propio catálogo: levels, modules, groups, classes, evaluation_types, materias.
- El año lectivo vigente se determina por `anio_lectivo.activo = true` (solo uno activo a la vez).
- Los datos de años anteriores permanecen en modo consulta. No se modifican ni eliminan.
- En el Admin: dropdown de año lectivo al lado derecho del dropdown "¿Qué quieres hacer?".
- En el Dashboard del estudiante: el campo "Año" (actualmente estático) pasa a ser un `<select>` real poblado desde `anio_lectivo`, con default = año activo.

---

## FASE 1 — Base de Datos

> Ejecutar en Supabase SQL Editor, en el orden indicado.
> Usar el script `supabase/migration_anio_lectivo.sql`.
> Cada paso puede verificarse antes de continuar al siguiente.

### BD-01 — Crear tabla `anio_lectivo` y seed inicial

**Script:** PASO 1 de `migration_anio_lectivo.sql`

- Crea la tabla `anio_lectivo (year PK, nombre, activo, created_at)`.
- Agrega índice único parcial: solo un registro con `activo = true` puede existir.
- Inserta el seed: `year=2026, nombre='Año Lectivo 2026', activo=true`.
- Habilita RLS: todos los usuarios autenticados pueden leer; solo admin escribe.

**Verificar:**
```sql
SELECT * FROM public.anio_lectivo;
-- Debe retornar 1 fila: year=2026, activo=true
```

---

### BD-02 — Agregar columna `year` a tablas de catálogo (con DEFAULT)

**Script:** PASO 2 de `migration_anio_lectivo.sql`

Tablas afectadas: `level`, `module`, `group`, `class`, `evaluation_type`.

- Agrega `year smallint DEFAULT 2026` en cada tabla.
- El DEFAULT es temporal para no violar NOT NULL en datos existentes.
- No agrega FK todavía (se agrega en BD-04 después del backfill).

**Verificar (inmediatamente después del PASO 2, antes del PASO 6):**
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('level','module','group','class','evaluation_type')
  AND column_name = 'year';
-- Debe aparecer una fila por tabla con column_default = '2026'
-- Después del PASO 6 (NOT NULL), column_default será NULL — eso es correcto.
```

---

### BD-03 — Agregar `year` a `materias` y reconstruir su PK

**Script:** PASO 3 de `migration_anio_lectivo.sql`

- Agrega `year smallint DEFAULT 2026` a `materias`.
- Elimina la PK original `(id_class)`.
- Crea nueva PK `(id_class, year)` — permite el mismo id_class en distintos años.

**Verificar:**
```sql
SELECT kcu.column_name                                                                                                                                          
FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu                                                                                                                      
  ON kcu.constraint_name = tc.constraint_name
    AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'materias'
    AND tc.constraint_type = 'PRIMARY KEY'
  ORDER BY kcu.ordinal_position;

-- PK debe ser (id_class, year)
```

---

### BD-04 — Agregar FK `year → anio_lectivo` en todas las tablas

**Script:** PASO 4 de `migration_anio_lectivo.sql`

> ⚠️ Ejecutar DESPUÉS de BD-05 (backfill) si la base ya tiene datos.
> Si la base está vacía, puede ejecutarse aquí directamente.

Tablas: `level`, `module`, `group`, `class`, `evaluation_type`, `materias`, `course`.

- Agrega constraint `FOREIGN KEY (year) REFERENCES anio_lectivo(year) ON DELETE RESTRICT` en cada tabla.
- `course` ya tenía la columna `year` — solo se agrega la FK.

---

### BD-05 — Backfill: asignar `year = 2026` a todos los registros existentes

**Script:** PASO 5 de `migration_anio_lectivo.sql`

> ⚠️ Ejecutar ANTES de BD-06 (NOT NULL) y, si corresponde, antes de BD-04 (FK).

```sql
UPDATE public.level           SET year = 2026 WHERE year IS NULL;
UPDATE public.module          SET year = 2026 WHERE year IS NULL;
UPDATE public.group           SET year = 2026 WHERE year IS NULL;
UPDATE public.class           SET year = 2026 WHERE year IS NULL;
UPDATE public.evaluation_type SET year = 2026 WHERE year IS NULL;
UPDATE public.materias        SET year = 2026 WHERE year IS NULL;
```

**Verificar:**
```sql
SELECT 'level' AS t, count(*) FROM public.level WHERE year IS NULL
UNION ALL SELECT 'module', count(*) FROM public.module WHERE year IS NULL
UNION ALL SELECT 'group', count(*) FROM public.group WHERE year IS NULL
UNION ALL SELECT 'class', count(*) FROM public.class WHERE year IS NULL
UNION ALL SELECT 'evaluation_type', count(*) FROM public.evaluation_type WHERE year IS NULL
UNION ALL SELECT 'materias', count(*) FROM public.materias WHERE year IS NULL;
-- Todos deben retornar 0
```

---

### BD-06 — Quitar DEFAULT y agregar NOT NULL

**Script:** PASO 6 de `migration_anio_lectivo.sql`

- En cada tabla: `ALTER COLUMN year SET NOT NULL` + `DROP DEFAULT`.
- Garantiza que todo registro futuro deba declarar explícitamente su año.

**Verificar:**
```sql
SELECT table_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'year'
  AND table_name IN ('level','module','group','class','evaluation_type','materias');
-- column_default debe ser NULL, is_nullable debe ser NO
```

---

### BD-07 — Agregar constraints de unicidad por año

**Script:** PASO 7 de `migration_anio_lectivo.sql`

- `level`: `UNIQUE (name, year)` — mismo nombre de nivel no se repite en un año.
- `module`: `UNIQUE (name, year)`.
- `evaluation_type`: elimina el `UNIQUE (type)` global; agrega `UNIQUE (type, year)`.
- `class`: `UNIQUE (name, level, id_module, year)`.

**Verificar:**
```sql
SELECT conname, contype
FROM pg_constraint
WHERE conrelid IN ('public.level'::regclass, 'public.module'::regclass,
                   'public.evaluation_type'::regclass, 'public.class'::regclass)
  AND contype = 'u';
```

---

### BD-08 — Crear índices por `year`

**Script:** PASO 8 de `migration_anio_lectivo.sql`

Crea `CREATE INDEX IF NOT EXISTS idx_<tabla>_year` en:
`level`, `module`, `group`, `class`, `evaluation_type`, `materias`, `course`.

Estos índices son necesarios para que los filtros `WHERE year = ?` sean eficientes.

---

### BD-09 — Corregir PK de `class_teacher`

**Script:** PASO 9 de `migration_anio_lectivo.sql`

> ⚠️ ANTES de ejecutar, verificar que no haya registros con `id_course IS NULL`:
```sql
SELECT * FROM public.class_teacher WHERE id_course IS NULL;
```
> Si hay registros, actualizar `id_course` manualmente antes de continuar.

- Agrega `NOT NULL` a `class_teacher.id_course`.
- Elimina PK actual `(id_teacher, id_class)`.
- Crea nueva PK `(id_teacher, id_class, id_course)`.
- Agrega índice `idx_class_teacher_course`.

**Efecto:** permite que el mismo profesor esté asignado a la misma materia en distintos años lectivos.

**Verificar:**
```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.class_teacher'::regclass AND contype = 'p';
-- Debe mostrar la nueva PK
```

---

### BD-10 — Agregar `id_course` a `attendance`

**Script:** PASO 10 de `migration_anio_lectivo.sql`

- Agrega `id_course bigint REFERENCES course(id) ON DELETE SET NULL` a `attendance`.
- Crea índice `idx_attendance_course`.
- Ejecuta backfill: asigna el curso actual del estudiante a registros históricos.

**Verificar:**
```sql
SELECT count(*) FROM public.attendance WHERE id_course IS NULL;
-- Idealmente 0 (o bajo si hay estudiantes sin curso asignado)
```

---

### BD-11 — Trigger de consistencia en `examen_programacion`

**Script:** PASO 11 de `migration_anio_lectivo.sql`

- Crea función `fn_check_examen_prog_year()`.
- Crea trigger `trg_examen_prog_year` (BEFORE INSERT OR UPDATE).
- Garantiza que `examen_programacion.year = course.year` del `id_course` referenciado.
- Previene inconsistencia entre el año explícito y el año implícito de la programación.

**Verificar consistencia en datos existentes:**
```sql
SELECT ep.id, ep.id_course, ep.year AS ep_year, c.year AS course_year
FROM public.examen_programacion ep
JOIN public.course c ON c.id = ep.id_course
WHERE ep.year <> c.year;
-- Debe retornar 0 filas. Si hay filas, corregir antes de crear el trigger.
```

---

## FASE 2 — Backend

### BE-01 — Helper centralizado `getAnioLectivoVigente()`
- Archivo: `backend/src/lib/anioLectivo.js`
- Lee `anio_lectivo WHERE activo = true`.
- Cache en memoria con TTL de 5 minutos.
- Exporta también `invalidarCacheAnioLectivo()`.

### BE-02 — Helper `requireAnioVigenteForCourse(supabaseAdmin, id_course)`
- Valida que `course.year = anioVigente`.
- Lanza HTTP 403 si no coincide.

### BE-03 — Helper `requireAnioVigenteForTable(supabaseAdmin, table, id)`
- Valida que el registro de catálogo tiene `year = anioVigente`.
- Lanza HTTP 403 si no coincide.

### BE-04 — Endpoints de gestión del año lectivo (Admin)
- `GET  /api/admin/anio-lectivo` — lista todos los años + indica cuál está activo.
- `POST /api/admin/anio-lectivo` — crea un nuevo año `{ year, nombre }`.
- `PUT  /api/admin/anio-lectivo/activo` — activa un año `{ year }`, invalida cache.

### BE-05 — Todos los GET de catálogo aceptan `?year=` (default = vigente)
- `levels`, `modules`, `groups`, `classes`, `evaluation-types`, `materias`.

### BE-06 — Todos los POST/DELETE de catálogo validan año vigente
- `POST levels`, `POST modules`, `POST groups`, `POST classes`, `POST evaluation-types`.
- `DELETE` de cualquier registro de catálogo: `requireAnioVigenteForTable`.

### BE-07 — Proteger escrituras en evaluaciones y notas
- `admin.js`: `POST/PUT/DELETE /evaluations` → `requireAnioVigenteForCourse`.
- `admin.js`: `POST /grades` → validar año via evaluation.
- `teacher.js`: `POST/PUT/DELETE /evaluations` → `requireAnioVigenteForCourse`.
- `teacher.js`: `POST /grades` → validar año via evaluation.

### BE-08 — Proteger escrituras en asignaciones y exámenes
- `admin.js`: assign/unassign teacher → `requireAnioVigenteForCourse`.
- `admin.js`: `POST/PUT/DELETE /exams` → `requireAnioVigenteForCourse`.
- `admin.js`: `POST/PATCH/DELETE /exam-schedules` → validar año.
- `student.js`: submit examen → verificar `examen_programacion.id_course → course.year = vigente`.
- `admin.js`: reset intento de examen → verificar año vigente.

### BE-09 — Proteger importación Excel
- `admin.js` upload-users: validar que el `id_course` del Excel pertenece al año vigente.

### BE-10 — Queries históricas aceptan `?year=`
- `GET /admin/grade-grid?year=`
- `GET /student/subjects?year=`
- `GET /student/grades/:classId?year=`
- `GET /teacher/dashboard` → filtrar por año vigente; aceptar `?year=` para histórico.
- `GET /student/my-courses` → retornar TODO el historial sin filtrar por año (el frontend filtra).

---

## FASE 3 — Frontend

### FE-01 — Hook y contexto global `useAnioLectivo`
- Archivo: `frontend/src/lib/useAnioLectivo.ts`
- Carga la lista de años desde `GET /api/admin/anio-lectivo`.
- Expone: `{ anios, vigente, selected, setSelected, isCurrentYear }`.
- Se monta en `layout.tsx` y se comparte via Context.

### FE-02 — Admin: dropdown "Año Lectivo" junto al "¿Qué quieres hacer?"
- Posición: al lado derecho del `<select>` de acciones (línea ~1967 de `admin/page.tsx`).
- Poblado desde `useAnioLectivo().anios`.
- Default: año activo.
- Al cambiar: todos los `apiFetch` del admin pasan `?year=<selected>`.

### FE-03 — Admin: banner modo consulta
- Cuando el año seleccionado ≠ vigente: mostrar banner "Modo consulta — Año [X] (solo lectura)".
- Todos los botones de crear/editar/eliminar quedan `disabled={!isCurrentYear}`.

### FE-04 — Admin: sección "Año Lectivo" (nueva vista)
- Nueva opción en el dropdown "¿Qué quieres hacer?": `"ANIO_LECTIVO"`.
- Permite: ver lista de años, crear un nuevo año, activar un año.
- Llama a los endpoints de BE-04.

### FE-05 — Student dashboard: "Año" pasa a `<select>` real
- Archivo: `frontend/src/app/dashboard/page.tsx`, líneas 513-521.
- El `div` que muestra `selectedCourseForLevel?.year` se reemplaza por un `<select>`.
- Poblado desde `useAnioLectivo().anios`.
- Default: año activo.
- Al cambiar el año: filtrar `studentCourses` por ese año → actualizar `availableLevels`.

### FE-06 — Student dashboard: comportamiento por año seleccionado
- Año vigente: comportamiento actual sin cambios.
- Año histórico:
  - Ocultar botones "Tomar Examen".
  - Mostrar badge "Histórico — [Año]".
  - Si no hay cursos del estudiante en ese año: mensaje "No hay datos para este año lectivo".

### FE-07 — Teacher dashboard: contexto de año
- Mostrar badge del año lectivo vigente en la cabecera.
- Filtrar materias asignadas por año vigente.
- Bloquear creación de evaluaciones si visualizando año histórico.

---

## FASE 4 — QA

### QA-01 — Integridad histórica
- Crear datos en 2026, activar 2027, verificar que los datos de 2026 no cambian.
- Consultar datos de 2026 via `?year=2026` → deben retornar correctamente.

### QA-02 — Protección de escritura en años no vigentes
- Intentar POST/PUT/DELETE sobre evaluación de 2026 con 2027 activo → debe retornar HTTP 403.
- Intentar crear class/level/course con year=2026 cuando 2027 es vigente → HTTP 403.

### QA-03 — Trigger de `examen_programacion`
- Intentar insertar `examen_programacion` con `year ≠ course.year` → debe lanzar excepción.

### QA-04 — PK de `class_teacher`
- Asignar el mismo profesor a la misma materia en cursos de 2026 y 2027 → debe permitirse.
- Intentar duplicar la misma asignación dentro del mismo año → debe fallar (violación de PK).

### QA-05 — Frontend Admin
- Cambiar año en el dropdown → todos los selectores de la vista se recargan con datos del año seleccionado.
- En año histórico: botones de creación deshabilitados y banner visible.

### QA-06 — Frontend Student
- Cambiar año en el dashboard → `availableLevels` refleja solo los niveles del año seleccionado.
- En año vigente: botón "Tomar Examen" visible. En año histórico: oculto.

---

## Orden de ejecución recomendado

```
BD-01 → BD-02 → BD-03 → BD-05 → BD-04 → BD-06 → BD-07 → BD-08 → BD-09 → BD-10 → BD-11
BE-01 → BE-02 → BE-03 → BE-04 → BE-05 → BE-06 → BE-07 → BE-08 → BE-09 → BE-10
FE-01 → FE-02 → FE-03 → FE-04 → FE-05 → FE-06 → FE-07
QA-01 → QA-02 → QA-03 → QA-04 → QA-05 → QA-06
```

> BD-04 (FKs) debe ejecutarse después de BD-05 (backfill) para no fallar con valores existentes.

---

## Notas de riesgo

| Riesgo | Mitigación |
|---|---|
| `class_teacher` con `id_course IS NULL` | Verificar con SELECT antes de BD-09; corregir manualmente si hay casos |
| `examen_programacion` con `year ≠ course.year` | Verificar con SELECT antes de BD-11; corregir antes de crear el trigger |
| Catálogo vacío al crear el año 2027 | Proveer en el futuro un botón "Copiar catálogo del año anterior" (mejora futura) |
| Cache backend desincronizado al activar nuevo año | `invalidarCacheAnioLectivo()` se llama en el endpoint PUT de BE-04 |
| `evaluation_type` pierde UNIQUE global | El nuevo `UNIQUE(type, year)` es intencional — mismo nombre puede existir en distintos años |
