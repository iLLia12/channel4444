# channel4444

Private browser app for group video meetings, text chat and photo sharing.

## Run

```sh
npm install
npm start            # http://localhost:4444
```

Or with Docker:

```sh
docker compose up -d --build   # start
docker compose logs -f         # logs
docker compose down            # stop (data is kept in the channel4444-data volume)
```

Docker Compose reads `ACCESS_PASSWORD` from a `.env` file next to `docker-compose.yml`.
That file is git-ignored, so passwords are never committed.

Create an admin account (the generated password is printed once):

```sh
node admins.js create you@example.com                           # running with npm start
docker compose exec app node admins.js create you@example.com   # running in Docker
```

Open `http://localhost:4444`. On first visit you are sent to the **Create user** page
(name, email and avatar; the email is required, must be unique, and only you and the admin see it). Your identity is stored in the browser's localStorage.

## Main page

- **In the app**: everyone with the main page open right now.
- **In video chat**: everyone currently in the call.
- **Video chat**: you see and hear nothing until you click **Connect to video chat**.
  Several people can join. You get mic/camera toggles and a Leave button. A green bar on your
  own tile shows your mic level. A red notice appears if others can't hear or see you.
  Other people's tiles show a blue bar for the audio arriving from them, and "No audio received"
  if none is.
- **Chat**: shows the last 500 messages. Text messages, plus photos (image icon left of the
  message box). The message box is multiline: **Enter** sends and **Shift+Enter** adds a line
  (on phones, Enter adds a line and the ➤ button sends). Anything typed in the box is sent
  as the photo's caption. Click a photo to view it full screen in a popup (Esc or a click outside
  closes it), or hover over the message and click the ⬇ download icon (next to edit/delete). File names aren't shown in the chat, but downloads keep the original name.
  Hover over your own message and click the **✏️ pencil** to edit it (Enter saves, Esc cancels)
  or the **🗑 trash** to delete it.
  Changes appear for everyone right away, and edited messages are marked "(edited)".

## Admin page

Open `/admin` (e.g. `http://localhost:4444/admin`) and sign in with an **admin account**
(email + password). Admin accounts are separate from chat users and live in `data/admins.json`,
which stores only scrypt hashes, never the passwords themselves. Each password is generated and
shown once, when the account is created or its password is reset. Sessions last 12 hours.
Resetting a password signs out that admin everywhere.

Manage admins with `node admins.js` (on the server: `channel4444-admin`):

| Command | What it does |
| --- | --- |
| `create <email>` | Create an admin and print its generated password |
| `reset-password <email>` | Generate a new password and print it |
| `delete <email>` | Remove an admin |
| `list` | List admin emails |

The layout copies VS Code: a narrow activity bar on the left, with one button for now:

- **Users**: every registered user with their avatar, name, email, ID, registration date,
  status (online, in video chat, suspended, or offline) and number of chat messages. You can search by
  name, email or ID.
  - Users created before emails were required have a temporary `user-<id>@temp.invalid` address,
    marked "temporary". The app asks them for a real one when they open **Edit profile**.
  - **Sort** by any column: click its header, then click again to reverse. Your choice is remembered.
  - Each row has two icon buttons: **⏸ suspend** (▶ to unsuspend) and **🗑 delete**.
  - **Suspend**: disconnects the user right away. They see an "account suspended" page until you
    click **Unsuspend**. Their messages stay.
  - **Delete**: removes the user and signs them out right away. Tick the box in the dialog to
    also delete all their messages and photos.

  There are no per-user passwords, so a suspended or deleted person can clear their browser data
  and create a new user. To lock someone out completely, change `ACCESS_PASSWORD`
  (`channel4444-password NEWPASS` on the server).

Signing in as admin also lets you through the `ACCESS_PASSWORD` gate. The admin session lasts 12 hours.

## Deployment

- **Hosting:** DigitalOcean.
- **Domain:** registered through Cloudflare.
- **Set up with** `setup.sh` (run as root on the server). It installs Docker, Caddy (HTTPS),
  coturn (TURN), a firewall and nightly backups.
