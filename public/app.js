const me = Store.user;
if (!me) location.replace('/create.html');

const $ = (id) => document.getElementById(id);

const state = {
  users: {}, // id -> { id, name, avatar }
  online: [],
  video: [], // [{ socketId, userId }]
};

const socket = io({ auth: { userId: me && me.id, token: me && me.token } });

// ---------- connection ----------

socket.on('connect', () => {
  $('conn-status').className = 'status online';
  $('conn-status').title = 'Connected';
});

socket.on('disconnect', () => {
  $('conn-status').className = 'status';
  $('conn-status').title = 'Reconnecting…';
  // The server drops us from the call on disconnect; tear down locally too.
  if (video.joined) leaveVideo();
});

socket.on('connect_error', (err) => {
  if (err.message === 'unknown_user') {
    Store.user = null;
    location.replace('/create.html');
  } else if (err.message === 'unauthorized') {
    location.replace('/login.html');
  }
});

socket.on('init', (data) => {
  state.users = data.users;
  state.online = data.online;
  state.video = data.video;
  Store.user = { ...data.me, token: me.token };
  renderMe();
  renderLists();
  $('messages').replaceChildren();
  data.messages.forEach((m) => appendMessage(m));
  scrollChat(true);
});

socket.on('users', (users) => {
  state.users = users;
  const mine = users[me.id];
  if (mine) Store.user = { ...mine, token: me.token };
  renderMe();
  renderLists();
  refreshMessageAuthors();
  refreshTileLabels();
});

socket.on('presence', (online) => {
  state.online = online;
  renderLists();
});

socket.on('video:participants', (list) => {
  state.video = list;
  renderLists();
});

// ---------- people lists ----------

function userById(id) {
  return state.users[id] || { id, name: 'Unknown' };
}

function renderMe() {
  const u = userById(me.id);
  $('me-avatar').replaceChildren(avatarEl(u, 'sm'));
  $('me-name').textContent = u.name;
}

function userRow(u, extra) {
  return el(
    'li',
    { class: u.id === me.id ? 'self' : '' },
    avatarEl(u, 'sm'),
    el('span', { class: 'name', text: u.name }),
    u.id === me.id ? el('span', { class: 'tag', text: 'you' }) : null,
    extra || null
  );
}

function renderLists() {
  const videoUserIds = [...new Set(state.video.map((p) => p.userId))];
  $('video-users').replaceChildren(
    ...videoUserIds.map((id) => userRow(userById(id), el('span', { class: 'live-dot' })))
  );
  $('video-count').textContent = videoUserIds.length;
  $('video-empty').classList.toggle('hidden', videoUserIds.length > 0);

  const online = [...state.online].sort((a, b) =>
    a === me.id ? -1 : b === me.id ? 1 : userById(a).name.localeCompare(userById(b).name)
  );
  $('online-users').replaceChildren(...online.map((id) => userRow(userById(id))));
  $('online-count').textContent = online.length;

  if (!video.joined) {
    const n = videoUserIds.length;
    $('video-idle-text').textContent = n
      ? `${n} ${n === 1 ? 'person is' : 'people are'} in the call. You can't see or hear them until you connect.`
      : "Nobody is in the call yet. You can't see or hear the call until you connect.";
  }
}

