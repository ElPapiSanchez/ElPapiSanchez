export const NAMES = { francisco: "Francisco", carolina: "Carolina", together: "Juntos" };
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const eurFmt = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

export const eur = (c) => eurFmt.format((c ?? 0) / 100);
export const pct = (x, d = 1) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(d).replace(".", ",")} %`);
export const monthLabel = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
export const addMonths = (m, n) => {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + n;
  return `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
};
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const cls = (c) => (c < 0 ? "neg" : "");

/** "1.181,07" | "1181,07" | "1181.07" -> cêntimos inteiros; "" -> 0; inválido -> null. */
export function parseCents(input) {
  let s = String(input).replace(/[€\s]/g, "");
  if (s === "") return 0;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc >= 0) s = s.replace(",", ".");
  const m = /^(-)?(\d*)(?:\.(\d{0,2})\d*)?$/.exec(s);
  if (!m || (m[2] === "" && !m[3])) return null;
  const v = Number(m[2] || "0") * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -v : v;
}
export const centsToInput = (c) => (c ? `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, "0")}` : "");

export async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

let toastTimer;
export function toast(msg, isErr = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast${isErr ? " err" : ""}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isErr ? 5000 : 2000);
}

export function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

/**
 * fields: {name,label,type:text|money|select|month|number|checkbox,value,options:[[v,label]],hint,placeholder}
 * onSubmit recebe os valores (money -> cêntimos, number -> número).
 */
export function formModal({ title, intro, fields, submit = "Guardar", danger = false, onSubmit }) {
  const root = document.getElementById("modal-root");
  const input = (f) => {
    const v = f.value ?? "";
    if (f.type === "select") return `<select name="${f.name}">${f.options.map(([val, lab]) => `<option value="${esc(val)}"${String(val) === String(v) ? " selected" : ""}>${esc(lab)}</option>`).join("")}</select>`;
    if (f.type === "checkbox") return `<input type="checkbox" name="${f.name}"${v ? " checked" : ""}>`;
    if (f.type === "money") return `<input type="text" inputmode="decimal" name="${f.name}" value="${esc(centsToInput(v))}" placeholder="0,00">`;
    if (f.type === "month") return `<input type="month" name="${f.name}" value="${esc(v)}">`;
    if (f.type === "number") return `<input type="number" step="any" name="${f.name}" value="${esc(v)}">`;
    return `<input type="text" name="${f.name}" value="${esc(v)}" placeholder="${esc(f.placeholder ?? "")}">`;
  };
  root.innerHTML = `<div class="modal-bg"><form class="modal" novalidate>
    <h3>${esc(title)}</h3>${intro ? `<p class="muted small">${intro}</p>` : ""}
    ${fields.map((f) => `<div class="field${f.type === "checkbox" ? " check" : ""}">${f.type === "checkbox" ? input(f) : ""}<label>${esc(f.label)}</label>${f.type === "checkbox" ? "" : input(f)}${f.hint ? `<span class="muted small">${f.hint}</span>` : ""}</div>`).join("")}
    <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancelar</button><button class="btn ${danger ? "danger" : "primary"}">${esc(submit)}</button></div>
  </form></div>`;
  const form = root.querySelector("form");
  root.querySelector("[data-close]").onclick = closeModal;
  root.querySelector(".modal-bg").addEventListener("mousedown", (e) => { if (e.target.classList.contains("modal-bg")) closeModal(); });
  form.querySelector("input,select")?.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (f.type === "checkbox") values[f.name] = el.checked;
      else if (f.type === "money") {
        const c = parseCents(el.value);
        if (c === null) return toast(`Valor inválido em "${f.label}"`, true);
        values[f.name] = c;
      } else if (f.type === "number") values[f.name] = el.value === "" ? null : Number(el.value);
      else values[f.name] = el.value;
    }
    try {
      await onSubmit(values);
      closeModal();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

export const confirmModal = (title, text, onYes, label = "Apagar") =>
  formModal({ title, intro: text, fields: [], submit: label, danger: true, onSubmit: onYes });

/* ---------- Gráficos SVG (sem dependências, funciona offline) ---------- */
export const PALETTE = ["#3a5bd9", "#d6438a", "#1f9d8a", "#e0a030", "#8a5cd0", "#e2672b", "#4aa3d8", "#7c8a99", "#a6c34a"];

const compact = (c) => {
  const v = c / 100;
  const a = Math.abs(v);
  return a >= 1000 ? `${(v / 1000).toFixed(a >= 10000 ? 0 : 1).replace(".", ",")}k` : String(Math.round(v));
};

function scaleOf(min, max) {
  if (min === max) max = min + 1;
  const range = max - min;
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(t);
  return { lo, hi, ticks };
}

function frame(labels, ticks, lo, hi, W, H, pad) {
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const iw = W - pad.l - pad.r;
  const grid = ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? "#9aa3b2" : "#e4e8f0"}"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`).join("");
  const every = Math.ceil(labels.length / 12);
  const xl = (i) => pad.l + (i + 0.5) * (iw / labels.length);
  const xt = labels.map((l, i) => (i % every ? "" : `<text x="${xl(i)}" y="${H - pad.b + 16}" text-anchor="middle">${esc(l)}</text>`)).join("");
  return { y, iw, grid, xt, xl };
}

