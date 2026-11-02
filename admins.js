// Manage admin accounts on a running server (setup.sh uses this to create the first admin).
// Admins are normal users with the admin flag; passwords are generated, printed once, and only
// stored as hashes.
//
//   node admins.js create <email>            create an admin (or promote that user), print the password
//   node admins.js reset-password <email>    give that user a new password, print it
//   node admins.js list
//
// Talks to the server over localhost and proves it's on the same machine by reading
// data/session.key. Uses PORT (default 4444).
// Exit codes: 0 ok, 1 error, 3 admin already exists, 4 no such user.

const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.PORT) || 4444;
const KEY_FILE = path.join(__dirname, 'data', 'session.key');

function call(body) {
  let key;
  try {
    key = fs.readFileSync(KEY_FILE, 'utf8').trim();
  } catch {
    return Promise.reject(Object.assign(new Error(`Can't read ${KEY_FILE}. Has the server started?`), { code: 1 }));
  }
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/internal/admins',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Internal-Key': key },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(text);
          } catch {}
          if (res.statusCode === 200) return resolve(json);
          const code = { 409: 3, 404: 4 }[res.statusCode] || 1;
          reject(Object.assign(new Error(json.error || `Server answered ${res.statusCode}`), { code }));
        });
      }
    );
    req.on('error', (err) => reject(Object.assign(new Error(`Can't reach the server on port ${PORT}: ${err.message}`), { code: 1 })));
    req.end(data);
  });
}

async function main() {
  const [cmd, email] = process.argv.slice(2);
  if ((cmd === 'create' || cmd === 'reset-password') && email) {
    const res = await call({ action: cmd, email });
    process.stdout.write(res.password + '\n'); // only the password, so scripts can capture it
  } else if (cmd === 'list') {
    const res = await call({ action: 'list' });
    for (const a of res.admins) console.log(`${a.email}\t${a.name}\tcreated ${new Date(a.createdAt).toISOString()}`);
  } else {
    console.error('Usage: node admins.js create|reset-password <email>  |  node admins.js list');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(err.code || 1);
});
