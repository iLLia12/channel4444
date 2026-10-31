const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 4444;
// Optional shared password that gates the whole app.
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
// Password for the /admin page. The admin page is disabled when this is not set.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
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

const users = loadJson(USERS_FILE, {}); // id -> { id, name, avatar, token, createdAt }
let messages = loadJson(MESSAGES_FILE, []);

const saveTimers = {};
function scheduleSave(file, getData) {
  clearTimeout(saveTimers[file]);
  saveTimers[file] = setTimeout(() => {
    fs.writeFile(file, JSON.stringify(getData(), null, 2), (err) => {
      if (err) console.error('Failed to save', file, err);
    });
  }, 200);
}
const saveUsers = () => scheduleSave(USERS_FILE, () => users);
const saveMessages = () => scheduleSave(MESSAGES_FILE, () => messages);

function publicUser(u) {
  return { id: u.id, name: u.name, avatar: u.avatar };
}

function directory() {
  const out = {};
  for (const u of Object.values(users)) out[u.id] = publicUser(u);
  return out;
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function authUser(userId, token) {
  const u = users[userId];
  if (!u || !token || !safeEqual(u.token, token)) return null;
  return u;
}

// ---------- access gate ----------

const ACCESS_COOKIE = 'c4_access';
const accessToken = ACCESS_PASSWORD
  ? crypto.createHash('sha256').update('channel4444:' + ACCESS_PASSWORD).digest('hex')
  : null;

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hasAccess(cookieHeader) {
  if (!accessToken) return true;
  const c = parseCookies(cookieHeader)[ACCESS_COOKIE];
  return !!c && safeEqual(c, accessToken);
}

const ADMIN_COOKIE = 'c4_admin';
const adminToken = ADMIN_PASSWORD
  ? crypto.createHash('sha256').update('channel4444-admin:' + ADMIN_PASSWORD).digest('hex')
  : null;

function isAdmin(cookieHeader) {
  if (!adminToken) return false;
  const c = parseCookies(cookieHeader)[ADMIN_COOKIE];
  return !!c && safeEqual(c, adminToken);
}

function setCookie(req, res, name, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
  );
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

function removeAvatarFile(avatar) {
  if (avatar && avatar.startsWith('/uploads/')) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(avatar)), () => {});
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

app.post('/api/login', (req, res) => {
  if (!accessToken) return res.json({ ok: true });
  if (!safeEqual(req.body && req.body.password, ACCESS_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  setCookie(req, res, ACCESS_COOKIE, accessToken, 60 * 60 * 24 * 365);
  res.json({ ok: true });
});

// ---------- admin ----------

app.get('/api/admin/session', (req, res) => {
  res.json({ enabled: !!adminToken, loggedIn: isAdmin(req.headers.cookie) });
});

app.post('/api/admin/login', (req, res) => {
  if (!adminToken) return res.status(403).json({ error: 'Admin is disabled. Set ADMIN_PASSWORD.' });
  if (!safeEqual(req.body && req.body.password, ADMIN_PASSWORD)) {
    // Slow down password guessing.
    return setTimeout(() => res.status(401).json({ error: 'Wrong password' }), 1000);
  }
  setCookie(req, res, ADMIN_COOKIE, adminToken, 60 * 60 * 12);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  setCookie(req, res, ADMIN_COOKIE, '', 0);
  res.json({ ok: true });
});

app.get('/api/admin/users', (req, res) => {
  if (!isAdmin(req.headers.cookie)) return res.status(401).json({ error: 'unauthorized' });
  const messageCounts = {};
  for (const m of messages) messageCounts[m.userId] = (messageCounts[m.userId] || 0) + 1;
  const inVideo = new Set(videoParticipants.values());
  const list = Object.values(users)
    .map((u) => ({
      ...publicUser(u),
      createdAt: u.createdAt,
      online: userSockets.has(u.id),
      inVideo: inVideo.has(u.id),
      messages: messageCounts[u.id] || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

const PUBLIC_WHEN_LOCKED = new Set([
  '/login.html',
  '/style.css',
  '/login.js',
  '/favicon.ico',
  '/admin',
  '/admin.html',
  '/admin.js',
  '/admin.css',
  '/common.js',
]);
app.use((req, res, next) => {
  const allowed = hasAccess(req.headers.cookie) || isAdmin(req.headers.cookie);
  if (allowed || PUBLIC_WHEN_LOCKED.has(req.path)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  res.redirect('/login.html');
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

// Create a user.
app.post('/api/users', runUpload(avatarUpload), (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) {
    removeUpload(req.file);
    return res.status(400).json({ error: 'Name is required' });
  }
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    name,
    avatar: req.file ? '/uploads/' + req.file.filename : null,
    token: crypto.randomBytes(24).toString('hex'),
    createdAt: Date.now(),
  };
  users[user.id] = user;
  saveUsers();
  broadcastDirectory();
  res.json({ ...publicUser(user), token: user.token });
});

// Update own profile.
app.put('/api/users/me', runUpload(avatarUpload), (req, res) => {
  const user = authUser(req.get('x-user-id'), req.get('x-user-token'));
  if (!user) {
    removeUpload(req.file);
    return res.status(401).json({ error: 'Unknown user' });
  }
  const name = cleanName(req.body.name);
  if (!name) {
    removeUpload(req.file);
    return res.status(400).json({ error: 'Name is required' });
  }
  user.name = name;
  if (req.file) {
    removeAvatarFile(user.avatar);
    user.avatar = '/uploads/' + req.file.filename;
  } else if (req.body.removeAvatar === '1') {
    removeAvatarFile(user.avatar);
    user.avatar = null;
  }
  saveUsers();
  broadcastDirectory();
  res.json({ ...publicUser(user), token: user.token });
});

// Post a photo to the chat (optionally with a caption).
app.post('/api/messages/photo', runUpload(photoUpload), (req, res) => {
  const user = authUser(req.get('x-user-id'), req.get('x-user-token'));
  if (!user) {
    removeUpload(req.file);
    return res.status(401).json({ error: 'Unknown user' });
  }
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
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

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

function broadcastDirectory() {
  io.to('lobby').emit('users', directory());
}

function addMessage(user, text, image) {
  const msg = {
    id: crypto.randomBytes(8).toString('hex'),
    userId: user.id,
    text: text.slice(0, MAX_TEXT),
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
  if (!hasAccess(socket.request.headers.cookie)) return next(new Error('unauthorized'));
  const { userId, token } = socket.handshake.auth || {};
  const user = authUser(userId, token);
  if (!user) return next(new Error('unknown_user'));
  socket.data.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  socket.join('lobby');
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);

  socket.emit('init', {
    me: publicUser(users[userId]),
    users: directory(),
    online: onlineUserIds(),
    video: videoList(),
    messages,
  });
  broadcastPresence();

  socket.on('chat:send', (payload) => {
    const text = String((payload && payload.text) || '').trim();
    if (!text || !users[userId]) return;
    addMessage(users[userId], text, null);
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
  if (ACCESS_PASSWORD) console.log('Access password is enabled.');
  console.log(ADMIN_PASSWORD ? 'Admin page enabled at /admin.' : 'Admin page disabled (set ADMIN_PASSWORD).');
});
