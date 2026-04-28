
-- ============================================================
-- WebNotas JILIU | La Promesa — DDL Completo (Supabase / PostgreSQL)
-- Incluye: esquema base + módulo exámenes online + año lectivo por entidad
-- ============================================================
-- ADVERTENCIA: Este script elimina y recrea toda la estructura.
--              Ejecutar solo en una base vacía o en un entorno de desarrollo.
--              Para actualizar producción usar los scripts de migración.
-- ============================================================


-- ====== DROP (orden inverso de dependencias) ======

drop table if exists public.rta_examen         cascade;
drop table if exists public.examen_detalle      cascade;
drop table if exists public.examen_programacion cascade;
drop table if exists public.grades              cascade;
drop table if exists public.attendance          cascade;
drop table if exists public.evaluation          cascade;
drop table if exists public.class_teacher       cascade;
drop table if exists public.user_history        cascade;
drop table if exists public.user_type           cascade;
drop table if exists public.evaluation_type     cascade;
drop table if exists public.class               cascade;
drop table if exists public.group               cascade;
drop table if exists public.module              cascade;
drop table if exists public.course              cascade;
drop table if exists public.users               cascade;
drop table if exists public.level               cascade;
drop table if exists public.type                cascade;
drop table if exists public.materias            cascade;
drop table if exists public.parametro           cascade;
drop table if exists public.anio_lectivo        cascade;

drop function if exists public.set_updated_at()           cascade;
drop function if exists public.fn_check_examen_prog_year() cascade;
drop function if exists public.is_admin()                  cascade;
drop function if exists public.is_teacher()                cascade;
drop function if exists public.is_student()                cascade;


-- ====== TABLAS ======

-- ------------------------------------------------------------
-- anio_lectivo: catálogo maestro de años lectivos
-- Exactamente un registro con activo = true en cada momento.
-- ------------------------------------------------------------
create table public.anio_lectivo (
  year       smallint primary key,
  nombre     text not null,
  activo     boolean not null default false,
  created_at timestamptz default now()
);

-- Restricción: un solo año activo a la vez
create unique index idx_anio_lectivo_activo_uq
  on public.anio_lectivo (activo)
  where activo = true;


-- ------------------------------------------------------------
-- level: niveles académicos, uno por año lectivo
-- ------------------------------------------------------------
create table public.level (
  id   bigserial primary key,
  name text not null,
  year smallint not null references public.anio_lectivo(year) on delete restrict,
  constraint level_name_year_uq unique (name, year)
);


-- ------------------------------------------------------------
-- module: módulos curriculares, uno por año lectivo
-- ------------------------------------------------------------
create table public.module (
  id   bigserial primary key,
  name text not null,
  year smallint not null references public.anio_lectivo(year) on delete restrict,
  constraint module_name_year_uq unique (name, year)
);


-- ------------------------------------------------------------
-- group: grupos dentro de un módulo, por año lectivo
-- "group" es palabra reservada en SQL; usar siempre public.group o entre comillas
-- ------------------------------------------------------------
create table public.group (
  id        bigserial primary key,
  name      text not null,
  id_module smallint not null references public.module(id),
  year      smallint not null references public.anio_lectivo(year) on delete restrict
);


-- ------------------------------------------------------------
-- course: curso = nivel + número + año lectivo
-- Ej.: Primer Año, Curso 101, Año 2026
-- ------------------------------------------------------------
create table public.course (
  id    bigserial primary key,
  name  smallint not null,   -- número de curso (ej. 1, 2, 3…)
  year  smallint not null references public.anio_lectivo(year) on delete restrict,
  level int not null references public.level(id)
);


-- ------------------------------------------------------------
-- class: materias, por año lectivo
-- ------------------------------------------------------------
create table public.class (
  id         bigserial primary key,
  name       text not null,
  level      int not null references public.level(id),
  created_at timestamptz default now(),
  id_module  bigint not null references public.module(id) on update cascade on delete cascade,
  id_group   bigint references public.group(id) on update cascade on delete restrict,
  year       smallint not null references public.anio_lectivo(year) on delete restrict,
  constraint class_name_level_module_year_uq unique (name, level, id_module, year)
);


-- ------------------------------------------------------------
-- evaluation_type: tipos de evaluación, por año lectivo
-- ------------------------------------------------------------
create table public.evaluation_type (
  id         bigserial primary key,
  type       text not null,
  year       smallint not null references public.anio_lectivo(year) on delete restrict,
  created_at timestamptz default now(),
  constraint eval_type_name_year_uq unique (type, year)
);


