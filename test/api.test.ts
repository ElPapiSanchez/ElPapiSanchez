import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, loadDataset, editRecurringFrom } from "../src/db.ts";
import { route } from "../src/api.ts";
import { personSummary, listMonths } from "../src/calc.ts";

const NOW = "2026-12";
const q = (o: Record<string, string> = {}) => new URLSearchParams(o);

test("seed: salários iniciais, subsídios gerados e tudo o resto vazio", () => {
  const db = openDb(":memory:", "2026-10");
  const ds = loadDataset(db);
  assert.equal(personSummary(ds, "francisco", "2026-10", "2026-10").income.regular, 118107);
  assert.equal(personSummary(ds, "carolina", "2026-10", "2026-10").income.regular, 124600);
  const xmas = ds.recurring.filter((r) => r.subtype === "christmas");
  assert.equal(xmas.length, 2);
  assert.ok(xmas.every((r) => r.startMonth === "2026-11"));
  assert.equal(ds.goal.targetCents, null);
  assert.equal(ds.openings.length, 0);
  assert.equal(ds.contributions.length + ds.lifestyle.length + ds.sharedExpenses.length, 0);
});

test("API: editar salário a partir de um mês mantém meses anteriores", () => {
  const db = openDb(":memory:", "2026-10");
  const sal = loadDataset(db).recurring.find((r) => r.owner === "francisco" && r.subtype === "salary")!;
  const startMonth = sal.startMonth;
  const next = route(db, "GET", "/api/meta", q(), {}, NOW) as any;
  assert.ok(next.now);
  const m2 = "2027-03";
  editRecurringFrom(db, sal.id, m2, { amountCents: 130000 });
  const ds = loadDataset(db);
  assert.equal(personSummary(ds, "francisco", startMonth, NOW).income.regular, 118107);
  assert.equal(personSummary(ds, "francisco", "2027-02", "2027-12").income.regular, 118107);
  assert.equal(personSummary(ds, "francisco", m2, "2027-12").income.regular, 130000);
  editRecurringFrom(db, sal.id, m2, { amountCents: 131000 });
  assert.equal(loadDataset(db).recurring.find((r) => r.id === sal.id)!.versions.length, 2, "mesmo mês substitui, não duplica");
});

test("API: fluxo de mês, contribuição, subsídio e validações", () => {
  const db = openDb(":memory:", "2026-10");
  const meta = route(db, "GET", "/api/meta", q(), {}, "2026-10") as any;
  const rest = meta.categories[0].id;
  const cars = meta.categories[2].id;
  route(db, "POST", "/api/recurring", q(), { type: "income", subtype: "meal", owner: "francisco", startMonth: "2026-10", name: "Cartão refeição", amountCents: 15000 }, "2026-10");
  route(db, "PUT", "/api/lifestyle", q(), { person: "francisco", month: "2026-10", categoryId: rest, amountCents: 6000, mealCents: 6000 }, "2026-10");
  assert.throws(() => route(db, "PUT", "/api/lifestyle", q(), { person: "francisco", month: "2026-10", categoryId: cars, amountCents: 1000, mealCents: 2000 }, "2026-10"));
  assert.throws(() => route(db, "PUT", "/api/contribution", q(), { person: "francisco", month: "2026-10", destinationId: 1, amountCents: 1.5 }, "2026-10"));
  route(db, "PUT", "/api/contribution", q(), { person: "francisco", month: "2026-10", destinationId: 1, amountCents: 20000 }, "2026-10");
  const d = route(db, "GET", "/api/month", q({ view: "francisco", month: "2026-10" }), {}, "2026-10") as any;
  assert.equal(d.summary.meal.remaining, 9000);
  assert.equal(d.summary.expenses.cash, 0);
  assert.equal(d.summary.remainingCash, 118107 - 20000);
  const t = route(db, "GET", "/api/month", q({ view: "together", month: "2026-10" }), {}, "2026-10") as any;
  assert.equal(t.summary.remainingCash, 118107 + 124600 - 20000);
  // contribuição a um mês futuro faz o mês aparecer
  route(db, "PUT", "/api/contribution", q(), { person: "carolina", month: "2027-02", destinationId: 2, amountCents: 5000 }, "2026-10");
  const months = route(db, "GET", "/api/months", q({ view: "carolina" }), {}, "2026-10") as any[];
  assert.deepEqual(months.map((x) => x.month), ["2026-10", "2027-02"]);
  assert.equal(listMonths(loadDataset(db), "carolina", "asc", "2026-10").length, 2);
});

test("API: ignorar subsídio de Natal só num ano; apagar categoria com dados é recusado", () => {
  const db = openDb(":memory:", "2026-10");
  const xmas = loadDataset(db).recurring.find((r) => r.owner === "carolina" && r.subtype === "christmas")!;
  route(db, "PUT", `/api/recurring/${xmas.id}/override`, q(), { month: "2027-11", skipped: true }, "2027-12");
  const ds = loadDataset(db);
  assert.equal(personSummary(ds, "carolina", "2026-11", "2027-12").income.additional, 124600);
  assert.equal(personSummary(ds, "carolina", "2027-11", "2027-12").income.additional, 0);
  route(db, "PUT", `/api/recurring/${xmas.id}/override`, q(), { month: "2027-11", skipped: false }, "2027-12");
  assert.equal(personSummary(loadDataset(db), "carolina", "2027-11", "2027-12").income.additional, 124600);
  const cat = loadDataset(db).categories[0].id;
  route(db, "PUT", "/api/lifestyle", q(), { person: "carolina", month: "2026-10", categoryId: cat, amountCents: 100, mealCents: 0 }, "2027-12");
  assert.throws(() => route(db, "DELETE", `/api/categories/${cat}`, q(), {}, "2027-12"), /registados/);
});

test("saldo inicial por pessoa conta para a meta sem criar meses", () => {
  const db = openDb(":memory:", "2026-10");
  route(db, "PUT", "/api/opening", q(), { person: "francisco", destinationId: 2, amountCents: 50000 }, "2026-10");
  route(db, "PUT", "/api/opening", q(), { person: "carolina", destinationId: 2, amountCents: 25000 }, "2026-10");
  route(db, "PUT", "/api/opening", q(), { person: "carolina", destinationId: 1, amountCents: 10000 }, "2026-10");
  route(db, "PUT", "/api/goal", q(), { targetMonth: "2027-09", targetCents: 1000000 }, "2026-10");
  route(db, "PUT", "/api/contribution", q(), { person: "francisco", month: "2026-10", destinationId: 2, amountCents: 10000 }, "2026-10");
  const goals = route(db, "GET", "/api/goals", q(), {}, "2026-10") as any[];
  const moving = goals.find((g) => g.isMoving);
  assert.equal(moving.savedCents, 85000);
  assert.deepEqual(moving.perPerson, { francisco: 60000, carolina: 25000 });
  assert.equal(goals.find((g) => g.destinationId === 1).savedCents, 10000);
  const months = route(db, "GET", "/api/months", q({ view: "together" }), {}, "2026-10") as any[];
  assert.deepEqual(months.map((m) => m.month), ["2026-10"]);
  const d = route(db, "GET", "/api/month", q({ view: "together", month: "2026-10" }), {}, "2026-10") as any;
  assert.equal(d.summary.savings, 10000, "o saldo inicial não é poupança do mês");
  route(db, "PUT", "/api/opening", q(), { person: "carolina", destinationId: 1, amountCents: 0 }, "2026-10");
  assert.equal(loadDataset(db).openings.length, 2);
});
