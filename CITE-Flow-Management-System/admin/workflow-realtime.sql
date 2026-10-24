-- CITEFLOW Workflow Approval Realtime Schema
-- Run in Supabase SQL Editor

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'wf_submission_status') then
    create type wf_submission_status as enum (
      'notsubmitted',
      'submitted',
      'late',
      'underreview',
      'approved',
      'rejected',
      'revision'
    );
  end if;
end $$;

create table if not exists public.wf_faculty (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  department_code text not null check (department_code in ('BSIT', 'BSIE', 'BIT')),
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.wf_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  instructions text,
  attachment_names text[] not null default '{}',
  assigned_scope text not null default 'specific',
  assigned_label text not null default 'Specific Faculty',
  due_at timestamptz not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wf_tasks add column if not exists assigned_scope text not null default 'specific';
alter table public.wf_tasks add column if not exists assigned_label text not null default 'Specific Faculty';

create table if not exists public.wf_task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.wf_tasks(id) on delete cascade,
  faculty_id uuid not null references public.wf_faculty(id) on delete cascade,
  assigned_by_name text not null,
  assigned_at timestamptz not null default now(),
  unique(task_id, faculty_id)
);

create table if not exists public.wf_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.wf_tasks(id) on delete cascade,
  faculty_id uuid not null references public.wf_faculty(id) on delete cascade,
  submitted_at timestamptz,
  status wf_submission_status not null default 'notsubmitted',
  review_remarks text,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id, faculty_id)
);

create table if not exists public.wf_submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.wf_submissions(id) on delete cascade,
  file_name text not null,
  file_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.wf_notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('task', 'submission', 'review', 'comment', 'system')),
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.wf_activity_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_name text not null,
  target text,
  log_type text not null default 'system',
  created_at timestamptz not null default now()
);