-- ------------------------------------------------------------
-- type: roles de usuario (global, no varía por año)
-- ------------------------------------------------------------
create table public.type (
  id   smallint generated by default as identity primary key,
  code bpchar(1) not null unique check (code in ('S','T','A')),
  name text not null
);

insert into public.type (code, name) values
  ('S', 'Student'),
  ('T', 'Teacher'),
  ('A', 'Admin')
on conflict (code) do nothing;


-- ------------------------------------------------------------
-- users: espejo mínimo de auth.users + campos de negocio
-- id_course apunta al curso vigente del usuario
-- ------------------------------------------------------------
create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  email      text not null unique,
  code_jiliu text unique,
  id_course  bigint references public.course(id),
  cedula     text unique,
  created_at timestamptz default now()
);


-- ------------------------------------------------------------
-- user_history: historial de cursos por estudiante
-- Conserva todos los cursos por los que pasó el estudiante.
-- year accesible via id_course → course.year
-- ------------------------------------------------------------
create table public.user_history (
  id_student uuid   not null references public.users(id) on delete cascade,
  id_course  bigint not null references public.course(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (id_student, id_course)
);


-- ------------------------------------------------------------
-- user_type: roles asignados a cada usuario
-- ------------------------------------------------------------
create table public.user_type (
  id_user    uuid     not null references public.users(id) on delete cascade,
  id_type    smallint not null references public.type(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (id_user, id_type)
);


-- ------------------------------------------------------------
-- class_teacher: asignación profesor ↔ materia ↔ curso
-- PK incluye id_course para permitir la misma asignación en distintos años.
-- ------------------------------------------------------------
create table public.class_teacher (
  id_teacher uuid   not null references public.users(id) on delete cascade,
  id_class   bigint not null references public.class(id) on delete cascade,
  id_course  bigint not null references public.course(id) on update cascade on delete cascade,
  created_at timestamptz default now(),
  primary key (id_teacher, id_class, id_course)
);


-- ------------------------------------------------------------
-- evaluation: evaluación creada por un profesor
-- year accesible via id_course → course.year
-- ------------------------------------------------------------
create table public.evaluation (
  id             bigserial primary key,
  id_course      bigint references public.course(id) on delete cascade,
  id_class       bigint references public.class(id) on delete cascade,
  id_teacher     uuid   not null references public.users(id) on delete cascade,
  id_type        bigint not null references public.evaluation_type(id) on delete restrict,
  percent        numeric(5,2) not null check (percent >= 0 and percent <= 100),
  title          text not null default 'Evaluación',
  created_at     timestamptz default now(),
  id_group       bigint references public.group(id) on update cascade on delete cascade,
  id_module      bigint not null references public.module(id) on update cascade on delete cascade,
  tiempo_minutos smallint,
  constraint eval_group_or_class_chk check ((id_group is null) <> (id_class is null))
);


-- ------------------------------------------------------------
-- grades: nota por estudiante por evaluación
-- year accesible via id_exam → evaluation → id_course → course.year
-- ------------------------------------------------------------
create table public.grades (
  id_student  uuid   not null references public.users(id) on delete cascade,
  id_exam     bigint not null references public.evaluation(id) on delete cascade,
  grade       numeric(10,2) not null,
  finished_at timestamptz,
  attempts    int not null default 1,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  primary key (id_student, id_exam)
);


-- ------------------------------------------------------------
-- attendance: asistencia por estudiante
-- id_course permite filtrar por año lectivo directamente.
-- ------------------------------------------------------------
create table public.attendance (
  id         bigserial primary key,
  id_student uuid   not null references public.users(id) on delete cascade,
  id_class   bigint not null references public.class(id) on delete cascade,
  id_course  bigint references public.course(id) on delete set null,
  date       timestamptz default now(),
  observation text
);


-- ------------------------------------------------------------
-- materias: referencia normalizada nivel → módulo → grupo → materia
-- PK incluye year para tener un set por año lectivo.
-- ------------------------------------------------------------
create table if not exists public.materias (
  id_module integer      not null,
  module    varchar(300) not null,
  id_group  integer      not null,
  grupo     varchar(300) not null,
  id_class  integer      not null,
  class     varchar(300) not null,
  level     integer      not null,
  year      smallint     not null references public.anio_lectivo(year) on delete restrict,
  constraint pk_materias primary key (id_class, year)
);


-- ------------------------------------------------------------
-- parametro: configuración general del sistema
-- (usado por módulo de exámenes; no usar para anio_lectivo_vigente)
-- ------------------------------------------------------------
create table if not exists public.parametro (
  nombre text not null,
  valor  text not null,
  constraint parametro_nombre_key unique (nombre)
);


-- ------------------------------------------------------------
-- examen_programacion: habilita un examen para un curso+año
-- year debe coincidir con id_course → course.year (enforced por trigger)
-- ------------------------------------------------------------
create table if not exists public.examen_programacion (
  id               bigserial primary key,
  id_evaluation    bigint not null references public.evaluation(id) on delete cascade,
  id_course        bigint not null references public.course(id) on delete cascade,
  year             smallint not null,
  fecha_ini        timestamptz,
  fecha_fin        timestamptz,
  fecha_limite_ver timestamptz,
  habilitado       boolean not null default false,
  created_at       timestamptz default now()
);


-- ------------------------------------------------------------
-- examen_detalle: preguntas y respuestas correctas de un examen
-- year accesible via id_evaluation → evaluation → id_course → course.year
--
-- Estructura opciones (jsonb):
--   multiple_multi / multiple_single:
--     [{"id":"a","texto":"..."},...]
--   falso_verdadero:
--     [{"id":"V","texto":"Verdadero"},{"id":"F","texto":"Falso"}]
--   emparejamiento:
--     {"izquierda":[{"id":"1","texto":"..."},...],
--      "derecha":[{"id":"a","texto":"..."},...]}
--
-- Estructura respuesta_correcta (jsonb):
--   multiple_multi:  ["a","c"]
--   multiple_single: ["b"]
--   falso_verdadero: ["V"]
--   emparejamiento:  {"1":"a","2":"b"}
-- ------------------------------------------------------------
create table if not exists public.examen_detalle (
  id                 bigserial primary key,
  id_evaluation      bigint not null references public.evaluation(id) on delete cascade,
  orden              smallint not null check (orden between 1 and 20),
  tipo               text not null check (tipo in (
                       'multiple_multi','multiple_single','falso_verdadero','emparejamiento'
                     )),
  enunciado          text not null,
  puntos             numeric(5,2) not null check (puntos > 0),
  opciones           jsonb not null,
  respuesta_correcta jsonb not null,
  created_at         timestamptz default now(),
  unique (id_evaluation, orden)
);


-- ------------------------------------------------------------
-- rta_examen: respuestas del estudiante + calificación
-- year accesible via id_evaluation → evaluation → id_course → course.year
--
-- Estructura respuestas (jsonb):
--   [{"id_detalle":1,"respuesta":["b"]},
--    {"id_detalle":2,"respuesta":{"1":"a","2":"b"}}]
-- ------------------------------------------------------------
create table if not exists public.rta_examen (
  id              bigserial primary key,
  id_student      uuid   not null references public.users(id) on delete cascade,
  id_evaluation   bigint not null references public.evaluation(id) on delete cascade,
  id_programacion bigint references public.examen_programacion(id) on delete set null,
  respuestas      jsonb not null default '[]',
  calificacion    numeric(5,2),
  iniciado_at     timestamptz,
  finalizado_at   timestamptz,
  pregunta_actual integer not null default 0,
  created_at      timestamptz default now(),
  unique (id_student, id_evaluation),
  foreign key (id_student, id_evaluation)
    references public.grades(id_student, id_exam)
);


-- ====== TRIGGERS ======

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_grades_updated_at on public.grades;
create trigger trg_grades_updated_at
  before update on public.grades
  for each row execute function public.set_updated_at();


-- Trigger: garantiza que examen_programacion.year == course.year del id_course
create or replace function public.fn_check_examen_prog_year()
returns trigger language plpgsql as $$
declare
  v_course_year smallint;
begin
  select year into v_course_year
  from public.course
  where id = new.id_course;

  if v_course_year is null then
    raise exception 'examen_programacion: id_course % no existe en course', new.id_course;
  end if;

  if v_course_year <> new.year then
    raise exception
      'examen_programacion: year (%) debe coincidir con course.year (%) para id_course=%',
      new.year, v_course_year, new.id_course;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_examen_prog_year on public.examen_programacion;
create trigger trg_examen_prog_year
  before insert or update on public.examen_programacion
  for each row execute function public.fn_check_examen_prog_year();


-- ====== ÍNDICES ======

-- anio_lectivo
create index concurrently if not exists idx_course_year
  on public.course (year);

-- level / module / group / class / evaluation_type
create index concurrently if not exists idx_level_year
  on public.level (year);

create index concurrently if not exists idx_module_year
  on public.module (year);

create index concurrently if not exists idx_group_year
  on public.group (year);

create index concurrently if not exists idx_class_year
  on public.class (year);

create index concurrently if not exists idx_eval_type_year
  on public.evaluation_type (year);

create index concurrently if not exists idx_materias_year
  on public.materias (year);

-- class
create index concurrently if not exists idx_class_id_module
  on public.class (id_module);

create index concurrently if not exists idx_class_level_name
  on public.class (level, name);

create extension if not exists pg_trgm;

create index concurrently if not exists idx_class_name_trgm
  on public.class using gin (name gin_trgm_ops);

-- users
create index concurrently if not exists idx_users_id_course_name
  on public.users (id_course, name);

-- class_teacher
create index concurrently if not exists idx_class_teacher_id_class
  on public.class_teacher (id_class);

create index concurrently if not exists idx_class_teacher_course
  on public.class_teacher (id_course);

-- user_history
create index concurrently if not exists idx_user_history_id_course
  on public.user_history (id_course);

-- evaluation
create index concurrently if not exists idx_evaluation_teacher_created_desc
  on public.evaluation (id_teacher, created_at desc);

create index concurrently if not exists idx_evaluation_course_class_created_id
  on public.evaluation (id_course, id_class, created_at asc, id asc);

create index concurrently if not exists idx_evaluation_class_created_id
  on public.evaluation (id_class, created_at asc, id asc);

-- user_type
create index if not exists user_type_user_idx on public.user_type (id_user);
create index if not exists user_type_type_idx on public.user_type (id_type);

-- attendance
create index concurrently if not exists idx_attendance_course
  on public.attendance (id_course);

-- examen_programacion
create index if not exists idx_examen_prog_evaluation
  on public.examen_programacion (id_evaluation);

create index if not exists idx_examen_prog_course_habilitado
  on public.examen_programacion (id_course, habilitado);

-- examen_detalle
create index if not exists idx_examen_detalle_evaluation
  on public.examen_detalle (id_evaluation, orden);

-- rta_examen
create index if not exists idx_rta_examen_student
  on public.rta_examen (id_student, id_evaluation);


-- ====== FUNCIONES HELPER / RLS ======

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_type ut
    join public.type t on t.id = ut.id_type
    where ut.id_user = auth.uid() and t.code = 'A'
  );
$$;

create or replace function public.is_teacher()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_type ut
    join public.type t on t.id = ut.id_type
    where ut.id_user = auth.uid() and t.code = 'T'
  );
