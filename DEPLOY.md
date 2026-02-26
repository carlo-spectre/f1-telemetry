# Deploy F1 Race Replay (web version)

## 1. Push to GitHub

If you haven’t already:

```bash
cd /path/to/f1-race-replay-main
git init
git add .
git commit -m "Initial commit: F1 race replay desktop + web"
```

Create a **new repository** on GitHub (e.g. `f1-race-replay`):

- Go to [github.com/new](https://github.com/new)
- Name it e.g. `f1-race-replay`, leave it empty (no README/license)
- Then run (replace `carlo-spectre` and repo name if different):

```bash
git remote add origin https://github.com/carlo-spectre/f1-race-replay.git
git branch -M main
git push -u origin main
```

Or with GitHub CLI:

```bash
gh repo create f1-race-replay --public --source=. --remote=origin --push
```

---

## 2. Deploy to Railway (recommended – one URL for app + API)

The web app needs a Python server. Railway runs it and gives you a public URL.

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. **New Project** → **Deploy from GitHub repo** → choose `f1-race-replay` (or your repo name).
3. Railway will detect Python and use the `Procfile`. No extra config needed.
4. After deploy, open **Settings** → **Networking** → **Generate Domain** to get a URL like `https://your-app.up.railway.app`.
5. Open that URL: you get the session picker and replay. The first time you load a race, the server will fetch/cache data (may take a minute).

**Note:** Free tier may sleep after inactivity; the first request after that can be slow.

---

## 3. Optional: Frontend on Vercel

If you want the UI on Vercel and the API elsewhere:

- Deploy the **backend** to Railway (as above) and note the URL (e.g. `https://f1-replay-api.up.railway.app`).
- In the frontend, set the API base URL (e.g. in `web/app.js` use that origin for `fetch(...)`).
- Deploy the **frontend** to Vercel: connect the same repo, set **Root Directory** to `web`, **Build Command** leave empty, **Output Directory** `.` (or leave default). Add an env var for the API URL if you inject it at build time.

For the simplest “one URL” experience, using only Railway (step 2) is enough.
