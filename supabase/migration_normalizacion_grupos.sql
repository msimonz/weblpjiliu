-- ============================================================
-- Migración: Normalización de grupos de evaluación
-- Aplicar en PROD después de desplegar el backend actualizado.
--
-- Cambios:
--   - Elimina class_group (tabla puente redundante)
--   - class.id_group: smallint NOT NULL → bigint nullable con FK
--   - Limpia 91 clases con grupos falsos (id_group = NULL)
--   - Limpia 28 evaluaciones con grupos falsos (id_group = NULL)
--   - Elimina 55 grupos falsos (módulos distintos de 8 y 48)
--   - evaluation.id_group: NOT NULL → nullable
--   - Agrega CHECK: exactamente uno de id_group o id_class debe estar seteado
-- ============================================================


-- ------------------------------------------------------------
-- VERIFICACIONES PREVIAS
-- Ejecutar y revisar antes de continuar.
-- ------------------------------------------------------------

-- 1. Consistencia class vs class_group (debe devolver 0 filas)
SELECT c.id, c.id_group AS group_en_class, cg.id_group AS group_en_bridge
FROM public.class c
LEFT JOIN public.class_group cg ON cg.id_class = c.id
WHERE c.id_group IS DISTINCT FROM cg.id_group;

-- 2. Evaluaciones con grupos falsos sin id_class (debe devolver 0 en sin_id_class)
SELECT
  COUNT(*)                                  AS total,
  COUNT(id_class)                           AS con_id_class,
  COUNT(*) FILTER (WHERE id_class IS NULL)  AS sin_id_class
FROM public.evaluation e
JOIN public.group g ON g.id = e.id_group
WHERE g.id_module NOT IN (8, 48);


-- ------------------------------------------------------------
-- FASE 1: Eliminar class_group y normalizar class.id_group
-- ------------------------------------------------------------

DROP TABLE public.class_group;

ALTER TABLE public.class
  ALTER COLUMN id_group TYPE bigint,
  ADD CONSTRAINT class_id_group_fk
    FOREIGN KEY (id_group) REFERENCES public.group(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  ALTER COLUMN id_group DROP NOT NULL;


-- ------------------------------------------------------------
-- FASE 2: Hacer evaluation.id_group nullable
-- ------------------------------------------------------------

ALTER TABLE public.evaluation
  ALTER COLUMN id_group DROP NOT NULL;


-- ------------------------------------------------------------
-- FASE 3: Limpieza de datos
-- ------------------------------------------------------------

-- 3a. Evaluaciones de grupo real que también tienen id_class → limpiar id_class
UPDATE public.evaluation e
SET id_class = NULL
FROM public.group g
WHERE g.id = e.id_group
  AND g.id_module IN (8, 48)
  AND e.id_class IS NOT NULL;

-- 3b. Evaluaciones con grupos falsos → limpiar id_group
UPDATE public.evaluation e
SET id_group = NULL
FROM public.group g
WHERE g.id = e.id_group
  AND g.id_module NOT IN (8, 48);

-- 3c. Clases con grupos falsos → limpiar id_group
UPDATE public.class
SET id_group = NULL
WHERE id_group IS NOT NULL
  AND id_module NOT IN (8, 48);

-- 3d. Eliminar grupos falsos
DELETE FROM public.group
WHERE id_module NOT IN (8, 48);


-- ------------------------------------------------------------
-- FASE 4: CHECK constraint en evaluation
-- ------------------------------------------------------------

ALTER TABLE public.evaluation
  ADD CONSTRAINT eval_group_or_class_chk
    CHECK ((id_group IS NULL) <> (id_class IS NULL));


-- ------------------------------------------------------------
-- VALIDACIONES POST-MIGRACIÓN
-- Todos deben devolver 0 o resultados limpios.
-- ------------------------------------------------------------

-- 1. Violaciones del CHECK (debe ser 0)
SELECT COUNT(*) AS violaciones
FROM public.evaluation
WHERE NOT ((id_group IS NULL) <> (id_class IS NULL));

-- 2. Clases con grupos falsos restantes (debe ser 0)
SELECT COUNT(*) AS grupos_falsos_en_class
FROM public.class
WHERE id_group IS NOT NULL
  AND id_module NOT IN (8, 48);

-- 3. Grupos falsos restantes (debe ser 0)
SELECT COUNT(*) AS grupos_falsos_restantes
FROM public.group
WHERE id_module NOT IN (8, 48);

-- 4. Resumen final de evaluaciones
SELECT
  COUNT(*)                                    AS total_evaluaciones,
  COUNT(id_group)                             AS evaluaciones_de_grupo,
  COUNT(*) FILTER (WHERE id_group IS NULL)    AS evaluaciones_individuales
FROM public.evaluation;
