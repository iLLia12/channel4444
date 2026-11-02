const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 4444;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const MAX_MESSAGES = 500;
const MAX_TEXT = 4000;
const MAX_NAME = 32;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- persistence ----------

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// id -> { id, name, email, emailTemporary, avatar, salt, hash, isAdmin, suspended, createdAt }
const users = loadJson(USERS_FILE, {});
let messages = loadJson(MESSAGES_FILE, []);

// Writes are batched (200ms). Pending ones are flushed on shutdown, so a deploy or restart
// (docker stop sends SIGTERM) doesn't lose the last changes.
const pendingSaves = new Map(); // file -> { timer, getData }
function scheduleSave(file, getData) {
  const pending = pendingSaves.get(file);
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    pendingSaves.delete(file);
    fs.writeFile(file, JSON.stringify(getData(), null, 2), (err) => {
      if (err) console.error('Failed to save', file, err);
    });
  }, 200);
  pendingSaves.set(file, { timer, getData });
}

function flushSaves() {
  for (const [file, { timer, getData }] of pendingSaves) {
    clearTimeout(timer);
    fs.writeFileSync(file, JSON.stringify(getData(), null, 2));
  }
  pendingSaves.clear();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    flushSaves();
    process.exit(0);
  });
}
const saveUsers = () => scheduleSave(USERS_FILE, () => users);
const saveMessages = () => scheduleSave(MESSAGES_FILE, () => messages);

// Users created before emails were required get a placeholder. ".invalid" is a reserved
// domain, so these can never be real addresses; they're flagged until the user sets one.
let migrated = 0;
for (const u of Object.values(users)) {
  if (!u.email) {
    u.email = `user-${u.id}@temp.invalid`;
    u.emailTemporary = true;
    migrated++;
  }
  // Browser tokens were replaced by password logins.
  if (u.token) {
    delete u.token;
    migrated++;
  }
}

// Admins used to be separate accounts in data/admins.json; now they are users with isAdmin.
const OLD_ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
if (fs.existsSync(OLD_ADMINS_FILE)) {
  for (const a of Object.values(loadJson(OLD_ADMINS_FILE, {}))) {
    const user = findUserByEmail(a.email) || addUser({ name: nameFromEmail(a.email), email: a.email });
    Object.assign(user, { salt: a.salt, hash: a.hash, isAdmin: true });
    migrated++;
  }
  fs.renameSync(OLD_ADMINS_FILE, OLD_ADMINS_FILE + '.migrated');
}

if (migrated) {
  console.log(`Updated ${migrated} user record(s) to the current format.`);
  saveUsers();
}

// Sent to everyone (user lists, chat). Never includes the email.
function publicUser(u) {
  return { id: u.id, name: u.name, avatar: u.avatar };
}

// Only for the user themselves and the admin.
function privateUser(u) {
  return { ...publicUser(u), email: u.email, emailTemporary: !!u.emailTemporary, isAdmin: !!u.isAdmin };
}

function findUserByEmail(email) {
  const lower = String(email || '').trim().toLowerCase();
  return Object.values(users).find((u) => u.email && u.email.toLowerCase() === lower) || null;
}

function nameFromEmail(email) {
  const local = String(email).split('@')[0].replace(/[._-]+/g, ' ');
  return cleanName(local.charAt(0).toUpperCase() + local.slice(1)) || 'Admin';
}

function addUser({ name, email, isAdmin = false }) {
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    name,
    email,
    avatar: null,
    isAdmin,
    createdAt: Date.now(),
  };
  users[user.id] = user;
  return user;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(email) {
  return String(email || '').trim().slice(0, 254);
}

// Returns an error message, or null if the email is valid and not used by anyone else.
function emailProblem(email, exceptUserId) {
  if (!email) return 'Email is required';
  if (!EMAIL_RE.test(email)) return 'Please enter a valid email address';
  const lower = email.toLowerCase();
  const taken = Object.values(users).some((u) => u.id !== exceptUserId && u.email && u.email.toLowerCase() === lower);
  return taken ? 'This email is already used by another user' : null;
}

function directory() {
  const out = {};
  for (const u of Object.values(users)) out[u.id] = publicUser(u);
  return out;
}

// One newline style everywhere: form uploads (photo captions) arrive with \r\n.
function cleanText(text) {
  return String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT);
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ---------- passwords ----------

const MIN_PASSWORD = 8;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

