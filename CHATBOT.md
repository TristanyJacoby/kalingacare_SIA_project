# Kali chatbot — how it works and how to deploy

`js/chatbot.js` + `css/chatbot.css` add a floating assistant to every customer page
(not login/register/admin). The browser talks only to our own serverless function,
`api/chat.js`, which holds the Gemini API key (env var) and the system prompt.
No secret is ever in the repo or the browser.

## Deploy (Vercel, from `main`)
1. Create a free Vercel account → **Add New → Project** → import this GitHub repo → production branch `main`.
   Framework preset: **Other** (no build step, output = repo root).
2. Project → **Settings → Environment Variables** → add `GEMINI_API_KEY` (Production + Preview + Development).
   Get a free key at https://aistudio.google.com/apikey using a project with **no billing account**.
3. Redeploy. Then add the `*.vercel.app` domain to Firebase → Authentication → Settings → **Authorized domains**.

## Local testing
```
npm i -g vercel
echo 'GEMINI_API_KEY=your-key' > .env      # .env is gitignored
vercel dev                                  # serves the site + /api/chat on http://localhost:3000
```
(`python3 -m http.server` has no /api route, so the chatbot won't answer there.)

## Notes
- Models tried in order (`MODELS` in `api/chat.js`): on 503/429/404 it falls back to the next.
- Server checks: allowed origins, max 12 messages of 500 chars, catalogue ≤ 8000 chars, 20 requests/hour per IP (best effort).
- Free-tier prompts may be used by Google to improve products, so only the store FAQ + product catalogue are sent — no user data.
- Client limits: 30 messages per page load, 1.5s between messages.
- Mobile: point `CHAT_API_URL` at `https://<your-site>.vercel.app/api/chat` (origin `capacitor://localhost` is already allowed; Android may send `http://localhost` / `https://localhost`, also allowed).
- Debug: browser console shows `Chatbot error:`; Vercel dashboard → Logs shows server errors.
