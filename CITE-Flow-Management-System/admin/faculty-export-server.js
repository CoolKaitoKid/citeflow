const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function escapeXml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
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

    records.forEach(f => {
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

function buildCell(tcPr, lines, jc = 'center', fontSize = '18', cellWidth = null) {
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

function buildRow(sampleRowStr, rowData, widths) {
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
        rowCellsXml += buildCell(tcPr, lines, jc, '18', w);
    }

    return `<w:tr>${tblPrEx}${trPr}${rowCellsXml}</w:tr>`;
}

function stripSignatures(docXml) {
    // Strips drawings that embed rId7, rId8, rId9 (the three signature images) or reference signature files
    return docXml.replace(/<w:drawing[\s>][\s\S]*?<\/w:drawing>/g, (drawingXml) => {
        const isSignature = /r:embed="(?:rId7|rId8|rId9)"/.test(drawingXml) ||
                            /image[234]\.(?:jpeg|png|jpg)/.test(drawingXml);
        if (isSignature) {
            return '';
        }
        return drawingXml;
    });
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

function formatBirthDate(birthdate) {
    if (!birthdate) return '';
    try {
        const parts = String(birthdate).slice(0, 10).split('-');
        if (parts.length === 3) {
            const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
            return `${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
        }
    } catch (_) {}
    return '';
}

function calculateAge(birthdate) {
    if (!birthdate) return '';
    try {
        const parts = String(birthdate).slice(0, 10).split('-');
        if (parts.length === 3) {
            const bDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            const now = new Date();
            let age = now.getFullYear() - bDate.getFullYear();
            const m = now.getMonth() - bDate.getMonth();
            if (m < 0 || (m === 0 && now.getDate() < bDate.getDate())) age--;
            return (age > 0 && age < 120) ? String(age) : '';
        }
    } catch (_) {}
    return '';
}

function formatQualifications(f) {
    const lines = [];
    if (f.educational_qualification) {
        String(f.educational_qualification).split(/\r?\n|;/).forEach(l => {
            const trimmed = l.trim().replace(/^[-•*]\s*/, '');
            if (trimmed) lines.push(trimmed.toUpperCase());
        });
    }
    if (f.masters_degree && String(f.masters_degree).trim()) {
        const m = String(f.masters_degree).trim().toUpperCase();
        if (!lines.some(l => l.includes(m))) lines.push(`MASTER'S DEGREE: ${m}`);
    }
    if (f.doctorate_degree && String(f.doctorate_degree).trim()) {
        const d = String(f.doctorate_degree).trim().toUpperCase();
        if (!lines.some(l => l.includes(d))) lines.push(`DOCTORATE DEGREE: ${d}`);
    }
    return lines;
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
        return 5;
    }
    return 0;
}

async function generateFacultyDocxBuffer(options = {}) {
    const {
        facultyType = 'organic',
        academicYear = '2026–2027',
        signatories = {},
        records = []
    } = options;

    const isPT = facultyType === 'parttime';
    const templateFileName = isPT ? 'parttime-faculty-template.docx' : 'organic-faculty-template.docx';
    const templatePath = path.join(__dirname, 'templates', templateFileName);

    const templateBuf = fs.readFileSync(templatePath);
    const zip = await JSZip.loadAsync(templateBuf);
    let docXml = await zip.file('word/document.xml').async('text');

    // 1. Remove handwritten signature images while strictly preserving institutional header/footer branding
    docXml = stripSignatures(docXml);

    // Ensure header banner paragraph is horizontally centered
    docXml = docXml.replace(/(<w:p(?:\s[^>]*)?>)(<w:pPr>)([\s\S]*?)(<\/w:pPr>)([\s\S]*?rId6[\s\S]*?<\/w:p>)/, (match, pStart, prStart, prBody, prEnd, pRest) => {
        if (!prBody.includes('<w:jc')) {
            return `${pStart}${prStart}${prBody}<w:jc w:val="center"/>${prEnd}${pRest}`;
        } else {
            return `${pStart}${prStart}${prBody.replace(/<w:jc\s+w:val="[^"]*"/, '<w:jc w:val="center"')}${prEnd}${pRest}`;
        }
    });

    // 2. Filter out administrative test, sample, and placeholder accounts
    const cleanRecords = (records || []).filter(f => !isTestOrAdminAccount(f));

    // 3. Compute optimal column widths based on actual data
    const optimalWidths = calculateOptimalColumnWidths(cleanRecords, 17995);
    const tblGridXml = `<w:tblGrid>${optimalWidths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;

    // 4. Replace Academic Year (strictly bounded to single paragraph)
    const ayRegex = /<w:p(?:\s[^>]*)?>((?:(?!<\/w:p>)[\s\S])*?Academic Year(?:(?!<\/w:p>)[\s\S])*?)<\/w:p>/;
    docXml = docXml.replace(ayRegex, () => {
        return `<w:p><w:pPr><w:pStyle w:val="7"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">Academic Year ${escapeXml(academicYear)}</w:t></w:r></w:p>`;
    });

    // 5. Signatory Section:
    // Arrange all 3 signatories side-by-side in ONE horizontal row (3 equal-width columns)
    // Display original signatory names from templates as defaults, allowing Admin edits.
    // Preserve designations and order. Remove handwritten signature graphics.
    const prepSig = (signatories && signatories.preparedByName)
        ? escapeXml(signatories.preparedByName)
        : 'CHRISTINE MARY N. LIM';
    const certSig = (signatories && signatories.certifiedByName)
        ? escapeXml(signatories.certifiedByName)
        : 'FRITZ D. BACALSO, Ph. D.';
    const notedSig = (signatories && signatories.notedByName)
        ? escapeXml(signatories.notedByName)
        : 'EINGILBERT C. BENOLIRAO, Dev. Ed. D';

    const prepTitle = (signatories && signatories.preparedByTitle)
        ? escapeXml(signatories.preparedByTitle)
        : 'COTE Secretary';
    const certTitle = (signatories && signatories.certifiedByTitle)
        ? escapeXml(signatories.certifiedByTitle)
        : 'Dean, COTE';
    const notedTitle = (signatories && signatories.notedByTitle)
        ? escapeXml(signatories.notedByTitle)
        : 'Campus Director';

    const prepIdx = docXml.indexOf('Prepared by:');
    if (prepIdx !== -1) {
        const pStart = docXml.lastIndexOf('<w:p', prepIdx);
        const footerIdx = docXml.indexOf('rId10');
        if (pStart !== -1 && footerIdx !== -1) {
            const footerP = docXml.lastIndexOf('<w:p', footerIdx);
            if (footerP > pStart) {
                const sigTblXml = buildSignatoriesDocxXml(prepSig, prepTitle, certSig, certTitle, notedSig, notedTitle);
                docXml = docXml.substring(0, pStart) + sigTblXml + docXml.substring(footerP);
            }
        }
    }

    // 6. Group clean records into 7 programs
    const grouped = [[], [], [], [], [], [], []];
    cleanRecords.forEach(f => {
        const idx = getFacultyProgramIndex(f);
        if (grouped[idx]) grouped[idx].push(f);
    });

    // 7. Replace tables in word/document.xml with dynamic column widths
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
            const emptyData = ['—', '—', '—', '—', '—', '—', '—', '—', '—', ['NO RECORD'], '—', '—'];
            newRowsXml += buildRow(sampleRow, emptyData, optimalWidths);
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
                    formatQualifications(f),
                    f.years_experience ? `${f.years_experience} YEARS` : '',
                    f.eligibility ? (f.eligibility.startsWith('•') ? f.eligibility.toUpperCase() : `• ${f.eligibility.toUpperCase()}`) : '• NONE'
                ];
                newRowsXml += buildRow(sampleRow, rowData, optimalWidths);
            }
        }

        const newTblXml = tblPrefix + newRowsXml + '</w:tbl>';
        newDocXml = newDocXml.replace(tbl, () => newTblXml);
    }

    zip.file('word/document.xml', newDocXml);
    return await zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = {
    generateFacultyDocxBuffer,
    calculateOptimalColumnWidths,
    isTestOrAdminAccount,
    stripSignatures
};
