import { type Month, addMonths, currentMonth, monthDiff, monthIndex, splitProportional } from "./util.ts";

export type Person = "francisco" | "carolina";
export type Owner = Person | "together";
export type View = Owner;
export const PEOPLE: Person[] = ["francisco", "carolina"];

export type IncomeSubtype = "salary" | "holiday" | "christmas" | "meal" | "other";

export interface RuleVersion {
  fromMonth: Month;
  name: string;
  category: string;
  amountCents: number;
  intervalMonths: number;
  active: boolean;
  /** Só para despesas "together": quem pagou ("account" = conta partilhada, ou uma pessoa). */
  payer: "account" | Person;
  /** Parte do Francisco em pontos base (0..10000); null = proporcional aos salários. */
  splitFrancisco: number | null;
}

export interface RuleOverride {
  month: Month;
  skipped: boolean;
  amountCents: number | null;
}

export interface Recurring {
  id: number;
  type: "income" | "expense";
  subtype: IncomeSubtype | "expense";
  owner: Owner;
  startMonth: Month;
  versions: RuleVersion[];
  overrides: RuleOverride[];
}

export interface IncomeEntry { id: number; person: Person; month: Month; name: string; kind: string; amountCents: number }
export interface Category { id: number; name: string; mealEligible: boolean; sort: number }
export interface LifestyleEntry { person: Person; month: Month; categoryId: number; amountCents: number; mealCents: number }
export interface Destination {
  id: number; kind: "saving" | "investment"; name: string; isMoving: boolean;
  targetCents: number | null;
}
export interface Opening { person: Person; destinationId: number; amountCents: number }
export interface Contribution { id: number; person: Person; month: Month; destinationId: number; amountCents: number }
export interface SharedExpense {
  id: number; month: Month; name: string; category: string; amountCents: number;
  payer: "account" | Person; splitFrancisco: number | null;
}
export interface Settlement { id: number; month: Month; from: Person; to: Person; amountCents: number }
export interface Limit { person: Person; categoryId: number; limitCents: number } // categoryId 0 = limite global
export interface Plan { person: Person; kind: "saving" | "investment" | "lifestyle"; amountCents: number }

export interface Dataset {
  recurring: Recurring[];
  incomeEntries: IncomeEntry[];
  categories: Category[];
  lifestyle: LifestyleEntry[];
  destinations: Destination[];
  contributions: Contribution[];
  openings: Opening[];
  sharedExpenses: SharedExpense[];
  settlements: Settlement[];
  limits: Limit[];
  plans: Plan[];
  goal: { targetMonth: Month; targetCents: number | null };
}

export function emptyDataset(): Dataset {
  return {
    recurring: [], incomeEntries: [], categories: [], lifestyle: [], destinations: [],
    contributions: [], openings: [], sharedExpenses: [], settlements: [], limits: [], plans: [],
    goal: { targetMonth: "2027-09", targetCents: null },
  };
}

/* ---------- Recorrentes: versões por mês, sem reescrever o passado ---------- */

export function effectiveVersion(item: Recurring, month: Month): RuleVersion | null {
  let best: RuleVersion | null = null;
  for (const v of item.versions) {
    if (monthIndex(v.fromMonth) <= monthIndex(month) && (!best || monthIndex(v.fromMonth) >= monthIndex(best.fromMonth))) best = v;
  }
  return best;
}

export interface Occurrence {
  itemId: number;
  type: "income" | "expense";
  subtype: Recurring["subtype"];
  owner: Owner;
  name: string;
  category: string;
  amountCents: number; // valor efetivo (0 se ignorado)
  baseAmountCents: number;
  skipped: boolean;
  overridden: boolean;
  payer: "account" | Person;
  splitFrancisco: number | null;
}

export function occurrence(item: Recurring, month: Month): Occurrence | null {
  if (monthIndex(month) < monthIndex(item.startMonth)) return null;
  const v = effectiveVersion(item, month);
  if (!v || !v.active) return null;
  const interval = Math.max(1, v.intervalMonths);
  if (monthDiff(item.startMonth, month) % interval !== 0) return null;
  const ov = item.overrides.find((o) => o.month === month);
  const skipped = ov?.skipped ?? false;
  const overridden = !!ov && (ov.amountCents !== null || ov.skipped);
  const base = v.amountCents;
  const amount = skipped ? 0 : (ov?.amountCents ?? base);
  return {
    itemId: item.id, type: item.type, subtype: item.subtype, owner: item.owner, name: v.name,
    category: v.category, amountCents: amount, baseAmountCents: base, skipped, overridden,
    payer: v.payer, splitFrancisco: v.splitFrancisco,
  };
}

