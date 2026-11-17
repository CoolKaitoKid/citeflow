/**
 * Regression tests: COTE departments (BSIT, BSIE, BIT) with exactly one
 * official Chairperson per department, editable only by administrators.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

console.log('--- RUNNING DEPARTMENT CHAIRPERSON TESTS ---');

// 1. Migration -----------------------------------------------------------------
const sql = fs.readFileSync(path.join(root, '..', 'supabase', 'migrations', '040_department_chairpersons.sql'), 'utf8');
const adminCopy = read('admin/040_department_chairpersons.sql');
assert.strictEqual(adminCopy, sql, 'admin/ copy of migration 040 matches supabase/migrations');

assert(/CREATE TABLE IF NOT EXISTS public\.departments/.test(sql), 'departments table');
assert(/code\s+text PRIMARY KEY/.test(sql), 'one row (one chair slot) per department');
assert(/CHECK \(code IN \('BSIT', 'BSIE', 'BIT'\)\)/.test(sql), 'only the three COTE departments');
['BSIT', 'BSIE', 'BIT'].forEach(code => assert(sql.includes(`('${code}',`), `seeds ${code}`));
assert(/CREATE UNIQUE INDEX IF NOT EXISTS departments_one_department_per_chair/.test(sql), 'a faculty member chairs at most one department');
assert(/FUNCTION public\.admin_set_department_chair\(\s*p_department text,\s*p_faculty_id text\s*\)/.test(sql), 'admin RPC');
assert(/IF NOT public\.wf_is_final_approver\(\) THEN[\s\S]{0,120}Only administrators/.test(sql), 'RPC is admin-only');
assert(/FOR UPDATE;/.test(sql), 'department row locked while replacing the chair');
assert(/SET role = 'Faculty'/.test(sql) && /SET role = 'Chairperson'/.test(sql), 'previous chair demoted, new chair promoted');
assert(/CREATE TRIGGER trg_faculty_enforce_department_chair[\s\S]*BEFORE INSERT OR UPDATE OF role, position, department ON public\.faculty/.test(sql), 'guard trigger on faculty');
assert(/NEW\.role := 'Faculty'/.test(sql), 'non-official chair roles are reset to Faculty');
assert(/official % Chairperson\. Assign a new % Chairperson/.test(sql), 'official chair cannot be moved to another department');
assert(/departments_select_authenticated/.test(sql) && !/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)[^;]*ON public\.departments/i.test(sql), 'no direct client writes to departments');
assert(/REVOKE ALL ON FUNCTION public\.admin_set_department_chair\(text, text\) FROM PUBLIC, anon/.test(sql), 'anon cannot call RPC');

// 2. Admin UI --------------------------------------------------------------------
const fp = read('admin/faculty-profiles.html');
assert(fp.includes('id="deptChairCard"') && fp.includes('Department Chairpersons'), 'Faculty Profiles shows the Department Chairpersons card');
assert(/rpc\('admin_set_department_chair'/.test(fp), 'card saves through the admin RPC');
assert(/rpc\('list_department_chairs'\)/.test(fp), 'card reads current chairs');
assert(/rpc\('wf_is_final_approver'\)/.test(fp), 'edit controls only for administrators');
assert(/CiteFlowUI\.dialog\(\{\s*title: replacing/.test(fp), 'replacement uses the system modal');
assert(!/<option value="Chairperson">Chairperson<\/option>/.test(fp), 'Chairperson removed from Faculty Profiles role dropdowns');
assert(fp.includes('applyChairLockToEditModal(editingRow)'), 'official chair role/department locked in edit modal');

const um = read('admin/user-management.html');
assert(um.includes('<option value="Chairperson" hidden>Chairperson</option>'), 'User Management cannot pick Chairperson');
assert(um.includes("roleSelectEl.disabled = isDeptChair"), 'User Management locks the official chair');

const ob = read('onboarding.html');
assert(ob.includes('<option value="Chairperson" hidden>Chairperson</option>'), 'onboarding cannot self-select Chairperson');

const allSources = [fp, um, ob].join('\n');
assert(!/\b(alert|confirm|prompt)\s*\(\s*['"`]/.test(allSources.replace(/CiteFlowUI\.(alert|confirm)/g, '')), 'no native browser dialogs added');

// 3. Department lists stay COTE-only ---------------------------------------------
const e0 = read('faculty/form-e0.js');
['BSCE', 'BSEE', 'BSME', 'BSCpE'].forEach(code => {
    assert(!new RegExp(`\\^${code.toLowerCase()}\\$`).test(e0), `Form E-0 department map has no ${code}`);
});

console.log('ALL DEPARTMENT CHAIRPERSON TESTS PASSED SUCCESSFULLY!');
