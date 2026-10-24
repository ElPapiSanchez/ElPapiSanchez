import {
  type Dataset, type Person, type Owner, type View, type RuleVersion, PEOPLE,
  balanceOwed, forecast, goalProgress, listMonths, monthSummary, occurrences, personSummary, sharedLines,
  effectiveVersion, proportionalBps, salaryOf,
} from "./calc.ts";
import {
  type DB, editRecurringFrom, insertRecurring, loadDataset, setOverride, setSetting, tx,
} from "./db.ts";
import { type Month, addMonths, currentMonth, isMonth } from "./util.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Body = Record<string, any>;

function bad(msg: string): never {
  throw new HttpError(400, msg);
}
const isPerson = (x: unknown): x is Person => x === "francisco" || x === "carolina";
const isOwner = (x: unknown): x is Owner => isPerson(x) || x === "together";

function person(x: unknown): Person {
  return isPerson(x) ? x : bad("Pessoa inválida");
}
function owner(x: unknown): Owner {
  return isOwner(x) ? x : bad("Titular inválido");
}
function month(x: unknown): Month {
  return isMonth(x) ? x : bad("Mês inválido (use AAAA-MM)");
}
function cents(x: unknown, allowNegative = false): number {
  if (typeof x !== "number" || !Number.isFinite(x) || !Number.isInteger(x)) bad("Valor inválido");
  if (!allowNegative && x < 0) bad("O valor não pode ser negativo");
  if (Math.abs(x) > 1e11) bad("Valor demasiado grande");
  return x;
}
function text(x: unknown, max = 120): string {
  if (typeof x !== "string" || x.trim() === "") bad("Nome obrigatório");
  return x.trim().slice(0, max);
}
function optText(x: unknown): string {
  return typeof x === "string" ? x.trim().slice(0, 120) : "";
}
function bps(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > 10000) bad("Percentagem inválida");
  return x;
}
function viewOf(x: unknown): View {
  return isOwner(x) ? x : bad("Vista inválida");
}
function payer(x: unknown): "account" | Person {
  return x === "account" || isPerson(x) ? (x as "account" | Person) : bad("Pagador inválido");
}
function id(x: unknown): number {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : bad("Id inválido");
}

