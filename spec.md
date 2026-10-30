# channel4444 — Private communication app

The app is mainly for private video meetings, text chat, and photo upload/download.

## 1. Platform
- Browser app.
- Runs on port **4444** by default (port 3000 was taken). Set `PORT` to change it.
- Can run with Docker (`docker compose up -d --build`).

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
- **List of users currently in the video chat**
- **Separate list of users currently in the app** (everyone with the main page open)

## 3. Create user page
- Input for user name (required, up to 32 characters).
- Upload avatar (optional, up to 5 MB; initials are shown if there's no avatar).
- The same page is used to edit your profile later ("Edit profile" on the main page).
- No accounts or passwords per user: the identity is stored in the browser.

## 4. Privacy
- Optional shared access password for the whole app (`ACCESS_PASSWORD`).
- Video and audio go directly between browsers (WebRTC); the server only relays the connection setup.

## 5. Known limits
- Camera/mic need HTTPS unless you're on localhost.
- Group video works well for about 6 people, because every participant connects to every other one.
- Some networks need a TURN server (configured with the `TURN_*` variables).
