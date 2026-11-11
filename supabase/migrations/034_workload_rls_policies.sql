-- =============================================================================
-- CITE-Flow 034 — Workload Teaching Loads Secure Row Level Security (RLS) & Deletion Approval
--
-- Summary:
--   1. Ensures RLS is enabled on public.faculty_teaching_loads.
--   2. Dynamically drops ALL existing policies on public.faculty_teaching_loads
--      and public.workload_deletion_requests FIRST, preventing PostgreSQL 2BP01
--      dependency errors when helper functions are updated or dropped.
--   3. Defensive column prerequisites on public.faculty:
--      Ensures admin_access, position, first_name, last_name, and full_name exist.
--   4. Defines helper functions:
--      - workload_is_dean_or_secretary(): verifies Administrator, College Dean, or College Secretary.
--        Generic non-administrative faculty roles are excluded.
--      - workload_caller_departments(): returns departments for Chairperson / OIC.
--        Uses verified faculty.auth_user_id = auth.uid() (never f.id = auth.uid() to avoid
--        bigint = uuid operator mismatch).
--   5. Enforces granular SELECT access:
--      - Administrator, College Dean, and College Secretary: view all workload records.
--      - Department Chairperson and OIC: view records of faculty in their department.
--      - Faculty members: view ONLY their own teaching load records.
--   6. Enforces granular INSERT & UPDATE access:
--      - Administrator, College Dean, and College Secretary: manage any workload records.
--      - Faculty members: insert and edit their OWN teaching loads only.
--      - Trigger trg_workload_enforce_teaching_load_update strictly prevents faculty from:
--        * Transferring record ownership (faculty_id).
--        * Modifying workload status directly (must submit deletion request).
--        * Modifying already archived workload records (cannot reactivate or alter).
--   7. Enforces granular DELETE access:
--      - Direct hard DELETE is restricted to Administrator, College Dean, and College Secretary.
--      - Faculty members and Chairpersons CANNOT directly delete workload records.
--   8. Implements Workload Deletion Request workflow:
--      - Creates public.workload_deletion_requests table with faculty_id BIGINT matching faculty.id.
--      - Preserves history via ON DELETE SET NULL on teaching_load_id and faculty_id.
--      - Enforces partial unique index on (teaching_load_id) WHERE status = 'Pending'.
--      - Hardens INSERT policy to ensure reviewed_by, reviewed_at, and rejection_reason are NULL.
--      - Atomic RPCs approve_workload_deletion_request() and reject_workload_deletion_request()
--        ensure only Dean and Secretary can approve removal and archive records.
--   9. Revokes anonymous and public read access.
-- =============================================================================

-- 0. Defensive schema prerequisites on public.faculty
ALTER TABLE public.faculty ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.faculty ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.faculty ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.faculty ADD COLUMN IF NOT EXISTS position TEXT DEFAULT 'Faculty';
ALTER TABLE public.faculty ADD COLUMN IF NOT EXISTS admin_access BOOLEAN DEFAULT FALSE;

-- Ensure RLS is enabled on faculty_teaching_loads
ALTER TABLE public.faculty_teaching_loads ENABLE ROW LEVEL SECURITY;

-- 1. Dynamic cleanup of all existing policies on public.faculty_teaching_loads FIRST
--    Dropping policies before updating/dropping helper functions prevents PostgreSQL
--    dependency errors (ERROR 2BP01: cannot drop function ... because other objects depend on it).
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'faculty_teaching_loads'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.faculty_teaching_loads', pol.policyname);
    END LOOP;
END $$;

-- Explicit drops as an extra safeguard
DROP POLICY IF EXISTS "Allow authenticated full access" ON public.faculty_teaching_loads;
DROP POLICY IF EXISTS "Allow anon read" ON public.faculty_teaching_loads;
DROP POLICY IF EXISTS "faculty_teaching_loads_select" ON public.faculty_teaching_loads;
DROP POLICY IF EXISTS "faculty_teaching_loads_admin_write" ON public.faculty_teaching_loads;
DROP POLICY IF EXISTS "faculty_teaching_loads_insert" ON public.faculty_teaching_loads;
DROP POLICY IF EXISTS "faculty_teaching_loads_update" ON public.faculty_teaching_loads;
DROP POLICY IF EXISTS "faculty_teaching_loads_delete" ON public.faculty_teaching_loads;

