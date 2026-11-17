-- =============================================================================
-- 040_department_chairpersons.sql
-- CITE-Flow: College of Technology and Engineering (COTE) departments and the
-- ONE official Chairperson per department.
--
--   COTE departments : BSIT, BSIE, BIT
--   Rule             : each department has exactly one Chairperson, and a
--                      faculty member can chair at most one department.
--   Who can change it: administrators only (wf_is_final_approver()), through
--                      public.admin_set_department_chair(...).
--
-- Source of truth is public.departments.chairperson_faculty_id. faculty.role
-- is kept in sync ('Chairperson' / 'Faculty') so every existing check that
-- reads the role (wf_is_chairperson_role, auth-guard, chair review pages)
-- keeps working unchanged.
--
-- Temporary OIC access (wf_delegated_access grants from Workflow Approval)
-- is NOT affected. OIC grants never change faculty.role.
--
-- Safe to re-run. Additive: no tables dropped.
-- NOTE: when this runs the first time, any faculty member whose role says
-- "Chairperson" but who is not picked as their department's official chair
-- is set back to role 'Faculty' (one chair per department).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Department code helper (accepts codes or full program names)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cote_department_code(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN v = 'bsit' OR v LIKE '%information technology%' THEN 'BSIT'
    WHEN v = 'bsie' OR v LIKE '%industrial engineering%' THEN 'BSIE'
    WHEN v = 'bit'  OR v LIKE '%industrial technology%'  THEN 'BIT'
    ELSE NULL
  END
  FROM (SELECT lower(trim(coalesce(value, ''))) AS v) s;
$$;

-- ---------------------------------------------------------------------------
-- 2. Departments table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  code                    text PRIMARY KEY,
  name                    text NOT NULL,
  college_code            text NOT NULL DEFAULT 'COTE',
  college_name            text NOT NULL DEFAULT 'College of Technology and Engineering',
  chair_assigned_at       timestamptz,
  chair_assigned_by_name  text,
  created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT departments_code_check CHECK (code IN ('BSIT', 'BSIE', 'BIT'))
);

