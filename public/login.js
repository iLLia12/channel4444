// Only same-site paths, so ?next= can't send people to another website.
function nextPath() {
  const next = new URLSearchParams(location.search).get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

// Already signed in? Go straight on.
fetch('/api/session')
  .then((res) => res.json())
  .then((s) => {
    if (s.user) location.replace(nextPath());
  })
  .catch(() => {});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = document.getElementById('login-error');
  const button = document.getElementById('login-submit');
  error.textContent = '';
  button.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      }),
    });
    const body = await res.json();
    if (body.suspended) return location.replace('/suspended.html');
    if (!res.ok) throw new Error(body.error || 'Sign in failed');
    location.replace(nextPath());
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});
