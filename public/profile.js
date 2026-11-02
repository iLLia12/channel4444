const $ = (id) => document.getElementById(id);
const form = $('profile-form');
const nameInput = $('name-input');
const emailInput = $('email-input');
const avatarInput = $('avatar-input');
const preview = $('avatar-preview');
const removeBtn = $('remove-avatar');
const errorEl = $('form-error');
const submitBtn = $('submit');

let profile = null; // { id, name, email, emailTemporary, avatar }
let removeAvatar = false;
let previewUrl = null;

function renderPreview() {
  const file = avatarInput.files[0];
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  let avatar = null;
  if (file) avatar = previewUrl = URL.createObjectURL(file);
  else if (profile && profile.avatar && !removeAvatar) avatar = profile.avatar;
  preview.replaceChildren(avatarEl({ id: profile && profile.id, name: nameInput.value || '?', avatar }, 'xl'));
  removeBtn.classList.toggle('hidden', !avatar);
}

// A temporary placeholder email isn't shown; the user is asked to enter a real one instead.
function fillForm(p) {
  profile = p;
  nameInput.value = p.name;
  emailInput.value = p.emailTemporary ? '' : p.email;
  $('email-notice').classList.toggle('hidden', !p.emailTemporary);
  renderPreview();
}

fetch('/api/users/me')
  .then((res) => {
    if (res.status === 401) location.replace('/login.html?next=/profile');
    return res.json();
  })
  .then(fillForm)
  .catch(() => {});

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
  const email = emailInput.value.trim();
  if (!name) return (errorEl.textContent = 'Please enter a user name');
  if (!email) {
    errorEl.textContent = 'Please enter your email';
    return emailInput.focus();
  }
  const data = new FormData();
  data.append('name', name);
  data.append('email', email);
  if (avatarInput.files[0]) data.append('avatar', avatarInput.files[0]);
  if (removeAvatar) data.append('removeAvatar', '1');

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/users/me', { method: 'PUT', body: data });
    if (res.status === 401) return location.replace('/login.html?next=/profile');
    const body = await res.json();
    if (body.suspended) return location.replace('/suspended.html');
    if (!res.ok) {
      if (body.field === 'email') emailInput.focus();
      throw new Error(body.error || 'Something went wrong');
    }
    location.href = '/';
  } catch (err) {
    errorEl.textContent = err.message;
    submitBtn.disabled = false;
  }
});

$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('password-error');
  const button = $('password-submit');
  error.textContent = '';
  error.classList.remove('success');
  button.disabled = true;
  try {
    const res = await fetch('/api/users/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: $('current-password').value, password: $('new-password').value }),
    });
    const body = await res.json();
    if (!res.ok) {
      $(body.field === 'current' ? 'current-password' : 'new-password').focus();
      throw new Error(body.error || 'Could not change the password');
    }
    $('password-form').reset();
    error.textContent = 'Password changed.';
    error.classList.add('success');
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
