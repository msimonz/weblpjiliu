-- notas de un alumno
SELECT
    u.name                          AS estudiante,
    u.cedula,
    co.year                         AS año_lectivo,                                                                                                                 
    co.name                         AS curso,
    lv.name                         AS nivel,                                                                                                                       
    cl.name                         AS materia,
    et.type                         AS tipo_evaluacion,
    ev.title                        AS titulo,
    ev.percent                      AS peso_pct,
    g.grade                         AS nota,
    ROUND(g.grade * ev.percent / 100, 2) AS nota_ponderada,
    g.attempts,
    g.updated_at
  FROM grades g
  JOIN users      u   ON u.id        = g.id_student
  JOIN evaluation ev  ON ev.id       = g.id_exam
  JOIN course     co  ON co.id       = ev.id_course
  JOIN level      lv  ON lv.id       = co.level
  JOIN class      cl  ON cl.id       = ev.id_class
  JOIN evaluation_type et ON et.id   = ev.id_type
  WHERE u.name like '%Yury%'
    -- AND co.year = 2026            


-- modulos por nivel
 SELECT distinct 
      m.name   AS modulo
    --  ,c.name   AS materia
    --  ,c.id     AS id_materia
  FROM public.class c
  JOIN public.module m        ON m.id = c.id_module
  JOIN public.anio_lectivo al ON al.year = c.year AND al.activo = true
  WHERE c.level = 3
  ORDER BY m.name, c.name;


  SELECT DISTINCT
      m.id    AS id_modulo
      --,m.name  AS modulo
      --,c.year  AS año_clase
  FROM public.class c
  JOIN public.module m ON m.id = c.id_module
  JOIN public.anio_lectivo al ON al.year = c.year AND al.activo = true
  WHERE c.level = 3   -- ajusta al id real del nivel
  ORDER BY m.name;

--materias de un profesor 
  SELECT DISTINCT
      m.id         AS id_modulo
      ,m.name       AS modulo
      ,c. name      as materia
      ,co.name  as curso 
      ,co.year      AS año_curso
      ,c.year       AS año_clase
  FROM public.class_teacher ct
  JOIN public.class  c  ON c.id  = ct.id_class
  JOIN public.module m  ON m.id  = c.id_module
  JOIN public.course co ON co.id = ct.id_course
  JOIN public.anio_lectivo al ON al.year = co.year AND al.activo = true
  WHERE c.level < 6
  AND ct.id_teacher in ( select id from users where name like '%Liliana%')
  ORDER BY m.name;

-- evaluaciones, filtro por profesor 

SELECT
      e.id            AS id_evaluacion,
      e.title         AS titulo,                                                                                                                                      
	  et.type         AS tipo,
      e.percent       AS porcentaje,                                                                                                                                  
	  m.name          AS modulo,
      c.name          AS materia,
      co.name         AS curso,
      co.year         AS año,
      e.created_at
  FROM public.evaluation e
  JOIN public.class             c  ON c.id  = e.id_class
  JOIN public.module            m  ON m.id  = c.id_module
  JOIN public.course            co ON co.id = e.id_course
  JOIN public.evaluation_type   et ON et.id = e.id_type
  JOIN public.class_teacher     ct ON ct.id_class = e.id_class
  JOIN public.anio_lectivo      al ON al.year = co.year 
  where c.level = 1
  AND al.activo = true  
  AND ct.id_course = e.id_course
  --AND ct.id_teacher in ( select id from users where name like '%Liliana%')
  ORDER BY co.year DESC, m.name, c.name, e.created_at;