create table if not exists public.wf_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.wf_tasks(id) on delete cascade,
  faculty_id uuid not null references public.wf_faculty(id) on delete cascade,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.wf_delegated_access (
  id uuid primary key default gen_random_uuid(),
  grantee_name text not null,
  department_codes text[] not null default '{}',
  granted_by_name text not null,
  granted_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists idx_wf_assignments_task on public.wf_task_assignments(task_id);
create index if not exists idx_wf_assignments_faculty on public.wf_task_assignments(faculty_id);
create index if not exists idx_wf_submissions_task_faculty on public.wf_submissions(task_id, faculty_id);
create index if not exists idx_wf_notifications_unread on public.wf_notifications(is_read, created_at desc);
create index if not exists idx_wf_activity_created on public.wf_activity_log(created_at desc);
create index if not exists idx_wf_comments_pair on public.wf_comments(task_id, faculty_id, created_at desc);

create or replace function public.wf_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_wf_tasks_updated_at on public.wf_tasks;
create trigger trg_wf_tasks_updated_at
before update on public.wf_tasks
for each row execute function public.wf_set_updated_at();

drop trigger if exists trg_wf_submissions_updated_at on public.wf_submissions;
create trigger trg_wf_submissions_updated_at
before update on public.wf_submissions
for each row execute function public.wf_set_updated_at();

-- Monitoring Views
create or replace view public.wf_department_progress as
select
  f.department_code,
  count(*)::int as total_assigned,
  count(s.id) filter (
    where s.status in ('submitted', 'late', 'underreview', 'approved', 'rejected', 'revision')
  )::int as submitted_count,
  count(*) filter (where s.id is null or s.status = 'notsubmitted')::int as not_submitted_count
from public.wf_task_assignments a
join public.wf_faculty f on f.id = a.faculty_id
left join public.wf_submissions s
  on s.task_id = a.task_id and s.faculty_id = a.faculty_id
group by f.department_code;

create or replace view public.wf_department_member_status as
select
  f.department_code,
  f.full_name,
  t.id as task_id,
  t.title as task_title,
  t.due_at,
  coalesce(s.status, 'notsubmitted'::wf_submission_status) as status,
  s.submitted_at
from public.wf_task_assignments a
join public.wf_faculty f on f.id = a.faculty_id
join public.wf_tasks t on t.id = a.task_id
left join public.wf_submissions s
  on s.task_id = a.task_id and s.faculty_id = a.faculty_id;

alter publication supabase_realtime add table public.wf_faculty;
alter publication supabase_realtime add table public.wf_tasks;
alter publication supabase_realtime add table public.wf_task_assignments;
alter publication supabase_realtime add table public.wf_submissions;
alter publication supabase_realtime add table public.wf_submission_files;
alter publication supabase_realtime add table public.wf_notifications;
alter publication supabase_realtime add table public.wf_activity_log;
alter publication supabase_realtime add table public.wf_comments;
alter publication supabase_realtime add table public.wf_delegated_access;

alter table public.wf_faculty enable row level security;
alter table public.wf_tasks enable row level security;
alter table public.wf_task_assignments enable row level security;
alter table public.wf_submissions enable row level security;
alter table public.wf_submission_files enable row level security;
alter table public.wf_notifications enable row level security;
alter table public.wf_activity_log enable row level security;
alter table public.wf_comments enable row level security;
alter table public.wf_delegated_access enable row level security;

drop policy if exists "wf_open_read_faculty" on public.wf_faculty;
create policy "wf_open_read_faculty" on public.wf_faculty for select using (true);

drop policy if exists "wf_open_read_tasks" on public.wf_tasks;
create policy "wf_open_read_tasks" on public.wf_tasks for select using (true);

drop policy if exists "wf_open_read_assignments" on public.wf_task_assignments;
create policy "wf_open_read_assignments" on public.wf_task_assignments for select using (true);

drop policy if exists "wf_open_read_submissions" on public.wf_submissions;
create policy "wf_open_read_submissions" on public.wf_submissions for select using (true);

drop policy if exists "wf_open_read_submission_files" on public.wf_submission_files;
create policy "wf_open_read_submission_files" on public.wf_submission_files for select using (true);

drop policy if exists "wf_open_read_notifications" on public.wf_notifications;
create policy "wf_open_read_notifications" on public.wf_notifications for select using (true);

drop policy if exists "wf_open_read_activity" on public.wf_activity_log;
create policy "wf_open_read_activity" on public.wf_activity_log for select using (true);

drop policy if exists "wf_open_read_comments" on public.wf_comments;
create policy "wf_open_read_comments" on public.wf_comments for select using (true);

drop policy if exists "wf_open_read_delegate" on public.wf_delegated_access;
create policy "wf_open_read_delegate" on public.wf_delegated_access for select using (true);

drop policy if exists "wf_open_write_tasks" on public.wf_tasks;
create policy "wf_open_write_tasks" on public.wf_tasks for all using (true) with check (true);

drop policy if exists "wf_open_write_assignments" on public.wf_task_assignments;
create policy "wf_open_write_assignments" on public.wf_task_assignments for all using (true) with check (true);

drop policy if exists "wf_open_write_submissions" on public.wf_submissions;
create policy "wf_open_write_submissions" on public.wf_submissions for all using (true) with check (true);

drop policy if exists "wf_open_write_submission_files" on public.wf_submission_files;
create policy "wf_open_write_submission_files" on public.wf_submission_files for all using (true) with check (true);

drop policy if exists "wf_open_write_notifications" on public.wf_notifications;
create policy "wf_open_write_notifications" on public.wf_notifications for all using (true) with check (true);

drop policy if exists "wf_open_write_activity" on public.wf_activity_log;
create policy "wf_open_write_activity" on public.wf_activity_log for all using (true) with check (true);

drop policy if exists "wf_open_write_comments" on public.wf_comments;
create policy "wf_open_write_comments" on public.wf_comments for all using (true) with check (true);

drop policy if exists "wf_open_write_delegate" on public.wf_delegated_access;
create policy "wf_open_write_delegate" on public.wf_delegated_access for all using (true) with check (true);

insert into public.wf_faculty (full_name, department_code, email)
values
  ('Dr. Elena Reyes', 'BSIT', 'elena@citeflow.local'),
  ('Prof. Jose Cruz', 'BSIT', 'jose@citeflow.local'),
  ('Prof. Sarah Lee', 'BSIT', 'sarah@citeflow.local'),
  ('Dr. John Smith', 'BSIT', 'john@citeflow.local'),
  ('Prof. Marco Santos', 'BSIE', 'marco@citeflow.local'),
  ('Dr. Maria Santos', 'BSIE', 'maria.s@citeflow.local'),
  ('Engr. David Lee', 'BSIE', 'david@citeflow.local'),
  ('Prof. Jennifer Tan', 'BSIE', 'jennifer@citeflow.local'),
  ('Engr. Anna Lopez', 'BIT', 'anna@citeflow.local'),
  ('Engr. John Doe', 'BIT', 'john.doe@citeflow.local'),
  ('Dr. Maria Dela Cruz', 'BIT', 'maria.dc@citeflow.local'),
  ('Prof. Alex Wong', 'BIT', 'alex@citeflow.local')
on conflict (full_name) do nothing;