function setPassword(user, password) {
  Object.assign(user, hashPassword(password), { passwordChangedAt: Date.now() });
}

function checkPassword(user, password) {
  // Hash even when there's nothing to compare, so timing doesn't reveal which emails exist.
  const { hash } = hashPassword(password, user && user.salt ? user.salt : 'no-such-user');
  return !!(user && user.hash) && safeEqual(hash, user.hash);
}

// Shown once to whoever creates or resets it; only the hash is stored.
function generatePassword() {
  return crypto.randomBytes(15).toString('base64url'); // 20 characters
}

// ---------- sessions ----------

// Signed cookie "<userId>.<expiry>.<signature>". The signature covers the password hash, so a
// password change or reset signs that user out everywhere.
const SESSION_COOKIE = 'c4_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const SESSION_KEY_FILE = path.join(DATA_DIR, 'session.key');
const sessionKey = (() => {
  try {
    return fs.readFileSync(SESSION_KEY_FILE, 'utf8').trim();
  } catch {
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SESSION_KEY_FILE, key, { mode: 0o600 });
    return key;
  }
})();

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function signSession(user, expires) {
  return crypto.createHmac('sha256', sessionKey).update(`${user.id}.${expires}.${user.hash}`).digest('base64url');
}

// The signed-in user for a request or socket (suspended users included; callers check), or null.
function sessionUser(cookieHeader) {
  const [id, expires, sig] = String(parseCookies(cookieHeader)[SESSION_COOKIE] || '').split('.');
  const user = id && users[id];
  if (!user || !user.hash || !sig || !(Number(expires) > Date.now())) return null;
  return safeEqual(sig, signSession(user, expires)) ? user : null;
}

function setCookie(req, res, name, value, maxAge) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function startSession(req, res, user) {
  const expires = Date.now() + SESSION_SECONDS * 1000;
  setCookie(req, res, SESSION_COOKIE, `${user.id}.${expires}.${signSession(user, expires)}`, SESSION_SECONDS);
}

// ---------- uploads ----------

const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

function imageUpload(maxMb) {
  return multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) =>
        cb(null, crypto.randomBytes(16).toString('hex') + IMAGE_TYPES[file.mimetype]),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (IMAGE_TYPES[file.mimetype]) cb(null, true);
      else cb(new Error('Only JPEG, PNG, GIF or WebP images are allowed'));
    },
  });
}

const avatarUpload = imageUpload(5).single('avatar');
const photoUpload = imageUpload(20).single('photo');

function runUpload(mw) {
  return (req, res, next) =>
    mw(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
}

function removeUpload(file) {
  if (file) fs.unlink(file.path, () => {});
}

function removeUploadedFile(url) {
  if (url && url.startsWith('/uploads/')) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
  }
}

// ---------- http app ----------

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '16kb' }));

// ---------- sign in ----------

app.post('/api/login', (req, res) => {
  const user = findUserByEmail(req.body && req.body.email);
  if (!checkPassword(user, req.body && req.body.password)) {
    // Slow down password guessing.
    return setTimeout(() => res.status(401).json({ error: 'Wrong email or password' }), 1000);
  }
  if (user.suspended) return res.status(403).json({ error: 'Your account is suspended', suspended: true });
  startSession(req, res, user);
  res.json({ ok: true, user: privateUser(user) });
});

app.post('/api/logout', (req, res) => {
  setCookie(req, res, SESSION_COOKIE, '', 0);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  const user = sessionUser(req.headers.cookie);
  res.json({ user: user && !user.suspended ? privateUser(user) : null });
});

