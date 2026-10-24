import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, route } from "./api.ts";
import { loadDataset, openDb } from "./db.ts";
import { MOVES_HEADER, MOVES_MONEY, SUMMARY_HEADER, SUMMARY_MONEY, movementRows, summaryRows, toCsv, toXlsx } from "./export.ts";
import { type View, PEOPLE } from "./calc.ts";
import { currentMonth } from "./util.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(root, "public");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_FILE = process.env.DB_FILE ?? join(root, "data", "financas.sqlite");

const db = openDb(DB_FILE);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

function lanUrls(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) out.push(`http://${i.address}:${PORT}`);
  }
  return out;
}

async function readBody(req: import("node:http").IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1e6) throw new HttpError(413, "Pedido demasiado grande");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const send = (status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
    res.end(body);
  };
  try {
    if (url.pathname.startsWith("/api/export.")) {
      const viewParam = url.searchParams.get("view") ?? "together";
      if (viewParam !== "together" && !PEOPLE.includes(viewParam as never)) throw new HttpError(400, "Vista inválida");
      const view = viewParam as View;
      const ds = loadDataset(db);
      const now = currentMonth();
      const stamp = now;
      if (url.pathname === "/api/export.xlsx") {
        return send(200, toXlsx(ds, view, now), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          { "Content-Disposition": `attachment; filename="financas-${view}-${stamp}.xlsx"` });
      }
      const kind = url.searchParams.get("type") === "movimentos" ? "movimentos" : "resumo";
      const csv = kind === "movimentos"
        ? toCsv(MOVES_HEADER, movementRows(ds, view, now), MOVES_MONEY)
        : toCsv(SUMMARY_HEADER, summaryRows(ds, view, now), SUMMARY_MONEY);
      return send(200, csv, "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="financas-${view}-${kind}-${stamp}.csv"` });
    }
    if (url.pathname.startsWith("/api/")) {
      const body = method === "GET" ? {} : await readBody(req);
      const result = route(db, method, url.pathname, url.searchParams, body);
      return send(200, JSON.stringify(result), "application/json; charset=utf-8");
    }
    const rel = url.pathname === "/" ? "/index.html" : normalize(url.pathname);
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) throw new HttpError(403, "Proibido");
    try {
      return send(200, await readFile(file), MIME[extname(file)] ?? "application/octet-stream");
    } catch {
      throw new HttpError(404, "Não encontrado");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    send(status, JSON.stringify({ error: e instanceof HttpError ? e.message : "Erro interno" }), "application/json; charset=utf-8");
  }
});

server.listen(PORT, HOST, () => {
  console.log("\nFinanças do casal a funcionar.\n");
  console.log(`  Neste computador:   http://localhost:${PORT}`);
  const urls = lanUrls();
  if (urls.length) for (const u of urls) console.log(`  Na rede Wi-Fi (outro dispositivo):  ${u}`);
  else console.log("  (Não foi encontrada rede local. Ligue-se ao Wi-Fi para o outro dispositivo aceder.)");
  console.log(`\n  Base de dados: ${DB_FILE}\n  Para parar: Ctrl+C\n`);
});

process.on("SIGINT", () => { db.close(); process.exit(0); });
process.on("SIGTERM", () => { db.close(); process.exit(0); });
