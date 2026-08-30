-- CITE-Flow custom Forgot Password OTP
-- Run the ENTIRE script in the Supabase SQL Editor. Safe to re-run.
-- Browser never reads this table or auth.users.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  auth_user_id uuid NOT NULL,
  otp_hash text NOT NULL,
  reset_token_hash text,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email_created
  ON public.password_reset_otps (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user
  ON public.password_reset_otps (auth_user_id, created_at DESC);

ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.password_reset_otps FROM PUBLIC;
REVOKE ALL ON public.password_reset_otps FROM anon;
REVOKE ALL ON public.password_reset_otps FROM authenticated;

CREATE OR REPLACE FUNCTION public.cite_hash_reset_secret(p_value text, p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(extensions.digest(p_value || ':' || p_email || ':citeflow-otp-v1', 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.cite_find_auth_user_id(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_id uuid;
  v_auth_ok boolean := false;
BEGIN
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT u.id INTO v_id
    FROM auth.users u
    WHERE lower(trim(coalesce(u.email, ''))) = v_email
       OR lower(trim(coalesce(u.raw_user_meta_data->>'email', ''))) = v_email
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      v_auth_ok := true;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_id := NULL;
  END;

  IF v_id IS NULL THEN
    BEGIN
      SELECT i.user_id INTO v_id
      FROM auth.identities i
      WHERE lower(trim(coalesce(i.identity_data->>'email', ''))) = v_email
      LIMIT 1;
      IF v_id IS NOT NULL THEN
        v_auth_ok := true;
      END IF;
    EXCEPTION
      WHEN undefined_table OR insufficient_privilege THEN
        NULL;
    END;
  END IF;

  IF v_id IS NULL THEN
    SELECT f.auth_user_id INTO v_id
    FROM public.faculty f
    WHERE lower(trim(coalesce(f.email, ''))) = v_email
       OR lower(trim(coalesce(f.existing_email, ''))) = v_email
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    SELECT a.id INTO v_id
    FROM public.admin_profiles a
    WHERE lower(trim(coalesce(a.email, ''))) = v_email
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    BEGIN
      SELECT p.id INTO v_id
      FROM public.profiles p
      WHERE lower(trim(coalesce(p.email, ''))) = v_email
      LIMIT 1;
    EXCEPTION
      WHEN undefined_table THEN
        v_id := NULL;
    END;
  END IF;

  -- A linked profile id is a registered account. Only reject when we
  -- positively know that Auth user is missing. If auth.users is not
  -- readable here, do not fail a linked faculty/admin profile.
  IF v_id IS NOT NULL AND v_auth_ok = false THEN
    BEGIN
      IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_id) THEN
        v_auth_ok := true;
      ELSE
        RETURN NULL;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN
        v_auth_ok := true;
    END;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_password_reset_otp(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, net
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_user_id uuid;
  v_otp text;
  v_raw bytea;
  v_n bigint;
  v_recent int;
  v_last timestamptz;
  v_request_id bigint;
BEGIN
  IF v_email IS NULL OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN jsonb_build_object('error', 'invalid_email', 'message', 'Please enter a valid email address.');
  END IF;

  v_user_id := public.cite_find_auth_user_id(v_email);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_registered', 'message', 'No registered CITE-Flow account was found for this email.');
  END IF;

  SELECT count(*)::int, max(created_at)
    INTO v_recent, v_last
  FROM public.password_reset_otps
  WHERE email = v_email
    AND created_at > now() - interval '1 hour';

  IF v_last IS NOT NULL AND v_last > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object('error', 'rate_limited', 'message', 'Please wait a moment before requesting another code.');
  END IF;

  IF coalesce(v_recent, 0) >= 5 THEN
    RETURN jsonb_build_object('error', 'rate_limited', 'message', 'Too many reset requests. Try again later.');
  END IF;

  UPDATE public.password_reset_otps
  SET consumed_at = now()
  WHERE email = v_email
    AND consumed_at IS NULL;

  v_raw := extensions.gen_random_bytes(4);
  v_n := (get_byte(v_raw, 0)::bigint * 16777216)
       + (get_byte(v_raw, 1)::bigint * 65536)
       + (get_byte(v_raw, 2)::bigint * 256)
       + get_byte(v_raw, 3)::bigint;
  v_otp := lpad(((v_n % 90000000) + 10000000)::text, 8, '0');

  INSERT INTO public.password_reset_otps (
    email, auth_user_id, otp_hash, expires_at, attempts, max_attempts
  ) VALUES (
    v_email,
    v_user_id,
    public.cite_hash_reset_secret(v_otp, v_email),
    now() + interval '10 minutes',
    0,
    5
  );

  SELECT net.http_post(
    url := 'https://api.emailjs.com/api/v1.0/email/send',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'service_id', 'service_kmzgyii',
      'template_id', 'template_lzzwr4e',
      'user_id', 'VDfsAHXPAWgLCmHnk',
      'template_params', jsonb_build_object(
        'name', 'CITE-Flow User',
        'email', v_email,
        'to_email', v_email,
        'otp', v_otp,
        'verification_code', v_otp,
        'temporary_password', v_otp,
        'message', 'Your CITE-Flow password reset code is ' || v_otp || '. This code will expire in 10 minutes. If you did not request a password reset, you can ignore this email.',
        'role', 'Password reset code — expires in 10 minutes',
        'department', 'CITE-Flow'
      )
    )
  ) INTO v_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_password_reset_otp(p_email text, p_otp text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_otp text := trim(p_otp);
  v_row public.password_reset_otps%ROWTYPE;
  v_token text;
BEGIN
  IF v_otp !~ '^\d{8}$' THEN
    RETURN jsonb_build_object('error', 'invalid_otp', 'message', 'Invalid verification code.');
  END IF;

  SELECT * INTO v_row
  FROM public.password_reset_otps
  WHERE email = v_email
    AND consumed_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_otp', 'message', 'Invalid verification code.');
  END IF;

  IF v_row.expires_at <= now() THEN
    UPDATE public.password_reset_otps SET consumed_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('error', 'expired_otp', 'message', 'This verification code has expired. Please request a new one.');
  END IF;

  IF v_row.attempts >= v_row.max_attempts THEN
    UPDATE public.password_reset_otps SET consumed_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('error', 'too_many_attempts', 'message', 'Too many incorrect attempts. Please request a new code.');
  END IF;

  IF public.cite_hash_reset_secret(v_otp, v_email) <> v_row.otp_hash THEN
    UPDATE public.password_reset_otps
    SET attempts = v_row.attempts + 1
    WHERE id = v_row.id;

    IF v_row.attempts + 1 >= v_row.max_attempts THEN
      UPDATE public.password_reset_otps SET consumed_at = now() WHERE id = v_row.id;
      RETURN jsonb_build_object('error', 'too_many_attempts', 'message', 'Too many incorrect attempts. Please request a new code.');
    END IF;

    RETURN jsonb_build_object('error', 'invalid_otp', 'message', 'Invalid verification code.');
  END IF;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  UPDATE public.password_reset_otps
  SET reset_token_hash = public.cite_hash_reset_secret(v_token, v_email),
      expires_at = now() + interval '10 minutes'
  WHERE id = v_row.id;

  RETURN jsonb_build_object('ok', true, 'resetToken', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_password_reset(p_email text, p_reset_token text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_row public.password_reset_otps%ROWTYPE;
BEGIN
  IF coalesce(p_reset_token, '') = '' OR length(coalesce(p_password, '')) < 8 THEN
    RETURN jsonb_build_object('error', 'invalid_reset', 'message', 'Password reset failed. Please try again.');
  END IF;

  SELECT * INTO v_row
  FROM public.password_reset_otps
  WHERE email = v_email
    AND consumed_at IS NULL
    AND reset_token_hash IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_reset', 'message', 'Please verify the 8-digit code before resetting your password.');
  END IF;

  IF v_row.expires_at <= now() THEN
    UPDATE public.password_reset_otps SET consumed_at = now() WHERE id = v_row.id;
    RETURN jsonb_build_object('error', 'expired_otp', 'message', 'This verification code has expired. Please request a new one.');
  END IF;

  IF public.cite_hash_reset_secret(p_reset_token, v_email) <> v_row.reset_token_hash THEN
    RETURN jsonb_build_object('error', 'invalid_reset', 'message', 'Password reset failed. Please request a new code.');
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
    updated_at = now()
  WHERE id = v_row.auth_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_reset', 'message', 'Password reset failed. Please try again.');
  END IF;

  UPDATE public.password_reset_otps
  SET consumed_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cite_hash_reset_secret(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cite_find_auth_user_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_password_reset_otp(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_password_reset_otp(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_password_reset(text, text, text) TO anon, authenticated;
