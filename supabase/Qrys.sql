-- notas de un alumno

  select
    g.id_student,
    u.name as estudiante,
    u.cedula,
    g.id_exam as id_evaluation,
    e.title as evaluacion,
    et.type as tipo_evaluacion,
    c.name as curso,
    c.year,
    cl.name as materia,
    g.grade,
    g.attempts,
    g.finished_at,
    g.created_at,
    g.updated_at,
    case
      when g.finished_at is null then 'Pendiente'
      when lower(coalesce(et.type, '')) = 'examen'
           and g.grade = 0
           and coalesce(g.attempts, 0) = 0
        then 'No presentó'
      when lower(coalesce(et.type, '')) = 'examen' then 'Examen cerrado'
      else 'Nota manual'
    end as estado
  from grades g
  join users u on u.id = g.id_student
  join evaluation e on e.id = g.id_exam
  left join evaluation_type et on et.id = e.id_type
  left join course c on c.id = e.id_course
  left join class cl on cl.id = e.id_class
  where u.cedula in ('31446121','12201962')
  and  id_exam=118
  order by c.year desc, c.name, cl.name, e.created_at, e.id;     


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
      ,m.name  AS modulo
      ,c.year  AS año_clase
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
  where c.level <  8
  AND al.activo = true  
  AND ct.id_course = e.id_course
  AND ct.id_teacher in ( select id from users where name like '%ancel%')
  ORDER BY co.year DESC, m.name, c.name, e.created_at;


select * from grades where  id_student in ( select id from users where name like '%Alexander%')

  
select id from users where name like '%ancel%'