$$;

create or replace function public.is_student()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_type ut
    join public.type t on t.id = ut.id_type
    where ut.id_user = auth.uid() and t.code = 'S'
  );
$$;


-- ====== RLS ======

alter table public.anio_lectivo    enable row level security;
alter table public.course          enable row level security;
alter table public.class           enable row level security;
alter table public.evaluation_type enable row level security;
alter table public.users           enable row level security;
alter table public.user_history    enable row level security;
alter table public.class_teacher   enable row level security;
alter table public.evaluation      enable row level security;
alter table public.grades          enable row level security;
alter table public.attendance      enable row level security;
alter table public.examen_programacion enable row level security;
alter table public.examen_detalle  enable row level security;
alter table public.rta_examen      enable row level security;
alter table public.parametro       enable row level security;

-- anio_lectivo: todos leen, solo admin escribe
create policy "anio_select_auth" on public.anio_lectivo
  for select using (auth.uid() is not null);
create policy "anio_admin_all"   on public.anio_lectivo
  for all using (public.is_admin()) with check (public.is_admin());

-- course / class / evaluation_type: lectura para todos autenticados; escritura solo admin
create policy "course_select_auth"   on public.course for select using (auth.uid() is not null);
create policy "course_admin_write"   on public.course for all    using (public.is_admin()) with check (public.is_admin());

