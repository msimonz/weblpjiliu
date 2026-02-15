
-- ====== TABLES ======
drop table if exists public.grades cascade;
drop table if exists public.evaluation cascade;
drop table if exists public.class_teacher cascade;
drop table if exists public.user_history cascade;
drop table if exists public.evaluation_type cascade;
drop table if exists public.class cascade;
drop table if exists public.course cascade;
drop table if exists public.users cascade;

create table public.course (
  id bigserial primary key,
  name text not null,
  year date,
  level int not null, -- 1..4
  created_at timestamptz default now()
);

create table public.class (
  id bigserial primary key,
  name text not null,
  level int not null, -- 1..4 (materia pertenece a un nivel)
  created_at timestamptz default now()
);

create table public.evaluation_type (
  id bigserial primary key,
  type text not null unique,
  created_at timestamptz default now()
);

-- users: espejo mínimo de auth.users + campos de negocio
-- type: 'S' student, 'T' teacher, 'A' admin
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  type char(1) not null check (type in ('S','T','A')),
  code_jiliu text unique, -- para mapear ETM studentDescription -> code
  id_course bigint references public.course(id),
  cedula text unique,
  created_at timestamptz default now()
);

create table public.user_history (
  id_student uuid not null references public.users(id) on delete cascade,
  id_course bigint not null references public.course(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (id_student, id_course)
);

-- relación profesor-materia
create table public.class_teacher (
  id_teacher uuid not null references public.users(id) on delete cascade,
  id_class bigint not null references public.class(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (id_teacher, id_class)
);

-- evaluation = “asignación / evaluación” creada por un profe, para un course + class
create table public.evaluation (
  id bigserial primary key,
  id_course bigint not null references public.course(id) on delete cascade,
  id_class bigint not null references public.class(id) on delete cascade,
  id_teacher uuid not null references public.users(id) on delete cascade,
  id_type bigint not null references public.evaluation_type(id) on delete restrict,
  percent numeric(5,2) not null check (percent >= 0 and percent <= 100),
  title text not null default 'Evaluación',
  created_at timestamptz default now()
);

-- grades = nota por estudiante por evaluación (PK compuesta)
create table public.grades (
  id_student uuid not null references public.users(id) on delete cascade,
  id_exam bigint not null references public.evaluation(id) on delete cascade,
  grade numeric(10,2) not null,
  finished_at timestamptz not null,
  attempts int not null default 1,
  source text not null default 'manual', -- 'manual' | 'etm'
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (id_student, id_exam)
);

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

-- ====== ENUMS / HELPERS ======
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.type = 'A'
  );
$$;

create or replace function public.is_teacher()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.type = 'T'
  );
$$;

create or replace function public.is_student()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.type = 'S'
  );
$$;


-- ====== RLS ======
alter table public.course enable row level security;
alter table public.class enable row level security;
alter table public.evaluation_type enable row level security;
alter table public.users enable row level security;
alter table public.user_history enable row level security;
alter table public.class_teacher enable row level security;
alter table public.evaluation enable row level security;
alter table public.grades enable row level security;

-- course/class/evaluation_type: lectura para todos autenticados; escritura solo admin
create policy "course_select_auth" on public.course for select using (auth.uid() is not null);
create policy "course_admin_write" on public.course for all using (public.is_admin()) with check (public.is_admin());

create policy "class_select_auth" on public.class for select using (auth.uid() is not null);
create policy "class_admin_write" on public.class for all using (public.is_admin()) with check (public.is_admin());

create policy "etype_select_auth" on public.evaluation_type for select using (auth.uid() is not null);
create policy "etype_admin_write" on public.evaluation_type for all using (public.is_admin()) with check (public.is_admin());

-- users: cada quien ve su perfil; admin ve todo
create policy "users_select_self_or_admin" on public.users
for select using (auth.uid() = id or public.is_admin());

-- updates: cada quien actualiza su nombre; admin puede todo
create policy "users_update_self" on public.users
for update using (auth.uid() = id)
with check (auth.uid() = id);

create policy "users_admin_all" on public.users
for all using (public.is_admin()) with check (public.is_admin());

-- class_teacher: lectura para auth; escritura admin (o puedes permitir teacher si quieres)
create policy "class_teacher_select_auth" on public.class_teacher
for select using (auth.uid() is not null);

create policy "class_teacher_admin_write" on public.class_teacher
for all using (public.is_admin()) with check (public.is_admin());

-- user_history: estudiante ve su historial; admin ve todo; teacher no necesita ver todo
create policy "history_select_self_or_admin" on public.user_history
for select using (id_student = auth.uid() or public.is_admin());

create policy "history_admin_write" on public.user_history
for all using (public.is_admin()) with check (public.is_admin());

-- evaluation: estudiantes leen evaluaciones de su curso; teachers leen las suyas; admin todo.
create policy "evaluation_select_student_course" on public.evaluation
for select using (
  public.is_admin()
  or (public.is_teacher() and id_teacher = auth.uid())
  or (public.is_student() and exists (
    select 1 from public.users u where u.id = auth.uid() and u.id_course = evaluation.id_course
  ))
);

-- teacher crea evaluaciones solo para materias que dicta
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
with check (public.is_teacher() and id_teacher = auth.uid());

create policy "evaluation_admin_all" on public.evaluation
for all using (public.is_admin()) with check (public.is_admin());

-- grades: estudiante ve solo las suyas
create policy "grades_select_self" on public.grades
for select using (id_student = auth.uid() or public.is_admin());

-- teacher puede insertar/actualizar notas SOLO de sus evaluaciones
create policy "grades_teacher_write_own_eval" on public.grades
for insert with check (
  public.is_teacher()
  and exists (select 1 from public.evaluation e where e.id = grades.id_exam and e.id_teacher = auth.uid())
);

create policy "grades_teacher_update_own_eval" on public.grades
for update using (
  public.is_teacher()
  and exists (select 1 from public.evaluation e where e.id = grades.id_exam and e.id_teacher = auth.uid())
)
with check (
  public.is_teacher()
  and exists (select 1 from public.evaluation e where e.id = grades.id_exam and e.id_teacher = auth.uid())
);

create policy "grades_admin_all" on public.grades
for all using (public.is_admin()) with check (public.is_admin());
