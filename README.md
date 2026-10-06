# Field Notes — Internship Tracker

Private, mobile-first attendance and work records hosted on Vercel with Supabase Postgres.

## Configuration

This project reads a local `.env` file; it is ignored by Git. Supabase credentials already present there can be used as individual values (`host`, `port`, `database`, `user`, `SUPABASE_DATABASE_PASSWORD`). For Vercel, use one environment variable instead:

`TRACKER_API_TOKEN` is required. It is the private website access key and the credential your iPhone sends. Do not use the database password for it.

## Local run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000` and enter `TRACKER_API_TOKEN` once when prompted. On first connection, the app creates its three tables and the work-log index in your Supabase project.

## Deploy to Vercel

1. Commit the project to a private GitHub repository, excluding `.env`.
2. In Supabase Dashboard → **Connect**, copy the **Transaction pooler** URI. It uses port `6543`; this is appropriate for Vercel’s serverless functions.
3. Import the GitHub repository in Vercel. In **Settings → Environment Variables**, add `DATABASE_URL` and `TRACKER_API_TOKEN` for Production, Preview, and Development. Never set these with a `NEXT_PUBLIC_` prefix.
4. Deploy. Vercel detects the FastAPI `app` exported from [`app/main.py`](app/main.py) and routes the whole application automatically.
5. Visit your production URL once; the database schema is created automatically. Enter the access key in the website when prompted.

## iPhone 17 automation

1. In **Shortcuts**, make **Office check in**. Add **Get Contents of URL**:
   - URL: `https://intern-pb.vercel.app/api/attendance/check-in`
   - Method: `POST`
   - Request Body: JSON → `source` = `ios_shortcut`
   - Header: `Authorization` = `Bearer YOUR_TRACKER_API_TOKEN`
2. Duplicate it as **Office check out** and change the URL to `/api/attendance/check-out`.
3. Go to **Automation** → **+** → **Arrive**, choose your office, then add **Run Shortcut** → _Office check in_. Create the reciprocal **Leave** automation using _Office check out_.
4. Test both shortcuts manually before relying on location automation. Use the manual dashboard controls when iOS delays a location trigger or there is no connection.
5. Open the deployed site in Safari → Share → **Add to Home Screen** for an app-like launcher.

The check-in and check-out routes are idempotent: retries cannot create duplicate attendance events. The server records the timestamp, rather than trusting the phone clock.
