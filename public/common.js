// Shared helpers for all pages.
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

// Static SVG markup (VS Code codicon style), never user data.
const ICONS = {
  pause: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="4" y="3" width="2.5" height="10" rx=".5"/><rect x="9.5" y="3" width="2.5" height="10" rx=".5"/></svg>',
  play: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M5 3.2v9.6a.5.5 0 0 0 .77.42l7.2-4.8a.5.5 0 0 0 0-.84l-7.2-4.8A.5.5 0 0 0 5 3.2z"/></svg>',
  pencil: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.8 2.7l2.5 2.5L5.5 13H3v-2.5z"/><path d="M9.3 4.2l2.5 2.5"/></svg>',
  download: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"/></svg>',
  key: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="10.5" r="3"/><path d="M7.7 8.3L13.5 2.5M11.5 4.5l1.5 1.5M10 6l1.2 1.2"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5"/></svg>',
};

function iconButton(icon, label, cls, onclick) {
  const b = el('button', { class: 'icon-btn ' + cls, title: label, 'aria-label': label, onclick });
  b.innerHTML = ICONS[icon];
  return b;
}
