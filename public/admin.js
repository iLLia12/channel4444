const $ = (id) => document.getElementById(id);
let allUsers = [];

let meId = null;

function show(view) {
  for (const id of ['not-admin-view', 'app-view']) {
    $(id).classList.toggle('hidden', id !== view);
  }
}

function toLogin() {
  location.replace('/login.html?next=/admin');
}

async function init() {
  const { user } = await (await fetch('/api/session')).json();
  if (!user) return toLogin();
  if (!user.isAdmin) return show('not-admin-view');
  meId = user.id;
  $('admin-who').textContent = user.email;
  show('app-view');
  loadUsers();
}

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.replace('/login.html');
});

// Activity bar: one view for now, but structured so more can be added.
for (const btn of document.querySelectorAll('.activity')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.activity').forEach((b) => b.classList.toggle('active', b === btn));
    if (btn.dataset.view === 'users') loadUsers();
  });
}

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  if (res.status === 401) return toLogin();
  if (res.status === 403) return show('not-admin-view');
  allUsers = await res.json();
  renderUsers();
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function statusBadge(u) {
  if (u.suspended) return el('span', { class: 'badge suspended', text: 'Suspended' });
  if (u.inVideo) return el('span', { class: 'badge video', text: 'In video chat' });
  if (u.online) return el('span', { class: 'badge online', text: 'Online' });
  return el('span', { class: 'badge', text: 'Offline' });
}

// ---------- sorting ----------

const SORT_KEY = 'c4_admin_users_sort';
let sort = { field: 'createdAt', dir: 'desc' };
try {
  sort = { ...sort, ...JSON.parse(localStorage.getItem(SORT_KEY)) };
} catch {}

// Status sorts by "how active": in video > online > offline > suspended.
const statusRank = (u) => (u.suspended ? 0 : u.inVideo ? 3 : u.online ? 2 : 1);
const SORTERS = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  id: (a, b) => a.id.localeCompare(b.id),
  // Temporary placeholder emails sort after real ones.
  email: (a, b) => (a.emailTemporary - b.emailTemporary) || (a.email || '').localeCompare(b.email || '', undefined, { sensitivity: 'base' }),
  createdAt: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
  status: (a, b) => statusRank(a) - statusRank(b),
  messages: (a, b) => a.messages - b.messages,
};
// First click on text columns sorts A→Z; on numbers, dates and status, biggest/newest/most active first.
const FIRST_DIR = { name: 'asc', email: 'asc', id: 'asc', createdAt: 'desc', status: 'desc', messages: 'desc' };

function sortedUsers(list) {
  const cmp = SORTERS[sort.field] || SORTERS.createdAt;
  const sign = sort.dir === 'asc' ? 1 : -1;
  // Ties fall back to name so the order is stable and predictable.
  return [...list].sort((a, b) => sign * cmp(a, b) || SORTERS.name(a, b));
}

function renderSortHeaders() {
  for (const th of document.querySelectorAll('#users-head th[data-sort]')) {
    const active = th.dataset.sort === sort.field;
    th.classList.toggle('sorted', active);
    th.dataset.dir = active ? sort.dir : '';
    th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  }
}

for (const th of document.querySelectorAll('#users-head th[data-sort]')) {
  th.tabIndex = 0;
  const activate = () => {
    const field = th.dataset.sort;
    sort =
      sort.field === field
        ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: FIRST_DIR[field] || 'asc' };
    localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    renderUsers();
  };
  th.addEventListener('click', activate);
  th.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  });
}

function renderUsers() {
  const q = $('users-search').value.trim().toLowerCase();
  const filtered = q
    ? allUsers.filter((u) => u.name.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || u.id.includes(q))
    : allUsers;
  const list = sortedUsers(filtered);
  renderSortHeaders();
  $('users-body').replaceChildren(
    ...list.map((u) =>
      el(
        'tr',
        null,
        el(
          'td',
          null,
          el(
            'div',
            { class: 'user-cell' },
            avatarEl(u, 'sm'),
            el('span', { text: u.name }),
            u.id === meId ? el('span', { class: 'tag', text: 'you' }) : null,
            u.isAdmin ? el('span', { class: 'badge admin', text: 'Admin' }) : null,
            u.hasPassword ? null : el('span', { class: 'badge', text: 'No password', title: 'Reset the password to let them sign in' })
          )
        ),
        el(
          'td',
          { class: 'email-cell' + (u.emailTemporary ? ' temporary' : '') },
          el(
            'div',
            { class: 'email-wrap' },
            el('span', { class: 'email-text', text: u.email || '—', title: u.email || '' }),
            u.emailTemporary ? el('span', { class: 'badge', text: 'temporary', title: 'Placeholder until the user sets a real email' }) : null
          )
        ),
        el('td', { class: 'mono', text: u.id }),
        el('td', { text: u.createdAt ? dateFmt.format(new Date(u.createdAt)) : '—' }),
        el('td', null, statusBadge(u)),
        el('td', { class: 'num', text: String(u.messages) }),
        el(
          'td',
          { class: 'actions-col' },
          // You can't lock yourself out; change your own password on the profile page.
          u.id === meId ? null : iconButton('key', `Reset password for ${u.name}`, '', () => resetPassword(u)),
          u.id === meId
            ? null
            : u.suspended
              ? iconButton('play', `Unsuspend ${u.name}`, 'ok', () => toggleSuspend(u))
              : iconButton('pause', `Suspend ${u.name}`, 'warn', () => toggleSuspend(u)),
          u.id === meId ? null : iconButton('trash', `Delete ${u.name}`, 'danger', () => openDelete(u))
        )
      )
    )
  );
  $('users-count').textContent = allUsers.length;
  $('users-empty').classList.toggle('hidden', list.length > 0);
  $('users-empty').textContent = allUsers.length ? 'No users match your search' : 'No users yet';
}