export function occurrences(ds: Dataset, month: Month): Occurrence[] {
  const out: Occurrence[] = [];
  for (const r of ds.recurring) {
    const o = occurrence(r, month);
    if (o) out.push(o);
  }
  return out;
}

/* ---------- Partilha ---------- */

export function salaryOf(ds: Dataset, person: Person, month: Month): number {
  return occurrences(ds, month)
    .filter((o) => o.type === "income" && o.owner === person && o.subtype === "salary")
    .reduce((s, o) => s + o.amountCents, 0);
}

/** Percentagem (em pontos base) do Francisco proporcional aos salários do mês. */
export function proportionalBps(ds: Dataset, month: Month): number {
  const f = salaryOf(ds, "francisco", month);
  const c = salaryOf(ds, "carolina", month);
  if (f + c <= 0) return 5000;
  return Math.round((f * 10000) / (f + c));
}

export interface SharedLine {
  source: "recurring" | "oneoff";
  id: number;
  name: string;
  category: string;
  amountCents: number;
  payer: "account" | Person;
  splitFrancisco: number | null;
  shareFrancisco: number;
  shareCarolina: number;
  skipped: boolean;
}

export function splitAmount(ds: Dataset, month: Month, amountCents: number, splitFrancisco: number | null): [number, number] {
  if (splitFrancisco !== null) return splitProportional(amountCents, splitFrancisco, 10000 - splitFrancisco);
  return splitProportional(amountCents, salaryOf(ds, "francisco", month), salaryOf(ds, "carolina", month));
}

export function sharedLines(ds: Dataset, month: Month): SharedLine[] {
  const lines: SharedLine[] = [];
  for (const o of occurrences(ds, month)) {
    if (o.type !== "expense" || o.owner !== "together") continue;
    const [f, c] = splitAmount(ds, month, o.amountCents, o.splitFrancisco);
    lines.push({
      source: "recurring", id: o.itemId, name: o.name, category: o.category, amountCents: o.amountCents,
      payer: o.payer, splitFrancisco: o.splitFrancisco, shareFrancisco: f, shareCarolina: c, skipped: o.skipped,
    });
  }
  for (const e of ds.sharedExpenses) {
    if (e.month !== month) continue;
    const [f, c] = splitAmount(ds, month, e.amountCents, e.splitFrancisco);
    lines.push({
      source: "oneoff", id: e.id, name: e.name, category: e.category, amountCents: e.amountCents,
      payer: e.payer, splitFrancisco: e.splitFrancisco, shareFrancisco: f, shareCarolina: c, skipped: false,
    });
  }
  return lines;
}

/**
 * Saldo entre o casal até (e incluindo) `upTo`. Positivo: a Carolina deve ao Francisco.
 * Despesas pagas pela conta partilhada não geram dívida (cada um contribui a sua parte).
 */
export function balanceOwed(ds: Dataset, upTo: Month | null): { carolinaOwesFrancisco: number } {
  const months = new Set<Month>();
  for (const e of ds.sharedExpenses) months.add(e.month);
  for (const r of ds.recurring) {
    if (r.owner !== "together" || r.type !== "expense") continue;
    const end = upTo ?? currentMonth();
    for (let m = r.startMonth; monthIndex(m) <= monthIndex(end); m = addMonths(m, 1)) months.add(m);
  }
  let net = 0; // pago pelo Francisco - parte do Francisco, ajustado por acertos
  for (const m of months) {
    if (upTo && monthIndex(m) > monthIndex(upTo)) continue;
    for (const l of sharedLines(ds, m)) {
      if (l.payer === "francisco") net += l.amountCents - l.shareFrancisco;
      else if (l.payer === "carolina") net -= l.amountCents - l.shareCarolina;
    }
  }
  for (const s of ds.settlements) {
    if (upTo && monthIndex(s.month) > monthIndex(upTo)) continue;
    net += s.from === "carolina" ? -s.amountCents : s.amountCents;
  }
  return { carolinaOwesFrancisco: net };
}