// Local-only door for `node admins.js` (used by setup.sh) to create admins and reset their
// passwords while the server runs. Requires a loopback connection and the session key file.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
app.post('/internal/admins', (req, res) => {
  if (!LOOPBACK.has(req.socket.remoteAddress) || !safeEqual(req.get('x-internal-key') || '', sessionKey)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { action, email } = req.body || {};
  if (action === 'list') {
    const list = Object.values(users).filter((u) => u.isAdmin);
    return res.json({ admins: list.map((u) => ({ email: u.email, name: u.name, createdAt: u.createdAt })) });
  }
  const address = cleanEmail(email);
  if (!EMAIL_RE.test(address)) return res.status(400).json({ error: `Not a valid email: ${email}` });
  let user = findUserByEmail(address);
  if (action === 'create') {
    if (user && user.isAdmin && user.hash) return res.status(409).json({ error: `Admin ${user.email} already exists` });
    // An existing user with this email is promoted and gets a new password.
    if (!user) user = addUser({ name: nameFromEmail(address), email: address.toLowerCase() });
    user.isAdmin = true;
  } else if (action === 'reset-password') {
    if (!user) return res.status(404).json({ error: `No user ${address}` });
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }
  const password = generatePassword();
  setPassword(user, password);
  saveUsers();
  kickUser(user.id, 'signed-out');
  broadcastDirectory();
  res.json({ email: user.email, password });
});

// ---------- admin ----------

function requireAdmin(req, res, next) {
  const user = sessionUser(req.headers.cookie);
  if (!user || user.suspended) return res.status(401).json({ error: 'unauthorized' });
  if (!user.isAdmin) return res.status(403).json({ error: 'Admins only' });
  req.user = user;
  next();
}

function adminView(u, messageCounts = {}, inVideo = new Set()) {
  return {
    ...privateUser(u),
    createdAt: u.createdAt,
    online: userSockets.has(u.id),
    inVideo: inVideo.has(u.id),
    messages: messageCounts[u.id] || 0,
    suspended: !!u.suspended,
    suspendedAt: u.suspendedAt || null,
    hasPassword: !!u.hash,
  };
}

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const messageCounts = {};
  for (const m of messages) messageCounts[m.userId] = (messageCounts[m.userId] || 0) + 1;
  const inVideo = new Set(videoParticipants.values());
  const list = Object.values(users)
    .map((u) => adminView(u, messageCounts, inVideo))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

// Invite someone: the admin gets a generated password to hand over (shown once).
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const name = cleanName(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'Name is required', field: 'name' });
  const email = cleanEmail(req.body && req.body.email);
  const problem = emailProblem(email);
  if (problem) return res.status(problem.includes('already') ? 409 : 400).json({ error: problem, field: 'email' });
  const user = addUser({ name, email, isAdmin: !!(req.body && req.body.isAdmin) });
  const password = generatePassword();
  setPassword(user, password);
  saveUsers();
  broadcastDirectory();
  res.json({ user: adminView(user), password });
});

app.post('/api/admin/users/:id/password', requireAdmin, (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Change your own password on your profile page' });
  const password = generatePassword();
  setPassword(user, password);
  saveUsers();
  kickUser(user.id, 'signed-out'); // their old sessions stopped working
  res.json({ password });
});

app.post('/api/admin/users/:id/suspend', requireAdmin, (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: "You can't suspend yourself" });
  const suspended = !!(req.body && req.body.suspended);
  user.suspended = suspended;
  user.suspendedAt = suspended ? Date.now() : null;
  saveUsers();
  if (suspended) kickUser(user.id, 'suspended');
  res.json({ ok: true, suspended });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: "You can't delete yourself" });
  kickUser(user.id, 'deleted');
  let deletedMessages = 0;
  if (req.query.messages === '1') {
    const theirs = messages.filter((m) => m.userId === user.id);
    messages = messages.filter((m) => m.userId !== user.id);
    for (const m of theirs) {
      if (m.image) removeUploadedFile(m.image.url);
      io.to('lobby').emit('chat:deleted', { id: m.id });
    }
    deletedMessages = theirs.length;
    saveMessages();
  }
  removeUploadedFile(user.avatar);
  delete users[user.id];
  saveUsers();
  broadcastDirectory();
  res.json({ ok: true, deletedMessages });
});

// ---------- sign-in gate ----------
// Everything below needs a signed-in, non-suspended user, except the sign-in page itself.

const PUBLIC_PATHS = new Set([
  '/login',
  '/login.html',
  '/login.js',
  '/suspended',
  '/suspended.html',
  '/style.css',
  '/common.js',
  '/favicon.svg',
]);
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.use((req, res, next) => {
  const user = sessionUser(req.headers.cookie);
  if (user && !user.suspended) {
    req.user = user;
    return next();
  }
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (user && user.suspended) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Your account is suspended', suspended: true });
    return res.redirect('/suspended.html');
  }
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(401).json({ error: 'unauthorized' });
  res.redirect('/login.html?next=' + encodeURIComponent(req.originalUrl));
});

app.get('/api/config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({
      // Comma-separated, e.g. "turn:1.2.3.4:3478?transport=udp,turn:1.2.3.4:3478?transport=tcp"
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  res.json({ iceServers });
});