create policy "class_select_auth"    on public.class  for select using (auth.uid() is not null);
create policy "class_admin_write"    on public.class  for all    using (public.is_admin()) with check (public.is_admin());

create policy "etype_select_auth"    on public.evaluation_type for select using (auth.uid() is not null);
create policy "etype_admin_write"    on public.evaluation_type for all    using (public.is_admin()) with check (public.is_admin());

-- users
create policy "users_select_self_or_admin" on public.users
  for select using (auth.uid() = id or public.is_admin());

create policy "users_update_self" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "users_admin_all" on public.users
  for all using (public.is_admin()) with check (public.is_admin());

-- class_teacher
create policy "class_teacher_select_auth"  on public.class_teacher for select using (auth.uid() is not null);
create policy "class_teacher_admin_write"  on public.class_teacher for all    using (public.is_admin()) with check (public.is_admin());

-- user_history
create policy "history_select_self_or_admin" on public.user_history
  for select using (id_student = auth.uid() or public.is_admin());

create policy "history_admin_write" on public.user_history
  for all using (public.is_admin()) with check (public.is_admin());

-- evaluation
create policy "evaluation_select_student_course" on public.evaluation
  for select using (
    public.is_admin()
    or (public.is_teacher() and id_teacher = auth.uid())
    or (public.is_student() and exists (
      select 1 from public.users u where u.id = auth.uid() and u.id_course = evaluation.id_course
    ))
  );

