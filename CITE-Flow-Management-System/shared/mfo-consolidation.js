/**
 * CITE-Flow MFO Consolidation Engine
 *
 * Core engine for compiling individual faculty MFO accomplishment submissions
 * into departmental consolidated reports and snapshots.
 *
 * Guaranteed Business Rules:
 *   1. Faculty submit their own individual MFO report.
 *   2. Consolidation includes genuine submitted reports across ALL statuses:
 *      pending review, approved, revision requested, and rejected.
 *      Preserves and displays each report's actual status and attribution.
 *   3. Faculty who have not submitted appear in analytics only; no fabricated
 *      or placeholder reports in the consolidation.
 *   4. Chairperson decides whether to include or exclude each rejected
 *      accomplishment from the consolidated report.
 *   5. Original faculty reports remain immutable; consolidation creates
 *      isolated copies without mutating faculty-owned records or input data.
 *   6. Department data isolation: only reports from the authorized department
 *      are aggregated.
 *   7. Authorization verification for Chairperson/OIC department scoping.
 */
(function initCiteFlowMfoConsolidation(global) {
    'use strict';

    function getWf() {
        if (typeof module !== 'undefined' && module.exports) {
            try {
                return require('./workflow.js');
            } catch (_) {}
        }
        return global.CiteFlowWorkflow || null;
    }

    // Standard MFO Child Tables (Dual & Faculty-owned)
    const MFO_SECTIONS = [
        { table: 'mfo_pi3_enrollment', code: 'mfo1_pi3', group: 'MFO 1 — Higher Education Services', title: 'PI3 — Enrollment' },
        { table: 'mfo_pi4_syllabus', code: 'mfo1_pi4', group: 'MFO 1 — Higher Education Services', title: 'PI4 — Syllabus' },
        { table: 'mfo_pi5_certifications', code: 'mfo1_pi5', group: 'MFO 1 — Higher Education Services', title: 'PI5 — Certifications' },
        { table: 'mfo_pi6_postgraduate', code: 'mfo1_pi6', group: 'MFO 1 — Higher Education Services', title: 'PI6 — Postgraduate' },
        { table: 'mfo_pi7_trainings', code: 'mfo1_pi7', group: 'MFO 1 — Higher Education Services', title: 'PI7 — Trainings' },
        { table: 'mfo_pi8_instructional_materials', code: 'mfo1_pi8', group: 'MFO 1 — Higher Education Services', title: 'PI8 — Instructional Materials' },
        { table: 'mfo_research_utilized', code: 'mfo3_pi1', group: 'MFO 3 — Research', title: 'PI1 — Research Utilized' },
        { table: 'mfo_research_completed', code: 'mfo3_pi2', group: 'MFO 3 — Research', title: 'PI2 — Research Completed' },
        { table: 'mfo_research_published', code: 'mfo3_pi3', group: 'MFO 3 — Research', title: 'PI3 — Research Published' },
        { table: 'mfo_research_presented', code: 'mfo3_pi4', group: 'MFO 3 — Research', title: 'PI4 — Research Presented' },
        { table: 'mfo_extension_partnerships', code: 'mfo4_pi1', group: 'MFO 4 — Technical Advisory Extension', title: 'PI1 — Active Partnerships' },
        { table: 'mfo_extension_trainings', code: 'mfo4_pi2', group: 'MFO 4 — Technical Advisory Extension', title: 'PI2 — Trainees & Manhours' },
        { table: 'mfo_other_initiatives', code: 'other_initiatives', group: 'Other Initiatives', title: 'Other Initiatives' },
        { table: 'mfo_awards', code: 'awards', group: 'College Awards', title: 'Awards & Recognitions' },
        { table: 'mfo_documentation_items', code: 'documentation_other', group: 'Documentation', title: 'Supporting Documentation' }
    ];

    const VALID_SUBMITTED_STATUSES = new Set([
        'submitted', 'underreview', 'approved', 'revision', 'rejected', 'late'
    ]);

    /* ------------------------------------------------------------------ */
    /* Utility Helpers                                                    */
    /* ------------------------------------------------------------------ */

    function norm(value) {
        return String(value ?? '').trim().toLowerCase();
    }

    function normalizeDepartment(value) {
        const wf = getWf();
        if (wf?.facultyDepartmentCode && typeof value === 'object') {
            return wf.facultyDepartmentCode(value);
        }
        const str = norm(typeof value === 'object' ? (value?.department_code || value?.department || '') : value);
        return str.replace(/\s+department$/i, '').trim();
    }

    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (Array.isArray(obj)) return obj.map(deepClone);
        const copy = {};
        for (const key of Object.keys(obj)) {
            copy[key] = deepClone(obj[key]);
        }
        return copy;
    }

    function formatStatus(status, stage) {
        const s = norm(status);
        const st = norm(stage);
        if (s === 'approved' || st === 'approved') return 'Approved';
        if (s === 'revision' || st === 'revision') return 'Needs Revision';
        if (s === 'rejected' || st === 'declined') return 'Declined';
        if (st === 'final_approver' || st === 'final') return 'Chairperson Approved (Pending Final)';
        if (s === 'late') return 'Submitted (Late)';
        if (s === 'underreview' || s === 'submitted') return 'Pending Review';
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
    }

    /* ------------------------------------------------------------------ */
    /* Genuine Submission & Faculty Filtering                            */
    /* ------------------------------------------------------------------ */

    /**
     * Test whether a submission record represents a genuine submission.
     * Excludes unsubmitted drafts and draft MFO packets.
     */
    function isGenuineSubmittedReport(submission, packet) {
        if (!submission) return false;
        if (submission.packet_state === 'draft' || submission.is_draft === true) return false;
        if (packet && packet.packet_state === 'draft' && !submission.submitted_at) return false;

        const status = norm(submission.status);
        if (status === 'notsubmitted' || status === 'draft') return false;
        if (submission.submitted_at) return true;
        if (!status && !submission.id) return false;
        return VALID_SUBMITTED_STATUSES.has(status);
    }

    /**
     * Resolve the latest genuine submission for each faculty member.
     * Deterministic sort: submitted_at DESC, updated_at DESC, created_at DESC, id DESC.
     */
    function resolveLatestFacultySubmission(submissions, taskId, facultyId) {
        const wf = getWf();
        if (wf?.selectLatestSubmission) {
            return wf.selectLatestSubmission(submissions, taskId, facultyId);
        }
        const matches = (Array.isArray(submissions) ? submissions : []).filter((s) =>
            s && String(s.task_id) === String(taskId) && String(s.faculty_id) === String(facultyId)
        );
        if (!matches.length) return null;

        const genuine = matches.filter((s) => isGenuineSubmittedReport(s));
        const list = genuine.length ? genuine : matches;

        return list.slice().sort((a, b) => {
            const timeA = new Date(a.submitted_at || a.updated_at || a.created_at || 0).getTime();
            const timeB = new Date(b.submitted_at || b.updated_at || b.created_at || 0).getTime();
            if (timeB !== timeA) return timeB - timeA;
            return String(b.id || '').localeCompare(String(a.id || ''));
        })[0] || null;
    }

    /* ------------------------------------------------------------------ */
    /* Exclusion Representation Helpers                                   */
    /* ------------------------------------------------------------------ */

    /**
     * Safely extract excluded accomplishment IDs from an arbitrary source.
     * Supports Set, Array, snapshot JSON payload, or backward-compatible metadata.
     * NEVER overwrites or corrupts plain-text notes.
     */
    function extractExcludedAccomplishmentIds(source) {
        if (!source) return new Set();
        if (source instanceof Set) return new Set(source);
        if (Array.isArray(source)) return new Set(source.map(String));

        if (typeof source === 'object') {
            const meta = source.metadata || source.citeflow_mfo_consolidation || source;
            const ids = meta.excluded_accomplishments || meta.excludedAccomplishmentIds || meta.excluded_accomplishment_ids;
            if (Array.isArray(ids)) return new Set(ids.map(String));
            if (ids instanceof Set) return new Set(ids);
        }

        if (typeof source === 'string') {
            const trimmed = source.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    return extractExcludedAccomplishmentIds(parsed);
                } catch (_) {}
            }
        }

        return new Set();
    }

    /**
     * Create backward-compatible exclusion metadata structure.
     */
    function formatExclusionMetadata(excludedIds) {
        const ids = Array.from(extractExcludedAccomplishmentIds(excludedIds));
        return {
            citeflow_mfo_consolidation: {
                version: 1,
                excluded_accomplishments: ids,
                count: ids.length,
                updated_at: new Date().toISOString()
            }
        };
    }

    /**
     * Safely merge CITE-Flow consolidation metadata into an existing notes field.
     * Preserves:
     *   1. Human-authored plain-text remarks (stored in notes_text).
     *   2. Unrelated top-level metadata keys from other features/tools.
     *   3. Acknowledgment history across multiple repeated decision cycles.
     */
    function mergeNotesMetadata(existingNotes, consolidationMeta) {
        let base = {};
        let humanNote = null;

        if (typeof existingNotes === 'string' && existingNotes.trim()) {
            const trimmed = existingNotes.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    base = JSON.parse(trimmed);
                } catch (_) {
                    humanNote = existingNotes;
                }
            } else {
                humanNote = existingNotes;
            }
        } else if (typeof existingNotes === 'object' && existingNotes !== null) {
            base = deepClone(existingNotes);
        }

        if (humanNote && !base.notes_text) {
            base.notes_text = humanNote;
        }

        const existingConsolidation = base.citeflow_mfo_consolidation || {};
        const ackHistory = Array.isArray(existingConsolidation.acknowledgment_history)
            ? [...existingConsolidation.acknowledgment_history]
            : [];

        if (existingConsolidation.acknowledgment && consolidationMeta?.acknowledgment) {
            ackHistory.push(existingConsolidation.acknowledgment);
        }

        base.citeflow_mfo_consolidation = {
            version: 1,
            ...existingConsolidation,
            ...consolidationMeta,
            updated_at: new Date().toISOString()
        };

        if (ackHistory.length > 0) {
            base.citeflow_mfo_consolidation.acknowledgment_history = ackHistory;
        }

        return base;
    }

    /* ------------------------------------------------------------------ */
    /* Authorization Boundary Helpers                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Verify whether an actor faculty has active Chairperson or OIC authorization
     * for the target department.
     *
     * @param {object} actorFaculty - The authenticated user's faculty profile
     * @param {string} targetDepartment - Department code being consolidated (e.g. 'BSIT')
     * @param {Array} delegatedAccess - Array of wf_delegated_access records
     * @returns {{ authorized: boolean, role: string, reason?: string, authorizedDepartments: string[] }}
     */
    function verifyChairpersonDepartmentAccess(actorFaculty, targetDepartment, delegatedAccess) {
        const wf = getWf();
        const normTarget = normalizeDepartment(targetDepartment);

        if (!actorFaculty) {
            return {
                authorized: false,
                role: 'unauthenticated',
                reason: 'Authentication required. No active faculty actor provided.',
                authorizedDepartments: []
            };
        }

        if (wf?.isWorkflowAdmin && wf.isWorkflowAdmin(actorFaculty)) {
            return {
                authorized: true,
                role: 'admin',
                authorizedDepartments: ['*']
            };
        }

        let authorizedDepts = [];
        if (wf?.chairpersonAuthorizedDepartments) {
            authorizedDepts = wf.chairpersonAuthorizedDepartments(actorFaculty, delegatedAccess) || [];
        } else {
            const ownDept = normalizeDepartment(actorFaculty);
            const isChair = norm(actorFaculty.role).includes('chair') || norm(actorFaculty.position).includes('chair');
            if (isChair && ownDept) authorizedDepts = [ownDept];
        }

        const normalizedAuthorized = authorizedDepts.map(normalizeDepartment);
        const isAuthorized = normalizedAuthorized.includes(normTarget);

        if (!isAuthorized) {
            return {
                authorized: false,
                role: 'unauthorized',
                reason: `Faculty "${actorFaculty.full_name || actorFaculty.name || actorFaculty.id}" is not an authorized Chairperson or OIC for department "${targetDepartment}".`,
                authorizedDepartments: normalizedAuthorized
            };
        }

        const ownDept = normalizeDepartment(actorFaculty);
        const role = ownDept === normTarget ? 'chairperson' : 'oic';

        return {
            authorized: true,
            role,
            authorizedDepartments: normalizedAuthorized
        };
    }

    /* ------------------------------------------------------------------ */
    /* Core Consolidation Engine                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Pure, non-destructive aggregation function that builds the consolidated
     * MFO report model for a specific task and department.
     *
     * @param {object} params
     * @param {string} params.taskId - Target MFO task ID
     * @param {string} params.department - Department to consolidate (e.g. 'BSIT')
     * @param {Array}  params.submissions - wf_submissions records
     * @param {Array}  params.packets - mfo_packets records
     * @param {Array}  params.facultyList - All faculty profiles
     * @param {Array}  [params.assignments] - Optional wf_task_assignments for expected tracking
     * @param {object} [params.childRows] - Map of child table names -> array of rows
     * @param {object} [params.programPacket] - Existing mfo_program_packets record (if any)
     * @param {object} [params.programRows] - Program-owned rows: { pi1: [], pi2: [] }
     * @param {Set|Array|object} [params.excludedAccomplishmentIds] - Chairperson exclusion choices
     * @param {object} [params.options] - Optional settings (e.g. reportingPeriod)
     * @returns {object} Structured consolidated report model
     */
    function buildDepartmentMfoConsolidation(params) {
        const p = params || {};
        const taskId = String(p.taskId || '').trim();
        const targetDept = normalizeDepartment(p.department);

        if (!taskId) throw new Error('taskId is required for MFO consolidation.');
        if (!targetDept) throw new Error('department is required for MFO consolidation.');

        const submissions = Array.isArray(p.submissions) ? p.submissions : [];
        const packets = Array.isArray(p.packets) ? p.packets : [];
        const facultyList = Array.isArray(p.facultyList) ? p.facultyList : [];
        const assignments = Array.isArray(p.assignments) ? p.assignments : [];
        const childRows = p.childRows && typeof p.childRows === 'object' ? p.childRows : {};
        const programPacket = p.programPacket || null;
        const programRows = p.programRows || { pi1: [], pi2: [] };
        const excludedIds = extractExcludedAccomplishmentIds(p.excludedAccomplishmentIds || programPacket?.notes);

        // Faculty lookup map by string ID
        const facultyMap = new Map();
        facultyList.forEach((f) => {
            if (f && f.id != null) facultyMap.set(String(f.id), f);
        });

        // Packet lookup maps
        const packetBySubId = new Map();
        const packetById = new Map();
        const packetByTaskAndFaculty = new Map();
        packets.forEach((pkt) => {
            if (!pkt) return;
            if (pkt.id) packetById.set(String(pkt.id), pkt);
            if (pkt.submission_id) packetBySubId.set(String(pkt.submission_id), pkt);
            if (pkt.task_id && pkt.faculty_id != null) {
                packetByTaskAndFaculty.set(`${pkt.task_id}_${pkt.faculty_id}`, pkt);
            }
        });

        // Step 1: Identify all department faculty
        const deptFacultyMap = new Map();
        facultyList.forEach((fac) => {
            if (!fac || fac.id == null) return;
            if (normalizeDepartment(fac) === targetDept) {
                deptFacultyMap.set(String(fac.id), fac);
            }
        });

        // Step 2: Identify task assignments for this department (Expected Faculty)
        const expectedFacultyIds = new Set();
        assignments.forEach((assign) => {
            if (!assign || String(assign.task_id) !== taskId) return;
            const fid = String(assign.faculty_id);
            if (deptFacultyMap.has(fid)) {
                expectedFacultyIds.add(fid);
            }
        });

        // Step 3: Filter genuine submitted reports for target task and department
        const contributingFaculty = [];
        const contributingFacultyIds = new Set();
        const contributingPacketIds = new Set();
        const contributingSubmissions = [];
        const statusCounts = {
            approved: 0,
            pending: 0,
            revision: 0,
            rejected: 0,
            late: 0
        };

        // Group submissions by faculty for this task
        const taskSubsByFaculty = new Map();
        submissions.forEach((sub) => {
            if (!sub || String(sub.task_id) !== taskId || sub.faculty_id == null) return;
            const fid = String(sub.faculty_id);
            if (!taskSubsByFaculty.has(fid)) taskSubsByFaculty.set(fid, []);
            taskSubsByFaculty.get(fid).push(sub);
        });

        // Also check packets where faculty belongs to this department
        const candidateFacultyIds = new Set([
            ...deptFacultyMap.keys(),
            ...expectedFacultyIds
        ]);

        candidateFacultyIds.forEach((fid) => {
            const fac = facultyMap.get(fid) || { id: fid, full_name: `Faculty #${fid}`, department: targetDept };
            const facSubs = taskSubsByFaculty.get(fid) || [];
            const latestSub = resolveLatestFacultySubmission(facSubs, taskId, fid);
            const pkt = (latestSub && packetBySubId.get(String(latestSub.id)))
                || packetByTaskAndFaculty.get(`${taskId}_${fid}`)
                || null;

            // RULE 3: Exclude faculty who have not submitted.
            // Draft packets with no genuine submission are NOT included.
            if (!latestSub || !isGenuineSubmittedReport(latestSub, pkt)) {
                return;
            }

            // Verify department matches
            const subDept = normalizeDepartment(fac);
            if (subDept !== targetDept) {
                return;
            }

            const rawStatus = norm(latestSub.status);
            const approvalStage = norm(latestSub.approval_stage);

            let reviewStatusKey = 'pending';
            if (rawStatus === 'rejected' || approvalStage === 'declined') {
                reviewStatusKey = 'rejected';
            } else if (rawStatus === 'revision' || approvalStage === 'revision') {
                reviewStatusKey = 'revision';
            } else if (rawStatus === 'approved' || approvalStage === 'approved') {
                reviewStatusKey = 'approved';
            } else {
                reviewStatusKey = 'pending';
            }

            if (latestSub.is_late || rawStatus === 'late' || latestSub.submitted_status === 'late') {
                statusCounts.late += 1;
            }
            statusCounts[reviewStatusKey] = (statusCounts[reviewStatusKey] || 0) + 1;

            const contrib = {
                facultyId: fac.id,
                facultyName: fac.full_name || fac.name || `Faculty #${fac.id}`,
                employeeId: fac.employee_id || null,
                department: targetDept,
                rank: fac.academic_rank || fac.position || null,
                submissionId: latestSub.id,
                packetId: pkt?.id || null,
                submissionStatus: reviewStatusKey,
                rawStatus: latestSub.status,
                approvalStage: latestSub.approval_stage,
                statusLabel: formatStatus(latestSub.status, latestSub.approval_stage),
                submittedAt: latestSub.submitted_at || null,
                isRejected: reviewStatusKey === 'rejected'
            };

            contributingFaculty.push(contrib);
            contributingFacultyIds.add(fid);
            if (pkt?.id) contributingPacketIds.add(String(pkt.id));
            contributingSubmissions.push(latestSub);
        });

        // Unsubmitted faculty list (for analytics alignment, never as fabricated records)
        const unsubmittedFaculty = [];
        expectedFacultyIds.forEach((fid) => {
            if (!contributingFacultyIds.has(fid)) {
                const fac = facultyMap.get(fid) || { id: fid, full_name: `Faculty #${fid}`, department: targetDept };
                unsubmittedFaculty.push({
                    facultyId: fac.id,
                    facultyName: fac.full_name || fac.name || `Faculty #${fac.id}`,
                    employeeId: fac.employee_id || null,
                    department: targetDept
                });
            }
        });

        // Step 4: Aggregate child tables across contributing packets
        const sections = {};
        const activeSections = {};
        let totalItemsCount = 0;
        let activeItemsCount = 0;
        let excludedItemsCount = 0;

        // Build quick lookup for contributing packet & faculty by packet_id / faculty_id
        const contribByPacketId = new Map();
        const contribByFacultyId = new Map();
        contributingFaculty.forEach((c) => {
            if (c.packetId) contribByPacketId.set(String(c.packetId), c);
            contribByFacultyId.set(String(c.facultyId), c);
        });

        MFO_SECTIONS.forEach((secDef) => {
            const tableName = secDef.table;
            const secCode = secDef.code;
            const rawRows = childRows[tableName] || childRows[secCode] || [];
            const safeRows = Array.isArray(rawRows) ? rawRows : [];

            const consolidatedSectionRows = [];
            const activeSectionRows = [];

            safeRows.forEach((row) => {
                if (!row) return;

                // Match row to contributing faculty submission
                const rowPktId = row.packet_id != null ? String(row.packet_id) : '';
                const rowFacId = row.faculty_id != null ? String(row.faculty_id) : '';
                const match = (rowPktId && contribByPacketId.get(rowPktId))
                    || (rowFacId && contribByFacultyId.get(rowFacId))
                    || null;

                // Skip rows belonging to non-contributing or different department faculty
                if (!match) return;

                // Non-destructive copy
                const item = deepClone(row);
                const rowId = item.id != null ? String(item.id) : `${tableName}_${consolidatedSectionRows.length}`;

                // Rule 4: Detect if accomplishment is rejected
                const rowIsRejected = match.isRejected
                    || norm(item.status) === 'rejected'
                    || norm(item.review_status) === 'rejected'
                    || item.is_rejected === true;

                // Rule 4: Exclude if Chairperson marked for exclusion
                const isExcluded = rowIsRejected && excludedIds.has(rowId);

                // Attach provenance and display metadata
                item._source = {
                    table: tableName,
                    sectionCode: secCode,
                    sourceRowId: rowId,
                    facultyId: match.facultyId,
                    facultyName: match.facultyName,
                    department: match.department,
                    submissionId: match.submissionId,
                    packetId: match.packetId,
                    submissionStatus: match.submissionStatus,
                    statusLabel: match.statusLabel,
                    isRejected: rowIsRejected,
                    isExcluded: isExcluded
                };

                // Standardized attribution fields for table display
                item.contributing_faculty_name = match.facultyName;
                item.contributing_status_label = match.statusLabel;
                item.is_excluded = isExcluded;
                item.is_rejected = rowIsRejected;

                totalItemsCount += 1;
                consolidatedSectionRows.push(item);

                if (!isExcluded) {
                    activeItemsCount += 1;
                    activeSectionRows.push(item);
                } else {
                    excludedItemsCount += 1;
                }
            });

            sections[secCode] = consolidatedSectionRows;
            sections[tableName] = consolidatedSectionRows;
            activeSections[secCode] = activeSectionRows;
            activeSections[tableName] = activeSectionRows;
        });

        // Step 5: Process Program-Level Portion (PI1, PI2, and Program Narrative)
        const cleanProgramRows = {
            pi1: deepClone(Array.isArray(programRows.pi1) ? programRows.pi1 : []),
            pi2: deepClone(Array.isArray(programRows.pi2) ? programRows.pi2 : [])
        };

        const programPortion = {
            pi1: cleanProgramRows.pi1,
            pi2: cleanProgramRows.pi2,
            other_accomplishments: String(programPacket?.other_accomplishments || p.options?.other_accomplishments || ''),
            other_accomplishments_not_applicable: !!(programPacket?.other_accomplishments_not_applicable || p.options?.other_accomplishments_not_applicable)
        };

        // Step 6: Reporting Period Resolution
        const reportingPeriod = {
            reporting_year: programPacket?.reporting_year || p.options?.reporting_year || (new Date().getFullYear()),
            quarter: programPacket?.quarter || p.options?.quarter || 1,
            period_start: programPacket?.period_start || p.options?.period_start || null,
            period_end: programPacket?.period_end || p.options?.period_end || null,
            period_label: programPacket?.period_label || p.options?.period_label || null,
            academic_year: programPacket?.academic_year || p.options?.academic_year || null,
            semester: programPacket?.semester || p.options?.semester || null
        };

        // Step 7: Build structured snapshot payload (ready for mfo_snapshots)
        const frozenPayload = {
            metadata: {
                version: 1,
                taskId,
                department: targetDept,
                consolidated_at: new Date().toISOString(),
                contributing_faculty_count: contributingFaculty.length,
                total_expected_faculty: expectedFacultyIds.size || (contributingFaculty.length + unsubmittedFaculty.length),
                excluded_accomplishment_ids: Array.from(excludedIds)
            },
            reporting_period: reportingPeriod,
            contributing_faculty: contributingFaculty,
            program_portion: programPortion,
            sections: activeSections,
            all_sections: sections,
            summary: {
                expected: expectedFacultyIds.size || (contributingFaculty.length + unsubmittedFaculty.length),
                submitted: contributingFaculty.length,
                not_submitted: unsubmittedFaculty.length,
                statusCounts,
                totalItemsCount,
                activeItemsCount,
                excludedItemsCount
            }
        };

        return {
            taskId,
            department: targetDept,
            departmentDisplay: targetDept.toUpperCase(),
            reportingPeriod,
            contributingFaculty,
            unsubmittedFaculty,
            sections,
            activeSections,
            programPortion,
            summary: {
                totalExpectedFaculty: expectedFacultyIds.size || (contributingFaculty.length + unsubmittedFaculty.length),
                contributingFacultyCount: contributingFaculty.length,
                unsubmittedFacultyCount: unsubmittedFaculty.length,
                totalItemsCount,
                activeItemsCount,
                excludedItemsCount,
                statusCounts
            },
            excludedAccomplishmentIds: excludedIds,
            frozenPayload
        };
    }

    /**
     * Helper to toggle accomplishment exclusion without mutating the original set.
     *
     * @param {Set|Array} currentExclusions - Current set of excluded IDs
     * @param {string} accomplishmentId - ID to toggle
     * @param {boolean} [explicitState] - Explicit true to exclude, false to include
     * @returns {Set} New Set with updated exclusions
     */
    function toggleAccomplishmentExclusion(currentExclusions, accomplishmentId, explicitState) {
        const next = extractExcludedAccomplishmentIds(currentExclusions);
        const id = String(accomplishmentId);
        if (explicitState === true) {
            next.add(id);
        } else if (explicitState === false) {
            next.delete(id);
        } else {
            if (next.has(id)) next.delete(id);
            else next.add(id);
        }
        return next;
    }

    /* ------------------------------------------------------------------ */
    /* Stale Draft Detection Engine (Phase 5.2)                            */
    /* ------------------------------------------------------------------ */

    /**
     * Detects whether a department's consolidated draft is stale due to new
     * or updated faculty submissions.
     *
     * Pure, non-destructive function:
     *   1. Compares only records belonging to the specified task and department.
     *   2. Considers genuine submissions and revisions, not draft-only packets.
     *   3. Detects new submissions, modified timestamps, changed status, and revisions.
     *   4. Handles missing timestamps and missing draft state safely (returns 'unknown' or 'no_draft').
     *   5. Never mutates input records, snapshots, or submissions.
     *
     * @param {object} params
     * @param {string} params.taskId - Target MFO task ID
     * @param {string} params.department - Target department code (e.g. 'BSIT')
     * @param {object} [params.draft] - Existing consolidated draft (build result, snapshot, or programPacket)
     * @param {object} [params.programPacket] - mfo_program_packets row
     * @param {object} [params.draftSnapshot] - mfo_snapshots row for draft
     * @param {Array}  params.submissions - wf_submissions records
     * @param {Array}  [params.packets] - mfo_packets records
     * @param {Array}  params.facultyList - faculty profiles
     * @param {object} [params.acknowledgment] - Acknowledgment record if Chairperson previously retained draft
     * @param {object} [params.actorFaculty] - Optional faculty actor for authorization verification
     * @param {Array}  [params.delegatedAccess] - Optional delegated access grants
     * @returns {object} Staleness report
     */
    function detectConsolidatedDraftStaleness(params) {
        const p = params || {};
        const taskId = String(p.taskId || p.task?.id || '').trim();
        const targetDept = normalizeDepartment(p.department || p.task?.department);

        if (!taskId) {
            return {
                isStale: false,
                isUnknown: true,
                status: 'unknown',
                draftGeneratedAt: null,
                reasons: ['taskId is required to evaluate draft staleness.'],
                newerSubmissions: [],
                contributingCount: 0,
                currentEligibleCount: 0,
                acknowledged: false
            };
        }
        if (!targetDept) {
            return {
                isStale: false,
                isUnknown: true,
                status: 'unknown',
                draftGeneratedAt: null,
                reasons: ['department is required to evaluate draft staleness.'],
                newerSubmissions: [],
                contributingCount: 0,
                currentEligibleCount: 0,
                acknowledged: false
            };
        }

        // Authorization check if actor provided
        if (p.actorFaculty) {
            const auth = verifyChairpersonDepartmentAccess(p.actorFaculty, targetDept, p.delegatedAccess || []);
            if (!auth.authorized) {
                return {
                    isStale: false,
                    isUnknown: true,
                    status: 'unauthorized',
                    draftGeneratedAt: null,
                    reasons: [auth.reason || 'Unauthorized access for this department.'],
                    newerSubmissions: [],
                    contributingCount: 0,
                    currentEligibleCount: 0,
                    acknowledged: false
                };
            }
        }

        const draft = p.draft || p.programPacket || p.draftSnapshot || null;
        const submissions = Array.isArray(p.submissions) ? p.submissions : [];
        const packets = Array.isArray(p.packets) ? p.packets : [];
        const facultyList = Array.isArray(p.facultyList) ? p.facultyList : [];

        // 1. Missing draft state (Requirement 4)
        if (!draft) {
            return {
                isStale: false,
                isUnknown: false,
                status: 'no_draft',
                draftGeneratedAt: null,
                reasons: ['No existing consolidated draft found for this department and task.'],
                newerSubmissions: [],
                contributingCount: 0,
                currentEligibleCount: 0,
                acknowledged: false
            };
        }

        // Faculty map by string ID
        const facultyMap = new Map();
        facultyList.forEach((f) => {
            if (f && f.id != null) facultyMap.set(String(f.id), f);
        });

        // 2. Resolve draft generation timestamp
        let draftPayload = draft.frozenPayload || draft.payload || (draft.sections ? draft : null);
        if (typeof draftPayload === 'string') {
            try { draftPayload = JSON.parse(draftPayload); } catch (_) {}
        }
        const draftMeta = draftPayload?.metadata || draft.metadata || null;

        let draftTimestampRaw = draftMeta?.consolidated_at
            || draftPayload?.metadata?.consolidated_at
            || draft.consolidated_at
            || draft.updated_at
            || draft.created_at
            || (p.draftSnapshot && (p.draftSnapshot.created_at || p.draftSnapshot.updated_at))
            || (p.programPacket && (p.programPacket.updated_at || p.programPacket.created_at))
            || null;

        // Try notes JSON if string
        if (!draftTimestampRaw && typeof draft.notes === 'string' && draft.notes.trim().startsWith('{')) {
            try {
                const parsedNotes = JSON.parse(draft.notes.trim());
                const meta = parsedNotes.citeflow_mfo_consolidation || parsedNotes.metadata || parsedNotes;
                if (meta?.consolidated_at || meta?.updated_at) {
                    draftTimestampRaw = meta.consolidated_at || meta.updated_at;
                }
            } catch (_) {}
        }

        let draftTime = null;
        if (draftTimestampRaw) {
            const parsed = new Date(draftTimestampRaw).getTime();
            if (Number.isFinite(parsed) && parsed > 0) {
                draftTime = parsed;
            }
        }

        // 3. Extract captured contributing faculty from draft
        let capturedFacultyList = draftPayload?.contributing_faculty
            || draft.contributingFaculty
            || draft.contributing_faculty
            || draftMeta?.contributing_faculty
            || draftMeta?.contributingFaculty
            || null;

        if (!capturedFacultyList && typeof draft.notes === 'string' && draft.notes.trim().startsWith('{')) {
            try {
                const parsedNotes = JSON.parse(draft.notes.trim());
                const meta = parsedNotes.citeflow_mfo_consolidation || parsedNotes.metadata || parsedNotes;
                if (meta?.contributing_faculty || meta?.contributingFaculty) {
                    capturedFacultyList = meta.contributing_faculty || meta.contributingFaculty;
                }
            } catch (_) {}
        }

        // If draft timestamp is missing OR (both timestamp and captured faculty are missing),
        // we cannot determine freshness reliably (Requirement 4)
        if (draftTime === null && (!capturedFacultyList || !Array.isArray(capturedFacultyList))) {
            return {
                isStale: false,
                isUnknown: true,
                status: 'unknown',
                draftGeneratedAt: draftTimestampRaw,
                reasons: ['Draft generation timestamp and contributing faculty records are missing or invalid. Source state cannot be verified reliably.'],
                newerSubmissions: [],
                contributingCount: 0,
                currentEligibleCount: 0,
                acknowledged: false
            };
        }

        // Map captured submissions: facultyId -> captured record
        const capturedMap = new Map();
        if (Array.isArray(capturedFacultyList)) {
            capturedFacultyList.forEach((c) => {
                if (!c || c.facultyId == null) return;
                capturedMap.set(String(c.facultyId), {
                    facultyId: c.facultyId,
                    facultyName: c.facultyName || `Faculty #${c.facultyId}`,
                    submissionId: c.submissionId != null ? String(c.submissionId) : null,
                    packetId: c.packetId != null ? String(c.packetId) : null,
                    submissionStatus: c.submissionStatus || null,
                    rawStatus: c.rawStatus || null,
                    approvalStage: c.approvalStage || null,
                    submittedAt: c.submittedAt || null,
                    resubmissionCount: c.resubmissionCount || c.resubmission_count || 0
                });
            });
        }

        // 4. Gather current eligible submissions for specified task and department
        // Packet lookup maps
        const packetBySubId = new Map();
        const packetByTaskAndFaculty = new Map();
        packets.forEach((pkt) => {
            if (!pkt) return;
            if (pkt.submission_id) packetBySubId.set(String(pkt.submission_id), pkt);
            if (pkt.task_id && pkt.faculty_id != null) {
                packetByTaskAndFaculty.set(`${pkt.task_id}_${pkt.faculty_id}`, pkt);
            }
        });

        // Group submissions by faculty for this task
        const taskSubsByFaculty = new Map();
        submissions.forEach((sub) => {
            if (!sub || String(sub.task_id) !== taskId || sub.faculty_id == null) return;
            const fid = String(sub.faculty_id);
            if (!taskSubsByFaculty.has(fid)) taskSubsByFaculty.set(fid, []);
            taskSubsByFaculty.get(fid).push(sub);
        });

        const currentEligible = [];
        let hasUnresolvableTimestamp = false;
        const unresolvableReasons = [];

        for (const [fid, facSubs] of taskSubsByFaculty.entries()) {
            const fac = facultyMap.get(fid) || { id: fid, department: targetDept };

            // Department isolation (Requirement 3): Must match target department!
            if (normalizeDepartment(fac) !== targetDept) {
                continue;
            }

            const latestSub = resolveLatestFacultySubmission(facSubs, taskId, fid);
            const pkt = (latestSub && packetBySubId.get(String(latestSub.id)))
                || packetByTaskAndFaculty.get(`${taskId}_${fid}`)
                || null;

            // Genuine check (Requirement 2): Draft-only packets or unsubmitted records are excluded
            if (!latestSub || !isGenuineSubmittedReport(latestSub, pkt)) {
                continue;
            }

            // Parse timestamp on the submission - take latest of submitted_at, updated_at, created_at
            const time1 = latestSub.submitted_at ? new Date(latestSub.submitted_at).getTime() : 0;
            const time2 = latestSub.updated_at ? new Date(latestSub.updated_at).getTime() : 0;
            const time3 = latestSub.created_at ? new Date(latestSub.created_at).getTime() : 0;
            let subTime = Math.max(time1, time2, time3);
            if (!subTime || !Number.isFinite(subTime) || subTime <= 0) subTime = null;
            const subTimeRaw = latestSub.updated_at || latestSub.submitted_at || latestSub.created_at || null;

            currentEligible.push({
                facultyId: fac.id,
                facultyName: fac.full_name || fac.name || `Faculty #${fac.id}`,
                submission: latestSub,
                packet: pkt,
                subTime,
                subTimeRaw
            });
        }

        // 5. Compare Current Eligible Submissions against Draft State
        const newerSubmissions = [];
        const reasons = [];

        currentEligible.forEach((item) => {
            const fid = String(item.facultyId);
            const sub = item.submission;
            const subId = String(sub.id);
            const facName = item.facultyName;
            const captured = capturedMap.get(fid);

            if (!captured) {
                // Case A: New genuine submission arrived after draft was generated
                newerSubmissions.push({
                    facultyId: item.facultyId,
                    facultyName: facName,
                    submissionId: sub.id,
                    reason: 'new_submission',
                    submittedAt: sub.submitted_at || null,
                    updatedAt: sub.updated_at || null,
                    currentStatus: sub.status,
                    description: `New genuine submission arrived from ${facName} (${sub.status || 'submitted'}).`
                });
                reasons.push(`New submission arrived from ${facName} (${sub.status || 'submitted'}).`);
                return;
            }

            // Case B: Faculty was captured in draft. Check for revisions / changes.
            // Check 1: Submission ID changed (resubmitted with new submission record)
            if (captured.submissionId && captured.submissionId !== subId) {
                newerSubmissions.push({
                    facultyId: item.facultyId,
                    facultyName: facName,
                    submissionId: sub.id,
                    reason: 'revised_submission',
                    submittedAt: sub.submitted_at || null,
                    updatedAt: sub.updated_at || null,
                    previousStatus: captured.rawStatus || captured.submissionStatus,
                    currentStatus: sub.status,
                    description: `Submission replaced by newer revision for ${facName}.`
                });
                reasons.push(`Updated submission record detected for ${facName}.`);
                return;
            }

            // Check 2: Submission timestamp is newer than draft generation
            if (draftTime !== null && item.subTime !== null && item.subTime > draftTime) {
                newerSubmissions.push({
                    facultyId: item.facultyId,
                    facultyName: facName,
                    submissionId: sub.id,
                    reason: 'timestamp_newer',
                    submittedAt: sub.submitted_at || null,
                    updatedAt: sub.updated_at || null,
                    currentStatus: sub.status,
                    description: `Submission for ${facName} was updated after draft was generated.`
                });
                reasons.push(`Submission for ${facName} was updated after draft generation.`);
                return;
            }

            // Check 3: Review status or approval stage changed
            const currentRawStatus = norm(sub.status);
            const currentApprovalStage = norm(sub.approval_stage);
            const capturedRawStatus = norm(captured.rawStatus);
            const capturedApprovalStage = norm(captured.approvalStage);

            if (capturedRawStatus && currentRawStatus !== capturedRawStatus) {
                newerSubmissions.push({
                    facultyId: item.facultyId,
                    facultyName: facName,
                    submissionId: sub.id,
                    reason: 'status_changed',
                    submittedAt: sub.submitted_at || null,
                    updatedAt: sub.updated_at || null,
                    previousStatus: captured.rawStatus,
                    currentStatus: sub.status,
                    description: `Submission status for ${facName} changed from "${captured.rawStatus}" to "${sub.status}".`
                });
                reasons.push(`Submission status for ${facName} changed from "${captured.rawStatus}" to "${sub.status}".`);
                return;
            }

            if (capturedApprovalStage && currentApprovalStage !== capturedApprovalStage) {
                newerSubmissions.push({
                    facultyId: item.facultyId,
                    facultyName: facName,
                    submissionId: sub.id,
                    reason: 'status_changed',
                    submittedAt: sub.submitted_at || null,
                    updatedAt: sub.updated_at || null,
                    previousStatus: captured.approvalStage,
                    currentStatus: sub.approval_stage,
                    description: `Approval stage for ${facName} changed from "${captured.approvalStage}" to "${sub.approval_stage}".`
                });
                reasons.push(`Approval stage for ${facName} changed from "${captured.approvalStage}" to "${sub.approval_stage}".`);
                return;
            }

            // Check 4: Resubmission count increased
            const currentCount = Number(sub.resubmission_count || 0);
            const capturedCount = Number(captured.resubmissionCount || 0);
            if (currentCount > capturedCount) {
                newerSubmissions.push({
                    facultyId: item.facultyId,
                    facultyName: facName,
                    submissionId: sub.id,
                    reason: 'revised_submission',
                    submittedAt: sub.submitted_at || null,
                    updatedAt: sub.updated_at || null,
                    currentStatus: sub.status,
                    description: `Resubmission count incremented for ${facName}.`
                });
                reasons.push(`Resubmission count increased for ${facName}.`);
                return;
            }

            // Check 5: Missing or unparseable timestamp prevents reliable comparison (Requirement 4)
            if (item.subTime === null || draftTime === null) {
                hasUnresolvableTimestamp = true;
                unresolvableReasons.push(`Missing timestamp for ${facName} prevents deterministic freshness check.`);
            }
        });

        // Check if any captured faculty was retracted or deleted
        const currentEligibleFidSet = new Set(currentEligible.map((c) => String(c.facultyId)));
        capturedMap.forEach((captured, fid) => {
            if (!currentEligibleFidSet.has(fid)) {
                newerSubmissions.push({
                    facultyId: captured.facultyId,
                    facultyName: captured.facultyName,
                    submissionId: captured.submissionId,
                    reason: 'submission_retracted',
                    description: `Contributing submission for ${captured.facultyName} is no longer eligible or was retracted.`
                });
                reasons.push(`Contributing submission for ${captured.facultyName} is no longer present.`);
            }
        });

        // 6. Handle unresolvable timestamp state safely (Requirement 4)
        if (hasUnresolvableTimestamp && newerSubmissions.length === 0) {
            return {
                isStale: false,
                isUnknown: true,
                status: 'unknown',
                draftGeneratedAt: draftTimestampRaw,
                reasons: unresolvableReasons,
                newerSubmissions: [],
                contributingCount: capturedMap.size,
                currentEligibleCount: currentEligible.length,
                acknowledged: false
            };
        }

        // 7. Handle Acknowledgment (Step 3: "Keep Current Draft")
        const ack = p.acknowledgment
            || draftMeta?.acknowledgment
            || draftMeta?.citeflow_mfo_consolidation?.acknowledgment
            || draft.acknowledgment
            || null;

        let isAcknowledged = false;
        if (ack && ack.acknowledged_at && newerSubmissions.length > 0) {
            const ackTime = new Date(ack.acknowledged_at).getTime();
            if (Number.isFinite(ackTime)) {
                const ackSubIds = new Set(Array.isArray(ack.acknowledged_submission_ids) ? ack.acknowledged_submission_ids.map(String) : []);
                const allAcknowledged = newerSubmissions.every((ns) => {
                    const timeS = ns.submittedAt ? new Date(ns.submittedAt).getTime() : 0;
                    const timeU = ns.updatedAt ? new Date(ns.updatedAt).getTime() : 0;
                    const subTime = Math.max(timeS, timeU);
                    const idMatch = ns.submissionId && ackSubIds.has(String(ns.submissionId));
                    return idMatch && (subTime <= ackTime);
                });

                if (allAcknowledged) {
                    isAcknowledged = true;
                }
            }
        }

        const isStale = newerSubmissions.length > 0 && !isAcknowledged;
        const finalStatus = isStale ? 'stale' : 'fresh';

        return {
            isStale,
            isUnknown: false,
            status: finalStatus,
            draftGeneratedAt: draftTimestampRaw,
            reasons,
            newerSubmissions,
            contributingCount: capturedMap.size,
            currentEligibleCount: currentEligible.length,
            acknowledged: isAcknowledged,
            acknowledgment: isAcknowledged ? ack : null
        };
    }

    /**
     * Rebuilds the Chairperson's departmental draft using the latest eligible submissions,
     * preserving rejection inclusion/exclusion decisions and program narrative from the
     * previous draft.
     *
     * @param {object} params
     * @param {object} [params.previousDraft] - Existing draft to preserve decisions from
     * @returns {object} Newly regenerated consolidated report model
     */
    function regenerateDepartmentDraft(params) {
        const p = params || {};
        const previousDraft = p.previousDraft || p.draft || p.programPacket || null;
        const targetDept = normalizeDepartment(p.department || previousDraft?.department);

        if (!targetDept) throw new Error('department is required to regenerate draft.');

        // Enforce active Chairperson/OIC department authorization before protected write
        if (p.actorFaculty) {
            const auth = verifyChairpersonDepartmentAccess(p.actorFaculty, targetDept, p.delegatedAccess || []);
            if (!auth.authorized) {
                throw new Error(`Unauthorized: ${auth.reason}`);
            }
        }

        // Preserve rejection exclusions from previous draft
        let existingExclusions = p.excludedAccomplishmentIds;
        if (!existingExclusions && previousDraft) {
            const source = previousDraft.excludedAccomplishmentIds
                || previousDraft.frozenPayload?.metadata
                || previousDraft.payload?.metadata
                || previousDraft.metadata
                || previousDraft.notes;
            existingExclusions = extractExcludedAccomplishmentIds(source);
        }

        // Preserve program-level portions if not explicitly provided
        const programRows = p.programRows || previousDraft?.programPortion || { pi1: [], pi2: [] };
        const programPacket = p.programPacket || previousDraft?.programPacket || (previousDraft?.department ? previousDraft : null);

        return buildDepartmentMfoConsolidation({
            ...p,
            department: targetDept,
            programRows,
            programPacket,
            excludedAccomplishmentIds: existingExclusions || new Set()
        });
    }

    /**
     * Retains the existing draft without overwriting it and records the Chairperson's
     * acknowledgment using existing compatible metadata (mfo_snapshots payload / notes).
     *
     * Never silently overwrites an existing draft.
     * Never silently modifies or replaces the Dean's Office copy.
     *
     * @param {object} params
     * @param {object} params.draft - Existing draft to retain
     * @param {object} [params.actorFaculty] - Active Chairperson/OIC faculty actor
     * @param {Array}  [params.delegatedAccess] - Delegated access grants
     * @param {object} [params.staleness] - Precomputed staleness result
     * @returns {{ acknowledgedDraft: object, acknowledgment: object }}
     */
    function acknowledgeStaleDraft(params) {
        const p = params || {};
        const draft = p.draft || p.programPacket || p.draftSnapshot;
        if (!draft) throw new Error('A valid draft is required to record acknowledgment.');

        const targetDept = normalizeDepartment(p.department || draft.department);

        // Enforce active Chairperson/OIC department authorization
        if (p.actorFaculty) {
            const auth = verifyChairpersonDepartmentAccess(p.actorFaculty, targetDept, p.delegatedAccess || []);
            if (!auth.authorized) {
                throw new Error(`Unauthorized: ${auth.reason}`);
            }
        }

        const staleness = p.staleness || detectConsolidatedDraftStaleness({
            taskId: p.taskId || draft.taskId || draft.task_id,
            department: targetDept,
            draft,
            submissions: p.submissions || [],
            packets: p.packets || [],
            facultyList: p.facultyList || [],
            assignments: p.assignments || []
        });

        const ackRecord = {
            acknowledged_at: new Date().toISOString(),
            acknowledged_by_faculty_id: p.actorFaculty?.id || null,
            acknowledged_by_name: p.actorFaculty?.full_name || p.actorFaculty?.name || null,
            acknowledged_submission_ids: (staleness.newerSubmissions || []).map((s) => s.submissionId).filter(Boolean),
            reasons: staleness.reasons || []
        };

        // Create isolated copy with acknowledgment attached
        const updated = deepClone(draft);
        if (updated.frozenPayload?.metadata) {
            updated.frozenPayload.metadata.acknowledgment = ackRecord;
        }
        if (updated.payload?.metadata) {
            updated.payload.metadata.acknowledgment = ackRecord;
        }
        if (updated.metadata) {
            updated.metadata.acknowledgment = ackRecord;
        }
        updated.acknowledgment = ackRecord;

        const existingExclusions = extractExcludedAccomplishmentIds(updated.excludedAccomplishmentIds || updated.notes);
        const meta = mergeNotesMetadata(draft.notes, {
            excluded_accomplishments: Array.from(existingExclusions),
            count: existingExclusions.size,
            acknowledgment: ackRecord
        });
        updated.metadataObj = meta;

        return {
            acknowledgedDraft: updated,
            acknowledgment: ackRecord
        };
    }

    /**
     * Prepares and validates the submission payload for a Department Consolidated MFO.
     * Enforces Chairperson/OIC authorization, ensures draft validity, prevents duplicate
     * submissions, and generates the frozen snapshot payload.
     *
     * @param {object} params
     * @returns {object} Validation result and prepared payload
     */
    function prepareConsolidatedMfoSubmission(params) {
        const p = params || {};
        const draft = p.draft || p.programPacket;
        if (!draft || !draft.id) return { ok: false, error: 'A valid generated consolidated report is required before submission.' };

        const targetDept = normalizeDepartment(p.department || draft.department);
        if (!targetDept) return { ok: false, error: 'Target department is required for consolidated MFO submission.' };

        // 1. Enforce active Chairperson / delegated OIC authorization
        if (p.actorFaculty) {
            const auth = verifyChairpersonDepartmentAccess(p.actorFaculty, targetDept, p.delegatedAccess || []);
            const wf = getWf();
            const chairDepts = wf?.chairpersonAuthorizedDepartments
                ? (wf.chairpersonAuthorizedDepartments(p.actorFaculty, p.delegatedAccess || []) || []).map(normalizeDepartment)
                : (norm(p.actorFaculty.role).includes('chair') ? [normalizeDepartment(p.actorFaculty)] : []);
            const isNativeOrOic = chairDepts.includes(targetDept);
            if (!auth.authorized || !isNativeOrOic) {
                return {
                    ok: false,
                    error: `Only the native Chairperson or an authorized OIC with active delegation for department "${targetDept.toUpperCase()}" can submit.`
                };
            }
        }

        // 2. Prevent duplicate submission of identical finalized version
        const currentState = String(draft.packet_state || 'draft').toLowerCase();
        if ((currentState === 'submitted' || currentState === 'resubmitted') && !p.forceResubmit) {
            return {
                ok: false,
                isDuplicate: true,
                error: `Version ${draft.current_version || 1} has already been submitted to the Dean's Office. If you need to make changes, regenerate the draft first.`
            };
        }
        if (currentState === 'approved') {
            return {
                ok: false,
                isApproved: true,
                error: 'This Department Consolidated MFO has already been approved by the Dean\'s Office.'
            };
        }

        // 3. Resolve versioning and lifecycle transition
        const currentVersion = Number(draft.current_version || 1);
        const isRevisionResubmit = currentState === 'revision';
        const nextVersion = isRevisionResubmit ? currentVersion + 1 : Math.max(currentVersion, 1);
        const nextState = isRevisionResubmit ? 'resubmitted' : 'submitted';
        const now = p.now || new Date().toISOString();

        // 4. Extract decisions & metadata
        const existingExclusions = extractExcludedAccomplishmentIds(p.excludedAccomplishmentIds || draft.excludedAccomplishmentIds || draft.notes);
        const userRemarks = p.userRemarks !== undefined ? String(p.userRemarks).trim() : '';

        // 5. Build frozen payload
        const consolidation = p.consolidation || (draft.frozenPayload ? draft : null);
        const displayDept = (p.department || draft.department || targetDept || '').toString().toUpperCase();
        const frozenPayload = {
            task_id: p.taskId || draft.task_id || draft.taskId,
            department: displayDept,
            version: nextVersion,
            lifecycle_state: nextState,
            submitted_at: now,
            submitting_chairperson: {
                id: p.actorFaculty?.id || draft.chairperson_faculty_id || null,
                name: p.actorFaculty?.full_name || p.actorFaculty?.name || 'Program Chairperson',
                employee_id: p.actorFaculty?.employee_id || null,
                rank: p.actorFaculty?.academic_rank || p.actorFaculty?.position || null
            },
            contributing_faculty: consolidation?.contributingFaculty || consolidation?.contributing_faculty || [],
            unsubmitted_faculty: consolidation?.unsubmittedFaculty || consolidation?.unsubmitted_faculty || [],
            sections: consolidation?.sections || {},
            program_rows: consolidation?.programRows || consolidation?.programPortion || { pi1: [], pi2: [] },
            excluded_accomplishments: Array.from(existingExclusions),
            user_remarks: userRemarks,
            pdf: {
                url: p.pdfUrl || null,
                storage_path: p.pdfStoragePath || null,
                file_name: p.pdfFileName || `Department-Consolidated-MFO-${displayDept}-v${nextVersion}.pdf`
            }
        };

        const notesMetadata = mergeNotesMetadata(draft.notes, {
            user_remarks: userRemarks,
            excluded_accomplishments: Array.from(existingExclusions),
            count: existingExclusions.size,
            submitted_at: now,
            submitted_by_faculty_id: p.actorFaculty?.id || draft.chairperson_faculty_id || null,
            submitted_by_name: p.actorFaculty?.full_name || p.actorFaculty?.name || 'Program Chairperson',
            pdf_url: p.pdfUrl || null,
            pdf_storage_path: p.pdfStoragePath || null,
            version: nextVersion,
            last_action: nextState
        });

        return {
            ok: true,
            version: nextVersion,
            lifecycleState: nextState,
            submittedAt: now,
            frozenPayload,
            notesMetadata,
            packetUpdate: {
                packet_state: nextState,
                current_version: nextVersion,
                chairperson_faculty_id: p.actorFaculty?.id || draft.chairperson_faculty_id || null,
                notes: notesMetadata,
                updated_at: now
            }
        };
    }

    /**
     * Submits the Department Consolidated MFO to the Dean's Office via Supabase client.
     */
    async function submitConsolidatedMfoToDean(params) {
        const prep = prepareConsolidatedMfoSubmission(params);
        if (!prep.ok) return prep;

        const db = params.db;
        const draft = params.draft || params.programPacket;
        const programPacketId = draft?.id;
        if (!programPacketId) return { ok: false, error: 'Draft packet ID is missing.' };

        if (!db) {
            // Offline / unit-test mode without DB client
            return {
                ok: true,
                prep,
                version: prep.version,
                lifecycleState: prep.lifecycleState
            };
        }

        // 1. Update mfo_program_packets
        const { data: updatedPacket, error: updateErr } = await db
            .from('mfo_program_packets')
            .update(prep.packetUpdate)
            .eq('id', programPacketId)
            .select('*')
            .single();

        if (updateErr) {
            return { ok: false, error: updateErr.message || 'Failed to update program packet state.' };
        }

        // 2. Insert immutable snapshot into mfo_snapshots
        const snapshotRow = {
            program_packet_id: programPacketId,
            version_no: prep.version,
            lifecycle_state: prep.lifecycleState,
            snapshot_reason: prep.lifecycleState === 'resubmitted' ? 'resubmitted_to_dean' : 'submitted_to_dean',
            payload: prep.frozenPayload,
            created_by_faculty_id: params.actorFaculty?.id || null,
            created_at: prep.submittedAt
        };

        const { data: snapshotData, error: snapshotErr } = await db
            .from('mfo_snapshots')
            .insert(snapshotRow)
            .select('*')
            .single();

        if (snapshotErr) {
            console.warn('[MFO] Snapshot insertion warning:', snapshotErr);
        }

        // 3. Log activity in wf_activity_log (best-effort)
        try {
            await db.from('wf_activity_log').insert({
                action: prep.lifecycleState === 'resubmitted' ? 'Resubmitted Consolidated MFO' : 'Submitted Consolidated MFO',
                actor_name: params.actorFaculty?.full_name || params.actorFaculty?.name || 'Chairperson',
                target: `Department Consolidated MFO (${(params.department || '').toUpperCase()}) - Version ${prep.version}`,
                log_type: 'submission'
            });
        } catch (_) {}

        // 4. Notification for Dean / Admin (best-effort)
        try {
            await db.from('wf_notifications').insert({
                type: 'submission',
                message: `Department Consolidated MFO for ${(params.department || '').toUpperCase()} (v${prep.version}) submitted to Dean's Office for final approval.`,
                is_read: false
            });
        } catch (_) {}

        return {
            ok: true,
            programPacket: updatedPacket,
            snapshot: snapshotData || null,
            version: prep.version,
            lifecycleState: prep.lifecycleState
        };
    }

    /**
     * Applies Dean's Office review action (approved, revision, declined) to a Department Consolidated MFO.
     */
    async function applyConsolidatedMfoDeanReview(params) {
        const p = params || {};
        const programPacket = p.programPacket || p.draft;
        if (!programPacket?.id) return { ok: false, error: 'Target program packet ID is required.' };

        const action = String(p.action || '').trim().toLowerCase();
        if (!['approved', 'revision', 'declined'].includes(action)) {
            return { ok: false, error: `Invalid review action "${action}". Must be approved, revision, or declined.` };
        }

        const remarks = String(p.remarks || '').trim();
        if ((action === 'revision' || action === 'declined') && !remarks) {
            return { ok: false, error: `Remarks are required when selecting ${action}.` };
        }

        const nextState = action === 'approved' ? 'approved' : (action === 'revision' ? 'revision' : 'declined');
        const now = p.now || new Date().toISOString();
        const reviewerName = p.actorName || p.actorFaculty?.full_name || 'Dean\'s Office';

        const deanReviewMeta = {
            action,
            remarks,
            reviewed_by_name: reviewerName,
            reviewed_at: now
        };

        const notesMetadata = mergeNotesMetadata(programPacket.notes, {
            dean_review: deanReviewMeta,
            last_action: `dean_${action}`
        });

        const updatePayload = {
            packet_state: nextState,
            notes: notesMetadata,
            updated_at: now
        };

        const db = p.db;
        if (!db) {
            // Offline / test mode
            return {
                ok: true,
                nextState,
                deanReviewMeta,
                notesMetadata,
                updatePayload
            };
        }

        const { data: updatedPacket, error: updateErr } = await db
            .from('mfo_program_packets')
            .update(updatePayload)
            .eq('id', programPacket.id)
            .select('*')
            .single();

        if (updateErr) {
            return { ok: false, error: updateErr.message || 'Failed to apply Dean review action.' };
        }

        // Add review snapshot in mfo_snapshots
        try {
            await db.from('mfo_snapshots').insert({
                program_packet_id: programPacket.id,
                version_no: programPacket.current_version || 1,
                lifecycle_state: nextState,
                snapshot_reason: `dean_review_${action}`,
                payload: {
                    dean_review: deanReviewMeta,
                    reviewed_at: now
                },
                created_by_faculty_id: p.actorFaculty?.id || null,
                created_at: now
            });
        } catch (e) {
            console.warn('[MFO] Dean review snapshot error:', e);
        }

        // Notification for Chairperson
        try {
            await db.from('wf_notifications').insert({
                type: 'review',
                message: action === 'approved'
                    ? `Dean's Office approved the Department Consolidated MFO for ${(programPacket.department || '').toUpperCase()}.`
                    : action === 'revision'
                        ? `Dean's Office requested revisions on the Department Consolidated MFO for ${(programPacket.department || '').toUpperCase()}: ${remarks}`
                        : `Dean's Office declined the Department Consolidated MFO for ${(programPacket.department || '').toUpperCase()}: ${remarks}`,
                is_read: false
            });
        } catch (_) {}

        // Activity log
        try {
            await db.from('wf_activity_log').insert({
                action: action === 'approved' ? 'Dean approved Consolidated MFO' : (action === 'revision' ? 'Dean requested Consolidated MFO revision' : 'Dean declined Consolidated MFO'),
                actor_name: reviewerName,
                target: `Department Consolidated MFO (${(programPacket.department || '').toUpperCase()})`,
                log_type: action
            });
        } catch (_) {}

        return {
            ok: true,
            programPacket: updatedPacket,
            nextState,
            deanReviewMeta
        };
    }

    /**
     * Extracts Dean review metadata from packet notes.
     */
    function extractDeanReview(notes) {
        if (!notes) return null;
        try {
            let parsed = notes;
            if (typeof notes === 'string') {
                const trimmed = notes.trim();
                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    parsed = JSON.parse(trimmed);
                } else {
                    return null;
                }
            }
            if (parsed?.dean_review) return parsed.dean_review;
            if (parsed?.citeflow_mfo_consolidation?.dean_review) return parsed.citeflow_mfo_consolidation.dean_review;
        } catch (_) {}
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* Exported Module API                                                */
    /* ------------------------------------------------------------------ */

    const api = {
        MFO_SECTIONS,
        VALID_SUBMITTED_STATUSES,
        normalizeDepartment,
        isGenuineSubmittedReport,
        resolveLatestFacultySubmission,
        extractExcludedAccomplishmentIds,
        formatExclusionMetadata,
        mergeNotesMetadata,
        verifyChairpersonDepartmentAccess,
        buildDepartmentMfoConsolidation,
        toggleAccomplishmentExclusion,
        detectConsolidatedDraftStaleness,
        regenerateDepartmentDraft,
        acknowledgeStaleDraft,
        prepareConsolidatedMfoSubmission,
        submitConsolidatedMfoToDean,
        applyConsolidatedMfoDeanReview,
        extractDeanReview,
        formatStatus
    };

    global.CiteFlowMfoConsolidation = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);

