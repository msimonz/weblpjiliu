-- ============================================================
-- MIGRACIÓN: Año Lectivo por Entidad
-- WebNotas JILIU | La Promesa
--
-- Prerrequisito: SupabaseDDL.sql + migration_examen_online.sql
-- ya ejecutados en la base de datos.
--
-- Ejecutar en Supabase SQL Editor, sección por sección, en orden.
-- Cada PASO es independiente y puede verificarse antes de continuar.
-- ============================================================


-- ============================================================
-- PASO 1 — Tabla maestra anio_lectivo
-- ============================================================

CREATE TABLE IF NOT EXISTS public.anio_lectivo (
  year       smallint PRIMARY KEY,
  nombre     text NOT NULL,
  activo     boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Solo puede haber un año activo a la vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_anio_lectivo_activo_uq
  ON public.anio_lectivo (activo)
  WHERE activo = true;

-- Seed: año lectivo vigente
INSERT INTO public.anio_lectivo (year, nombre, activo)
VALUES (2026, 'Año Lectivo 2026', true)
ON CONFLICT (year) DO NOTHING;

-- RLS
ALTER TABLE public.anio_lectivo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anio_select_auth"  ON public.anio_lectivo;
DROP POLICY IF EXISTS "anio_admin_all"    ON public.anio_lectivo;

CREATE POLICY "anio_select_auth"
  ON public.anio_lectivo FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "anio_admin_all"
  ON public.anio_lectivo FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_type ut
      JOIN public.type t ON t.id = ut.id_type
      WHERE ut.id_user = auth.uid() AND t.code = 'A'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_type ut
      JOIN public.type t ON t.id = ut.id_type
      WHERE ut.id_user = auth.uid() AND t.code = 'A'
    )
  );


-- ============================================================
-- PASO 2 — Agregar columna year a tablas de catálogo
--          (con DEFAULT 2026 para no violar NOT NULL en datos existentes)
-- ============================================================

ALTER TABLE public.level
  ADD COLUMN IF NOT EXISTS year smallint DEFAULT 2026;

ALTER TABLE public.module
  ADD COLUMN IF NOT EXISTS year smallint DEFAULT 2026;

ALTER TABLE public.group
  ADD COLUMN IF NOT EXISTS year smallint DEFAULT 2026;

ALTER TABLE public.class
  ADD COLUMN IF NOT EXISTS year smallint DEFAULT 2026;

ALTER TABLE public.evaluation_type
  ADD COLUMN IF NOT EXISTS year smallint DEFAULT 2026;


-- ============================================================
-- PASO 3 — Agregar year a materias y reconstruir su PK
-- ============================================================

-- 3a. Agregar columna year a materias
ALTER TABLE public.materias
  ADD COLUMN IF NOT EXISTS year smallint DEFAULT 2026;

-- 3b. Reconstruir PK de materias para incluir year
--     La PK original era solo (id_class). La nueva es (id_class, year).
ALTER TABLE public.materias DROP CONSTRAINT IF EXISTS pk_materias;
ALTER TABLE public.materias ADD CONSTRAINT pk_materias PRIMARY KEY (id_class, year);


-- ============================================================
-- PASO 4 — Agregar FK year → anio_lectivo en todas las tablas
--          (después del backfill, para no fallar con valores NULL/inválidos)
-- ============================================================

