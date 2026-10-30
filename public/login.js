document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: document.getElementById('password').value }),
  });
  if (res.ok) location.href = '/';
  else document.getElementById('login-error').textContent = 'Wrong password';
});
