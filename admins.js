// Admin accounts, stored in data/admins.json with scrypt-hashed passwords.
// Plain passwords are never stored: they are shown once, when created or reset.
//
// Used by server.js, and as a command line tool:
//   node admins.js create <email>            create an admin, print its generated password
//   node admins.js reset-password <email>    set a new generated password, print it
//   node admins.js delete <email>
//   node admins.js list
//
// Exit codes: 0 ok, 1 bad usage/input, 3 admin already exists, 4 admin not found.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'admins.json');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalize = (email) => String(email || '').trim().toLowerCase();

// Read fresh every time: the CLI may change the file while the server runs.
function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(admins) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(admins, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

function generatePassword() {
  return crypto.randomBytes(15).toString('base64url'); // 20 characters
}

function find(email) {
  return load()[normalize(email)] || null;
}

function count() {
  return Object.keys(load()).length;
}

function verify(email, password) {
  const admin = find(email);
  // Hash even for unknown emails so response time doesn't reveal which emails exist.
  const { hash } = hashPassword(password, admin ? admin.salt : 'no-such-admin');
  if (!admin) return null;
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(admin.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? admin : null;
}

function create(email, password = generatePassword()) {
  const key = normalize(email);
  if (!EMAIL_RE.test(key)) throw Object.assign(new Error(`Not a valid email: ${email}`), { code: 1 });
  const admins = load();
  if (admins[key]) throw Object.assign(new Error(`Admin ${key} already exists`), { code: 3 });
  admins[key] = { email: key, ...hashPassword(password), createdAt: Date.now() };
  save(admins);
  return password;
}

function resetPassword(email, password = generatePassword()) {
  const key = normalize(email);
  const admins = load();
  if (!admins[key]) throw Object.assign(new Error(`No admin ${key}`), { code: 4 });
  Object.assign(admins[key], hashPassword(password), { passwordChangedAt: Date.now() });
  save(admins);
  return password;
}

function remove(email) {
  const key = normalize(email);
  const admins = load();
  if (!admins[key]) throw Object.assign(new Error(`No admin ${key}`), { code: 4 });
  delete admins[key];
  save(admins);
}

module.exports = { find, count, verify, create, resetPassword, remove, normalize };

if (require.main === module) {
  const [cmd, email] = process.argv.slice(2);
  try {
    if (cmd === 'create' && email) {
      process.stdout.write(create(email) + '\n'); // only the password, so scripts can capture it
    } else if (cmd === 'reset-password' && email) {
      process.stdout.write(resetPassword(email) + '\n');
    } else if (cmd === 'delete' && email) {
      remove(email);
      console.error(`Deleted admin ${normalize(email)}`);
    } else if (cmd === 'list') {
      for (const a of Object.values(load())) {
        console.log(`${a.email}\tcreated ${new Date(a.createdAt).toISOString()}`);
      }
    } else {
      console.error('Usage: node admins.js create|reset-password|delete <email>  |  node admins.js list');
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(err.code || 1);
  }
}
