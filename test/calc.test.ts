import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Dataset, type Recurring, type RuleVersion, emptyDataset, monthSummary, personSummary, listMonths,
  occurrence, proportionalBps, sharedLines, balanceOwed, goalProgress, forecast, monthHasData,
} from "../src/calc.ts";
import { parseCents, plainEuros, monthLabel, splitProportional, addMonths } from "../src/util.ts";

const NOW = "2026-12";

function version(over: Partial<RuleVersion> = {}): RuleVersion {
  return {
    fromMonth: "2026-10", name: "x", category: "", amountCents: 0, intervalMonths: 1, active: true,
    payer: "account", splitFrancisco: null, ...over,
  };
}
let nextId = 1;
function rec(r: Partial<Omit<Recurring, "versions">> & { versions?: Partial<RuleVersion>[] }): Recurring {
  const startMonth = r.startMonth ?? "2026-10";
  return {
    id: nextId++, type: "expense", subtype: "expense", owner: "francisco", startMonth, overrides: [],
    ...r, versions: (r.versions ?? [{}]).map((v) => version({ fromMonth: startMonth, ...v })),
  } as Recurring;
}

function baseDs(): Dataset {
  const ds = emptyDataset();
  ds.categories = [
    { id: 1, name: "Restaurantes", mealEligible: true, sort: 1 },
    { id: 2, name: "Mercearia", mealEligible: true, sort: 2 },
    { id: 3, name: "Compras", mealEligible: false, sort: 3 },
  ];
  ds.destinations = [
    { id: 1, kind: "saving", name: "Geral", isMoving: false, targetCents: null },
    { id: 2, kind: "saving", name: "Mudança", isMoving: true, targetCents: null },
    { id: 3, kind: "investment", name: "VUAA", isMoving: false, targetCents: null },
  ];
  ds.recurring.push(
    rec({ type: "income", subtype: "salary", owner: "francisco", versions: [{ name: "Salário", amountCents: 118107 }] }),
    rec({ type: "income", subtype: "salary", owner: "carolina", versions: [{ name: "Salário", amountCents: 124600 }] }),
  );
  return ds;
}

test("dinheiro: parse e formatação em cêntimos inteiros", () => {
  assert.equal(parseCents("1181,07"), 118107);
  assert.equal(parseCents("1.181,07"), 118107);
  assert.equal(parseCents("1181.07"), 118107);
  assert.equal(parseCents("0,1"), 10);
  assert.equal(parseCents("19.99"), 1999);
  assert.equal(plainEuros(118107), "1181,07");
  assert.equal(plainEuros(-5), "-0,05");
  assert.equal(monthLabel("2026-10"), "out 2026");
  assert.equal(parseCents("0,1") + parseCents("0,2"), 30); // sem erros de vírgula flutuante
});

test("dinheiro disponível = receitas - despesas - poupança - investimento", () => {
  const ds = baseDs();
  ds.recurring.push(rec({ owner: "francisco", versions: [{ name: "Ginásio", amountCents: 3000 }] }));
  ds.lifestyle.push({ person: "francisco", month: "2026-10", categoryId: 3, amountCents: 20000, mealCents: 0 });
  ds.contributions.push(
    { id: 1, person: "francisco", month: "2026-10", destinationId: 2, amountCents: 30000 },
    { id: 2, person: "francisco", month: "2026-10", destinationId: 3, amountCents: 10000 },
  );
  const s = personSummary(ds, "francisco", "2026-10", NOW);
  assert.equal(s.income.total, 118107);
  assert.equal(s.expenses.cash, 23000);
  assert.equal(s.savings, 30000);
  assert.equal(s.investments, 10000);
  assert.equal(s.remainingCash, 118107 - 23000 - 30000 - 10000);
  assert.equal(s.netCashFlow, 118107 - 23000);
  assert.equal(s.totalAllocation, 23000 + 30000 + 10000);
  assert.ok(Math.abs(s.savingsRate! - 30000 / 118107) < 1e-9);
});

