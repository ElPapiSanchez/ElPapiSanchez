# Birthday Team Picker

A simple site for a birthday party: guests pick their name, spin a wheel, and see which team they are on (**Red**, **Green**, **Blue**, or **White**). Each name can only be claimed once, so nobody sees anyone else’s team.

## How it works

1. You define the guest list and pre-assign each person to a team in `config/people.json`.
2. Guests open the site on their phone, choose their name, and tap **Reveal my team**.
3. A spinning wheel animation plays, then their team is shown.
4. That name is removed from the list for everyone else.

Teams are **not** chosen at random during the party — they are set in the config file ahead of time. The wheel is just for fun.

## Quick start (local)

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Adding your guest list

Edit `config/people.json`. Each entry needs a `name` and `team`:

```json
[
  { "name": "Maria", "team": "Red" },
  { "name": "Chris", "team": "Green" }
]
```

Valid teams: `Red`, `Green`, `Blue`, `White`.

### Auto-balance teams

If you have a text file with one name per line (`names.txt`), run:

```bash
node scripts/assign-teams.js names.txt > config/people.json
```

This cycles names across the four teams as evenly as possible.

**First deploy:** the server seeds the database from `config/people.json` on first start.

**After guests have already claimed names:** updating `people.json` alone does not change the live database. To reload while keeping claims, set an admin key and call the reload endpoint (see below).

## Free hosting (Render)

1. Push this repo to GitHub.
2. Sign up at [render.com](https://render.com) and create a **Web Service** from the repo.
3. Render will pick up `render.yaml` (Node, `npm start`).
4. Share the `.onrender.com` URL with your guests.

> **Note:** On Render’s free plan, the app may sleep after inactivity; the first visit can take ~30 seconds to wake up.

## Optional: reload guest list after deploy

Set environment variable `ADMIN_RELOAD_KEY` to a secret string on your host, then:

```bash
curl -X POST https://your-app.onrender.com/api/admin/reload \
  -H "x-admin-key: YOUR_SECRET"
```

This re-imports `config/people.json` and keeps names that were already claimed.

## Project structure

```
config/people.json      ← guest list + team assignments (you edit this)
public/                 ← website UI
server.js               ← API + one-time name locking
data/                   ← SQLite (created automatically, not in git)
```

## When you send the name list

Reply with every guest’s name (and optionally how you want teams split). The list can be pasted in chat or as a `.txt` file (one name per line). I can fill in `config/people.json` for you and balance the four teams.
