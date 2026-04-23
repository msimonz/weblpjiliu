-- ============================================================
-- MIGRACIÓN: Módulo Exámenes Online
-- Ejecutar en Supabase SQL Editor (en orden)
-- ============================================================


-- ------------------------------------------------------------
-- TAREA 1: Columna tiempo_minutos en evaluation
-- ------------------------------------------------------------
ALTER TABLE public.evaluation
  ADD COLUMN IF NOT EXISTS tiempo_minutos smallint;


-- ------------------------------------------------------------
-- TAREA 2: examen_programacion
-- Habilita un examen para un curso+año, n veces por examen
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.examen_programacion (
  id           bigserial PRIMARY KEY,
  id_evaluation bigint NOT NULL REFERENCES public.evaluation(id) ON DELETE CASCADE,
  id_course    bigint NOT NULL REFERENCES public.course(id) ON DELETE CASCADE,
  year         smallint NOT NULL,
  fecha_ini         timestamptz,
  fecha_fin         timestamptz,
  fecha_limite_ver  timestamptz,
  habilitado        boolean NOT NULL DEFAULT false,
  created_at        timestamptz DEFAULT now()
);

-- Agregar fecha_limite_ver si la tabla ya existe (idempotente)
ALTER TABLE public.examen_programacion
  ADD COLUMN IF NOT EXISTS fecha_limite_ver timestamptz;

-- Renombrar columna fecha_ver → fecha_limite_ver (idempotente vía DO block)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'examen_programacion'
      AND column_name  = 'fecha_ver'
  ) THEN
    ALTER TABLE public.examen_programacion
      RENAME COLUMN fecha_ver TO fecha_limite_ver;
  END IF;
END $$;


-- ------------------------------------------------------------
-- FK rta_examen → examen_programacion con ON DELETE SET NULL
-- ------------------------------------------------------------
ALTER TABLE public.rta_examen
  DROP CONSTRAINT IF EXISTS rta_examen_id_programacion_fkey,
  ADD CONSTRAINT rta_examen_id_programacion_fkey
    FOREIGN KEY (id_programacion)
    REFERENCES public.examen_programacion(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_examen_prog_evaluation
  ON public.examen_programacion (id_evaluation);

CREATE INDEX IF NOT EXISTS idx_examen_prog_course_habilitado
  ON public.examen_programacion (id_course, habilitado);


-- ------------------------------------------------------------
-- TAREA 3: examen_detalle
-- Preguntas y respuestas correctas de un examen
--
-- Estructura de opciones (jsonb):
--   multiple_multi / multiple_single:
--     [{"id":"a","texto":"..."},{"id":"b","texto":"..."},...]
--   falso_verdadero:
--     [{"id":"V","texto":"Verdadero"},{"id":"F","texto":"Falso"}]
--   emparejamiento:
--     {"izquierda":[{"id":"1","texto":"..."},...],
--      "derecha":[{"id":"a","texto":"..."},...]}
--
-- Estructura de respuesta_correcta (jsonb):
--   multiple_multi:   ["a","c"]
--   multiple_single:  ["b"]
--   falso_verdadero:  ["V"]
--   emparejamiento:   {"1":"a","2":"b",...}
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.examen_detalle (
  id            bigserial PRIMARY KEY,
  id_evaluation bigint NOT NULL REFERENCES public.evaluation(id) ON DELETE CASCADE,
  orden         smallint NOT NULL CHECK (orden BETWEEN 1 AND 20),
  tipo          text NOT NULL CHECK (tipo IN (
                  'multiple_multi',
                  'multiple_single',
                  'falso_verdadero',
                  'emparejamiento'
                )),
  enunciado     text NOT NULL,
  puntos        numeric(5,2) NOT NULL CHECK (puntos > 0),
  opciones      jsonb NOT NULL,
  respuesta_correcta jsonb NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (id_evaluation, orden)
);

CREATE INDEX IF NOT EXISTS idx_examen_detalle_evaluation
  ON public.examen_detalle (id_evaluation, orden);


-- ------------------------------------------------------------
-- TAREA 4: rta_examen
-- Respuestas del estudiante + calificación
-- FK compuesta a grades (se inserta DESPUÉS de calificar)
--
-- Estructura de respuestas (jsonb):
--   [{"id_detalle": 1, "respuesta": ["b"]},
--    {"id_detalle": 2, "respuesta": {"1":"a","2":"b"}},...]
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rta_examen (
  id             bigserial PRIMARY KEY,
  id_student     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  id_evaluation  bigint NOT NULL REFERENCES public.evaluation(id) ON DELETE CASCADE,
  id_programacion bigint REFERENCES public.examen_programacion(id),
  respuestas     jsonb NOT NULL DEFAULT '[]',
  calificacion   numeric(5,2),
  iniciado_at    timestamptz,
  finalizado_at  timestamptz,
  pregunta_actual integer NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  UNIQUE (id_student, id_evaluation),
  FOREIGN KEY (id_student, id_evaluation)
    REFERENCES public.grades(id_student, id_exam)
);

-- Agregar pregunta_actual a tablas existentes (idempotente)
ALTER TABLE public.rta_examen ADD COLUMN IF NOT EXISTS pregunta_actual integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_rta_examen_student
  ON public.rta_examen (id_student, id_evaluation);


-- ------------------------------------------------------------
-- TAREA 5: Seed tipo 'Examen' en evaluation_type
-- ------------------------------------------------------------
INSERT INTO public.evaluation_type (type)
VALUES ('Examen')
ON CONFLICT (type) DO NOTHING;


-- ------------------------------------------------------------
-- RLS: examen_programacion
-- ------------------------------------------------------------
ALTER TABLE public.examen_programacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "examen_prog_select_auth" ON public.examen_programacion
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "examen_prog_admin_all" ON public.examen_programacion
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_type ut JOIN public.type t ON t.id = ut.id_type WHERE ut.id_user = auth.uid() AND t.code = 'A')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_type ut JOIN public.type t ON t.id = ut.id_type WHERE ut.id_user = auth.uid() AND t.code = 'A')
  );


