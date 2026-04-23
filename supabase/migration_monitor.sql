-- ============================================================
-- MIGRACIÓN: Rol Monitor (M) + Módulo de Asistencia
-- WebNotas JILIU | La Promesa
--
-- Prerrequisito: SupabaseDDL.sql + migration_examen_online.sql
--               + migration_anio_lectivo.sql ya ejecutados.
--
-- Ejecutar en Supabase SQL Editor, sección por sección, en orden.
-- Cada PASO puede verificarse antes de continuar.
-- ============================================================


-- ============================================================
-- PASO 1 — Ampliar check constraint en type.code
--          para incluir 'E' (Secretaría) y 'M' (Monitor)
--
-- El constraint actual solo permite ('S','T','A').
-- Se busca el constraint por su nombre en pg_constraint
-- para no depender de un nombre hardcodeado.
-- ============================================================

DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.type'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%code%';

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.type DROP CONSTRAINT ' || quote_ident(cname);
    RAISE NOTICE 'Constraint % eliminado', cname;
  END IF;
END $$;

ALTER TABLE public.type
  ADD CONSTRAINT type_code_check
    CHECK (code IN ('S', 'T', 'A', 'E', 'M'));


-- ============================================================
-- PASO 2 — Insertar nuevos roles en tabla type
-- ============================================================

INSERT INTO public.type (code, name) VALUES
  ('E', 'Secretary'),
  ('M', 'Monitor')
ON CONFLICT (code) DO NOTHING;

-- Verificar:
-- SELECT * FROM public.type ORDER BY id;


-- ============================================================
-- PASO 3 — Agregar columna id_monitor a course
--          Un curso tiene como máximo un monitor.
--          ON DELETE SET NULL: si el usuario se elimina, el curso
--          queda sin monitor asignado (no se pierde el curso).
-- ============================================================

ALTER TABLE public.course
  ADD COLUMN IF NOT EXISTS id_monitor uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_course_monitor
  ON public.course (id_monitor)
  WHERE id_monitor IS NOT NULL;

-- Verificar:
-- SELECT id, name, year, level, id_monitor FROM public.course LIMIT 5;


-- ============================================================
-- PASO 4 — Crear tabla asistencia_sesion
--          Cabecera de una sesión de clase registrada por un monitor.
--
--          Clave de negocio (única): curso + módulo + materia + fecha.
--          El año se deriva de id_course → course.year.
--
--          id_teacher: profesor asignado (según class_teacher).
--          profesor_asistio: si el profesor asistió o no.
--          profesor_reemplazo: nombre libre, solo si no asistió.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.asistencia_sesion (
  id                  bigserial PRIMARY KEY,
  id_course           bigint      NOT NULL REFERENCES public.course(id)  ON DELETE RESTRICT,
  id_module           bigint      NOT NULL REFERENCES public.module(id)  ON DELETE RESTRICT,
  id_class            bigint      NOT NULL REFERENCES public.class(id)   ON DELETE RESTRICT,
  fecha_clase         date        NOT NULL,
  id_teacher          uuid        NOT NULL REFERENCES public.users(id)   ON DELETE RESTRICT,
  profesor_asistio    boolean     NOT NULL DEFAULT true,
  profesor_reemplazo  text,

  -- Unicidad de sesión: un curso no puede tener dos sesiones
  -- del mismo módulo, materia y fecha.
  CONSTRAINT asistencia_sesion_uq
    UNIQUE (id_course, id_module, id_class, fecha_clase)
);

COMMENT ON TABLE public.asistencia_sesion IS
  'Cabecera de sesión de clase. Una fila por combinación única curso+módulo+materia+fecha.';

COMMENT ON COLUMN public.asistencia_sesion.profesor_reemplazo IS
  'Nombre del profesor de reemplazo. Solo relevante cuando profesor_asistio = false.';