test("subsídio de refeição: separado do dinheiro livre e sem dupla contagem", () => {
  const ds = baseDs();
  ds.recurring.push(rec({ type: "income", subtype: "meal", owner: "francisco", versions: [{ name: "Cartão refeição", amountCents: 15000 }] }));
  ds.lifestyle.push(
    { person: "francisco", month: "2026-10", categoryId: 1, amountCents: 10000, mealCents: 8000 },
    { person: "francisco", month: "2026-10", categoryId: 3, amountCents: 5000, mealCents: 5000 }, // não elegível
  );
  const s = personSummary(ds, "francisco", "2026-10", NOW);
  assert.equal(s.income.total, 118107, "o subsídio não é rendimento livre");
  assert.equal(s.income.meal, 15000);
  assert.equal(s.meal.covered, 8000);
  assert.equal(s.meal.remaining, 7000);
  assert.equal(s.expenses.gross, 15000);
  assert.equal(s.expenses.cash, 7000, "gasto pago com o subsídio sai das despesas em dinheiro");
  assert.equal(s.remainingCash, 118107 - 7000);
});

test("subsídio de refeição: excesso acima do valor mensal sai do dinheiro livre; sem subsídio nada é coberto", () => {
  const ds = baseDs();
  ds.recurring.push(rec({ type: "income", subtype: "meal", owner: "carolina", versions: [{ amountCents: 10000 }] }));
  ds.lifestyle.push({ person: "carolina", month: "2026-10", categoryId: 2, amountCents: 16000, mealCents: 16000 });
  const s = personSummary(ds, "carolina", "2026-10", NOW);
  assert.equal(s.meal.remaining, 0);
  assert.equal(s.meal.excess, 6000);
  assert.equal(s.expenses.cash, 6000);
  const f = baseDs();
  f.lifestyle.push({ person: "francisco", month: "2026-10", categoryId: 1, amountCents: 5000, mealCents: 5000 });
  assert.equal(personSummary(f, "francisco", "2026-10", NOW).expenses.cash, 5000);
});

test("divisão proporcional aos salários e manual", () => {
  const ds = baseDs();
  const bps = proportionalBps(ds, "2026-10");
  assert.equal(bps, Math.round((118107 / 242707) * 10000)); // ~48,66 %
  assert.equal(bps, 4866);
  const [f, c] = splitProportional(100000, 118107, 124600);
  assert.equal(f + c, 100000);
  assert.equal(f, 48662);
  ds.recurring.push(rec({ owner: "together", versions: [{ name: "Renda", amountCents: 100001 }] }));
  const l = sharedLines(ds, "2026-10")[0];
  assert.equal(l.shareFrancisco + l.shareCarolina, 100001, "a soma das partes é sempre o total");
  ds.sharedExpenses.push({ id: 1, month: "2026-10", name: "Sofá", category: "Casa", amountCents: 60000, payer: "francisco", splitFrancisco: 5000 });
  const sofa = sharedLines(ds, "2026-10").find((x) => x.name === "Sofá")!;
  assert.equal(sofa.shareFrancisco, 30000);
  assert.equal(sofa.shareCarolina, 30000);
});

test("divisão sem salários cai para 50/50 e acompanha alterações de salário", () => {
  const ds = emptyDataset();
  assert.equal(proportionalBps(ds, "2026-10"), 5000);
  const b = baseDs();
  b.recurring[0].versions.push(version({ fromMonth: "2026-11", amountCents: 200000 }));
  assert.equal(proportionalBps(b, "2026-10"), 4866);
  assert.equal(proportionalBps(b, "2026-11"), Math.round((200000 / 324600) * 10000));
});

test("despesas partilhadas: sem dupla contagem no Together e saldo devido", () => {
  const ds = baseDs();
  ds.sharedExpenses.push({ id: 1, month: "2026-10", name: "Jantar", category: "Fora", amountCents: 10000, payer: "francisco", splitFrancisco: 5000 });
  ds.sharedExpenses.push({ id: 2, month: "2026-10", name: "Net", category: "Casa", amountCents: 4000, payer: "account", splitFrancisco: 5000 });
  const f = personSummary(ds, "francisco", "2026-10", NOW);
  const c = personSummary(ds, "carolina", "2026-10", NOW);
  assert.equal(f.expenses.shared, 7000);
  assert.equal(c.expenses.shared, 7000);
  const t = monthSummary(ds, "together", "2026-10", NOW);
  assert.equal(t.expenses.shared, 14000, "total partilhado = soma exata das partes");
  assert.equal(t.expenses.gross, 14000);
  assert.equal(t.remainingCash, f.remainingCash + c.remainingCash);
  assert.equal(balanceOwed(ds, "2026-10").carolinaOwesFrancisco, 5000);
  ds.settlements.push({ id: 1, month: "2026-10", from: "carolina", to: "francisco", amountCents: 2000 });
  assert.equal(balanceOwed(ds, "2026-10").carolinaOwesFrancisco, 3000);
});