-- NOTA: ejecutar PASO 5 (backfill) ANTES de este paso si ya hay datos.
--       Si la base es nueva, se puede ejecutar aquí directamente.
--
-- PostgreSQL no soporta ADD CONSTRAINT IF NOT EXISTS.
-- Se usa un bloque DO que verifica la existencia antes de agregar.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_level_anio'
  ) THEN
    ALTER TABLE public.level
      ADD CONSTRAINT fk_level_anio
        FOREIGN KEY (year) REFERENCES public.anio_lectivo(year) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_module_anio'
  ) THEN
    ALTER TABLE public.module
      ADD CONSTRAINT fk_module_anio
        FOREIGN KEY (year) REFERENCES public.anio_lectivo(year) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_group_anio'
  ) THEN
    ALTER TABLE public.group
      ADD CONSTRAINT fk_group_anio
        FOREIGN KEY (year) REFERENCES public.anio_lectivo(year) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_class_anio'
  ) THEN
    ALTER TABLE public.class
      ADD CONSTRAINT fk_class_anio
        FOREIGN KEY (year) REFERENCES public.anio_lectivo(year) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_eval_type_anio'
  ) THEN
    ALTER TABLE public.evaluation_type
      ADD CONSTRAINT fk_eval_type_anio
        FOREIGN KEY (year) REFERENCES public.anio_lectivo(year) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_materias_anio'
  ) THEN
    ALTER TABLE public.materias
      ADD CONSTRAINT fk_materias_anio
        FOREIGN KEY (year) REFERENCES public.anio_lectivo(year) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_course_anio'
  ) THEN
    ALTER TABLE public.course
      ADD CONSTRAINT fk_course_anio
        FOREIGN KEY (year) REFERENCES public.anio_lectivo(year) ON DELETE RESTRICT;
  END IF;
END $$;


-- ============================================================
-- PASO 5 — Backfill: asignar year = 2026 a todos los registros existentes
--          (ejecutar ANTES del PASO 6 que quita el DEFAULT)
-- ============================================================

UPDATE public.level          SET year = 2026 WHERE year IS NULL;
UPDATE public.module         SET year = 2026 WHERE year IS NULL;
UPDATE public.group          SET year = 2026 WHERE year IS NULL;
UPDATE public.class          SET year = 2026 WHERE year IS NULL;
UPDATE public.evaluation_type SET year = 2026 WHERE year IS NULL;
UPDATE public.materias       SET year = 2026 WHERE year IS NULL;


-- ============================================================
-- PASO 6 — Quitar DEFAULT y agregar NOT NULL
-- ============================================================

ALTER TABLE public.level           ALTER COLUMN year SET NOT NULL;
ALTER TABLE public.level           ALTER COLUMN year DROP DEFAULT;

ALTER TABLE public.module          ALTER COLUMN year SET NOT NULL;
ALTER TABLE public.module          ALTER COLUMN year DROP DEFAULT;

ALTER TABLE public.group           ALTER COLUMN year SET NOT NULL;
ALTER TABLE public.group           ALTER COLUMN year DROP DEFAULT;

ALTER TABLE public.class           ALTER COLUMN year SET NOT NULL;
ALTER TABLE public.class           ALTER COLUMN year DROP DEFAULT;

ALTER TABLE public.evaluation_type ALTER COLUMN year SET NOT NULL;
ALTER TABLE public.evaluation_type ALTER COLUMN year DROP DEFAULT;

ALTER TABLE public.materias        ALTER COLUMN year SET NOT NULL;
ALTER TABLE public.materias        ALTER COLUMN year DROP DEFAULT;


-- ============================================================
-- PASO 7 — Constraints de unicidad en catálogo por año
-- ============================================================

-- level: mismo nombre no puede repetirse dentro del mismo año
ALTER TABLE public.level
  DROP CONSTRAINT IF EXISTS level_name_year_uq;
ALTER TABLE public.level
  ADD CONSTRAINT level_name_year_uq UNIQUE (name, year);

-- module: mismo nombre no puede repetirse dentro del mismo año
ALTER TABLE public.module
  DROP CONSTRAINT IF EXISTS module_name_year_uq;
ALTER TABLE public.module
  ADD CONSTRAINT module_name_year_uq UNIQUE (name, year);

-- evaluation_type: el nombre de tipo puede repetirse entre años, pero no dentro del mismo año
--   Primero eliminar el UNIQUE global que ya existe: evaluation_type_type_key
ALTER TABLE public.evaluation_type
  DROP CONSTRAINT IF EXISTS evaluation_type_type_key;
ALTER TABLE public.evaluation_type
  DROP CONSTRAINT IF EXISTS eval_type_name_year_uq;
ALTER TABLE public.evaluation_type
  ADD CONSTRAINT eval_type_name_year_uq UNIQUE (type, year);

-- class: mismo nombre + nivel + módulo no puede repetirse en el mismo año
ALTER TABLE public.class
  DROP CONSTRAINT IF EXISTS class_name_level_module_year_uq;