-- ============================================================
-- PASO 5 — Crear tabla asistencia_detalle
--          Asistencia de cada estudiante en una sesión.
--          ON DELETE CASCADE: si se elimina la sesión, se eliminan
--          todos los detalles asociados.
--
--          asistio = false por defecto (No asistió es el default).
--          motivo = 'sin información' por defecto.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.asistencia_detalle (
  id          bigserial   PRIMARY KEY,
  id_sesion   bigint      NOT NULL REFERENCES public.asistencia_sesion(id) ON DELETE CASCADE,
  id_student  uuid        NOT NULL REFERENCES public.users(id)             ON DELETE CASCADE,
  asistio     boolean     NOT NULL DEFAULT false,
  motivo      text        NOT NULL DEFAULT 'sin información',

  -- Un estudiante aparece una sola vez por sesión.
  CONSTRAINT asistencia_detalle_uq
    UNIQUE (id_sesion, id_student)
);

COMMENT ON TABLE public.asistencia_detalle IS
  'Asistencia de cada estudiante por sesión de clase.';

COMMENT ON COLUMN public.asistencia_detalle.asistio IS
  'true = asistió, false = no asistió. Default false (no asistió).';

COMMENT ON COLUMN public.asistencia_detalle.motivo IS
  'Motivo de inasistencia. Solo visible cuando asistio = false. Default: sin información.';


-- ============================================================
-- PASO 6 — Índices para asistencia_sesion y asistencia_detalle
-- ============================================================

-- Consultas por curso (reporte consolidado, lista de sesiones)
CREATE INDEX IF NOT EXISTS idx_asistencia_sesion_course
  ON public.asistencia_sesion (id_course);

-- Consultas por módulo + materia (dropdown de fechas en Consultar)
CREATE INDEX IF NOT EXISTS idx_asistencia_sesion_module_class
  ON public.asistencia_sesion (id_module, id_class);

-- Consultas por fecha (ordenamiento, rangos)
CREATE INDEX IF NOT EXISTS idx_asistencia_sesion_fecha
  ON public.asistencia_sesion (fecha_clase);

-- Índice compuesto para la query de cascada: curso+módulo+materia → fechas
CREATE INDEX IF NOT EXISTS idx_asistencia_sesion_course_module_class
  ON public.asistencia_sesion (id_course, id_module, id_class, fecha_clase DESC);

-- Detalles por sesión (carga de grilla)
CREATE INDEX IF NOT EXISTS idx_asistencia_detalle_sesion
  ON public.asistencia_detalle (id_sesion);

-- Detalles por estudiante (reporte individual, historial)
CREATE INDEX IF NOT EXISTS idx_asistencia_detalle_student
  ON public.asistencia_detalle (id_student);

-- Índice compuesto para el reporte pivot (sesion+student+asistio)
CREATE INDEX IF NOT EXISTS idx_asistencia_detalle_sesion_student_asistio
  ON public.asistencia_detalle (id_sesion, id_student, asistio);


-- ============================================================
-- PASO 7 — Función helper is_monitor() (para RLS)
-- (renumerado: el paso de triggers updated_at se eliminó)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_monitor()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_type ut
    JOIN public.type t ON t.id = ut.id_type
    WHERE ut.id_user = auth.uid() AND t.code = 'M'
  );
$$;

COMMENT ON FUNCTION public.is_monitor() IS
  'Devuelve true si el usuario autenticado tiene el rol Monitor (M).';


-- ============================================================
-- PASO 9 — RLS en asistencia_sesion
-- ============================================================

ALTER TABLE public.asistencia_sesion ENABLE ROW LEVEL SECURITY;

-- Admin: acceso completo
DROP POLICY IF EXISTS "asistencia_sesion_admin_all" ON public.asistencia_sesion;
CREATE POLICY "asistencia_sesion_admin_all" ON public.asistencia_sesion
  FOR ALL
  USING  (public.is_admin())
  WITH CHECK (public.is_admin());