test("recorrentes: editar a partir de um mês não reescreve o passado", () => {
  const ds = baseDs();
  const gym = rec({ owner: "francisco", versions: [{ name: "Ginásio", amountCents: 3000 }] });
  ds.recurring.push(gym);
  const before = ["2026-10", "2026-11"].map((m) => personSummary(ds, "francisco", m, NOW).expenses.recurring);
  gym.versions.push(version({ fromMonth: "2026-12", name: "Ginásio", amountCents: 4000 }));
  const after = ["2026-10", "2026-11", "2026-12", "2027-03"].map((m) => personSummary(ds, "francisco", m, NOW).expenses.recurring);
  assert.deepEqual(before, [3000, 3000]);
  assert.deepEqual(after, [3000, 3000, 4000, 4000]);
});

test("recorrentes: desativar a partir de um mês mantém o histórico e permite reativar", () => {
  const ds = baseDs();
  const sub = rec({ owner: "carolina", versions: [{ name: "Streaming", amountCents: 1000 }] });
  sub.versions.push(version({ fromMonth: "2026-12", amountCents: 1000, active: false }));
  ds.recurring.push(sub);
  assert.equal(occurrence(sub, "2026-11")?.amountCents, 1000);
  assert.equal(occurrence(sub, "2026-12"), null);
  sub.versions.push(version({ fromMonth: "2027-03", amountCents: 1200, active: true }));
  assert.equal(occurrence(sub, "2027-02"), null);
  assert.equal(occurrence(sub, "2027-03")?.amountCents, 1200);
  assert.equal(occurrence(sub, "2026-09"), null, "antes do início não existe");
});

test("recorrentes: frequência anual/trimestral e alteração pontual sem duplicar", () => {
  const ds = baseDs();
  const ins = rec({ owner: "francisco", startMonth: "2026-11", versions: [{ name: "Seguro", amountCents: 24000, intervalMonths: 12 }] });
  ds.recurring.push(ins);
  assert.equal(occurrence(ins, "2026-11")?.amountCents, 24000);
  assert.equal(occurrence(ins, "2026-12"), null);
  assert.equal(occurrence(ins, "2027-11")?.amountCents, 24000);
  const q = rec({ owner: "francisco", startMonth: "2026-10", versions: [{ amountCents: 900, intervalMonths: 3 }] });
  assert.deepEqual(["2026-10", "2026-11", "2027-01"].map((m) => !!occurrence(q, m)), [true, false, true]);
  ins.overrides.push({ month: "2027-11", skipped: false, amountCents: 25000 });
  assert.equal(occurrence(ins, "2027-11")?.amountCents, 25000);
  assert.equal(occurrence(ins, "2026-11")?.amountCents, 24000);
});

test("subsídios de férias/Natal: gerados por ano e ignoráveis por pessoa e ano", () => {
  const ds = baseDs();
  const xmas = rec({ type: "income", subtype: "christmas", owner: "carolina", startMonth: "2026-11", versions: [{ name: "Natal", amountCents: 124600, intervalMonths: 12 }] });
  ds.recurring.push(xmas);
  assert.equal(personSummary(ds, "carolina", "2026-11", "2027-12").income.additional, 124600);
  assert.equal(personSummary(ds, "carolina", "2027-11", "2027-12").income.additional, 124600);
  xmas.overrides.push({ month: "2027-11", skipped: true, amountCents: null });
  assert.equal(personSummary(ds, "carolina", "2027-11", "2027-12").income.additional, 0);
  assert.equal(personSummary(ds, "carolina", "2026-11", "2027-12").income.additional, 124600);
  assert.equal(personSummary(ds, "francisco", "2026-11", "2027-12").income.additional, 0);
  assert.equal(personSummary(ds, "carolina", "2026-11", "2027-12").income.regular, 124600);
});