// ---------- chat ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function formatTime(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return (today ? '' : dateFmt.format(d) + ' ') + timeFmt.format(d);
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<]+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    frag.append(el('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer', text: m[0] }));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function appendMessage(m) {
  const u = userById(m.userId);
  const body = el('div', { class: 'msg-body' });
  if (m.image) {
    body.append(
      el(
        'div',
        { class: 'msg-photo' },
        el(
          'a',
          { href: m.image.url, target: '_blank', rel: 'noopener' },
          el('img', { src: m.image.url, alt: m.image.name, loading: 'lazy', onload: () => scrollChat() })
        ),
        el(
          'a',
          { class: 'download', href: m.image.url, download: m.image.name },
          `⬇ Download ${m.image.name} ${formatSize(m.image.size)}`.trim()
        )
      )
    );
  }
  if (m.text) body.append(el('div', { class: 'msg-text' }, linkify(m.text)));

  const node = el(
    'div',
    { class: 'msg' + (m.userId === me.id ? ' mine' : ''), 'data-user': m.userId },
    el('div', { class: 'msg-avatar' }, avatarEl(u, 'sm')),
    el(
      'div',
      { class: 'msg-main' },
      el(
        'div',
        { class: 'msg-meta' },
        el('span', { class: 'msg-name', text: u.name }),
        el('time', { text: formatTime(m.ts), title: new Date(m.ts).toLocaleString() })
      ),
      body
    )
  );
  $('messages').append(node);
}

function refreshMessageAuthors() {
  for (const node of $('messages').querySelectorAll('.msg')) {
    const u = userById(node.dataset.user);
    node.querySelector('.msg-avatar').replaceChildren(avatarEl(u, 'sm'));
    node.querySelector('.msg-name').textContent = u.name;
  }
}

function isNearBottom() {
  const box = $('messages');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}

function scrollChat(force) {
  const box = $('messages');
  if (force || isNearBottom()) box.scrollTop = box.scrollHeight;
}

socket.on('chat:message', (m) => {
  const stick = isNearBottom() || m.userId === me.id;
  appendMessage(m);
  if (stick) scrollChat(true);
});

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('message-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat:send', { text });
  input.value = '';
});

$('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('chat-error').textContent = '';
  if (file.size > 20 * 1024 * 1024) {
    $('chat-error').textContent = 'Photo must be 20 MB or smaller';
    return;
  }
  const input = $('message-input');
  const data = new FormData();
  data.append('text', input.value.trim()); // current text becomes the caption
  data.append('photo', file);
  $('chat-error').textContent = 'Uploading photo…';
  try {
    const res = await fetch('/api/messages/photo', {
      method: 'POST',
      headers: { 'X-User-Id': me.id, 'X-User-Token': me.token },
      body: data,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Upload failed');
    input.value = '';
    $('chat-error').textContent = '';
  } catch (err) {
    $('chat-error').textContent = err.message;
  }
});

// ---------- video chat (WebRTC mesh) ----------

const video = {
  joined: false,
  joining: false,
  localStream: null,
  peers: new Map(), // socketId -> { pc, stream, userId, pendingCandidates, tile }
  earlyCandidates: new Map(), // socketId -> candidates that arrived before the peer existed
  iceServers: null,
};

async function getIceServers() {
  if (!video.iceServers) {
    try {
      video.iceServers = (await (await fetch('/api/config')).json()).iceServers;
    } catch {
      video.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
  }
  return video.iceServers;
}

async function getLocalMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera access needs HTTPS (or localhost).');
  }
  // Fall back step by step: a blocked or busy mic shouldn't cost us the camera, and vice versa.
  const attempts = [{ video: true, audio: true }, { audio: true }, { video: true }];
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn('[video] getUserMedia', JSON.stringify(constraints), err.name, err.message);
    }
  }
  return null; // join receive-only
}

function makeTile(key, label, stream, isLocal) {
  const vid = el('video', { autoplay: '', playsinline: '' });
  vid.muted = !!isLocal;
  vid.srcObject = stream;
  const nameEl = el('span', { class: 'tile-name', text: label });
  const tile = el(
    'div',
    { class: 'tile' + (isLocal ? ' local' : ''), 'data-key': key },
    vid,
    el('div', { class: 'tile-placeholder' }),
    nameEl,
    isLocal ? null : el('button', { class: 'btn primary tile-play', text: '🔊 Click to turn on sound', onclick: playAllRemote }),
    isLocal ? null : el('div', { class: 'mic-meter audio-meter', title: 'Incoming audio level' }, el('span')),
    isLocal ? null : el('span', { class: 'audio-status', text: '🔇 No audio received' })
  );
  $('video-grid').append(tile);
  layoutGrid();
  return tile;
}