ALTER TABLE public.class
  ADD CONSTRAINT class_name_level_module_year_uq UNIQUE (name, level, id_module, year);


-- ============================================================
-- PASO 8 — Índices por year en tablas de catálogo
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_level_year
  ON public.level (year);

CREATE INDEX IF NOT EXISTS idx_module_year
  ON public.module (year);

CREATE INDEX IF NOT EXISTS idx_group_year
  ON public.group (year);

CREATE INDEX IF NOT EXISTS idx_class_year
  ON public.class (year);

CREATE INDEX IF NOT EXISTS idx_eval_type_year
  ON public.evaluation_type (year);

CREATE INDEX IF NOT EXISTS idx_materias_year
  ON public.materias (year);

CREATE INDEX IF NOT EXISTS idx_course_year
  ON public.course (year);


-- ============================================================
-- PASO 9 — Corregir PK de class_teacher
--
-- PROBLEMA ACTUAL: PK (id_teacher, id_class) impide que el mismo
-- profesor sea asignado a la misma materia en años distintos.
-- SOLUCIÓN: PK pasa a (id_teacher, id_class, id_course).
--
-- IMPORTANTE: Verificar primero que no existen registros con
-- id_course NULL antes de ejecutar el ALTER:
--
--   SELECT * FROM public.class_teacher WHERE id_course IS NULL;
--
-- Si existen, actualizar id_course en esos registros antes de continuar.
-- ============================================================

-- 9a. Verificar NULLs (este SELECT no modifica nada; revisar resultado)
-- SELECT count(*) FROM public.class_teacher WHERE id_course IS NULL;

-- 9b. Agregar NOT NULL a id_course (fallará si hay NULLs — ver nota arriba)
ALTER TABLE public.class_teacher
  ALTER COLUMN id_course SET NOT NULL;

-- 9c. Reemplazar PK
ALTER TABLE public.class_teacher DROP CONSTRAINT IF EXISTS class_teacher_pkey;
ALTER TABLE public.class_teacher ADD PRIMARY KEY (id_teacher, id_class, id_course);

-- 9d. Índice de apoyo por id_course
CREATE INDEX IF NOT EXISTS idx_class_teacher_course
  ON public.class_teacher (id_course);


-- ============================================================
-- PASO 10 — Agregar id_course a attendance
-- ============================================================

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS id_course bigint
    REFERENCES public.course(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_course
  ON public.attendance (id_course);

-- Backfill: inferir id_course desde el curso actual del estudiante.
-- NOTA: este backfill usa el curso vigente del estudiante.
--       Si el estudiante cambió de curso, la asistencia histórica
--       quedará con el curso más reciente (aceptable para datos previos).
UPDATE public.attendance a
SET id_course = u.id_course
FROM public.users u
WHERE u.id = a.id_student
  AND a.id_course IS NULL
  AND u.id_course IS NOT NULL;


-- ============================================================
-- PASO 11 — Trigger: consistencia de year en examen_programacion
--
-- examen_programacion tiene dos referencias al año:
--   - id_course → course.year  (implícito)
--   - year                     (explícito)
-- Este trigger garantiza que ambos siempre coincidan.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_check_examen_prog_year()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_course_year smallint;
BEGIN
  SELECT year INTO v_course_year
  FROM public.course
  WHERE id = NEW.id_course;

  IF v_course_year IS NULL THEN
    RAISE EXCEPTION 'examen_programacion: id_course % no existe en course', NEW.id_course;
  END IF;

  IF v_course_year <> NEW.year THEN
    RAISE EXCEPTION
      'examen_programacion: year (%) debe coincidir con course.year (%) para id_course=%',
      NEW.year, v_course_year, NEW.id_course;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_examen_prog_year ON public.examen_programacion;
CREATE TRIGGER trg_examen_prog_year
  BEFORE INSERT OR UPDATE ON public.examen_programacion
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_examen_prog_year();

-- Verificar consistencia en datos existentes (no modifica, solo reporta):
  SELECT ep.id, ep.id_course, ep.year AS ep_year, c.year AS course_year
  FROM public.examen_programacion ep
  JOIN public.course c ON c.id = ep.id_course    
  WHERE ep.year <> c.year;