-- Dynamic cleanup of existing policies on public.workload_deletion_requests if table exists
DO $$
DECLARE
    pol record;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'workload_deletion_requests'
    ) THEN
        FOR pol IN
            SELECT policyname
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'workload_deletion_requests'
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.workload_deletion_requests', pol.policyname);
        END LOOP;
    END IF;
END $$;

-- Drop legacy helper functions now that dependent policies are cleared
DROP FUNCTION IF EXISTS public.workload_is_admin_or_dean();

-- 2. Helper function: verify if caller is an authorized Administrator, College Dean, or College Secretary
CREATE OR REPLACE FUNCTION public.workload_is_dean_or_secretary()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_profiles ap
    WHERE ap.id = auth.uid()
      AND (
        (
          lower(trim(coalesce(ap.role, ''))) LIKE '%admin%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%chair%'
        )
        OR (
          lower(trim(coalesce(ap.role, ''))) LIKE '%dean%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%associate%'
        )
        OR (
          lower(trim(coalesce(ap.role, ''))) LIKE '%secretary%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(ap.role, ''))) NOT LIKE '%associate%'
        )
      )
  ) OR EXISTS (
    SELECT 1 FROM public.faculty f
    WHERE f.auth_user_id = auth.uid()
      AND (
        (
          (lower(trim(coalesce(f.role, ''))) LIKE '%admin%' OR lower(trim(coalesce(f.position, ''))) LIKE '%admin%')
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%chair%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%chair%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%faculty%'
        )
        OR (
          lower(trim(coalesce(f.role, ''))) LIKE '%dean%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%associate%'
        )
        OR (
          lower(trim(coalesce(f.role, ''))) LIKE '%secretary%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(f.role, ''))) NOT LIKE '%associate%'
        )
        OR (
          lower(trim(coalesce(f.position, ''))) LIKE '%dean%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%associate%'
        )
        OR (
          lower(trim(coalesce(f.position, ''))) LIKE '%secretary%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%vice%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%assistant%'
          AND lower(trim(coalesce(f.position, ''))) NOT LIKE '%associate%'
        )
      )
  );
$$;

