-- =============================================================================
-- CITE-Flow 033 — Workload Import Atomic Transaction RPC & Strict Role Check
--
-- Summary:
--   1. Implements public.commit_workload_import() RPC with an atomic transaction.
--   2. Enforces database-level authorization: ONLY Administrator, College Dean, and College Secretary
--      may execute workload replacements and additions, verified strictly via
--      database records (public.faculty and public.admin_profiles).
--   3. Explicitly revokes default EXECUTE from PUBLIC and anon.
--   4. Validates legitimate CITEFLOW semester values ('1st Semester', '2nd Semester', 'Summer').
--   5. For 'replace': Deletes ONLY existing records for faculty members present
--      in the import file, strictly within the specified Academic Year and Semester.
--   6. Inserts all confirmed workload records in the same transaction.
--   7. Automatically rolls back the entire operation if any deletion or insertion fails.
--   8. For 'add': Preserves existing records and ignores exact duplicates.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.commit_workload_import(
    p_strategy text,
    p_academic_year text,
    p_semester text,
    p_records jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_is_authorized boolean := false;
    v_norm_ay text;
    v_alt_ay text;
    v_norm_sem text;
    v_faculty_ids uuid[] := ARRAY[]::uuid[];
    v_rec jsonb;
    v_fac_id uuid;
    v_inserted_count int := 0;
    v_replaced_count int := 0;
    v_skipped_count int := 0;
    v_total_records int := 0;
    v_subj_code text;
    v_subj_title text;
    v_section text;
    v_units numeric;
    v_hours numeric;
    v_students int;
    v_room text;
    v_day text;
    v_start text;
    v_end text;
    v_entries jsonb;
    v_remarks text;
    v_pending_faculty_name text;
    v_pending_subject text;
    v_pending_section text;
BEGIN
    -- 1. Authorization: Verify user is authenticated
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: You must be authenticated to perform workload imports.'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Verify role strictly against trusted database records (public.faculty and public.admin_profiles)
    -- Bound strictly to verified auth user id (v_user_id). Email fallbacks are forbidden.
    SELECT EXISTS (
        SELECT 1 FROM public.admin_profiles ap
        WHERE ap.id = v_user_id
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
        WHERE f.auth_user_id = v_user_id
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
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Access Denied: Only Administrator, College Dean, and College Secretary accounts can manage workload imports.'
            USING ERRCODE = '42501';
    END IF;

    -- 3. Validate strategy
    IF p_strategy IS NULL OR (p_strategy <> 'add' AND p_strategy <> 'replace') THEN
        RAISE EXCEPTION 'Invalid strategy: must be "add" or "replace".'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Validate and normalize Academic Year
    IF trim(coalesce(p_academic_year, '')) = '' THEN
        RAISE EXCEPTION 'Academic Year is required.'
            USING ERRCODE = '22023';
    END IF;
    v_norm_ay := replace(trim(p_academic_year), '–', '-');
    IF v_norm_ay !~ '^\d{4}-\d{4}$' THEN
        RAISE EXCEPTION 'Invalid Academic Year format: "%". Expected format YYYY-YYYY (e.g., 2025-2026).', p_academic_year
            USING ERRCODE = '22023';
    END IF;
    v_alt_ay := replace(trim(p_academic_year), '-', '–');

    -- 5. Validate and normalize Semester against legitimate CITEFLOW values
    v_norm_sem := CASE
        WHEN lower(trim(p_semester)) IN ('1st semester', '1st', 'first semester', 'first') THEN '1st Semester'
        WHEN lower(trim(p_semester)) IN ('2nd semester', '2nd', 'second semester', 'second') THEN '2nd Semester'
        WHEN lower(trim(p_semester)) IN ('summer', 'midyear', 'mid-year', 'mid year') THEN 'Summer'
        ELSE NULL
    END;

    IF v_norm_sem IS NULL THEN
        RAISE EXCEPTION 'Invalid semester: "%". Accepted values are 1st Semester, 2nd Semester, Summer.', p_semester
            USING ERRCODE = '22023';
    END IF;

    -- 6. Validate workload records array
    IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) = 0 THEN
        RAISE EXCEPTION 'No workload records provided for import.'
            USING ERRCODE = '22023';
    END IF;

    v_total_records := jsonb_array_length(p_records);

    -- 7. Extract unique faculty IDs and verify they exist in registered faculty
    FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        v_fac_id := (v_rec ->> 'faculty_id')::uuid;
        IF v_fac_id IS NULL THEN
            RAISE EXCEPTION 'Record missing valid faculty_id: %', v_rec
                USING ERRCODE = '22023';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.faculty WHERE id = v_fac_id) THEN
            RAISE EXCEPTION 'Faculty ID "%" is not a registered faculty record.', v_fac_id
                USING ERRCODE = '23503';
        END IF;

        IF NOT (v_faculty_ids @> ARRAY[v_fac_id]) THEN
            v_faculty_ids := array_append(v_faculty_ids, v_fac_id);
        END IF;
    END LOOP;

    -- 8. For Replace strategy:
    --    8a. Verify no Pending deletion requests exist on affected workloads.
    --        Replacement would orphan or delete workloads undergoing faculty deletion review.
    --    8b. Delete ONLY existing records for included faculty in target AY & Semester.
    IF p_strategy = 'replace' AND array_length(v_faculty_ids, 1) > 0 THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'workload_deletion_requests'
        ) THEN
            EXECUTE $chk$
                SELECT
                    coalesce(f.full_name, 'Unknown Faculty'),
                    coalesce(tl.subject_code, 'Unknown Subject'),
                    coalesce(tl.section, 'Unknown Section')
                FROM public.workload_deletion_requests wdr
                JOIN public.faculty_teaching_loads tl ON tl.id = wdr.teaching_load_id
                LEFT JOIN public.faculty f ON f.id = tl.faculty_id
                WHERE tl.faculty_id = ANY($1)
                  AND (tl.academic_year = $2 OR tl.academic_year = $3)
                  AND tl.semester = $4
                  AND wdr.status = 'Pending'
                LIMIT 1
            $chk$
            INTO v_pending_faculty_name, v_pending_subject, v_pending_section
            USING v_faculty_ids, v_norm_ay, v_alt_ay, v_norm_sem;

            IF v_pending_faculty_name IS NOT NULL THEN
                RAISE EXCEPTION 'Cannot perform replacement import: A pending deletion request exists for faculty "%" (%, Section %). Please resolve all pending deletion requests before replacing workloads.',
                    v_pending_faculty_name, v_pending_subject, v_pending_section
                    USING ERRCODE = '22000';
            END IF;
        END IF;

        DELETE FROM public.faculty_teaching_loads
        WHERE faculty_id = ANY(v_faculty_ids)
          AND (academic_year = v_norm_ay OR academic_year = v_alt_ay)
          AND semester = v_norm_sem;

        GET DIAGNOSTICS v_replaced_count = ROW_COUNT;
    END IF;

    -- 9. Insert records in the same transaction
    FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        v_fac_id := (v_rec ->> 'faculty_id')::uuid;
        v_subj_code := trim(coalesce(v_rec ->> 'subject_code', ''));
        v_subj_title := trim(coalesce(v_rec ->> 'subject_title', ''));
        v_section := trim(coalesce(v_rec ->> 'section', ''));
        v_units := coalesce((v_rec ->> 'units')::numeric, 3.0);
        v_hours := coalesce((v_rec ->> 'hours_per_week')::numeric, 3.0);
        v_students := coalesce((v_rec ->> 'total_students')::int, 0);
        v_room := coalesce(v_rec ->> 'room', '');
        v_day := coalesce(v_rec ->> 'schedule_day', '');
        v_start := coalesce(v_rec ->> 'start_time', '');
        v_end := coalesce(v_rec ->> 'end_time', '');
        v_entries := coalesce(v_rec -> 'schedule_entries', '[]'::jsonb);
        v_remarks := coalesce(v_rec ->> 'remarks', '');

        IF v_subj_code = '' OR v_subj_title = '' OR v_section = '' THEN
            RAISE EXCEPTION 'Record missing required subject_code, subject_title, or section: %', v_rec
                USING ERRCODE = '22023';
        END IF;

        -- For Add strategy: skip exact duplicate assignments
        IF p_strategy = 'add' THEN
            IF EXISTS (
                SELECT 1 FROM public.faculty_teaching_loads
                WHERE faculty_id = v_fac_id
                  AND (academic_year = v_norm_ay OR academic_year = v_alt_ay)
                  AND semester = v_norm_sem
                  AND lower(trim(subject_code)) = lower(v_subj_code)
                  AND lower(trim(section)) = lower(v_section)
            ) THEN
                v_skipped_count := v_skipped_count + 1;
                CONTINUE;
            END IF;
        END IF;

        INSERT INTO public.faculty_teaching_loads (
            faculty_id, academic_year, semester, subject_code, subject_title,
            section, units, hours_per_week, total_students, room,
            schedule_day, start_time, end_time, schedule_entries, remarks, status
        ) VALUES (
            v_fac_id, v_norm_ay, v_norm_sem, v_subj_code, v_subj_title,
            v_section, v_units, v_hours, v_students, v_room,
            v_day, v_start, v_end, v_entries, v_remarks, 'Active'
        );

        v_inserted_count := v_inserted_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'strategy', p_strategy,
        'summary', jsonb_build_object(
            'inserted', v_inserted_count,
            'replaced', v_replaced_count,
            'skipped', v_skipped_count,
            'total', v_total_records
        )
    );
END;
$$;

-- Revoke default execute privileges from PUBLIC and anon
REVOKE ALL ON FUNCTION public.commit_workload_import(text, text, text, jsonb) FROM PUBLIC, anon;

-- Grant execution strictly to authenticated database users
GRANT EXECUTE ON FUNCTION public.commit_workload_import(text, text, text, jsonb) TO authenticated;