export function monthDetail(ds: Dataset, view: View, m: Month, now: Month) {
  const persons: Person[] = view === "together" ? PEOPLE : [view];
  const summary = monthSummary(ds, view, m, now);
  const prev = monthSummary(ds, view, addMonths(m, -1), now);
  const occ = occurrences(ds, m);
  const incomeRecurring = occ.filter((o) => o.type === "income" && persons.includes(o.owner as Person));
  const expenseRecurring = occ.filter((o) => o.type === "expense" && (view === "together" || o.owner === view));
  const personalExpenses = expenseRecurring.filter((o) => o.owner !== "together");
  const sharedRecurring = expenseRecurring.filter((o) => o.owner === "together");

  const lifestyle: Record<string, any[]> = {};
  const contributions: Record<string, any[]> = {};
  const limitsByPerson: Record<string, { overall: number | null; used: number }> = {};
  const plan: Record<string, any> = {};
  for (const p of persons) {
    lifestyle[p] = ds.categories.map((c) => {
      const cur = ds.lifestyle.find((e) => e.person === p && e.month === m && e.categoryId === c.id);
      const prevE = ds.lifestyle.find((e) => e.person === p && e.month === addMonths(m, -1) && e.categoryId === c.id);
      const lim = ds.limits.find((l) => l.person === p && l.categoryId === c.id);
      return {
        categoryId: c.id, name: c.name, mealEligible: c.mealEligible,
        amountCents: cur?.amountCents ?? 0, mealCents: cur?.mealCents ?? 0,
        prevAmountCents: prevE?.amountCents ?? null, limitCents: lim?.limitCents ?? null,
      };
    });
    contributions[p] = ds.destinations.map((d) => ({
      destinationId: d.id, name: d.name, kind: d.kind, isMoving: d.isMoving,
      amountCents: ds.contributions.find((c) => c.person === p && c.month === m && c.destinationId === d.id)?.amountCents ?? 0,
    }));
    const s = personSummary(ds, p, m, now);
    limitsByPerson[p] = {
      overall: ds.limits.find((l) => l.person === p && l.categoryId === 0)?.limitCents ?? null,
      used: s.expenses.lifestyle,
    };
    const pl = (k: string) => ds.plans.find((x) => x.person === p && x.kind === k)?.amountCents ?? null;
    plan[p] = {
      lifestyle: { planned: pl("lifestyle"), actual: s.expenses.lifestyle },
      saving: { planned: pl("saving"), actual: s.savings },
      investment: { planned: pl("investment"), actual: s.investments },
    };
  }
  const lines = sharedLines(ds, m);
  return {
    view, month: m, hasData: summary.hasData, summary, prev,
    people: view === "together"
      ? { francisco: personSummary(ds, "francisco", m, now), carolina: personSummary(ds, "carolina", m, now) } : null,
    income: {
      recurring: incomeRecurring,
      entries: ds.incomeEntries.filter((e) => e.month === m && persons.includes(e.person)),
    },
    expenses: { recurring: view === "together" ? [...personalExpenses, ...sharedRecurring] : personalExpenses },
    shared: view === "together"
      ? {
          lines, oneoff: ds.sharedExpenses.filter((e) => e.month === m),
          settlements: ds.settlements.filter((s) => s.month === m),
          proportionalBps: proportionalBps(ds, m),
          salaries: { francisco: salaryOf(ds, "francisco", m), carolina: salaryOf(ds, "carolina", m) },
          balanceMonth: balanceOwed(ds, m).carolinaOwesFrancisco - balanceOwed(ds, addMonths(m, -1)).carolinaOwesFrancisco,
          balanceTotal: balanceOwed(ds, m).carolinaOwesFrancisco,
        }
      : { lines },
    persons, lifestyle, contributions, limits: limitsByPerson, plan,
    categories: ds.categories,
    goals: ds.destinations.filter((d) => d.kind === "saving" && (d.isMoving || d.targetCents !== null)).map((d) => goalProgress(ds, d, now)),
  };
}

function categoryBreakdown(ds: Dataset, persons: Person[], m: Month) {
  const out: Record<string, number> = {};
  for (const c of ds.categories) {
    out[c.name] = ds.lifestyle
      .filter((e) => e.month === m && e.categoryId === c.id && persons.includes(e.person))
      .reduce((s, e) => s + e.amountCents, 0);
  }
  return out;
}

export function history(ds: Dataset, view: View, now: Month) {
  const persons: Person[] = view === "together" ? PEOPLE : [view];
  const months = listMonths(ds, view, "asc", now);
  const rows = months.map((m) => {
    const s = monthSummary(ds, view, m, now);
    return { month: m, summary: s, categories: categoryBreakdown(ds, persons, m), people: view === "together"
      ? { francisco: personSummary(ds, "francisco", m, now), carolina: personSummary(ds, "carolina", m, now) } : null };
  });
  const years: Record<string, any> = {};
  for (const r of rows) {
    const y = r.month.slice(0, 4);
    const t = (years[y] ??= { year: y, months: 0, income: 0, mealAllowance: 0, cashExpenses: 0, savings: 0, investments: 0, remainingCash: 0 });
    t.months++;
    t.income += r.summary.income.total;
    t.mealAllowance += r.summary.income.meal;
    t.cashExpenses += r.summary.expenses.cash;
    t.savings += r.summary.savings;
    t.investments += r.summary.investments;
    t.remainingCash += r.summary.remainingCash;
  }
  let cum = { saving: 0, investment: 0 };
  const cumulative = rows.map((r) => {
    cum = { saving: cum.saving + r.summary.savings, investment: cum.investment + r.summary.investments };
    return { month: r.month, ...cum };
  });
  return { view, rows, years: Object.values(years), cumulative, categories: ds.categories.map((c) => c.name) };
}

