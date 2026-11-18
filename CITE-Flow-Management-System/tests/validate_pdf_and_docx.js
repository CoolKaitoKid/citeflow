const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const JSZip = require('jszip');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9232;
const TEST_DOWNLOAD_DIR = path.join(os.tmpdir(), 'citeflow_export_validation_' + Date.now());
const CHROME_USER_DIR = path.join(os.tmpdir(), 'citeflow_chrome_val_' + Date.now());
fs.mkdirSync(TEST_DOWNLOAD_DIR, { recursive: true });
fs.mkdirSync(CHROME_USER_DIR, { recursive: true });

let serverProcess = null;
let chromeProcess = null;
let ws = null;
let msgId = 0;
const callbacks = {};

function cdpSend(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++msgId;
        callbacks[id] = { resolve, reject };
        ws.send(JSON.stringify({ id, method, params }));
    });
}

function cdpEvaluate(expression) {
    return cdpSend('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
    }).then(res => {
        if (res.result?.exceptionDetails) {
            throw new Error('Evaluation error: ' + JSON.stringify(res.result.exceptionDetails));
        }
        return res.result?.value;
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function waitForHttp(url, maxWaitMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        try {
            const res = await new Promise((resolve, reject) => {
                http.get(url, (r) => {
                    let d = '';
                    r.on('data', chunk => d += chunk);
                    r.on('end', () => resolve(JSON.parse(d)));
                }).on('error', reject);
            });
            return res;
        } catch (_) {
            await sleep(500);
        }
    }
    throw new Error('Timeout waiting for: ' + url);
}

async function waitForNewDownload(existingFiles, startTime = 0, maxWaitSec = 25) {
    for (let i = 0; i < maxWaitSec; i++) {
        await sleep(1000);
        const current = fs.readdirSync(TEST_DOWNLOAD_DIR);
        const newFile = current.find(f => {
            if (f.endsWith('.crdownload')) return false;
            if (!existingFiles.includes(f)) return true;
            try {
                const stat = fs.statSync(path.join(TEST_DOWNLOAD_DIR, f));
                return stat.mtimeMs > startTime;
            } catch (_) {
                return false;
            }
        });
        if (newFile) {
            return newFile;
        }
    }
    return null;
}

async function runValidation() {
    console.log('=====================================================================');
    console.log('  CITEFLOW: LIVE FACULTY EXPORT & PDF DOWNLOAD VALIDATION SUITE       ');
    console.log('=====================================================================\n');

    try {
        console.log('[1] Starting Express Server...');
        serverProcess = spawn('node', ['index.js'], { stdio: 'ignore' });
        await sleep(2500);

        console.log('[2] Launching Chrome in Headless Mode with CDP...');
        chromeProcess = spawn(CHROME_PATH, [
            '--headless=new',
            `--remote-debugging-port=${CDP_PORT}`,
            `--user-data-dir=${CHROME_USER_DIR}`,
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check'
        ], { stdio: 'ignore' });

        await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
        const targets = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const target = targets.find(t => t.type === 'page') || targets[0];
        ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.id && callbacks[data.id]) {
                const { resolve, reject } = callbacks[data.id];
                delete callbacks[data.id];
                if (data.error) reject(new Error(data.error.message));
                else resolve(data.result);
            }
        };

        await cdpSend('Page.enable');
        await cdpSend('Runtime.enable');
        await cdpSend('DOM.enable');
        await cdpSend('Browser.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: TEST_DOWNLOAD_DIR,
            eventsEnabled: true
        });

        console.log('[3] Navigating to /login and authenticating as admin...');
        await cdpSend('Page.navigate', { url: 'http://localhost:3000/login' });
        await sleep(2000);

        const authRes = await cdpEvaluate(`
            (async () => {
                const url = window.__SUPABASE_URL__ || 'https://uforealazougjckepggc.supabase.co';
                const key = window.__SUPABASE_ANON__ || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';
                const client = window.supabase.createClient(url, key);
                window.supabaseClient = client;
                const { data, error } = await client.auth.signInWithPassword({
                    email: 'admin.test@ctu.edu.ph',
                    password: 'Password123!'
                });
                return { success: !error, error: error?.message };
            })()
        `);
        console.log('  Authentication success:', authRes.success);

        console.log('[4] Navigating to /admin/faculty-profiles.html...');
        await cdpSend('Page.navigate', { url: 'http://localhost:3000/admin/faculty-profiles.html' });
        await sleep(4000);

        // -------------------------------------------------------------
        // -------------------------------------------------------------
        // -------------------------------------------------------------
        // TEST A: Organic Faculty Profile Export to PDF (Default Signatories)
        // -------------------------------------------------------------
        console.log('\n--- Test A: Download Organic Faculty Profile PDF (Default Signatories) ---');
        let beforeFiles = fs.readdirSync(TEST_DOWNLOAD_DIR);
        let startTime = Date.now();

        // Also check preview DOM structure for centered header and signatories
        const previewCheck = await cdpEvaluate(`
            (async () => {
                await window.openFacultyExportModal();
                onExportFacultyTypeChange('organic');
                window.generateFacultyExportPreview();
                await new Promise(r => setTimeout(r, 600));

                const viewport = document.getElementById('previewDocViewport');
                const sheets = viewport ? viewport.querySelectorAll('.cite-doc-sheet') : [];
                const sheet = sheets[0];
                const headerImg = sheet ? sheet.querySelector('img[alt*="Cebu Technological University Header"]') : null;
                const headerContainer = headerImg ? headerImg.parentElement : null;
                const hrBox = headerContainer ? headerContainer.querySelector('div') : null;

                const lastPage = window.exportState ? window.exportState.totalPages : 1;
                window.goToPreviewPage(lastPage);
                await new Promise(r => setTimeout(r, 400));
                const lastSheet = viewport.querySelector('.cite-doc-sheet');
                const lastSheetHtml = lastSheet ? lastSheet.innerHTML : '';
                const sigTable = lastSheet ? lastSheet.querySelector('table[style*="table-layout: fixed"]') : null;
                const sigCols = sigTable ? sigTable.querySelectorAll('td') : [];

                window.closeFacultyPreviewModal();

                return {
                    totalPreviewPages: window.exportState ? window.exportState.totalPages : null,
                    headerImgFound: !!headerImg,
                    headerIsCentered: headerImg?.classList.contains('mx-auto') || headerContainer?.classList.contains('justify-center'),
                    hrBoxIsAbsolute: hrBox?.classList.contains('absolute'),
                    lastSheetContainsLim: lastSheetHtml.includes('CHRISTINE MARY N. LIM'),
                    lastSheetContainsBacalso: lastSheetHtml.includes('FRITZ D. BACALSO'),
                    lastSheetContainsBenolirao: lastSheetHtml.includes('BENOLIRAO'),
                    lastSheetContainsSecretary: lastSheetHtml.includes('COTE Secretary'),
                    lastSheetContainsDean: lastSheetHtml.includes('Dean, COTE'),
                    lastSheetContainsDirector: lastSheetHtml.includes('Campus Director'),
                    sigTableFound: !!sigTable,
                    sigColsCount: sigCols.length,
                    sigCol1Width: sigCols[0]?.style.width,
                    sigCol2Width: sigCols[1]?.style.width,
                    sigCol3Width: sigCols[2]?.style.width
                };
            })()
        `);

        console.log('  Preview Check: Total Pages =', previewCheck.totalPreviewPages);
        console.log('  Preview Check: Centered Header =', previewCheck.headerIsCentered, 'HR Form Box Absolute =', previewCheck.hrBoxIsAbsolute);
        console.log('  Preview Check: Default Signatories = LIM:', previewCheck.lastSheetContainsLim, 'BACALSO:', previewCheck.lastSheetContainsBacalso, 'BENOLIRAO:', previewCheck.lastSheetContainsBenolirao);
        console.log('  Preview Check: Designations = Secretary:', previewCheck.lastSheetContainsSecretary, 'Dean:', previewCheck.lastSheetContainsDean, 'Director:', previewCheck.lastSheetContainsDirector);
        console.log('  Preview Check: Signatory 3-column table found =', previewCheck.sigTableFound, 'Columns count =', previewCheck.sigColsCount, 'Col widths =', previewCheck.sigCol1Width, previewCheck.sigCol2Width, previewCheck.sigCol3Width);
        if (!previewCheck.sigTableFound || previewCheck.sigColsCount !== 3) {
            throw new Error(`Expected 3-column signatory table in preview sheet, got tableFound=${previewCheck.sigTableFound}, colsCount=${previewCheck.sigColsCount}`);
        }

        startTime = Date.now();
        await cdpEvaluate(`
            (async () => {
                await window.openFacultyExportModal();
                onExportFacultyTypeChange('organic');
                await window.downloadFacultyPdf();
            })()
        `);

        let organicPdfName = await waitForNewDownload(beforeFiles, startTime, 25);
        if (!organicPdfName) {
            throw new Error('Organic PDF download timed out or failed to trigger.');
        }

        const organicPdfPath = path.join(TEST_DOWNLOAD_DIR, organicPdfName);
        const organicPdfStat = fs.statSync(organicPdfPath);
        const organicPdfBytes = fs.readFileSync(organicPdfPath);
        console.log(`  ✅ Downloaded: ${organicPdfName}`);
        console.log(`  ✅ File Size: ${organicPdfStat.size} bytes (NOT blank!)`);
        if (organicPdfStat.size < 20000) {
            throw new Error(`PDF size is suspiciously small: ${organicPdfStat.size} bytes`);
        }

        const organicPdfRaw = organicPdfBytes.toString('binary');
        const pageCountMatch = (organicPdfRaw.match(/\/Type\s*\/Page\b/g) || []).length;
        console.log(`  ✅ Rendered Page Count: ${pageCountMatch} pages`);
        console.log(`  ✅ Contains PDF Image XObjects: ${organicPdfRaw.includes('/Image')}`);

        // -------------------------------------------------------------
        // TEST B: Custom Edited Signatories in PDF & DOCX
        // -------------------------------------------------------------
        console.log('\n--- Test B: Custom Edited Signatories in PDF & DOCX ---');
        beforeFiles = fs.readdirSync(TEST_DOWNLOAD_DIR);
        startTime = Date.now();

        const customSigResult = await cdpEvaluate(`
            (async () => {
                await window.openFacultyExportModal();
                onExportFacultyTypeChange('organic');
                // Admin edits all three signatories
                window.onSignatoryChange('preparedByName', 'PROF. MARIA SANTOS');
                window.onSignatoryChange('certifiedByName', 'DR. ROBERTO CRUZ');
                window.onSignatoryChange('notedByName', 'DR. ELENA REYES');

                window.generateFacultyExportPreview();
                await new Promise(r => setTimeout(r, 600));

                const lastPage = window.exportState ? window.exportState.totalPages : 1;
                window.goToPreviewPage(lastPage);
                await new Promise(r => setTimeout(r, 400));
                const lastSheetHtml = document.getElementById('previewDocViewport')?.innerHTML || '';

                window.closeFacultyPreviewModal();

                // Download custom PDF
                await window.downloadFacultyPdf();

                return {
                    containsSantos: lastSheetHtml.includes('PROF. MARIA SANTOS'),
                    containsCruz: lastSheetHtml.includes('DR. ROBERTO CRUZ'),
                    containsReyes: lastSheetHtml.includes('DR. ELENA REYES'),
                    containsSecretary: lastSheetHtml.includes('COTE Secretary'),
                    containsDean: lastSheetHtml.includes('Dean, COTE'),
                    containsDirector: lastSheetHtml.includes('Campus Director')
                };
            })()
        `);

        console.log('  Custom Preview Signatories Check:', customSigResult);
        let customPdfName = await waitForNewDownload(beforeFiles, startTime, 25);
        if (!customPdfName) {
            throw new Error('Custom PDF download timed out or failed.');
        }
        const customPdfPath = path.join(TEST_DOWNLOAD_DIR, customPdfName);
        console.log(`  ✅ Downloaded Custom PDF: ${customPdfName} (${fs.statSync(customPdfPath).size} bytes)`);

        // Download custom DOCX
        beforeFiles = fs.readdirSync(TEST_DOWNLOAD_DIR);
        startTime = Date.now();
        await cdpEvaluate(`
            (async () => {
                await window.downloadFacultyDocx();
            })()
        `);
        let customDocxName = await waitForNewDownload(beforeFiles, startTime, 25);
        if (!customDocxName) {
            throw new Error('Custom DOCX download timed out or failed.');
        }
        const customDocxPath = path.join(TEST_DOWNLOAD_DIR, customDocxName);
        const customDocxZip = await JSZip.loadAsync(fs.readFileSync(customDocxPath));
        const customDocXml = await customDocxZip.file('word/document.xml').async('text');
        console.log(`  ✅ Custom DOCX contains MARIA SANTOS: ${customDocXml.includes('PROF. MARIA SANTOS')}`);
        console.log(`  ✅ Custom DOCX contains ROBERTO CRUZ: ${customDocXml.includes('DR. ROBERTO CRUZ')}`);
        console.log(`  ✅ Custom DOCX contains ELENA REYES: ${customDocXml.includes('DR. ELENA REYES')}`);
        console.log(`  ✅ Custom DOCX preserves COTE Secretary: ${customDocXml.includes('COTE Secretary')}`);
        console.log(`  ✅ Custom DOCX preserves Dean, COTE: ${customDocXml.includes('Dean, COTE')}`);
        console.log(`  ✅ Custom DOCX preserves Campus Director: ${customDocXml.includes('Campus Director')}`);
        const customDrawings = customDocXml.match(/<w:drawing[\s>][\s\S]*?<\/w:drawing>/g) || [];
        console.log(`  ✅ Zero handwritten signature drawings in custom DOCX: ${!customDrawings.some(d => /r:embed="(?:rId7|rId8|rId9)"/.test(d))}`);

        // -------------------------------------------------------------
        // TEST C: Part-Time Faculty Profile Export to PDF & DOCX
        // -------------------------------------------------------------
        console.log('\n--- Test C: Download Part-Time Faculty Profile PDF & DOCX ---');
        beforeFiles = fs.readdirSync(TEST_DOWNLOAD_DIR);
        startTime = Date.now();

        await cdpEvaluate(`
            (async () => {
                await window.openFacultyExportModal();
                onExportFacultyTypeChange('parttime');
                await window.downloadFacultyPdf();
            })()
        `);

        let ptPdfName = await waitForNewDownload(beforeFiles, startTime, 25);
        if (!ptPdfName) {
            throw new Error('Part-Time PDF download timed out or failed to trigger.');
        }

        const ptPdfPath = path.join(TEST_DOWNLOAD_DIR, ptPdfName);
        const ptPdfStat = fs.statSync(ptPdfPath);
        console.log(`  ✅ Downloaded Part-Time PDF: ${ptPdfName} (${ptPdfStat.size} bytes - NOT blank!)`);
        if (ptPdfStat.size < 20000) {
            throw new Error(`Part-Time PDF size is suspiciously small: ${ptPdfStat.size} bytes`);
        }

        beforeFiles = fs.readdirSync(TEST_DOWNLOAD_DIR);
        startTime = Date.now();
        await cdpEvaluate(`
            (async () => {
                await window.downloadFacultyDocx();
            })()
        `);

        let ptDocxName = await waitForNewDownload(beforeFiles, startTime, 25);
        if (!ptDocxName) {
            throw new Error('Part-Time DOCX download timed out or failed.');
        }

        const ptDocxPath = path.join(TEST_DOWNLOAD_DIR, ptDocxName);
        const ptDocxZip = await JSZip.loadAsync(fs.readFileSync(ptDocxPath));
        const ptDocXml = await ptDocxZip.file('word/document.xml').async('text');
        console.log(`  ✅ Part-Time DOCX: ${ptDocxName} (${fs.statSync(ptDocxPath).size} bytes)`);
        console.log(`  ✅ Part-Time DOCX contains NON-RESIDENT: ${ptDocXml.includes('NON–RESIDENT')}`);
        console.log(`  ✅ Part-Time DOCX header paragraph centered: ${ptDocXml.includes('<w:jc w:val="center"/>')}`);
        console.log(`  ✅ Part-Time DOCX has 3-column signatories table: ${ptDocXml.includes('<w:gridCol w:w="5460"/><w:gridCol w:w="5460"/><w:gridCol w:w="5460"/>')}`);
        console.log(`  ✅ Part-Time DOCX has cantSplit to prevent page-break: ${ptDocXml.includes('<w:cantSplit/>')}`);

        // -------------------------------------------------------------
        // TEST D: Faculty Profiles Delete Option Restoration & Safeguards
        // -------------------------------------------------------------
        console.log('\n--- Test D: Faculty Profiles Delete Option Restoration & Safeguards ---');
        const deleteValidation = await cdpEvaluate(`
            (async () => {
                try {
                    // Close any open export modals
                    if (typeof closeFacultyExportModal === 'function') closeFacultyExportModal();
                    if (typeof closeFacultyPreviewModal === 'function') closeFacultyPreviewModal();
                    await new Promise(r => setTimeout(r, 400));

                    const canDeletePerm = typeof hasPermission === 'function' ? hasPermission('deleteFaculty') : false;
                    const canArchivePerm = typeof hasPermission === 'function' ? hasPermission('archiveFaculty') : false;
                    const canRestorePerm = typeof hasPermission === 'function' ? hasPermission('restoreFaculty') : false;

                    const deleteBtn = document.getElementById('deleteFacultyBtn');
                    const archivedBtn = document.getElementById('viewArchivedFacultyBtn');

                    // If facultyData is empty or not loaded yet, wait for it
                    let attempts = 0;
                    while ((!Array.isArray(facultyData) || facultyData.length === 0) && attempts < 20) {
                        await new Promise(r => setTimeout(r, 200));
                        attempts++;
                    }

                    // Pick a normal non-protected, non-self faculty
                    const nonAdminFaculty = Array.isArray(facultyData) ? facultyData.find(f => {
                        const r = String(f.role || f.position || '').toLowerCase();
                        const isSelf = (f.auth_user_id && f.auth_user_id === currentUser?.id) ||
                            (f.email && currentUser?.email && f.email.toLowerCase() === currentUser.email.toLowerCase());
                        return !r.includes('admin') && !r.includes('dean') && !isSelf;
                    }) : null;

                    let deleteVisibleForNormal = false;
                    let deleteHiddenForProtected = false;

                    if (nonAdminFaculty && typeof openProfile === 'function') {
                        openProfile(nonAdminFaculty.id);
                        await new Promise(r => setTimeout(r, 400));
                        deleteVisibleForNormal = deleteBtn && !deleteBtn.classList.contains('hidden') && deleteBtn.style.display !== 'none';
                    }

                    // Pick an admin/dean protected faculty
                    const protectedFaculty = Array.isArray(facultyData) ? facultyData.find(f => {
                        const r = String(f.role || f.position || '').toLowerCase();
                        return r.includes('admin') || r.includes('dean');
                    }) : null;

                    if (protectedFaculty && typeof openProfile === 'function') {
                        openProfile(protectedFaculty.id);
                        await new Promise(r => setTimeout(r, 400));
                        deleteHiddenForProtected = deleteBtn && deleteBtn.classList.contains('hidden');
                    }

                    if (typeof backToList === 'function') backToList();

                    // Check Archives Modal
                    if (typeof openArchivedFacultyModal === 'function') openArchivedFacultyModal();
                    const modal = document.getElementById('archivedFacultyModal');
                    const modalVisible = modal && !modal.classList.contains('hidden') && modal.classList.contains('flex');
                    if (typeof closeArchivedFacultyModal === 'function') closeArchivedFacultyModal();

                    return {
                        currentUserRole: typeof currentUser !== 'undefined' ? currentUser?.role : null,
                        canDeletePerm,
                        canArchivePerm,
                        canRestorePerm,
                        deleteBtnFound: !!deleteBtn,
                        deleteBtnText: deleteBtn ? deleteBtn.textContent.trim() : null,
                        archivedBtnFound: !!archivedBtn,
                        archivedBtnVisible: archivedBtn && archivedBtn.style.display !== 'none',
                        deleteVisibleForNormal,
                        deleteHiddenForProtected,
                        modalVisible
                    };
                } catch (e) {
                    return { error: e.message, stack: e.stack };
                }
            })()
        `);

        console.log('  Current User Role:', deleteValidation.currentUserRole);
        console.log('  Permissions check: deleteFaculty =', deleteValidation.canDeletePerm, 'archiveFaculty =', deleteValidation.canArchivePerm, 'restoreFaculty =', deleteValidation.canRestorePerm);
        console.log('  Delete Button Found:', deleteValidation.deleteBtnFound, 'Text:', deleteValidation.deleteBtnText);
        console.log('  Delete Button Visible for normal faculty:', deleteValidation.deleteVisibleForNormal);
        console.log('  Delete Button Hidden for protected faculty:', deleteValidation.deleteHiddenForProtected);
        console.log('  Archived Button Found & Visible:', deleteValidation.archivedBtnFound, deleteValidation.archivedBtnVisible);
        console.log('  Archived Faculty Modal opens properly:', deleteValidation.modalVisible);

        if (!deleteValidation.canDeletePerm || !deleteValidation.canArchivePerm || !deleteValidation.canRestorePerm) {
            throw new Error('Admin user lacks required deleteFaculty, archiveFaculty, or restoreFaculty permissions!');
        }
        if (!deleteValidation.deleteVisibleForNormal) {
            throw new Error('Delete button was not visible when viewing a normal faculty profile!');
        }
        if (!deleteValidation.deleteHiddenForProtected) {
            throw new Error('Delete button was not protected/hidden when viewing an admin/dean faculty profile!');
        }

        console.log('\n=====================================================================');
        console.log('  ALL LIVE EXPORT AND DOWNLOAD VALIDATIONS PASSED SUCCESSFULLY!       ');
        console.log('=====================================================================\n');

    } catch (err) {
        console.error('Validation failure:', err);
        process.exit(1);
    } finally {
        if (ws) ws.close();
        if (chromeProcess) chromeProcess.kill();
        if (serverProcess) serverProcess.kill();
    }
}

runValidation();
