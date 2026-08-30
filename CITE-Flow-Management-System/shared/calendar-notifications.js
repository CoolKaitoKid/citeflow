/**
 * CITE-Flow drop-in notifications
 *
 * Do NOT edit nav.html or faculty-nav.html.
 * Admin bell wiring also lives in nav.js (strips alert('Notifications')).
 *
 * Include on admin/faculty pages after supabase-config.js:
 *
 *   <script src="../shared/calendar-notifications.js"></script>
 */
(function (global) {
  const FACULTY_TABLES = ['faculty', 'faculty_profiles', 'profiles', 'faculty_users'];
  const seenIds = new Set();
  const seenEventToasts = new Set();
  const recentNotify = new Map();

  let started = false;
  let startAttempts = 0;
  let items = [];
  let currentUser = null;
  let currentProfile = null;
  let currentPortal = 'faculty';
  let channel = null;
  let eventsChannel = null;
  let extraChannel = null;
  let panelOpen = false;

  function client() {
    const candidates = [global.supabaseClient, global.db, global.supabase];
    for (const item of candidates) {
      if (item && typeof item.from === 'function' && item.auth) return item;
    }
    if (global.supabaseClient && typeof global.supabaseClient.from === 'function') return global.supabaseClient;
    return null;
  }

  function esc(value) {
    return String(value || '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }

  function normalizeScope(value) {
    const v = String(value || '').toLowerCase().trim();
    if (!v || ['all_faculty', 'all faculty', 'all', 'faculty', 'everyone'].includes(v)) return 'all_faculty';
    if (['admin_only', 'only me', 'admin only'].includes(v)) return 'admin_only';
    if (v.includes('chair')) return 'department_chairs';
    if (v.includes('bsit') || v.includes('information technology')) return 'bsit';
    if (v.includes('bsie') || v.includes('industrial engineering')) return 'bsie';
    if (/\bbit\b/.test(v) || v.includes('industrial technology')) return 'bit';
    return v;
  }

  function facultyCanReceive(audience, profile) {
    const scope = normalizeScope(audience);
    if (scope === 'admin_only') return false;
    if (scope === 'all_faculty') return true;
    const role = String(profile?.role || profile?.position || '').toLowerCase();
    if (scope === 'department_chairs') {
      return role.includes('chair') || role.includes('head') || role.includes('dean');
    }
    const program = normalizeScope(
      profile?.program ||
      profile?.department ||
      profile?.course ||
      profile?.department_program ||
      profile?.program_name ||
      ''
    );
    return program === scope;
  }

  function formatWhen(row) {
    if (!row) return '';
    const start = row.start_at || row.startAt;
    if (!start) return '';
    const date = new Date(start);
    if (Number.isNaN(date.getTime())) return '';
    if (row.all_day || row.allDay) {
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function buildCopy(row, action) {
    const title = row.title || 'Untitled schedule';
    const type = String(row.event_type || row.type || 'schedule').replace(/_/g, ' ');
    const when = formatWhen(row);
    const location = row.location && row.location !== 'TBA' ? ` at ${row.location}` : '';
    if (action === 'delete') {
      return {
        title: 'Calendar schedule cancelled',
        message: `${title} has been removed from the faculty calendar.`
      };
    }
    if (action === 'update') {
      return {
        title: 'Calendar schedule updated',
        message: `${title} (${type}) was updated${when ? ' • ' + when : ''}${location}.`
      };
    }
    return {
      title: 'New calendar schedule',
      message: `${title} (${type}) was posted${when ? ' • ' + when : ''}${location}.`
    };
  }

  async function loadFacultyProfile(user) {
    const meta = user?.user_metadata || {};
    let profile = {
      id: user?.id,
      email: user?.email,
      role: meta.role || 'Faculty',
      program: meta.program || meta.department || meta.course || '',
      department: meta.department || meta.program || '',
      first_name: meta.first_name || '',
      last_name: meta.last_name || ''
    };

    if (!user?.id || !client()) return profile;

    for (const table of FACULTY_TABLES) {
      const { data, error } = await client().from(table).select('*').eq('id', user.id).maybeSingle();
      if (!error && data) {
        profile = { ...profile, ...data };
        break;
      }
    }
    return profile;
  }

  async function fetchFacultyRecipients(scope) {
    if (!client()) return [];
    for (const table of FACULTY_TABLES) {
      const { data, error } = await client().from(table).select('*').limit(800);
      if (error || !Array.isArray(data) || !data.length) continue;
      return data.filter((row) => facultyCanReceive(scope, row) && row.id);
    }
    return [];
  }

  function isAdminRole(value) {
    const role = String(value || '').toLowerCase();
    return role.includes('admin') || role.includes('dean') || role.includes('director');
  }

  async function fetchAdminRecipients() {
    if (!client()) return [];
    const tables = ['admin_profiles', 'profiles', 'faculty_profiles'];
    for (const table of tables) {
      const { data, error } = await client().from(table).select('*').limit(500);
      if (error || !Array.isArray(data) || !data.length) continue;
      if (table === 'admin_profiles') return data.filter((row) => row.id);
      return data.filter((row) => row.id && isAdminRole(row.role));
    }
    return [];
  }

  function safeEventId(value) {
    if (!value) return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value))
      ? String(value)
      : null;
  }

  function stripUnknownColumn(rows, error) {
    const msg = String(error?.message || error?.details || error?.hint || '');
    const match = msg.match(/column "([^"]+)"/i)
      || msg.match(/Could not find the '([^']+)' column/i)
      || msg.match(/'([^']+)' column of 'notifications'/i)
      || msg.match(/'([^']+)' column of 'wf_notifications'/i);
    if (!match) return null;
    const col = match[1];
    return rows.map((row) => {
      const next = { ...row };
      delete next[col];
      return next;
    });
  }

  async function fetchFacultyTableRecipients(scope) {
    if (!client()) return [];
    const { data, error } = await client().from('faculty').select('*').limit(800);
    if (error || !Array.isArray(data) || !data.length) return [];
    return data.filter((row) => row.id && facultyCanReceive(scope, {
      ...row,
      role: row.position || row.role,
      program: row.department || row.program || row.course || ''
    }));
  }

  async function insertTableRows(table, rows) {
    const db = client();
    if (!db) return { ok: false, error: 'Missing client' };
    let current = rows;
    let error = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      ({ error } = await db.from(table).insert(current));
      if (!error) return { ok: true, count: current.length };
      const stripped = stripUnknownColumn(current, error);
      if (stripped) {
        current = stripped;
        continue;
      }
      break;
    }
    return { ok: false, error };
  }

  async function insertWfNotificationRows(base) {
    const db = client();
    if (!db) return { ok: false, error: 'Missing client' };

    try {
      const { data, error } = await db.rpc('cite_notify_wf_calendar', {
        p_title: base.title || 'New calendar schedule',
        p_message: base.message || base.title || 'A new schedule was posted.',
        p_link: base.link || 'calendar.html',
        p_audience: base.audience || 'all_faculty'
      });
      if (!error && Number(data) > 0) return { ok: true, count: Number(data), via: 'rpc-wf' };
      if (error) console.warn('CalendarNotifications: cite_notify_wf_calendar RPC', error);
    } catch (err) {
      console.warn('CalendarNotifications: cite_notify_wf_calendar RPC threw', err);
    }

    let recipients = [];
    try {
      recipients = await fetchFacultyTableRecipients(base.audience || 'all_faculty');
    } catch (err) {
      console.warn('CalendarNotifications: could not load faculty table recipients', err);
    }

    const payload = {
      message: base.message || base.title || 'A new schedule was posted.',
      is_read: false,
      type: 'calendar',
      title: base.title || 'New calendar schedule',
      link: base.link || 'calendar.html'
    };
    const rows = recipients.length
      ? recipients.map((person) => ({ ...payload, faculty_id: person.id }))
      : [{ ...payload, faculty_id: null }];
    const result = await insertTableRows('wf_notifications', rows);
    if (!result.ok) {
      console.error('CalendarNotifications: wf_notifications insert failed', result.error);
    }
    return result;
  }

  async function insertNotificationRows(base, recipients) {
    const db = client();
    if (!db) return { ok: false, error: 'Missing client' };
    const payload = { ...base, event_id: safeEventId(base.event_id) };
    let rows = recipients.length
      ? recipients.map((person) => ({ ...payload, user_id: person.id }))
      : [{ ...payload, user_id: null }];

    let error = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      ({ error } = await db.from('notifications').insert(rows));
      if (!error) return { ok: true, count: rows.length };
      const stripped = stripUnknownColumn(rows, error);
      if (stripped) {
        rows = stripped;
        continue;
      }
      if (payload.event_id) {
        rows = rows.map((row) => ({ ...row, event_id: null }));
        payload.event_id = null;
        continue;
      }
      break;
    }
    if (error) {
      console.error('CalendarNotifications: insert failed', error);
      return { ok: false, error };
    }
    return { ok: true, count: rows.length };
  }

  function rememberNotify(kind, id, action) {
    const key = `${kind}:${action || 'create'}:${id || ''}`;
    const now = Date.now();
    const last = recentNotify.get(key) || 0;
    if (now - last < 4000) return false;
    recentNotify.set(key, now);
    return true;
  }

  async function notifyCalendarEvent(row, action) {
    if (!row) return { ok: false, error: 'Missing event' };
    if (!rememberNotify('calendar', row.id, action || 'create')) {
      return { ok: true, skipped: true, duplicate: true };
    }
    const scope = normalizeScope(row.visibility_scope || row.visibility || 'all_faculty');
    if (scope === 'admin_only') return { ok: true, skipped: true };

    const copy = buildCopy(row, action || 'create');
    const base = {
      title: copy.title,
      message: copy.message,
      type: 'calendar',
      audience: scope,
      event_id: row.id || null,
      link: row.id ? `calendar.html#open=${row.id}` : 'calendar.html',
      is_read: false
    };

    const wfResult = await insertWfNotificationRows(base);

    try {
      const { data, error } = await client().rpc('cite_notify_calendar_event', {
        p_event_id: safeEventId(row.id),
        p_action: action || 'create',
        p_title: copy.title,
        p_message: copy.message,
        p_audience: scope,
        p_link: base.link
      });
      if (!error && wfResult.ok) return { ok: true, count: Number(data) || wfResult.count || 0, via: 'rpc' };
    } catch (err) {
      console.warn('CalendarNotifications: RPC notify unavailable', err);
    }

    let recipients = [];
    try {
      recipients = await fetchFacultyRecipients(scope);
    } catch (err) {
      console.warn('CalendarNotifications: could not load faculty recipients', err);
    }
    const legacy = await insertNotificationRows(base, recipients);
    return wfResult.ok ? wfResult : legacy;
  }

  async function notifyAdmins({ title, message, type, eventId, link }) {
    const base = {
      title: title || 'CITE-Flow update',
      message: message || '',
      type: type || 'admin',
      audience: 'admin',
      event_id: eventId || null,
      link: link || 'calendar.html',
      is_read: false
    };
    let recipients = [];
    try {
      recipients = await fetchAdminRecipients();
    } catch (err) {
      console.warn('CalendarNotifications: could not load admin recipients', err);
    }
    return insertNotificationRows(base, recipients);
  }

  async function notifyLeaveFiling(leave) {
    if (!leave) return { ok: false };
    if (!rememberNotify('leave', leave.id, 'create')) return { ok: true, skipped: true, duplicate: true };
    const name = leave.faculty_name || 'A faculty member';
    const kind = leave.leave_type || 'leave';
    const start = leave.start_date || '';
    const end = leave.end_date || leave.start_date || '';
    const range = start && end && start !== end ? `${start} to ${end}` : (start || 'the selected dates');
    return notifyAdmins({
      title: 'New faculty leave filing',
      message: `${name} filed ${kind} for ${range}.`,
      type: 'leave',
      eventId: leave.id,
      link: leave.id ? `calendar.html#open=leave-${leave.id}` : 'calendar.html'
    });
  }

  async function notifyEventFeedback(feedback, eventRow) {
    if (!feedback) return { ok: false };
    if (!rememberNotify('feedback', feedback.id || feedback.event_id, 'create')) {
      return { ok: true, skipped: true, duplicate: true };
    }
    const name = feedback.faculty_name || 'A faculty member';
    const eventTitle = eventRow?.title || 'an event';
    const rating = feedback.overall_rating != null ? ` (${feedback.overall_rating}/5)` : '';
    return notifyAdmins({
      title: 'New event feedback',
      message: `${name} submitted feedback for ${eventTitle}${rating}.`,
      type: 'feedback',
      eventId: feedback.event_id || eventRow?.id,
      link: (feedback.event_id || eventRow?.id)
        ? `calendar.html#open=event-${feedback.event_id || eventRow.id}`
        : 'feedback-summary.html'
    });
  }

  function unreadCount() {
    return items.filter((item) => !item.is_read).length;
  }

  function ensureStyles() {
    let style = document.getElementById('cite-calendar-notif-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'cite-calendar-notif-styles';
      document.head.appendChild(style);
    }
    style.textContent = `
      .cite-toast-root{position:fixed;top:84px;right:16px;z-index:4000;display:flex;flex-direction:column;gap:10px;max-width:min(380px,calc(100vw - 24px));pointer-events:none}
      .cite-toast{pointer-events:auto;background:#fff;border:1px solid #e5e7eb;border-left:4px solid #621708;border-radius:16px;box-shadow:0 18px 45px rgba(15,23,42,.12);padding:12px 14px;animation:citeToastIn .18s ease}
      .cite-toast b{display:block;font-size:13px;color:#0f172a;margin-bottom:2px}
      .cite-toast p{margin:0;font-size:12px;color:#475569;line-height:1.4}
      #adminNavNotifDropdown.nav-notif-dropdown{position:absolute!important;top:calc(100% + 10px)!important;right:0!important;width:340px;max-width:calc(100vw - 24px);background:#fff!important;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 40px rgba(15,23,42,.14);display:none!important;z-index:99999!important;overflow:hidden}
      #adminNavNotifDropdown.nav-notif-dropdown.open{display:block!important}
      #adminNavNotifDropdown .nav-notif-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #eee;color:#111;font-size:14px;font-weight:700}
      #adminNavNotifDropdown .nav-notif-header button{border:0;background:transparent;color:#621708;font-size:12px;font-weight:700;cursor:pointer}
      #adminNavNotifDropdown .nav-notif-list{max-height:380px;overflow-y:auto;padding:4px 0}
      #adminNavNotifDropdown .nav-notif-item{display:block;width:100%;text-align:left;padding:12px 16px;border:0;border-radius:0;background:transparent;color:#374151;font-size:13px;line-height:1.45;font-weight:400;cursor:pointer}
      #adminNavNotifDropdown .nav-notif-item.unread{background:#eff6ff}
      #adminNavNotifDropdown .nav-notif-item small,#adminNavNotifDropdown .nav-notif-date{display:block;margin-top:6px;color:#9ca3af;font-size:12px;font-weight:400}
      #adminNavNotifDropdown .nav-notif-empty{padding:24px 16px;text-align:center;color:#9ca3af;font-size:13px;margin:0}
      @keyframes citeToastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
    `;
  }

  function ensureToastRoot() {
    let root = document.getElementById('cite-toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'cite-toast-root';
      root.className = 'cite-toast-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function showToast(item) {
    ensureStyles();
    const root = ensureToastRoot();
    const el = document.createElement('div');
    el.className = 'cite-toast';
    el.innerHTML = `<b>${esc(item.title)}</b><p>${esc(item.message)}</p>`;
    root.prepend(el);
    setTimeout(() => el.remove(), 7000);
  }

  function showBrowserNotification(item) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(item.title || 'CITE-Flow', {
        body: item.message || 'You have a new calendar update.',
        tag: item.event_id || item.id || 'cite-calendar'
      });
      n.onclick = () => {
        window.focus();
        n.close();
        if (item.event_id && typeof global.showEventDetails === 'function') {
          global.showEventDetails(item.event_id);
        }
      };
    } catch (err) {
      console.warn('CalendarNotifications: browser notification failed', err);
    }
  }

  function requestBrowserPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function hasNativeFacultyNotifUI() {
    return !!(document.getElementById('facultyNavNotifBtn') && (
      document.getElementById('facultyNavNotifDropdown')
      || document.getElementById('facultyNavNotifList')
    ));
  }

  function existingBell() {
    if (hasNativeFacultyNotifUI()) return null;
    return document.getElementById('adminNavNotifBadge')
      || document.getElementById('cite-bell-badge')
      || document.getElementById('notif-badge')
      || document.getElementById('notification-count')
      || document.querySelector('.nav-actions .nav-notif-badge')
      || document.querySelector('[data-notif-badge]');
  }

  function existingBellButton() {
    if (hasNativeFacultyNotifUI()) return null;
    return document.getElementById('adminNavNotifBtn')
      || document.getElementById('cite-bell-btn')
      || document.getElementById('notif-bell-btn')
      || document.querySelector('nav.navbar .nav-actions .fa-bell')?.closest('button, .nav-btn')
      || document.querySelector('.nav-actions .fa-bell')?.closest('button, .nav-btn');
  }

  function existingPanel() {
    if (hasNativeFacultyNotifUI()) return null;
    return document.getElementById('adminNavNotifDropdown')
      || document.querySelector('.nav-actions .nav-notif-dropdown');
  }

  function existingList() {
    if (hasNativeFacultyNotifUI()) return null;
    return document.getElementById('adminNavNotifList')
      || document.querySelector('#adminNavNotifDropdown .nav-notif-list')
      || document.querySelector('.nav-actions .nav-notif-list');
  }

  function panelMarkup() {
    return `
      <div id="adminNavNotifDropdown" class="nav-notif-dropdown">
        <div class="nav-notif-header">
          <span>Notifications</span>
          <button type="button" id="cite-mark-all-read">Mark all read</button>
        </div>
        <div id="adminNavNotifList" class="nav-notif-list">
          <p class="nav-notif-empty">No notifications yet</p>
        </div>
      </div>
    `;
  }

  function bindNavGlobals() {
    if (typeof global.toggleFacultyNotifications !== 'function') {
      global.toggleFacultyNotifications = togglePanel;
    }
    if (typeof global.markFacultyNavNotificationsRead !== 'function') {
      global.markFacultyNavNotificationsRead = markAllRead;
    }
  }

  function isAdminAlertBell(target) {
    if (!target || hasNativeFacultyNotifUI()) return null;
    const btn = target.closest ? target.closest('.nav-btn, button.nav-btn') : null;
    if (!btn || !btn.querySelector('.fa-bell')) return null;
    if (btn.id === 'facultyNavNotifBtn' || btn.querySelector('.fa-circle-user, .fa-user')) return null;
    if (!btn.closest('.nav-actions, .navbar, nav')) return null;
    return btn;
  }

  function disarmAdminAlertBell() {
    document.querySelectorAll('.nav-actions .nav-btn, nav.navbar .nav-btn').forEach((btn) => {
      if (!btn.querySelector('.fa-bell')) return;
      if (btn.id === 'facultyNavNotifBtn') return;
      btn.removeAttribute('onclick');
      btn.onclick = null;
    });
  }

  function interceptAdminAlertBell() {
    if (document.documentElement.dataset.citeAdminBellCapture) return;
    document.documentElement.dataset.citeAdminBellCapture = '1';
    document.addEventListener('click', (event) => {
      const btn = isAdminAlertBell(event.target);
      if (!btn) return;
      if (btn.dataset.citeWired || document.getElementById('adminNavNotifBtn')?.dataset.citeWired) {
        return;
      }
      if (!String(btn.getAttribute('onclick') || '').includes('alert')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      currentPortal = 'admin';
      disarmAdminAlertBell();
      mountFacultyBell();
      togglePanel();
    }, true);
  }

  function bindPanelControls(host) {
    if (hasNativeFacultyNotifUI()) return;

    interceptAdminAlertBell();
    disarmAdminAlertBell();

    const btn = existingBellButton();
    if (btn && !btn.dataset.citeWired && !btn.dataset.citeNotifBound) {
      btn.dataset.citeNotifBound = '1';
      btn.removeAttribute('onclick');
      btn.onclick = null;
      btn.addEventListener('click', function (event) {
        if (btn.dataset.citeWired) return;
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
      });
    }
    const markAll = document.getElementById('cite-mark-all-read');
    if (markAll) {
      markAll.onclick = function (event) {
        event.preventDefault();
        event.stopPropagation();
        markAllRead();
      };
    }
    if (!document.documentElement.dataset.citeNotifClickBound) {
      document.documentElement.dataset.citeNotifClickBound = '1';
      document.addEventListener('click', (event) => {
        const panel = existingPanel();
        const wrap = panel?.parentElement || document.querySelector('.nav-actions .nav-notif-wrap');
        if (!panel || !panel.classList.contains('open')) return;
        if (wrap && wrap.contains(event.target)) return;
        closePanel();
      });
    }
  }

  function formatNotifDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function notifBody(item) {
    return String(item?.message || item?.title || 'Notification').trim();
  }

  function notifItemInner(item) {
    const date = formatNotifDate(item?.created_at);
    return `${esc(notifBody(item))}${date ? `<small>${esc(date)}</small>` : ''}`;
  }

  function renderList() {
    const list = existingList();
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p class="nav-notif-empty">No notifications yet</p>';
      return;
    }
    list.innerHTML = items.slice(0, 30).map((item) => `
      <button type="button" class="nav-notif-item ${item.is_read ? '' : 'unread'}" data-notif-id="${esc(item.id)}" data-event-id="${esc(item.event_id || '')}" data-notif-type="${esc(item.type || '')}" data-notif-link="${esc(item.link || '')}">
        ${notifItemInner(item)}
      </button>
    `).join('');
  }

  function mergeIntoNativeList(item) {
    const list = document.getElementById('facultyNavNotifList');
    if (!list || !item?.id) return;
    const id = String(item.id);
    if (list.querySelector(`[data-notif-id="${esc(id)}"]`) || list.querySelector(`[data-id="${esc(id)}"]`)) return;
    if (item.event_id && list.querySelector(`[data-event-id="${String(item.event_id)}"]`)) return;
    const snippet = notifBody(item).slice(0, 48);
    if (snippet && Array.from(list.querySelectorAll('.nav-notif-item')).some((el) => (el.textContent || '').includes(snippet))) return;

    const empty = list.querySelector('.nav-notif-empty');
    if (empty) empty.remove();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `nav-notif-item ${item.is_read ? '' : 'unread'}`;
    btn.setAttribute('data-notif-id', id);
    btn.setAttribute('data-event-id', item.event_id || '');
    btn.setAttribute('data-notif-type', item.type || '');
    btn.setAttribute('data-notif-link', item.link || '');
    btn.innerHTML = notifItemInner(item);
    list.prepend(btn);
  }

  function bumpNativeBadge() {
    const badge = document.getElementById('facultyNavNotifBadge');
    if (!badge) return;
    const n = parseInt(badge.textContent, 10) || 0;
    badge.textContent = String(n + 1);
    badge.style.display = 'inline-flex';
    badge.classList.add('show');
    badge.classList.remove('hidden');
  }

  function updateBadge() {
    if (hasNativeFacultyNotifUI()) {
      items.forEach((item) => mergeIntoNativeList(item));
      return;
    }

    const count = unreadCount();
    const badges = [
      document.getElementById('adminNavNotifBadge'),
      document.getElementById('cite-bell-badge'),
      document.getElementById('notif-badge'),
      document.getElementById('notification-count'),
      document.querySelector('.nav-actions .nav-notif-badge'),
      document.querySelector('[data-notif-badge]')
    ].filter(Boolean);

    badges.forEach((badge) => {
      badge.textContent = String(count);
      badge.classList.toggle('show', count > 0);
      badge.classList.toggle('hidden', count === 0);
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    });
    renderList();
  }

  function setPanelOpen(open) {
    panelOpen = open;
    const panel = existingPanel();
    if (!panel) return;
    panel.classList.toggle('open', open);
    if (panel.id === 'adminNavNotifDropdown') {
      panel.style.display = open ? 'block' : 'none';
    }
  }

  function closePanel() {
    setPanelOpen(false);
  }

  function togglePanel() {
    const panel = existingPanel();
    const isOpen = panel ? panel.classList.contains('open') : panelOpen;
    setPanelOpen(!isOpen);
  }

  function refreshAdmin() {
    currentPortal = 'admin';
    mountFacultyBell();
    updateBadge();
    loadExisting().catch(() => {});
  }

  function prepareMainNavBell(btn) {
    if (!btn || hasNativeFacultyNotifUI()) return btn?.closest('.nav-notif-wrap') || null;
    if (!btn.id) btn.id = currentPortal === 'admin' ? 'adminNavNotifBtn' : 'cite-bell-btn';
    btn.setAttribute('title', 'Notifications');
    btn.style.position = btn.style.position || 'relative';

    let badge = existingBell();
    if (!badge || !btn.contains(badge)) {
      badge = document.createElement('span');
      badge.id = 'adminNavNotifBadge';
      badge.className = 'nav-notif-badge';
      badge.setAttribute('data-notif-badge', '');
      badge.textContent = '0';
      badge.style.display = 'none';
      btn.appendChild(badge);
    }

    let host = btn.closest('.nav-notif-wrap');
    if (!host) {
      host = document.createElement('div');
      host.className = 'nav-notif-wrap';
      btn.parentElement.insertBefore(host, btn);
      host.appendChild(btn);
    }
    return host;
  }

  function mountFacultyBell() {
    ensureStyles();
    bindNavGlobals();
    interceptAdminAlertBell();
    disarmAdminAlertBell();

    if (hasNativeFacultyNotifUI()) {
      bindNotifOpenClicks();
      watchFacultyNativeList();
      items.forEach((item) => mergeIntoNativeList(item));
      return true;
    }

    const headerBtn = existingBellButton();
    if (!headerBtn) return false;

    const host = prepareMainNavBell(headerBtn);
    const leftoverModal = document.getElementById('adminNotifModal');
    if (leftoverModal) leftoverModal.remove();
    const leftoverBackdrop = document.getElementById('adminNotifBackdrop');
    if (leftoverBackdrop) leftoverBackdrop.remove();
    if (host && !existingPanel()) {
      host.insertAdjacentHTML('beforeend', panelMarkup());
    }

    bindPanelControls(host || headerBtn.parentElement);
    bindNotifOpenClicks();
    watchFacultyNativeList();
    updateBadge();
    return true;
  }

  function watchNavMount() {
    mountFacultyBell();
    let tries = 0;
    const tick = () => {
      mountFacultyBell();
      tries += 1;
      if (tries < 40) window.setTimeout(tick, 250);
    };
    window.setTimeout(tick, 250);
  }

  function remember(item) {
    const key = item.id || `${item.event_id}-${item.created_at}-${item.title}`;
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  }

  function canShowNotification(item) {
    if (!item) return false;
    if (currentPortal === 'admin') {
      if (item.audience === 'admin' || item.type === 'leave' || item.type === 'feedback') return true;
      if (item.user_id && currentUser?.id && item.user_id === currentUser.id) return true;
      return false;
    }
    if (item.audience === 'admin' || item.type === 'leave' || item.type === 'feedback') return false;
    if (item.user_id && currentUser?.id && item.user_id !== currentUser.id) return false;
    return facultyCanReceive(item.audience || 'all_faculty', currentProfile);
  }

  function currentPageFile() {
    const parts = String(location.pathname || '').split('/').filter(Boolean);
    return (parts[parts.length - 1] || '').toLowerCase();
  }

  function inferNotifPage(item) {
    const type = String(item?.type || '').toLowerCase();
    const text = `${item?.title || ''} ${item?.message || ''}`.toLowerCase();
    const stored = String(item?.link || '').trim();
    if (stored && /\.html/i.test(stored)) return stored;
    if (currentPortal === 'admin') {
      if (type === 'leave' || text.includes('leave')) return 'calendar.html';
      if (type === 'feedback' || text.includes('feedback')) return 'calendar.html';
      if (type === 'calendar' || type === 'event' || type === 'schedule') return 'calendar.html';
      if (type.includes('task') || text.includes('new task') || text.includes('is due')) return 'workload-tracker.html';
      if (type.includes('workflow') || text.includes('approval')) return 'workflow-approval.html';
      if (type.includes('document') || text.includes('vault')) return 'document-vault.html';
      if (type.includes('engagement')) return 'engagement-logs.html';
      if (text.includes('faculty profile')) return 'faculty-profiles.html';
      return 'calendar.html';
    }
    return stored || 'calendar.html';
  }

  function detailIdFromItem(item) {
    const type = String(item?.type || '').toLowerCase();
    const stored = String(item?.link || '');
    const hashMatch = stored.match(/#open=([^&]+)/i);
    if (hashMatch) return decodeURIComponent(hashMatch[1]);
    const eventId = item?.event_id ? String(item.event_id) : '';
    if (!eventId) return '';
    if (eventId.startsWith('leave-') || eventId.startsWith('event-')) return eventId;
    if (type === 'leave') return 'leave-' + eventId;
    if (currentPortal === 'faculty') return eventId.replace(/^event-/, '');
    return 'event-' + eventId;
  }

  function resolveNotifHref(page, hash) {
    let file = String(page || 'calendar.html').trim();
    const embeddedHash = file.includes('#') ? file.slice(file.indexOf('#')) : '';
    file = file.split('#')[0].split('?')[0];
    file = file.split('/').pop() || 'calendar.html';
    if (!/\.html$/i.test(file)) file += '.html';
    const finalHash = hash || embeddedHash || '';
    const path = String(location.pathname || '').toLowerCase();
    let href = file;
    if (!path.includes('/admin/') && !path.includes('/faculty/')) {
      href = (currentPortal === 'admin' ? 'admin/' : 'faculty/') + file;
    }
    return href + finalHash;
  }

  function isSamePage(page) {
    const target = String(page || '').split('#')[0].split('/').pop().toLowerCase();
    const current = currentPageFile();
    return current === target || current.replace('.html', '') === target.replace('.html', '');
  }

  async function markReadNow(id) {
    if (!id) return;
    const item = items.find((row) => String(row.id) === String(id));
    if (item) item.is_read = true;
    updateBadge();
    const db = client();
    if (!db) return;
    await db.from('notifications').update({ is_read: true }).eq('id', id);
  }

  let navLockAt = 0;

  async function openFromNotification(item) {
    const now = Date.now();
    if (now - navLockAt < 400) return;
    navLockAt = now;

    const page = inferNotifPage(item) || 'calendar.html';
    const openId = detailIdFromItem(item);
    let hash = '';
    if (String(page).includes('#')) hash = page.slice(page.indexOf('#'));
    else if (openId) hash = '#open=' + encodeURIComponent(openId);

    if (openId) {
      try { sessionStorage.setItem('citeOpenNotif', openId); } catch (_) {}
    }

    const href = resolveNotifHref(page, hash);
    try {
      await markReadNow(item?.id);
    } catch (_) {}

    if (!isSamePage(page)) {
      window.location.assign(href);
      return;
    }

    closePanel();
    if (typeof global.openPendingCalendarNotification === 'function') {
      global.openPendingCalendarNotification();
      return;
    }
    if (openId && typeof global.showEventDetails === 'function') {
      global.showEventDetails(openId);
    }
  }

  function isCalendarDestination(item, row) {
    const type = String(item?.type || row?.getAttribute?.('data-notif-type') || '').toLowerCase();
    const link = String(item?.link || row?.getAttribute?.('data-notif-link') || row?.getAttribute?.('data-link') || '');
    const text = `${item?.title || ''} ${item?.message || ''} ${row?.textContent || ''}`.toLowerCase();
    if (['calendar', 'event', 'schedule'].includes(type)) return true;
    if (/calendar\.html/i.test(link) || /#open=/i.test(link)) return true;
    if (/new calendar schedule|calendar schedule updated|calendar schedule cancelled/.test(text)) return true;
    if (/was posted\b|was updated\b/.test(text) && /schedule|seminar|workshop|meeting|exam/.test(text)) return true;
    return false;
  }

  function itemFromNotifRow(row) {
    const id = row.getAttribute('data-notif-id') || row.getAttribute('data-id') || '';
    const href = row.getAttribute('href')
      || row.getAttribute('data-notif-link')
      || row.getAttribute('data-link')
      || row.querySelector?.('a')?.getAttribute('href')
      || '';
    const byId = items.find((rowItem) => String(rowItem.id) === String(id));
    if (byId) return byId;
    const text = String(row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const byText = items.find((rowItem) => {
      const msg = String(rowItem.message || rowItem.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return msg && text.includes(msg.slice(0, 48));
    });
    if (byText) return byText;
    return {
      id,
      event_id: row.getAttribute('data-event-id') || row.getAttribute('data-event') || '',
      type: row.getAttribute('data-notif-type') || row.getAttribute('data-type') || 'calendar',
      link: href,
      title: '',
      message: row.textContent || ''
    };
  }

  function watchFacultyNativeList() {
    const list = document.getElementById('facultyNavNotifList');
    if (!list || list.dataset.citeWatch === '1') return;
    list.dataset.citeWatch = '1';
    const obs = new MutationObserver(() => {
      items.forEach((item) => mergeIntoNativeList(item));
    });
    obs.observe(list, { childList: true });
    items.forEach((item) => mergeIntoNativeList(item));
  }

  function bindNotifOpenClicks() {
    if (document.documentElement.dataset.citeNotifOpenBound) return;
    document.documentElement.dataset.citeNotifOpenBound = '1';

    const go = (event) => {
      if (event.button != null && event.button !== 0) return;
      if (event.target.closest('#cite-mark-all-read, .nav-notif-header button')) return;

      const adminRow = event.target.closest('#adminNavNotifList .nav-notif-item, #adminNavNotifList [data-notif-id], #adminNavNotifDropdown [data-notif-id]');
      if (adminRow) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        currentPortal = 'admin';
        openFromNotification(itemFromNotifRow(adminRow));
        return;
      }

      // Faculty main bell is owned by faculty-nav.js (wf_notifications is_read).
    };

    document.addEventListener('click', go, true);
  }

  function ingest(item, { toast } = { toast: false }) {
    if (!canShowNotification(item)) return;
    if (!remember(item)) return;

    const existing = items.findIndex((row) => row.id && item.id && row.id === item.id);
    if (existing >= 0) items[existing] = item;
    else items.unshift(item);

    items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    items = items.slice(0, 40);
    updateBadge();

    if (toast) {
      const eventKey = item.event_id ? `toast-${item.event_id}` : `toast-${item.id}`;
      if (seenEventToasts.has(eventKey)) return;
      seenEventToasts.add(eventKey);
      showToast(item);
      showBrowserNotification(item);
      if (hasNativeFacultyNotifUI() && !item.is_read) bumpNativeBadge();
    }
  }

  async function loadExisting() {
    const db = client();
    if (!db || !currentUser?.id) return;
    const { data, error } = await db
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);

    if (error) {
      console.warn('CalendarNotifications: notifications table not ready', error.message);
      return;
    }

    (data || []).forEach((row) => ingest(row, { toast: false }));
    updateBadge();
  }

  async function markRead(id) {
    const item = items.find((row) => String(row.id) === String(id));
    if (item) item.is_read = true;
    updateBadge();
    const db = client();
    if (!db || !id) return;
    await db.from('notifications').update({ is_read: true }).eq('id', id);
  }

  async function markAllRead() {
    items = items.map((row) => ({ ...row, is_read: true }));
    updateBadge();
    const db = client();
    if (!db || !currentUser?.id) return;
    const ids = items.map((row) => row.id).filter(Boolean);
    if (ids.length) await db.from('notifications').update({ is_read: true }).in('id', ids);
  }

  function subscribeNotifications() {
    const db = client();
    if (!db) return;
    if (channel) db.removeChannel(channel);

    channel = db.channel('faculty-calendar-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        ingest(payload.new, { toast: true });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, (payload) => {
        ingest(payload.new, { toast: false });
      })
      .subscribe();
  }

  function subscribeCalendarFallback() {
    const db = client();
    if (!db) return;
    if (eventsChannel) db.removeChannel(eventsChannel);

    eventsChannel = db.channel('cite-calendar-event-toasts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, (payload) => {
        const row = payload.new || payload.old;
        if (!row) return;
        const action = payload.event === 'DELETE' ? 'delete' : payload.event === 'UPDATE' ? 'update' : 'create';
        if (currentPortal === 'admin') {
          notifyCalendarEvent(row, action).catch((err) => {
            console.warn('CiteNotifications: auto faculty notify failed', err);
          });
          return;
        }

        const scope = normalizeScope(row.visibility_scope || row.visibility || 'all_faculty');
        if (!facultyCanReceive(scope, currentProfile)) return;

        const key = `${payload.event}-${row.id}-${row.updated_at || row.start_at}`;
        if (seenEventToasts.has(key)) return;
        seenEventToasts.add(key);

        const already = items.some((item) => String(item.event_id) === String(row.id) && Date.now() - new Date(item.created_at || 0).getTime() < 15000);
        if (already) return;

        const copy = buildCopy(row, action);
        ingest({
          id: `live-${key}`,
          title: copy.title,
          message: copy.message,
          type: 'calendar',
          audience: scope,
          event_id: row.id,
          is_read: false,
          created_at: new Date().toISOString()
        }, { toast: true });
      })
      .subscribe();
  }

  function subscribeFacultyOutbound() {
    const db = client();
    if (!db || currentPortal !== 'faculty') return;

    db.channel('faculty-outbound-notify')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'faculty_leaves' }, (payload) => {
        const row = payload.new;
        if (!row) return;
        const mine = !row.faculty_id || !currentUser?.id || String(row.faculty_id) === String(currentUser.id);
        if (!mine) return;
        notifyLeaveFiling(row).catch((err) => console.warn('CiteNotifications: leave notify failed', err));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendar_event_feedback' }, (payload) => {
        const row = payload.new;
        if (!row) return;
        const mine = !row.faculty_id || !currentUser?.id || String(row.faculty_id) === String(currentUser.id);
        if (!mine) return;
        notifyEventFeedback(row).catch((err) => console.warn('CiteNotifications: feedback notify failed', err));
      })
      .subscribe();
  }

  function subscribeAdminFallbacks() {
    const db = client();
    if (!db || currentPortal !== 'admin') return;
    if (extraChannel) db.removeChannel(extraChannel);

    extraChannel = db.channel('admin-leave-feedback-toasts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'faculty_leaves' }, (payload) => {
        const row = payload.new;
        if (!row) return;
        const key = `leave-${row.id}`;
        if (seenEventToasts.has(key)) return;
        seenEventToasts.add(key);
        const name = row.faculty_name || 'A faculty member';
        const kind = row.leave_type || 'leave';
        ingest({
          id: `live-${key}`,
          title: 'New faculty leave filing',
          message: `${name} filed ${kind}.`,
          type: 'leave',
          audience: 'admin',
          event_id: row.id,
          is_read: false,
          created_at: new Date().toISOString()
        }, { toast: true });
        if (typeof global.loadAllAdminData === 'function') global.loadAllAdminData();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendar_event_feedback' }, (payload) => {
        const row = payload.new;
        if (!row) return;
        const key = `feedback-${row.id || row.event_id}-${row.submitted_at || ''}`;
        if (seenEventToasts.has(key)) return;
        seenEventToasts.add(key);
        ingest({
          id: `live-${key}`,
          title: 'New event feedback',
          message: `${row.faculty_name || 'A faculty member'} submitted feedback${row.overall_rating != null ? ' (' + row.overall_rating + '/5)' : ''}.`,
          type: 'feedback',
          audience: 'admin',
          event_id: row.event_id,
          is_read: false,
          created_at: new Date().toISOString()
        }, { toast: true });
      })
      .subscribe();
  }

  function isFacultyPortal() {
    const path = String(location.pathname || '').toLowerCase();
    return document.body?.dataset?.portal === 'faculty'
      || path.includes('/faculty')
      || path.includes('faculty-calendar')
      || document.title.toLowerCase().includes('faculty calendar');
  }

  function isAdminPortal() {
    const path = String(location.pathname || '').toLowerCase();
    const href = String(location.href || '').toLowerCase();
    return document.body?.dataset?.portal === 'admin'
      || path.includes('/admin')
      || href.includes('/admin/')
      || document.title.toLowerCase().includes('admin calendar')
      || !!document.querySelector('[data-page="user-management.html"], [data-page="workflow-approval.html"]');
  }

  async function startListener(options) {
    const db = client();
    if (!db) {
      if (startAttempts < 20) {
        startAttempts += 1;
        window.setTimeout(() => startListener(options), 300);
      }
      return null;
    }

    currentPortal = options?.portal || currentPortal || 'faculty';
    const { data } = await db.auth.getUser();
    currentUser = data?.user || currentUser;
    currentProfile = options?.profile || currentProfile || (
      currentPortal === 'faculty'
        ? await loadFacultyProfile(currentUser)
        : currentProfile
    );

    if (started) {
      watchNavMount();
      bindNotifOpenClicks();
      watchFacultyNativeList();
      await loadExisting();
      updateBadge();
      return currentProfile;
    }
    started = true;

    watchNavMount();
    bindNotifOpenClicks();
    watchFacultyNativeList();
    requestBrowserPermission();
    await loadExisting();
    subscribeNotifications();
    subscribeCalendarFallback();
    subscribeAdminFallbacks();
    subscribeFacultyOutbound();
    hookCalendarSaveFunctions();
    return currentProfile;
  }

  function hookCalendarSaveFunctions() {
    if (currentPortal !== 'admin') return;
    ['saveEventFromModal', 'saveEvent', 'saveSchedule', 'createEvent', 'removeCurrentEvent', 'deleteEvent'].forEach((name) => {
      const fn = global[name];
      if (typeof fn !== 'function' || fn.__citeCalHooked) return;
      const orig = fn;
      const wrapped = async function () {
        const result = await orig.apply(this, arguments);
        if (!/remove|delete/i.test(name)) {
          window.setTimeout(() => {
            notifyLatestCalendarChange('create').catch(() => {});
          }, 250);
        }
        return result;
      };
      wrapped.__citeCalHooked = true;
      global[name] = wrapped;
    });
    [400, 1200, 2500, 5000].forEach((ms) => window.setTimeout(hookCalendarSaveFunctions, ms));
  }

  async function notifyLatestCalendarChange(action) {
    const db = client();
    if (!db) return;
    const { data, error } = await db
      .from('calendar_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return;
    await notifyCalendarEvent(data, action || 'create');
  }

  async function startFacultyListener(options) {
    return startListener({ ...(options || {}), portal: 'faculty' });
  }

  async function startAdminListener(options) {
    return startListener({ ...(options || {}), portal: 'admin' });
  }

  function facultySeesEvent(row, profile) {
    const scope = normalizeScope(row?.visibility_scope || row?.visibility || 'all_faculty');
    return facultyCanReceive(scope, profile || currentProfile || {});
  }

  global.CiteNotifications = global.CalendarNotifications = {
    notifyCalendarEvent,
    notifyAdmins,
    notifyLeaveFiling,
    notifyEventFeedback,
    startFacultyListener,
    startAdminListener,
    openFromNotification,
    refreshAdmin,
    markAllRead,
    facultySeesEvent,
    loadFacultyProfile,
    normalizeScope
  };

  bindNavGlobals();
  interceptAdminAlertBell();

  function boot() {
    interceptAdminAlertBell();
    bindNotifOpenClicks();
    if (isFacultyPortal() || hasNativeFacultyNotifUI()) {
      startFacultyListener().catch((err) => console.warn('CalendarNotifications start failed', err));
      return;
    }
    if (isAdminPortal() || document.querySelector('.nav-actions .fa-bell')) {
      startAdminListener().catch((err) => console.warn('CalendarNotifications admin start failed', err));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
