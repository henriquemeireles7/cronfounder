# Integrations

How cronfounder connects to the outside world, why the first real channel is X (Twitter), and why you almost never need to hand-code an integration.

## The two seams

Everything external enters through one of two seams, and which one decides how you integrate:

- **Sensors** read reality (invariant I). Plain REST, no model, `credential_ref` naming an env var. If you're *measuring* something (stars, MRR, impressions), it's a sensor.
- **Drivers** publish (the `push` verb, behind the gate). The deterministic core is an MCP client over stdio; the executable mapping lives only in human-owned `.cronfounder/config.json`. If you're *acting* on the world, it's a driver.

This split is why "add an integration" is rarely "write code": a driver is a config entry pointing at any stdio MCP server, and the MCP ecosystem already has thousands.

## X (Twitter) — the first real channel, end to end

X is implemented along both seams:

- **Posting** = a bundled stdio MCP server (`dist/x-mcp.js`) exposing `create_post`, signing `POST /2/tweets` with OAuth 1.0a user context in ~50 lines of `node:crypto` — zero new dependencies. Wired as the default `drivers.x` mapping in the company template.
- **Metrics** = the `x_post_metrics` sensor: `GET /2/tweets/:id?tweet.fields=public_metrics` with an app-only bearer, resolving the post id from the latest published ledger record, so `watch` and `verdict` read reality for published posts.

Setup (five env vars) is walked through in `channels/x/setup.md`, materialized into every company. In short:

- Create an X developer app inside a Project; set permissions to **Read and write before** generating tokens.
- `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` (posting, OAuth 1.0a — 4 static creds, no browser flow, cron-proof), `X_BEARER_TOKEN` (metrics).
- Put them in `.cronfounder/env` (chmod 600); `cronfounder doctor` probes the driver and checks the sensor credential.

**Cost, honestly** (mid-2026 pay-per-use): ~$0.015/post, **$0.20 for a post containing a URL** (13× — `push` warns you), $0.001 to read your own post's metrics (deduped per 24h). A founder account posting daily runs about $0.50/month. Set a spending cap in the developer console.

**Failure handling** maps to existing machinery: a 403 duplicate-content → failed; a 401 (bad creds or clock skew) caught at the doctor probe; a network death *after* the signed POST left → a `push_uncertain` decide card (never auto-retried — double-posting in the principal's name is the worst outcome).

**First-party alternative:** if you'd rather not run the bundled server, point the same driver config at X's official MCP bridge — `"command": "npx", "args": ["@xdevplatform/xurl", "mcp", "https://api.x.com/mcp"]`. It's stdio and read/write, but uses OAuth 2.0 PKCE with refresh-token state (more fragile under cron), so it's the documented alternative, not the default.

## Don't hand-code integrations — bring an MCP server

Any stdio MCP server can be a driver. For long-tail channels, that means you configure, not code. The landscape (mid-2026):

| Platform | What it is | Fit for cronfounder |
|---|---|---|
| **Composio** | 1,000+ toolkits behind one hosted MCP gateway, managed OAuth | Available as a *user-chosen* driver; holds your tokens in their cloud |
| **Pipedream MCP** | 3,000+ apps as hosted MCP servers, managed OAuth (now Workday-owned) | Same — mature, but third-party token custody |
| **Zapier MCP** | 8,000+ Zapier apps as MCP tools | Works; every user needs a Zapier account, task economics poor |
| **Activepieces** | MIT open-source automation, ~700 pieces each an MCP server | Best OSS alignment, but a whole platform to self-host |
| **Smithery / Glama** | Registries + one-click hosting ("Docker Hub of MCP") | Discovery and distribution, not an auth solution |
| **Official MCP Registry** | Metadata registry under the Agentic AI Foundation | Publish here + Smithery for discovery; don't depend on it at runtime |

**The recommendation for an OSS CLI whose users bring their own accounts:** the hosted aggregators solve OAuth for *products embedding integrations*, at the cost of a mandatory third-party account and token custody in someone else's cloud — the wrong default for cronfounder's trust model ("no model in the side-effect path" extends to "no third-party cloud in the credential path"). And because X's pay-per-use pricing means a platform-owned X app eats metered cost, users end up needing their own developer app anyway.

So: **the driver seam makes any stdio MCP server pluggable — document it as a user-chosen option for long-tail channels, don't depend on any one platform.** cronfounder ships its own audited X driver (one verb, ~100 lines) and stays out of the credential path.

See [docs/commands.md](commands.md#drivers) for the driver config shape and [docs/architecture.md](architecture.md) for the seam design.
