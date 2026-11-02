# channel4444 — Private communication app

The app is mainly for private video meetings, text chat, and photo upload/download.

## 1. Platform
- Browser app.
- Runs on port **4444** by default (port 3000 was taken). Set `PORT` to change it.
- Can run with Docker (`docker compose up -d --build`).
- Production: hosted on DigitalOcean, with the domain registered through Cloudflare.
- After a deploy, a normal page reload always loads the new version (no hard refresh needed).

## 2. Main page
- **Text chat**
  - Text messages; links are clickable.
  - Photo upload: JPEG, PNG, GIF or WebP, up to 20 MB. Whatever is typed in the box is sent as the caption.
  - Photo viewer: clicking a photo opens it in a full-screen popup inside the app (not a new tab),
    showing the sender, time and caption, with download and close buttons. Close with Esc, the ✕
    button or a click outside the photo. Cmd/Ctrl-click or middle-click still opens a new tab.
  - Photo download: from the photo viewer, or click the download icon next to the
    edit/delete icons (shown on hover for everyone's photos; tooltip shows the file size). The file name is not shown in the chat, but
    downloaded files keep their original name.
  - History: the server keeps the last 500 messages, and all of them load when the page opens.
    (Lazy loading was tried and removed for now.)
  - Photos show a grey placeholder until they load.
  - Message icons appear on hover (always visible on touch screens), in this order:
    ⬇ download (photos, anyone), ✏️ edit and 🗑 delete (your own messages only). Nobody can edit or delete someone else's messages.
    - Editing happens in place: Enter saves, Esc cancels. Edited messages show "(edited)".
    - A photo's caption can be removed; emptying a text message deletes it instead.
    - Deleting asks for confirmation, removes the message for everyone, and deletes the photo file.
- **Video chat**
  - You can't see or hear the call until you press **"Connect to video chat"**.
  - Several people can be in the meeting at once.
  - Controls: mute/unmute mic, camera on/off, leave.
  - If camera/mic access is denied, the user joins to watch and listen only.
  - If the mic or camera isn't available (blocked, busy in another app, missing), the user still joins
    with whatever works, and a red notice says who can't hear or see them and how to fix it.
  - Your own tile shows a live microphone level bar (green).
  - Each other person's tile shows a level bar for the audio arriving from them (blue), and a red
    "No audio received" label if no audio is reaching you from them.
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
    status (online / in video chat / suspended / offline) and message count; searchable by name or ID.
  - Click any column header (User, ID, Registered, Status, Messages) to sort; click again to reverse.
    An arrow shows the current sort, and it is remembered in the browser. Status sorts by activity:
    in video chat → online → offline → suspended.
  - Row actions are icon buttons (with tooltips): pause = suspend, play = unsuspend, trash = delete.
  - **Suspend / Unsuspend** a user (asks to confirm). A suspended user is disconnected immediately
    (also from the video call) and sees an "account suspended" page. They can't chat, post photos,
    edit their profile or join the call until unsuspended. Their messages stay.
  - **Delete** a user (confirmation dialog). They are disconnected immediately and sent to the
    create-user page. Optionally also deletes all their messages and photos (checkbox in the dialog);
    otherwise their messages stay.
  - Limitation: there are no per-user passwords, so a suspended or deleted person can clear their
    browser data and create a new user. To lock someone out completely, change `ACCESS_PASSWORD`.
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
