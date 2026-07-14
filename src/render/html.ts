/**
 * Static HTML renderers for board + inbox — read-only snapshots written to
 * .cronfounder/site/. No JavaScript, CSP locked down, every model-authored
 * string HTML-escaped, generated-at stamped at the top, every action a
 * copyable CLI command (never a fake button).
 */
import path from "node:path";
import { atomicWrite } from "../core/fm.js";
import type { Store } from "../core/store.js";
import type { BoardModel, InboxModel } from "./viewmodel.js";
import { clean } from "./terminal.js";

export function esc(s: string): string {
  return clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STYLE = `
:root{--paper:#FAFAF7;--panel:#F1F2ED;--ink:#1B222B;--muted:#5B6570;--line:#D9DCD4;
--spec:#A06A00;--spec-bg:#F6EBD4;--status:#1E7A50;--status-bg:#DFEFE4;
--agent:#4A3F8F;--agent-bg:#E8E5F4;--bet:#A6383F;--bet-bg:#F6E0E0;}
body{background:var(--paper);color:var(--ink);font:16px/1.6 Georgia,serif;max-width:900px;margin:0 auto;padding:24px}
h1,h2{font-family:system-ui,sans-serif;line-height:1.2}
.gen{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted)}
.card{border:1px solid var(--line);border-radius:8px;background:#fff;padding:14px 18px;margin:12px 0}
.tag{font-family:ui-monospace,monospace;font-size:12px;padding:1px 8px;border-radius:3px;display:inline-block}
.tag.spec{background:var(--spec-bg);color:var(--spec)}.tag.status{background:var(--status-bg);color:var(--status)}
.tag.agent{background:var(--agent-bg);color:var(--agent)}.tag.bet{background:var(--bet-bg);color:var(--bet)}
.dim{color:var(--muted);font-size:14px}
pre{background:#14181E;color:#C9D2DB;padding:10px 14px;border-radius:6px;overflow-x:auto;font-size:13px}
.urgent{border-left:4px solid var(--bet)}
`;

function page(title: string, generatedAt: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>
<p class="gen">generated at ${esc(generatedAt)} — a snapshot, not a live view; regenerate with the CLI</p>
<h1>${esc(title)}</h1>
${body}
<p class="dim">rendered by cronfounder · read-only · every action is a CLI command</p>
</body></html>`;
}

export function boardHtml(b: BoardModel): string {
  const sections: string[] = [];
  sections.push(`<h2>① Needs funding</h2>`);
  if (b.needs_funding.length === 0) sections.push(`<p class="dim">nothing awaiting a decision</p>`);
  for (const g of b.needs_funding) {
    sections.push(`<h3><span class="tag spec">${esc(g.metric)}</span>${g.gap !== null ? ` <span class="dim">gap: ${g.gap}</span>` : ""}</h3>`);
    for (const bet of g.bets) {
      sections.push(
        `<div class="card"><span class="tag bet">${esc(bet.id)}</span> <b>${esc(bet.claim)}</b><br>
<span class="dim">risk: ${esc(bet.risk)} · cost: ${bet.cost_tokens} tokens + ${bet.cost_human_min} human-min · confidence: ${bet.confidence} (${esc(bet.confidence_source)}) · leverage: ${bet.leverage?.toExponential(2) ?? "—"}</span>
${bet.missing.length > 0 ? `<br><span class="dim">missing: ${esc(bet.missing.join("; "))}</span>` : ""}</div>`,
      );
    }
  }
  sections.push(`<h2>② Running / measuring</h2>`);
  if (b.running.length === 0) sections.push(`<p class="dim">no live experiments</p>`);
  for (const bet of b.running) {
    const progress =
      bet.day !== null && bet.total_days !== null
        ? `day ${bet.day}/${bet.total_days}${bet.delta_so_far !== null ? ` · ${bet.delta_so_far >= 0 ? "+" : ""}${Math.round(bet.delta_so_far * 100) / 100} of claimed ${bet.claimed_delta >= 0 ? "+" : ""}${bet.claimed_delta} ${esc(bet.unit)}` : ""}`
        : "";
    sections.push(
      `<div class="card"><span class="tag bet">${esc(bet.id)}</span> [${esc(bet.state)}] on <span class="tag spec">${esc(bet.metric)}</span> <span class="dim">${progress}</span><br><span class="dim">verdict due ${esc(bet.review_at ?? "—")}</span></div>`,
    );
  }
  sections.push(`<h2>③ Blocked / paused</h2>`);
  if (b.blocked.length === 0) sections.push(`<p class="dim">none</p>`);
  for (const bet of b.blocked) {
    sections.push(
      `<div class="card urgent"><span class="tag bet">${esc(bet.id)}</span> [${esc(bet.state)}] on ${esc(bet.metric)} — ${
        bet.state === "paused" ? "holds the WIP slot; resume is human-only" : esc(bet.missing.join("; "))
      }</div>`,
    );
  }
  sections.push(`<h2>④ Recent verdicts</h2>`);
  if (b.recent_verdicts.length === 0) sections.push(`<p class="dim">none yet</p>`);
  for (const bet of b.recent_verdicts) {
    const v =
      bet.verdict === "validated"
        ? `<span class="tag status">validated</span>`
        : bet.verdict === "invalidated"
          ? `<span class="tag bet">invalidated</span>`
          : `<span class="tag">inconclusive</span>`;
    sections.push(
      `<div class="card">${esc(bet.id)} ${v}${bet.verdict_delta !== null ? ` <span class="dim">Δ ${bet.verdict_delta >= 0 ? "+" : ""}${bet.verdict_delta} ${esc(bet.unit)} vs claimed ${bet.claimed_delta >= 0 ? "+" : ""}${bet.claimed_delta}</span>` : ""} <span class="dim">${esc(bet.decided_at ?? "")}</span></div>`,
    );
  }
  return page("Board — the hypothesis pipeline", b.generated_at, sections.join("\n"));
}

export function inboxHtml(i: InboxModel): string {
  const sections: string[] = [];
  if (i.open.length === 0) {
    sections.push(
      `<p><b>Nothing needs you.</b> <span class="dim">${i.running_bets} bet(s) running.${i.next_review ? ` Next verdict due ${esc(i.next_review)}.` : ""}</span></p>`,
    );
  }
  for (const c of i.open) {
    sections.push(
      `<div class="card${c.urgent ? " urgent" : ""}">
<b>${c.urgent ? "🚨 " : ""}${esc(c.id)}</b> <span class="tag agent">${esc(c.kind)}</span> <span class="dim">${esc(c.created_at)}</span>
<p><b>What:</b> ${esc(c.what)}<br><b>Why:</b> ${esc(c.why)}<br><b>Blocking:</b> ${esc(c.blocking)}</p>
${c.steps.length > 0 ? `<ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
${c.choices.length > 0 ? `<ul>${c.choices.map((ch) => `<li><code>${esc(ch.key)}</code> — ${esc(ch.label)}${ch.detail ? ` <span class="dim">(${esc(ch.detail)})</span>` : ""}</li>`).join("")}</ul>` : ""}
${c.context ? `<p class="dim">context (agent-written, verify before trusting): ${esc(c.context).slice(0, 500)}</p>` : ""}
<pre>${esc(c.resolve_hint)}</pre></div>`,
    );
  }
  return page("Inbox — what needs a human", i.generated_at, sections.join("\n"));
}

export async function writeHtmlSnapshots(store: Store, board: BoardModel, inbox: InboxModel): Promise<{ board: string; inbox: string }> {
  const boardPath = path.join(store.company.paths.siteOut, "board.html");
  const inboxPath = path.join(store.company.paths.siteOut, "inbox.html");
  await atomicWrite(boardPath, boardHtml(board));
  await atomicWrite(inboxPath, inboxHtml(inbox));
  return { board: boardPath, inbox: inboxPath };
}