-- chairperson_faculty_id must match the live type of faculty.id
-- (bigint on the live project, uuid in the original 001 schema).
DO $$
DECLARE
  fac_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO fac_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.faculty'::regclass
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'departments'
      AND column_name = 'chairperson_faculty_id'
  ) THEN
    EXECUTE format('ALTER TABLE public.departments ADD COLUMN chairperson_faculty_id %s', fac_id_type);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'departments_chairperson_faculty_fk'
  ) THEN
    ALTER TABLE public.departments
      ADD CONSTRAINT departments_chairperson_faculty_fk
      FOREIGN KEY (chairperson_faculty_id) REFERENCES public.faculty(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- A faculty member can chair at most one department.
CREATE UNIQUE INDEX IF NOT EXISTS departments_one_department_per_chair
  ON public.departments (chairperson_faculty_id)
  WHERE chairperson_faculty_id IS NOT NULL;

INSERT INTO public.departments (code, name) VALUES
  ('BSIT', 'Bachelor of Science in Information Technology'),
  ('BSIE', 'Bachelor of Science in Industrial Engineering'),
  ('BIT',  'Bachelor of Industrial Technology')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_select_authenticated ON public.departments;
CREATE POLICY departments_select_authenticated
  ON public.departments FOR SELECT
  TO authenticated
  USING (true);
-- No INSERT/UPDATE/DELETE policies: writes go only through
-- public.admin_set_department_chair (SECURITY DEFINER).

GRANT SELECT ON public.departments TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Backfill: adopt one existing "Chairperson" per department
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  d record;
  pick text;
BEGIN
  PERFORM set_config('citeflow.chair_sync', 'on', true);

  FOR d IN SELECT code FROM public.departments WHERE chairperson_faculty_id IS NULL ORDER BY code LOOP
    pick := NULL;
    SELECT f.id::text INTO pick
    FROM public.faculty f
    WHERE public.cote_department_code(f.department) = d.code
      AND (
        strpos(lower(coalesce(f.role, '')), 'chair') > 0
        OR strpos(lower(coalesce(f.position, '')), 'chair') > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.departments x WHERE x.chairperson_faculty_id::text = f.id::text
      )
    ORDER BY
      CASE WHEN lower(coalesce(to_jsonb(f)->>'status', 'active')) = 'active' THEN 0 ELSE 1 END,
      CASE WHEN f.auth_user_id IS NOT NULL THEN 0 ELSE 1 END,
      f.created_at NULLS LAST
    LIMIT 1;

    IF pick IS NOT NULL THEN
      EXECUTE
        'UPDATE public.departments
            SET chairperson_faculty_id = (SELECT f.id FROM public.faculty f WHERE f.id::text = $1),
                chair_assigned_at = timezone(''utc'', now()),
                chair_assigned_by_name = ''Migration 040 (existing Chairperson role)'',
                updated_at = timezone(''utc'', now())
          WHERE code = $2'
        USING pick, d.code;
    END IF;
  END LOOP;

  -- Everyone else who still says "Chairperson" goes back to Faculty.
  UPDATE public.faculty f
     SET role = 'Faculty'
   WHERE strpos(lower(coalesce(f.role, '')), 'chair') > 0
     AND NOT EXISTS (SELECT 1 FROM public.departments x WHERE x.chairperson_faculty_id::text = f.id::text);

  UPDATE public.faculty f
     SET position = 'Faculty'
   WHERE strpos(lower(coalesce(f.position, '')), 'chair') > 0
     AND NOT EXISTS (SELECT 1 FROM public.departments x WHERE x.chairperson_faculty_id::text = f.id::text);

  -- Official chairs always carry the Chairperson role.
  UPDATE public.faculty f
     SET role = 'Chairperson'
    FROM public.departments x
   WHERE x.chairperson_faculty_id::text = f.id::text
     AND strpos(lower(coalesce(f.role, '')), 'chair') = 0;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Guard trigger: faculty.role can only say "Chairperson" for the official
--    chair, and the official chair cannot be moved out of their department.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.faculty_enforce_department_chair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chair_dept text;
  who text;
BEGIN
  IF coalesce(current_setting('citeflow.chair_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT code INTO chair_dept
    FROM public.departments
    WHERE chairperson_faculty_id::text = OLD.id::text;
  END IF;

  IF chair_dept IS NOT NULL THEN
    IF public.cote_department_code(NEW.department) IS DISTINCT FROM chair_dept THEN
      who := coalesce(nullif(trim(to_jsonb(NEW)->>'full_name'), ''), 'This faculty member');
      RAISE EXCEPTION '% is the official % Chairperson. Assign a new % Chairperson in Faculty Profiles > Department Chairpersons before moving them to another department.',
        who, chair_dept, chair_dept
        USING ERRCODE = 'P0001';
    END IF;
    IF strpos(lower(coalesce(NEW.role, '')), 'chair') = 0 THEN
      NEW.role := 'Chairperson';
    END IF;
    RETURN NEW;
  END IF;

  -- Not the official chair: never allow a Chairperson role/position.
  IF strpos(lower(coalesce(NEW.role, '')), 'chair') > 0 THEN
    NEW.role := 'Faculty';
  END IF;
  IF strpos(lower(coalesce(NEW.position, '')), 'chair') > 0 THEN
    NEW.position := 'Faculty';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_faculty_enforce_department_chair ON public.faculty;
CREATE TRIGGER trg_faculty_enforce_department_chair
  BEFORE INSERT OR UPDATE OF role, position, department ON public.faculty
  FOR EACH ROW
  EXECUTE FUNCTION public.faculty_enforce_department_chair();

-- ---------------------------------------------------------------------------
-- 5. Read helper (works for any signed-in user, regardless of faculty RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_department_chairs()
RETURNS TABLE (
  code text,
  name text,
  college_name text,
  chairperson_faculty_id text,
  chairperson_name text,
  chairperson_email text,
  chair_assigned_at timestamptz,
  chair_assigned_by_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.code,
    d.name,
    d.college_name,
    d.chairperson_faculty_id::text,
    coalesce(nullif(trim(to_jsonb(f)->>'full_name'), ''), nullif(trim(to_jsonb(f)->>'name'), '')),
    f.email,
    d.chair_assigned_at,
    d.chair_assigned_by_name
  FROM public.departments d
  LEFT JOIN public.faculty f ON f.id::text = d.chairperson_faculty_id::text
  ORDER BY array_position(ARRAY['BSIT', 'BSIE', 'BIT'], d.code);
$$;

-- ---------------------------------------------------------------------------
-- 6. Admin RPC: replace a department's Chairperson in one transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_department_chair(
  p_department text,
  p_faculty_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dept_code   text := public.cote_department_code(p_department);
  dept_row    public.departments%ROWTYPE;
  new_fac     public.faculty%ROWTYPE;
  old_fac     public.faculty%ROWTYPE;
  other_dept  text;
  actor       text;
  new_name    text;
  old_name    text;
BEGIN
  IF NOT public.wf_is_final_approver() THEN
    RAISE EXCEPTION 'Only administrators can assign department chairpersons.'
      USING ERRCODE = '42501';
  END IF;

  IF dept_code IS NULL THEN
    RAISE EXCEPTION 'Unknown department "%". COTE departments are BSIT, BSIE, and BIT.', p_department;
  END IF;

  IF nullif(trim(coalesce(p_faculty_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Select a faculty member to serve as % Chairperson.', dept_code;
  END IF;

  SELECT * INTO dept_row FROM public.departments WHERE code = dept_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Department % is not set up. Re-run migration 040.', dept_code;
  END IF;

  SELECT * INTO new_fac FROM public.faculty WHERE id::text = trim(p_faculty_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Faculty member not found.';
  END IF;
  new_name := coalesce(nullif(trim(to_jsonb(new_fac)->>'full_name'), ''), nullif(trim(to_jsonb(new_fac)->>'name'), ''), 'Selected faculty member');

  IF public.cote_department_code(new_fac.department) IS DISTINCT FROM dept_code THEN
    RAISE EXCEPTION '% belongs to %, not %. Update their department first.',
      new_name, coalesce(nullif(new_fac.department, ''), 'no department'), dept_code;
  END IF;

  IF lower(trim(coalesce(new_fac.role, ''))) IN ('admin', 'administrator', 'dean', 'superadmin') THEN
    RAISE EXCEPTION '% has an administrator account and cannot be a department chairperson.', new_name;
  END IF;

  SELECT code INTO other_dept
  FROM public.departments
  WHERE chairperson_faculty_id::text = new_fac.id::text AND code <> dept_code;
  IF other_dept IS NOT NULL THEN
    RAISE EXCEPTION '% is already the % Chairperson. A faculty member can chair only one department.', new_name, other_dept;
  END IF;

  IF dept_row.chairperson_faculty_id IS NOT NULL
     AND dept_row.chairperson_faculty_id::text = new_fac.id::text THEN
    RETURN jsonb_build_object(
      'department', dept_code,
      'chairperson_faculty_id', new_fac.id::text,
      'chairperson_name', new_name,
      'changed', false
    );
  END IF;

  -- admin_profiles columns differ between deployments (full_name may not
  -- exist), so read them through jsonb instead of direct column references.
  SELECT coalesce(
    nullif(trim(to_jsonb(ap)->>'full_name'), ''),
    nullif(trim(concat_ws(' ', to_jsonb(ap)->>'first_name', to_jsonb(ap)->>'last_name')), ''),
    nullif(trim(to_jsonb(ap)->>'name'), ''),
    nullif(trim(to_jsonb(ap)->>'email'), '')
  ) INTO actor
  FROM public.admin_profiles ap
  WHERE ap.id = auth.uid();
  actor := coalesce(actor, nullif(auth.jwt() ->> 'email', ''), 'Administrator');

  PERFORM set_config('citeflow.chair_sync', 'on', true);

  -- Step down the previous chair (back to Faculty) and drop their review
  -- grants for this department. Grants for other departments are kept.
  IF dept_row.chairperson_faculty_id IS NOT NULL THEN
    SELECT * INTO old_fac FROM public.faculty WHERE id::text = dept_row.chairperson_faculty_id::text;
    old_name := coalesce(nullif(trim(to_jsonb(old_fac)->>'full_name'), ''), nullif(trim(to_jsonb(old_fac)->>'name'), ''), 'Previous chairperson');

    UPDATE public.faculty
       SET role = 'Faculty',
           position = CASE WHEN strpos(lower(coalesce(position, '')), 'chair') > 0 THEN 'Faculty' ELSE position END,
           updated_at = timezone('utc', now())
     WHERE id::text = dept_row.chairperson_faculty_id::text;

    BEGIN
      UPDATE public.wf_delegated_access d
         SET department_codes = ARRAY(
               SELECT c FROM unnest(coalesce(d.department_codes, '{}'::text[])) AS c
               WHERE upper(trim(c)) <> dept_code
             )
       WHERE d.grantee_faculty_id::text = dept_row.chairperson_faculty_id::text
         AND d.is_active IS DISTINCT FROM false
         AND EXISTS (
           SELECT 1 FROM unnest(coalesce(d.department_codes, '{}'::text[])) AS c
           WHERE upper(trim(c)) = dept_code
         );

      UPDATE public.wf_delegated_access d
         SET is_active = false
       WHERE d.grantee_faculty_id::text = dept_row.chairperson_faculty_id::text
         AND d.is_active IS DISTINCT FROM false
         AND coalesce(array_length(d.department_codes, 1), 0) = 0;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      NULL;
    END;
  END IF;

  UPDATE public.faculty
     SET role = 'Chairperson',
         updated_at = timezone('utc', now())
   WHERE id::text = new_fac.id::text;

  UPDATE public.departments
     SET chairperson_faculty_id = new_fac.id,
         chair_assigned_at = timezone('utc', now()),
         chair_assigned_by_name = actor,
         updated_at = timezone('utc', now())
   WHERE code = dept_code;

  -- Best-effort audit trail and notifications (never block the change).
  BEGIN
    INSERT INTO public.wf_activity_log (action, actor_name, target, log_type)
    VALUES (
      'Department Chairperson assigned',
      actor,
      format('%s Chairperson: %s%s', dept_code, new_name,
             CASE WHEN old_name IS NOT NULL THEN format(' (replaced %s)', old_name) ELSE '' END),
      'access'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    INSERT INTO public.wf_notifications (type, message, is_read, faculty_id)
    VALUES ('system', format('You are now the %s Department Chairperson.', dept_code), false, new_fac.id);
    IF old_fac.id IS NOT NULL THEN
      INSERT INTO public.wf_notifications (type, message, is_read, faculty_id)
      VALUES ('system', format('%s is now the %s Department Chairperson. Your chairperson access for %s has ended.', new_name, dept_code, dept_code), false, old_fac.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'department', dept_code,
    'chairperson_faculty_id', new_fac.id::text,
    'chairperson_name', new_name,
    'previous_faculty_id', old_fac.id::text,
    'previous_name', old_name,
    'changed', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_department_chair(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_department_chair(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_department_chairs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cote_department_code(text) TO authenticated;

COMMIT;
