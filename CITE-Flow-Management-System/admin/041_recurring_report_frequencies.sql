-- =============================================================================
-- CITE-Flow Migration 041: Recurring Report Frequencies & Schedule Extensions
--
-- Description:
--   1. Updates public.wf_report_configs frequency CHECK constraint to support all
--      six frequency options: 'twice_monthly' (and alias 'twice_a_month'),
--      'monthly', 'quarterly', 'semi_annual', 'annual', and 'custom'.
--   2. Updates reporting_period_type CHECK constraint to include 'custom' and
--      period variants.
--   3. Adds columns for twice-a-month second deadline and custom milestone schedules:
--      - due_day_2 integer (1-31)
--      - due_time_2 time without time zone
--      - custom_schedule jsonb (array of milestone objects [{label, date, time}])
--
-- Safe to re-run (idempotent with IF EXISTS and ADD COLUMN IF NOT EXISTS).
-- =============================================================================

-- 1. EXTEND REPORT CONFIG FREQUENCY CONSTRAINT
DO $$
BEGIN
    -- Drop existing check constraint if it exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'wf_report_configs_frequency_check'
          AND conrelid = 'public.wf_report_configs'::regclass
    ) THEN
        ALTER TABLE public.wf_report_configs
            DROP CONSTRAINT wf_report_configs_frequency_check;
    END IF;

    -- Add updated check constraint allowing all frequencies
    ALTER TABLE public.wf_report_configs
        ADD CONSTRAINT wf_report_configs_frequency_check
        CHECK (frequency IN (
            'twice_monthly',
            'twice_a_month',
            'monthly',
            'quarterly',
            'semi_annual',
            'annual',
            'custom'
        ));
END $$;

-- 2. EXTEND REPORTING PERIOD TYPE CONSTRAINT
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'wf_report_configs_period_check'
          AND conrelid = 'public.wf_report_configs'::regclass
    ) THEN
        ALTER TABLE public.wf_report_configs
            DROP CONSTRAINT wf_report_configs_period_check;
    END IF;

    ALTER TABLE public.wf_report_configs
        ADD CONSTRAINT wf_report_configs_period_check
        CHECK (reporting_period_type IN (
            'previous_month',
            'current_month',
            'previous_quarter',
            'current_quarter',
            'previous_semi_annual',
            'current_semi_annual',
            'previous_year',
            'current_year',
            'custom'
        ));
END $$;

-- 3. ADD SECOND DEADLINE & CUSTOM SCHEDULE COLUMNS
ALTER TABLE public.wf_report_configs
    ADD COLUMN IF NOT EXISTS due_day_2 INTEGER CHECK (due_day_2 >= 1 AND due_day_2 <= 31),
    ADD COLUMN IF NOT EXISTS due_time_2 TIME WITHOUT TIME ZONE,
    ADD COLUMN IF NOT EXISTS custom_schedule JSONB DEFAULT '[]'::jsonb;

-- Comment on columns for schema documentation
COMMENT ON COLUMN public.wf_report_configs.due_day_2 IS 'Second deadline day of month for twice_monthly frequency (1-31, clamped to month end)';
COMMENT ON COLUMN public.wf_report_configs.due_time_2 IS 'Second deadline time for twice_monthly frequency';
COMMENT ON COLUMN public.wf_report_configs.custom_schedule IS 'JSON array of milestones for custom frequency: [{label, date, time}]';