function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.add('hidden'), 3000);
}

async function adminRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    toLogin();
    throw new Error('Signed out');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function toggleSuspend(u) {
  const suspend = !u.suspended;
  const question = suspend
    ? `Suspend ${u.name}? They will be disconnected right away and can't use the app until you unsuspend them.`
    : `Unsuspend ${u.name}? They will be able to use the app again.`;
  if (!confirm(question)) return;
  try {
    await adminRequest('POST', `/api/admin/users/${encodeURIComponent(u.id)}/suspend`, { suspended: suspend });
    toast(suspend ? `${u.name} is suspended` : `${u.name} is active again`);
    loadUsers();
  } catch (err) {
    toast(err.message);
  }
}

let deleting = null;

function openDelete(u) {
  deleting = u;
  $('delete-name').textContent = u.name;
  $('delete-count').textContent = u.messages;
  $('delete-messages').checked = false;
  $('delete-messages').disabled = u.messages === 0;
  $('delete-error').textContent = '';
  $('delete-dialog').showModal();
}

$('delete-dialog').addEventListener('close', async () => {
  const u = deleting;
  deleting = null;
  if (!u || $('delete-dialog').returnValue !== 'confirm') return;
  const withMessages = $('delete-messages').checked ? '?messages=1' : '';
  try {
    const res = await adminRequest('DELETE', `/api/admin/users/${encodeURIComponent(u.id)}${withMessages}`);
    toast(`${u.name} was deleted` + (res.deletedMessages ? ` with ${res.deletedMessages} messages` : ''));
    loadUsers();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- add user / passwords ----------

function showPassword(title, text, password) {
  $('password-title').textContent = title;
  $('password-text').textContent = text;
  $('password-value').textContent = password;
  $('password-copy').textContent = 'Copy';
  $('password-dialog').showModal();
}

$('password-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('password-value').textContent);
    $('password-copy').textContent = 'Copied';
  } catch {
    // Clipboard blocked: select the text so it can be copied by hand.
    getSelection().selectAllChildren($('password-value'));
  }
});

// Never leave a password on the page after the dialog closes.
$('password-dialog').addEventListener('close', () => ($('password-value').textContent = ''));

$('add-user').addEventListener('click', () => {
  $('add-form').reset();
  $('add-error').textContent = '';
  $('add-dialog').showModal();
  $('add-name').focus();
});

$('add-form').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return; // let the dialog close
  e.preventDefault();
  $('add-error').textContent = '';
  $('add-confirm').disabled = true;
  try {
    const name = $('add-name').value.trim();
    const res = await adminRequest('POST', '/api/admin/users', {
      name,
      email: $('add-email').value.trim(),
      isAdmin: $('add-admin').checked,
    });
    $('add-dialog').close();
    showPassword(`${name} can sign in now`, `Send them the address of this site, their email ${res.user.email}, and this password:`, res.password);
    loadUsers();
  } catch (err) {
    $('add-error').textContent = err.message;
  } finally {
    $('add-confirm').disabled = false;
  }
});

async function resetPassword(u) {
  if (!confirm(`Give ${u.name} a new password? Their current password stops working and they're signed out everywhere.`)) return;
  try {
    const res = await adminRequest('POST', `/api/admin/users/${encodeURIComponent(u.id)}/password`);
    showPassword(`New password for ${u.name}`, `Send ${u.name} (${u.email}) this password:`, res.password);
    loadUsers();
  } catch (err) {
    toast(err.message);
  }
}

$('users-search').addEventListener('input', renderUsers);
$('refresh').addEventListener('click', loadUsers);

init();