function recurringList(ds: Dataset, view: View, m: Month) {
  return ds.recurring
    .filter((r) => view === "together" ? r.owner === "together" : r.owner === view)
    .map((r) => {
      const v = effectiveVersion(r, m);
      return { id: r.id, type: r.type, subtype: r.subtype, owner: r.owner, startMonth: r.startMonth, current: v, versions: r.versions, overrides: r.overrides };
    });
}

function readVersionFields(b: Body, partial: boolean): Partial<Omit<RuleVersion, "fromMonth">> {
  const out: Partial<Omit<RuleVersion, "fromMonth">> = {};
  if (!partial || b.name !== undefined) out.name = text(b.name);
  if (!partial || b.category !== undefined) out.category = optText(b.category);
  if (!partial || b.amountCents !== undefined) out.amountCents = cents(b.amountCents);
  if (!partial || b.intervalMonths !== undefined) {
    const n = b.intervalMonths ?? 1;
    if (![1, 2, 3, 4, 6, 12].includes(n)) bad("Frequência inválida");
    out.intervalMonths = n;
  }
  if (b.active !== undefined) out.active = !!b.active;
  if (!partial || b.payer !== undefined) out.payer = payer(b.payer ?? "account");
  if (!partial || b.splitFrancisco !== undefined) out.splitFrancisco = bps(b.splitFrancisco);
  return out;
}