/* ---------- Resumo mensal ---------- */

export interface MealSummary {
  allowance: number;
  claimed: number; // gasto indicado como pago com o subsídio
  covered: number; // min(claimed, allowance)
  excess: number; // acima do subsídio -> sai do dinheiro livre
  remaining: number;
}

export interface MonthSummary {
  month: Month;
  hasData: boolean;
  income: { regular: number; additional: number; total: number; meal: number };
  expenses: { recurring: number; shared: number; lifestyle: number; mealCovered: number; gross: number; cash: number };
  savings: number;
  investments: number;
  remainingCash: number;
  netCashFlow: number;
  totalAllocation: number;
  savingsRate: number | null;
  investmentRate: number | null;
  meal: MealSummary;
}

export function zeroMeal(): MealSummary {
  return { allowance: 0, claimed: 0, covered: 0, excess: 0, remaining: 0 };
}

export function monthHasData(ds: Dataset, view: View, month: Month, now: Month = currentMonth()): boolean {
  const persons = view === "together" ? PEOPLE : [view];
  const manual =
    ds.incomeEntries.some((e) => e.month === month && persons.includes(e.person)) ||
    ds.lifestyle.some((e) => e.month === month && persons.includes(e.person) && (e.amountCents !== 0 || e.mealCents !== 0)) ||
    ds.contributions.some((e) => e.month === month && persons.includes(e.person)) ||
    (view === "together" && ds.sharedExpenses.some((e) => e.month === month)) ||
    (view === "together" && ds.settlements.some((e) => e.month === month));
  if (manual) return true;
  if (monthIndex(month) > monthIndex(now)) return false;
  return occurrences(ds, month).some((o) => (view === "together" ? true : o.owner === view || o.owner === "together"));
}

export function personSummary(ds: Dataset, person: Person, month: Month, now: Month = currentMonth()): MonthSummary {
  const occ = occurrences(ds, month);
  let regular = 0, additional = 0, meal = 0, recurring = 0;
  for (const o of occ) {
    if (o.owner !== person) continue;
    if (o.type === "income") {
      if (o.subtype === "meal") meal += o.amountCents;
      else if (o.subtype === "holiday" || o.subtype === "christmas") additional += o.amountCents;
      else regular += o.amountCents;
    } else recurring += o.amountCents;
  }
  for (const e of ds.incomeEntries) if (e.person === person && e.month === month) additional += e.amountCents;

  let shared = 0;
  for (const l of sharedLines(ds, month)) shared += person === "francisco" ? l.shareFrancisco : l.shareCarolina;

  let lifestyle = 0, claimed = 0;
  const eligible = new Set(ds.categories.filter((c) => c.mealEligible).map((c) => c.id));
  for (const e of ds.lifestyle) {
    if (e.person !== person || e.month !== month) continue;
    lifestyle += e.amountCents;
    claimed += eligible.has(e.categoryId) ? Math.min(e.mealCents, e.amountCents) : 0;
  }
  const covered = Math.min(claimed, meal);

  let savings = 0, investments = 0;
  const kinds = new Map(ds.destinations.map((d) => [d.id, d.kind]));
  for (const c of ds.contributions) {
    if (c.person !== person || c.month !== month) continue;
    if (kinds.get(c.destinationId) === "investment") investments += c.amountCents;
    else savings += c.amountCents;
  }

  const incomeTotal = regular + additional;
  const gross = recurring + shared + lifestyle;
  const cash = gross - covered;
  const remainingCash = incomeTotal - cash - savings - investments;
  return {
    month,
    hasData: monthHasData(ds, person, month, now),
    income: { regular, additional, total: incomeTotal, meal },
    expenses: { recurring, shared, lifestyle, mealCovered: covered, gross, cash },
    savings, investments, remainingCash,
    netCashFlow: incomeTotal - cash,
    totalAllocation: cash + savings + investments,
    savingsRate: incomeTotal > 0 ? savings / incomeTotal : null,
    investmentRate: incomeTotal > 0 ? investments / incomeTotal : null,
    meal: { allowance: meal, claimed, covered, excess: claimed - covered, remaining: meal - covered },
  };
}

