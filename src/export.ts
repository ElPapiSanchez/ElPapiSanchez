import { type Sheet, buildXlsx } from "./xlsx.ts";
import { type Dataset, type View, PEOPLE, type Person, listMonths, monthSummary, occurrences, sharedLines } from "./calc.ts";
import { type Month, monthLabel, plainEuros } from "./util.ts";

const NAMES: Record<string, string> = { francisco: "Francisco", carolina: "Carolina", together: "Juntos" };

export const SUMMARY_HEADER = [
  "Mês", "Rendimento (dinheiro livre)", "Subsídio de refeição", "Despesas totais", "Pagas com subsídio de refeição",
  "Despesas em dinheiro", "Poupança", "Investimento", "Dinheiro disponível",
];
export const MOVES_HEADER = ["Mês", "Pessoa", "Tipo", "Categoria", "Descrição", "Valor"];

export type Cell = string | number;

export function summaryRows(ds: Dataset, view: View, now: Month): Cell[][] {
  return listMonths(ds, view, "asc", now).map((m) => {
    const s = monthSummary(ds, view, m, now);
    return [m, s.income.total, s.income.meal, s.expenses.gross, s.expenses.mealCovered, s.expenses.cash, s.savings, s.investments, s.remainingCash];
  });
}

/** Movimentos detalhados; valores em cêntimos (inteiros). */
export function movementRows(ds: Dataset, view: View, now: Month): Cell[][] {
  const persons: Person[] = view === "together" ? PEOPLE : [view];
  const rows: Cell[][] = [];
  const destName = new Map(ds.destinations.map((d) => [d.id, d]));
  const catName = new Map(ds.categories.map((c) => [c.id, c.name]));
  for (const m of listMonths(ds, view, "asc", now)) {
    for (const o of occurrences(ds, m)) {
      if (o.owner === "together") continue;
      if (!persons.includes(o.owner)) continue;
      const tipo = o.type === "income"
        ? (o.subtype === "meal" ? "Subsídio de refeição" : o.subtype === "salary" ? "Rendimento regular" : "Rendimento adicional")
        : "Despesa recorrente";
      rows.push([m, NAMES[o.owner], tipo, o.category, o.skipped ? `${o.name} (ignorado)` : o.name, o.type === "income" ? o.amountCents : -o.amountCents]);
    }
    for (const e of ds.incomeEntries) if (e.month === m && persons.includes(e.person)) rows.push([m, NAMES[e.person], "Rendimento adicional", e.kind, e.name, e.amountCents]);
    for (const l of sharedLines(ds, m)) {
      for (const p of persons) rows.push([m, NAMES[p], `Despesa partilhada (${l.payer === "account" ? "conta partilhada" : "paga por " + NAMES[l.payer]})`, l.category, l.name, -(p === "francisco" ? l.shareFrancisco : l.shareCarolina)]);
    }
    for (const e of ds.lifestyle) {
      if (e.month !== m || !persons.includes(e.person)) continue;
      rows.push([m, NAMES[e.person], "Estilo de vida", catName.get(e.categoryId) ?? "", "Total do mês", -e.amountCents]);
      if (e.mealCents) rows.push([m, NAMES[e.person], "Pago com subsídio de refeição", catName.get(e.categoryId) ?? "", "Incluído no total acima", e.mealCents]);
    }
    for (const c of ds.contributions) {
      if (c.month !== m || !persons.includes(c.person)) continue;
      const d = destName.get(c.destinationId);
      rows.push([m, NAMES[c.person], d?.kind === "investment" ? "Investimento" : "Poupança", "", d?.name ?? "", -c.amountCents]);
    }
  }
  return rows;
}

const withMonth = (rows: Cell[][]): Cell[][] => rows.map((r) => [monthLabel(r[0] as Month), ...r.slice(1)]);

function csvEscape(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV para Excel português: separador ";", vírgula decimal, BOM UTF-8. */
export function toCsv(header: string[], rows: Cell[][], moneyFrom: number[]): string {
  const lines = [header, ...withMonth(rows).map((r) => r.map((c, i) => (moneyFrom.includes(i) ? plainEuros(c as number) : String(c))))];
  return "\uFEFF" + lines.map((r) => r.map(csvEscape).join(";")).join("\r\n") + "\r\n";
}

export const SUMMARY_MONEY = [1, 2, 3, 4, 5, 6, 7, 8];
export const MOVES_MONEY = [5];

export function toXlsx(ds: Dataset, view: View, now: Month): Buffer {
  const sheet = (name: string, header: string[], rows: Cell[][], money: number[]): Sheet => ({
    name, moneyCols: money,
    rows: [header, ...withMonth(rows).map((r) => r.map((c, i) => (money.includes(i) ? (c as number) / 100 : c)))],
  });
  return buildXlsx([
    sheet("Resumo mensal", SUMMARY_HEADER, summaryRows(ds, view, now), SUMMARY_MONEY),
    sheet("Movimentos", MOVES_HEADER, movementRows(ds, view, now), MOVES_MONEY),
  ]);
}