function updateTilePlaceholder(tile, stream, user) {
  const hasVideo = stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live' && !t.muted);
  tile.classList.toggle('no-video', !hasVideo);
  tile.querySelector('.tile-placeholder').replaceChildren(avatarEl(user, 'xl'));
}

function refreshTileLabels() {
  if (!video.joined) return;
  const local = $('video-grid').querySelector('.tile.local');
  if (local) {
    local.querySelector('.tile-name').textContent = userById(me.id).name + ' (you)';
    updateTilePlaceholder(local, video.localStream, userById(me.id));
  }
  for (const peer of video.peers.values()) {
    if (!peer.tile) continue;
    peer.tile.querySelector('.tile-name').textContent = userById(peer.userId).name;
    updateTilePlaceholder(peer.tile, peer.stream, userById(peer.userId));
  }
}

function layoutGrid() {
  const n = $('video-grid').children.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  $('video-grid').style.setProperty('--cols', cols);
}

// Synchronous on purpose: the peer must be registered before any other signaling
// message is handled, or its ICE candidates get lost. ICE servers are loaded on join.
function createPeer(socketId, userId) {
  const pc = new RTCPeerConnection({ iceServers: video.iceServers });
  const stream = new MediaStream();
  const pendingCandidates = video.earlyCandidates.get(socketId) || [];
  video.earlyCandidates.delete(socketId);
  const peer = { pc, stream, userId, pendingCandidates, tile: null };
  video.peers.set(socketId, peer);

  peer.tile = makeTile(socketId, userById(userId).name, stream, false);
  updateTilePlaceholder(peer.tile, stream, userById(userId));

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('video:signal', { to: socketId, candidate: e.candidate });
  };
  pc.ontrack = (e) => {
    console.log(`[video] ${userById(userId).name}: receiving ${e.track.kind}`);
    // A fresh stream object makes every browser (notably Safari) pick up all tracks;
    // adding a track to a stream that's already playing can leave it silent.
    peer.stream = new MediaStream([...peer.stream.getTracks().filter((t) => t.kind !== e.track.kind), e.track]);
    const refresh = () => updateTilePlaceholder(peer.tile, peer.stream, userById(userId));
    e.track.onmute = refresh;
    e.track.onunmute = refresh;
    e.track.onended = refresh;
    refresh();
    peer.tile.querySelector('video').srcObject = peer.stream;
    playRemote(peer);
  };
  pc.onconnectionstatechange = () => {
    console.log(`[video] ${userById(userId).name}: ${pc.connectionState}`);
    peer.tile.classList.toggle('connecting', pc.connectionState !== 'connected' && pc.connectionState !== 'failed');
    peer.tile.classList.toggle('failed', pc.connectionState === 'failed');
  };
  peer.tile.classList.add('connecting');
  return peer;
}

// Browsers may refuse to autoplay video with sound; then we ask for a click.
function playRemote(peer) {
  peer.tile
    .querySelector('video')
    .play()
    .then(() => peer.tile.classList.remove('needs-click'))
    .catch((err) => {
      // AbortError just means a newer srcObject replaced this one; only NotAllowedError is a real block.
      if (err.name !== 'NotAllowedError') return;
      console.warn('[video] autoplay blocked');
      peer.tile.classList.add('needs-click');
    });
}

function playAllRemote() {
  for (const peer of video.peers.values()) playRemote(peer);
}

// Live level bar on our own tile, so you can see the mic is picking you up.
function startMicMeter(tile) {
  const track = video.localStream && video.localStream.getAudioTracks()[0];
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!track || !Ctx) return;
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const fill = el('span');
  tile.append(el('div', { class: 'mic-meter', title: 'Microphone level' }, fill));
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    fill.style.width = Math.min(100, (peak / 48) * 100) + '%';
    video.meterFrame = requestAnimationFrame(tick);
  };
  tick();
  video.audioCtx = ctx;
}

