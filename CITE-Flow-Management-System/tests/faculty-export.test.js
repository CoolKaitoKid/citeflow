/**
 * Automated Verification Suite for Faculty Profile Export
 * Tests:
 * 1. Template Integrity & Presence
 * 2. Real Database Record Mapping
 * 3. Organic Faculty DOCX Generation & Zero Sample Name Residuals
 * 4. Part-Time Faculty DOCX Generation & Zero Sample Name Residuals
 * 5. Signatories & Academic Year Dynamic Replacement
 * 6. Server API Endpoints (/api/faculty-export/docx)
 * 7. HTML Assets & Script Integration
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const SUPABASE_URL = 'https://uforealazougjckepggc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';

const { generateFacultyDocxBuffer } = require('../admin/faculty-export-server');

async function runTests() {
    console.log('🚀 Starting CITE-Flow Faculty Export Verification Suite...\n');
    let passed = 0;
    let failed = 0;

    function assert(cond, msg) {
        if (cond) {
            console.log(`  ✅ PASS: ${msg}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${msg}`);
            failed++;
        }
    }

    // TEST 1: Check Templates exist
    console.log('--- Test 1: Templates & Asset Verification ---');
    const organicPath = path.join(__dirname, '../admin/templates/organic-faculty-template.docx');
    const parttimePath = path.join(__dirname, '../admin/templates/parttime-faculty-template.docx');
    assert(fs.existsSync(organicPath), 'Organic faculty template exists at admin/templates/organic-faculty-template.docx');
    assert(fs.existsSync(parttimePath), 'Part-time faculty template exists at admin/templates/parttime-faculty-template.docx');

    const assetsDir = path.join(__dirname, '../admin/templates/assets');
    assert(fs.existsSync(assetsDir), 'Asset directory exists');
    assert(fs.existsSync(path.join(assetsDir, 'image1.jpeg')), 'image1.jpeg banner exists');
    assert(fs.existsSync(path.join(assetsDir, 'image2.jpeg')), 'image2.jpeg CTU logo exists');
    assert(fs.existsSync(path.join(assetsDir, 'image3.png')), 'image3.png TUV logo exists');
    assert(fs.existsSync(path.join(assetsDir, 'image4.png')), 'image4.png accreditation logo exists');
    assert(fs.existsSync(path.join(assetsDir, 'image5.jpeg')), 'image5.jpeg footer banner exists');

    // TEST 2: Check Client scripts exist
    console.log('\n--- Test 2: Client Scripts & Page Integration ---');
    const jszipPath = path.join(__dirname, '../shared/jszip.min.js');
    const html2pdfPath = path.join(__dirname, '../shared/html2pdf.bundle.min.js');
    const exportJsPath = path.join(__dirname, '../admin/faculty-export.js');
    assert(fs.existsSync(jszipPath), 'Local jszip.min.js exists in shared/');
    assert(fs.existsSync(html2pdfPath), 'Local html2pdf.bundle.min.js exists in shared/');
    assert(fs.existsSync(exportJsPath), 'Client faculty-export.js exists in admin/');

    const htmlContent = fs.readFileSync(path.join(__dirname, '../admin/faculty-profiles.html'), 'utf-8');
    assert(htmlContent.includes('id="exportFacultyBtn"'), 'faculty-profiles.html has Export button in toolbar');
    assert(htmlContent.includes('openFacultyExportModal()'), 'Export button calls openFacultyExportModal()');
    assert(htmlContent.includes('faculty-export.js'), 'faculty-profiles.html loads faculty-export.js');
    assert(htmlContent.includes('jszip.min.js'), 'faculty-profiles.html loads jszip.min.js');
    assert(htmlContent.includes('html2pdf.bundle.min.js'), 'faculty-profiles.html loads html2pdf.bundle.min.js');

    // TEST 3: Live Faculty Database Retrieval
    console.log('\n--- Test 3: Live Supabase Faculty Retrieval ---');
    const fResp = await fetch(`${SUPABASE_URL}/rest/v1/faculty?select=*&status=neq.Archived`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const facultyRecords = await fResp.json();
    assert(Array.isArray(facultyRecords) && facultyRecords.length > 0, `Fetched ${facultyRecords?.length || 0} active faculty records`);

    // TEST 4: Generate Organic Faculty DOCX from Live Records
    console.log('\n--- Test 4: Organic Faculty DOCX Generation ---');
    const organicRecords = facultyRecords.filter(f => {
        const emp = String(f.employment_type || '').toLowerCase();
        const rank = String(f.academic_rank || '').toLowerCase();
        return !emp.includes('part-time') && !emp.includes('cos') && !rank.includes('part-time');
    });

    const organicBuf = await generateFacultyDocxBuffer({
        facultyType: 'organic',
        academicYear: '2026–2027',
        signatories: {
            preparedByName: 'CHRISTINE MARY N. LIM',
            certifiedByName: 'DR. TEST DEAN',
            notedByName: 'DR. TEST DIRECTOR'
        },
        records: organicRecords
    });

    assert(Buffer.isBuffer(organicBuf) && organicBuf.length > 100000, `Generated Organic DOCX buffer: ${organicBuf.length} bytes`);

    // Parse and inspect generated docx
    const organicZip = await JSZip.loadAsync(organicBuf);
    const organicDocXml = await organicZip.file('word/document.xml').async('text');
    assert(organicDocXml.includes('Academic Year 2026–2027'), 'Contains updated Academic Year 2026–2027');
    assert(organicDocXml.includes('DR. TEST DEAN'), 'Contains dynamic Dean signatory');
    assert(organicDocXml.includes('DR. TEST DIRECTOR'), 'Contains dynamic Campus Director signatory');
    assert(organicDocXml.includes('CHRISTINE MARY N. LIM'), 'Contains default prepared signatory Christine Mary N. Lim');
    assert(organicDocXml.includes('COTE Secretary'), 'Preserves COTE Secretary designation');
    assert(organicDocXml.includes('Dean, COTE'), 'Preserves Dean, COTE designation');
    assert(organicDocXml.includes('Campus Director'), 'Preserves Campus Director designation');

    // Requirement: Signatories arranged side-by-side in ONE horizontal row (3 equal-width columns)
    assert(organicDocXml.includes('<w:gridCol w:w="5460"/><w:gridCol w:w="5460"/><w:gridCol w:w="5460"/>'), 'Signatories arranged in 3 equal-width columns (5460 dxa each)');
    assert(organicDocXml.includes('<w:cantSplit/>'), 'Signatories row has cantSplit to prevent page-break splitting');

    // Test editing all signatories
    const customSigBuf = await generateFacultyDocxBuffer({
        facultyType: 'organic',
        academicYear: '2026–2027',
        signatories: {
            preparedByName: 'PROF. CUSTOM PREPARER',
            certifiedByName: 'DR. CUSTOM DEAN',
            notedByName: 'DR. CUSTOM DIRECTOR'
        },
        records: organicRecords
    });
    const customSigZip = await JSZip.loadAsync(customSigBuf);
    const customSigXml = await customSigZip.file('word/document.xml').async('text');
    assert(customSigXml.includes('PROF. CUSTOM PREPARER'), 'Contains custom prepared signatory');
    assert(customSigXml.includes('DR. CUSTOM DEAN'), 'Contains custom certified signatory');
    assert(customSigXml.includes('DR. CUSTOM DIRECTOR'), 'Contains custom noted signatory');
    assert(customSigXml.includes('COTE Secretary'), 'Preserves COTE Secretary designation with custom names');
    assert(customSigXml.includes('Dean, COTE'), 'Preserves Dean, COTE designation with custom names');
    assert(customSigXml.includes('Campus Director'), 'Preserves Campus Director designation with custom names');

    // Requirement 1 & 4: Signatures Stripped & CTU Branding Preserved
    const drawings = organicDocXml.match(/<w:drawing[\s>][\s\S]*?<\/w:drawing>/g) || [];
    assert(drawings.length === 3, `Drawings count is exactly 3 (header, HR form box, footer; signatures removed, got ${drawings.length})`);
    const hasSignatureDrawing = drawings.some(d => /r:embed="(?:rId7|rId8|rId9)"/.test(d) || /image[234]\./.test(d));
    assert(!hasSignatureDrawing, 'Zero handwritten signatures or signature drawings remain in generated DOCX');
    const hasHeaderBanner = drawings.some(d => d.includes('rId6'));
    const hasFooterBanner = drawings.some(d => d.includes('rId10'));
    const hasHrFormBox = drawings.some(d => d.includes('Text Box 2'));
    assert(hasHeaderBanner, 'CTU Institutional Header Banner (rId6 / image1.jpeg) is preserved');
    assert(hasFooterBanner, 'CTU Institutional Footer Banner (rId10 / image5.jpeg) is preserved');
    assert(hasHrFormBox, 'Official HR Form 23B identification box is preserved');

    // Header centering check
    const headerPMatch = organicDocXml.match(/<w:p[\s>][\s\S]*?rId6[\s\S]*?<\/w:p>/);
    assert(headerPMatch && headerPMatch[0].includes('<w:jc w:val="center"/>'), 'CTU Header Banner paragraph is horizontally centered with <w:jc w:val="center"/>');

    // Requirement 2: Column Widths Adjusted Dynamically
    const gridMatch = organicDocXml.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/);
    assert(gridMatch != null, 'Table contains <w:tblGrid>');
    if (gridMatch) {
        const colWidths = (gridMatch[0].match(/<w:gridCol\s+w:w="(\d+)"/g) || []).map(c => parseInt(c.match(/\d+/)[0], 10));
        assert(colWidths.length === 12, 'Table grid contains 12 columns');
        assert(colWidths[9] >= 4800, `Educational Qualification column expanded to ${colWidths[9]} dxa (>= 4800 dxa)`);
        const totalW = colWidths.reduce((a, b) => a + b, 0);
        assert(totalW === 17995, `Total column width matches 17995 dxa (sum: ${totalW})`);
    }

    // Requirement 3: Sample / Test Account Exclusion Guard
    const testAccountsPayload = [
        { name: 'Wesley Admin', role: 'Administrator', email: 'admin.test@ctu.edu.ph' },
        { name: 'Krishnan A. Admin', role: 'Admin', email: 'krishpao9@gmail.com' },
        { name: 'CiteFlow Administrator', role: 'Admin', email: 'citeflow.admin@ctu.edu.ph' },
        { name: 'Son Goku', role: 'Chairperson', email: 'donedmundaquino@gmail.com' }
    ];
    const testExcludedBuf = await generateFacultyDocxBuffer({
        facultyType: 'organic',
        academicYear: '2026–2027',
        records: testAccountsPayload
    });
    const testExcludedZip = await JSZip.loadAsync(testExcludedBuf);
    const testExcludedXml = await testExcludedZip.file('word/document.xml').async('text');
    assert(!testExcludedXml.includes('WESLEY ADMIN'), 'Test account Wesley Admin is excluded from generated document');
    assert(!testExcludedXml.includes('KRISHNAN A. ADMIN'), 'Test account Krishnan Admin is excluded from generated document');
    assert(!testExcludedXml.includes('CITEFLOW ADMINISTRATOR'), 'Test account CiteFlow Administrator is excluded from generated document');
    assert(!testExcludedXml.includes('SON GOKU'), 'Test account Son Goku (Aquino) is excluded from generated document');

    // Verify legitimate faculty are NOT mistakenly excluded
    const legitimateFaculty = [
        { name: 'WESLEY N/A FORTUNA', role: 'Faculty', position: 'Instructor I', department: 'BSIT', status: 'Active', email: 'fortwesley237@gmail.com' },
        { name: 'Dr. Alex Rivera', role: 'Faculty', position: 'Faculty', department: 'BSIT', status: 'Active', email: 'faculty.demo@ctu.edu.ph' }
    ];
    const legBuf = await generateFacultyDocxBuffer({
        facultyType: 'organic',
        academicYear: '2026–2027',
        records: legitimateFaculty
    });
    const legZip = await JSZip.loadAsync(legBuf);
    const legXml = await legZip.file('word/document.xml').async('text');
    assert(legXml.includes('FORTUNA'), 'Legitimate faculty member Wesley Fortuna is included');
    assert(legXml.includes('RIVERA'), 'Legitimate faculty member Alex Rivera is included');

    // Verify sample names are purged
    const sampleNames = ['MELANIE', 'HOCAMIS', 'REMOLINO', 'CAMELLO', 'GEYROZAGA', 'PANGANDOYON', 'VILLAMOR', 'SARDUAL'];
    let residualSamples = 0;
    sampleNames.forEach(sn => {
        // Only count if this name was not an actual faculty in organicRecords
        const wasInDb = organicRecords.some(f => (f.first_name || '').toUpperCase() === sn || (f.last_name || '').toUpperCase() === sn);
        if (!wasInDb && organicDocXml.includes(sn)) {
            residualSamples++;
            console.warn(`    ⚠️ Warning: Found unexpected residual sample name: ${sn}`);
        }
    });
    assert(residualSamples === 0, 'All template sample placeholder faculty rows were completely purged');

    // TEST 5: Generate Part-Time Faculty DOCX from Live Records
    console.log('\n--- Test 5: Part-Time Faculty DOCX Generation ---');
    const ptRecords = facultyRecords.filter(f => {
        const emp = String(f.employment_type || '').toLowerCase();
        const rank = String(f.academic_rank || '').toLowerCase();
        return emp.includes('part-time') || emp.includes('cos') || rank.includes('part-time') || rank.includes('non-resident');
    });

    const ptBuf = await generateFacultyDocxBuffer({
        facultyType: 'parttime',
        academicYear: '2026–2027',
        signatories: {
            preparedByName: 'CHRISTINE MARY N. LIM',
            certifiedByName: 'DR. TEST DEAN',
            notedByName: 'DR. TEST DIRECTOR'
        },
        records: ptRecords
    });

    assert(Buffer.isBuffer(ptBuf) && ptBuf.length > 100000, `Generated Part-Time DOCX buffer: ${ptBuf.length} bytes`);

    const ptZip = await JSZip.loadAsync(ptBuf);
    const ptDocXml = await ptZip.file('word/document.xml').async('text');
    const ptText = ptDocXml.replace(/<[^>]+>/g, '');
    assert(ptDocXml.includes('Academic Year 2026–2027'), 'Part-Time docx contains updated Academic Year');
    assert(ptDocXml.includes('NON–RESIDENT') && ptDocXml.includes('INSTRUCTOR'), 'Part-Time docx contains NON-RESIDENT INSTRUCTOR header');
    assert(ptDocXml.includes('DR. TEST DEAN'), 'Part-Time docx contains dynamic Dean signatory');
    assert(ptDocXml.includes('DR. TEST DIRECTOR'), 'Part-Time docx contains dynamic Campus Director signatory');
    assert(ptDocXml.includes('CHRISTINE MARY N. LIM'), 'Part-Time docx contains default prepared signatory');
    assert(ptDocXml.includes('COTE Secretary'), 'Part-Time docx preserves COTE Secretary title');
    assert(ptText.includes('Dean, COTE'), 'Part-Time docx preserves Dean, COTE title');
    assert(ptDocXml.includes('Campus Director'), 'Part-Time docx preserves Campus Director title');
    assert(ptDocXml.includes('<w:gridCol w:w="5460"/><w:gridCol w:w="5460"/><w:gridCol w:w="5460"/>'), 'Part-Time docx signatories arranged in 3 equal-width columns (5460 dxa each)');
    assert(ptDocXml.includes('<w:cantSplit/>'), 'Part-Time docx signatories row has cantSplit to prevent page-break splitting');

    const ptDrawings = ptDocXml.match(/<w:drawing[\s>][\s\S]*?<\/w:drawing>/g) || [];
    const ptHasSignatureDrawing = ptDrawings.some(d => /r:embed="(?:rId7|rId8|rId9)"/.test(d) || /image[234]\./.test(d));
    assert(!ptHasSignatureDrawing, 'Part-Time docx has zero handwritten signatures');
    const ptHeaderPMatch = ptDocXml.match(/<w:p[\s>][\s\S]*?rId6[\s\S]*?<\/w:p>/);
    assert(ptHeaderPMatch && ptHeaderPMatch[0].includes('<w:jc w:val="center"/>'), 'Part-Time CTU Header Banner paragraph is horizontally centered with <w:jc w:val="center"/>');

    // TEST 6: Test Express API Endpoint over HTTP
    console.log('\n--- Test 6: Express Server HTTP API Endpoints ---');
    let testServer = null;
    try {
        let isRunning = false;
        try {
            const probe = await fetch('http://localhost:3000/dashboard');
            if (probe) isRunning = true;
        } catch (_) {}

        if (!isRunning) {
            const app = require('../../index');
            testServer = await new Promise((resolve) => {
                const s = app.listen(3000, () => resolve(s));
            });
        }

        const apiResp = await fetch('http://localhost:3000/api/faculty-export/docx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                facultyType: 'organic',
                academicYear: '2026-2027',
                signatories: {
                    preparedByName: 'CHRISTINE MARY N. LIM',
                    certifiedByName: 'FRITZ D. BACALSO, Ph. D.',
                    notedByName: 'EINGILBERT C. BENOLIRAO, Dev. Ed. D'
                },
                records: organicRecords.slice(0, 5)
            })
        });
        assert(apiResp.status === 200, `HTTP POST /api/faculty-export/docx returns 200 OK (status: ${apiResp.status})`);
        assert(apiResp.headers.get('content-type')?.includes('wordprocessingml.document'), 'Content-Type header is application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        assert(apiResp.headers.get('content-disposition')?.includes('COTE-Faculty-Profile-AY-2026-2027_Organic.docx'), 'Content-Disposition filename matches institutional convention');
    } finally {
        if (testServer) {
            testServer.close();
        }
    }

    console.log(`\n========================================`);
    console.log(`Verification Results: ${passed} Passed, ${failed} Failed`);
    console.log(`========================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
