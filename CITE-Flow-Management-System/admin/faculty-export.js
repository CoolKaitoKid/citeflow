/**
 * ==============================================================================
 * CITE-Flow — Faculty Profile Export & Document Preview Module
 * HR Form 23B (Revised June 2012, Rev 0)
 * 
 * Supports:
 * 1. Organic / Regular Faculty Export
 * 2. Part-Time / Non-Resident Instructor Faculty Export
 * 
 * Generates:
 * - High-fidelity Multi-page Landscape Document Preview (13in x 8.5in US Legal)
 * - Microsoft Word (.docx) populated directly from the official authoritative template
 * - Adobe PDF (.pdf) formatted with official letterhead, tables, and signatories
 * ==============================================================================
 */

(function initCiteFlowFacultyExport() {
    'use strict';

    // Global state for export modal & preview
    const exportState = {
        facultyList: [],
        facultyType: 'organic',        // 'organic' | 'parttime'
        selectionMode: 'all',          // 'all' | 'selected'
        selectedFacultyIds: new Set(),
        academicYear: '2026–2027',
        availableAcademicYears: [],
        signatories: {
            preparedByName: 'CHRISTINE MARY N. LIM',
            preparedByTitle: 'COTE Secretary',
            certifiedByName: 'FRITZ D. BACALSO, Ph. D.',
            certifiedByTitle: 'Dean, COTE',
            notedByName: 'EINGILBERT C. BENOLIRAO, Dev. Ed. D',
            notedByTitle: 'Campus Director'
        },
        warnings: [],
        optimalWidths: [],
        colPcts: [],
        previewPages: [],
        currentPreviewPage: 1,
        totalPreviewPages: 1,
        zoomLevel: 1.0,
        isGenerating: false
    };
    window.exportState = exportState;

    // Official 7 Programs matching HR Form 23B tables
    const PROGRAM_SECTIONS = [
        {
            index: 0,
            code: 'BSIT',
            title: 'BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY',
            shortName: 'BS Information Technology'
        },
        {
            index: 1,
            code: 'BSIE',
            title: 'BACHELOR OF SCIENCE IN INDUSTRIAL ENGINEERING',
            shortName: 'BS Industrial Engineering'
        },
        {
            index: 2,
            code: 'BIT-DRAFTING',
            title: 'BACHELOR OF INDUSTRIAL TECHNOLOGY – DRAFTING TECHNOLOGY',
            shortName: 'BIT Drafting Technology'
        },
        {
            index: 3,
            code: 'BIT-GARMENTS',
            title: 'BACHELOR OF INDUSTRIAL TECHNOLOGY – GARMENTS TECHNOLOGY',
            shortName: 'BIT Garments Technology'
        },
        {
            index: 4,
            code: 'BIT-ELECTRONICS',
            title: 'BACHELOR OF INDUSTRIAL TECHNOLOGY – ELECTRONICS TECHNOLOGY',
            shortName: 'BIT Electronics Technology'
        },
        {
            index: 5,
            code: 'BIT-COMPUTER',
            title: 'BACHELOR OF INDUSTRIAL TECHNOLOGY – COMPUTER TECHNOLOGY',
            shortName: 'BIT Computer Technology'
        },
        {
            index: 6,
            code: 'BIT-AUTOMOTIVE',
            title: 'BACHELOR OF INDUSTRIAL TECHNOLOGY – AUTOMOTIVE TECHNOLOGY',
            shortName: 'BIT Automotive Technology'
        }
    ];

    // ==============================================================================
    // UTILITIES & DATA NORMALIZATION
    // ==============================================================================

    function escapeXml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function isPartTimeFaculty(f) {
        if (!f) return false;
        const emp = String(f.employment_type || '').toLowerCase();
        const rank = String(f.academic_rank || '').toLowerCase();
        const contract = String(f.contract_type || '').toLowerCase();
        const pos = String(f.position || '').toLowerCase();

        if (emp.includes('part-time') || emp.includes('cos') || emp.includes('contractual') || emp.includes('project')) return true;
        if (rank.includes('part-time') || rank.includes('non-resident') || rank.includes('cos') || rank.includes('lecturer')) return true;
        if (contract.includes('part-time') || contract.includes('cos') || contract.includes('contractual')) return true;
        if (pos.includes('part-time') || pos.includes('non-resident')) return true;
        return false;
    }

    function getFacultyProgramIndex(f) {
        if (!f) return 0;
        const dept = String(f.department || '').toUpperCase().trim();
        const desig = String(f.designation || '').toUpperCase();
        const qual = String(f.educational_qualification || '').toUpperCase();
        const pos = String(f.position || '').toUpperCase();
        const all = `${dept} ${desig} ${qual} ${pos}`;

        if (dept === 'BSIT' || all.includes('INFORMATION TECHNOLOGY') || all.includes('BSIT')) return 0;
        if (dept === 'BSIE' || all.includes('INDUSTRIAL ENGINEERING') || all.includes('BSIE')) return 1;
        if (dept === 'BIT' || all.includes('INDUSTRIAL TECHNOLOGY') || all.includes('BIT')) {
            if (all.includes('DRAFTING')) return 2;
            if (all.includes('GARMENT')) return 3;
            if (all.includes('ELECTRONIC')) return 4;
            if (all.includes('AUTOMOTIVE')) return 6;
            return 5; // Default BIT is Computer Technology
        }
        return 0; // Default to BSIT
    }

    function formatBirthDate(birthdate) {
        if (!birthdate) return '';
        try {
            const raw = String(birthdate).slice(0, 10);
            const parts = raw.split('-');
            if (parts.length === 3) {
                const year = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const day = parseInt(parts[2], 10);
                const dt = new Date(year, month, day);
                const monthNames = [
                    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
                ];
                return `${monthNames[month]} ${day}, ${year}`;
            }
        } catch (_) { }
        return '';
    }

    function calculateAge(birthdate, referenceDate = new Date()) {
        if (!birthdate) return '';
        try {
            const raw = String(birthdate).slice(0, 10);
            const parts = raw.split('-');
            if (parts.length === 3) {
                const bYear = parseInt(parts[0], 10);
                const bMonth = parseInt(parts[1], 10) - 1;
                const bDay = parseInt(parts[2], 10);
                const bDate = new Date(bYear, bMonth, bDay);
                let age = referenceDate.getFullYear() - bDate.getFullYear();
                const m = referenceDate.getMonth() - bDate.getMonth();
                if (m < 0 || (m === 0 && referenceDate.getDate() < bDate.getDate())) {
                    age--;
                }
                return (age > 0 && age < 120) ? String(age) : '';
            }
        } catch (_) { }
        return '';
    }

    function formatEducationalQualifications(f) {
        const lines = [];
        if (f.educational_qualification) {
            const rawLines = String(f.educational_qualification).split(/\r?\n|;/);
            rawLines.forEach(l => {
                const trimmed = l.trim().replace(/^[-•*]\s*/, '');
                if (trimmed) lines.push(trimmed.toUpperCase());
            });
        }
        if (f.masters_degree && String(f.masters_degree).trim()) {
            const m = String(f.masters_degree).trim().toUpperCase();
            if (!lines.some(l => l.includes(m))) {
                lines.push(`MASTER'S DEGREE: ${m}`);
            }
        }
        if (f.doctorate_degree && String(f.doctorate_degree).trim()) {
            const d = String(f.doctorate_degree).trim().toUpperCase();
            if (!lines.some(l => l.includes(d))) {
                lines.push(`DOCTORATE DEGREE: ${d}`);
            }
        }
        return lines;
    }

    function formatEligibility(elig) {
        if (!elig || !String(elig).trim()) return '• NONE';
        const str = String(elig).trim();
        return str.startsWith('•') ? str.toUpperCase() : `• ${str.toUpperCase()}`;
    }

    function formatExperience(years) {
        if (years == null || years === '') return '';
        const num = parseInt(years, 10);
        if (isNaN(num) || num <= 0) return '0';
        return `${num} YEARS`;
    }

    // ==============================================================================
    // DISCOVERY & INITIALIZATION
    // ==============================================================================

    function discoverAcademicYears() {
        const set = new Set();
        try {
            const stored = localStorage.getItem('citeflow_custom_academic_years_v1');
            if (stored) {
                JSON.parse(stored).forEach(ay => {
                    if (ay && typeof ay === 'string') set.add(ay.trim().replace('-', '–'));
                });
            }
        } catch (_) { }

        // Add standard recent academic years
        ['2026–2027', '2025–2026', '2024–2025', '2023–2024'].forEach(ay => set.add(ay));

        const list = Array.from(set).sort().reverse();
        exportState.availableAcademicYears = list;
        if (!list.includes(exportState.academicYear)) {
            exportState.academicYear = list[0] || '2026–2027';
        }
    }

    const bannerDataUrls = {
        header: '/admin/templates/assets/image1.jpeg',
        footer: '/admin/templates/assets/image5.jpeg'
    };

    async function preloadBanners() {
        try {
            const [r1, r5] = await Promise.all([
                fetch('/admin/templates/assets/image1.jpeg').then(r => r.blob()),
                fetch('/admin/templates/assets/image5.jpeg').then(r => r.blob())
            ]);
            const toDataUrl = (blob) => new Promise(res => {
                const fr = new FileReader();
                fr.onloadend = () => res(fr.result);
                fr.readAsDataURL(blob);
            });
            bannerDataUrls.header = await toDataUrl(r1);
            bannerDataUrls.footer = await toDataUrl(r5);
        } catch (e) {
            console.warn('[FACULTY-EXPORT] Could not convert banners to data URLs, using static asset paths:', e);
        }
    }
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
        preloadBanners();
    }

    async function discoverSignatories() {
        if (!exportState.signatories) {
            exportState.signatories = {};
        }
        if (!exportState.signatories.preparedByName) {
            exportState.signatories.preparedByName = 'CHRISTINE MARY N. LIM';
            exportState.signatories.preparedByTitle = 'COTE Secretary';
        }
        if (!exportState.signatories.certifiedByName) {
            exportState.signatories.certifiedByName = 'FRITZ D. BACALSO, Ph. D.';
            exportState.signatories.certifiedByTitle = 'Dean, COTE';
        }
        if (!exportState.signatories.notedByName) {
            exportState.signatories.notedByName = 'EINGILBERT C. BENOLIRAO, Dev. Ed. D';
            exportState.signatories.notedByTitle = 'Campus Director';
        }
    }

    function isTestOrAdminAccount(f) {
        if (!f) return true;

        // 1. Account status: non-active accounts are excluded from active faculty export
        const status = String(f.status || '').trim().toLowerCase();
        if (status === 'archived' || status === 'inactive' || f.is_archived === true) {
            return true;
        }

        // 2. Verified Account Roles & Positions:
        // Administrative leadership and non-teaching system accounts
        const role = String(f.role || '').trim().toLowerCase();
        const pos = String(f.position || '').trim().toLowerCase();
        const dept = String(f.department || '').trim().toLowerCase();

        // Exclude system administrative accounts
        if (role === 'admin' || role === 'administrator' || role === 'superadmin' || role === 'college dean') {
            return true;
        }
        if (pos === 'administrator' || pos === 'admin') {
            if (role !== 'faculty' && role !== 'chairperson') {
                return true;
            }
        }
        if (dept === 'cite administration') {
            return true;
        }

        // 3. Known dummy / test character placeholder accounts:
        // Do not exclude legitimate faculty merely because email/name contains admin or test
        const name = String(f.name || '').trim().toLowerCase();
        const email = String(f.email || '').trim().toLowerCase();

        if (name === 'son goku' || name.startsWith('son goku')) {
            return true;
        }
        if (name === 'citeflow administrator' || email === 'citeflow.admin@ctu.edu.ph') {
            return true;
        }
        if (name === 'wesley admin' && (role === 'admin' || email === 'admin.test@ctu.edu.ph')) {
            return true;
        }
        if (name === 'krishnan a. admin' && (role === 'admin' || email === 'krishpao9@gmail.com')) {
            return true;
        }

        return false;
    }

    function calculateOptimalColumnWidths(records, totalWidth = 17995) {
        let maxLast = 9, maxFirst = 10, maxMiddle = 11, maxRank = 13, maxQual = 25, maxExp = 10, maxElig = 11;

        (records || []).forEach(f => {
            const last = (f.last_name || f.name?.split(' ').pop() || '').length;
            const first = (f.first_name || f.name?.split(' ')[0] || '').length;
            const middle = (f.middle_name || '').length;
            const rank = (f.academic_rank || f.position || '').length;

            let qualLen = 0;
            if (f.educational_qualification) {
                String(f.educational_qualification).split(/\r?\n|;/).forEach(l => { if (l.trim().length > qualLen) qualLen = l.trim().length; });
            }
            if (f.masters_degree && f.masters_degree.length > qualLen) qualLen = f.masters_degree.length;
            if (f.doctorate_degree && f.doctorate_degree.length > qualLen) qualLen = f.doctorate_degree.length;

            const exp = (String(f.years_experience || '') + ' YEARS').length;
            const elig = (f.eligibility || '').length;

            if (last > maxLast) maxLast = last;
            if (first > maxFirst) maxFirst = first;
            if (middle > maxMiddle) maxMiddle = middle;
            if (rank > maxRank) maxRank = rank;
            if (qualLen > maxQual) maxQual = qualLen;
            if (exp > maxExp) maxExp = exp;
            if (elig > maxElig) maxElig = elig;
        });

        let colWidths = [
            450,  // 0: NO
            Math.min(2200, Math.max(1600, maxLast * 95)),   // 1: LAST NAME
            Math.min(2200, Math.max(1600, maxFirst * 95)),  // 2: FIRST NAME
            Math.min(1800, Math.max(1300, maxMiddle * 90)), // 3: MIDDLE NAME
            Math.min(2100, Math.max(1500, maxRank * 85)),   // 4: ACADEMIC RANK
            1100, // 5: STATUS
            450,  // 6: SEX
            1250, // 7: DATE OF BIRTH
            500,  // 8: AGE
            4500, // 9: EDUCATIONAL QUALIFICATION (base)
            1050, // 10: EXPERIENCE
            Math.min(2000, Math.max(1300, maxElig * 75))   // 11: ELIGIBILITY
        ];

        let currentSum = colWidths.reduce((a, b) => a + b, 0);
        let remaining = totalWidth - currentSum;

        if (remaining > 0) {
            colWidths[9] += Math.round(remaining * 0.60);
            colWidths[4] += Math.round(remaining * 0.15);
            colWidths[1] += Math.round(remaining * 0.10);
            colWidths[2] += Math.round(remaining * 0.10);
            colWidths[11] += Math.round(remaining * 0.05);
        } else if (remaining < 0) {
            const ratio = totalWidth / currentSum;
            colWidths = colWidths.map(w => Math.round(w * ratio));
        }

        const diff = totalWidth - colWidths.reduce((a, b) => a + b, 0);
        colWidths[9] += diff;

        return colWidths;
    }

    function updateHeaderRow1Widths(headerRow1, widths) {
        const col0to3 = widths[0] + widths[1] + widths[2] + widths[3];
        const topWidths = [col0to3, widths[4], widths[5], widths[6], widths[7], widths[8], widths[9], widths[10], widths[11]];

        let cellIdx = 0;
        return headerRow1.replace(/<w:tc[\s>][\s\S]*?<\/w:tc>/g, (cellXml) => {
            const w = topWidths[cellIdx++];
            if (w) {
                return cellXml.replace(/<w:tcW\s+w:w="\d+"/, `<w:tcW w:w="${w}"`);
            }
            return cellXml;
        });
    }

    function updateHeaderRow2Widths(headerRow2, widths) {
        let cellIdx = 0;
        return headerRow2.replace(/<w:tc[\s>][\s\S]*?<\/w:tc>/g, (cellXml) => {
            const w = widths[cellIdx++];
            if (w) {
                return cellXml.replace(/<w:tcW\s+w:w="\d+"/, `<w:tcW w:w="${w}"`);
            }
            return cellXml;
        });
    }

    function stripSignatures(docXml) {
        return docXml.replace(/<w:drawing[\s>][\s\S]*?<\/w:drawing>/g, (drawingXml) => {
            const isSignature = /r:embed="(?:rId7|rId8|rId9)"/.test(drawingXml) ||
                /image[234]\.(?:jpeg|png|jpg)/.test(drawingXml);
            if (isSignature) {
                return '';
            }
            return drawingXml;
        });
    }

    async function fetchAllFacultyForExport() {
        try {
            let client = window.supabaseClient;
            if (!client && window.supabase && typeof window.supabase.createClient === 'function') {
                const url = window.__SUPABASE_URL__ || 'https://uforealazougjckepggc.supabase.co';
                const key = window.__SUPABASE_ANON__ || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';
                client = window.supabase.createClient(url, key);
                window.supabaseClient = client;
            }

            if (!client) {
                // If client not yet ready, check page memory array
                const pageData = window.facultyData || window.facultyList;
                if (Array.isArray(pageData) && pageData.length > 0) {
                    exportState.facultyList = pageData.filter(f => f.status !== 'Archived' && !f.is_archived && !isTestOrAdminAccount(f) && f.name);
                    return exportState.facultyList;
                }
                throw new Error('Supabase client not initialized');
            }

            const { data, error } = await client
                .from('faculty')
                .select('*')
                .neq('status', 'Archived')
                .order('last_name', { ascending: true });

            if (error) throw error;

            // Filter out empty ghost records, archived records, and administrative test accounts
            const valid = (data || []).filter(f => {
                if (!f.name || !f.name.trim()) return false;
                if (f.status === 'Archived' || f.is_archived === true) return false;
                if (isTestOrAdminAccount(f)) return false;
                return true;
            });
            exportState.facultyList = valid;
            return valid;
        } catch (err) {
            console.error('[FACULTY-EXPORT] Failed to fetch faculty records:', err);
            // Fallback to existing window.facultyData or window.facultyList if available in page scope
            const pageData = window.facultyData || window.facultyList;
            if (Array.isArray(pageData) && pageData.length > 0) {
                exportState.facultyList = pageData.filter(f => f.status !== 'Archived' && !f.is_archived && !isTestOrAdminAccount(f) && f.name);
                return exportState.facultyList;
            }
            throw err;
        }
    }

    // ==============================================================================
    // EXPORT CONFIGURATION MODAL UI
    // ==============================================================================

    function ensureExportStylesInjected() {
        if (document.getElementById('citeflow-faculty-export-styles')) return;
        const style = document.createElement('style');
        style.id = 'citeflow-faculty-export-styles';
        style.textContent = `
            /* Theme-Aware Export Controls */
            .export-modal-panel {
                background-color: #ffffff !important;
                color: #1e293b !important;
                border: 1px solid #e2e8f0 !important;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
            }
            .export-modal-header {
                background-color: #f8fafc !important;
                border-bottom: 1px solid #e2e8f0 !important;
            }
            .export-header-icon-box {
                background-color: color-mix(in srgb, var(--cite-theme, #621708) 12%, #ffffff) !important;
                color: var(--cite-theme, #621708) !important;
                border: 1px solid color-mix(in srgb, var(--cite-theme, #621708) 22%, transparent) !important;
            }
            .export-type-card {
                border: 1.5px solid #e2e8f0 !important;
                background-color: #ffffff !important;
                border-radius: 1rem !important;
                padding: 1rem !important;
                transition: all 0.2s ease !important;
                cursor: pointer !important;
                position: relative !important;
            }
            .export-type-card:hover {
                border-color: #cbd5e1 !important;
                background-color: #f8fafc !important;
            }
            .export-type-card.is-selected {
                border: 2px solid var(--cite-theme, #621708) !important;
                background-color: color-mix(in srgb, var(--cite-theme, #621708) 6%, #ffffff) !important;
                box-shadow: 0 4px 12px -2px color-mix(in srgb, var(--cite-theme, #621708) 16%, transparent) !important;
            }
            .export-type-card .card-title {
                font-weight: 700 !important;
                color: #0f172a !important;
                font-size: 0.875rem !important;
            }
            .export-type-card .card-desc {
                font-size: 0.75rem !important;
                color: #64748b !important;
                margin-top: 0.25rem !important;
                line-height: 1.4 !important;
            }
            .export-badge-organic {
                background-color: #ecfdf5 !important;
                color: #065f46 !important;
                border: 1px solid #a7f3d0 !important;
                font-size: 0.625rem !important;
                font-weight: 700 !important;
                padding: 0.125rem 0.5rem !important;
                border-radius: 9999px !important;
            }
            .export-badge-parttime {
                background-color: #fffbeb !important;
                color: #92400e !important;
                border: 1px solid #fde68a !important;
                font-size: 0.625rem !important;
                font-weight: 700 !important;
                padding: 0.125rem 0.5rem !important;
                border-radius: 9999px !important;
            }
            .export-count-badge {
                font-size: 0.75rem !important;
                font-weight: 700 !important;
                padding: 0.2rem 0.65rem !important;
                border-radius: 9999px !important;
                background-color: color-mix(in srgb, var(--cite-theme, #621708) 10%, #ffffff) !important;
                color: var(--cite-theme, #621708) !important;
                border: 1px solid color-mix(in srgb, var(--cite-theme, #621708) 22%, transparent) !important;
            }
            .export-format-card {
                border: 1px solid #e2e8f0 !important;
                border-radius: 1rem !important;
                padding: 0.65rem !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 0.5rem !important;
                font-size: 0.75rem !important;
                font-weight: 500 !important;
                color: #334155 !important;
                background-color: #ffffff !important;
                cursor: pointer !important;
                transition: all 0.15s ease !important;
            }
            .export-format-card:hover {
                background-color: #f8fafc !important;
                border-color: #cbd5e1 !important;
            }
            .export-format-card.is-selected {
                border: 2px solid var(--cite-theme, #621708) !important;
                background-color: color-mix(in srgb, var(--cite-theme, #621708) 6%, #ffffff) !important;
                color: var(--cite-theme, #621708) !important;
                font-weight: 700 !important;
            }
            .export-field {
                border: 1px solid #e2e8f0 !important;
                background-color: #f8fafc !important;
                color: #0f172a !important;
                border-radius: 0.75rem !important;
                transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
            }
            .export-field:focus {
                border-color: var(--cite-theme, #621708) !important;
                background-color: #ffffff !important;
                outline: none !important;
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--cite-theme, #621708) 18%, transparent) !important;
            }
            .export-btn-primary {
                background-color: var(--cite-theme, #621708) !important;
                color: var(--cite-theme-text, #ffffff) !important;
                border: 1px solid var(--cite-theme-border, transparent) !important;
                border-radius: 1rem !important;
                font-weight: 600 !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 2px 8px -1px color-mix(in srgb, var(--cite-theme, #621708) 35%, transparent) !important;
            }
            .export-btn-primary:hover {
                background-color: var(--cite-theme-hover, #8c2a10) !important;
            }
            .export-btn-secondary {
                background-color: #ffffff !important;
                color: var(--cite-theme, #621708) !important;
                border: 1.5px solid var(--cite-theme, #621708) !important;
                border-radius: 1rem !important;
                font-weight: 600 !important;
                transition: all 0.2s ease !important;
            }
            .export-btn-secondary:hover {
                background-color: color-mix(in srgb, var(--cite-theme, #621708) 8%, #ffffff) !important;
            }
            .export-btn-ghost {
                background-color: #f1f5f9 !important;
                color: #475569 !important;
                border: 1px solid #e2e8f0 !important;
                border-radius: 1rem !important;
                font-weight: 600 !important;
                transition: all 0.2s ease !important;
            }
            .export-btn-ghost:hover {
                background-color: #e2e8f0 !important;
                color: #1e293b !important;
            }
            .export-link-btn {
                color: var(--cite-theme, #621708) !important;
                cursor: pointer !important;
                font-weight: 600 !important;
            }
            .export-link-btn:hover {
                text-decoration: underline !important;
                color: var(--cite-theme-hover, #8c2a10) !important;
            }
            .export-theme-icon {
                color: var(--cite-theme, #621708) !important;
            }
            .export-radio,
            .export-checkbox {
                accent-color: var(--cite-theme, #621708) !important;
                cursor: pointer !important;
            }
            .export-preview-toolbar {
                background-color: #1c1917 !important;
                color: #ffffff !important;
                border-bottom: 1px solid #292524 !important;
            }
        `;
        document.head.appendChild(style);
    }

    function renderExportModalHtml() {
        ensureExportStylesInjected();
        let existing = document.getElementById('facultyExportModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'facultyExportModal';
        modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-3 sm:p-5 overflow-y-auto animate-fade-in';
        modal.innerHTML = `
            <div class="export-modal-panel bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[92vh]">
                <!-- Modal Header -->
                <div class="export-modal-header px-6 py-5 border-b border-stone-200 flex items-center justify-between bg-stone-50/80">
                    <div class="flex items-center gap-3.5">
                        <div class="export-header-icon-box w-10 h-10 rounded-2xl flex items-center justify-center text-base shadow-sm">
                            <i class="fa-solid fa-file-export"></i>
                        </div>
                        <div>
                            <h2 class="text-xl font-bold tracking-tight text-stone-900">Export Faculty Profiles</h2>
                            <p class="text-xs text-stone-500 mt-0.5">Generate official HR Form 23B profile documents</p>
                        </div>
                    </div>
                    <button type="button" onclick="closeFacultyExportModal()" class="w-9 h-9 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 flex items-center justify-center transition-colors text-lg" aria-label="Close">
                        <i class="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>

                <!-- Modal Body -->
                <div class="p-6 overflow-y-auto space-y-6 flex-1 text-sm text-stone-700">
                    
                    <!-- 1. Faculty Type Selection -->
                    <div>
                        <label class="block text-xs font-bold uppercase tracking-wider text-stone-500 mb-2.5">
                            1. Select Document Template & Faculty Type
                        </label>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="export-type-card ${exportState.facultyType === 'organic' ? 'is-selected' : ''}" onclick="onExportFacultyTypeCardClick('organic')">
                                <div class="flex items-start gap-3">
                                    <input type="radio" name="exportFacultyType" value="organic" ${exportState.facultyType === 'organic' ? 'checked' : ''} onchange="onExportFacultyTypeChange('organic')" class="export-radio mt-1" onclick="event.stopPropagation()">
                                    <div class="flex-1">
                                        <div class="card-title flex items-center gap-2">
                                            <span>Organic / Regular Faculty</span>
                                            <span class="export-badge-organic">Permanent / Regular</span>
                                        </div>
                                        <p class="card-desc">Official template for Organic, Plantilla, and Regular faculty members</p>
                                    </div>
                                </div>
                            </div>

                            <div class="export-type-card ${exportState.facultyType === 'parttime' ? 'is-selected' : ''}" onclick="onExportFacultyTypeCardClick('parttime')">
                                <div class="flex items-start gap-3">
                                    <input type="radio" name="exportFacultyType" value="parttime" ${exportState.facultyType === 'parttime' ? 'checked' : ''} onchange="onExportFacultyTypeChange('parttime')" class="export-radio mt-1" onclick="event.stopPropagation()">
                                    <div class="flex-1">
                                        <div class="card-title flex items-center gap-2">
                                            <span>Part-Time Faculty</span>
                                            <span class="export-badge-parttime">COS / Non-Resident</span>
                                        </div>
                                        <p class="card-desc">Official template for Non-Resident Instructors and Contract of Service (COS) faculty</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 2. Academic Year & Output Format -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label for="exportAcademicYear" class="block text-xs font-bold uppercase tracking-wider text-stone-500 mb-1.5">
                                2. Academic Year
                            </label>
                            <select id="exportAcademicYear" onchange="onExportAcademicYearChange(this.value)" class="export-field w-full px-4 py-2.5 text-stone-800 font-medium text-sm">
                                ${exportState.availableAcademicYears.map(ay => `<option value="${ay}" ${ay === exportState.academicYear ? 'selected' : ''}>${ay}</option>`).join('')}
                            </select>
                        </div>

                        <div>
                            <label class="block text-xs font-bold uppercase tracking-wider text-stone-500 mb-1.5">
                                3. Primary Export Format
                            </label>
                            <div class="grid grid-cols-2 gap-2">
                                <div data-format="docx" onclick="onExportFormatClick('docx')" class="export-format-card ${exportState.format === 'docx' ? 'is-selected' : ''}">
                                    <input type="radio" name="exportFormat" value="docx" ${exportState.format === 'docx' ? 'checked' : ''} onchange="onExportFormatClick('docx')" class="hidden">
                                    <i class="fa-solid fa-file-word text-blue-600"></i>
                                    <span>Word (.docx)</span>
                                </div>
                                <div data-format="pdf" onclick="onExportFormatClick('pdf')" class="export-format-card ${exportState.format === 'pdf' ? 'is-selected' : ''}">
                                    <input type="radio" name="exportFormat" value="pdf" ${exportState.format === 'pdf' ? 'checked' : ''} onchange="onExportFormatClick('pdf')" class="hidden">
                                    <i class="fa-solid fa-file-pdf text-red-600"></i>
                                    <span>PDF Document</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 3. Faculty Selection Mode -->
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <label class="block text-xs font-bold uppercase tracking-wider text-stone-500">
                                4. Faculty Selection
                            </label>
                            <span id="exportSelectedCountBadge" class="export-count-badge">
                                Selected: 0 faculty
                            </span>
                        </div>

                        <div class="flex items-center gap-4 mb-3">
                            <label class="flex items-center gap-2 cursor-pointer text-xs font-semibold text-stone-700">
                                <input type="radio" name="exportSelectionMode" value="all" ${exportState.selectionMode === 'all' ? 'checked' : ''} onchange="onExportSelectionModeChange('all')" class="export-radio">
                                <span>All Matching Faculty</span>
                            </label>

                            <label class="flex items-center gap-2 cursor-pointer text-xs font-semibold text-stone-700">
                                <input type="radio" name="exportSelectionMode" value="selected" ${exportState.selectionMode === 'selected' ? 'checked' : ''} onchange="onExportSelectionModeChange('selected')" class="export-radio">
                                <span>Specific Faculty Selection</span>
                            </label>
                        </div>

                        <!-- Searchable Faculty Checklist Container -->
                        <div id="exportFacultyChecklistWrapper" class="${exportState.selectionMode === 'selected' ? '' : 'hidden'} border border-stone-200 rounded-2xl overflow-hidden bg-stone-50">
                            <!-- Checklist Header with Search -->
                            <div class="p-3 bg-white border-b border-stone-200 flex flex-wrap items-center justify-between gap-2">
                                <div class="relative flex-1 min-w-[200px]">
                                    <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-stone-400 text-xs"></i>
                                    <input type="text" id="exportFacultySearchInput" oninput="onExportFacultySearch(this.value)" placeholder="Search faculty name, rank, or program..." class="export-field w-full pl-8 pr-3 py-1.5 text-xs">
                                </div>
                                <div class="flex items-center gap-2 text-xs">
                                    <button type="button" onclick="selectAllExportFaculty(true)" class="export-link-btn text-xs font-semibold">Select All</button>
                                    <span class="text-stone-300">|</span>
                                    <button type="button" onclick="selectAllExportFaculty(false)" class="text-stone-500 hover:text-stone-700 text-xs hover:underline">Deselect All</button>
                                </div>
                            </div>

                            <!-- Grouped List -->
                            <div id="exportFacultyChecklist" class="max-h-56 overflow-y-auto p-3 space-y-4">
                                <!-- Populated dynamically by renderExportFacultyChecklist() -->
                            </div>
                        </div>
                    </div>

                    <!-- 4. Official Document Signatories (Editable by Admin) -->
                    <div class="border border-stone-200 rounded-2xl p-4 bg-stone-50/80">
                        <div class="flex items-center justify-between cursor-pointer" onclick="toggleSignatoriesSection()">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-xl bg-stone-200/80 flex items-center justify-center shrink-0 text-stone-700">
                                    <i class="fa-solid fa-signature text-xs"></i>
                                </div>
                                <div>
                                    <h4 class="font-bold text-xs uppercase tracking-wider text-stone-900">Official Document Signatories</h4>
                                    <p class="text-[11px] text-stone-500">Edit signatory names as needed before generating or downloading</p>
                                </div>
                            </div>
                            <button type="button" class="text-stone-400 hover:text-stone-700 transition-transform" id="signatoriesChevronBtn">
                                <i id="signatoriesChevron" class="fa-solid fa-chevron-up text-xs transition-transform duration-200"></i>
                            </button>
                        </div>

                        <div id="signatoriesForm" class="mt-4 pt-4 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label for="signatoryPrepared" class="block text-[10px] font-bold uppercase tracking-wider text-stone-600 mb-1">
                                    Prepared By
                                </label>
                                <input type="text" id="signatoryPrepared" value="${escapeHtml(exportState.signatories.preparedByName || 'CHRISTINE MARY N. LIM')}" oninput="onSignatoryChange('preparedByName', this.value)" class="export-field w-full px-3 py-2 text-xs font-semibold text-stone-800" placeholder="Signatory Name">
                                <span class="text-[10px] text-stone-500 font-medium mt-0.5 block">${escapeHtml(exportState.signatories.preparedByTitle || 'COTE Secretary')}</span>
                            </div>

                            <div>
                                <label for="signatoryCertified" class="block text-[10px] font-bold uppercase tracking-wider text-stone-600 mb-1">
                                    Certified Correct
                                </label>
                                <input type="text" id="signatoryCertified" value="${escapeHtml(exportState.signatories.certifiedByName || 'FRITZ D. BACALSO, Ph. D.')}" oninput="onSignatoryChange('certifiedByName', this.value)" class="export-field w-full px-3 py-2 text-xs font-semibold text-stone-800" placeholder="Signatory Name">
                                <span class="text-[10px] text-stone-500 font-medium mt-0.5 block">${escapeHtml(exportState.signatories.certifiedByTitle || 'Dean, COTE')}</span>
                            </div>

                            <div>
                                <label for="signatoryNoted" class="block text-[10px] font-bold uppercase tracking-wider text-stone-600 mb-1">
                                    Noted By
                                </label>
                                <input type="text" id="signatoryNoted" value="${escapeHtml(exportState.signatories.notedByName || 'EINGILBERT C. BENOLIRAO, Dev. Ed. D')}" oninput="onSignatoryChange('notedByName', this.value)" class="export-field w-full px-3 py-2 text-xs font-semibold text-stone-800" placeholder="Signatory Name">
                                <span class="text-[10px] text-stone-500 font-medium mt-0.5 block">${escapeHtml(exportState.signatories.notedByTitle || 'Campus Director')}</span>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- Modal Footer -->
                <div class="px-6 py-4 bg-stone-50 border-t border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <button type="button" onclick="closeFacultyExportModal()" class="export-btn-ghost w-full sm:w-auto px-5 py-2.5 text-xs">
                        Cancel
                    </button>

                    <div class="flex items-center gap-2.5 w-full sm:w-auto">
                        <button type="button" onclick="triggerDirectExportDownload()" class="export-btn-secondary flex-1 sm:flex-initial px-5 py-2.5 text-xs flex items-center justify-center gap-2">
                            <i class="fa-solid fa-download"></i>
                            <span>Quick Download</span>
                        </button>

                        <button type="button" onclick="generateFacultyExportPreview()" class="export-btn-primary flex-1 sm:flex-initial px-6 py-2.5 text-xs flex items-center justify-center gap-2 shadow-sm">
                            <i class="fa-solid fa-eye"></i>
                            <span>Generate Preview</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        renderExportFacultyChecklist();
    }

    function renderExportFacultyChecklist(searchQuery = '') {
        const container = document.getElementById('exportFacultyChecklist');
        if (!container) return;

        const isPT = exportState.facultyType === 'parttime';
        // Filter by matching type
        const matching = exportState.facultyList.filter(f => isPT ? isPartTimeFaculty(f) : !isPartTimeFaculty(f));

        // Group into programs
        const groups = PROGRAM_SECTIONS.map(prog => ({
            ...prog,
            faculty: []
        }));

        const q = String(searchQuery || '').toLowerCase().trim();

        matching.forEach(f => {
            if (q) {
                const name = String(f.name || '').toLowerCase();
                const rank = String(f.academic_rank || '').toLowerCase();
                const dept = String(f.department || '').toLowerCase();
                if (!name.includes(q) && !rank.includes(q) && !dept.includes(q)) {
                    return;
                }
            }
            const progIdx = getFacultyProgramIndex(f);
            if (groups[progIdx]) {
                groups[progIdx].faculty.push(f);
            }
        });

        // Update selected count badge
        const badge = document.getElementById('exportSelectedCountBadge');
        if (badge) {
            const count = exportState.selectionMode === 'all' ? matching.length : exportState.selectedFacultyIds.size;
            badge.textContent = `Selected: ${count} of ${matching.length} faculty`;
        }

        if (matching.length === 0) {
            container.innerHTML = `
                <div class="py-8 text-center text-stone-400">
                    <i class="fa-solid fa-users-slash text-2xl mb-2"></i>
                    <p class="text-xs">No faculty members found for ${isPT ? 'Part-Time' : 'Organic'} type.</p>
                </div>
            `;
            return;
        }

        let html = '';
        groups.forEach(group => {
            if (group.faculty.length === 0) return;

            const allInGroupChecked = group.faculty.every(f => exportState.selectedFacultyIds.has(f.id));

            html += `
                <div class="bg-white rounded-xl border border-stone-200 overflow-hidden">
                    <div class="px-3 py-2 bg-stone-100/70 border-b border-stone-200 flex items-center justify-between">
                        <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-stone-800">
                            <input type="checkbox" onchange="toggleProgramChecklist(${group.index}, this.checked)" ${allInGroupChecked ? 'checked' : ''} class="export-checkbox rounded text-xs">
                            <span>${escapeHtml(group.shortName)}</span>
                        </label>
                        <span class="text-[10px] text-stone-500 font-semibold bg-white px-2 py-0.5 rounded-full border border-stone-200">${group.faculty.length}</span>
                    </div>
                    <div class="p-2.5 divide-y divide-stone-100">
            `;

            group.faculty.forEach(f => {
                const checked = exportState.selectedFacultyIds.has(f.id);
                html += `
                    <label class="flex items-center justify-between py-1.5 px-2 hover:bg-stone-50 rounded-lg cursor-pointer text-xs">
                        <div class="flex items-center gap-2.5">
                            <input type="checkbox" value="${f.id}" ${checked ? 'checked' : ''} onchange="toggleFacultyItemCheck(${f.id}, this.checked)" class="export-checkbox rounded">
                            <div>
                                <span class="font-semibold text-stone-800">${escapeHtml(f.name || `${f.first_name || ''} ${f.last_name || ''}`)}</span>
                                <span class="text-[11px] text-stone-400 ml-1.5">${escapeHtml(f.academic_rank || f.position || 'Faculty')}</span>
                            </div>
                        </div>
                        <span class="text-[10px] text-stone-400 font-mono">${escapeHtml(f.sex || '')}</span>
                    </label>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    // ==============================================================================
    // EVENT HANDLERS FOR CONFIGURATION MODAL
    // ==============================================================================

    window.openFacultyExportModal = async function () {
        try {
            discoverAcademicYears();
            await preloadBanners();
            await discoverSignatories();
            await fetchAllFacultyForExport();

            // Default to selecting all matching faculty
            const isPT = exportState.facultyType === 'parttime';
            const matching = exportState.facultyList.filter(f => isPT ? isPartTimeFaculty(f) : !isPartTimeFaculty(f));
            exportState.selectedFacultyIds = new Set(matching.map(f => f.id));

            renderExportModalHtml();
        } catch (err) {
            console.error('[FACULTY-EXPORT] Error opening modal:', err);
            alert('Unable to load faculty profiles for export. Please check connection and try again.');
        }
    };

    window.closeFacultyExportModal = function () {
        const modal = document.getElementById('facultyExportModal');
        if (modal) modal.remove();
    };

    window.onExportFacultyTypeCardClick = function (type) {
        window.onExportFacultyTypeChange(type);
    };

    window.onExportFacultyTypeChange = function (type) {
        exportState.facultyType = type;
        const isPT = type === 'parttime';
        const matching = exportState.facultyList.filter(f => isPT ? isPartTimeFaculty(f) : !isPartTimeFaculty(f));
        exportState.selectedFacultyIds = new Set(matching.map(f => f.id));
        renderExportModalHtml();
    };

    window.onExportFormatClick = function (format) {
        exportState.format = format;
        document.querySelectorAll('.export-format-card').forEach(card => {
            const isMatch = card.getAttribute('data-format') === format;
            card.classList.toggle('is-selected', isMatch);
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = isMatch;
        });
    };

    window.onExportSelectionModeChange = function (mode) {
        exportState.selectionMode = mode;
        const wrapper = document.getElementById('exportFacultyChecklistWrapper');
        if (wrapper) {
            if (mode === 'selected') {
                wrapper.classList.remove('hidden');
            } else {
                wrapper.classList.add('hidden');
                // Auto-select all matching
                const isPT = exportState.facultyType === 'parttime';
                const matching = exportState.facultyList.filter(f => isPT ? isPartTimeFaculty(f) : !isPartTimeFaculty(f));
                exportState.selectedFacultyIds = new Set(matching.map(f => f.id));
            }
        }
        renderExportFacultyChecklist();
    };

    window.onExportAcademicYearChange = function (val) {
        exportState.academicYear = val;
    };

    window.onExportFacultySearch = function (val) {
        renderExportFacultyChecklist(val);
    };

    window.selectAllExportFaculty = function (checkAll) {
        const isPT = exportState.facultyType === 'parttime';
        const matching = exportState.facultyList.filter(f => isPT ? isPartTimeFaculty(f) : !isPartTimeFaculty(f));
        if (checkAll) {
            exportState.selectedFacultyIds = new Set(matching.map(f => f.id));
        } else {
            exportState.selectedFacultyIds.clear();
        }
        renderExportFacultyChecklist();
    };

    window.toggleProgramChecklist = function (programIndex, isChecked) {
        const isPT = exportState.facultyType === 'parttime';
        const matching = exportState.facultyList.filter(f => isPT ? isPartTimeFaculty(f) : !isPartTimeFaculty(f));
        matching.forEach(f => {
            if (getFacultyProgramIndex(f) === programIndex) {
                if (isChecked) exportState.selectedFacultyIds.add(f.id);
                else exportState.selectedFacultyIds.delete(f.id);
            }
        });
        renderExportFacultyChecklist();
    };

    window.toggleFacultyItemCheck = function (facultyId, isChecked) {
        if (isChecked) exportState.selectedFacultyIds.add(facultyId);
        else exportState.selectedFacultyIds.delete(facultyId);

        const isPT = exportState.facultyType === 'parttime';
        const matching = exportState.facultyList.filter(f => isPT ? isPartTimeFaculty(f) : !isPartTimeFaculty(f));
        const badge = document.getElementById('exportSelectedCountBadge');
        if (badge) {
            badge.textContent = `Selected: ${exportState.selectedFacultyIds.size} of ${matching.length} faculty`;
        }
    };

    window.toggleSignatoriesSection = function () {
        const form = document.getElementById('signatoriesForm');
        const chev = document.getElementById('signatoriesChevron');
        if (form && chev) {
            form.classList.toggle('hidden');
            chev.classList.toggle('rotate-180');
        }
    };

    window.onSignatoryChange = function (field, value) {
        if (!exportState.signatories) {
            exportState.signatories = {};
        }
        exportState.signatories[field] = value;
    };

    // ==============================================================================
    // DOCUMENT PREVIEW MODAL & PAGINATION ENGINE
    // ==============================================================================

    function getExportRecordsToProcess() {
        const isPT = exportState.facultyType === 'parttime';
        const matching = exportState.facultyList.filter(f => isPT ? isPartTimeFaculty(f) : !isPartTimeFaculty(f));

        if (exportState.selectionMode === 'all') {
            return matching;
        }

        return matching.filter(f => exportState.selectedFacultyIds.has(f.id));
    }

    function checkMissingProfileWarnings(records) {
        const warnings = [];
        let missingDob = 0;
        let missingQuals = 0;
        let missingRank = 0;

        records.forEach(f => {
            if (!f.birthdate) missingDob++;
            if (!f.educational_qualification && !f.masters_degree && !f.doctorate_degree) missingQuals++;
            if (!f.academic_rank && !f.position) missingRank++;
        });

        if (missingDob > 0) {
            warnings.push(`${missingDob} faculty ${missingDob === 1 ? 'member is' : 'members are'} missing Date of Birth (Age will be left blank).`);
        }
        if (missingQuals > 0) {
            warnings.push(`${missingQuals} faculty ${missingQuals === 1 ? 'member is' : 'members are'} missing Educational Qualifications.`);
        }
        if (missingRank > 0) {
            warnings.push(`${missingRank} faculty ${missingRank === 1 ? 'member has' : 'members have'} no Academic Rank assigned.`);
        }

        return warnings;
    }

    /**
     * Builds paginated sheets for multi-page landscape preview
     */
    function buildPreviewPages(records) {
        const isPT = exportState.facultyType === 'parttime';
        const subtitle = isPT ? '(NON–RESIDENT INSTRUCTOR)' : '(ORGANIC FACULTY)';

        // Group records by 7 programs
        const grouped = PROGRAM_SECTIONS.map(prog => ({
            ...prog,
            records: []
        }));

        records.forEach(f => {
            const idx = getFacultyProgramIndex(f);
            if (grouped[idx]) grouped[idx].records.push(f);
        });

        // Determine pagination
        // Page budget: Page 1 has large institutional header + form box -> holds ~4 rows
        // Subsequent pages hold ~6 rows
        const pages = [];
        let currentPage = {
            pageNumber: 1,
            isFirstPage: true,
            sections: []
        };

        const ROWS_PAGE_1 = 4;
        const ROWS_SUBSEQUENT = 6;
        let currentCapacity = ROWS_PAGE_1;

        grouped.forEach(group => {
            const totalRecs = group.records.length;
            if (totalRecs === 0) {
                // If program has 0 records, include a single empty row if capacity allows or next page
                if (currentCapacity < 2) {
                    pages.push(currentPage);
                    currentPage = {
                        pageNumber: pages.length + 1,
                        isFirstPage: false,
                        sections: []
                    };
                    currentCapacity = ROWS_SUBSEQUENT;
                }
                currentPage.sections.push({
                    title: group.title,
                    rows: [{
                        no: '—',
                        lastName: '—',
                        firstName: '—',
                        middleName: '—',
                        rank: '—',
                        status: '—',
                        sex: '—',
                        dob: '—',
                        age: '—',
                        quals: ['NO FACULTY ASSIGNED'],
                        exp: '—',
                        elig: '—'
                    }]
                });
                currentCapacity -= 2;
                return;
            }

            let startIdx = 0;
            while (startIdx < totalRecs) {
                if (currentCapacity <= 1) {
                    pages.push(currentPage);
                    currentPage = {
                        pageNumber: pages.length + 1,
                        isFirstPage: false,
                        sections: []
                    };
                    currentCapacity = ROWS_SUBSEQUENT;
                }

                const take = Math.min(currentCapacity - 1, totalRecs - startIdx);
                const chunk = group.records.slice(startIdx, startIdx + take);

                const chunkRows = chunk.map((f, i) => {
                    const rowNo = startIdx + i + 1;
                    return {
                        no: String(rowNo),
                        lastName: (f.last_name || f.name?.split(' ').pop() || '').toUpperCase(),
                        firstName: (f.first_name || f.name?.split(' ')[0] || '').toUpperCase(),
                        middleName: (f.middle_name || '').toUpperCase(),
                        rank: (f.academic_rank || f.position || '').toUpperCase(),
                        status: (isPT ? (f.employment_type || f.contract_type || 'PART-TIME / COS') : (f.employment_type || 'REGULAR/ORGANIC')).toUpperCase(),
                        sex: (f.sex || '').toUpperCase().startsWith('M') ? 'M' : ((f.sex || '').toUpperCase().startsWith('F') ? 'F' : ''),
                        dob: formatBirthDate(f.birthdate),
                        age: calculateAge(f.birthdate),
                        quals: formatEducationalQualifications(f),
                        exp: formatExperience(f.years_experience),
                        elig: formatEligibility(f.eligibility)
                    };
                });

                currentPage.sections.push({
                    title: startIdx === 0 ? group.title : `${group.title} (Continued)`,
                    rows: chunkRows
                });

                startIdx += take;
                currentCapacity -= (take + 1);
            }
        });

        // Add final page
        pages.push(currentPage);
        return pages;
    }

    function renderPreviewSheetHtml(page, pageIndex, totalPages) {
        const isPT = exportState.facultyType === 'parttime';
        const subtitle = isPT ? '(NON–RESIDENT INSTRUCTOR)' : '(ORGANIC FACULTY)';

        const colPcts = (exportState.colPcts && exportState.colPcts.length === 12)
            ? exportState.colPcts
            : ['2.50%', '9.51%', '9.51%', '7.22%', '10.85%', '6.11%', '2.50%', '6.95%', '2.78%', '28.70%', '5.83%', '7.54%'];

        const namePersonnelWidth = (
            parseFloat(colPcts[0]) +
            parseFloat(colPcts[1]) +
            parseFloat(colPcts[2]) +
            parseFloat(colPcts[3])
        ).toFixed(2) + '%';

        let html = `
            <div class="cite-doc-sheet bg-white text-black font-['Arial_Narrow',Arial,sans-serif] p-8 shadow-2xl mx-auto border border-stone-300 relative select-text flex flex-col justify-between" style="width: 1100px; min-height: 720px; font-family: 'Arial Narrow', Arial, sans-serif;">
                <div>
        `;

        // 1. Institutional Header on Every Page (Official CTU Header Banner Centered)
        html += `
            <!-- Institutional Header (Horizontally Centered on Every Page) -->
            <div class="relative w-full pb-3 border-b-2 border-black mb-3 flex items-center justify-center">
                <img src="${bannerDataUrls.header}" alt="Cebu Technological University Header" class="h-16 w-auto max-w-[850px] object-contain mx-auto block" style="height: 64px; max-width: 850px; object-fit: contain;">
                ${page.isFirstPage ? `
                <!-- Right: HR Form 23B Box (Page 1 Only) -->
                <div class="absolute right-0 top-0 border border-black px-2.5 py-1 text-center bg-stone-50 leading-tight">
                    <p class="text-[9px] font-bold">HR Form 23B</p>
                    <p class="text-[8px] text-stone-600">June 2012</p>
                    <p class="text-[8px] font-semibold">Revision: 0</p>
                </div>
                ` : ''}
            </div>

            <!-- Document Title -->
            <div class="text-center my-2 leading-tight">
                <h2 class="text-xs font-bold uppercase tracking-wider text-black">COLLEGE OF TECHNOLOGY AND ENGINEERING</h2>
                <h3 class="text-sm font-bold uppercase tracking-wide text-black mt-0.5">FACULTY PROFILE AS TO THEIR EDUCATIONAL QUALIFICATION</h3>
                <p class="text-xs font-bold text-black mt-0.5">${subtitle}${!page.isFirstPage ? ` — Page ${pageIndex + 1} of ${totalPages}` : ''}</p>
                <p class="text-xs font-bold text-black mt-0.5">Academic Year ${escapeHtml(exportState.academicYear)}</p>
            </div>
        `;

        // 2. Program Sections with Dynamic 12-column Tables
        page.sections.forEach(sec => {
            html += `
                <div class="mt-3 mb-4">
                    <div class="text-[11px] font-bold uppercase text-black mb-1 tracking-wide">
                        ${escapeHtml(sec.title)}
                    </div>

                    <table class="w-full border-collapse border border-black text-[9px] table-fixed">
                        <thead>
                            <tr class="bg-stone-100 font-bold text-center leading-tight">
                                <th colspan="4" class="border border-black p-1 text-center" style="width: ${namePersonnelWidth};">NAME OF PERSONNEL</th>
                                <th class="border border-black p-1 text-center" style="width: ${colPcts[4]};">ACADEMIC RANK</th>
                                <th class="border border-black p-1 text-center" style="width: ${colPcts[5]};">STATUS</th>
                                <th class="border border-black p-1 text-center" style="width: ${colPcts[6]};">SEX</th>
                                <th class="border border-black p-1 text-center" style="width: ${colPcts[7]};">DATE OF BIRTH</th>
                                <th class="border border-black p-1 text-center" style="width: ${colPcts[8]};">AGE</th>
                                <th class="border border-black p-1 text-center" style="width: ${colPcts[9]};">EDUCATIONAL QUALIFICATION</th>
                                <th class="border border-black p-1 text-center" style="width: ${colPcts[10]};">EXPERIENCE</th>
                                <th class="border border-black p-1 text-center" style="width: ${colPcts[11]};">ELIGIBILITY</th>
                            </tr>
                            <tr class="bg-stone-50 text-[8px] font-bold text-center leading-tight">
                                <th class="border border-black p-0.5" style="width: ${colPcts[0]};">NO</th>
                                <th class="border border-black p-0.5" style="width: ${colPcts[1]};">LAST NAME</th>
                                <th class="border border-black p-0.5" style="width: ${colPcts[2]};">FIRST NAME</th>
                                <th class="border border-black p-0.5" style="width: ${colPcts[3]};">MIDDLE NAME</th>
                                <th class="border border-black p-0.5"></th>
                                <th class="border border-black p-0.5"></th>
                                <th class="border border-black p-0.5"></th>
                                <th class="border border-black p-0.5"></th>
                                <th class="border border-black p-0.5"></th>
                                <th class="border border-black p-0.5"></th>
                                <th class="border border-black p-0.5"></th>
                                <th class="border border-black p-0.5"></th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            sec.rows.forEach(r => {
                const qualHtml = r.quals && r.quals.length
                    ? r.quals.map(q => `<div class="leading-tight mb-0.5">• ${escapeHtml(q)}</div>`).join('')
                    : '<span class="text-stone-400">—</span>';

                html += `
                    <tr class="hover:bg-amber-50/40 text-black leading-tight">
                        <td class="border border-black p-1 text-center font-bold break-words">${escapeHtml(r.no)}</td>
                        <td class="border border-black p-1 text-center font-semibold break-words">${escapeHtml(r.lastName)}</td>
                        <td class="border border-black p-1 text-center break-words">${escapeHtml(r.firstName)}</td>
                        <td class="border border-black p-1 text-center break-words">${escapeHtml(r.middleName)}</td>
                        <td class="border border-black p-1 text-center break-words">${escapeHtml(r.rank)}</td>
                        <td class="border border-black p-1 text-center font-medium break-words">${escapeHtml(r.status)}</td>
                        <td class="border border-black p-1 text-center break-words">${escapeHtml(r.sex)}</td>
                        <td class="border border-black p-1 text-center break-words">${escapeHtml(r.dob)}</td>
                        <td class="border border-black p-1 text-center break-words">${escapeHtml(r.age)}</td>
                        <td class="border border-black p-1 text-left align-top break-words">${qualHtml}</td>
                        <td class="border border-black p-1 text-center break-words">${escapeHtml(r.exp)}</td>
                        <td class="border border-black p-1 text-left align-top break-words">${escapeHtml(r.elig)}</td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            `;
        });

        // 3. Signatories Block on the Final Page (All 3 Signatories side-by-side in ONE horizontal row)
        if (pageIndex === totalPages - 1) {
            const prepName = (exportState.signatories && exportState.signatories.preparedByName) || 'CHRISTINE MARY N. LIM';
            const prepTitle = (exportState.signatories && exportState.signatories.preparedByTitle) || 'COTE Secretary';
            const certName = (exportState.signatories && exportState.signatories.certifiedByName) || 'FRITZ D. BACALSO, Ph. D.';
            const certTitle = (exportState.signatories && exportState.signatories.certifiedByTitle) || 'Dean, COTE';
            const notedName = (exportState.signatories && exportState.signatories.notedByName) || 'EINGILBERT C. BENOLIRAO, Dev. Ed. D';
            const notedTitle = (exportState.signatories && exportState.signatories.notedByTitle) || 'Campus Director';

            html += `
                <div class="mt-6 pt-4 w-full text-[10px] leading-snug break-inside-avoid" style="page-break-inside: avoid; break-inside: avoid;">
                    <table style="width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 auto;">
                        <tbody>
                            <tr>
                                <!-- 1. Prepared by — COTE Secretary -->
                                <td style="width: 33.333%; text-align: center; vertical-align: top; padding: 0 12px;">
                                    <p class="font-bold mb-8 text-black text-[10px]">Prepared by:</p>
                                    <div class="w-48 mx-auto border-b border-black mb-1.5"></div>
                                    <p class="font-bold uppercase text-black text-[10px] tracking-wide max-w-[220px] mx-auto break-words leading-tight">${escapeHtml(prepName)}</p>
                                    <p class="text-[9px] text-black font-medium max-w-[220px] mx-auto break-words mt-0.5 leading-tight">${escapeHtml(prepTitle)}</p>
                                </td>
                                <!-- 2. Certified Correct — Dean, COTE -->
                                <td style="width: 33.333%; text-align: center; vertical-align: top; padding: 0 12px;">
                                    <p class="font-bold mb-8 text-black text-[10px]">Certified Correct:</p>
                                    <div class="w-48 mx-auto border-b border-black mb-1.5"></div>
                                    <p class="font-bold uppercase text-black text-[10px] tracking-wide max-w-[220px] mx-auto break-words leading-tight">${escapeHtml(certName)}</p>
                                    <p class="text-[9px] text-black font-medium max-w-[220px] mx-auto break-words mt-0.5 leading-tight">${escapeHtml(certTitle)}</p>
                                </td>
                                <!-- 3. Noted By — Campus Director -->
                                <td style="width: 33.333%; text-align: center; vertical-align: top; padding: 0 12px;">
                                    <p class="font-bold mb-8 text-black text-[10px]">Noted By:</p>
                                    <div class="w-48 mx-auto border-b border-black mb-1.5"></div>
                                    <p class="font-bold uppercase text-black text-[10px] tracking-wide max-w-[220px] mx-auto break-words leading-tight">${escapeHtml(notedName)}</p>
                                    <p class="text-[9px] text-black font-medium max-w-[220px] mx-auto break-words mt-0.5 leading-tight">${escapeHtml(notedTitle)}</p>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
        }

        html += `</div>`;

        // 4. Institutional Footer (Official CTU Footer Banner on every page)
        html += `
            <div class="mt-auto pt-3 border-t border-stone-200 flex flex-col items-center">
                <img src="${bannerDataUrls.footer}" alt="Cebu Technological University Footer" class="h-6 w-auto max-w-[850px] object-contain mb-1">
                <div class="w-full flex items-center justify-between text-[8px] text-stone-500">
                    <span>Cebu Technological University — College of Technology and Engineering</span>
                    <span>Page ${pageIndex + 1} of ${totalPages}</span>
                </div>
            </div>
        </div>`;

        return html;
    }

    window.generateFacultyExportPreview = function () {
        const records = getExportRecordsToProcess().filter(f => !isTestOrAdminAccount(f));
        if (records.length === 0) {
            alert('No faculty records selected for export. Please select at least one faculty member.');
            return;
        }

        exportState.warnings = checkMissingProfileWarnings(records);
        exportState.optimalWidths = calculateOptimalColumnWidths(records, 17995);
        exportState.colPcts = exportState.optimalWidths.map(w => ((w / 17995) * 100).toFixed(2) + '%');
        exportState.previewPages = buildPreviewPages(records);
        exportState.totalPages = exportState.previewPages.length;
        exportState.currentPreviewPage = 1;
        exportState.zoomLevel = 1.0;

        renderPreviewModalHtml();
    };

    function renderPreviewModalHtml() {
        let existing = document.getElementById('facultyPreviewModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'facultyPreviewModal';
        modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-md flex flex-col z-[10000] animate-fade-in';
        modal.innerHTML = `
            <!-- Top Toolbar -->
            <div class="export-preview-toolbar px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-md z-10">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-white text-sm">
                        <i class="fa-solid fa-file-lines"></i>
                    </div>
                    <div>
                        <h2 class="text-sm font-bold tracking-tight">Document Preview — HR Form 23B</h2>
                        <p class="text-[11px] text-white/80">${exportState.facultyType === 'organic' ? 'Organic Faculty' : 'Part-Time Faculty'} | AY ${escapeHtml(exportState.academicYear)}</p>
                    </div>
                </div>

                <!-- Navigation & Zoom Controls -->
                <div class="flex items-center gap-2">
                    <!-- Page Prev / Next -->
                    <div class="flex items-center bg-black/20 rounded-xl px-1 py-0.5">
                        <button type="button" onclick="changePreviewPage(-1)" class="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white text-xs transition-colors" title="Previous Page">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <span id="previewPageIndicator" class="px-3 text-xs font-semibold">
                            Page 1 of ${exportState.totalPages}
                        </span>
                        <button type="button" onclick="changePreviewPage(1)" class="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white text-xs transition-colors" title="Next Page">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>

                    <div class="h-4 w-px bg-white/20 mx-1 hidden sm:block"></div>

                    <!-- Zoom In / Out -->
                    <div class="flex items-center bg-black/20 rounded-xl px-1 py-0.5 hidden sm:flex">
                        <button type="button" onclick="changePreviewZoom(-0.1)" class="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white text-xs transition-colors" title="Zoom Out">
                            <i class="fa-solid fa-minus"></i>
                        </button>
                        <span id="previewZoomIndicator" class="px-2 text-xs font-mono font-medium">100%</span>
                        <button type="button" onclick="changePreviewZoom(0.1)" class="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white text-xs transition-colors" title="Zoom In">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                        <button type="button" onclick="resetPreviewZoom()" class="px-2 py-1 text-[11px] rounded hover:bg-white/10 font-semibold" title="Reset Zoom">Fit</button>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="flex items-center gap-2">
                    <button type="button" onclick="downloadFacultyDocx()" class="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-colors">
                        <i class="fa-solid fa-file-word"></i>
                        <span>Download Word (.docx)</span>
                    </button>

                    <button type="button" onclick="downloadFacultyPdf()" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-colors">
                        <i class="fa-solid fa-file-pdf"></i>
                        <span>Download PDF</span>
                    </button>

                    <button type="button" onclick="closeFacultyPreviewModal()" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors ml-1">
                        <i class="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>
            </div>

            <!-- Non-blocking Warning Banner (if missing info) -->
            ${exportState.warnings.length > 0 ? `
                <div id="previewWarningBanner" class="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center justify-between text-xs text-amber-900 animate-slide-down">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-triangle-exclamation text-amber-600 text-sm"></i>
                        <div>
                            <span class="font-bold">Profile Notice:</span>
                            <span>${escapeHtml(exportState.warnings.join(' | '))}</span>
                        </div>
                    </div>
                    <button type="button" onclick="document.getElementById('previewWarningBanner').remove()" class="text-amber-700 hover:text-amber-900 text-xs font-semibold px-2">Dismiss</button>
                </div>
            ` : ''}

            <!-- Main Document Viewer Container -->
            <div id="previewDocViewport" class="flex-1 overflow-auto bg-stone-300/80 p-6 flex justify-center items-start">
                <div id="previewDocZoomWrapper" class="transition-transform duration-150 origin-top">
                    <!-- Sheet content rendered by updatePreviewSheet() -->
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        updatePreviewSheet();
    }

    function updatePreviewSheet() {
        const wrapper = document.getElementById('previewDocZoomWrapper');
        if (!wrapper) return;

        const pIdx = exportState.currentPreviewPage - 1;
        const page = exportState.previewPages[pIdx];
        if (!page) return;

        wrapper.style.transform = `scale(${exportState.zoomLevel})`;
        wrapper.innerHTML = renderPreviewSheetHtml(page, pIdx, exportState.totalPages);

        const pageInd = document.getElementById('previewPageIndicator');
        if (pageInd) {
            pageInd.textContent = `Page ${exportState.currentPreviewPage} of ${exportState.totalPages}`;
        }

        const zoomInd = document.getElementById('previewZoomIndicator');
        if (zoomInd) {
            zoomInd.textContent = `${Math.round(exportState.zoomLevel * 100)}%`;
        }
    }

    window.goToPreviewPage = function (pageNum) {
        if (pageNum >= 1 && pageNum <= exportState.totalPages) {
            exportState.currentPreviewPage = pageNum;
            updatePreviewSheet();
            const vp = document.getElementById('previewDocViewport');
            if (vp) vp.scrollTop = 0;
        }
    };

    window.changePreviewPage = function (delta) {
        const next = exportState.currentPreviewPage + delta;
        if (next >= 1 && next <= exportState.totalPages) {
            exportState.currentPreviewPage = next;
            updatePreviewSheet();
            const vp = document.getElementById('previewDocViewport');
            if (vp) vp.scrollTop = 0;
        }
    };

    window.changePreviewZoom = function (delta) {
        const next = Math.max(0.4, Math.min(2.0, exportState.zoomLevel + delta));
        exportState.zoomLevel = next;
        updatePreviewSheet();
    };

    window.resetPreviewZoom = function () {
        exportState.zoomLevel = 1.0;
        updatePreviewSheet();
    };

    window.closeFacultyPreviewModal = function () {
        const modal = document.getElementById('facultyPreviewModal');
        if (modal) modal.remove();
    };

    // ==============================================================================
    // DOCX GENERATION ENGINE (USING OFFICIAL TEMPLATE & JSZIP)
    // ==============================================================================

    function buildDocxCellXml(tcPr, lines, jc = 'center', fontSize = '18', cellWidth = null) {
        let paragraphsXml = '';
        const safeLines = (lines && lines.length) ? lines : [''];
        for (const line of safeLines) {
            paragraphsXml += `<w:p><w:pPr><w:pStyle w:val="7"/><w:jc w:val="${jc}"/><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow" w:cs="Tahoma"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow" w:cs="Tahoma"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
        }
        let updatedTcPr = tcPr;
        if (cellWidth) {
            if (/<w:tcW\s+w:w="\d+"/.test(updatedTcPr)) {
                updatedTcPr = updatedTcPr.replace(/<w:tcW\s+w:w="\d+"/, `<w:tcW w:w="${cellWidth}"`);
            } else {
                updatedTcPr = updatedTcPr.replace(/<w:tcPr>/, `<w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>`);
            }
        }
        return `<w:tc>${updatedTcPr}${paragraphsXml}</w:tc>`;
    }

    function buildDocxRowXml(sampleRowStr, rowData, widths) {
        const tcRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g;
        const sampleCells = sampleRowStr.match(tcRegex) || [];

        const trPrMatch = sampleRowStr.match(/<w:trPr[\s\S]*?<\/w:trPr>/);
        const trPr = trPrMatch ? trPrMatch[0] : '<w:trPr><w:trHeight w:val="485" w:hRule="atLeast"/><w:jc w:val="center"/></w:trPr>';
        const tblPrExMatch = sampleRowStr.match(/<w:tblPrEx[\s\S]*?<\/w:tblPrEx>/);
        const tblPrEx = tblPrExMatch ? tblPrExMatch[0] : '';

        let rowCellsXml = '';
        for (let i = 0; i < 12; i++) {
            const sc = sampleCells[i] || '';
            const tcPrMatch = sc.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
            const tcPr = tcPrMatch ? tcPrMatch[0] : '<w:tcPr><w:vAlign w:val="center"/></w:tcPr>';

            const d = rowData[i];
            const lines = Array.isArray(d) ? d : [d != null ? String(d) : ''];
            const jc = (i === 9 || i === 11) ? 'left' : 'center';
            const w = (widths && widths[i]) ? widths[i] : null;
            rowCellsXml += buildDocxCellXml(tcPr, lines, jc, '18', w);
        }

        return `<w:tr>${tblPrEx}${trPr}${rowCellsXml}</w:tr>`;
    }

    function buildSignatoriesDocxXml(prepName, prepTitle, certName, certTitle, notedName, notedTitle) {
        return `<w:tbl>` +
            `<w:tblPr>` +
                `<w:tblW w:w="16380" w:type="dxa"/>` +
                `<w:jc w:val="center"/>` +
                `<w:tblBorders>` +
                    `<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/>` +
                    `<w:insideH w:val="none"/><w:insideV w:val="none"/>` +
                `</w:tblBorders>` +
            `</w:tblPr>` +
            `<w:tblGrid>` +
                `<w:gridCol w:w="5460"/>` +
                `<w:gridCol w:w="5460"/>` +
                `<w:gridCol w:w="5460"/>` +
            `</w:tblGrid>` +
            `<w:tr>` +
                `<w:trPr><w:cantSplit/></w:trPr>` +
                `<!-- Column 1: Prepared by — COTE Secretary -->` +
                `<w:tc>` +
                    `<w:tcPr><w:tcW w:w="5460" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="720"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:sz w:val="20"/></w:rPr><w:t>Prepared by:</w:t></w:r></w:p>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:u w:val="single"/><w:sz w:val="22"/></w:rPr><w:t>${prepName}</w:t></w:r></w:p>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:sz w:val="18"/></w:rPr><w:t>${prepTitle}</w:t></w:r></w:p>` +
                `</w:tc>` +
                `<!-- Column 2: Certified Correct — Dean, COTE -->` +
                `<w:tc>` +
                    `<w:tcPr><w:tcW w:w="5460" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="720"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:sz w:val="20"/></w:rPr><w:t>Certified Correct:</w:t></w:r></w:p>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:u w:val="single"/><w:sz w:val="22"/></w:rPr><w:t>${certName}</w:t></w:r></w:p>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:sz w:val="18"/></w:rPr><w:t>${certTitle}</w:t></w:r></w:p>` +
                `</w:tc>` +
                `<!-- Column 3: Noted By — Campus Director -->` +
                `<w:tc>` +
                    `<w:tcPr><w:tcW w:w="5460" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="720"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:sz w:val="20"/></w:rPr><w:t>Noted By:</w:t></w:r></w:p>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:u w:val="single"/><w:sz w:val="22"/></w:rPr><w:t>${notedName}</w:t></w:r></w:p>` +
                    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:sz w:val="18"/></w:rPr><w:t>${notedTitle}</w:t></w:r></w:p>` +
                `</w:tc>` +
            `</w:tr>` +
        `</w:tbl>`;
    }

    async function generateDocxBlob() {
        // 0. Filter out test/admin accounts
        const records = getExportRecordsToProcess().filter(f => !isTestOrAdminAccount(f));

        if (typeof window.JSZip === 'undefined') {
            console.warn('[FACULTY-EXPORT] JSZip not found on window, calling server endpoint fallback...');
            const resp = await fetch('/api/faculty-export/docx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    facultyType: exportState.facultyType,
                    academicYear: exportState.academicYear,
                    signatories: exportState.signatories,
                    records: records
                })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`Export failed on server: ${errText || resp.status}`);
            }
            return await resp.blob();
        }

        const isPT = exportState.facultyType === 'parttime';
        const templateUrl = isPT
            ? '/admin/templates/parttime-faculty-template.docx'
            : '/admin/templates/organic-faculty-template.docx';

        // 1. Fetch template binary
        const resp = await fetch(templateUrl);
        if (!resp.ok) {
            throw new Error(`Failed to load template from ${templateUrl}: ${resp.status}`);
        }
        const templateArrayBuffer = await resp.arrayBuffer();

        // 2. Open zip
        const zip = await window.JSZip.loadAsync(templateArrayBuffer);
        let docXml = await zip.file('word/document.xml').async('text');

        // 3. Remove handwritten signature images while strictly preserving institutional header/footer branding
        docXml = stripSignatures(docXml);

        // Ensure header banner paragraph is horizontally centered
        docXml = docXml.replace(/(<w:p(?:\s[^>]*)?>)(<w:pPr>)([\s\S]*?)(<\/w:pPr>)([\s\S]*?rId6[\s\S]*?<\/w:p>)/, (match, pStart, prStart, prBody, prEnd, pRest) => {
            if (!prBody.includes('<w:jc')) {
                return `${pStart}${prStart}${prBody}<w:jc w:val="center"/>${prEnd}${pRest}`;
            } else {
                return `${pStart}${prStart}${prBody.replace(/<w:jc\s+w:val="[^"]*"/, '<w:jc w:val="center"')}${prEnd}${pRest}`;
            }
        });

        // 4. Compute optimal column widths based on actual data
        const optimalWidths = calculateOptimalColumnWidths(records, 17995);
        const tblGridXml = `<w:tblGrid>${optimalWidths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;

        // 5. Update Academic Year in word/document.xml (strictly bounded to single paragraph)
        const ayRegex = /<w:p(?:\s[^>]*)?>((?:(?!<\/w:p>)[\s\S])*?Academic Year(?:(?!<\/w:p>)[\s\S])*?)<\/w:p>/;
        docXml = docXml.replace(ayRegex, () => {
            return `<w:p><w:pPr><w:pStyle w:val="7"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">Academic Year ${escapeXml(exportState.academicYear)}</w:t></w:r></w:p>`;
        });

        // 6. Update Signatories with Admin-configured or template default values (arranged in a 3-column side-by-side row)
        const prepName = (exportState.signatories && exportState.signatories.preparedByName) || 'CHRISTINE MARY N. LIM';
        const certName = (exportState.signatories && exportState.signatories.certifiedByName) || 'FRITZ D. BACALSO, Ph. D.';
        const notedName = (exportState.signatories && exportState.signatories.notedByName) || 'EINGILBERT C. BENOLIRAO, Dev. Ed. D';
        const prepTitle = (exportState.signatories && exportState.signatories.preparedByTitle) || 'COTE Secretary';
        const certTitle = (exportState.signatories && exportState.signatories.certifiedByTitle) || 'Dean, COTE';
        const notedTitle = (exportState.signatories && exportState.signatories.notedByTitle) || 'Campus Director';

        const prepIdx = docXml.indexOf('Prepared by:');
        if (prepIdx !== -1) {
            const pStart = docXml.lastIndexOf('<w:p', prepIdx);
            const footerIdx = docXml.indexOf('rId10');
            if (pStart !== -1 && footerIdx !== -1) {
                const footerP = docXml.lastIndexOf('<w:p', footerIdx);
                if (footerP > pStart) {
                    const sigTblXml = buildSignatoriesDocxXml(
                        escapeXml(prepName),
                        escapeXml(prepTitle),
                        escapeXml(certName),
                        escapeXml(certTitle),
                        escapeXml(notedName),
                        escapeXml(notedTitle)
                    );
                    docXml = docXml.substring(0, pStart) + sigTblXml + docXml.substring(footerP);
                }
            }
        }

        // 7. Group active records into 7 programs
        const grouped = PROGRAM_SECTIONS.map(() => []);
        records.forEach(f => {
            const idx = getFacultyProgramIndex(f);
            if (grouped[idx]) grouped[idx].push(f);
        });

        // 8. Replace tables in word/document.xml with dynamic column widths
        const tblRegex = /<w:tbl[\s>][\s\S]*?<\/w:tbl>/g;
        const tables = docXml.match(tblRegex) || [];

        let newDocXml = docXml;

        for (let tIdx = 0; tIdx < tables.length && tIdx < 7; tIdx++) {
            const tbl = tables[tIdx];
            const trRegex = /<w:tr[\s>][\s\S]*?<\/w:tr>/g;
            const trs = tbl.match(trRegex) || [];
            if (trs.length < 3) continue;

            const headerRow1 = trs[0];
            const headerRow2 = trs[1];
            const sampleRow = trs[2];

            const tblHeaderMatch = tbl.match(/<w:tbl[\s\S]*?(?=<w:tr[\s>])/);
            let tblPrefix = tblHeaderMatch ? tblHeaderMatch[0] : '<w:tbl>';
            tblPrefix = tblPrefix.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, tblGridXml);

            const updatedH1 = updateHeaderRow1Widths(headerRow1, optimalWidths);
            const updatedH2 = updateHeaderRow2Widths(headerRow2, optimalWidths);

            let newRowsXml = updatedH1 + updatedH2;
            const facultyGroup = grouped[tIdx] || [];

            if (facultyGroup.length === 0) {
                // If no faculty in this program, provide one clean empty row to preserve table structure
                const emptyData = ['—', '—', '—', '—', '—', '—', '—', '—', '—', ['NO RECORD'], '—', '—'];
                newRowsXml += buildDocxRowXml(sampleRow, emptyData, optimalWidths);
            } else {
                for (let r = 0; r < facultyGroup.length; r++) {
                    const f = facultyGroup[r];
                    const rowData = [
                        String(r + 1),
                        (f.last_name || f.name?.split(' ').pop() || '').toUpperCase(),
                        (f.first_name || f.name?.split(' ')[0] || '').toUpperCase(),
                        (f.middle_name || '').toUpperCase(),
                        (f.academic_rank || f.position || '').toUpperCase(),
                        (isPT ? (f.employment_type || f.contract_type || 'PART-TIME / COS') : (f.employment_type || 'REGULAR/ORGANIC')).toUpperCase(),
                        (f.sex || '').toUpperCase().startsWith('M') ? 'M' : ((f.sex || '').toUpperCase().startsWith('F') ? 'F' : ''),
                        formatBirthDate(f.birthdate),
                        calculateAge(f.birthdate),
                        formatEducationalQualifications(f),
                        formatExperience(f.years_experience),
                        formatEligibility(f.eligibility)
                    ];
                    newRowsXml += buildDocxRowXml(sampleRow, rowData, optimalWidths);
                }
            }

            const newTblXml = tblPrefix + newRowsXml + '</w:tbl>';
            newDocXml = newDocXml.replace(tbl, () => newTblXml);
        }

        zip.file('word/document.xml', newDocXml);
        return await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
    }

    window.downloadFacultyDocx = async function () {
        try {
            const isPT = exportState.facultyType === 'parttime';
            const ayClean = String(exportState.academicYear || '2026-2027').replace(/[^0-9-]/g, '-').replace(/-+/g, '-');
            const filename = `COTE-Faculty-Profile-AY-${ayClean}_${isPT ? 'Parttimer' : 'Organic'}.docx`;

            // Visual feedback
            const toast = window.CiteFlowSystemUi?.toast || alert;

            const blob = await generateDocxBlob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            if (window.CiteFlowSystemUi?.toast) {
                window.CiteFlowSystemUi.toast('Word (.docx) export completed successfully.', 'success');
            }
        } catch (err) {
            console.error('[FACULTY-EXPORT] Error generating DOCX:', err);
            alert(`Failed to generate Word document: ${err.message}`);
        }
    };

    // ==============================================================================
    // PDF GENERATION & BROWSER PRINT ENGINE
    // ==============================================================================

    window.downloadFacultyPdf = async function () {
        let wrapper = null;
        try {
            const isPT = exportState.facultyType === 'parttime';
            const ayClean = String(exportState.academicYear || '2026-2027').replace(/[^0-9-]/g, '-').replace(/-+/g, '-');
            const filename = `COTE-Faculty-Profile-AY-${ayClean}_${isPT ? 'Parttimer' : 'Organic'}.pdf`;

            // Check if html2pdf is available
            if (typeof window.html2pdf !== 'function') {
                throw new Error('html2pdf library is not loaded. Please refresh the page and try again.');
            }

            const records = getExportRecordsToProcess();
            if (!records || records.length === 0) {
                alert('No eligible faculty records selected for export.');
                return;
            }

            // Ensure optimal column widths are calculated for selected records
            calculateOptimalColumnWidths(records, 17995);

            // Preload banners
            await preloadBanners();

            const pages = buildPreviewPages(records);
            if (!pages || pages.length === 0) {
                throw new Error('Failed to generate document pages.');
            }

            // Build off-screen wrapper that preserves normal in-flow layout for children
            wrapper = document.createElement('div');
            wrapper.id = 'citeflow-pdf-render-wrapper';
            wrapper.style.position = 'fixed';
            wrapper.style.left = '0';
            wrapper.style.top = '0';
            wrapper.style.width = '1px';
            wrapper.style.height = '1px';
            wrapper.style.overflow = 'hidden';
            wrapper.style.opacity = '0';
            wrapper.style.pointerEvents = 'none';
            wrapper.style.zIndex = '-9999';

            // printContainer sits in normal flow inside the wrapper
            const printContainer = document.createElement('div');
            printContainer.id = 'citeflow-pdf-print-container';
            printContainer.style.width = '1100px';
            printContainer.style.backgroundColor = '#ffffff';

            pages.forEach((p, idx) => {
                const temp = document.createElement('div');
                temp.innerHTML = renderPreviewSheetHtml(p, idx, pages.length);
                const pageEl = temp.firstElementChild;
                printContainer.appendChild(pageEl);

                if (idx < pages.length - 1) {
                    const pageBreak = document.createElement('div');
                    pageBreak.className = 'html2pdf__page-break';
                    pageBreak.style.pageBreakAfter = 'always';
                    pageBreak.style.breakAfter = 'always';
                    printContainer.appendChild(pageBreak);
                }
            });

            wrapper.appendChild(printContainer);
            document.body.appendChild(wrapper);

            // Wait for all images in printContainer to be fully loaded and decoded
            const images = Array.from(printContainer.querySelectorAll('img'));
            await Promise.all(images.map(img => {
                if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
                return new Promise(resolve => {
                    img.onload = resolve;
                    img.onerror = resolve;
                });
            }));

            // Wait for fonts to be ready
            if (document.fonts && document.fonts.ready) {
                try { await document.fonts.ready; } catch (_) { }
            }

            const opt = {
                margin: [0.25, 0.35, 0.25, 0.35],
                filename: filename,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    letterRendering: true,
                    scrollX: 0,
                    scrollY: 0
                },
                jsPDF: { unit: 'in', format: [13, 8.5], orientation: 'landscape' },
                pagebreak: { mode: ['css', 'legacy'] }
            };

            await window.html2pdf().set(opt).from(printContainer).save();

            if (wrapper && wrapper.parentNode) {
                wrapper.parentNode.removeChild(wrapper);
                wrapper = null;
            }

            if (window.CiteFlowSystemUi?.toast) {
                window.CiteFlowSystemUi.toast('PDF export completed successfully.', 'success');
            }
        } catch (err) {
            if (wrapper && wrapper.parentNode) {
                wrapper.parentNode.removeChild(wrapper);
            }
            console.error('[FACULTY-EXPORT] Error generating PDF:', err);
            alert(`Failed to generate PDF document: ${err.message || err}. Please try again.`);
        }
    };

    function printFacultyProfileIframe() {
        const records = getExportRecordsToProcess();
        const pages = buildPreviewPages(records);

        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Faculty Profile Export</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                    @page {
                        size: 13in 8.5in landscape;
                        margin: 0.3in 0.4in;
                    }
                    @media print {
                        body { background: #fff !important; }
                        .cite-doc-sheet {
                            width: 100% !important;
                            box-shadow: none !important;
                            border: none !important;
                            padding: 0 !important;
                            page-break-after: always;
                        }
                        .cite-doc-sheet:last-child {
                            page-break-after: auto;
                        }
                    }
                </style>
            </head>
            <body class="bg-white">
                ${pages.map((p, idx) => renderPreviewSheetHtml(p, idx, pages.length)).join('')}
            </body>
            </html>
        `);
        doc.close();

        iframe.contentWindow.focus();
        setTimeout(() => {
            iframe.contentWindow.print();
            setTimeout(() => document.body.removeChild(iframe), 2000);
        }, 800);
    }

    window.triggerDirectExportDownload = function () {
        if (exportState.format === 'pdf') {
            window.downloadFacultyPdf();
        } else {
            window.downloadFacultyDocx();
        }
    };

    console.log('✅ CITE-Flow Faculty Export Module initialized');
})();
