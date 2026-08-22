# MPC Cricket App

Full team/tournament/weekly-fixture management and ball-by-ball live scoring,
now as a standalone web app with login and cloud storage — free to host and
usable from any phone browser (Android or iOS), installable to the home
screen like an app.

Stack: **React + Vite** (frontend) · **Supabase** (login + database, free
tier) · **Vercel** (hosting, free tier).

Everyone who logs in shares the same data (one team's teams/matches/stats),
which matches how the app was being used already.

---

## 1. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project** (free tier).
2. Once it's created, open **SQL Editor** and run this once:

```sql
create table kv_store (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

alter table kv_store enable row level security;

create policy "Logged-in users can read" on kv_store
  for select using (auth.role() = 'authenticated');

create policy "Logged-in users can write" on kv_store
  for insert with check (auth.role() = 'authenticated');

create policy "Logged-in users can update" on kv_store
  for update using (auth.role() = 'authenticated');
```

3. (Recommended for a small trusted group) Go to **Authentication → Providers
   → Email** and turn **off "Confirm email"**. This lets people sign in
   right after signing up, without needing to click a confirmation email.
   Leave it on if you'd rather require email verification.
4. Go to **Project Settings → API**. Copy the **Project URL** and the
   **anon public key** — you'll need both in step 3 below.

### Keeping strangers off your sign-up page

The app has an **invite code** gate on sign-up: pick any word/phrase, put it
in `VITE_INVITE_CODE` (step 3, alongside the other env vars), and share it
only with your group. Anyone signing up has to type it correctly first.

Be aware this check happens in the browser, so someone determined enough
(digging through devtools) could find it — fine for keeping out randoms, not
for anything sensitive. For a harder lock, go to **Authentication →
Providers → Email** in Supabase and turn **off "Allow new users to sign
up"** entirely. Then invite people yourself from **Authentication → Users →
Invite user**, and skip the invite-code field.

## 2. Get the code onto GitHub

1. Create a new empty repository on [github.com](https://github.com).
2. From this folder, run:

```bash
git init
git add .
git commit -m "MPC Cricket App"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

## 3. Deploy on Vercel (free)

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import
   the GitHub repo you just pushed.
2. Vercel auto-detects Vite — leave the build settings as default
   (`npm run build`, output directory `dist`).
3. Before deploying, add three **Environment Variables**:
   - `VITE_SUPABASE_URL` → your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` → your Supabase anon public key
   - `VITE_INVITE_CODE` → the shared code your group will use to sign up (optional but recommended)
4. Click **Deploy**. In under a minute you'll get a live URL like
   `https://your-app.vercel.app` — free, HTTPS, no expiry.

## 4. Use it on your phone (Android & iOS)

Open the Vercel URL in your phone's browser.

- **Android (Chrome):** tap the **⋮** menu → **Add to Home screen** / **Install app**.
- **iOS (Safari):** tap the **Share** icon → **Add to Home Screen**.

It'll behave like a normal app — full screen, its own icon — without ever
going through an app store (which isn't free for iOS).

## 5. First login

Open the app, tap **Need an account? Sign up**, enter an email + password
for each person who should have access. Everyone who signs in sees and edits
the same shared data — teams, matches, weekly fixtures, and stats.

---

## Local development (optional)

```bash
npm install
cp .env.example .env   # then fill in your Supabase URL + anon key
npm run dev
```

## Notes

- This project keeps the exact same cricket scoring logic as before
  (`src/CricketApp.jsx`) — only the storage layer changed, from Claude's
  artifact `window.storage` to a Supabase table (`src/storage.js`).
- Styling uses the Tailwind CDN script (in `index.html`) rather than a full
  Tailwind build step, to keep the project simple to deploy.
- To add more people later, just have them sign up from the login screen —
  no extra configuration needed.
- This wasn't tested against a live Supabase/Vercel deployment from this
  environment (no network access here), so if something doesn't line up,
  check the browser console for errors first — most issues are a missing/typo'd
  environment variable.