// Own profile, including the private email (for the edit page).
app.get('/api/users/me', (req, res) => {
  res.json(privateUser(req.user));
});

app.post('/api/users/me/password', (req, res) => {
  const user = req.user;
  const { current, password } = req.body || {};
  if (!checkPassword(user, current)) {
    return setTimeout(() => res.status(400).json({ error: 'Current password is wrong', field: 'current' }), 1000);
  }
  if (String(password || '').length < MIN_PASSWORD) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters`, field: 'password' });
  }
  setPassword(user, password);
  saveUsers();
  startSession(req, res, user); // keep this browser signed in; other sessions end
  res.json({ ok: true });
});

// Update own profile.
app.put('/api/users/me', runUpload(avatarUpload), (req, res) => {
  const user = req.user;
  const name = cleanName(req.body.name);
  if (!name) {
    removeUpload(req.file);
    return res.status(400).json({ error: 'Name is required' });
  }
  const email = cleanEmail(req.body.email);
  const problem = emailProblem(email, user.id);
  if (problem) {
    removeUpload(req.file);
    return res.status(problem.includes('already') ? 409 : 400).json({ error: problem, field: 'email' });
  }
  user.name = name;
  if (email !== user.email) {
    user.email = email;
    user.emailTemporary = false;
  }
  if (req.file) {
    removeUploadedFile(user.avatar);
    user.avatar = '/uploads/' + req.file.filename;
  } else if (req.body.removeAvatar === '1') {
    removeUploadedFile(user.avatar);
    user.avatar = null;
  }
  saveUsers();
  broadcastDirectory();
  res.json(privateUser(user));
});

// Post a photo to the chat (optionally with a caption).
app.post('/api/messages/photo', runUpload(photoUpload), (req, res) => {
  const user = req.user;
  if (!req.file) return res.status(400).json({ error: 'No photo' });
  const msg = addMessage(user, String(req.body.text || ''), {
    url: '/uploads/' + req.file.filename,
    name: String(req.file.originalname || 'photo').slice(0, 200),
    size: req.file.size,
  });
  res.json(msg);
});

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('Content-Security-Policy', "default-src 'none'"),
  })
);
// ---------- pages and static assets ----------
// Cloudflare tells browsers to cache .js/.css for hours, so after a deploy people kept running
// old scripts. Pages are never cached and link to assets as /file.js?v=<hash of all assets>,
// so every deploy changes the URLs and browsers fetch the new files straight away.

const PUBLIC_DIR = path.join(__dirname, 'public');
const ASSET_VERSION = (() => {
  const hash = crypto.createHash('sha1');
  for (const name of fs.readdirSync(PUBLIC_DIR).sort()) {
    const file = path.join(PUBLIC_DIR, name);
    if (fs.statSync(file).isFile()) hash.update(name).update(fs.readFileSync(file));
  }
  return hash.digest('hex').slice(0, 10);
})();

const pageCache = new Map();
function renderPage(file) {
  if (!pageCache.has(file)) {
    const html = fs
      .readFileSync(path.join(PUBLIC_DIR, file), 'utf8')
      .replace(/((?:src|href)="\/[\w.-]+\.(?:js|css))"/g, `$1?v=${ASSET_VERSION}"`);
    pageCache.set(file, html);
  }
  return pageCache.get(file);
}

app.get(/^\/(?:[\w-]+(?:\.html)?)?$/, (req, res, next) => {
  const name = req.path === '/' ? 'index' : req.path.slice(1).replace(/\.html$/, '');
  const file = name + '.html';
  if (!fs.existsSync(path.join(PUBLIC_DIR, file))) return next();
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(renderPage(file));
});

app.use((req, res, next) => {
  // Versioned URLs never change content; everything else must be revalidated.
  res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  next();
});
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], cacheControl: false }));

// ---------- realtime ----------

let server;
if (process.env.SSL_KEY && process.env.SSL_CERT) {
  server = https.createServer(
    { key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) },
    app
  );
} else {
  server = http.createServer(app);
}

const io = new Server(server, { maxHttpBufferSize: 1e6 });

const userSockets = new Map(); // userId -> Set<socketId>
const videoParticipants = new Map(); // socketId -> userId

function onlineUserIds() {
  return [...userSockets.keys()];
}

function videoList() {
  return [...videoParticipants].map(([socketId, userId]) => ({ socketId, userId }));
}

