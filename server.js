const express = require("express");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const PORT = process.env.PORT || 3000;
const PEOPLE_PATH = path.join(__dirname, "config", "people.json");
const DB_PATH = path.join(__dirname, "data", "assignments.db");
const VALID_TEAMS = new Set(["Red", "Green", "Blue", "White"]);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS guests (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    team TEXT NOT NULL,
    claimed_at TEXT
  )
`);

function loadPeopleFromConfig() {
  if (!fs.existsSync(PEOPLE_PATH)) {
    throw new Error(`Missing ${PEOPLE_PATH}. Copy config/people.example.json to config/people.json`);
  }
  const people = JSON.parse(fs.readFileSync(PEOPLE_PATH, "utf8"));
  if (!Array.isArray(people) || people.length === 0) {
    throw new Error("config/people.json must be a non-empty array");
  }
  for (const { name, team } of people) {
    if (!name || typeof name !== "string") {
      throw new Error("Each guest must have a name");
    }
    if (!VALID_TEAMS.has(team)) {
      throw new Error(`Invalid team "${team}" for ${name}. Use Red, Green, Blue, or White.`);
    }
  }
  return people;
}

function seedDatabaseIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM guests").get().n;
  if (count > 0) return;

  const people = loadPeopleFromConfig();
  const insert = db.prepare(
    "INSERT INTO guests (name, team, claimed_at) VALUES (?, ?, NULL)"
  );
  const seed = db.transaction((rows) => {
    for (const { name, team } of rows) {
      insert.run(name.trim(), team);
    }
  });
  seed(people);
  console.log(`Seeded ${people.length} guests from config/people.json`);
}

function reloadFromConfig() {
  const people = loadPeopleFromConfig();
  const existing = db.prepare("SELECT name, claimed_at FROM guests").all();
  const claimed = new Map(
    existing.filter((r) => r.claimed_at).map((r) => [r.name.toLowerCase(), r.claimed_at])
  );

  db.exec("DELETE FROM guests");
  const insert = db.prepare(
    "INSERT INTO guests (name, team, claimed_at) VALUES (?, ?, ?)"
  );
  const reload = db.transaction((rows) => {
    for (const { name, team } of rows) {
      const key = name.trim().toLowerCase();
      insert.run(name.trim(), team, claimed.get(key) ?? null);
    }
  });
  reload(people);
}

seedDatabaseIfEmpty();

app.get("/api/names", (_req, res) => {
  const rows = db
    .prepare(
      "SELECT name FROM guests WHERE claimed_at IS NULL ORDER BY name COLLATE NOCASE"
    )
    .all();
  res.json({ names: rows.map((r) => r.name) });
});

app.post("/api/claim", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    return res.status(400).json({ error: "Please select a name." });
  }

  const guest = db
    .prepare("SELECT name, team, claimed_at FROM guests WHERE name = ? COLLATE NOCASE")
    .get(name);

  if (!guest) {
    return res.status(404).json({ error: "That name is not on the guest list." });
  }

  if (guest.claimed_at) {
    return res.status(409).json({
      error: "This name has already been picked. Please choose another.",
    });
  }

  const claimedAt = new Date().toISOString();
  db.prepare("UPDATE guests SET claimed_at = ? WHERE name = ? COLLATE NOCASE").run(
    claimedAt,
    guest.name
  );

  res.json({ name: guest.name, team: guest.team });
});

app.get("/api/stats", (_req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS n FROM guests").get().n;
  const claimed = db
    .prepare("SELECT COUNT(*) AS n FROM guests WHERE claimed_at IS NOT NULL")
    .get().n;
  res.json({ total, claimed, remaining: total - claimed });
});

if (process.env.ADMIN_RELOAD_KEY) {
  app.post("/api/admin/reload", (req, res) => {
    const key = req.headers["x-admin-key"];
    if (key !== process.env.ADMIN_RELOAD_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      reloadFromConfig();
      res.json({ ok: true, message: "Guest list reloaded; existing claims preserved." });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Birthday team picker running at http://localhost:${PORT}`);
});