-- Monitor: solo lectura y escritura en su propio curso
-- La validación precisa de id_course vs profile.id_course se hace en el backend.
-- Esta política es defensa en profundidad.
DROP POLICY IF EXISTS "asistencia_sesion_monitor_select" ON public.asistencia_sesion;
CREATE POLICY "asistencia_sesion_monitor_select" ON public.asistencia_sesion
  FOR SELECT
  USING (
    public.is_monitor()
    AND id_course IN (
      SELECT id_course FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "asistencia_sesion_monitor_insert" ON public.asistencia_sesion;
CREATE POLICY "asistencia_sesion_monitor_insert" ON public.asistencia_sesion
  FOR INSERT
  WITH CHECK (
    public.is_monitor()
    AND id_course IN (
      SELECT id_course FROM public.users WHERE id = auth.uid()
    )
    AND registrado_por = auth.uid()
  );

DROP POLICY IF EXISTS "asistencia_sesion_monitor_update" ON public.asistencia_sesion;
CREATE POLICY "asistencia_sesion_monitor_update" ON public.asistencia_sesion
  FOR UPDATE
  USING (
    public.is_monitor()
    AND id_course IN (
      SELECT id_course FROM public.users WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_monitor()
    AND id_course IN (
      SELECT id_course FROM public.users WHERE id = auth.uid()
    )
  );


-- ============================================================
-- PASO 10 — RLS en asistencia_detalle
-- ============================================================

ALTER TABLE public.asistencia_detalle ENABLE ROW LEVEL SECURITY;

-- Admin: acceso completo
DROP POLICY IF EXISTS "asistencia_detalle_admin_all" ON public.asistencia_detalle;
CREATE POLICY "asistencia_detalle_admin_all" ON public.asistencia_detalle
  FOR ALL
  USING  (public.is_admin())
  WITH CHECK (public.is_admin());

-- Monitor: acceso a detalles de sesiones de su curso
DROP POLICY IF EXISTS "asistencia_detalle_monitor_all" ON public.asistencia_detalle;
CREATE POLICY "asistencia_detalle_monitor_all" ON public.asistencia_detalle
  FOR ALL
  USING (
    public.is_monitor()
    AND EXISTS (
      SELECT 1 FROM public.asistencia_sesion s
      JOIN public.users u ON u.id = auth.uid()
      WHERE s.id = asistencia_detalle.id_sesion
        AND s.id_course = u.id_course
    )
  )
  WITH CHECK (
    public.is_monitor()
    AND EXISTS (
      SELECT 1 FROM public.asistencia_sesion s
      JOIN public.users u ON u.id = auth.uid()
      WHERE s.id = asistencia_detalle.id_sesion
        AND s.id_course = u.id_course
    )
  );

-- Estudiante: solo lectura de su propia asistencia
DROP POLICY IF EXISTS "asistencia_detalle_student_select" ON public.asistencia_detalle;
CREATE POLICY "asistencia_detalle_student_select" ON public.asistencia_detalle
  FOR SELECT
  USING (id_student = auth.uid());


-- ============================================================
-- VERIFICACIONES POST-MIGRACIÓN (ejecutar individualmente)
-- ============================================================

-- 1. Verificar roles disponibles:
-- SELECT * FROM public.type ORDER BY id;

-- 2. Verificar constraint de course:
-- \d public.course

-- 3. Verificar estructura de nuevas tablas:
-- \d public.asistencia_sesion
-- \d public.asistencia_detalle

-- 4. Verificar índices creados:
 SELECT indexname, tablename FROM pg_indexes
 WHERE tablename IN ('asistencia_sesion','asistencia_detalle')
 ORDER BY tablename, indexname;

-- 5. Verificar RLS activo:
 SELECT tablename, rowsecurity FROM pg_tables
 WHERE tablename IN ('asistencia_sesion','asistencia_detalle');

-- 6. Test función is_monitor (requiere auth.uid() válido):
 SELECT public.is_monitor();
