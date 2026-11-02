const form = document.getElementById('profile-form');
const nameInput = document.getElementById('name-input');
const emailInput = document.getElementById('email-input');
const emailNotice = document.getElementById('email-notice');
const avatarInput = document.getElementById('avatar-input');
const preview = document.getElementById('avatar-preview');
const removeBtn = document.getElementById('remove-avatar');
const errorEl = document.getElementById('form-error');
const submitBtn = document.getElementById('submit');

const existing = Store.user;
let removeAvatar = false;
let previewUrl = null;

function renderPreview() {
  const file = avatarInput.files[0];
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  let avatar = null;
  if (file) avatar = previewUrl = URL.createObjectURL(file);
  else if (existing && existing.avatar && !removeAvatar) avatar = existing.avatar;
  preview.replaceChildren(
    avatarEl({ id: existing && existing.id, name: nameInput.value || '?', avatar }, 'xl')
  );
  removeBtn.classList.toggle('hidden', !avatar);
}

if (existing) {
  document.getElementById('form-title').textContent = 'Edit profile';
  submitBtn.textContent = 'Save';
  document.getElementById('cancel').classList.remove('hidden');
  nameInput.value = existing.name;
  fillEmail(existing);
  // The stored copy may predate emails; ask the server for the current profile.
  fetch('/api/users/me', { headers: { 'X-User-Id': existing.id, 'X-User-Token': existing.token } })
    .then((res) => (res.ok ? res.json() : null))
    .then((profile) => {
      if (!profile) return;
      Store.user = { ...existing, ...profile };
      if (!emailInput.value || existing.emailTemporary !== profile.emailTemporary) fillEmail(profile);
    })
    .catch(() => {});
}
renderPreview();
nameInput.focus();

// A temporary placeholder isn't shown; the user is asked to enter a real address instead.
function fillEmail(profile) {
  const temporary = !!profile.emailTemporary;
  if (!temporary && profile.email) emailInput.value = profile.email;
  emailNotice.classList.toggle('hidden', !temporary);
}

nameInput.addEventListener('input', renderPreview);
avatarInput.addEventListener('change', () => {
  const file = avatarInput.files[0];
  if (file && file.size > 5 * 1024 * 1024) {
    errorEl.textContent = 'Avatar must be 5 MB or smaller';
    avatarInput.value = '';
  } else {
    errorEl.textContent = '';
    removeAvatar = false;
  }
  renderPreview();
});
removeBtn.addEventListener('click', () => {
  avatarInput.value = '';
  removeAvatar = true;
  renderPreview();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const name = nameInput.value.trim();
  if (!name) {
    errorEl.textContent = 'Please enter a user name';
    return;
  }
  const email = emailInput.value.trim();
  if (!email) {
    errorEl.textContent = 'Please enter your email';
    emailInput.focus();
    return;
  }
  const data = new FormData();
  data.append('name', name);
  data.append('email', email);
  if (avatarInput.files[0]) data.append('avatar', avatarInput.files[0]);
  if (removeAvatar) data.append('removeAvatar', '1');

  submitBtn.disabled = true;
  try {
    const res = await fetch(existing ? '/api/users/me' : '/api/users', {
      method: existing ? 'PUT' : 'POST',
      headers: existing ? { 'X-User-Id': existing.id, 'X-User-Token': existing.token } : {},
      body: data,
    });
    if (res.status === 401 && existing) {
      // Account no longer exists on the server; start over.
      Store.user = null;
      location.reload();
      return;
    }
    const body = await res.json();
    if (body.suspended) {
      location.replace('/suspended.html');
      return;
    }
    if (!res.ok) {
      if (body.field === 'email') emailInput.focus();
      throw new Error(body.error || 'Something went wrong');
    }
    Store.user = body;
    location.href = '/';
  } catch (err) {
    errorEl.textContent = err.message;
    submitBtn.disabled = false;
  }
});
