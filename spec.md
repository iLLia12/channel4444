# channel4444 — Private communication app

The app is mainly for private video meetings, text chat, and photo upload/download.

## 1. Platform
- Browser app.
- Runs on port **4444** by default (port 3000 was taken). Set `PORT` to change it.
- Can run with Docker (`docker compose up -d --build`).
- Production: hosted on DigitalOcean, with the domain registered through Cloudflare.

## 2. Main page
- **Text chat**
  - Text messages; links are clickable.
  - Photo upload: JPEG, PNG, GIF or WebP, up to 20 MB. Whatever is typed in the box is sent as the caption.
  - Photo download: click a photo to open it full size, or use the download link.
  - History: the last 500 messages are kept and shown when the page opens.
- **Video chat**
  - You can't see or hear the call until you press **"Connect to video chat"**.
  - Several people can be in the meeting at once.
  - Controls: mute/unmute mic, camera on/off, leave.
  - If camera/mic access is denied, the user joins to watch and listen only.
  - If the mic or camera isn't available (blocked, busy in another app, missing), the user still joins
    with whatever works, and a red notice says who can't hear or see them and how to fix it.
  - Your own tile shows a live microphone level bar.
  - If the browser blocks sound from playing automatically, the tile shows a "Click to turn on sound" button.
- **List of users currently in the video chat**
- **Separate list of users currently in the app** (everyone with the main page open)

## 3. Create user page
- Input for user name (required, up to 32 characters).
- Upload avatar (optional, up to 5 MB; initials are shown if there's no avatar).
- The same page is used to edit your profile later ("Edit profile" on the main page).
- No accounts or passwords per user: the identity is stored in the browser.

## 4. Admin page (`/admin`)
- Protected by its own password (`ADMIN_PASSWORD`); turned off if that isn't set.
- VS Code-style layout: a narrow activity bar on the left with icon buttons, and content on the right.
- Activity bar buttons (one for now):
  - **Users**: a list of all registered users with avatar, name, ID, registration date,
    status (online / in video chat / offline) and message count; searchable by name or ID.
- Sign out button; admin sessions expire after 12 hours.

## 5. Privacy
- Optional shared access password for the whole app (`ACCESS_PASSWORD`).
- Video and audio go directly between browsers (WebRTC); the server only relays the connection setup.

## 6. Known limits
- Camera/mic need HTTPS unless you're on localhost.
- Group video works well for about 6 people, because every participant connects to every other one.
- Some networks need a TURN server (configured with the `TURN_*` variables). In production it is
  coturn on the same droplet, reached by IP (the Cloudflare proxy doesn't forward TURN), over UDP with a TCP fallback.
- When a peer can't connect, its video tile shows "connection failed".
