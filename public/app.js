import {
  NAMES, PALETTE, addMonths, api, barChart, centsToInput, closeModal, confirmModal, cls, eur, esc, formModal,
  lineChart, monthLabel, monthShort, parseCents, pct, toast,
} from "./lib.js";

const state = { view: "francisco", tab: "mes", month: null, order: "desc", meta: null };
const VIEWS = ["francisco", "carolina", "together"];
const TABS = [["mes", "Mês"], ["historico", "Histórico"], ["previsao", "Previsão"], ["regras", "Recorrentes"], ["metas", "Metas e definições"]];
const FREQ = [[1, "Todos os meses"], [2, "De 2 em 2 meses"], [3, "Trimestral"], [4, "De 4 em 4 meses"], [6, "Semestral"], [12, "Anual"]];
const FREQ_NAME = Object.fromEntries(FREQ);
const SUBTYPES = [["salary", "Salário"], ["holiday", "Subsídio de férias"], ["christmas", "Subsídio de Natal"], ["meal", "Subsídio de refeição (separado do dinheiro livre)"], ["other", "Outro rendimento recorrente"]];
const ENTRY_KINDS = [["freelance", "DJ / freelance"], ["bonus", "Bónus de desempenho"], ["other", "Outro rendimento"]];
const ENTRY_KIND_NAME = Object.fromEntries(ENTRY_KINDS);
const EXPENSE_CATS = ["Habitação", "Utilidades", "Transportes", "Desporto", "Subscrições", "Seguros", "Outras recorrentes"];
const $ = (s) => document.querySelector(s);
const tag = (o) => `<span class="tag ${o}">${NAMES[o]}</span>`;
const isTogether = () => state.view === "together";

/* ---------- Navegação ---------- */
function parseHash() {
  const [, v, t, m] = location.hash.split("/");
  if (VIEWS.includes(v)) state.view = v;
  if (TABS.some(([k]) => k === t)) state.tab = t;
  state.month = /^\d{4}-\d{2}$/.test(m ?? "") ? m : state.meta?.now ?? null;
}
const go = (patch = {}) => {
  const s = { ...state, ...patch };
  location.hash = `#/${s.view}/${s.tab}/${s.month ?? ""}`;
};

function chrome() {
  $("#switcher").innerHTML = VIEWS.map((v) => `<button data-view="${v}" class="${state.view === v ? "on" : ""}">${NAMES[v]}</button>`).join("");
  $("#tabs").innerHTML = TABS.map(([k, l]) => `<a href="#/${state.view}/${k}/${state.month}" class="${state.tab === k ? "on" : ""}">${l}</a>`).join("");
}

async function render() {
  chrome();
  const main = $("#main");
  try {
    const html = await ({ mes: pageMonth, historico: pageHistory, previsao: pageForecast, regras: pageRules, metas: pageSettings })[state.tab]();
    main.innerHTML = html;
  } catch (e) {
    main.innerHTML = `<div class="card neg">${esc(e.message)}</div>`;
  }
}
const refresh = async () => { state.meta = await api("GET", "/api/meta"); await render(); };

async function save(promise, ok) {
  try {
    await promise;
    if (ok) toast(ok);
    await refresh();
  } catch (e) {
    toast(e.message, true);
    await render();
  }
}

