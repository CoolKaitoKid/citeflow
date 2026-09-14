/**
 * CITE-Flow — MFO automatic data sourcing and provenance
 *
 * Single place that reads existing CITE-Flow records and maps them onto MFO
 * Performance Indicator fields. Nothing here writes to the database and
 * nothing here queries a source table from page code directly.
 *
 * Three responsibilities:
 *   1. MAP     — the auditable mapping between source tables and MFO fields.
 *   2. loadSources / buildCandidates — retrieve and shape available data.
 *   3. mergeCandidates — fill gaps without ever discarding a manual edit.
 *
 * Provenance vocabulary stored per field:
 *   system     value came from an existing CITE-Flow record
 *   manual     a user typed or corrected this value; never overwritten
 *   calculated derived by a formula or a generated column
 *   na         the user declared the field not applicable
 * A field with no recorded provenance and no value is simply missing, which
 * is what the UI offers for manual entry.
 */
(function initCiteFlowMfoSources(global) {
    'use strict';

    const PROVENANCE = {
        SYSTEM: 'system',
        MANUAL: 'manual',
        CALCULATED: 'calculated',
        NA: 'na'
    };

    /* ------------------------------------------------------------------ */
    /* Small helpers                                                       */
    /* ------------------------------------------------------------------ */

    function isBlank(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        return false;
    }

    function text(value) {
        return isBlank(value) ? '' : String(value).trim();
    }

    function isoDate(value) {
        if (isBlank(value)) return '';
        const raw = String(value);
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return '';
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${parsed.getFullYear()}-${month}-${day}`;
    }

    function authorsToText(value) {
        if (Array.isArray(value)) {
            return value
                .map((item) => (typeof item === 'string' ? item : text(item?.name)))
                .filter(Boolean)
                .join('; ');
        }
        return text(value);
    }

    /** A source row is missing from the schema cache, or the table does not exist. */
    function isMissingRelation(error) {
        if (!error) return false;
        const code = String(error.code || '').toUpperCase();
        const message = String(error.message || '').toLowerCase();
        return code === '42P01'
            || code === 'PGRST205'
            || message.includes('does not exist')
            || message.includes('schema cache');
    }

    function normalizeKey(value) {
        return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    /* ------------------------------------------------------------------ */
    /* Period matching                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Date-based period test. Undated records are reported as `undated`
     * rather than silently dropped, because an accomplishment with no date on
     * file is still a real accomplishment the chairperson may need to claim.
     */
    function periodFit(dateValue, period) {
        const iso = isoDate(dateValue);
        if (!iso) return 'undated';
        const start = isoDate(period?.period_start);
        const end = isoDate(period?.period_end);
        if (!start || !end) return 'in';
        return iso >= start && iso <= end ? 'in' : 'out';
    }

    /**
     * Faculty accomplishments only auto-fill a packet when date_achieved
     * falls inside that packet's period. Undated and out-of-period rows
     * stay source records; they are not offered as candidates.
     */
    function accomplishmentPeriodFit(row, ctx) {
        return periodFit(row?.date_achieved, ctx?.period) === 'in' ? 'in' : 'out';
    }

    function accomplishmentType(row) {
        return text(row?.accomplishment_type);
    }

    function isTrainingAccomplishment(row) {
        return /seminar|training|workshop|conference|webinar/i.test(accomplishmentType(row));
    }

    function isCertificationAccomplishment(row) {
        return /cert|licens|accredit|audit/i.test(accomplishmentType(row));
    }

    function isAwardAccomplishment(row) {
        return /award|honor|recognition|plaque|medal/i.test(
            `${accomplishmentType(row)} ${text(row?.title)}`
        );
    }

    function isOtherAccomplishment(row) {
        if (isTrainingAccomplishment(row) || isCertificationAccomplishment(row) || isAwardAccomplishment(row)) {
            return false;
        }
        return /^other$/i.test(accomplishmentType(row));
    }

    function accomplishmentPhotos(row) {
        const out = [];
        const attachments = Array.isArray(row?.photo_attachments) ? row.photo_attachments : [];
        attachments.forEach((item, index) => {
            const url = text(item?.photo_url);
            if (!url) return;
            const nameFromUrl = url.split('/').pop() || '';
            out.push({
                file_url: url,
                file_name: text(item?.title) || decodeURIComponent(nameFromUrl.split('?')[0]) || `photo-${index + 1}`,
                mfo_caption: text(item?.title) || text(item?.description),
                source_ref: `${row?.id}:${index}`
            });
        });
        if (!out.length && text(row?.proof_file_url)) {
            const url = text(row.proof_file_url);
            const nameFromUrl = url.split('/').pop() || '';
            out.push({
                file_url: url,
                file_name: decodeURIComponent(nameFromUrl.split('?')[0]) || 'proof',
                mfo_caption: text(row.title),
                source_ref: `${row?.id}:proof`
            });
        }
        return out;
    }

    function hasAccomplishmentPhotos(row) {
        return accomplishmentPhotos(row).length > 0;
    }

    function documentationFromAccomplishment(row, sectionCode, recordTable) {
        return {
            section_code: sectionCode,
            title: text(row.title),
            caption: text(row.title),
            activity_date: isoDate(row.date_achieved),
            venue: text(row.venue),
            narrative: text(row.description),
            record_table: recordTable
        };
    }

    /** Teaching-load style period test, which uses academic year and semester text. */
    function termFit(row, period) {
        const wantYear = text(period?.academic_year);
        const wantTerm = normalizeKey(period?.semester);
        const rowYear = text(row?.academic_year);
        const rowTerm = normalizeKey(row?.semester);
        if (wantYear && rowYear && wantYear !== rowYear) return 'out';
        // '1st Semester' and 'First Semester' both occur in live data.
        if (wantTerm && rowTerm) {
            const same = rowTerm === wantTerm
                || (/^(1st|first)/.test(rowTerm) && /^(1st|first)/.test(wantTerm))
                || (/^(2nd|second)/.test(rowTerm) && /^(2nd|second)/.test(wantTerm))
                || (/summer/.test(rowTerm) && /summer/.test(wantTerm));
            if (!same) return 'out';
        }
        if (!rowYear && !rowTerm) return 'undated';
        return 'in';
    }

    /* ------------------------------------------------------------------ */
    /* The mapping layer                                                   */
    /*                                                                     */
    /* Each entry declares, for one MFO Performance Indicator: the          */
    /* destination table, which existing tables can feed it, how each       */
    /* source column becomes an MFO field, and which MFO fields have no     */
    /* source anywhere and therefore always require manual entry.          */
    /* ------------------------------------------------------------------ */

    const MAP = {
        mfo1_pi3: {
            section: 'mfo1_pi3',
            indicator: 'MFO 1 · PI3',
            label: 'Enrollment, sections and advisers',
            table: 'mfo_pi3_enrollment',
            owner: 'either',
            manualOnly: [],
            sources: [{
                key: 'teaching',
                table: 'faculty_teaching_loads',
                fit: (row, ctx) => termFit(row, ctx.period),
                accept: (row) => !/archiv/i.test(text(row.status)),
                build: (row, ctx) => ({
                    section: text(row.section),
                    students_enrolled: row.total_students ?? null,
                    adviser_name: text(ctx.facultyName(row.faculty_id)),
                    adviser_faculty_id: row.faculty_id ?? null,
                    academic_year: text(row.academic_year) || text(ctx.period?.academic_year),
                    semester: text(row.semester) || text(ctx.period?.semester)
                })
            }]
        },

        mfo1_pi4: {
            section: 'mfo1_pi4',
            indicator: 'MFO 1 · PI4',
            label: 'Syllabus submission',
            table: 'mfo_pi4_syllabus',
            owner: 'either',
            manualOnly: [],
            sources: [{
                key: 'teaching',
                table: 'faculty_teaching_loads',
                fit: (row, ctx) => termFit(row, ctx.period),
                accept: (row) => !/archiv/i.test(text(row.status)),
                build: (row, ctx) => {
                    const submitted = ctx.syllabusSubmittedFor(row.faculty_id);
                    return {
                        subject_code: text(row.subject_code),
                        course_title: text(row.subject_title),
                        // Syllabus workflow submissions are per task, not per course,
                        // so this is a starting point the user confirms per course.
                        syllabus_status: submitted ? 'submitted' : null,
                        related_syllabus_submission_id: ctx.syllabusSubmissionId(row.faculty_id)
                    };
                }
            }]
        },

        mfo1_pi5: {
            section: 'mfo1_pi5',
            indicator: 'MFO 1 · PI5',
            label: 'Certifications',
            table: 'mfo_pi5_certifications',
            owner: 'faculty',
            manualOnly: ['granting_agency'],
            sources: [
                {
                    key: 'accomplishments',
                    table: 'faculty_accomplishments',
                    fit: accomplishmentPeriodFit,
                    accept: isCertificationAccomplishment,
                    build: (row) => ({
                        certification_title: text(row.title),
                        certification_nature: text(row.accomplishment_type),
                        date_granted: isoDate(row.date_achieved),
                        remarks: text(row.description)
                    })
                },
                {
                    key: 'documents',
                    table: 'faculty_documents',
                    fit: (row, ctx) => periodFit(row.uploaded_at, ctx.period),
                    accept: (row) => /cert/i.test(text(row.document_type) || text(row.category)),
                    build: (row) => ({
                        certification_title: text(row.title) || text(row.document_name),
                        certification_nature: text(row.document_type),
                        remarks: text(row.description)
                    })
                }
            ]
        },

        mfo1_pi6: {
            section: 'mfo1_pi6',
            indicator: 'MFO 1 · PI6',
            label: 'Postgraduate education',
            table: 'mfo_pi6_postgraduate',
            owner: 'faculty',
            // faculty.educational_qualification is unstructured free text and
            // migration 012 explicitly forbids parsing it into units.
            manualOnly: ['program_enrolled', 'institution_name', 'earned_units', 'current_units'],
            sources: []
        },

        mfo1_pi7: {
            section: 'mfo1_pi7',
            indicator: 'MFO 1 · PI7',
            label: 'Trainings, workshops and seminars',
            table: 'mfo_pi7_trainings',
            owner: 'faculty',
            manualOnly: ['sponsoring_agency', 'role'],
            sources: [
                {
                    key: 'accomplishments',
                    table: 'faculty_accomplishments',
                    fit: accomplishmentPeriodFit,
                    accept: isTrainingAccomplishment,
                    build: (row) => ({
                        title: text(row.title),
                        training_type: text(row.accomplishment_type),
                        activity_date: isoDate(row.date_achieved),
                        venue: text(row.venue),
                        remarks: text(row.description)
                    })
                },
                {
                    key: 'engagement',
                    table: 'engagement_logs',
                    fit: (row, ctx) => periodFit(row.activity_at, ctx.period),
                    accept: (row) => /seminar|training|workshop|conference/i.test(
                        `${text(row.activity_type)} ${text(row.activity_title)}`
                    ),
                    build: (row) => ({
                        title: text(row.activity_title),
                        training_type: text(row.activity_type),
                        activity_date: isoDate(row.activity_at),
                        venue: text(row.details?.venue) || text(row.details?.location),
                        sponsoring_agency: text(row.details?.sponsoring_agency) || text(row.details?.agency),
                        role: text(row.details?.role),
                        remarks: text(row.description)
                    })
                }
            ]
        },

        mfo1_pi8: {
            section: 'mfo1_pi8',
            indicator: 'MFO 1 · PI8',
            label: 'Instructional materials',
            table: 'mfo_pi8_instructional_materials',
            owner: 'faculty',
            manualOnly: ['material_type', 'courses_utilizing', 'ip_nature'],
            sources: [{
                key: 'documents',
                table: 'faculty_documents',
                fit: (row, ctx) => periodFit(row.uploaded_at, ctx.period),
                accept: (row) => /teaching material|instructional|module|courseware/i.test(
                    `${text(row.document_type)} ${text(row.category)}`
                ),
                build: (row, ctx) => ({
                    title: text(row.title) || text(row.document_name),
                    authors_text: text(ctx.facultyName(row.faculty_id)),
                    remarks: text(row.description)
                })
            }]
        },

        mfo3_pi1: {
            section: 'mfo3_pi1',
            indicator: 'MFO 3 · PI1',
            label: 'Research output utilised',
            table: 'mfo_research_utilized',
            owner: 'either',
            // No table records utilisation or the partner community.
            manualOnly: ['utilization_nature', 'partner_name', 'partner_address'],
            sources: []
        },

        mfo3_pi2: {
            section: 'mfo3_pi2',
            indicator: 'MFO 3 · PI2',
            label: 'Research output completed',
            table: 'mfo_research_completed',
            owner: 'either',
            manualOnly: [],
            sources: [{
                key: 'research',
                table: 'faculty_research_projects',
                fit: (row, ctx) => periodFit(row.end_date, ctx.period),
                accept: (row) => {
                    const status = text(row.status).toLowerCase();
                    return status.includes('completed') && !status.includes('and published');
                },
                build: (row, ctx) => ({
                    research_title: text(row.title),
                    proponents_text: authorsToText(row.authors) || text(ctx.facultyName(row.faculty_id)),
                    completed_at: isoDate(row.end_date),
                    research_status: text(row.status),
                    funding_source: text(row.funding_source),
                    remarks: text(row.description)
                })
            }]
        },

        mfo3_pi3: {
            section: 'mfo3_pi3',
            indicator: 'MFO 3 · PI3',
            label: 'Research output published',
            table: 'mfo_research_published',
            owner: 'either',
            // end_date is the project end, not the publication date. Reusing it
            // would invent a fact, so both publication fields stay manual.
            manualOnly: ['publication_name', 'published_at'],
            sources: [{
                key: 'research',
                table: 'faculty_research_projects',
                fit: (row, ctx) => periodFit(row.end_date, ctx.period),
                accept: (row) => {
                    const status = text(row.status).toLowerCase();
                    return status === 'published'
                        || status === 'completed and published'
                        || (status.includes('published') && !/not published|unpublished/.test(status));
                },
                build: (row, ctx) => ({
                    research_title: text(row.title),
                    proponents_text: authorsToText(row.authors) || text(ctx.facultyName(row.faculty_id)),
                    funding_source: text(row.funding_source),
                    publication_url: text(row.publication_url),
                    remarks: text(row.description)
                })
            }]
        },

        mfo3_pi4: {
            section: 'mfo3_pi4',
            indicator: 'MFO 3 · PI4',
            label: 'Research output presented',
            table: 'mfo_research_presented',
            owner: 'either',
            manualOnly: ['conference_title', 'presented_at', 'sponsoring_agency', 'venue'],
            sources: [{
                key: 'engagement',
                table: 'engagement_logs',
                fit: (row, ctx) => periodFit(row.activity_at, ctx.period),
                accept: (row) => /research/i.test(text(row.activity_type))
                    && /present|paper|colloqui|conference/i.test(
                        `${text(row.activity_title)} ${text(row.description)}`
                    ),
                build: (row, ctx) => ({
                    research_title: text(row.activity_title),
                    proponents_text: text(row.faculty_name) || text(ctx.facultyName(row.faculty_id)),
                    presented_at: isoDate(row.activity_at),
                    venue: text(row.details?.venue) || text(row.details?.location),
                    sponsoring_agency: text(row.details?.sponsoring_agency),
                    conference_title: text(row.details?.conference)
                })
            }]
        },

        mfo4_pi1: {
            section: 'mfo4_pi1',
            indicator: 'MFO 4 · PI1',
            label: 'Active extension partnerships',
            table: 'mfo_extension_partnerships',
            owner: 'either',
            manualOnly: ['partner_name', 'project_locale', 'has_moa'],
            sources: [
                {
                    key: 'documents',
                    table: 'faculty_documents',
                    fit: (row, ctx) => periodFit(row.uploaded_at, ctx.period),
                    accept: (row) => /extension|community|outreach/i.test(
                        `${text(row.category)} ${text(row.document_type)}`
                    ),
                    build: (row, ctx) => ({
                        project_title: text(row.title) || text(row.document_name),
                        proponents_text: text(ctx.facultyName(row.faculty_id)),
                        remarks: text(row.description)
                    })
                },
                {
                    key: 'engagement',
                    table: 'engagement_logs',
                    fit: (row, ctx) => periodFit(row.activity_at, ctx.period),
                    accept: (row) => /extension|community|outreach/i.test(text(row.activity_type)),
                    build: (row, ctx) => ({
                        project_title: text(row.activity_title),
                        proponents_text: text(row.faculty_name) || text(ctx.facultyName(row.faculty_id)),
                        partner_name: text(row.details?.partner) || text(row.details?.partner_name),
                        project_locale: text(row.details?.locale) || text(row.details?.venue),
                        remarks: text(row.description)
                    })
                }
            ]
        },

        mfo4_pi2: {
            section: 'mfo4_pi2',
            indicator: 'MFO 4 · PI2',
            label: 'Trainees and manhours',
            table: 'mfo_extension_trainings',
            owner: 'either',
            manualOnly: ['beneficiaries_male', 'beneficiaries_female', 'training_hours', 'partner_agency'],
            sources: [{
                key: 'engagement',
                table: 'engagement_logs',
                fit: (row, ctx) => periodFit(row.activity_at, ctx.period),
                accept: (row) => /extension|training/i.test(text(row.activity_type))
                    && /train|capacit|seminar for|livelihood/i.test(text(row.activity_title)),
                build: (row) => ({
                    training_title: text(row.activity_title),
                    partner_agency: text(row.details?.partner_agency) || text(row.details?.partner),
                    beneficiaries_male: row.details?.male ?? null,
                    beneficiaries_female: row.details?.female ?? null,
                    training_hours: row.details?.hours ?? null,
                    remarks: text(row.description)
                })
            }]
        },

        other_initiatives: {
            section: 'other_initiatives',
            indicator: 'Other initiatives',
            label: 'Other initiatives and activities',
            table: 'mfo_other_initiatives',
            owner: 'either',
            manualOnly: ['students_involved', 'student_role', 'faculty_role'],
            sources: [
                {
                    key: 'accomplishments',
                    table: 'faculty_accomplishments',
                    fit: accomplishmentPeriodFit,
                    accept: isOtherAccomplishment,
                    build: (row, ctx) => ({
                        activity_title: text(row.title),
                        category: text(row.accomplishment_type),
                        description: text(row.description),
                        activity_date: isoDate(row.date_achieved),
                        venue: text(row.venue),
                        faculty_involved: text(ctx.facultyName(row.faculty_id))
                    })
                },
                {
                    key: 'engagement',
                    table: 'engagement_logs',
                    fit: (row, ctx) => periodFit(row.activity_at, ctx.period),
                    accept: (row) => !/^(login|logout|profile|password|system)/i.test(text(row.activity_type)),
                    build: (row, ctx) => ({
                        activity_title: text(row.activity_title),
                        category: text(row.activity_type),
                        description: text(row.description),
                        activity_date: isoDate(row.activity_at),
                        venue: text(row.details?.venue) || text(row.details?.location),
                        sponsoring_agency: text(row.details?.sponsoring_agency) || text(row.details?.agency),
                        faculty_involved: text(row.faculty_name) || text(ctx.facultyName(row.faculty_id))
                    })
                }
            ]
        },

        awards: {
            section: 'awards',
            indicator: 'Awards',
            label: 'Awards received',
            table: 'mfo_awards',
            owner: 'either',
            manualOnly: ['award_nature', 'granting_agency'],
            sources: [{
                key: 'accomplishments',
                table: 'faculty_accomplishments',
                fit: accomplishmentPeriodFit,
                accept: isAwardAccomplishment,
                build: (row) => ({
                    award_title: text(row.title),
                    award_type: text(row.accomplishment_type),
                    awarded_at: isoDate(row.date_achieved),
                    remarks: text(row.description)
                })
            }]
        },

        documentation_pi7: {
            section: 'mfo1_pi7',
            indicator: 'Documentation · PI7',
            label: 'Training photo documentation',
            table: 'mfo_documentation_items',
            owner: 'faculty',
            manualOnly: ['activity_time'],
            sources: [{
                key: 'accomplishment_photos',
                table: 'faculty_accomplishments',
                fit: accomplishmentPeriodFit,
                accept: (row) => isTrainingAccomplishment(row) && hasAccomplishmentPhotos(row),
                build: (row) => documentationFromAccomplishment(row, 'mfo1_pi7', 'mfo_pi7_trainings')
            }]
        },

        documentation_pi5: {
            section: 'mfo1_pi5',
            indicator: 'Documentation · PI5',
            label: 'Certification photo documentation',
            table: 'mfo_documentation_items',
            owner: 'faculty',
            manualOnly: ['activity_time'],
            sources: [{
                key: 'accomplishment_photos',
                table: 'faculty_accomplishments',
                fit: accomplishmentPeriodFit,
                accept: (row) => isCertificationAccomplishment(row) && hasAccomplishmentPhotos(row),
                build: (row) => documentationFromAccomplishment(row, 'mfo1_pi5', 'mfo_pi5_certifications')
            }]
        },

        documentation_awards: {
            section: 'awards',
            indicator: 'Documentation · Awards',
            label: 'Award photo documentation',
            table: 'mfo_documentation_items',
            owner: 'either',
            manualOnly: ['activity_time'],
            sources: [{
                key: 'accomplishment_photos',
                table: 'faculty_accomplishments',
                fit: accomplishmentPeriodFit,
                accept: (row) => isAwardAccomplishment(row) && hasAccomplishmentPhotos(row),
                build: (row) => documentationFromAccomplishment(row, 'awards', 'mfo_awards')
            }]
        },

        documentation_other_initiatives: {
            section: 'other_initiatives',
            indicator: 'Documentation · Other',
            label: 'Other initiative photo documentation',
            table: 'mfo_documentation_items',
            owner: 'either',
            manualOnly: ['activity_time'],
            sources: [{
                key: 'accomplishment_photos',
                table: 'faculty_accomplishments',
                fit: accomplishmentPeriodFit,
                accept: (row) => isOtherAccomplishment(row) && hasAccomplishmentPhotos(row),
                build: (row) => documentationFromAccomplishment(row, 'other_initiatives', 'mfo_other_initiatives')
            }]
        },

        // Program-owned indicators. No table in CITE-Flow records licensure
        // results or graduate employment, so the chairperson enters the
        // numerators and denominators and the database computes the rates.
        mfo1_pi1: {
            section: 'mfo1_pi1',
            indicator: 'MFO 1 · PI1',
            label: 'Licensure passing percentage',
            table: 'mfo_pi1_licensure',
            owner: 'program',
            manualOnly: ['exam_date', 'first_time_takers', 'first_time_passers', 'total_takers', 'total_passers'],
            calculated: ['first_time_passing_pct', 'overall_passing_pct'],
            sources: []
        },

        mfo1_pi2: {
            section: 'mfo1_pi2',
            indicator: 'MFO 1 · PI2',
            label: 'Graduate employment',
            table: 'mfo_pi2_employment',
            owner: 'program',
            manualOnly: ['graduates_count', 'employed_count', 'reference_period'],
            calculated: ['employment_pct'],
            sources: []
        }
    };

    /** Which source tables need loading, derived from MAP so the two cannot drift. */
    function requiredSourceTables() {
        const tables = new Set();
        Object.values(MAP).forEach((def) => {
            (def.sources || []).forEach((source) => tables.add(source.table));
        });
        return Array.from(tables);
    }

    /* ------------------------------------------------------------------ */
    /* Retrieval                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Load every source table the mapping needs, in parallel, for one or more
     * faculty. A failing source is captured and reported rather than thrown,
     * so one unavailable table never prevents the rest of the MFO from
     * loading.
     *
     * @returns {Promise<{rows:Object, errors:Array, facultyById:Map}>}
     */
    async function loadSources(client, options) {
        const opts = options || {};
        const facultyIds = (Array.isArray(opts.facultyIds) ? opts.facultyIds : [opts.facultyId])
            .filter((id) => id !== null && id !== undefined && id !== '')
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id));

        const rows = {};
        const errors = [];

        if (!client || !facultyIds.length) {
            return { rows, errors, facultyById: new Map() };
        }

        const tables = requiredSourceTables();

        async function fetchTable(table) {
            try {
                const { data, error } = await client.from(table).select('*').in('faculty_id', facultyIds);
                if (error) throw error;
                rows[table] = data || [];
            } catch (error) {
                rows[table] = [];
                errors.push({
                    table,
                    missing: isMissingRelation(error),
                    message: String(error?.message || error)
                });
                console.warn('[MFO sources]', table, error);
            }
        }

        // Faculty identity, syllabus workflow state, and the mapped source tables.
        const extras = (async () => {
            try {
                const { data, error } = await client
                    .from('faculty')
                    .select('id, name, full_name, department, position, educational_qualification')
                    .in('id', facultyIds);
                if (error) throw error;
                rows.faculty = data || [];
            } catch (error) {
                rows.faculty = [];
                errors.push({ table: 'faculty', missing: false, message: String(error?.message || error) });
            }
        })();

        const syllabus = (async () => {
            try {
                const [subs, tasks] = await Promise.all([
                    client.from('wf_submissions').select('id, task_id, faculty_id, status').in('faculty_id', facultyIds),
                    client.from('wf_tasks').select('id, title, instructions, report_config_id')
                ]);
                if (subs.error) throw subs.error;
                rows.wf_submissions = subs.data || [];
                rows.wf_tasks = tasks.data || [];
            } catch (error) {
                rows.wf_submissions = [];
                rows.wf_tasks = [];
                errors.push({ table: 'wf_submissions', missing: false, message: String(error?.message || error) });
            }
        })();

        await Promise.all([...tables.map(fetchTable), extras, syllabus]);

        const facultyById = new Map((rows.faculty || []).map((row) => [String(row.id), row]));
        return { rows, errors, facultyById };
    }

    /* ------------------------------------------------------------------ */
    /* Candidate construction                                              */
    /* ------------------------------------------------------------------ */

    function buildContext(loaded, period) {
        const facultyById = loaded.facultyById || new Map();

        const syllabusTaskIds = new Set(
            (loaded.rows.wf_tasks || [])
                .filter((task) => {
                    const resolver = global.CiteFlowWorkflow?.resolveDocumentCategory;
                    if (resolver) return resolver(task) === 'Syllabus';
                    return /syllab/i.test(`${text(task.title)} ${text(task.instructions)}`);
                })
                .map((task) => String(task.id))
        );

        const acceptedStatuses = ['submitted', 'late', 'underreview', 'approved'];
        const syllabusByFaculty = new Map();
        (loaded.rows.wf_submissions || []).forEach((row) => {
            if (!syllabusTaskIds.has(String(row.task_id))) return;
            if (!acceptedStatuses.includes(text(row.status).toLowerCase())) return;
            syllabusByFaculty.set(String(row.faculty_id), row.id);
        });

        return {
            period: period || {},
            facultyName(facultyId) {
                const row = facultyById.get(String(facultyId));
                return text(row?.full_name) || text(row?.name);
            },
            syllabusSubmittedFor(facultyId) {
                return syllabusByFaculty.has(String(facultyId));
            },
            syllabusSubmissionId(facultyId) {
                return syllabusByFaculty.get(String(facultyId)) || null;
            }
        };
    }

    /**
     * Turn loaded source rows into MFO candidate records with per-field
     * provenance. Each candidate carries the identifiers needed to recognise
     * it again on a later refresh, so nothing is ever duplicated.
     */
    function buildCandidates(loaded, options) {
        const opts = options || {};
        const ctx = buildContext(loaded, opts.period);
        const includeUndated = opts.includeUndated !== false;
        const includeOutside = opts.includeOutsidePeriod === true;
        const sections = opts.sections || Object.keys(MAP);

        const out = {};

        sections.forEach((sectionCode) => {
            const def = MAP[sectionCode];
            if (!def) return;
            out[sectionCode] = [];
            const seen = new Set();

            (def.sources || []).forEach((source) => {
                (loaded.rows[source.table] || []).forEach((row) => {
                    try {
                        if (source.accept && !source.accept(row, ctx)) return;

                        const fit = source.fit ? source.fit(row, ctx) : 'in';
                        if (fit === 'out' && !includeOutside) return;
                        if (fit === 'undated' && !includeUndated) return;

                        const values = source.build(row, ctx) || {};

                        // Deduplicate: stable record identity first, then a soft
                        // title-and-date key so the same activity arriving from
                        // two modules is only offered once.
                        const idKey = `${source.table}:${row.id}`;
                        const titleValue = values.title
                            || values.activity_title
                            || values.research_title
                            || values.project_title
                            || values.training_title
                            || values.award_title
                            || values.certification_title
                            || values.course_title
                            || values.section;
                        const dateValue = values.activity_date
                            || values.date_granted
                            || values.awarded_at
                            || values.completed_at
                            || values.presented_at;
                        const softKey = `soft:${normalizeKey(titleValue)}|${isoDate(dateValue)}`;

                        if (seen.has(idKey)) return;
                        if (normalizeKey(titleValue) && seen.has(softKey)) return;
                        seen.add(idKey);
                        if (normalizeKey(titleValue)) seen.add(softKey);

                        const fields = {};
                        Object.keys(values).forEach((key) => {
                            if (isBlank(values[key])) return;
                            fields[key] = values[key];
                        });
                        if (!Object.keys(fields).length) return;

                        out[sectionCode].push({
                            section: sectionCode,
                            table: def.table,
                            sourceTable: source.table,
                            sourceId: String(row.id),
                            sourceLabel: sourceLabel(source.table),
                            facultyId: row.faculty_id ?? null,
                            periodFit: fit,
                            fields,
                            missingFields: (def.manualOnly || []).filter((key) => isBlank(fields[key]))
                        });
                    } catch (error) {
                        console.warn('[MFO sources] candidate build failed', sectionCode, source.table, error);
                    }
                });
            });
        });

        return out;
    }

    const SOURCE_LABELS = {
        faculty_teaching_loads: 'Teaching load',
        faculty_accomplishments: 'Faculty accomplishment record',
        faculty_research_projects: 'Research project record',
        faculty_documents: 'Faculty document',
        engagement_logs: 'Engagement log'
    };

    function sourceLabel(table) {
        return SOURCE_LABELS[table] || table;
    }

    /* ------------------------------------------------------------------ */
    /* Provenance on stored rows                                           */
    /* ------------------------------------------------------------------ */

    function fieldSources(row) {
        const raw = row?.field_sources;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
        return {};
    }

    function provenanceOf(row, key) {
        const sources = fieldSources(row);
        if (sources[key]) return sources[key];
        // Rows written before per-field provenance existed fall back to the
        // row-level source_kind, which is the best information available.
        if (isBlank(row?.[key])) return null;
        const kind = text(row?.source_kind);
        if (kind === 'suggested' || kind === 'imported') return PROVENANCE.SYSTEM;
        return PROVENANCE.MANUAL;
    }

    function isManual(row, key) {
        return provenanceOf(row, key) === PROVENANCE.MANUAL;
    }

    /** Record that a user typed this field, so no refresh may replace it. */
    function markManual(row, key) {
        if (!row) return row;
        const sources = fieldSources(row);
        sources[key] = PROVENANCE.MANUAL;
        row.field_sources = sources;
        row.source_kind = 'manual';
        return row;
    }

    function markNotApplicable(row, key) {
        if (!row) return row;
        const sources = fieldSources(row);
        sources[key] = PROVENANCE.NA;
        row.field_sources = sources;
        return row;
    }

    /* ------------------------------------------------------------------ */
    /* Merge                                                               */
    /* ------------------------------------------------------------------ */

    /**
     * Fold candidates into the rows already held for a section.
     *
     * Rules, in order of precedence:
     *   - A field whose provenance is manual or na is never touched.
     *   - A field that already holds a value is only refreshed when that value
     *     itself came from the system and the source now disagrees.
     *   - An empty field is filled from the candidate and marked system.
     *   - A candidate matching no existing row is appended.
     *   - Existing rows are never removed.
     *
     * @returns {{rows:Array, added:number, filled:number, refreshed:number}}
     */
    function mergeCandidates(existingRows, candidates, options) {
        const opts = options || {};
        const rows = Array.isArray(existingRows) ? existingRows.slice() : [];
        const list = Array.isArray(candidates) ? candidates : [];
        const newRowFactory = typeof opts.newRow === 'function' ? opts.newRow : () => ({});

        let added = 0;
        let filled = 0;
        let refreshed = 0;

        const byIdentity = new Map();
        rows.forEach((row, index) => {
            const table = text(row.source_table);
            const id = text(row.source_id);
            if (table && id) byIdentity.set(`${table}:${id}`, index);
        });

        list.forEach((candidate) => {
            const identity = `${candidate.sourceTable}:${candidate.sourceId}`;
            const existingIndex = byIdentity.has(identity) ? byIdentity.get(identity) : -1;

            if (existingIndex < 0) {
                const row = newRowFactory(candidate);
                const sources = fieldSources(row);
                Object.keys(candidate.fields).forEach((key) => {
                    row[key] = candidate.fields[key];
                    sources[key] = PROVENANCE.SYSTEM;
                });
                row.field_sources = sources;
                row.source_kind = 'suggested';
                row.source_table = candidate.sourceTable;
                row.source_id = candidate.sourceId;
                if (candidate.facultyId != null && isBlank(row.faculty_id)) {
                    row.faculty_id = candidate.facultyId;
                }
                rows.push(row);
                byIdentity.set(identity, rows.length - 1);
                added += 1;
                return;
            }

            const row = rows[existingIndex];
            const sources = fieldSources(row);
            Object.keys(candidate.fields).forEach((key) => {
                const provenance = provenanceOf(row, key);
                if (provenance === PROVENANCE.MANUAL || provenance === PROVENANCE.NA) return;

                const incoming = candidate.fields[key];
                if (isBlank(row[key])) {
                    row[key] = incoming;
                    sources[key] = PROVENANCE.SYSTEM;
                    filled += 1;
                } else if (
                    opts.refreshSystemValues !== false
                    && provenance === PROVENANCE.SYSTEM
                    && String(row[key]) !== String(incoming)
                ) {
                    row[key] = incoming;
                    sources[key] = PROVENANCE.SYSTEM;
                    refreshed += 1;
                }
            });
            row.field_sources = sources;
            if (isBlank(row.source_table)) row.source_table = candidate.sourceTable;
            if (isBlank(row.source_id)) row.source_id = candidate.sourceId;
        });

        return { rows, added, filled, refreshed };
    }

    /* ------------------------------------------------------------------ */
    /* Dynamic field presentation                                          */
    /*                                                                     */
    /* Used by the documentation and report renderers so a field with no   */
    /* value produces no label, no blank line and no underscore filler.    */
    /* ------------------------------------------------------------------ */

    /**
     * Build the Event Details list for one record: only entries that actually
     * hold a value, in the order the caller declares.
     *
     * @param {Object} row
     * @param {Array<{key:string,label:string,format?:Function}>} spec
     * @returns {Array<{key:string,label:string,value:string,provenance:string|null}>}
     */
    function eventDetails(row, spec) {
        if (!row || !Array.isArray(spec)) return [];
        const out = [];
        spec.forEach((entry) => {
            const provenance = provenanceOf(row, entry.key);
            if (provenance === PROVENANCE.NA) {
                out.push({ key: entry.key, label: entry.label, value: 'N/A', provenance });
                return;
            }
            const raw = row[entry.key];
            if (isBlank(raw)) return;
            const value = entry.format ? entry.format(raw, row) : String(raw);
            if (isBlank(value)) return;
            out.push({ key: entry.key, label: entry.label, value, provenance });
        });
        return out;
    }

    /** Event Details field order per MFO section, following the MFO form. */
    const DETAIL_SPECS = {
        mfo1_pi5: [
            { key: 'certification_nature', label: 'Nature of Certification' },
            { key: 'granting_agency', label: 'Granting Agency' },
            { key: 'date_granted', label: 'Date Granted' }
        ],
        mfo1_pi6: [
            { key: 'program_enrolled', label: 'Program Enrolled In' },
            { key: 'institution_name', label: 'Educational Institution' },
            { key: 'earned_units', label: 'Total Earned Units' },
            { key: 'current_units', label: 'Units This Semester' }
        ],
        mfo1_pi7: [
            { key: 'activity_date', label: 'Date' },
            { key: 'venue', label: 'Venue' },
            { key: 'sponsoring_agency', label: 'Sponsoring Agency' },
            { key: 'role', label: 'Role' }
        ],
        mfo1_pi8: [
            { key: 'material_type', label: 'Type of Instructional Material' },
            { key: 'courses_utilizing', label: 'Courses Utilizing the IMs' },
            { key: 'ip_nature', label: 'Intellectual Property Protection' }
        ],
        mfo3_pi1: [
            { key: 'utilization_nature', label: 'Nature of Utilization' },
            { key: 'partner_name', label: 'Partner Community / Industry' },
            { key: 'partner_address', label: "Address of Partner's Office" }
        ],
        mfo3_pi2: [
            { key: 'completed_at', label: 'Date Completed' },
            { key: 'research_status', label: 'Status' },
            { key: 'funding_source', label: 'Funding Source' }
        ],
        mfo3_pi3: [
            { key: 'publication_name', label: 'Name of Publication' },
            { key: 'published_at', label: 'Date Published' },
            { key: 'funding_source', label: 'Funding Source' },
            { key: 'publication_url', label: 'Publication Link' }
        ],
        mfo3_pi4: [
            { key: 'conference_title', label: 'Conference' },
            { key: 'presented_at', label: 'Date' },
            { key: 'sponsoring_agency', label: 'Sponsoring Agency' },
            { key: 'venue', label: 'Venue' }
        ],
        mfo4_pi1: [
            { key: 'partner_name', label: 'Partner Industry / Community' },
            { key: 'project_locale', label: 'Project Locale' },
            { key: 'has_moa', label: 'MOA', format: (value) => (value ? 'With MOA' : 'Without MOA') }
        ],
        mfo4_pi2: [
            { key: 'partner_agency', label: 'Partner Agency' },
            { key: 'training_hours', label: 'Length of Training (hours)' },
            { key: 'beneficiaries_total', label: 'Community Beneficiaries' },
            { key: 'beneficiaries_male', label: 'Male Beneficiaries' },
            { key: 'beneficiaries_female', label: 'Female Beneficiaries' }
        ],
        other_initiatives: [
            { key: 'activity_date', label: 'Date Conducted' },
            { key: 'venue', label: 'Venue' },
            { key: 'sponsoring_agency', label: 'Sponsoring Agency' },
            { key: 'students_involved', label: 'Students Involved' },
            { key: 'student_role', label: 'Student Role' },
            { key: 'faculty_involved', label: 'Faculty Involved' },
            { key: 'faculty_role', label: 'Faculty Role' }
        ],
        awards: [
            { key: 'award_nature', label: 'Nature of Award' },
            { key: 'granting_agency', label: 'Granting Agency' },
            { key: 'awarded_at', label: 'Date of Awarding Ceremony' }
        ]
    };

    function detailSpecFor(sectionCode) {
        return DETAIL_SPECS[sectionCode] || [];
    }

    /** Derive the display title of a record without inventing one. */
    function recordTitle(row) {
        const candidates = [
            row?.title, row?.activity_title, row?.research_title, row?.project_title,
            row?.training_title, row?.award_title, row?.certification_title,
            row?.program_enrolled, row?.course_title, row?.section, row?.caption
        ];
        for (const value of candidates) {
            if (!isBlank(value)) return text(value);
        }
        return '';
    }

    global.CiteFlowMfoSources = {
        PROVENANCE,
        MAP,
        DETAIL_SPECS,
        requiredSourceTables,
        loadSources,
        buildCandidates,
        mergeCandidates,
        fieldSources,
        provenanceOf,
        isManual,
        markManual,
        markNotApplicable,
        eventDetails,
        detailSpecFor,
        recordTitle,
        accomplishmentPhotos,
        isTrainingAccomplishment,
        isCertificationAccomplishment,
        isAwardAccomplishment,
        isOtherAccomplishment,
        // Exposed for the report and documentation renderers.
        helpers: { isBlank, text, isoDate, authorsToText, normalizeKey, periodFit, termFit, sourceLabel, accomplishmentPeriodFit }
    };
})(typeof window !== 'undefined' ? window : globalThis);
