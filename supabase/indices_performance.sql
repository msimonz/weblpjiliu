-- ============================================================
-- WebNotas JILIU | La Promesa — Índices de Performance
-- Índices faltantes identificados por análisis de queries.
-- Todos los que existen en SupabaseDDL.sql y migration_monitor.sql
-- están EXCLUIDOS para evitar duplicados.
--
-- INSTRUCCIONES DE USO:
--   Ejecutar en Supabase SQL Editor, o vía psql.
--   CONCURRENTLY evita bloquear lectura/escritura en producción,
--   pero requiere ejecutar cada sentencia por separado (no dentro
--   de un bloque de transacción explícito).
-- ============================================================


-- ============================================================
-- PRIORIDAD ALTA
-- ============================================================

-- 1. grades(id_exam, id_student)
--    El PK actual es (id_student, id_exam): eficiente cuando se filtra
--    por alumno primero, pero NO cuando se filtra por examen primero.
--    grade-grids-batch consulta:
--      WHERE id_exam IN (...) AND id_student IN (...)
--    Con N exámenes y M alumnos, este índice lo resuelve en O(N log R)
--    en lugar de O(total_grades).
create index concurrently if not exists idx_grades_exam_student
  on public.grades (id_exam, id_student);


-- 2. evaluation(id_group, created_at ASC, id ASC)
--    No existe ningún índice en evaluation.id_group.
--    Queries afectadas:
--      • group-grade-grid: WHERE id_group = ? ORDER BY created_at, id
--      • Lista de evaluaciones del profesor: WHERE id_group IN (...)
--    Sin este índice ambas hacen seq scan sobre toda la tabla.
create index concurrently if not exists idx_evaluation_group_created_id
  on public.evaluation (id_group, created_at asc, id asc);


-- 3. class_teacher(id_teacher, id_course)
--    El PK (id_teacher, id_class, id_course) cubre WHERE id_teacher = ?
--    pero NO WHERE id_teacher = ? AND id_course = ? (sin especificar id_class).
--    Queries afectadas:
--      • /attendance/modules: WHERE id_teacher = ? AND id_course = ?
--      • /attendance/classes: WHERE id_teacher = ? AND id_course = ?
--      • /attendance/fechas:  WHERE id_teacher = ? AND id_course = ?
--    Son las queries que más se ejecutan en el módulo de asistencia.
create index concurrently if not exists idx_class_teacher_teacher_course
  on public.class_teacher (id_teacher, id_course);


-- ============================================================
-- PRIORIDAD MEDIA
-- ============================================================

-- 4. class(year, level)
--    Índices actuales: idx_class_year(year) e idx_class_level_name(level, name).
--    Ninguno cubre de forma óptima WHERE year = ? AND level = ?.
--    Queries afectadas:
--      • Dashboard del alumno: clase por nivel+año
--      • Monitor: clases por nivel+año (± módulo)
create index concurrently if not exists idx_class_year_level
  on public.class (year, level);


-- 5. course(year, level)
--    Índice actual: idx_course_year(year) — no incluye level.
--    Queries afectadas:
--      • Dashboard: WHERE year = ? AND level IN (...)
--      • getTeacherClasses: resolución de cursos por nivel+año
create index concurrently if not exists idx_course_year_level
  on public.course (year, level);


-- 6. user_type(id_type, id_user)
--    El índice actual user_type_type_idx(id_type) requiere filtrar
--    id_user en memoria después del index scan.
--    Un índice compuesto cubre la query entera como index-only scan:
--      WHERE id_type = ? AND id_user IN (...)
--    Queries afectadas: getStudentsByCourseIds (muy frecuente).
create index concurrently if not exists idx_user_type_type_user
  on public.user_type (id_type, id_user);


-- 7. examen_programacion(id_course, id_evaluation)
--    Índice actual idx_examen_prog_course_habilitado(id_course, habilitado)
--    no incluye id_evaluation.
--    Query del dashboard del alumno:
--      WHERE id_course = ? AND id_evaluation IN (...)
--    Con muchos exámenes programados por curso, este índice evita
--    filtrar todos los registros del curso para encontrar los evaluaciones.
create index concurrently if not exists idx_examen_prog_course_evaluation
  on public.examen_programacion (id_course, id_evaluation);


-- 8. class_teacher(id_class, id_course)
--    El índice actual idx_class_teacher_id_class(id_class) no incluye id_course.
--    Query del monitor al verificar asignación profesor-materia-curso:
--      WHERE id_class = ? AND id_course = ?
create index concurrently if not exists idx_class_teacher_class_course
  on public.class_teacher (id_class, id_course);


-- ============================================================
-- PRIORIDAD BAJA / REFINAMIENTO
-- ============================================================

-- 9. evaluation(id_teacher, id_class, created_at DESC, id DESC)
--    El índice actual idx_evaluation_teacher_created_desc(id_teacher, created_at desc)
--    escanea todas las evaluaciones del profesor aunque se filtre por materia.
--    Este índice compuesto soporta:
--      WHERE id_teacher = ? AND id_class = ? ORDER BY created_at DESC, id DESC
create index concurrently if not exists idx_evaluation_teacher_class_created
  on public.evaluation (id_teacher, id_class, created_at desc, id desc);


-- 10. class(year, level, id_module)
--     Extensión de idx_class_year_level para incluir módulo.
--     Permite index-only scan en la query del monitor:
--       WHERE year = ? AND level = ? AND id_module = ?
--     (si no se crea este, la BD usa idx_class_year_level + filtro en memoria)
create index concurrently if not exists idx_class_year_level_module
  on public.class (year, level, id_module);