/** Together = soma das duas pessoas. As despesas partilhadas entram só como as partes de cada um, logo nunca são contadas duas vezes. */
export function monthSummary(ds: Dataset, view: View, month: Month, now: Month = currentMonth()): MonthSummary {
  if (view !== "together") return personSummary(ds, view, month, now);
  const a = personSummary(ds, "francisco", month, now);
  const b = personSummary(ds, "carolina", month, now);
  const income = a.income.total + b.income.total;
  const cash = a.expenses.cash + b.expenses.cash;
  const savings = a.savings + b.savings;
  const investments = a.investments + b.investments;
  return {
    month,
    hasData: monthHasData(ds, "together", month, now),
    income: {
      regular: a.income.regular + b.income.regular, additional: a.income.additional + b.income.additional,
      total: income, meal: a.income.meal + b.income.meal,
    },
    expenses: {
      recurring: a.expenses.recurring + b.expenses.recurring, shared: a.expenses.shared + b.expenses.shared,
      lifestyle: a.expenses.lifestyle + b.expenses.lifestyle, mealCovered: a.expenses.mealCovered + b.expenses.mealCovered,
      gross: a.expenses.gross + b.expenses.gross, cash,
    },
    savings, investments,
    remainingCash: a.remainingCash + b.remainingCash,
    netCashFlow: income - cash,
    totalAllocation: cash + savings + investments,
    savingsRate: income > 0 ? savings / income : null,
    investmentRate: income > 0 ? investments / income : null,
    meal: {
      allowance: a.meal.allowance + b.meal.allowance, claimed: a.meal.claimed + b.meal.claimed,
      covered: a.meal.covered + b.meal.covered, excess: a.meal.excess + b.meal.excess,
      remaining: a.meal.remaining + b.meal.remaining,
    },
  };
}

/* ---------- Meses dinâmicos ---------- */

/** Só devolve meses com dados; ordem cronológica (asc) ou mais recentes primeiro (desc). */
export function listMonths(ds: Dataset, view: View, order: "asc" | "desc" = "asc", now: Month = currentMonth()): Month[] {
  const persons = view === "together" ? PEOPLE : [view];
  const candidates: number[] = [];
  const add = (m: Month) => candidates.push(monthIndex(m));
  for (const r of ds.recurring) if (view === "together" || r.owner === view || r.owner === "together") add(r.startMonth);
  for (const e of ds.incomeEntries) if (persons.includes(e.person)) add(e.month);
  for (const e of ds.lifestyle) if (persons.includes(e.person)) add(e.month);
  for (const e of ds.contributions) if (persons.includes(e.person)) add(e.month);
  if (view === "together") {
    for (const e of ds.sharedExpenses) add(e.month);
    for (const e of ds.settlements) add(e.month);
  }
  if (candidates.length === 0) return [];
  const lo = Math.min(...candidates);
  const hi = Math.max(...candidates, monthIndex(now));
  const out: Month[] = [];
  for (let i = lo; i <= hi; i++) {
    const m = addMonths("0000-01", i);
    if (monthHasData(ds, view, m, now)) out.push(m);
  }
  return order === "desc" ? out.reverse() : out;
}

/* ---------- Metas ---------- */

export interface GoalProgress {
  destinationId: number;
  name: string;
  isMoving: boolean;
  targetCents: number | null;
  savedCents: number;
  openingCents: number;
  remainingCents: number | null;
  progress: number | null;
  /** Saldo inicial + contribuições, por pessoa. */
  perPerson: Record<Person, number>;
  monthsLeft: number | null;
  neededPerMonth: number | null;
  recentAvgPerMonth: number;
  status: "no-target" | "reached" | "ahead" | "on-track" | "behind";
}

