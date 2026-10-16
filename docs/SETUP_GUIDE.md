# Setup guide: Twilio, HTTPS testing and deployment

## 1. Twilio (SMS + WhatsApp)

1. Create a free account at twilio.com and verify your own phone number.
2. In the Twilio Console, copy the **Account SID** and **Auth Token**
   (Account > API keys & tokens).
3. **SMS:** Console > Phone Numbers > get a trial number. Put it in
   `TWILIO_PHONE`. Trial accounts can only text numbers you have verified
   under Verified Caller IDs. Delivery to some countries (including India) can
   be blocked or filtered; the Alerts screen shows the exact error per contact.
4. **WhatsApp (easiest for a demo):** Console > Messaging > Try it out > Send a
   WhatsApp message. Each contact must send the displayed `join <two-words>`
   message to the sandbox number (+1 415 523 8886) from their own WhatsApp.
   The sandbox only delivers free-form messages for 24 hours after the contact's
   last message to the sandbox, so re-send "join ..." before a demo.
5. Put the values in `backend/.env`, restart the backend, add yourself as a
   contact (with country code) and press **Send test alert**.
6. Open the **Alerts** tab: every contact shows `sent`, `simulated` or
   `failed: <reason>` for SMS and WhatsApp.

Production WhatsApp (messaging people who never opted in) needs a Meta business
approval and message templates. The sandbox is for demos only.

## 2. Testing GPS, motion sensors and Bluetooth (needs HTTPS)

Browsers only allow GPS, motion sensors and Bluetooth on `https://` pages (and
on `localhost`). To use them on your phone, put an HTTPS tunnel in front of the
Vite dev server:

```bash
# terminal 1: backend
cd backend && uvicorn main:app --reload

# terminal 2: frontend
cd frontend && npm run dev

# terminal 3: tunnel (either one)
ngrok http 5173
cloudflared tunnel --url http://localhost:5173
```

Open the `https://...` address the tunnel prints on your phone. Vite forwards
`/api` to the backend, so one tunnel is enough.

Then: Home > **Real sensors** toggle (allow motion access on iPhone), allow
location, optionally **Connect heart-rate band** (Chrome on Android or desktop;
iPhone Safari does not support Web Bluetooth). Shake the phone to trigger the
model.

Heart rate needs a band that exposes the standard Bluetooth Heart Rate service
(most chest straps do; many smartwatches do not unless set to broadcast heart
rate). Without a band, use the manual slider.

## 3. Deploy (one server: Render + Docker)

The backend serves the built frontend, so a single service gives you HTTPS,
no CORS setup and one URL.

1. Push the repo to GitHub (make sure `frontend/package.json` and
   `frontend/package-lock.json` are committed).
2. On render.com: New > Blueprint > pick the repo. It reads `render.yaml`.
3. Fill in the Twilio variables when asked. `SECRET_KEY` is generated for you.
4. Wait for the build, then open the `https://...onrender.com` URL.

Free-tier notes:
- The service sleeps after inactivity (first request takes ~30-60 seconds).
- The disk is temporary: accounts, contacts and alert history in SQLite are
  lost on each redeploy or restart. Fine for a demo. For persistence, attach a
  paid persistent disk and set `DB_PATH=/data/safeguard.db`, or move to
  PostgreSQL.
- Railway and Fly.io also work with the same Dockerfile.

## 4. Security checklist before sharing the link

- `SECRET_KEY` set (production refuses to start without it)
- `.env` never committed (check `git status`)
- Twilio token only in environment variables
- Use test numbers/contacts while demoing; delete real data afterwards