- **Code on the server:** `/opt/channel4444` (unless `APP_DIR` was set when running `setup.sh`).
  - Secrets: `/opt/channel4444/.env.prod`
  - Data: `/opt/channel4444/data`; backups go to `/var/backups/channel4444`
  - Commands: `channel4444-update` (pull and rebuild), `channel4444 logs -f`, `channel4444 ps`,
    `channel4444-password` (show or change the access password), `channel4444-admin` (manage admins)
- **Admin account:** `setup.sh` requires `ADMIN_EMAIL` until an admin exists. It creates that
  admin and prints the generated password **once**, in the final summary:
  `DOMAIN=<your domain> ADMIN_EMAIL=you@example.com bash /opt/channel4444/setup.sh`.
  Re-running keeps existing admins. Forgot the password? Run `channel4444-admin reset-password you@example.com`.
- **Changes to `setup.sh`** (new env variables, proxy or TURN config) only take effect when you
  run it again: `DOMAIN=<your domain> bash /opt/channel4444/setup.sh`. It's safe to re-run, and existing
  secrets are kept. Code-only changes just need `channel4444-update`.

## Configuration (environment variables)

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `4444`) |
| `ACCESS_PASSWORD` | If set, the whole app is locked behind this shared password |
| `SSL_KEY`, `SSL_CERT` | Paths to a key and certificate to serve over HTTPS |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN server for peers behind strict NATs. `TURN_URL` can be comma-separated |

Example: `ACCESS_PASSWORD=letmein PORT=8080 npm start`

## Notes

- **HTTPS is required** for camera and microphone access everywhere except `localhost`.
  To use the app across devices, set `SSL_KEY`/`SSL_CERT` or put it behind a reverse proxy
  with TLS (Caddy, nginx, Cloudflare Tunnel, etc.).
- Video is peer-to-peer (WebRTC mesh); the server only relays signaling. That works well
  for small groups (about 6 people). Some networks need a TURN server to connect.
- Data (users, last 500 messages, uploaded images) is stored in `data/`.
- **Caching:** pages are never cached. Scripts and styles are linked as `file.js?v=<hash>`, and the
  hash changes whenever any file in `public/` changes. After a deploy, a normal reload gets the new
  version, even though Cloudflare tells browsers to cache `.js`/`.css` for hours.

## Troubleshooting: video stuck on "connecting…"

1. **Update the server.** Run `channel4444-update`, then re-run `setup.sh` so the new TURN settings
   are applied: `DOMAIN=<your domain> bash /opt/channel4444/setup.sh`.
2. **Check that the TURN server is running:** `channel4444 ps` should show `coturn` as running.
   For its logs, run `channel4444 logs coturn --tail 50`.
3. **Open the TURN ports in the DigitalOcean Cloud Firewall** (Networking → Firewalls), if you
   use one. It is separate from `ufw` on the server. Allow 3478 TCP+UDP and 49152-65535 UDP inbound.
4. **Check in the browser:** the console logs `[video] <name>: <state>` for each connection.
   For full detail, open `chrome://webrtc-internals` during a call.

The TURN relay is reached by the server's IP address, not the domain, because a Cloudflare-proxied
(orange cloud) domain doesn't forward TURN traffic.

## Troubleshooting: others can't hear you

1. **Look at the green bar** on your own tile and speak. If it doesn't move, your mic isn't picking
   you up. Check the mic selected in the browser (the camera/mic icon in the address bar) and in your
   system sound settings.
2. **Read the red notice** above the video, if there is one. It says whether the mic is blocked,
   missing or muted.
3. **Close other apps using the mic** (Zoom, Teams, Discord, another browser tab), then leave and rejoin.
4. **The other person sees "Click to turn on sound"** when their browser blocked autoplay. They
   need to click it.
5. **Ask the other person to look at the blue bar on your tile** while you talk:
   - **"No audio received"**: your audio isn't reaching them. Check steps 1–3 on your side.
   - **The bar moves but they hear nothing**: the audio arrives, so the problem is playback on
     their device. Check their volume, the browser tab isn't muted, and their output device
     (system sound settings). On iPhone, sound may come out of the quiet earpiece; using headphones fixes it.
6. **Testing in the same home:** mute one laptop's speakers or use headphones. Otherwise you may be
   hearing each other through the air, not through the app.