export function goalProgress(ds: Dataset, d: Destination, now: Month = currentMonth()): GoalProgress {
  const target = d.isMoving ? ds.goal.targetCents : d.targetCents;
  const perPerson: Record<Person, number> = { francisco: 0, carolina: 0 };
  let contributed = 0;
  const byMonth = new Map<Month, number>();
  for (const c of ds.contributions) {
    if (c.destinationId !== d.id || monthIndex(c.month) > monthIndex(now)) continue;
    perPerson[c.person] += c.amountCents;
    contributed += c.amountCents;
    byMonth.set(c.month, (byMonth.get(c.month) ?? 0) + c.amountCents);
  }
  let opening = 0;
  for (const o of ds.openings) {
    if (o.destinationId !== d.id) continue;
    perPerson[o.person] += o.amountCents;
    opening += o.amountCents;
  }
  const saved = opening + contributed;
  let recent = 0;
  for (let i = 0; i < 3; i++) recent += byMonth.get(addMonths(now, -i)) ?? 0;
  const recentAvg = Math.round(recent / 3);
  const base = {
    destinationId: d.id, name: d.name, isMoving: d.isMoving, targetCents: target, savedCents: saved, openingCents: opening,
    perPerson, recentAvgPerMonth: recentAvg,
  };
  if (target === null || target <= 0) {
    return { ...base, remainingCents: null, progress: null, monthsLeft: null, neededPerMonth: null, status: "no-target" };
  }
  const remaining = Math.max(0, target - saved);
  const progress = Math.min(1, saved / target);
  if (!d.isMoving) {
    return { ...base, remainingCents: remaining, progress, monthsLeft: null, neededPerMonth: null, status: remaining === 0 ? "reached" : "on-track" };
  }
  const monthsLeft = Math.max(1, monthDiff(now, ds.goal.targetMonth));
  const needed = Math.ceil(remaining / monthsLeft);
  let status: GoalProgress["status"];
  if (remaining === 0) status = "reached";
  else if (monthDiff(now, ds.goal.targetMonth) <= 0) status = "behind";
  else if (recentAvg >= needed * 1.1) status = "ahead";
  else if (recentAvg >= needed * 0.95) status = "on-track";
  else status = "behind";
  return { ...base, remainingCents: remaining, progress, monthsLeft, neededPerMonth: needed, status };
}

/* ---------- Previsão a 12 meses ---------- */

export interface ForecastRow {
  month: Month;
  income: number;
  cashExpenses: number;
  savings: number;
  investments: number;
  remainingCash: number;
}

/**
 * Receitas e despesas recorrentes (já com ignorados/alterações), despesa de estilo de vida
 * estimada como média dos últimos 3 meses com dados, e poupança/investimento planeados manualmente.
 */
export function forecast(ds: Dataset, view: View, from: Month, months = 12, now: Month = currentMonth()): ForecastRow[] {
  const persons = view === "together" ? PEOPLE : [view];
  const rows: ForecastRow[] = [];
  for (let i = 0; i < months; i++) {
    const m = addMonths(from, i);
    let income = 0, expenses = 0, planS = 0, planI = 0;
    for (const p of persons) {
      const occ = occurrences(ds, m);
      const own = occ.filter((o) => o.owner === p);
      income += own.filter((o) => o.type === "income" && o.subtype !== "meal").reduce((s, o) => s + o.amountCents, 0);
      expenses += own.filter((o) => o.type === "expense").reduce((s, o) => s + o.amountCents, 0);
      for (const l of sharedLines(ds, m)) expenses += p === "francisco" ? l.shareFrancisco : l.shareCarolina;
      income += ds.incomeEntries.filter((e) => e.person === p && e.month === m).reduce((s, e) => s + e.amountCents, 0);

      const history: number[] = [];
      for (let k = 1; k <= 12 && history.length < 3; k++) {
        const hm = addMonths(now, 1 - k);
        const s = personSummary(ds, p, hm, now);
        if (s.hasData && s.expenses.lifestyle > 0) history.push(s.expenses.lifestyle - s.expenses.mealCovered);
      }
      const planned = ds.plans.find((x) => x.person === p && x.kind === "lifestyle")?.amountCents ?? 0;
      expenses += history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : planned;

      const manualS = ds.contributions.filter((c) => c.person === p && c.month === m);
      if (manualS.length) {
        const kinds = new Map(ds.destinations.map((d) => [d.id, d.kind]));
        for (const c of manualS) {
          if (kinds.get(c.destinationId) === "investment") planI += c.amountCents; else planS += c.amountCents;
        }
      } else {
        planS += ds.plans.find((x) => x.person === p && x.kind === "saving")?.amountCents ?? 0;
        planI += ds.plans.find((x) => x.person === p && x.kind === "investment")?.amountCents ?? 0;
      }
    }
    rows.push({ month: m, income, cashExpenses: expenses, savings: planS, investments: planI, remainingCash: income - expenses - planS - planI });
  }
  return rows;
}
