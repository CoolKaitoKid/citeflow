/**
 * Verification Test: Faculty Profiles Archive / Soft Delete, Restore,
 * Academic Rank Dropdown, and Part-time Employment Type Enhancement
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== STARTING FACULTY PROFILES ENHANCEMENT VERIFICATION TESTS ===\n');

const fpPath = path.resolve(__dirname, '../admin/faculty-profiles.html');
const authPath = path.resolve(__dirname, '../shared/auth.js');
const guardPath = path.resolve(__dirname, '../shared/auth-guard.js');
const loginPath = path.resolve(__dirname, '../login.html');

const fpHtml = fs.readFileSync(fpPath, 'utf8');
const authJs = fs.readFileSync(authPath, 'utf8');
const guardJs = fs.readFileSync(guardPath, 'utf8');
const loginHtml = fs.readFileSync(loginPath, 'utf8');

// =========================================================================
// TEST 1: DOM Elements in admin/faculty-profiles.html
// =========================================================================
console.log('--- TEST 1: DOM Elements in faculty-profiles.html ---');
assert(fpHtml.includes('id="deleteFacultyBtn"'), 'deleteFacultyBtn must exist in faculty-profiles.html');
assert(fpHtml.includes('id="viewArchivedFacultyBtn"'), 'viewArchivedFacultyBtn must exist in faculty-profiles.html');
assert(fpHtml.includes('id="archivedFacultyModal"'), 'archivedFacultyModal must exist in faculty-profiles.html');
assert(fpHtml.includes('id="archived-count"'), 'archived-count badge must exist in faculty-profiles.html');
console.log('✓ TEST 1 passed: All required DOM elements exist.');

// =========================================================================
// TEST 2: Role-based Permissions & Access Control (Strict Dean & Secretary)
// =========================================================================
console.log('\n--- TEST 2: Role-based Permissions & Access Control ---');

const permsMatch = fpHtml.match(/const PERMISSIONS = \{([\s\S]*?)\};/);
assert(permsMatch, 'PERMISSIONS object must exist');
const permsStr = permsMatch[1];

// Archive and Restore must strictly be granted to Dean and Secretary only
const archiveList = permsStr.match(/archiveFaculty:\s*\[([^\]]*)\]/)?.[1] || '';
assert(archiveList.includes("'dean'") && archiveList.includes("'secretary'"), 'archiveFaculty must allow dean and secretary');
assert(!archiveList.includes("'admin'") && !archiveList.includes("'administrator'"), 'archiveFaculty must NOT allow administrator or admin');
assert(!archiveList.includes("'faculty'") && !archiveList.includes("'chairperson'"), 'archiveFaculty must NOT allow regular faculty or chairperson');

const deleteList = permsStr.match(/deleteFaculty:\s*\[([^\]]*)\]/)?.[1] || '';
assert(deleteList.includes("'dean'") && deleteList.includes("'secretary'"), 'deleteFaculty must allow dean and secretary');
assert(!deleteList.includes("'admin'") && !deleteList.includes("'administrator'"), 'deleteFaculty must NOT allow administrator or admin');

const restoreList = permsStr.match(/restoreFaculty:\s*\[([^\]]*)\]/)?.[1] || '';
assert(restoreList.includes("'dean'") && restoreList.includes("'secretary'"), 'restoreFaculty must allow dean and secretary');
assert(!restoreList.includes("'admin'") && !restoreList.includes("'administrator'"), 'restoreFaculty must NOT allow administrator or admin');

console.log('✓ TEST 2 passed: Archive/Restore permissions strictly limited to College Dean and Secretary.');

// =========================================================================
// TEST 3: Academic Rank Dropdown & Part-time Employment Type
// =========================================================================
console.log('\n--- TEST 3: Academic Rank Dropdown & Part-time Employment Type ---');
assert(/<select[\s\S]*?id="edit-academic-rank"/.test(fpHtml), 'edit-academic-rank must be a select element');

const expectedRanks = [
    'Instructor I', 'Instructor II', 'Instructor III', 'Instructor IV', 'Instructor V',
    'Assistant Professor I', 'Assistant Professor II', 'Assistant Professor III', 'Assistant Professor IV', 'Assistant Professor V',
    'Associate Professor I', 'Associate Professor II', 'Associate Professor III', 'Associate Professor IV', 'Associate Professor V',
    'Professor I', 'Professor II', 'Professor III', 'Professor IV', 'Professor V', 'Professor VI',
    'University Professor'
];

expectedRanks.forEach(rank => {
    assert(fpHtml.includes(`<option value="${rank}">${rank}</option>`), `Option ${rank} must exist in edit-academic-rank`);
});

// Part-time MUST NOT be in Academic Rank in Edit Details
const rankSelectMatch = fpHtml.match(/<select[^>]*id="edit-academic-rank"[^>]*>([\s\S]*?)<\/select>/);
assert(rankSelectMatch, 'edit-academic-rank select must exist');
assert(!rankSelectMatch[0].includes('value="Part-time"'), 'Part-time must NOT exist in edit-academic-rank');

// Check Employment Type options: Part-time must be under Employment Type
assert(fpHtml.includes('<option value="Part-time">Part-time</option>') || fpHtml.includes('<option value="Part-Time">Part-Time</option>'),
    'Part-time or Part-Time must be present in employment type options');
assert(/<select[^>]*id="edit-employment-type"[^>]*>[\s\S]*?<option value="Part-time">Part-time<\/option>/.test(fpHtml),
    'edit-employment-type select should contain Part-time option');

console.log('✓ TEST 3 passed: Academic Rank contains only academic ranks (Part-time removed); Part-time is under Employment Type.');

// =========================================================================
// TEST 4: Soft-Delete (Archive) Logic & Safeguards
// =========================================================================
console.log('\n--- TEST 4: Soft-Delete (Archive) Logic & Safeguards ---');

// Check self-archive prevention
assert(fpHtml.includes("You cannot archive your own account."), 'Self-archive guard must exist');

// Check protected admin archive prevention
assert(fpHtml.includes("targetRole.includes('admin') || targetRole.includes('dean')"), 'Protected admin archive guard must exist');

// Check active chairperson protection
assert(fpHtml.includes("Cannot archive an active Department Chairperson. Assign a replacement first."),
    'Active Department Chairperson guard must exist with exact requested message');

// Check that it performs soft delete (status = 'Archived'), NOT hard delete
assert(fpHtml.includes("status: 'Archived'"), 'Archive operation must set status to Archived');
assert(!fpHtml.includes(".from('faculty').delete()"), 'No hard delete (.delete()) should be performed on faculty');

console.log('✓ TEST 4 passed: Soft-delete safeguards (self, admin, chairperson) and soft status update verified.');

// =========================================================================
// TEST 5: Archived Separation in Directory & Modal
// =========================================================================
console.log('\n--- TEST 5: Active vs Archived Separation in Directory ---');

assert(fpHtml.includes("const activeList = facultyOnly.filter(f => String(f.status || '').toLowerCase() !== 'archived')"),
    'Active faculty must exclude status Archived');
assert(fpHtml.includes("const archivedList = facultyOnly.filter(f => String(f.status || '').toLowerCase() === 'archived')"),
    'Archived faculty must be filtered by status Archived');
assert(fpHtml.includes("archivedCountEl.textContent = archivedFacultyData.length"),
    'Archived count badge must reflect archivedFacultyData length');

console.log('✓ TEST 5 passed: Active directory strictly separates and excludes archived faculty.');

// =========================================================================
// TEST 6: Restore Functionality & Previous Status Preservation
// =========================================================================
console.log('\n--- TEST 6: Restore Functionality & Previous Status Preservation ---');
assert(fpHtml.includes('confirmRestoreFaculty'), 'confirmRestoreFaculty function must exist');
assert(fpHtml.includes("status: restoreStatus"), 'Restore operation must set status to previous restoreStatus');
assert(fpHtml.includes("Faculty account restored successfully."), 'Success toast for restore must exist');

console.log('✓ TEST 6 passed: Restore functionality implemented with previous status preservation.');

// =========================================================================
// TEST 7: Authentication Guard & Login Blocking
// =========================================================================
console.log('\n--- TEST 7: Authentication Guard & Login Blocking ---');

// Check auth.js
assert(authJs.includes("toLowerCase() === 'archived'"), 'CiteFlowAuth.login must check for Archived status');
assert(authJs.includes("This faculty account has been archived. Please contact the College Dean or Administrator."),
    'CiteFlowAuth.login must throw exact archive message');

// Check auth-guard.js
assert(guardJs.includes("isFacultyArchived"), 'CiteFlowAuthGuard must check for Archived status');
assert(guardJs.includes("login.html?archived=1"), 'CiteFlowAuthGuard must redirect to login.html?archived=1');

// Check login.html
assert(loginHtml.includes("urlParams.get('archived') === '1'"), 'login.html must detect archived=1 query parameter');
assert(loginHtml.includes("This faculty account has been archived. Please contact the College Dean or Administrator."),
    'login.html must show archived notification alert');

console.log('✓ TEST 7 passed: Supabase authentication blocking and redirection verified.');

// =========================================================================
// TEST 8: Required Toast Notification Messages
// =========================================================================
console.log('\n--- TEST 8: Exact Required Toast Notification Messages ---');

const requiredToasts = [
    'Academic rank updated successfully.',
    'Failed to update academic rank.',
    'Employment type updated successfully.',
    'Failed to update employment type.',
    'Faculty account archived successfully.',
    'Failed to archive faculty account.',
    'Faculty account restored successfully.',
    'Failed to restore faculty account.',
    'Cannot archive an active Department Chairperson. Assign a replacement first.',
    'Unauthorized: Only the College Dean or Secretary can archive faculty accounts.',
    'Unauthorized: Only the College Dean or Secretary can restore accounts.'
];

requiredToasts.forEach(toast => {
    assert(fpHtml.includes(toast), `Toast "${toast}" must be present in faculty-profiles.html`);
});

console.log('✓ TEST 8 passed: All required toast notification strings match specifications exactly.');

// =========================================================================
// TEST 9: UI Cleanup & Edit Details Teaching Status Removal
// =========================================================================
console.log('\n--- TEST 9: UI Cleanup & Edit Details Teaching Status Removal ---');

// 1. Unwanted text `================== -->` must not exist
assert(!fpHtml.includes('================== -->'), 'Stray text `================== -->` must not exist');
assert(!/={4,}\s*-->/.test(fpHtml), 'No malformed or ASCII banner comment closing tags should exist');

// 2. Teaching Status removed from Edit Details
assert(!fpHtml.includes('id="edit-teaching-status"'), 'edit-teaching-status input must be removed from Edit Details');
assert(!fpHtml.includes("ensureSelectValue('edit-teaching-status'"), 'ensureSelectValue for edit-teaching-status must be removed');
assert(!/updatedPayload\s*=\s*\{[\s\S]*?teaching_status:/.test(fpHtml), 'teaching_status must not be saved in updatedPayload from Edit Details');

// 3. Preservation: Read-only profile view still displays historical teaching status
assert(fpHtml.includes('id="gen-teaching-status"'), 'gen-teaching-status display element must be preserved on profile view');
assert(fpHtml.includes("setProfileText('gen-teaching-status'"), 'setProfileText for gen-teaching-status must be preserved');

// 4. Preservation: Academic Rank and Employment Type still present in Edit Details
assert(/<select[\s\S]*?id="edit-academic-rank"/.test(fpHtml), 'edit-academic-rank select must be preserved in Edit Details');
assert(/<select[\s\S]*?id="edit-employment-type"/.test(fpHtml), 'edit-employment-type select must be preserved in Edit Details');

console.log('✓ TEST 9 passed: Stray text removed, Teaching Status removed from Edit Details, and preservation verified.');

// =========================================================================
// TEST 10: Previous Status Preservation Logic
// =========================================================================
console.log('\n--- TEST 10: Previous Status Preservation Logic ---');

// Verify archival captures previous status
assert(fpHtml.includes("const previousStatus = targetRaw.status && String(targetRaw.status).toLowerCase() !== 'archived'"),
    'Archival logic must capture previousStatus from targetRaw.status');
assert(fpHtml.includes("previous_status: previousStatus"),
    'Archival logic must store previous_status in system_activity_logs metadata');

// Verify loadFacultyProfiles attaches previous_status
assert(fpHtml.includes("f.previous_status = prevStatusMap[f.id]"),
    'loadFacultyProfiles must map previous_status onto archivedFacultyData');

// Verify confirmRestoreFaculty uses previous_status
assert(fpHtml.includes("target?.previous_status") || fpHtml.includes("target.previous_status"),
    'confirmRestoreFaculty must check target.previous_status');
assert(fpHtml.includes("status: restoreStatus"),
    'confirmRestoreFaculty must update status with restoreStatus');

// Verify modal displays previous status
assert(fpHtml.includes("Prev Status:") || fpHtml.includes("Previous Status:"),
    'Archived faculty modal must display previous status');

console.log('✓ TEST 10 passed: Previous status preservation logic verified.');

console.log('\n=== ALL 10 VERIFICATION TEST SUITES PASSED! ===');