create policy "evaluation_teacher_insert" on public.evaluation
  for insert with check (
    public.is_teacher()
    and id_teacher = auth.uid()
    and exists (
      select 1 from public.class_teacher ct
      where ct.id_teacher = auth.uid() and ct.id_class = evaluation.id_class
    )
  );

create policy "evaluation_teacher_update_own" on public.evaluation
  for update using (public.is_teacher() and id_teacher = auth.uid())
  with check  (public.is_teacher() and id_teacher = auth.uid());

create policy "evaluation_admin_all" on public.evaluation
  for all using (public.is_admin()) with check (public.is_admin());

-- grades
create policy "grades_select_self" on public.grades
  for select using (id_student = auth.uid() or public.is_admin());

create policy "grades_teacher_write_own_eval" on public.grades
  for insert with check (
    public.is_teacher()
    and exists (select 1 from public.evaluation e where e.id = grades.id_exam and e.id_teacher = auth.uid())
  );

create policy "grades_teacher_update_own_eval" on public.grades
  for update
  using     (public.is_teacher() and exists (select 1 from public.evaluation e where e.id = grades.id_exam and e.id_teacher = auth.uid()))
  with check(public.is_teacher() and exists (select 1 from public.evaluation e where e.id = grades.id_exam and e.id_teacher = auth.uid()));

create policy "grades_admin_all" on public.grades
  for all using (public.is_admin()) with check (public.is_admin());

-- attendance
create policy "attendance_select_self_or_admin" on public.attendance
  for select using (id_student = auth.uid() or public.is_admin());

create policy "attendance_teacher_write" on public.attendance
  for insert with check (
    public.is_teacher()
    and exists (
      select 1 from public.class_teacher ct
      where ct.id_teacher = auth.uid() and ct.id_class = attendance.id_class
    )
  );

create policy "attendance_admin_all" on public.attendance
  for all using (public.is_admin()) with check (public.is_admin());

-- examen_programacion
create policy "examen_prog_select_auth" on public.examen_programacion
  for select using (auth.uid() is not null);

create policy "examen_prog_admin_all" on public.examen_programacion
  for all using (public.is_admin()) with check (public.is_admin());

-- examen_detalle
create policy "examen_detalle_select_auth" on public.examen_detalle
  for select using (auth.uid() is not null);

create policy "examen_detalle_admin_all" on public.examen_detalle
  for all using (public.is_admin()) with check (public.is_admin());

-- rta_examen
create policy "rta_examen_select_self" on public.rta_examen
  for select using (
    id_student = auth.uid() or public.is_admin()
  );

create policy "rta_examen_insert_self" on public.rta_examen
  for insert with check (id_student = auth.uid());

create policy "rta_examen_update_self" on public.rta_examen
  for update using (id_student = auth.uid())
  with check (id_student = auth.uid());

create policy "rta_examen_admin_all" on public.rta_examen
  for all using (public.is_admin()) with check (public.is_admin());

-- parametro
create policy "parametro_select_authenticated" on public.parametro
  for select to authenticated using (true);


-- ====== SEED INICIAL ======

insert into public.anio_lectivo (year, nombre, activo)
values (2026, 'Año Lectivo 2026', true)
on conflict (year) do nothing;

insert into public.evaluation_type (type, year) values
  ('Examen', 2026)
on conflict (type, year) do nothing;