function stopMicMeter() {
  cancelAnimationFrame(video.meterFrame);
  if (video.audioCtx) video.audioCtx.close().catch(() => {});
  video.audioCtx = null;
}

// Shows, on each remote tile, whether their audio actually reaches us. If the bar moves
// but you hear nothing, the problem is local playback (volume, output device, autoplay).
function startAudioMonitor() {
  video.levelTimer = setInterval(() => {
    for (const peer of video.peers.values()) {
      const receiver = peer.pc.getReceivers().find((r) => r.track && r.track.kind === 'audio');
      const src = receiver && receiver.getSynchronizationSources ? receiver.getSynchronizationSources()[0] : null;
      const level = src && typeof src.audioLevel === 'number' ? src.audioLevel : 0;
      peer.tile.querySelector('.audio-meter span').style.width = Math.min(100, Math.sqrt(level) * 140) + '%';
    }
  }, 150);
  video.statsTimer = setInterval(async () => {
    for (const peer of video.peers.values()) {
      if (peer.pc.connectionState !== 'connected') continue;
      let bytes = 0;
      (await peer.pc.getStats()).forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') bytes += r.bytesReceived || 0;
      });
      const flowing = bytes > (peer.audioBytes || 0);
      peer.audioBytes = bytes;
      peer.tile.classList.toggle('no-audio', !flowing);
    }
  }, 2000);
}

function stopAudioMonitor() {
  clearInterval(video.levelTimer);
  clearInterval(video.statsTimer);
}

// Tell the user plainly when others can't hear or see them.
function updateMediaNotice() {
  const s = video.localStream;
  const audio = s && s.getAudioTracks().find((t) => t.readyState === 'live');
  const cam = s && s.getVideoTracks().find((t) => t.readyState === 'live');
  let msg = '';
  if (!audio && !cam) {
    msg = "Your camera and microphone aren't available, so others can't see or hear you. " +
      "Allow them in the browser's site settings (the icon left of the address), then leave and rejoin.";
  } else if (!audio) {
    msg = "Your microphone isn't available, so others can't hear you. Allow the microphone in the " +
      "browser's site settings and close other apps using it (Zoom, Teams, Discord), then leave and rejoin.";
  } else if (!audio.enabled) {
    msg = 'Your microphone is muted. Others can\'t hear you.';
  } else if (!cam) {
    msg = "Your camera isn't available, so others can hear you but not see you.";
  }
  $('video-notice').textContent = msg;
  $('video-notice').classList.toggle('hidden', !msg);
}

