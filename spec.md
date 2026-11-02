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
  - Message box is multiline: it grows with the text up to about 7 lines, then scrolls.
    On computers, Enter sends and Shift+Enter adds a new line. On touch screens, Enter adds a new line
    and the send button sends.
  - Icon buttons around the message box: a small image icon (send a photo) on the left, a send
    arrow on the right (greyed out while the box is empty).
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

## 3. Accounts (invite-only)
- Everyone signs in with **email + password** (`/login`). There is no self-signup, and every page
  and API requires a signed-in account. The shared access password was removed.
- Accounts are created by an admin (Admin → Add user). The admin gets a generated password, shown
  once, to pass on. Passwords are stored as scrypt hashes only.
- Sessions: signed cookie, 30 days. A password change or reset signs that person out everywhere
  (open tabs are sent to the sign-in page).
- Wrong email/password answers after a 1 s delay, with the same message for both.
- Header: "Edit profile", "Admin" (admins only), "Sign out".
- Users who existed before logins keep their messages but have **no password** until an admin resets it.

## 4. Profile page (`/profile`)
- Input for user name (required, up to 32 characters).
- Input for email (required, must be a valid address, unique across all users — case-insensitive).
  - Private: only the user (on their profile page) and the admin can see it; it is never sent to
    other users.
  - Not verified (no confirmation email).
  - Users created before emails were required got a temporary placeholder
    `user-<id>@temp.invalid` (`.invalid` can never be a real domain). When they open
    "Edit profile", the email field is empty with a notice asking for their real address.
- Upload avatar (optional, up to 5 MB; initials are shown if there's no avatar).
- Change password: current password + new one (at least 8 characters). Other devices are signed out.

## 5. Admin page (`/admin`)
- For admins: users with the admin flag. They also use the chat and video like everyone else.
  - `setup.sh` creates the first admin from `ADMIN_EMAIL` (required on the first run and with
    `RESET=1`) and prints its generated password once. This admin is the first account with access.
  - Command line: `channel4444-admin create|reset-password <email>` and `channel4444-admin list`.
  - Non-admins who open `/admin` see "Admins only". Signed-out visitors are sent to sign in.
  - The header shows the signed-in admin's email, a link back to the chat, and Sign out.
  - **Add user** button: name, email, optional admin flag. Shows the generated password once,
    with a Copy button.
- VS Code-style layout: a narrow activity bar on the left with icon buttons, and content on the right.
- Activity bar buttons (one for now):
  - **Users**: a list of all registered users with avatar, name, email (temporary ones are greyed
    out with a "temporary" badge), ID, registration date,
    status (online / in video chat / suspended / offline) and message count; searchable by name,
    email or ID.
  - Click any column header (User, Email, ID, Registered, Status, Messages) to sort; click again to reverse.
    An arrow shows the current sort, and it is remembered in the browser. Status sorts by activity:
    in video chat → online → offline → suspended.
  - Badges next to the name: "you", "Admin", "No password" (can't sign in until reset).
  - Row actions are icon buttons (with tooltips): key = reset password (new one shown once, signs
    them out), pause = suspend, play = unsuspend, trash = delete. None on your own row.
  - **Suspend / Unsuspend** a user (asks to confirm). A suspended user is disconnected immediately
    (also from the video call) and sees an "account suspended" page. They can't chat, post photos,
    edit their profile or join the call until unsuspended. Their messages stay.
  - **Delete** a user (confirmation dialog). They are disconnected immediately and sent to the
    sign-in page. Optionally also deletes all their messages and photos (checkbox in the dialog);
    otherwise their messages stay.

## 6. Server setup (`setup.sh`)
- `ADMIN_EMAIL` creates the first admin and prints its password once. Re-runs keep all data.
- `RESET=1` starts over with an empty database: asks you to type the domain (or `RESET_CONFIRM`),
  backs up `data/` to `/var/backups/channel4444/before-reset-<date>.tgz`, deletes all users,
  messages, photos and admins, then creates the admin from `ADMIN_EMAIL`.

## 7. Privacy
- Invite-only: nothing (pages, API, photos, live connection) is reachable without signing in.
- Video and audio go directly between browsers (WebRTC); the server only relays the connection setup.

## 8. Known limits
- Camera/mic need HTTPS unless you're on localhost.
- Group video works well for about 6 people, because every participant connects to every other one.
- Some networks need a TURN server (configured with the `TURN_*` variables). In production it is
  coturn on the same droplet, reached by IP (the Cloudflare proxy doesn't forward TURN), over UDP with a TCP fallback.
- When a peer can't connect, its video tile shows "connection failed".
