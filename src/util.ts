export type Month = string; // "YYYY-MM"

export function parseMonth(m: Month): { y: number; mo: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(m);
  if (!match) throw new Error(`Mês inválido: ${m}`);
  return { y: Number(match[1]), mo: Number(match[2]) };
}

export function isMonth(m: unknown): m is Month {
  return typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

export function monthIndex(m: Month): number {
  const { y, mo } = parseMonth(m);
  return y * 12 + (mo - 1);
}

export function fromIndex(i: number): Month {
  const y = Math.floor(i / 12);
  return `${String(y).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
}

export function addMonths(m: Month, n: number): Month {
  return fromIndex(monthIndex(m) + n);
}

export function monthDiff(from: Month, to: Month): number {
  return monthIndex(to) - monthIndex(from);
}

export function currentMonth(now: Date = new Date()): Month {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Converte "1181,07", "1.181,07", "1181.07" ou "€ 12" em cêntimos inteiros. */
export function parseCents(input: string | number): number {
  if (typeof input === "number") return Math.round(input * 100);
  let s = input.replace(/[€\s]/g, "");
  if (s === "") return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(",", ".");
  }
  const m = /^(-)?(\d*)(?:\.(\d{0,2})\d*)?$/.exec(s);
  if (!m || (m[2] === "" && !m[3])) throw new Error(`Valor inválido: ${input}`);
  const cents = Number(m[2] || "0") * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -cents : cents;
}

/** Formata cêntimos como texto pt-PT, ex.: "1181,07" (sem milhares, para CSV). */
export function plainEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function monthLabel(m: Month): string {
  const { y, mo } = parseMonth(m);
  return `${MONTHS_PT[mo - 1]} ${y}`;
}

/** Divide `total` em duas partes proporcionais a `a` e `b`; a soma é sempre exatamente `total`. */
export function splitProportional(total: number, a: number, b: number): [number, number] {
  const sum = a + b;
  if (sum <= 0) {
    const first = Math.round(total / 2);
    return [first, total - first];
  }
  const first = Math.round((total * a) / sum);
  return [first, total - first];
}