test("meses dinâmicos: só aparecem com dados, em ordem, e zero real != sem dados", () => {
  const ds = emptyDataset();
  assert.deepEqual(listMonths(ds, "francisco", "asc", NOW), []);
  ds.recurring.push(rec({ type: "income", subtype: "salary", owner: "francisco", startMonth: "2026-10", versions: [{ amountCents: 100000 }] }));
  assert.deepEqual(listMonths(ds, "francisco", "asc", "2026-12"), ["2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(listMonths(ds, "francisco", "desc", "2026-12"), ["2026-12", "2026-11", "2026-10"]);
  assert.deepEqual(listMonths(ds, "carolina", "asc", "2026-12"), [], "histórico independente");
  ds.destinations = baseDs().destinations;
  ds.contributions.push({ id: 1, person: "francisco", month: "2027-03", destinationId: 1, amountCents: 5000 });
  assert.ok(listMonths(ds, "francisco", "asc", "2026-12").includes("2027-03"));
  assert.ok(!listMonths(ds, "francisco", "asc", "2026-12").includes("2027-01"));
});

test("meses dinâmicos: item anual não faz aparecer meses vazios; mês com zero conta como dados", () => {
  const ds = emptyDataset();
  ds.recurring.push(rec({ owner: "francisco", startMonth: "2026-06", versions: [{ amountCents: 5000, intervalMonths: 12 }] }));
  const months = listMonths(ds, "francisco", "asc", "2027-02");
  assert.deepEqual(months, ["2026-06"]);
  ds.categories = baseDs().categories;
  ds.lifestyle.push({ person: "francisco", month: "2026-09", categoryId: 1, amountCents: 0, mealCents: 0 });
  assert.equal(monthHasData(ds, "francisco", "2026-09", "2027-02"), false, "linha vazia não cria mês");
  ds.incomeEntries.push({ id: 1, person: "francisco", month: "2026-09", name: "Zero", kind: "other", amountCents: 0 });
  assert.equal(monthHasData(ds, "francisco", "2026-09", "2027-02"), true);
  assert.equal(personSummary(ds, "francisco", "2026-09", "2027-02").remainingCash, 0);
});

test("meta de mudança: progresso, falta e contribuição mensal necessária", () => {
  const ds = baseDs();
  ds.goal.targetCents = 1200000;
  ds.openings.push({ person: "francisco", destinationId: 2, amountCents: 60000 }, { person: "carolina", destinationId: 2, amountCents: 40000 });
  ds.contributions.push(
    { id: 1, person: "francisco", month: "2026-10", destinationId: 2, amountCents: 30000 },
    { id: 2, person: "carolina", month: "2026-10", destinationId: 2, amountCents: 20000 },
  );
  const g = goalProgress(ds, ds.destinations[1], "2026-10");
  assert.equal(g.savedCents, 150000);
  assert.equal(g.remainingCents, 1050000);
  assert.equal(g.monthsLeft, 11);
  assert.equal(g.neededPerMonth, Math.ceil(1050000 / 11));
  assert.equal(g.status, "behind");
  assert.deepEqual(g.perPerson, { francisco: 90000, carolina: 60000 });
  assert.equal(g.openingCents, 100000);
  ds.goal.targetCents = null;
  assert.equal(goalProgress(ds, ds.destinations[1], "2026-10").status, "no-target");
});

test("previsão a 12 meses usa recorrentes e poupança planeada", () => {
  const ds = baseDs();
  ds.recurring.push(rec({ owner: "francisco", versions: [{ name: "Ginásio", amountCents: 3000 }] }));
  ds.plans.push({ person: "francisco", kind: "saving", amountCents: 20000 });
  const rows = forecast(ds, "francisco", "2026-11", 12, "2026-10");
  assert.equal(rows.length, 12);
  assert.equal(rows[0].month, "2026-11");
  assert.equal(rows[11].month, addMonths("2026-11", 11));
  assert.equal(rows[0].remainingCash, 118107 - 3000 - 20000);
});