function broadcastPresence() {
  io.to('lobby').emit('presence', onlineUserIds());
}

function broadcastVideo() {
  io.to('lobby').emit('video:participants', videoList());
}

// Tell every open tab of a user why, then disconnect it (presence and video clean up on disconnect).
function kickUser(userId, status) {
  for (const sid of userSockets.get(userId) || []) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    s.emit('account', { status });
    s.disconnect(true);
  }
}

function broadcastDirectory() {
  io.to('lobby').emit('users', directory());
}

function addMessage(user, text, image) {
  const msg = {
    id: crypto.randomBytes(8).toString('hex'),
    userId: user.id,
    text: cleanText(text),
    image: image || null,
    ts: Date.now(),
  };
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
  saveMessages();
  io.to('lobby').emit('chat:message', msg);
  return msg;
}

io.use((socket, next) => {
  const user = sessionUser(socket.request.headers.cookie);
  if (!user) return next(new Error('unauthorized'));
  if (user.suspended) return next(new Error('suspended'));
  socket.data.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  socket.join('lobby');
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);

  socket.emit('init', {
    me: privateUser(users[userId]),
    users: directory(),
    online: onlineUserIds(),
    video: videoList(),
    messages,
  });
  broadcastPresence();

  socket.on('chat:send', (payload) => {
    const text = cleanText(payload && payload.text);
    if (!text || !users[userId] || users[userId].suspended) return;
    addMessage(users[userId], text, null);
  });

  // Only the author may edit or delete a message.
  const ownMessage = (payload) => {
    const id = payload && typeof payload.id === 'string' ? payload.id : '';
    const msg = messages.find((m) => m.id === id);
    return msg && msg.userId === userId ? msg : null;
  };
  const reply = (ack, body) => {
    if (typeof ack === 'function') ack(body);
  };

  socket.on('chat:edit', (payload, ack) => {
    const msg = ownMessage(payload);
    if (!msg) return reply(ack, { error: 'You can only edit your own messages' });
    const text = cleanText(payload && payload.text);
    // A photo may lose its caption; a text message can't become empty (delete it instead).
    if (!text && !msg.image) return reply(ack, { error: 'Message is empty' });
    if (text !== msg.text) {
      msg.text = text;
      msg.editedAt = Date.now();
      saveMessages();
      io.to('lobby').emit('chat:updated', msg);
    }
    reply(ack, { ok: true });
  });

  socket.on('chat:delete', (payload, ack) => {
    const msg = ownMessage(payload);
    if (!msg) return reply(ack, { error: 'You can only delete your own messages' });
    messages = messages.filter((m) => m !== msg);
    if (msg.image) removeUploadedFile(msg.image.url);
    saveMessages();
    io.to('lobby').emit('chat:deleted', { id: msg.id });
    reply(ack, { ok: true });
  });

  socket.on('video:join', () => {
    if (videoParticipants.has(socket.id)) return;
    const existing = videoList();
    videoParticipants.set(socket.id, userId);
    // The newcomer sends offers to everyone already in the call.
    socket.emit('video:peers', existing);
    broadcastVideo();
  });

  const leaveVideo = () => {
    if (!videoParticipants.delete(socket.id)) return;
    for (const sid of videoParticipants.keys()) {
      io.to(sid).emit('video:peer-left', { socketId: socket.id });
    }
    broadcastVideo();
  };

  socket.on('video:leave', leaveVideo);

  socket.on('video:signal', (payload) => {
    if (!payload || typeof payload.to !== 'string') return;
    // Only relay between sockets that are both in the call.
    if (!videoParticipants.has(socket.id) || !videoParticipants.has(payload.to)) return;
    io.to(payload.to).emit('video:signal', {
      from: socket.id,
      userId,
      description: payload.description,
      candidate: payload.candidate,
    });
  });

  socket.on('disconnect', () => {
    leaveVideo();
    const set = userSockets.get(userId);
    if (set) {
      set.delete(socket.id);
      if (!set.size) userSockets.delete(userId);
    }
    broadcastPresence();
  });
});

server.listen(PORT, () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`channel4444 running at ${proto}://localhost:${PORT}`);
  const n = Object.values(users).filter((u) => u.isAdmin && u.hash).length;
  console.log(n ? `${n} admin account${n > 1 ? 's' : ''}.` : 'No admin account yet: run `node admins.js create <email>`.');
});
