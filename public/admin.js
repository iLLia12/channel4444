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
  if (u.inVideo) return el('span', { class: 'badge video', text: 'In video chat' });
  if (u.online) return el('span', { class: 'badge online', text: 'Online' });
  return el('span', { class: 'badge', text: 'Offline' });
}

function renderUsers() {
  const q = $('users-search').value.trim().toLowerCase();
  const list = q
    ? allUsers.filter((u) => u.name.toLowerCase().includes(q) || u.id.includes(q))
    : allUsers;
  $('users-body').replaceChildren(
    ...list.map((u) =>
      el(
        'tr',
        null,
        el('td', null, el('div', { class: 'user-cell' }, avatarEl(u, 'sm'), el('span', { text: u.name }))),
        el('td', { class: 'mono', text: u.id }),
        el('td', { text: u.createdAt ? dateFmt.format(new Date(u.createdAt)) : '—' }),
        el('td', null, statusBadge(u)),
        el('td', { class: 'num', text: String(u.messages) })
      )
    )
  );
  $('users-count').textContent = allUsers.length;
  $('users-empty').classList.toggle('hidden', list.length > 0);
  $('users-empty').textContent = allUsers.length ? 'No users match your search' : 'No users yet';
}

$('users-search').addEventListener('input', renderUsers);
$('refresh').addEventListener('click', loadUsers);

init();