export function route(db: DB, method: string, path: string, q: URLSearchParams, body: Body, now: Month = currentMonth()): unknown {
  const seg = path.replace(/^\/api\//, "").split("/");
  const key = `${method} ${seg[0]}`;
  const ds = () => loadDataset(db);

  switch (key) {
    case "GET meta": {
      const d = ds();
      return {
        now, categories: d.categories, destinations: d.destinations, goal: d.goal,
        salaries: { francisco: salaryOf(d, "francisco", now), carolina: salaryOf(d, "carolina", now) },
        limits: d.limits, plans: d.plans,
      };
    }
    case "GET months": {
      const d = ds();
      const view = viewOf(q.get("view"));
      const order = q.get("order") === "desc" ? "desc" : "asc";
      return listMonths(d, view, order, now).map((m) => ({ month: m, summary: monthSummary(d, view, m, now) }));
    }
    case "GET month": {
      return monthDetail(ds(), viewOf(q.get("view")), month(q.get("month")), now);
    }
    case "GET history":
      return history(ds(), viewOf(q.get("view")), now);
    case "GET forecast": {
      const view = viewOf(q.get("view"));
      const from = q.get("from") ? month(q.get("from")) : addMonths(now, 1);
      return forecast(ds(), view, from, 12, now);
    }
    case "GET goals": {
      const d = ds();
      return d.destinations.filter((x) => x.kind === "saving").map((x) => goalProgress(d, x, now));
    }
    case "GET recurring":
      return recurringList(ds(), viewOf(q.get("view")), q.get("month") ? month(q.get("month")) : now);
    case "POST recurring": {
      const type = body.type === "income" ? "income" : "expense";
      const own = owner(body.owner);
      if (type === "income" && own === "together") bad("O rendimento pertence a uma pessoa");
      const subtype = type === "income" ? (["salary", "holiday", "christmas", "meal", "other"].includes(body.subtype) ? body.subtype : "other") : "expense";
      const f = readVersionFields(body, false) as Omit<RuleVersion, "fromMonth">;
      return { id: insertRecurring(db, { type, subtype, owner: own, startMonth: month(body.startMonth), ...f, active: true }) };
    }
    case "PUT recurring": {
      const rid = id(seg[1]);
      if (seg[2] === "override") {
        setOverride(db, rid, month(body.month), !!body.skipped, body.amountCents === null || body.amountCents === undefined ? null : cents(body.amountCents));
        return { ok: true };
      }
      editRecurringFrom(db, rid, month(body.fromMonth), readVersionFields(body, true));
      return { ok: true };
    }
    case "DELETE recurring":
      db.prepare("DELETE FROM recurring WHERE id = ?").run(id(seg[1]));
      return { ok: true };

    case "POST income-entries": {
      const r = db.prepare("INSERT INTO income_entries (person, month, name, kind, amount_cents) VALUES (?,?,?,?,?)")
        .run(person(body.person), month(body.month), text(body.name), optText(body.kind) || "other", cents(body.amountCents));
      return { id: Number(r.lastInsertRowid) };
    }
    case "PUT income-entries":
      db.prepare("UPDATE income_entries SET name=?, kind=?, amount_cents=?, month=? WHERE id=?")
        .run(text(body.name), optText(body.kind) || "other", cents(body.amountCents), month(body.month), id(seg[1]));
      return { ok: true };
    case "DELETE income-entries":
      db.prepare("DELETE FROM income_entries WHERE id = ?").run(id(seg[1]));
      return { ok: true };

    case "PUT lifestyle": {
      const p = person(body.person), m = month(body.month), cid = id(body.categoryId);
      const amount = cents(body.amountCents), meal = cents(body.mealCents ?? 0);
      if (meal > amount) bad("O valor pago com o subsídio não pode exceder o total gasto");
      if (amount === 0 && meal === 0) db.prepare("DELETE FROM lifestyle WHERE person=? AND month=? AND category_id=?").run(p, m, cid);
      else db.prepare(`INSERT INTO lifestyle (person, month, category_id, amount_cents, meal_cents) VALUES (?,?,?,?,?)
        ON CONFLICT (person, month, category_id) DO UPDATE SET amount_cents=excluded.amount_cents, meal_cents=excluded.meal_cents`)
        .run(p, m, cid, amount, meal);
      return { ok: true };
    }
    case "PUT contribution": {
      const p = person(body.person), m = month(body.month), did = id(body.destinationId), a = cents(body.amountCents);
      if (a === 0) db.prepare("DELETE FROM contributions WHERE person=? AND month=? AND destination_id=?").run(p, m, did);
      else db.prepare(`INSERT INTO contributions (person, month, destination_id, amount_cents) VALUES (?,?,?,?)
        ON CONFLICT (person, month, destination_id) DO UPDATE SET amount_cents=excluded.amount_cents`).run(p, m, did, a);
      return { ok: true };
    }

    case "POST shared-expenses": {
      const r = db.prepare("INSERT INTO shared_expenses (month, name, category, amount_cents, payer, split_francisco) VALUES (?,?,?,?,?,?)")
        .run(month(body.month), text(body.name), optText(body.category), cents(body.amountCents), payer(body.payer ?? "account"), bps(body.splitFrancisco));
      return { id: Number(r.lastInsertRowid) };
    }
    case "PUT shared-expenses":
      db.prepare("UPDATE shared_expenses SET name=?, category=?, amount_cents=?, payer=?, split_francisco=? WHERE id=?")
        .run(text(body.name), optText(body.category), cents(body.amountCents), payer(body.payer ?? "account"), bps(body.splitFrancisco), id(seg[1]));
      return { ok: true };
    case "DELETE shared-expenses":
      db.prepare("DELETE FROM shared_expenses WHERE id = ?").run(id(seg[1]));
      return { ok: true };
    case "POST settlements": {
      const from = person(body.from), to = person(body.to);
      if (from === to) bad("O acerto tem de ser entre duas pessoas");
      const r = db.prepare("INSERT INTO settlements (month, from_person, to_person, amount_cents) VALUES (?,?,?,?)")
        .run(month(body.month), from, to, cents(body.amountCents));
      return { id: Number(r.lastInsertRowid) };
    }
    case "DELETE settlements":
      db.prepare("DELETE FROM settlements WHERE id = ?").run(id(seg[1]));
      return { ok: true };

    case "POST categories": {
      const max = (db.prepare("SELECT COALESCE(MAX(sort),0) m FROM categories").get() as { m: number }).m;
      const r = db.prepare("INSERT INTO categories (name, meal_eligible, sort) VALUES (?,?,?)").run(text(body.name), body.mealEligible ? 1 : 0, max + 1);
      return { id: Number(r.lastInsertRowid) };
    }
    case "PUT categories":
      db.prepare("UPDATE categories SET name=?, meal_eligible=? WHERE id=?").run(text(body.name), body.mealEligible ? 1 : 0, id(seg[1]));
      return { ok: true };
    case "DELETE categories": {
      const cid = id(seg[1]);
      const used = db.prepare("SELECT COUNT(*) n FROM lifestyle WHERE category_id = ?").get(cid) as { n: number };
      if (used.n > 0) throw new HttpError(409, "Esta categoria já tem valores registados. Renomeie-a em vez de a apagar.");
      db.prepare("DELETE FROM limits WHERE category_id = ?").run(cid);
      db.prepare("DELETE FROM categories WHERE id = ?").run(cid);
      return { ok: true };
    }

    case "POST destinations": {
      const kind = body.kind === "investment" ? "investment" : "saving";
      const target = body.targetCents === null || body.targetCents === undefined ? null : cents(body.targetCents);
      const r = db.prepare("INSERT INTO destinations (kind, name, target_cents, starting_cents) VALUES (?,?,?,?)")
        .run(kind, text(body.name), target, cents(body.startingCents ?? 0));
      return { id: Number(r.lastInsertRowid) };
    }
    case "PUT destinations": {
      const did = id(seg[1]);
      const target = body.targetCents === null || body.targetCents === undefined ? null : cents(body.targetCents);
      db.prepare("UPDATE destinations SET name=?, target_cents=?, starting_cents=? WHERE id=?")
        .run(text(body.name), target, cents(body.startingCents ?? 0), did);
      return { ok: true };
    }
    case "DELETE destinations": {
      const did = id(seg[1]);
      const d = db.prepare("SELECT is_moving FROM destinations WHERE id = ?").get(did) as { is_moving: number } | undefined;
      if (d?.is_moving) throw new HttpError(409, "O fundo da mudança não pode ser apagado.");
      const used = db.prepare("SELECT COUNT(*) n FROM contributions WHERE destination_id = ?").get(did) as { n: number };
      if (used.n > 0) throw new HttpError(409, "Este destino já tem contribuições registadas. Renomeie-o em vez de o apagar.");
      db.prepare("DELETE FROM destinations WHERE id = ?").run(did);
      return { ok: true };
    }

    case "PUT limits": {
      const p = person(body.person);
      const cid = body.categoryId === 0 ? 0 : id(body.categoryId);
      if (body.limitCents === null || body.limitCents === undefined) db.prepare("DELETE FROM limits WHERE person=? AND category_id=?").run(p, cid);
      else db.prepare(`INSERT INTO limits (person, category_id, limit_cents) VALUES (?,?,?)
        ON CONFLICT (person, category_id) DO UPDATE SET limit_cents=excluded.limit_cents`).run(p, cid, cents(body.limitCents));
      return { ok: true };
    }
    case "PUT plans": {
      const p = person(body.person);
      if (!["saving", "investment", "lifestyle"].includes(body.kind)) bad("Tipo inválido");
      if (body.amountCents === null || body.amountCents === undefined) db.prepare("DELETE FROM plans WHERE person=? AND kind=?").run(p, body.kind);
      else db.prepare(`INSERT INTO plans (person, kind, amount_cents) VALUES (?,?,?)
        ON CONFLICT (person, kind) DO UPDATE SET amount_cents=excluded.amount_cents`).run(p, body.kind, cents(body.amountCents));
      return { ok: true };
    }
    case "PUT goal": {
      tx(db, () => {
        const tm = month(body.targetMonth);
        setSetting(db, "goal_month", tm);
        setSetting(db, "goal_target_cents", body.targetCents === null || body.targetCents === undefined ? null : String(cents(body.targetCents)));
        db.prepare("UPDATE destinations SET starting_cents = ? WHERE is_moving = 1").run(cents(body.startingCents ?? 0));
      });
      return { ok: true };
    }
  }
  throw new HttpError(404, "Não encontrado");
}