-- 3. Helper function: return departments for which caller is Chairperson or OIC
-- Uses verified identity relationship f.auth_user_id = auth.uid() (never f.id = auth.uid()
-- since faculty.id is BIGINT and auth.uid() is UUID).
CREATE OR REPLACE FUNCTION public.workload_caller_departments()
RETURNS TABLE(department text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT f.department
  FROM public.faculty f
  WHERE f.auth_user_id = auth.uid()
    AND (
      lower(coalesce(f.role, '')) LIKE '%chair%'
      OR lower(coalesce(f.position, '')) LIKE '%chair%'
      OR lower(coalesce(f.role, '')) LIKE '%oic%'
      OR lower(coalesce(f.position, '')) LIKE '%oic%'
      OR coalesce(f.admin_access, false) = true
    );
$$;

-- Revoke execute from PUBLIC and anon on helper functions
REVOKE ALL ON FUNCTION public.workload_is_dean_or_secretary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workload_is_dean_or_secretary() TO authenticated;

REVOKE ALL ON FUNCTION public.workload_caller_departments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workload_caller_departments() TO authenticated;

-- 4. SELECT policy:
--    - Dean and Secretary can view all workload records
--    - Chairperson / OIC can view records of faculty in their department
--    - Faculty members can view only their own records (verified via auth_user_id or JWT email)
CREATE POLICY "faculty_teaching_loads_select" ON public.faculty_teaching_loads
FOR SELECT TO authenticated
USING (
    -- College Dean and College Secretary can view all records
    public.workload_is_dean_or_secretary()
    -- Department Chairperson / OIC can view records of faculty in their department
    OR faculty_id IN (
        SELECT f.id FROM public.faculty f
        WHERE f.department IN (SELECT dept.department FROM public.workload_caller_departments() dept)
    )
    -- Faculty members can view only their own records (verified via auth_user_id or JWT email)
    OR faculty_id IN (
        SELECT f.id FROM public.faculty f
        WHERE f.auth_user_id = auth.uid()
           OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
);

-- 5. INSERT policy:
--    - Administrator, College Dean, and College Secretary can insert workload records for any faculty member
--    - Faculty members can insert workload records ONLY for their own verified faculty profile
--    - Non-administrative roles are restricted to their own profiles
CREATE POLICY "faculty_teaching_loads_insert" ON public.faculty_teaching_loads
FOR INSERT TO authenticated
WITH CHECK (
    -- Dean and Secretary can insert for any faculty
    public.workload_is_dean_or_secretary()
    -- Faculty members can insert only for their own verified faculty profile
    OR faculty_id IN (
        SELECT f.id FROM public.faculty f
        WHERE f.auth_user_id = auth.uid()
           OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
);

-- 6. UPDATE policy:
--    - Dean and Secretary can update all workload records
--    - Faculty members can update ONLY their own workload records
--    - Faculty CANNOT bypass deletion approval by setting status to 'Archived' directly
CREATE POLICY "faculty_teaching_loads_update" ON public.faculty_teaching_loads
FOR UPDATE TO authenticated
USING (
    -- Dean and Secretary can update any record
    public.workload_is_dean_or_secretary()
    -- Faculty members can update only their own records
    OR faculty_id IN (
        SELECT f.id FROM public.faculty f
        WHERE f.auth_user_id = auth.uid()
           OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
)
WITH CHECK (
    -- Dean and Secretary can save any valid updates
    public.workload_is_dean_or_secretary()
    -- Faculty members can save updates to their own records provided status is not 'Archived'
    OR (
        faculty_id IN (
            SELECT f.id FROM public.faculty f
            WHERE f.auth_user_id = auth.uid()
               OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
        AND coalesce(status, 'Active') != 'Archived'
    )
);

-- 7. Trigger enforcing update constraints on public.faculty_teaching_loads
--    Guarantees that non-Dean/Secretary users cannot:
--      * Modify already archived workload records (cannot reactivate)
--      * Modify status directly (must submit a deletion request)
--      * Change ownership (faculty_id)
CREATE OR REPLACE FUNCTION public.workload_enforce_teaching_load_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.workload_is_dean_or_secretary() THEN
        -- Prevent modifying already archived workload records
        IF OLD.status = 'Archived' THEN
            RAISE EXCEPTION 'Access Denied: Archived workload records cannot be modified' USING ERRCODE = '42501';
        END IF;

        -- Prevent modifying status directly (must go through deletion request workflow)
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Access Denied: Faculty cannot modify workload status directly. Please submit a deletion request.' USING ERRCODE = '42501';
        END IF;

        -- Prevent transferring workload ownership
        IF NEW.faculty_id IS DISTINCT FROM OLD.faculty_id THEN
            RAISE EXCEPTION 'Access Denied: Faculty cannot transfer or change workload ownership' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workload_enforce_teaching_load_update ON public.faculty_teaching_loads;
CREATE TRIGGER trg_workload_enforce_teaching_load_update
BEFORE UPDATE ON public.faculty_teaching_loads
FOR EACH ROW
EXECUTE FUNCTION public.workload_enforce_teaching_load_update();

-- 8. DELETE policy:
--    Restricted to Administrator, College Dean, and College Secretary.
--    Chairpersons and Faculty cannot directly delete teaching loads.
CREATE POLICY "faculty_teaching_loads_delete" ON public.faculty_teaching_loads
FOR DELETE TO authenticated
USING (
    public.workload_is_dean_or_secretary()
);

-- =============================================================================
-- WORKLOAD DELETION REQUESTS WORKFLOW TABLE & POLICIES
-- =============================================================================

-- 9. Table for workload deletion requests
--    Uses faculty_id BIGINT to strictly match public.faculty(id) type.
--    Uses ON DELETE SET NULL on teaching_load_id and faculty_id so that replacement imports,
--    hard deletes, or faculty profile deletions do not erase deletion request audit history.
--    Stores snapshot fields (faculty_name, department, subject_code, subject_title, section,
--    academic_year, semester) captured at time of request.
CREATE TABLE IF NOT EXISTS public.workload_deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    teaching_load_id UUID REFERENCES public.faculty_teaching_loads(id) ON DELETE SET NULL,
    faculty_id BIGINT REFERENCES public.faculty(id) ON DELETE SET NULL,
    faculty_name TEXT,
    department TEXT,
    subject_code TEXT,
    subject_title TEXT,
    section TEXT,
    academic_year TEXT,
    semester TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure schema updates for existing tables
-- Safely adjusts faculty_id data type from UUID to BIGINT if table pre-existed with UUID.
-- No silent suppression: errors will stop execution instead of failing silently.
DO $$
DECLARE
    v_faculty_id_type text;
BEGIN
    -- Add snapshot columns if not exists
    ALTER TABLE public.workload_deletion_requests ADD COLUMN IF NOT EXISTS faculty_name TEXT;
    ALTER TABLE public.workload_deletion_requests ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE public.workload_deletion_requests ADD COLUMN IF NOT EXISTS subject_code TEXT;
    ALTER TABLE public.workload_deletion_requests ADD COLUMN IF NOT EXISTS subject_title TEXT;
    ALTER TABLE public.workload_deletion_requests ADD COLUMN IF NOT EXISTS section TEXT;
    ALTER TABLE public.workload_deletion_requests ADD COLUMN IF NOT EXISTS academic_year TEXT;
    ALTER TABLE public.workload_deletion_requests ADD COLUMN IF NOT EXISTS semester TEXT;

    -- Inspect existing data type of faculty_id
    SELECT data_type INTO v_faculty_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workload_deletion_requests'
      AND column_name = 'faculty_id';

    -- Convert from UUID to BIGINT if pre-existing schema used UUID
    IF v_faculty_id_type IS NOT NULL AND v_faculty_id_type <> 'bigint' THEN
        ALTER TABLE public.workload_deletion_requests
            DROP CONSTRAINT IF EXISTS workload_deletion_requests_faculty_id_fkey;

        ALTER TABLE public.workload_deletion_requests
            ALTER COLUMN faculty_id TYPE BIGINT
            USING (
                CASE
                    WHEN faculty_id::text ~ '^[0-9]+$' THEN faculty_id::text::bigint
                    ELSE NULL
                END
            );
    END IF;

    -- Make faculty_id nullable to survive faculty deletions
    ALTER TABLE public.workload_deletion_requests ALTER COLUMN faculty_id DROP NOT NULL;

    -- Update teaching_load_id foreign key constraint to ON DELETE SET NULL
    ALTER TABLE public.workload_deletion_requests
        DROP CONSTRAINT IF EXISTS workload_deletion_requests_teaching_load_id_fkey;

    ALTER TABLE public.workload_deletion_requests
        ADD CONSTRAINT workload_deletion_requests_teaching_load_id_fkey
        FOREIGN KEY (teaching_load_id) REFERENCES public.faculty_teaching_loads(id) ON DELETE SET NULL;

    -- Update faculty_id foreign key constraint to ON DELETE SET NULL (pointing to faculty.id BIGINT)
    ALTER TABLE public.workload_deletion_requests
        DROP CONSTRAINT IF EXISTS workload_deletion_requests_faculty_id_fkey;

    ALTER TABLE public.workload_deletion_requests
        ADD CONSTRAINT workload_deletion_requests_faculty_id_fkey
        FOREIGN KEY (faculty_id) REFERENCES public.faculty(id) ON DELETE SET NULL;
END $$;

-- 9b. Trigger to auto-populate snapshot details upon creation
CREATE OR REPLACE FUNCTION public.workload_populate_deletion_request_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tl record;
    v_fac record;
BEGIN
    IF NEW.teaching_load_id IS NOT NULL THEN
        SELECT * INTO v_tl FROM public.faculty_teaching_loads WHERE id = NEW.teaching_load_id;
        IF FOUND THEN
            NEW.subject_code := v_tl.subject_code;
            NEW.subject_title := v_tl.subject_title;
            NEW.section := v_tl.section;
            NEW.academic_year := v_tl.academic_year;
            NEW.semester := v_tl.semester;
            IF NEW.faculty_id IS NULL AND v_tl.faculty_id IS NOT NULL THEN
                NEW.faculty_id := v_tl.faculty_id;
            END IF;
        END IF;
    END IF;

    IF NEW.faculty_id IS NOT NULL THEN
        SELECT * INTO v_fac FROM public.faculty WHERE id = NEW.faculty_id;
        IF FOUND THEN
            NEW.faculty_name := coalesce(
                v_fac.full_name,
                nullif(trim(concat_ws(' ', v_fac.first_name, v_fac.last_name)), '')
            );
            NEW.department := v_fac.department;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workload_populate_deletion_request_snapshots ON public.workload_deletion_requests;
CREATE TRIGGER trg_workload_populate_deletion_request_snapshots
BEFORE INSERT ON public.workload_deletion_requests
FOR EACH ROW
EXECUTE FUNCTION public.workload_populate_deletion_request_snapshots();

-- 9c. Trigger to protect snapshot and relationship immutability on UPDATE
CREATE OR REPLACE FUNCTION public.workload_protect_deletion_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Prevent modifying immutable foreign keys
    IF NEW.teaching_load_id IS DISTINCT FROM OLD.teaching_load_id THEN
        RAISE EXCEPTION 'Access Denied: teaching_load_id cannot be modified once created.' USING ERRCODE = '42501';
    END IF;
    IF NEW.faculty_id IS DISTINCT FROM OLD.faculty_id THEN
        RAISE EXCEPTION 'Access Denied: faculty_id cannot be modified once created.' USING ERRCODE = '42501';
    END IF;

    -- Prevent modifying snapshot details
    IF NEW.subject_code IS DISTINCT FROM OLD.subject_code
       OR NEW.subject_title IS DISTINCT FROM OLD.subject_title
       OR NEW.section IS DISTINCT FROM OLD.section
       OR NEW.academic_year IS DISTINCT FROM OLD.academic_year
       OR NEW.semester IS DISTINCT FROM OLD.semester
       OR NEW.faculty_name IS DISTINCT FROM OLD.faculty_name
       OR NEW.department IS DISTINCT FROM OLD.department THEN
        RAISE EXCEPTION 'Access Denied: Workload deletion request snapshot details are immutable.' USING ERRCODE = '42501';
    END IF;

    -- Prevent tampering with created_at timestamp
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Access Denied: created_at timestamp cannot be modified.' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workload_protect_deletion_request_update ON public.workload_deletion_requests;
CREATE TRIGGER trg_workload_protect_deletion_request_update
BEFORE UPDATE ON public.workload_deletion_requests
FOR EACH ROW
EXECUTE FUNCTION public.workload_protect_deletion_request_update();

-- 10. Partial unique index: Prevent multiple Pending requests for the same teaching load
CREATE UNIQUE INDEX IF NOT EXISTS uq_workload_pending_deletion_request
ON public.workload_deletion_requests (teaching_load_id)
WHERE status = 'Pending' AND teaching_load_id IS NOT NULL;

ALTER TABLE public.workload_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Dynamic cleanup of existing policies on public.workload_deletion_requests
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'workload_deletion_requests'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.workload_deletion_requests', pol.policyname);
    END LOOP;
END $$;

-- 11. SELECT policy for deletion requests
CREATE POLICY "workload_deletion_requests_select" ON public.workload_deletion_requests
FOR SELECT TO authenticated
USING (
    -- Dean and Secretary can view all deletion requests
    public.workload_is_dean_or_secretary()
    -- Department Chairperson / OIC can view requests for faculty in their department
    OR faculty_id IN (
        SELECT f.id FROM public.faculty f
        WHERE f.department IN (SELECT dept.department FROM public.workload_caller_departments() dept)
    )
    -- Faculty members can view their own deletion requests
    OR faculty_id IN (
        SELECT f.id FROM public.faculty f
        WHERE f.auth_user_id = auth.uid()
           OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
);

-- 12. INSERT policy for deletion requests
--     Hardened: Faculty must NOT forge reviewed_by, reviewed_at, or rejection_reason upon insertion
CREATE POLICY "workload_deletion_requests_insert" ON public.workload_deletion_requests
FOR INSERT TO authenticated
WITH CHECK (
    -- Dean and Secretary can insert requests
    public.workload_is_dean_or_secretary()
    -- Faculty members can insert Pending requests only for their own teaching loads
    OR (
        status = 'Pending'
        AND reviewed_by IS NULL
        AND reviewed_at IS NULL
        AND rejection_reason IS NULL
        AND faculty_id IN (
            SELECT f.id FROM public.faculty f
            WHERE f.auth_user_id = auth.uid()
               OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
        AND EXISTS (
            SELECT 1 FROM public.faculty_teaching_loads tl
            WHERE tl.id = teaching_load_id
              AND tl.faculty_id = workload_deletion_requests.faculty_id
        )
    )
);

-- 13. UPDATE policy for deletion requests (Approving / Rejecting)
--     Restricted strictly to College Dean and College Secretary.
--     Faculty members CANNOT approve or modify deletion requests.
CREATE POLICY "workload_deletion_requests_update" ON public.workload_deletion_requests
FOR UPDATE TO authenticated
USING (
    public.workload_is_dean_or_secretary()
)
WITH CHECK (
    public.workload_is_dean_or_secretary()
);

-- 14. DELETE policy for deletion requests
CREATE POLICY "workload_deletion_requests_delete" ON public.workload_deletion_requests
FOR DELETE TO authenticated
USING (
    -- Dean and Secretary can delete requests
    public.workload_is_dean_or_secretary()
    -- Faculty members can cancel their own pending requests
    OR (
        status = 'Pending'
        AND faculty_id IN (
            SELECT f.id FROM public.faculty f
            WHERE f.auth_user_id = auth.uid()
               OR lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
);

-- 15. Atomic RPC to Approve a Workload Deletion Request
CREATE OR REPLACE FUNCTION public.approve_workload_deletion_request(p_request_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req record;
BEGIN
    IF NOT public.workload_is_dean_or_secretary() THEN
        RAISE EXCEPTION 'Access Denied: Only the College Dean and College Secretary can approve workload deletion requests' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.workload_deletion_requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workload deletion request not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status != 'Pending' THEN
        RAISE EXCEPTION 'Request has already been processed with status %', v_req.status USING ERRCODE = '22000';
    END IF;

    -- Reject approval if underlying workload record was removed or no longer exists
    IF v_req.teaching_load_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.faculty_teaching_loads WHERE id = v_req.teaching_load_id) THEN
        RAISE EXCEPTION 'Cannot approve deletion request: The referenced workload record no longer exists or was removed.'
            USING ERRCODE = '22000';
    END IF;

    -- Update request status
    UPDATE public.workload_deletion_requests
    SET status = 'Approved',
        reviewed_by = auth.uid(),
        reviewed_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_request_id;

    -- Soft-delete / archive the target teaching load
    UPDATE public.faculty_teaching_loads
    SET status = 'Archived',
        updated_at = timezone('utc'::text, now())
    WHERE id = v_req.teaching_load_id;

    RETURN jsonb_build_object('success', true, 'message', 'Workload deletion request approved and entry archived.');
END;
$$;

-- 16. Atomic RPC to Reject a Workload Deletion Request
CREATE OR REPLACE FUNCTION public.reject_workload_deletion_request(p_request_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req record;
BEGIN
    IF NOT public.workload_is_dean_or_secretary() THEN
        RAISE EXCEPTION 'Access Denied: Only the College Dean and College Secretary can reject workload deletion requests' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.workload_deletion_requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workload deletion request not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status != 'Pending' THEN
        RAISE EXCEPTION 'Request has already been processed with status %', v_req.status USING ERRCODE = '22000';
    END IF;

    -- Update request status
    UPDATE public.workload_deletion_requests
    SET status = 'Rejected',
        rejection_reason = p_reason,
        reviewed_by = auth.uid(),
        reviewed_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_request_id;

    RETURN jsonb_build_object('success', true, 'message', 'Workload deletion request rejected.');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_workload_deletion_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_workload_deletion_request(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_workload_deletion_request(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_workload_deletion_request(UUID, TEXT) TO authenticated;