function addLocalTracks(pc, asOfferer) {
  const tracks = video.localStream ? video.localStream.getTracks() : [];
  for (const t of tracks) pc.addTrack(t, video.localStream);
  if (asOfferer) {
    // Always negotiate both kinds so we can receive even without a camera/mic.
    for (const kind of ['audio', 'video']) {
      if (!tracks.some((t) => t.kind === kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
    }
  }
}

async function flushCandidates(peer) {
  for (const c of peer.pendingCandidates.splice(0)) {
    try {
      await peer.pc.addIceCandidate(c);
    } catch (err) {
      console.warn('ICE candidate failed', err);
    }
  }
}

// We just joined: call everyone already in the room.
socket.on('video:peers', async (list) => {
  for (const { socketId, userId } of list) {
    if (socketId === socket.id) continue;
    const peer = createPeer(socketId, userId);
    addLocalTracks(peer.pc, true);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    socket.emit('video:signal', { to: socketId, description: peer.pc.localDescription });
  }
});

socket.on('video:signal', async ({ from, userId, description, candidate }) => {
  if (!video.joined) return;
  let peer = video.peers.get(from);
  try {
    if (description) {
      if (description.type === 'offer') {
        if (!peer) peer = createPeer(from, userId);
        await peer.pc.setRemoteDescription(description);
        // Adding tracks after the offer reuses the offered transceivers.
        addLocalTracks(peer.pc, false);
        await flushCandidates(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        socket.emit('video:signal', { to: from, description: peer.pc.localDescription });
      } else if (description.type === 'answer' && peer) {
        await peer.pc.setRemoteDescription(description);
        await flushCandidates(peer);
      }
    } else if (candidate) {
      if (!peer) {
        if (!video.earlyCandidates.has(from)) video.earlyCandidates.set(from, []);
        video.earlyCandidates.get(from).push(candidate);
      } else if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
      else peer.pendingCandidates.push(candidate);
    }
  } catch (err) {
    console.error('Signaling error', err);
  }
});

socket.on('video:peer-left', ({ socketId }) => removePeer(socketId));

function removePeer(socketId) {
  const peer = video.peers.get(socketId);
  if (!peer) return;
  peer.pc.close();
  peer.tile.remove();
  video.peers.delete(socketId);
  video.earlyCandidates.delete(socketId);
  layoutGrid();
}

function updateControls() {
  const s = video.localStream;
  const audio = s ? s.getAudioTracks()[0] : null;
  const cam = s ? s.getVideoTracks()[0] : null;
  $('toggle-mic').disabled = !audio;
  $('toggle-cam').disabled = !cam;
  $('toggle-mic').textContent = audio && !audio.enabled ? 'Unmute mic' : 'Mute mic';
  $('toggle-mic').classList.toggle('off', !!audio && !audio.enabled);
  $('toggle-cam').textContent = cam && !cam.enabled ? 'Turn camera on' : 'Turn camera off';
  $('toggle-cam').classList.toggle('off', !!cam && !cam.enabled);
  updateMediaNotice();
}

async function joinVideo() {
  if (video.joined || video.joining) return;
  video.joining = true;
  $('video-error').textContent = '';
  $('join-video').disabled = true;
  try {
    await getIceServers();
    video.localStream = await getLocalMedia();
    if (video.localStream) {
      // e.g. a USB mic unplugged mid-call
      for (const t of video.localStream.getTracks()) t.addEventListener('ended', updateControls);
    }
    video.joined = true;
    $('video-idle').classList.add('hidden');
    $('video-live').classList.remove('hidden');
    const local = makeTile('local', userById(me.id).name + ' (you)', video.localStream, true);
    updateTilePlaceholder(local, video.localStream, userById(me.id));
    startMicMeter(local);
    startAudioMonitor();
    updateControls();
    socket.emit('video:join');
  } catch (err) {
    $('video-error').textContent = err.message;
  } finally {
    video.joining = false;
    $('join-video').disabled = false;
  }
}

function leaveVideo() {
  if (!video.joined) return;
  socket.emit('video:leave');
  for (const id of [...video.peers.keys()]) removePeer(id);
  stopMicMeter();
  stopAudioMonitor();
  if (video.localStream) video.localStream.getTracks().forEach((t) => t.stop());
  video.localStream = null;
  video.joined = false;
  $('video-grid').replaceChildren();
  $('video-live').classList.add('hidden');
  $('video-idle').classList.remove('hidden');
  renderLists();
}

$('join-video').addEventListener('click', joinVideo);
$('leave-video').addEventListener('click', leaveVideo);

$('toggle-mic').addEventListener('click', () => {
  const t = video.localStream && video.localStream.getAudioTracks()[0];
  if (t) t.enabled = !t.enabled;
  updateControls();
});

$('toggle-cam').addEventListener('click', () => {
  const t = video.localStream && video.localStream.getVideoTracks()[0];
  if (t) t.enabled = !t.enabled;
  updateControls();
  const local = $('video-grid').querySelector('.tile.local');
  if (local) updateTilePlaceholder(local, video.localStream, userById(me.id));
});

window.addEventListener('beforeunload', () => {
  if (video.joined) socket.emit('video:leave');
});
