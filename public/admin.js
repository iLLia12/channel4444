const $ = (id) => document.getElementById(id);
let allUsers = [];

function show(view) {
  for (const id of ['login-view', 'disabled-view', 'app-view']) {
    $(id).classList.toggle('hidden', id !== view);
  }
}

async function init() {
  const session = await (await fetch('/api/admin/session')).json();
  if (!session.enabled) return show('disabled-view');
  if (!session.loggedIn) return show('login-view');
  show('app-view');
  loadUsers();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('admin-password').value }),
  });
  if (res.ok) {
    $('admin-password').value = '';
    init();
  } else {
    $('login-error').textContent = (await res.json()).error || 'Sign in failed';
  }
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  show('login-view');
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
  if (res.status === 401) return show('login-view');
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
  createdAt: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
  status: (a, b) => statusRank(a) - statusRank(b),
  messages: (a, b) => a.messages - b.messages,
};
// First click on text columns sorts A→Z; on numbers, dates and status, biggest/newest/most active first.
const FIRST_DIR = { name: 'asc', id: 'asc', createdAt: 'desc', status: 'desc', messages: 'desc' };

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
    ? allUsers.filter((u) => u.name.toLowerCase().includes(q) || u.id.includes(q))
    : allUsers;
  const list = sortedUsers(filtered);
  renderSortHeaders();
  $('users-body').replaceChildren(
    ...list.map((u) =>
      el(
        'tr',
        null,
        el('td', null, el('div', { class: 'user-cell' }, avatarEl(u, 'sm'), el('span', { text: u.name }))),
        el('td', { class: 'mono', text: u.id }),
        el('td', { text: u.createdAt ? dateFmt.format(new Date(u.createdAt)) : '—' }),
        el('td', null, statusBadge(u)),
        el('td', { class: 'num', text: String(u.messages) }),
        el(
          'td',
          { class: 'actions-col' },
          u.suspended
            ? iconButton('play', `Unsuspend ${u.name}`, 'ok', () => toggleSuspend(u))
            : iconButton('pause', `Suspend ${u.name}`, 'warn', () => toggleSuspend(u)),
          iconButton('trash', `Delete ${u.name}`, 'danger', () => openDelete(u))
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
    show('login-view');
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

$('users-search').addEventListener('input', renderUsers);
$('refresh').addEventListener('click', loadUsers);

init();