/* ---------- Mês ---------- */
const kpi = (l, v, s = "", c = "", hero = false) => `<div class="kpi${hero ? " hero" : ""}"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;
const moneyInput = (c, attrs, ph = "0,00") => `<input class="money" type="text" inputmode="decimal" value="${esc(centsToInput(c))}" placeholder="${ph}" ${attrs}>`;

async function pageMonth() {
  const { view, month } = state;
  const [d, months] = await Promise.all([
    api("GET", `/api/month?view=${view}&month=${month}`),
    api("GET", `/api/months?view=${view}&order=${state.order}`),
  ]);
  const s = d.summary;
  const opts = months.map((m) => m.month);
  if (!opts.includes(month)) opts.push(month);
  opts.sort();
  if (state.order === "desc") opts.reverse();
  const nav = `<div class="monthnav">
    <button class="btn" data-go-month="${addMonths(month, -1)}" aria-label="Mês anterior">‹</button>
    <div class="label">${monthLabel(month)}</div>
    <button class="btn" data-go-month="${addMonths(month, 1)}" aria-label="Mês seguinte">›</button>
    <select data-pick-month>${opts.map((m) => `<option value="${m}"${m === month ? " selected" : ""}>${monthLabel(m)}${months.some((x) => x.month === m) ? "" : " (sem dados)"}</option>`).join("")}</select>
    <button class="btn small" data-toggle-order title="Ordem da lista de meses">${state.order === "desc" ? "Mais recentes primeiro" : "Mais antigos primeiro"}</button>
    <button class="btn small" data-go-month="${state.meta.now}">Mês atual</button>
    ${d.hasData ? "" : `<span class="badge warn">Sem dados neste mês</span>`}
  </div>`;
  const owner = (o) => (isTogether() ? tag(o) : "");
  const cards = `<div class="grid">
    ${kpi("Rendimento", eur(s.income.total), `Regular ${eur(s.income.regular)} · adicional ${eur(s.income.additional)}`)}
    ${kpi("Despesas (dinheiro)", eur(s.expenses.cash), `Total ${eur(s.expenses.gross)}${s.expenses.mealCovered ? ` − ${eur(s.expenses.mealCovered)} subsídio` : ""}`)}
    ${kpi("Poupança", eur(s.savings), `Taxa ${pct(s.savingsRate)}`)}
    ${kpi("Investimento", eur(s.investments), `Taxa ${pct(s.investmentRate)}`)}
    ${kpi("Dinheiro disponível", eur(s.remainingCash), `Fluxo líquido ${eur(s.netCashFlow)} · alocado ${eur(s.totalAllocation)}`, cls(s.remainingCash), true)}
  </div>`;
  const mealCard = s.meal.allowance || s.meal.claimed ? `<div class="card"><header><h3>Subsídio de refeição</h3><span class="muted small">Separado do dinheiro livre · não pode ser poupado nem investido</span></header>
    <div class="grid" style="margin:0">
      ${kpi("Subsídio do mês", eur(s.meal.allowance))}${kpi("Usado", eur(s.meal.covered), s.meal.excess ? `<span class="neg">+ ${eur(s.meal.excess)} acima do subsídio (saiu do dinheiro livre)</span>` : "")}
      ${kpi("Por usar", eur(s.meal.remaining), "Não transita para dinheiro livre")}
    </div><div class="bar${s.meal.excess ? " over" : ""}" style="margin-top:10px"><i style="width:${s.meal.allowance ? Math.min(100, (s.meal.covered / s.meal.allowance) * 100) : 0}%"></i></div></div>` : "";

  let together = "";
  if (isTogether()) {
    const p = d.people;
    const rows = [["Rendimento", (x) => x.income.total], ["Subsídio de refeição", (x) => x.income.meal], ["Despesas (dinheiro)", (x) => x.expenses.cash], ["das quais partilhadas", (x) => x.expenses.shared], ["Poupança", (x) => x.savings], ["Investimento", (x) => x.investments], ["Dinheiro disponível", (x) => x.remainingCash]];
    together = `<div class="card"><header><h3>Individual vs. combinado</h3><span class="muted small">As despesas partilhadas entram só como a parte de cada um, por isso nada é contado duas vezes.</span></header>
      <div class="tablewrap"><table><thead><tr><th></th><th class="n">Francisco</th><th class="n">Carolina</th><th class="n">Juntos</th></tr></thead><tbody>
      ${rows.map(([l, f], i) => `<tr${i === rows.length - 1 ? ' class="total"' : ""}><td>${l}</td><td class="n ${i === rows.length - 1 ? cls(f(p.francisco)) : ""}">${eur(f(p.francisco))}</td><td class="n ${i === rows.length - 1 ? cls(f(p.carolina)) : ""}">${eur(f(p.carolina))}</td><td class="n">${eur(f(s))}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }

  /* Rendimentos */
  const incRows = d.income.recurring.map((o) => `<tr class="${o.skipped ? "skipped" : ""}"><td>${esc(o.name)}${owner(o.owner)} ${o.subtype === "meal" ? '<span class="badge">refeição</span>' : o.subtype === "holiday" || o.subtype === "christmas" ? '<span class="badge">adicional</span>' : ""}${o.overridden && !o.skipped ? ' <span class="badge warn">alterado neste mês</span>' : ""}${o.skipped ? ' <span class="badge">ignorado</span>' : ""}</td>
    <td class="n">${moneyInput(o.skipped ? o.baseAmountCents : o.amountCents, `data-act="ovr" data-id="${o.itemId}" data-base="${o.baseAmountCents}"`)}</td>
    <td class="act n"><button class="btn small" data-act="skip" data-id="${o.itemId}" data-skipped="${o.skipped ? 0 : 1}">${o.skipped ? "Repor" : "Ignorar neste mês"}</button></td></tr>`).join("");
  const entryRows = d.income.entries.map((e) => `<tr><td>${esc(e.name)}${owner(e.person)} <span class="badge">${esc(ENTRY_KIND_NAME[e.kind] ?? "adicional")}</span></td><td class="n">${eur(e.amountCents)}</td>
    <td class="act n"><button class="btn small" data-act="editEntry" data-id="${e.id}">Editar</button> <button class="btn small danger" data-act="delEntry" data-id="${e.id}">Apagar</button></td></tr>`).join("");
  const addEntryBtns = (isTogether() ? ["francisco", "carolina"] : [state.view]).map((p) => `<button class="btn small" data-act="addEntry" data-person="${p}">+ Rendimento pontual${isTogether() ? ` (${NAMES[p]})` : ""}</button>`).join(" ");
  const income = `<div class="card"><header><h3>Rendimentos</h3><div class="row">${addEntryBtns}</div></header>
    ${incRows || entryRows ? `<div class="tablewrap"><table><tbody>${incRows}${entryRows}</tbody></table></div>` : `<div class="empty">Sem rendimentos neste mês. Crie salário ou subsídios em <a href="#/${state.view}/regras/${month}">Recorrentes</a>, ou adicione um rendimento pontual (DJ, bónus…).</div>`}</div>`;

  /* Despesas recorrentes */
  const expRows = d.expenses.recurring.map((o) => `<tr class="${o.skipped ? "skipped" : ""}"><td>${esc(o.name)}${owner(o.owner)} ${o.category ? `<span class="badge">${esc(o.category)}</span>` : ""}${o.overridden && !o.skipped ? ' <span class="badge warn">alterado neste mês</span>' : ""}</td>
    <td class="n">${moneyInput(o.skipped ? o.baseAmountCents : o.amountCents, `data-act="ovr" data-id="${o.itemId}"`)}</td>
    <td class="act n"><button class="btn small" data-act="skip" data-id="${o.itemId}" data-skipped="${o.skipped ? 0 : 1}">${o.skipped ? "Repor" : "Ignorar neste mês"}</button></td></tr>`).join("");
  const expenses = `<div class="card"><header><h3>Despesas recorrentes</h3><a class="btn small" href="#/${state.view}/regras/${month}">Gerir recorrentes</a></header>
    ${expRows ? `<div class="tablewrap"><table><tbody>${expRows}</tbody></table></div>` : `<div class="empty">Sem despesas recorrentes neste mês.</div>`}</div>`;

  /* Partilhadas */
  let shared = "";
  if (isTogether()) {
    const sh = d.shared;
    const lines = sh.lines;
    const payerName = (p) => (p === "account" ? "Conta partilhada" : `Pago por ${NAMES[p]}`);
    const lineRows = lines.map((l) => `<tr class="${l.skipped ? "skipped" : ""}"><td>${esc(l.name)} ${l.category ? `<span class="badge">${esc(l.category)}</span>` : ""}${l.source === "recurring" ? ' <span class="badge">recorrente</span>' : ""}</td><td>${payerName(l.payer)}</td><td class="n">${eur(l.amountCents)}</td><td class="n">${eur(l.shareFrancisco)}</td><td class="n">${eur(l.shareCarolina)}</td>
      <td class="act n">${l.source === "oneoff" ? `<button class="btn small" data-act="editShared" data-id="${l.id}">Editar</button> <button class="btn small danger" data-act="delShared" data-id="${l.id}">Apagar</button>` : ""}</td></tr>`).join("");
    const sum = (k) => lines.reduce((a, l) => a + l[k], 0);
    const bal = sh.balanceTotal;
    const balText = bal === 0 ? "Contas certas entre os dois." : bal > 0 ? `A Carolina deve ${eur(bal)} ao Francisco.` : `O Francisco deve ${eur(-bal)} à Carolina.`;
    const stRows = sh.settlements.map((x) => `<tr><td>Acerto: ${NAMES[x.from]} → ${NAMES[x.to]}</td><td class="n">${eur(x.amountCents)}</td><td class="act n"><button class="btn small danger" data-act="delSettle" data-id="${x.id}">Apagar</button></td></tr>`).join("");
    shared = `<div class="card"><header><h3>Despesas partilhadas</h3><div class="row"><button class="btn small" data-act="addShared">+ Despesa partilhada</button><button class="btn small" data-act="addSettle">+ Acerto de contas</button></div></header>
      <p class="muted small">Divisão por defeito proporcional aos salários do mês: Francisco ${pct(sh.proportionalBps / 10000)} · Carolina ${pct(1 - sh.proportionalBps / 10000)}. Pode ajustar manualmente em cada despesa.</p>
      ${lines.length ? `<div class="tablewrap"><table><thead><tr><th>Despesa</th><th>Pagamento</th><th class="n">Total</th><th class="n">Francisco</th><th class="n">Carolina</th><th></th></tr></thead><tbody>${lineRows}<tr class="total"><td>Total</td><td></td><td class="n">${eur(sum("amountCents"))}</td><td class="n">${eur(sum("shareFrancisco"))}</td><td class="n">${eur(sum("shareCarolina"))}</td><td></td></tr></tbody></table></div>` : `<div class="empty">Ainda sem despesas partilhadas — começam a €0 porque ainda não vivem juntos.</div>`}
      ${stRows ? `<table><tbody>${stRows}</tbody></table>` : ""}
      <p><span class="badge ${bal === 0 ? "ok" : "warn"}">Saldo acumulado até ${monthLabel(month)}</span> ${balText}</p></div>`;
  } else if (d.shared.lines.length) {
    const mine = state.view === "francisco" ? "shareFrancisco" : "shareCarolina";
    shared = `<div class="card"><header><h3>A tua parte das despesas partilhadas</h3><a class="btn small" href="#/together/mes/${month}">Ver em Juntos</a></header><table><tbody>
      ${d.shared.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="n">${eur(l[mine])}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* Estilo de vida */
  let lifestyle;
  if (isTogether()) {
    const cats = d.categories.map((c) => {
      const f = d.lifestyle.francisco.find((x) => x.categoryId === c.id), k = d.lifestyle.carolina.find((x) => x.categoryId === c.id);
      return { c, f: f.amountCents, k: k.amountCents, p: (f.prevAmountCents ?? 0) + (k.prevAmountCents ?? 0) };
    }).filter((x) => x.f || x.k);
    lifestyle = `<div class="card"><header><h3>Estilo de vida (combinado)</h3><span class="muted small">Cada pessoa regista os seus totais na sua vista.</span></header>
      ${cats.length ? `<table><thead><tr><th>Categoria</th><th class="n">Francisco</th><th class="n">Carolina</th><th class="n">Total</th></tr></thead><tbody>${cats.map((x) => `<tr><td>${esc(x.c.name)}</td><td class="n">${eur(x.f)}</td><td class="n">${eur(x.k)}</td><td class="n">${eur(x.f + x.k)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">Sem gastos de estilo de vida registados.</div>`}</div>`;
  } else {
    const rows = d.lifestyle[state.view];
    const lim = d.limits[state.view];
    const barOf = (used, limit) => {
      if (!limit) return "";
      const r = used / limit;
      return `<div class="bar ${r > 1 ? "over" : r > 0.85 ? "near" : ""}"><i style="width:${Math.min(100, r * 100)}%"></i></div><span class="small ${r > 1 ? "neg" : "muted"}">${pct(r, 0)} do limite</span>`;
    };
    const delta = (cur, prev) => {
      if (prev === null || (!cur && !prev)) return '<span class="muted">—</span>';
      const x = cur - prev;
      if (x === 0) return '<span class="muted">igual</span>';
      return `<span class="${x > 0 ? "neg" : "pos"}">${x > 0 ? "▲" : "▼"} ${eur(Math.abs(x))}</span>`;
    };
    lifestyle = `<div class="card"><header><h3>Estilo de vida</h3><span class="muted small">Escreva só o total do mês por categoria</span></header>
      <div class="tablewrap"><table><thead><tr><th>Categoria</th><th class="n">Total gasto</th><th class="n">Pago c/ subsídio refeição</th><th class="n">Limite</th><th>Utilização</th><th>vs. mês anterior</th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-cat="${r.categoryId}"><td>${esc(r.name)}</td><td class="n">${moneyInput(r.amountCents, `data-act="life" data-cat="${r.categoryId}" data-f="amt"`)}</td>
        <td class="n">${r.mealEligible ? moneyInput(r.mealCents, `data-act="life" data-cat="${r.categoryId}" data-f="meal"`) : '<span class="muted small">—</span>'}</td>
        <td class="n">${moneyInput(r.limitCents, `data-act="limit" data-cat="${r.categoryId}"`, "sem limite")}</td><td>${barOf(r.amountCents, r.limitCents)}</td><td>${delta(r.amountCents, r.prevAmountCents)}</td></tr>`).join("")}
      <tr class="total"><td>Total de estilo de vida</td><td class="n">${eur(lim.used)}</td><td class="n">${eur(s.meal.claimed)}</td><td class="n">${moneyInput(lim.overall, `data-act="limit" data-cat="0"`, "limite global")}</td><td>${barOf(lim.used, lim.overall)}</td><td>${delta(lim.used, d.prev.hasData ? d.prev.expenses.lifestyle : null)}</td></tr></tbody></table></div>
      <p class="muted small">O subsídio de refeição só pode cobrir categorias de alimentação (marcadas em Metas e definições). O valor pago com o subsídio sai das despesas em dinheiro.</p></div>`;
  }

  /* Poupança e investimento */
  const persons = d.persons;
  const kindBlock = (kind, title) => {
    const dest = d.contributions[persons[0]].filter((x) => x.kind === kind);
    return `<div><h3>${title}</h3><table><thead><tr><th></th>${persons.map((p) => `<th class="n">${NAMES[p]}</th>`).join("")}</tr></thead><tbody>
      ${dest.map((x) => `<tr><td>${esc(x.name)}${x.isMoving ? ' <span class="badge ok">mudança</span>' : ""}</td>${persons.map((p) => `<td class="n">${moneyInput(d.contributions[p].find((c) => c.destinationId === x.destinationId).amountCents, `data-act="contrib" data-person="${p}" data-dest="${x.destinationId}"`)}</td>`).join("")}</tr>`).join("")}
      <tr class="total"><td>Total</td>${persons.map((p) => `<td class="n">${eur(d.contributions[p].filter((x) => x.kind === kind).reduce((a, x) => a + x.amountCents, 0))}</td>`).join("")}</tr></tbody></table></div>`;
  };
  const saving = `<div class="card"><header><h3>Poupança e investimento (escolhidos por si)</h3><span class="muted small">A app nunca transfere nem sugere valores automaticamente</span></header>
    <div class="cols2">${kindBlock("saving", "Poupança")}${kindBlock("investment", "Investimentos")}</div></div>`;

  /* Planeado vs real */
  let planCard = "";
  if (!isTogether()) {
    const pl = d.plan[state.view];
    const row = (l, x) => `<tr><td>${l}</td><td class="n">${x.planned === null ? '<span class="muted">sem plano</span>' : eur(x.planned)}</td><td class="n">${eur(x.actual)}</td><td class="n">${x.planned === null ? "" : `<span class="${x.actual > x.planned && l.startsWith("Estilo") ? "neg" : x.actual < x.planned && !l.startsWith("Estilo") ? "warn" : "pos"}">${eur(x.actual - x.planned)}</span>`}</td></tr>`;
    planCard = `<div class="card"><header><h3>Planeado vs. real</h3><a class="btn small" href="#/${state.view}/previsao/${month}">Definir plano</a></header><table><thead><tr><th></th><th class="n">Planeado</th><th class="n">Real</th><th class="n">Diferença</th></tr></thead><tbody>${row("Estilo de vida", pl.lifestyle)}${row("Poupança", pl.saving)}${row("Investimento", pl.investment)}</tbody></table></div>`;
  }

  const goals = d.goals.length ? `<div class="card"><header><h3>Metas</h3><a class="btn small" href="#/${state.view}/metas/${month}">Ver metas</a></header>${d.goals.map(goalHtml).join("")}</div>` : "";
  return nav + cards + together + mealCard + income + expenses + shared + lifestyle + saving + planCard + goals;
}

const STATUS = { "no-target": ["Defina um objetivo", ""], reached: ["Objetivo atingido", "ok"], ahead: ["Adiantados", "ok"], "on-track": ["No caminho certo", "ok"], behind: ["Atrasados", "bad"] };
function goalHtml(g) {
  const [st, c] = STATUS[g.status];
  return `<div style="margin-bottom:14px"><div class="row"><strong>${esc(g.name)}</strong> <span class="badge ${c}">${st}</span><span class="spacer"></span><span>${eur(g.savedCents)}${g.targetCents ? ` / ${eur(g.targetCents)}` : ""}</span></div>
    <div class="bar"><i style="width:${(g.progress ?? 0) * 100}%"></i></div>
    <div class="muted small">${g.progress !== null ? `${pct(g.progress)} · falta ${eur(g.remainingCents)}` : "Sem valor-alvo definido"}${g.neededPerMonth !== null ? ` · necessário ${eur(g.neededPerMonth)}/mês durante ${g.monthsLeft} meses · ritmo recente ${eur(g.recentAvgPerMonth)}/mês` : ""}</div></div>`;
}

/* ---------- Histórico ---------- */
async function pageHistory() {
  const h = await api("GET", `/api/history?view=${state.view}`);
  const rows = h.rows;
  const labels = rows.map((r) => monthShort(r.month));
  if (!rows.length) return `<div class="card empty">Ainda não há meses com dados. Os meses aparecem automaticamente quando adicionar rendimentos, despesas, poupança ou investimento.</div>`;
  const S = (f) => rows.map((r) => f(r.summary));
  const catSeries = h.categories.map((n, i) => ({ name: n, color: PALETTE[i % PALETTE.length], values: rows.map((r) => r.categories[n] ?? 0) })).filter((s) => s.values.some(Boolean));
  const list = (state.order === "desc" ? [...rows].reverse() : rows);
  const person = isTogether() ? `<div class="card"><h3>Individual vs. combinado (dinheiro disponível)</h3>${barChart({ labels, series: [{ name: "Francisco", color: PALETTE[0], values: rows.map((r) => r.people.francisco.remainingCash) }, { name: "Carolina", color: PALETTE[1], values: rows.map((r) => r.people.carolina.remainingCash) }, { name: "Juntos", color: PALETTE[2], values: S((s) => s.remainingCash) }] })}</div>` : "";
  return `<div class="card"><header><h3>Meses com dados</h3><div class="row"><button class="btn small" data-toggle-order>${state.order === "desc" ? "Mais recentes primeiro" : "Mais antigos primeiro"}</button></div></header>
    <div class="tablewrap"><table><thead><tr><th>Mês</th><th class="n">Rendimento</th><th class="n">Despesas (dinheiro)</th><th class="n">Poupança</th><th class="n">Investimento</th><th class="n">Disponível</th></tr></thead><tbody>
    ${list.map((r) => `<tr><td><a href="#/${state.view}/mes/${r.month}">${monthLabel(r.month)}</a></td><td class="n">${eur(r.summary.income.total)}</td><td class="n">${eur(r.summary.expenses.cash)}</td><td class="n">${eur(r.summary.savings)}</td><td class="n">${eur(r.summary.investments)}</td><td class="n ${cls(r.summary.remainingCash)}">${eur(r.summary.remainingCash)}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="card"><h3>Receitas vs. despesas</h3>${barChart({ labels, series: [{ name: "Rendimento", color: "#1f9d8a", values: S((s) => s.income.total) }, { name: "Despesas (dinheiro)", color: "#d6438a", values: S((s) => s.expenses.cash) }] })}</div>
  <div class="card"><h3>Despesas de estilo de vida por categoria</h3>${barChart({ labels, series: catSeries, stacked: true })}</div>
  <div class="card"><h3>Poupança e investimento por mês</h3>${barChart({ labels, stacked: true, series: [{ name: "Poupança", color: "#3a5bd9", values: S((s) => s.savings) }, { name: "Investimento", color: "#e0a030", values: S((s) => s.investments) }] })}</div>
  <div class="card"><h3>Contribuições acumuladas</h3>${lineChart({ labels, series: [{ name: "Poupança acumulada", color: "#3a5bd9", values: h.cumulative.map((c) => c.saving) }, { name: "Investimento acumulado", color: "#e0a030", values: h.cumulative.map((c) => c.investment) }] })}</div>
  <div class="card"><h3>Dinheiro disponível por mês</h3>${barChart({ labels, series: [{ name: "Dinheiro disponível", color: "#3a5bd9", values: S((s) => s.remainingCash) }] })}</div>
  ${person}
  <div class="card"><header><h3>Resumo anual</h3></header><div class="tablewrap"><table><thead><tr><th>Ano</th><th class="n">Meses</th><th class="n">Rendimento</th><th class="n">Despesas (dinheiro)</th><th class="n">Poupança</th><th class="n">Investimento</th><th class="n">Disponível</th></tr></thead><tbody>
  ${h.years.map((y) => `<tr><td>${y.year}</td><td class="n">${y.months}</td><td class="n">${eur(y.income)}</td><td class="n">${eur(y.cashExpenses)}</td><td class="n">${eur(y.savings)}</td><td class="n">${eur(y.investments)}</td><td class="n ${cls(y.remainingCash)}">${eur(y.remainingCash)}</td></tr>`).join("")}</tbody></table></div></div>`;
}

/* ---------- Previsão ---------- */
async function pageForecast() {
  const rows = await api("GET", `/api/forecast?view=${state.view}&from=${addMonths(state.meta.now, 1)}`);
  const labels = rows.map((r) => monthShort(r.month));
  const persons = isTogether() ? ["francisco", "carolina"] : [state.view];
  const planned = (p, k) => state.meta.plans.find((x) => x.person === p && x.kind === k)?.amountCents ?? null;
  const planCard = `<div class="card"><header><h3>Plano mensal (preenchido por si)</h3><span class="muted small">Usado na previsão quando o mês ainda não tem valores reais</span></header>
    <table><thead><tr><th></th>${persons.map((p) => `<th class="n">${NAMES[p]}</th>`).join("")}</tr></thead><tbody>
    ${[["saving", "Poupança planeada"], ["investment", "Investimento planeado"], ["lifestyle", "Estilo de vida estimado (se não houver histórico)"]].map(([k, l]) => `<tr><td>${l}</td>${persons.map((p) => `<td class="n">${moneyInput(planned(p, k), `data-act="plan" data-person="${p}" data-kind="${k}"`)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  return `<div class="card"><header><h3>Previsão a 12 meses — ${NAMES[state.view]}</h3></header>
    <p class="muted small">Baseada em rendimentos e despesas recorrentes (incluindo subsídios e alterações futuras), na média dos últimos 3 meses de estilo de vida e na poupança/investimento planeados.</p>
    ${lineChart({ labels, series: [{ name: "Rendimento", color: "#1f9d8a", values: rows.map((r) => r.income) }, { name: "Despesas", color: "#d6438a", values: rows.map((r) => r.cashExpenses) }, { name: "Disponível", color: "#3a5bd9", values: rows.map((r) => r.remainingCash), dashed: true }] })}
    <div class="tablewrap"><table><thead><tr><th>Mês</th><th class="n">Rendimento</th><th class="n">Despesas</th><th class="n">Poupança</th><th class="n">Investimento</th><th class="n">Disponível</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${monthLabel(r.month)}</td><td class="n">${eur(r.income)}</td><td class="n">${eur(r.cashExpenses)}</td><td class="n">${eur(r.savings)}</td><td class="n">${eur(r.investments)}</td><td class="n ${cls(r.remainingCash)}">${eur(r.remainingCash)}</td></tr>`).join("")}</tbody></table></div></div>${planCard}`;
}

/* ---------- Recorrentes ---------- */
async function pageRules() {
  const list = await api("GET", `/api/recurring?view=${state.view}&month=${state.month}`);
  const row = (r) => {
    const c = r.current;
    const inactive = !c || !c.active;
    const hist = r.versions.length > 1 ? `<details class="small muted"><summary>Histórico de alterações</summary>${r.versions.map((v) => `<div>desde ${monthLabel(v.fromMonth)}: ${v.active ? `${eur(v.amountCents)} · ${FREQ_NAME[v.intervalMonths]}` : "desativado"}</div>`).join("")}</details>` : "";
    return `<tr><td>${esc(c?.name ?? "")}${c?.category ? ` <span class="badge">${esc(c.category)}</span>` : ""}${r.subtype === "meal" ? ' <span class="badge">refeição</span>' : ""}${inactive ? ' <span class="badge bad">inativo neste mês</span>' : ""}${hist}</td>
      <td>${c ? FREQ_NAME[c.intervalMonths] : ""}${c && c.intervalMonths > 1 ? ` <span class="muted small">(desde ${monthLabel(r.startMonth)})</span>` : ""}</td><td class="n">${c ? eur(c.amountCents) : ""}</td>
      <td class="act n"><button class="btn small" data-act="editRule" data-id="${r.id}">Editar</button> <button class="btn small" data-act="toggleRule" data-id="${r.id}" data-active="${inactive ? 1 : 0}">${inactive ? "Reativar" : "Desativar"}</button> <button class="btn small danger" data-act="delRule" data-id="${r.id}">Apagar</button></td></tr>`;
  };
  const income = list.filter((r) => r.type === "income"), exp = list.filter((r) => r.type === "expense");
  const table = (items, empty) => items.length ? `<div class="tablewrap"><table><thead><tr><th>Nome</th><th>Frequência</th><th class="n">Valor (em ${monthLabel(state.month)})</th><th></th></tr></thead><tbody>${items.map(row).join("")}</tbody></table></div>` : `<div class="empty">${empty}</div>`;
  const allowances = income.filter((r) => r.subtype === "holiday" || r.subtype === "christmas");
  const yr = Number(state.meta.now.slice(0, 4));
  const allowCard = allowances.length ? `<div class="card"><header><h3>Subsídios de férias e Natal</h3></header>
    <p class="muted small">Gerados automaticamente todos os anos. Desmarque um ano para o ignorar (por exemplo, para quem recebe em 12 meses).</p>
    <table><tbody>${allowances.map((r) => {
      const mo = r.startMonth.slice(5);
      const years = [...new Set([Number(r.startMonth.slice(0, 4)), yr, yr + 1, yr + 2])].filter((y) => y >= Number(r.startMonth.slice(0, 4))).sort();
      return `<tr><td>${esc(r.current?.name ?? "")} <span class="muted small">(${monthLabel(r.startMonth).split(" ")[0]})</span></td><td>${years.map((y) => {
        const m = `${y}-${mo}`;
        const skipped = r.overrides.some((o) => o.month === m && o.skipped);
        return `<label style="margin-right:12px"><input type="checkbox" data-act="allow" data-id="${r.id}" data-month="${m}" ${skipped ? "" : "checked"}> ${y}</label>`;
      }).join("")}</td><td class="n">${r.current ? eur(r.current.amountCents) : ""}</td></tr>`;
    }).join("")}</tbody></table></div>` : "";
  return `<div class="card"><header><h3>Rendimentos recorrentes — ${NAMES[state.view]}</h3><button class="btn primary small" data-act="addRule" data-type="income" ${isTogether() ? "disabled" : ""}>+ Novo rendimento</button></header>
    ${isTogether() ? '<div class="empty">Os rendimentos são de cada pessoa — veja-os na vista Francisco ou Carolina.</div>' : table(income, "Sem rendimentos recorrentes. Adicione o salário e, se aplicável, o subsídio de refeição.")}
    <p class="muted small">Ao editar, escolhe o mês a partir do qual a alteração vale; os meses anteriores ficam como estavam.</p></div>${allowCard}
  <div class="card"><header><h3>Despesas recorrentes — ${NAMES[state.view]}</h3><button class="btn primary small" data-act="addRule" data-type="expense">+ Nova despesa</button></header>
    ${table(exp, isTogether() ? "Sem despesas partilhadas recorrentes (renda, condomínio, internet…)." : "Sem despesas recorrentes (ginásio, passe, subscrições…).")}</div>`;
}

function ruleFields(r, { editing, type }) {
  const together = isTogether();
  const c = r?.current;
  const f = [];
  if (type === "income") f.push({ name: "subtype", label: "Tipo", type: "select", options: SUBTYPES, value: r?.subtype ?? "salary" });
  f.push({ name: "name", label: "Nome", type: "text", value: c?.name ?? "" });
  if (type === "expense") f.push({ name: "category", label: "Categoria", type: "text", value: c?.category ?? "", placeholder: EXPENSE_CATS.join(", ") });
  f.push({ name: "amountCents", label: "Valor (€)", type: "money", value: c?.amountCents ?? 0 });
  if (!editing || c) f.push({ name: "intervalMonths", label: "Frequência", type: "select", options: FREQ, value: c?.intervalMonths ?? 1 });
  if (together && type === "expense") {
    f.push({ name: "payer", label: "Quem paga", type: "select", options: [["account", "Conta partilhada (cada um contribui a sua parte)"], ["francisco", "Pago pelo Francisco"], ["carolina", "Pago pela Carolina"]], value: c?.payer ?? "account" });
    f.push({ name: "pctF", label: "Parte do Francisco (%) — vazio = proporcional aos salários", type: "number", value: c?.splitFrancisco != null ? c.splitFrancisco / 100 : "" });
  }
  f.push(editing
    ? { name: "fromMonth", label: "Aplicar a partir de", type: "month", value: state.month, hint: "Os meses anteriores não são alterados." }
    : { name: "startMonth", label: "Começa em", type: "month", value: state.month, hint: "Para frequências superiores a mensal, este mês define quando se repete." });
  return f;
}

const splitOf = (v) => (v.pctF === null || v.pctF === undefined || v.pctF === "" ? null : Math.round(Number(v.pctF) * 100));

/* ---------- Metas e definições ---------- */
async function pageSettings() {
  const [goals, meta] = await Promise.all([api("GET", "/api/goals"), api("GET", "/api/meta")]);
  const moving = goals.find((g) => g.isMoving);
  const movingDest = meta.destinations.find((d) => d.isMoving);
  const others = goals.filter((g) => !g.isMoving);
  const st = STATUS[moving.status];
  const movingCard = `<div class="card"><header><h3>Meta: mudança para casa em ${monthLabel(meta.goal.targetMonth)}</h3><button class="btn primary small" data-act="editGoal">Editar meta</button></header>
    <div class="grid">${kpi("Objetivo", moving.targetCents ? eur(moving.targetCents) : "Por definir")}${kpi("Poupado", eur(moving.savedCents), `Inclui saldo inicial ${eur(moving.openingCents)}`)}${kpi("Falta", moving.remainingCents === null ? "—" : eur(moving.remainingCents), moving.progress !== null ? pct(moving.progress) : "")}${kpi("Necessário por mês", moving.neededPerMonth === null ? "—" : eur(moving.neededPerMonth), moving.monthsLeft ? `${moving.monthsLeft} meses até à data` : "")}</div>
    <div class="bar"><i style="width:${(moving.progress ?? 0) * 100}%"></i></div>
    <p><span class="badge ${st[1]}">${st[0]}</span> <span class="muted small">Ritmo médio recente (3 meses): ${eur(moving.recentAvgPerMonth)}/mês. Sem rendimento de investimento assumido.</span></p>
    <table><thead><tr><th>Contribuições acumuladas</th><th class="n">Valor</th></tr></thead><tbody><tr><td>Francisco</td><td class="n">${eur(moving.perPerson.francisco)}</td></tr><tr><td>Carolina</td><td class="n">${eur(moving.perPerson.carolina)}</td></tr><tr class="total"><td>Total das contribuições</td><td class="n">${eur(moving.perPerson.francisco + moving.perPerson.carolina)}</td></tr></tbody></table></div>`;
  const otherCard = `<div class="card"><header><h3>Destinos de poupança e investimento</h3><div class="row"><button class="btn small" data-act="addDest" data-kind="saving">+ Meta de poupança</button><button class="btn small" data-act="addDest" data-kind="investment">+ Destino de investimento</button></div></header>
    ${others.length ? others.filter((g) => g.targetCents).map(goalHtml).join("") : ""}
    <table><thead><tr><th>Nome</th><th>Tipo</th><th class="n">Objetivo</th><th></th></tr></thead><tbody>${meta.destinations.map((d) => `<tr><td>${esc(d.name)}${d.isMoving ? ' <span class="badge ok">mudança</span>' : ""}</td><td>${d.kind === "saving" ? "Poupança" : "Investimento"}</td><td class="n">${d.kind === "saving" && !d.isMoving ? (d.targetCents ? eur(d.targetCents) : "—") : ""}</td>
      <td class="act n">${d.isMoving ? "" : `<button class="btn small" data-act="editDest" data-id="${d.id}">Editar</button> <button class="btn small danger" data-act="delDest" data-id="${d.id}">Apagar</button>`}</td></tr>`).join("")}</tbody></table></div>`;
  const catCard = `<div class="card"><header><h3>Categorias de estilo de vida</h3><button class="btn small" data-act="addCat">+ Categoria</button></header>
    <table><thead><tr><th>Nome</th><th>Pode usar subsídio de refeição</th><th></th></tr></thead><tbody>${meta.categories.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.mealEligible ? "Sim" : "Não"}</td><td class="act n"><button class="btn small" data-act="editCat" data-id="${c.id}">Editar</button> <button class="btn small danger" data-act="delCat" data-id="${c.id}">Apagar</button></td></tr>`).join("")}</tbody></table>
    <p class="muted small">Limites por categoria e global definem-se na página do mês (em cada pessoa).</p></div>`;
  const openCard = `<div class="card"><header><h3>Saldos iniciais</h3></header>
    <p class="muted small">Poupança que já existe hoje. Conta para as metas e totais acumulados, sem criar meses no histórico.</p>
    <table><thead><tr><th></th><th class="n">Francisco</th><th class="n">Carolina</th></tr></thead><tbody>${meta.destinations.map((d) => `<tr><td>${esc(d.name)}${d.isMoving ? ' <span class="badge ok">mudança</span>' : ""}</td>${["francisco", "carolina"].map((p) => `<td class="n">${moneyInput(meta.openings.find((o) => o.person === p && o.destinationId === d.id)?.amountCents ?? 0, `data-act="opening" data-person="${p}" data-dest="${d.id}"`)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const exp = `<div class="card"><header><h3>Exportar dados (${NAMES[state.view]})</h3></header><div class="row">
    <a class="btn" href="/api/export.xlsx?view=${state.view}">Excel (.xlsx)</a>
    <a class="btn" href="/api/export.csv?view=${state.view}&type=resumo">CSV — resumo mensal</a>
    <a class="btn" href="/api/export.csv?view=${state.view}&type=movimentos">CSV — movimentos</a></div>
    <p class="muted small">Para guardar uma cópia de segurança completa, copie o ficheiro SQLite (ver README).</p></div>`;
  return movingCard + openCard + otherCard + catCard + exp;
}

/* ---------- Ações ---------- */
const val = (el) => el.value;
function readMoney(el) {
  const c = parseCents(val(el));
  if (c === null || c < 0) { toast("Valor inválido", true); return null; }
  return c;
}

const actions = {
  ovr(el) {
    const c = readMoney(el);
    if (c === null) return render();
    const base = Number(el.dataset.base ?? NaN);
    const same = el.dataset.base !== undefined && c === base;
    return save(api("PUT", `/api/recurring/${el.dataset.id}/override`, { month: state.month, skipped: false, amountCents: same ? null : c }));
  },
  skip: (el) => save(api("PUT", `/api/recurring/${el.dataset.id}/override`, { month: state.month, skipped: el.dataset.skipped === "1", amountCents: null })),
  allow: (el) => save(api("PUT", `/api/recurring/${el.dataset.id}/override`, { month: el.dataset.month, skipped: !el.checked, amountCents: null }), "Guardado"),
  life(el) {
    const tr = el.closest("tr");
    const a = tr.querySelector('[data-f="amt"]'), m = tr.querySelector('[data-f="meal"]');
    const amt = readMoney(a), meal = m ? readMoney(m) : 0;
    if (amt === null || meal === null) return render();
    return save(api("PUT", "/api/lifestyle", { person: state.view, month: state.month, categoryId: Number(el.dataset.cat), amountCents: amt, mealCents: meal }));
  },
  limit(el) {
    const c = readMoney(el);
    if (c === null) return render();
    return save(api("PUT", "/api/limits", { person: state.view, categoryId: Number(el.dataset.cat), limitCents: val(el).trim() === "" ? null : c }));
  },
  contrib(el) {
    const c = readMoney(el);
    if (c === null) return render();
    return save(api("PUT", "/api/contribution", { person: el.dataset.person, month: state.month, destinationId: Number(el.dataset.dest), amountCents: c }));
  },
  opening(el) {
    const c = readMoney(el);
    if (c === null) return render();
    return save(api("PUT", "/api/opening", { person: el.dataset.person, destinationId: Number(el.dataset.dest), amountCents: c }));
  },
  plan(el) {
    const c = readMoney(el);
    if (c === null) return render();
    return save(api("PUT", "/api/plans", { person: el.dataset.person, kind: el.dataset.kind, amountCents: val(el).trim() === "" ? null : c }));
  },
  addEntry(el) {
    formModal({
      title: `Rendimento pontual — ${monthLabel(state.month)}`, intro: `Registado em ${NAMES[el.dataset.person]} neste mês.`,
      fields: [{ name: "name", label: "Descrição", type: "text" }, { name: "kind", label: "Tipo", type: "select", options: ENTRY_KINDS, value: "freelance" }, { name: "amountCents", label: "Valor (€)", type: "money" }],
      onSubmit: (v) => save(api("POST", "/api/income-entries", { ...v, person: el.dataset.person, month: state.month }), "Rendimento adicionado"),
    });
  },
  async editEntry(el) {
    const d = await api("GET", `/api/month?view=${state.view}&month=${state.month}`);
    const e = d.income.entries.find((x) => x.id === Number(el.dataset.id));
    formModal({
      title: "Editar rendimento pontual",
      fields: [{ name: "name", label: "Descrição", type: "text", value: e.name }, { name: "kind", label: "Tipo", type: "select", options: ENTRY_KINDS, value: e.kind }, { name: "amountCents", label: "Valor (€)", type: "money", value: e.amountCents }, { name: "month", label: "Mês", type: "month", value: e.month }],
      onSubmit: (v) => save(api("PUT", `/api/income-entries/${e.id}`, v), "Guardado"),
    });
  },
  delEntry: (el) => confirmModal("Apagar rendimento?", "Este rendimento deixa de contar no mês.", () => save(api("DELETE", `/api/income-entries/${el.dataset.id}`))),

  addShared() { sharedForm(null); },
  async editShared(el) {
    const d = await api("GET", `/api/month?view=together&month=${state.month}`);
    sharedForm(d.shared.oneoff.find((x) => x.id === Number(el.dataset.id)));
  },
  delShared: (el) => confirmModal("Apagar despesa partilhada?", "A despesa deixa de contar para os dois.", () => save(api("DELETE", `/api/shared-expenses/${el.dataset.id}`))),
  addSettle() {
    formModal({
      title: "Acerto de contas", intro: "Registe quando um paga ao outro o que ficou a dever. Não altera o dinheiro disponível, só o saldo.",
      fields: [{ name: "from", label: "Quem pagou", type: "select", options: [["carolina", "Carolina"], ["francisco", "Francisco"]] }, { name: "amountCents", label: "Valor (€)", type: "money" }],
      onSubmit: (v) => save(api("POST", "/api/settlements", { from: v.from, to: v.from === "carolina" ? "francisco" : "carolina", amountCents: v.amountCents, month: state.month }), "Acerto registado"),
    });
  },
  delSettle: (el) => confirmModal("Apagar acerto?", "O saldo volta a refletir a dívida.", () => save(api("DELETE", `/api/settlements/${el.dataset.id}`))),

  addRule(el) {
    const type = el.dataset.type;
    formModal({
      title: type === "income" ? "Novo rendimento recorrente" : "Nova despesa recorrente", fields: ruleFields(null, { editing: false, type }),
      onSubmit: (v) => save(api("POST", "/api/recurring", { type, owner: state.view, subtype: v.subtype, name: v.name, category: v.category, amountCents: v.amountCents, intervalMonths: Number(v.intervalMonths), startMonth: v.startMonth, payer: v.payer ?? "account", splitFrancisco: splitOf(v) }), "Criado"),
    });
  },
  async editRule(el) {
    const list = await api("GET", `/api/recurring?view=${state.view}&month=${state.month}`);
    const r = list.find((x) => x.id === Number(el.dataset.id));
    formModal({
      title: `Editar “${r.current?.name ?? ""}”`, intro: "A alteração vale do mês escolhido em diante. Meses anteriores ficam intactos.",
      fields: ruleFields(r, { editing: true, type: r.type }),
      onSubmit: (v) => save(api("PUT", `/api/recurring/${r.id}`, { fromMonth: v.fromMonth, name: v.name, category: v.category, amountCents: v.amountCents, intervalMonths: Number(v.intervalMonths), ...(isTogether() ? { payer: v.payer, splitFrancisco: splitOf(v) } : {}) }), "Guardado"),
    });
  },
  toggleRule(el) {
    const active = el.dataset.active === "1";
    formModal({
      title: active ? "Reativar" : "Desativar", intro: active ? "Volta a contar a partir do mês escolhido." : "Deixa de contar a partir do mês escolhido. O histórico anterior mantém-se.",
      fields: [{ name: "fromMonth", label: "A partir de", type: "month", value: state.month }], submit: active ? "Reativar" : "Desativar",
      onSubmit: (v) => save(api("PUT", `/api/recurring/${el.dataset.id}`, { fromMonth: v.fromMonth, active }), "Guardado"),
    });
  },
  delRule: (el) => confirmModal("Apagar definitivamente?", "Isto remove a regra de TODOS os meses, incluindo os passados. Para manter o histórico, use “Desativar” em vez de apagar.", () => save(api("DELETE", `/api/recurring/${el.dataset.id}`))),

  editGoal() {
    api("GET", "/api/meta").then((meta) => {
      const dest = meta.destinations.find((d) => d.isMoving);
      formModal({
        title: "Meta de mudança", intro: "Pode deixar o objetivo vazio até estar definido.",
        fields: [{ name: "targetMonth", label: "Data da mudança", type: "month", value: meta.goal.targetMonth }, { name: "targetCents", label: "Valor-alvo (€)", type: "money", value: meta.goal.targetCents ?? 0 }, ],
        onSubmit: (v) => save(api("PUT", "/api/goal", { targetMonth: v.targetMonth, targetCents: v.targetCents ? v.targetCents : null }), "Meta guardada"),
      });
    });
  },
  addDest(el) { destForm(null, el.dataset.kind); },
  async editDest(el) {
    const meta = await api("GET", "/api/meta");
    const d = meta.destinations.find((x) => x.id === Number(el.dataset.id));
    destForm(d, d.kind);
  },
  delDest: (el) => confirmModal("Apagar destino?", "Só é possível se ainda não tiver contribuições.", () => save(api("DELETE", `/api/destinations/${el.dataset.id}`))),
  addCat() { catForm(null); },
  async editCat(el) {
    const meta = await api("GET", "/api/meta");
    catForm(meta.categories.find((x) => x.id === Number(el.dataset.id)));
  },
  delCat: (el) => confirmModal("Apagar categoria?", "Só é possível se ainda não tiver valores registados.", () => save(api("DELETE", `/api/categories/${el.dataset.id}`))),
};

function sharedForm(e) {
  formModal({
    title: e ? "Editar despesa partilhada" : `Despesa partilhada — ${monthLabel(state.month)}`,
    fields: [
      { name: "name", label: "Descrição", type: "text", value: e?.name ?? "" }, { name: "category", label: "Categoria", type: "text", value: e?.category ?? "" },
      { name: "amountCents", label: "Valor total (€)", type: "money", value: e?.amountCents ?? 0 },
      { name: "payer", label: "Quem pagou", type: "select", value: e?.payer ?? "account", options: [["account", "Conta partilhada (cada um contribui a sua parte)"], ["francisco", "Francisco (fica a receber)"], ["carolina", "Carolina (fica a receber)"]] },
      { name: "pctF", label: "Parte do Francisco (%) — vazio = proporcional aos salários", type: "number", value: e?.splitFrancisco != null ? e.splitFrancisco / 100 : "" },
    ],
    onSubmit: (v) => {
      const body = { name: v.name, category: v.category, amountCents: v.amountCents, payer: v.payer, splitFrancisco: splitOf(v), month: state.month };
      return save(e ? api("PUT", `/api/shared-expenses/${e.id}`, body) : api("POST", "/api/shared-expenses", body), "Guardado");
    },
  });
}
function destForm(d, kind) {
  const saving = kind === "saving";
  formModal({
    title: d ? "Editar destino" : saving ? "Nova meta de poupança" : "Novo destino de investimento",
    fields: [{ name: "name", label: "Nome", type: "text", value: d?.name ?? "" }, ...(saving ? [{ name: "targetCents", label: "Objetivo (€) — opcional", type: "money", value: d?.targetCents ?? 0 }] : [])],
    onSubmit: (v) => {
      const body = { kind, name: v.name, targetCents: saving && v.targetCents ? v.targetCents : null };
      return save(d ? api("PUT", `/api/destinations/${d.id}`, body) : api("POST", "/api/destinations", body), "Guardado");
    },
  });
}
function catForm(c) {
  formModal({
    title: c ? "Editar categoria" : "Nova categoria",
    fields: [{ name: "name", label: "Nome", type: "text", value: c?.name ?? "" }, { name: "mealEligible", label: "Pode ser paga com subsídio de refeição (alimentação)", type: "checkbox", value: c?.mealEligible ?? false }],
    onSubmit: (v) => save(c ? api("PUT", `/api/categories/${c.id}`, v) : api("POST", "/api/categories", v), "Guardado"),
  });
}

/* ---------- Eventos globais ---------- */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.view) return go({ view: t.dataset.view });
  if (t.dataset.goMonth) return go({ month: t.dataset.goMonth });
  if ("toggleOrder" in t.dataset) { state.order = state.order === "desc" ? "asc" : "desc"; return render(); }
  if (t.dataset.act && t.tagName === "BUTTON" && !t.dataset.change) actions[t.dataset.act]?.(t);
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if ("pickMonth" in t.dataset) return go({ month: t.value });
  if (t.dataset.act && (t.tagName === "INPUT" || t.tagName === "SELECT")) actions[t.dataset.act]?.(t);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input.money")) e.target.blur();
  if (e.key === "Escape") closeModal();
});
window.addEventListener("hashchange", () => { parseHash(); render(); });

state.meta = await api("GET", "/api/meta");
parseHash();
if (!location.hash) go({ month: state.meta.now }); else render();
