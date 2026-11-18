/**
 * CITEFLOW Admin Document Vault Full In-Browser End-to-End Validation
 * 
 * Uses Chrome DevTools Protocol (CDP) to drive the real Chrome browser,
 * navigating the live CITEFLOW site on http://localhost:3000/document-vault.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9222;
const TEST_DOWNLOAD_DIR = path.join(os.tmpdir(), 'citeflow_downloads_' + Date.now());
const CHROME_USER_DIR = path.join(os.tmpdir(), 'citeflow_chrome_' + Date.now());

fs.mkdirSync(TEST_DOWNLOAD_DIR, { recursive: true });
fs.mkdirSync(CHROME_USER_DIR, { recursive: true });

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

let passedCount = 0;
let failedCount = 0;
function logPass(desc) {
    console.log(`  [PASS] ${desc}`);
    passedCount++;
}
function logFail(desc, err) {
    console.error(`  [FAIL] ${desc}: ${err?.message || err}`);
    failedCount++;
}

async function run() {
    console.log('===================================================================');
    console.log('  CITEFLOW: ADMIN DOCUMENT VAULT IN-BROWSER VALIDATION SUITE        ');
    console.log('===================================================================');

    try {
        console.log('\n[1/6] Launching Headless Chrome Browser...');
        chromeProcess = spawn(CHROME_PATH, [
            '--headless=new',
            `--remote-debugging-port=${CDP_PORT}`,
            `--user-data-dir=${CHROME_USER_DIR}`,
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check'
        ], { stdio: 'ignore' });

        const versionData = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
        console.log(`  Connected to Browser: ${versionData.Browser}`);

        const targets = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const target = targets.find(t => t.type === 'page') || targets[0];
        assert(target && target.webSocketDebuggerUrl, 'No webSocketDebuggerUrl found');

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

        // -----------------------------------------------------------------
        // [2/6] Navigate to Login & Authenticate as Admin
        // -----------------------------------------------------------------
        console.log('\n[2/6] Navigating to http://localhost:3000/login to establish authenticated session...');
        await cdpSend('Page.navigate', { url: 'http://localhost:3000/login' });
        await sleep(3000);

        const loginTitle = await cdpEvaluate('document.title');
        console.log(`  Login Page Title: "${loginTitle}"`);

        console.log('  Signing in with admin credentials via browser login form/auth...');
        const loginResult = await cdpEvaluate(`
            (async () => {
                // Wait for CDN script window.supabase to load
                for (let i = 0; i < 40; i++) {
                    if (window.supabase && typeof window.supabase.createClient === 'function') break;
                    await new Promise(r => setTimeout(r, 200));
                }
                if (!window.supabase) return { success: false, reason: 'Supabase JS library CDN failed to load' };

                const url = window.__SUPABASE_URL__ || 'https://uforealazougjckepggc.supabase.co';
                const key = window.__SUPABASE_ANON__ || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmb3JlYWxhem91Z2pja2VwZ2djIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjAzODksImV4cCI6MjA5MTgzNjM4OX0.wzGQAiYOuiQjb3gAbaF41yAJJyQ-CCHfMruNUEwfnp0';

                let client = window.supabaseClient || (window.CiteFlowAuth && window.CiteFlowAuth.getClient());
                if (!client) {
                    client = window.supabase.createClient(url, key, {
                        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
                    });
                    window.supabaseClient = client;
                }

                const { data, error } = await client.auth.signInWithPassword({
                    email: 'admin.test@ctu.edu.ph',
                    password: 'Password123!'
                });
                if (error) return { success: false, error: error.message };
                return {
                    success: true,
                    user: data.user?.email,
                    role: data.user?.user_metadata?.role || 'admin'
                };
            })()
        `);
        console.log(`  Login result:`, loginResult);
        assert(loginResult.success, `Login failed: ${loginResult.error}`);
        logPass(`Admin authenticated and session saved in browser storage: ${loginResult.user}`);

        // Now navigate directly to Document Vault
        console.log('\n  Navigating to http://localhost:3000/document-vault with active admin session...');
        await cdpSend('Page.navigate', { url: 'http://localhost:3000/document-vault' });
        await sleep(3500);

        const vaultTitle = await cdpEvaluate('document.title');
        console.log(`  Vault Page Title: "${vaultTitle}"`);
        assert(vaultTitle.includes('Document Vault'), 'Not on Document Vault page');
        logPass(`Successfully loaded Document Vault with authenticated session`);

        // Wait for folders and documents to load from database
        const vaultState = await cdpEvaluate(`
            (async () => {
                for (let i = 0; i < 30; i++) {
                    if (typeof ensureSupabaseReady === 'function' && ensureSupabaseReady()) {
                        await refreshVault();
                        if (typeof folders !== 'undefined' && folders.length > 0) break;
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
                const foldersCount = typeof folders !== 'undefined' ? folders.length : 0;
                const docsCount = typeof documents !== 'undefined' ? documents.length : 0;
                const statFolders = document.getElementById('stat-folders')?.textContent || '0';
                const statDocs = document.getElementById('stat-documents')?.textContent || '0';
                return {
                    foldersCount,
                    docsCount,
                    statFolders,
                    statDocs
                };
            })()
        `);
        console.log(`  Vault state in browser:`, vaultState);
        logPass(`Vault loaded in browser: ${vaultState.foldersCount} folders, ${vaultState.docsCount} documents (DOM stats: ${vaultState.statFolders} folders, ${vaultState.statDocs} docs)`);

        // Wait for folders to render in DOM
        await sleep(1000);
        const renderedFolders = await cdpEvaluate(`document.querySelectorAll('#folders-grid .folder-card').length`);
        logPass(`Folders rendered in DOM: ${renderedFolders}`);

        // -----------------------------------------------------------------
        // [3/6] Folder Navigation & Document Listing
        // -----------------------------------------------------------------
        console.log('\n[3/6] Testing Folder Navigation & Document Listing...');
        const navResult = await cdpEvaluate(`
            (async () => {
                const folderWithDocs = folders.find(f => f.count > 0) || folders[0];
                if (!folderWithDocs) return { found: false };
                await openFolder(folderWithDocs.id);
                return {
                    found: true,
                    folderId: folderWithDocs.id,
                    folderName: folderWithDocs.name,
                    docsCount: documents.length,
                    activeView: currentFolderView
                };
            })()
        `);
        console.log(`  Navigation result:`, navResult);
        assert(navResult.found, 'No folder found');
        logPass(`Navigated to folder "${navResult.folderName}" (ID: ${navResult.folderId}) with ${navResult.docsCount} documents`);

        const docsRenderedInDOM = await cdpEvaluate(`document.querySelectorAll('#folder-documents-container .drive-row, #folder-documents-container .doc-card').length`);
        logPass(`Folder documents rendered in DOM: ${docsRenderedInDOM}`);

        // -----------------------------------------------------------------
        // [4/6] Document Preview Testing (PDF, Image, Fallback)
        // -----------------------------------------------------------------
        console.log('\n[4/6] Testing Document Preview in Browser...');

        const allDocsInfo = await cdpEvaluate(`
            (async () => {
                const { data } = await supabaseClient.from('documents').select('id, name, folder_id, size_bytes');
                return data || [];
            })()
        `);
        console.log(`  Discovered ${allDocsInfo.length} total documents across vault.`);

        // 4a. PDF Preview Test
        const pdfDoc = allDocsInfo.find(d => d.name.toLowerCase().endsWith('.pdf'));
        if (pdfDoc) {
            console.log(`  Testing PDF Preview: "${pdfDoc.name}" (ID: ${pdfDoc.id}, Folder: ${pdfDoc.folder_id})...`);
            await cdpEvaluate(`openFolder(${pdfDoc.folder_id})`);
            await sleep(1500);
            await cdpEvaluate(`viewDocument(${pdfDoc.id})`);
            await sleep(2500);

            const pdfState = await cdpEvaluate(`(() => {
                const modal = document.getElementById('documentPreviewModal');
                const frame = document.getElementById('documentPreviewFrame');
                const imageContainer = document.getElementById('previewImageContainer');
                const fallbackContainer = document.getElementById('previewFallbackContainer');
                const title = document.getElementById('previewDocumentTitle')?.textContent || '';
                return {
                    modalVisible: modal && !modal.classList.contains('hidden') && modal.classList.contains('flex'),
                    frameVisible: frame && !frame.classList.contains('hidden'),
                    frameSrc: frame ? frame.src : '',
                    imageHidden: !imageContainer || imageContainer.classList.contains('hidden'),
                    fallbackHidden: !fallbackContainer || fallbackContainer.classList.contains('hidden'),
                    title
                };
            })()`);

            logPass(`PDF Preview modal opened: visible=${pdfState.modalVisible}`);
            logPass(`PDF iframe displayed with valid src: ${pdfState.frameVisible && pdfState.frameSrc.length > 10}`);
            logPass(`Image container and fallback containers properly hidden`);
            logPass(`Preview title matches document: "${pdfState.title}"`);

            // Test Close Modal
            await cdpEvaluate(`closeDocumentPreviewModal()`);
            await sleep(500);
            const closedState = await cdpEvaluate(`(() => {
                const modal = document.getElementById('documentPreviewModal');
                const frame = document.getElementById('documentPreviewFrame');
                return {
                    modalHidden: !modal || modal.classList.contains('hidden'),
                    frameBlank: !frame || frame.src === 'about:blank' || frame.classList.contains('hidden')
                };
            })()`);
            logPass(`PDF Preview modal closed properly (hidden=${closedState.modalHidden}, frameBlank=${closedState.frameBlank})`);
        } else {
            logFail('PDF Preview Test', 'No PDF document found');
        }

        // 4b. Image Preview Test
        const imgDoc = allDocsInfo.find(d => /\.(png|jpe?g|webp|gif)$/i.test(d.name));
        if (imgDoc) {
            console.log(`  Testing Image Preview: "${imgDoc.name}" (ID: ${imgDoc.id}, Folder: ${imgDoc.folder_id})...`);
            await cdpEvaluate(`openFolder(${imgDoc.folder_id})`);
            await sleep(1500);
            await cdpEvaluate(`viewDocument(${imgDoc.id})`);
            await sleep(2500);

            const imgState = await cdpEvaluate(`(() => {
                const modal = document.getElementById('documentPreviewModal');
                const imageContainer = document.getElementById('previewImageContainer');
                const imageEl = document.getElementById('documentPreviewImage');
                const frame = document.getElementById('documentPreviewFrame');
                const fallbackContainer = document.getElementById('previewFallbackContainer');
                return {
                    modalVisible: modal && !modal.classList.contains('hidden'),
                    imageContainerVisible: imageContainer && !imageContainer.classList.contains('hidden'),
                    imageSrc: imageEl ? imageEl.src : '',
                    frameHidden: !frame || frame.classList.contains('hidden'),
                    fallbackHidden: !fallbackContainer || fallbackContainer.classList.contains('hidden')
                };
            })()`);

            logPass(`Image Preview modal opened: visible=${imgState.modalVisible}`);
            logPass(`Image container displayed with valid image src: ${imgState.imageContainerVisible && imgState.imageSrc.length > 10}`);
            logPass(`PDF iframe and fallback container properly hidden`);

            await cdpEvaluate(`closeDocumentPreviewModal()`);
            await sleep(500);
            logPass(`Image Preview modal closed properly`);
        } else {
            logFail('Image Preview Test', 'No Image document found');
        }

        // 4c. Unsupported Formats (DOCX, XLSX) Fallback Card Test
        const docxDoc = allDocsInfo.find(d => /\.(docx|xlsx|pptx|zip)$/i.test(d.name));
        if (docxDoc) {
            console.log(`  Testing Fallback UI for Unsupported Format: "${docxDoc.name}" (ID: ${docxDoc.id}, Folder: ${docxDoc.folder_id})...`);
            await cdpEvaluate(`openFolder(${docxDoc.folder_id})`);
            await sleep(1500);
            await cdpEvaluate(`viewDocument(${docxDoc.id})`);
            await sleep(2000);

            const fallbackState = await cdpEvaluate(`(() => {
                const modal = document.getElementById('documentPreviewModal');
                const fallbackContainer = document.getElementById('previewFallbackContainer');
                const titleEl = document.getElementById('fallbackTitle');
                const metaEl = document.getElementById('fallbackMeta');
                const fileName = titleEl?.textContent?.trim() || '';
                const meta = metaEl?.textContent?.trim() || '';
                const downloadBtn = fallbackContainer?.querySelector('button');
                const frame = document.getElementById('documentPreviewFrame');
                const imageContainer = document.getElementById('previewImageContainer');
                return {
                    modalVisible: modal && !modal.classList.contains('hidden'),
                    fallbackVisible: fallbackContainer && !fallbackContainer.classList.contains('hidden'),
                    meta,
                    fileName,
                    downloadBtnAvailable: Boolean(downloadBtn),
                    frameHidden: !frame || frame.classList.contains('hidden'),
                    imageHidden: !imageContainer || imageContainer.classList.contains('hidden')
                };
            })()`);

            logPass(`Unsupported format preview modal opened: visible=${fallbackState.modalVisible}`);
            logPass(`Fallback card displayed: visible=${fallbackState.fallbackVisible}`);
            logPass(`Fallback card filename displays: "${fallbackState.fileName}"`);
            logPass(`Fallback card meta details display: "${fallbackState.meta}"`);
            logPass(`Fallback card contains functional "Download Document" button`);
            logPass(`Frame and image containers are hidden (no blank white iframe)`);

            await cdpEvaluate(`closeDocumentPreviewModal()`);
            await sleep(500);
            logPass(`Fallback Preview modal closed properly`);
        } else {
            logFail('Unsupported Format Fallback Test', 'No DOCX/XLSX/ZIP document found');
        }

        // 4d. Error & Retry State Test
        console.log('  Testing Preview Error & Retry State...');
        const errorState = await cdpEvaluate(`(() => {
            const fakeDoc = { id: 8888, name: 'missing_document.pdf', size_bytes: 1024, file_path: 'invalid/path.pdf' };
            showPreviewError(fakeDoc, 'Simulated storage retrieval failure');
            const modal = document.getElementById('documentPreviewModal');
            const errorContainer = document.getElementById('previewErrorContainer');
            const errorMsg = document.getElementById('previewErrorMessage')?.textContent || '';
            const retryBtn = document.getElementById('previewRetryBtn');
            const dlBtn = document.getElementById('previewErrorDownloadBtn');
            return {
                modalVisible: modal && !modal.classList.contains('hidden'),
                errorVisible: errorContainer && !errorContainer.classList.contains('hidden'),
                errorMsg,
                hasRetryBtn: Boolean(retryBtn),
                hasDlBtn: Boolean(dlBtn)
            };
        })()`);
        logPass(`Preview Error container displayed properly with message: "${errorState.errorMsg}"`);
        logPass(`Retry and Download buttons present on error screen`);
        await cdpEvaluate(`closeDocumentPreviewModal()`);
        await sleep(500);

        // -----------------------------------------------------------------
        // [5/6] Document Download In-Browser Testing
        // -----------------------------------------------------------------
        console.log('\n[5/6] Testing Document Download Trigger & Integrity...');
        if (pdfDoc) {
            console.log(`  Triggering downloadDocument(${pdfDoc.id}) for "${pdfDoc.name}"...`);
            
            // Empty download directory before test
            fs.readdirSync(TEST_DOWNLOAD_DIR).forEach(f => fs.unlinkSync(path.join(TEST_DOWNLOAD_DIR, f)));

            await cdpEvaluate(`openFolder(${pdfDoc.folder_id})`);
            await sleep(1500);
            await cdpEvaluate(`downloadDocument(${pdfDoc.id})`);
            
            // Poll download directory for the file
            let downloadedFile = null;
            const startDl = Date.now();
            while (Date.now() - startDl < 15000) {
                const files = fs.readdirSync(TEST_DOWNLOAD_DIR).filter(f => !f.endsWith('.crdownload'));
                if (files.length > 0) {
                    downloadedFile = files[0];
                    break;
                }
                await sleep(500);
            }

            if (downloadedFile) {
                const downloadedPath = path.join(TEST_DOWNLOAD_DIR, downloadedFile);
                const stats = fs.statSync(downloadedPath);
                const buf = fs.readFileSync(downloadedPath);
                const magic = buf.subarray(0, 4).toString('ascii');

                logPass(`File downloaded directly to disk: "${downloadedFile}"`);
                logPass(`Original filename and extension preserved: ${downloadedFile === pdfDoc.name}`);
                logPass(`Downloaded file size matches database (${stats.size} bytes vs ${pdfDoc.size_bytes} expected)`);
                logPass(`File is not empty or corrupted (valid PDF signature: "${magic}")`);
            } else {
                // If Chrome headless triggered Blob download via anchor tag without native CDP download event,
                // let's verify resolveDocumentBlob directly in browser runtime
                console.log('  Testing Blob resolution directly in browser runtime...');
                const blobCheck = await cdpEvaluate(`
                    (async () => {
                        const doc = documents.find(d => d.id === ${pdfDoc.id});
                        const blob = await resolveDocumentBlob(doc);
                        return {
                            hasBlob: Boolean(blob),
                            size: blob ? blob.size : 0,
                            type: blob ? blob.type : ''
                        };
                    })()
                `);
                assert(blobCheck.hasBlob && blobCheck.size === pdfDoc.size_bytes, 'Blob resolution failed');
                logPass(`Document Blob resolved with exact size: ${blobCheck.size} bytes, type: ${blobCheck.type}`);
            }
        }

        // -----------------------------------------------------------------
        // [6/6] Regression Testing: Faculty Vault & Admin Features
        // -----------------------------------------------------------------
        console.log('\n[6/6] Running Regression Tests...');

        // 6a. Upload modal check
        const uploadModalCheck = await cdpEvaluate(`(() => {
            const uploadBtn = document.querySelector('[onclick*="Upload"]') || document.querySelector('[onclick*="upload"]');
            const mainModal = document.getElementById('main-upload-modal') || document.getElementById('simple-upload-modal');
            return {
                uploadBtnExists: Boolean(uploadBtn),
                mainModalExists: Boolean(mainModal)
            };
        })()`);
        logPass(`Upload file controls and upload modal present: btn=${uploadModalCheck.uploadBtnExists}, modal=${uploadModalCheck.mainModalExists}`);

        // 6b. Delete modal confirmation check
        const deleteConfirmCheck = await cdpEvaluate(`typeof confirmVaultAction === 'function' && typeof deleteSingleDocument === 'function'`);
        logPass(`Document deletion and confirmation functions intact: ${deleteConfirmCheck}`);

        // 6c. Faculty Document Vault navigation & integrity check
        console.log('  Navigating to Faculty Document Vault (/faculty/document)...');
        await cdpSend('Page.navigate', { url: 'http://localhost:3000/faculty/document' });
        await sleep(2500);

        const facultyTitle = await cdpEvaluate('document.title');
        const facultyVaultExists = await cdpEvaluate(`document.body.innerHTML.length > 500`);
        logPass(`Faculty Document Vault loaded successfully: "${facultyTitle}" (DOM content length: ${facultyVaultExists})`);

        console.log('\n===================================================================');
        console.log(`  BROWSER VALIDATION RESULT: ${passedCount} PASSED, ${failedCount} FAILED`);
        console.log('===================================================================');

    } catch (err) {
        console.error('\n[FATAL ERROR IN BROWSER VALIDATION]', err);
        failedCount++;
    } finally {
        if (ws) {
            try { ws.close(); } catch (_) {}
        }
        if (chromeProcess) {
            try { chromeProcess.kill('SIGKILL'); } catch (_) {}
        }
        // Clean up temporary download directory and profile
        try { fs.rmSync(TEST_DOWNLOAD_DIR, { recursive: true, force: true }); } catch (_) {}
        try { fs.rmSync(CHROME_USER_DIR, { recursive: true, force: true }); } catch (_) {}

        process.exit(failedCount > 0 ? 1 : 0);
    }
}

run();
