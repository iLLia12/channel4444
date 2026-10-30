// Shared helpers for all pages.
const Store = {
  get user() {
    try {
      return JSON.parse(localStorage.getItem('c4_user'));
    } catch {
      return null;
    }
  },
  set user(u) {
    if (u) localStorage.setItem('c4_user', JSON.stringify(u));
    else localStorage.removeItem('c4_user');
  },
};

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function avatarColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

function avatarEl(user, size = 'md') {
  if (user && user.avatar) {
    return el('img', { class: `avatar ${size}`, src: user.avatar, alt: user.name || '' });
  }
  const name = (user && user.name) || '?';
  const initials = name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const node = el('span', { class: `avatar ${size} initials`, text: initials });
  node.style.background = avatarColor((user && user.id) || name);
  return node;
}