-- ------------------------------------------------------------
-- RLS: examen_detalle
-- Admin escribe; estudiante/profesor leen (sin respuestas correctas
-- — el backend filtra el campo respuesta_correcta para estudiantes)
-- ------------------------------------------------------------
ALTER TABLE public.examen_detalle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "examen_detalle_select_auth" ON public.examen_detalle
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "examen_detalle_admin_all" ON public.examen_detalle
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_type ut JOIN public.type t ON t.id = ut.id_type WHERE ut.id_user = auth.uid() AND t.code = 'A')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_type ut JOIN public.type t ON t.id = ut.id_type WHERE ut.id_user = auth.uid() AND t.code = 'A')
  );


-- ------------------------------------------------------------
-- RLS: rta_examen
-- Estudiante ve/escribe solo sus propios registros; admin ve todo
-- ------------------------------------------------------------
ALTER TABLE public.rta_examen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rta_examen_select_self" ON public.rta_examen
  FOR SELECT USING (
    id_student = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_type ut JOIN public.type t ON t.id = ut.id_type WHERE ut.id_user = auth.uid() AND t.code = 'A')
  );

CREATE POLICY "rta_examen_insert_self" ON public.rta_examen
  FOR INSERT WITH CHECK (id_student = auth.uid());

CREATE POLICY "rta_examen_update_self" ON public.rta_examen
  FOR UPDATE USING (id_student = auth.uid())
  WITH CHECK (id_student = auth.uid());

CREATE POLICY "rta_examen_admin_all" ON public.rta_examen
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_type ut JOIN public.type t ON t.id = ut.id_type WHERE ut.id_user = auth.uid() AND t.code = 'A')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_type ut JOIN public.type t ON t.id = ut.id_type WHERE ut.id_user = auth.uid() AND t.code = 'A')
  );