/** series: [{name,color,values}] ; stacked soma valores positivos/negativos separadamente. */
export function barChart({ labels, series, stacked = false, height = 230 }) {
  if (!labels.length) return `<div class="empty">Sem dados para mostrar.</div>`;
  const W = 720, H = height, pad = { l: 44, r: 8, t: 10, b: 26 };
  let max = 0, min = 0;
  labels.forEach((_, i) => {
    if (stacked) {
      max = Math.max(max, series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0));
      min = Math.min(min, series.reduce((s, x) => s + Math.min(0, x.values[i] ?? 0), 0));
    } else series.forEach((x) => { max = Math.max(max, x.values[i] ?? 0); min = Math.min(min, x.values[i] ?? 0); });
  });
  const { lo, hi, ticks } = scaleOf(min, max);
  const f = frame(labels, ticks, lo, hi, W, H, pad);
  const slot = f.iw / labels.length;
  const bw = Math.min(40, (slot * 0.8) / (stacked ? 1 : series.length));
  let bars = "";
  labels.forEach((lab, i) => {
    let pos = 0, neg = 0;
    series.forEach((s, k) => {
      const v = s.values[i] ?? 0;
      if (v === 0) return;
      const x = stacked ? f.xl(i) - bw / 2 : f.xl(i) - (bw * series.length) / 2 + k * bw;
      let y0, y1;
      if (stacked) {
        if (v >= 0) { y0 = f.y(pos + v); y1 = f.y(pos); pos += v; } else { y0 = f.y(neg); y1 = f.y(neg + v); neg += v; }
      } else { y0 = f.y(Math.max(v, 0)); y1 = f.y(Math.min(v, 0)); }
      bars += `<rect x="${x}" y="${y0}" width="${bw - 1}" height="${Math.max(1, y1 - y0)}" rx="2" fill="${s.color}"><title>${esc(lab)} · ${esc(s.name)}: ${eur(v)}</title></rect>`;
    });
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${f.grid}${bars}${f.xt}</svg>${legend(series)}`;
}

export function lineChart({ labels, series, height = 230 }) {
  if (!labels.length) return `<div class="empty">Sem dados para mostrar.</div>`;
  const W = 720, H = height, pad = { l: 44, r: 8, t: 10, b: 26 };
  const all = series.flatMap((s) => s.values.filter((v) => v !== null));
  const { lo, hi, ticks } = scaleOf(Math.min(0, ...all), Math.max(0, ...all));
  const f = frame(labels, ticks, lo, hi, W, H, pad);
  const lines = series.map((s) => {
    const pts = s.values.map((v, i) => (v === null ? null : [f.xl(i), f.y(v), v, i])).filter(Boolean);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
    const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${s.color}"><title>${esc(labels[p[3]])} · ${esc(s.name)}: ${eur(p[2])}</title></circle>`).join("");
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2"${s.dashed ? ' stroke-dasharray="6 4"' : ""}/>${dots}`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${f.grid}${lines}${f.xt}</svg>${legend(series)}`;
}

const legend = (series) => `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
