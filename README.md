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

Open `http://localhost:4444`. On first visit you are sent to the **Create user** page
(name + avatar). Your identity is stored in the browser's localStorage.

## Main page

- **In the app**: everyone with the main page open right now.
- **In video chat**: everyone currently in the call.
- **Video chat**: you see and hear nothing until you click **Connect to video chat**.
  Several people can join. You get mic/camera toggles and a Leave button.
- **Chat**: text messages, plus photos (📷 button). Anything typed in the box is sent
  as the photo's caption. Click a photo to open it full size, or use the download link.

## Deployment

- **Hosting:** DigitalOcean.
- **Domain:** registered through Cloudflare.

## Configuration (environment variables)

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `4444`) |
| `ACCESS_PASSWORD` | If set, the whole app is locked behind this shared password |
| `SSL_KEY`, `SSL_CERT` | Paths to a key and certificate to serve over HTTPS |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN server for peers behind strict NATs |

Example: `ACCESS_PASSWORD=letmein PORT=8080 npm start`

## Notes

- **HTTPS is required** for camera and microphone access everywhere except `localhost`.
  To use the app across devices, set `SSL_KEY`/`SSL_CERT` or put it behind a reverse proxy
  with TLS (Caddy, nginx, Cloudflare Tunnel, etc.).
- Video is peer-to-peer (WebRTC mesh); the server only relays signaling. That works well
  for small groups (about 6 people). Some networks need a TURN server to connect.
- Data (users, last 500 messages, uploaded images) is stored in `data/`.
