import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type Dataset, type Recurring, type RuleVersion, type Owner, type Person, type IncomeSubtype, emptyDataset,
} from "./calc.ts";
import { type Month, addMonths, currentMonth, isMonth, parseMonth } from "./util.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  subtype TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('francisco','carolina','together')),
  start_month TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recurring_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
  from_month TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  interval_months INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  payer TEXT NOT NULL DEFAULT 'account',
  split_francisco INTEGER,
  UNIQUE (item_id, from_month)
);
CREATE TABLE IF NOT EXISTS recurring_overrides (
  item_id INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  skipped INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER,
  PRIMARY KEY (item_id, month)
);
CREATE TABLE IF NOT EXISTS income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL, month TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other', amount_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, meal_eligible INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lifestyle (
  person TEXT NOT NULL, month TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  amount_cents INTEGER NOT NULL DEFAULT 0, meal_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person, month, category_id)
);
CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('saving','investment')),
  name TEXT NOT NULL, is_moving INTEGER NOT NULL DEFAULT 0,
  target_cents INTEGER, starting_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL, month TEXT NOT NULL,
  destination_id INTEGER NOT NULL REFERENCES destinations(id),
  amount_cents INTEGER NOT NULL,
  UNIQUE (person, month, destination_id)
);
CREATE TABLE IF NOT EXISTS shared_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL, payer TEXT NOT NULL DEFAULT 'account', split_francisco INTEGER
);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL, from_person TEXT NOT NULL, to_person TEXT NOT NULL, amount_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS limits (
  person TEXT NOT NULL, category_id INTEGER NOT NULL, limit_cents INTEGER NOT NULL,
  PRIMARY KEY (person, category_id)
);
CREATE TABLE IF NOT EXISTS plans (
  person TEXT NOT NULL, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  PRIMARY KEY (person, kind)
);
`;

export type DB = DatabaseSync;

export function openDb(file: string, now: Month = currentMonth()): DB {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  seedIfEmpty(db, now);
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function insertRecurring(
  db: DB,
  r: { type: "income" | "expense"; subtype: IncomeSubtype | "expense"; owner: Owner; startMonth: Month } & Omit<RuleVersion, "fromMonth">,
): number {
  return tx(db, () => {
    const res = db
      .prepare("INSERT INTO recurring (type, subtype, owner, start_month) VALUES (?,?,?,?)")
      .run(r.type, r.subtype, r.owner, r.startMonth);
    const id = Number(res.lastInsertRowid);
    upsertVersion(db, id, { ...r, fromMonth: r.startMonth });
    return id;
  });
}

export function upsertVersion(db: DB, itemId: number, v: RuleVersion): void {
  db.prepare(
    `INSERT INTO recurring_versions (item_id, from_month, name, category, amount_cents, interval_months, active, payer, split_francisco)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (item_id, from_month) DO UPDATE SET name=excluded.name, category=excluded.category,
       amount_cents=excluded.amount_cents, interval_months=excluded.interval_months, active=excluded.active,
       payer=excluded.payer, split_francisco=excluded.split_francisco`,
  ).run(itemId, v.fromMonth, v.name, v.category, v.amountCents, v.intervalMonths, v.active ? 1 : 0, v.payer, v.splitFrancisco);
}

/** Altera uma regra a partir de `fromMonth` (inclusive). Os meses anteriores mantêm a versão antiga. */
export function editRecurringFrom(db: DB, itemId: number, fromMonth: Month, patch: Partial<Omit<RuleVersion, "fromMonth">>): void {
  tx(db, () => {
    const item = db.prepare("SELECT start_month FROM recurring WHERE id = ?").get(itemId) as { start_month: string } | undefined;
    if (!item) throw new Error("Regra não encontrada");
    const cur = db
      .prepare("SELECT * FROM recurring_versions WHERE item_id = ? AND from_month <= ? ORDER BY from_month DESC LIMIT 1")
      .get(itemId, fromMonth) as Record<string, unknown> | undefined;
    const base = cur ?? (db.prepare("SELECT * FROM recurring_versions WHERE item_id = ? ORDER BY from_month LIMIT 1").get(itemId) as Record<string, unknown>);
    const merged: RuleVersion = {
      fromMonth,
      name: String(base.name), category: String(base.category), amountCents: Number(base.amount_cents),
      intervalMonths: Number(base.interval_months), active: base.active === 1,
      payer: base.payer as RuleVersion["payer"],
      splitFrancisco: base.split_francisco === null ? null : Number(base.split_francisco),
      ...patch,
    };
    upsertVersion(db, itemId, merged);
  });
}

export function setOverride(db: DB, itemId: number, month: Month, skipped: boolean, amountCents: number | null): void {
  if (!skipped && amountCents === null) {
    db.prepare("DELETE FROM recurring_overrides WHERE item_id = ? AND month = ?").run(itemId, month);
    return;
  }
  db.prepare(
    `INSERT INTO recurring_overrides (item_id, month, skipped, amount_cents) VALUES (?,?,?,?)
     ON CONFLICT (item_id, month) DO UPDATE SET skipped=excluded.skipped, amount_cents=excluded.amount_cents`,
  ).run(itemId, month, skipped ? 1 : 0, amountCents);
}

export function getSetting(db: DB, key: string): string | null {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string | null): void {
  if (value === null) db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  else db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value").run(key, value);
}

type Row = Record<string, any>;

export function loadDataset(db: DB): Dataset {
  const ds = emptyDataset();
  const versions = db.prepare("SELECT * FROM recurring_versions ORDER BY from_month").all() as Row[];
  const overrides = db.prepare("SELECT * FROM recurring_overrides").all() as Row[];
  for (const r of db.prepare("SELECT * FROM recurring ORDER BY id").all() as Row[]) {
    const item: Recurring = {
      id: r.id, type: r.type, subtype: r.subtype, owner: r.owner, startMonth: r.start_month,
      versions: versions.filter((v) => v.item_id === r.id).map((v) => ({
        fromMonth: v.from_month, name: v.name, category: v.category, amountCents: v.amount_cents,
        intervalMonths: v.interval_months, active: v.active === 1, payer: v.payer, splitFrancisco: v.split_francisco,
      })),
      overrides: overrides.filter((o) => o.item_id === r.id).map((o) => ({
        month: o.month, skipped: o.skipped === 1, amountCents: o.amount_cents,
      })),
    };
    ds.recurring.push(item);
  }
  ds.incomeEntries = (db.prepare("SELECT * FROM income_entries ORDER BY id").all() as Row[]).map((r) => ({
    id: r.id, person: r.person, month: r.month, name: r.name, kind: r.kind, amountCents: r.amount_cents,
  }));
  ds.categories = (db.prepare("SELECT * FROM categories ORDER BY sort, id").all() as Row[]).map((r) => ({
    id: r.id, name: r.name, mealEligible: r.meal_eligible === 1, sort: r.sort,
  }));
  ds.lifestyle = (db.prepare("SELECT * FROM lifestyle").all() as Row[]).map((r) => ({
    person: r.person, month: r.month, categoryId: r.category_id, amountCents: r.amount_cents, mealCents: r.meal_cents,
  }));
  ds.destinations = (db.prepare("SELECT * FROM destinations ORDER BY id").all() as Row[]).map((r) => ({
    id: r.id, kind: r.kind, name: r.name, isMoving: r.is_moving === 1, targetCents: r.target_cents, startingCents: r.starting_cents,
  }));
  ds.contributions = (db.prepare("SELECT * FROM contributions ORDER BY id").all() as Row[]).map((r) => ({
    id: r.id, person: r.person, month: r.month, destinationId: r.destination_id, amountCents: r.amount_cents,
  }));
  ds.sharedExpenses = (db.prepare("SELECT * FROM shared_expenses ORDER BY id").all() as Row[]).map((r) => ({
    id: r.id, month: r.month, name: r.name, category: r.category, amountCents: r.amount_cents, payer: r.payer, splitFrancisco: r.split_francisco,
  }));
  ds.settlements = (db.prepare("SELECT * FROM settlements ORDER BY id").all() as Row[]).map((r) => ({
    id: r.id, month: r.month, from: r.from_person, to: r.to_person, amountCents: r.amount_cents,
  }));
  ds.limits = (db.prepare("SELECT * FROM limits").all() as Row[]).map((r) => ({
    person: r.person, categoryId: r.category_id, limitCents: r.limit_cents,
  }));
  ds.plans = (db.prepare("SELECT * FROM plans").all() as Row[]).map((r) => ({
    person: r.person, kind: r.kind, amountCents: r.amount_cents,
  }));
  const tm = getSetting(db, "goal_month");
  const tc = getSetting(db, "goal_target_cents");
  ds.goal = { targetMonth: tm && isMonth(tm) ? tm : "2027-09", targetCents: tc === null ? null : Number(tc) };
  return ds;
}

const DEFAULT_CATEGORIES: [string, boolean][] = [
  ["Restaurantes e cafés", true], ["Mercearia", true], ["Férias e viagens", false], ["Desporto e fitness", false],
  ["Despesas do dia-a-dia", false], ["Prendas de aniversário", false], ["Compras", false], ["Outras despesas de estilo de vida", false],
];

const DEFAULT_DESTINATIONS: [string, "saving" | "investment", boolean][] = [
  ["Poupança geral", "saving", false], ["Fundo da mudança", "saving", true],
  ["ETF S&P 500 (VUAA)", "investment", false], ["Outros ETFs", "investment", false],
  ["Ações", "investment", false], ["Outros investimentos", "investment", false],
];

export const INITIAL_SALARY: Record<Person, number> = { francisco: 118107, carolina: 124600 };

/** Próximo mês `mo` (1-12) que seja >= `from`. */
export function nextMonthOfYear(from: Month, mo: number): Month {
  const { y, mo: cur } = parseMonth(from);
  return `${y + (cur > mo ? 1 : 0)}-${String(mo).padStart(2, "0")}`;
}

export function seedIfEmpty(db: DB, now: Month = currentMonth()): void {
  if (getSetting(db, "seeded")) return;
  tx(db, () => {
    DEFAULT_CATEGORIES.forEach(([name, eligible], i) =>
      db.prepare("INSERT INTO categories (name, meal_eligible, sort) VALUES (?,?,?)").run(name, eligible ? 1 : 0, i));
    for (const [name, kind, moving] of DEFAULT_DESTINATIONS)
      db.prepare("INSERT INTO destinations (kind, name, is_moving) VALUES (?,?,?)").run(kind, name, moving ? 1 : 0);
    for (const person of ["francisco", "carolina"] as Person[]) {
      const salary = INITIAL_SALARY[person];
      const base = { type: "income" as const, owner: person, category: "", intervalMonths: 1, active: true, payer: "account" as const, splitFrancisco: null };
      insertRecurring(db, { ...base, subtype: "salary", name: "Salário", amountCents: salary, startMonth: now });
      insertRecurring(db, { ...base, subtype: "holiday", name: "Subsídio de férias", amountCents: salary, intervalMonths: 12, startMonth: nextMonthOfYear(now, 6) });
      insertRecurring(db, { ...base, subtype: "christmas", name: "Subsídio de Natal", amountCents: salary, intervalMonths: 12, startMonth: nextMonthOfYear(now, 11) });
    }
    setSetting(db, "goal_month", addMonths("2027-09", 0));
    setSetting(db, "seeded", "1");
  });
}
