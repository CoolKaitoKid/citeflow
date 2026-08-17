-- ==============================================================================
-- Fix: Robust Auth Trigger for Profiles & Admin Accounts
-- Resolves "Database error saving new user" during registration
-- ==============================================================================

-- 1. Create or replace the auth user trigger function with robust conflict handling and exception safety
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_role TEXT;
    first_name TEXT;
    last_name TEXT;
    full_name TEXT;
    emp_id TEXT;
    clean_role TEXT;
BEGIN
    -- Extract and normalize role
    user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'Admin');
    
    IF LOWER(user_role) IN ('admin', 'administrator', 'superadmin') THEN
        clean_role := 'Admin';
    ELSE
        clean_role := 'Faculty';
    END IF;

    first_name := COALESCE(NEW.raw_user_meta_data->>'first_name', '');
    last_name := COALESCE(NEW.raw_user_meta_data->>'last_name', '');
    full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', TRIM(CONCAT(first_name, ' ', last_name)));
    
    IF full_name = '' THEN
        full_name := SPLIT_PART(NEW.email, '@', 1);
    END IF;
    
    emp_id := NEW.raw_user_meta_data->>'employee_id';

    -- 1. Safely Upsert into public.profiles
    BEGIN
        -- Remove any orphan profile by email with outdated auth id if necessary
        DELETE FROM public.profiles WHERE email = NEW.email AND id != NEW.id;

        INSERT INTO public.profiles (id, email, full_name, first_name, last_name, role)
        VALUES (NEW.id, NEW.email, full_name, first_name, last_name, clean_role)
        ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            full_name = EXCLUDED.full_name,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            role = EXCLUDED.role,
            updated_at = NOW();
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user: Failed to insert into public.profiles: %', SQLERRM;
    END;

    -- 2. If Admin, safely provision public.admin_profiles
    IF clean_role = 'Admin' THEN
        BEGIN
            -- Remove any orphan admin_profile by email with outdated auth id
            DELETE FROM public.admin_profiles WHERE email = NEW.email AND id != NEW.id;

            INSERT INTO public.admin_profiles (id, email, first_name, last_name, full_name, role)
            VALUES (NEW.id, NEW.email, first_name, last_name, full_name, 'Administrator')
            ON CONFLICT (id) DO UPDATE SET
                email = EXCLUDED.email,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                full_name = EXCLUDED.full_name,
                role = EXCLUDED.role,
                updated_at = NOW();
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'handle_new_user: Failed to insert into public.admin_profiles: %', SQLERRM;
        END;
    END IF;

    -- 3. If Faculty, connect auth_user_id on public.faculty
    IF clean_role = 'Faculty' THEN
        BEGIN
            UPDATE public.faculty
            SET auth_user_id = NEW.id, updated_at = NOW()
            WHERE email = NEW.email OR (emp_id IS NOT NULL AND employee_id = emp_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'handle_new_user: Failed to link faculty record: %', SQLERRM;
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
