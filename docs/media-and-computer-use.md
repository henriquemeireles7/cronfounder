# Media & computer use

How cronfounder relates to image generation, video generation, and computer use (browsing / operating web UIs). This is a design note, not a shipped feature list — the byte-path work is a v0.2.0 milestone; the mental model is what matters today.

## The one idea: capability lives in the client, custody lives in the harness

Generating an image, rendering a video, and driving a browser are **capabilities**. They belong to the agent that mounts cronfounder — Claude Code (with Claude-in-Chrome or an image-gen MCP server), ChatGPT/Codex, Devin, an OpenClaw-class agent. Cronfounder itself contains no image model, no video model, and no browser, and it should stay that way: vendor APIs in this space rotate every few months (Sora 2's video API is already slated for shutdown; Veo 3.0 endpoints closed mid-2026), and a harness that hard-codes a vendor rots with it.

Cronfounder's job is **custody**: get an artifact from where the agent produced it, through staging → the human gate → canon, and out to a channel, without corrupting it and without letting a model into the side-effect path. That's the same three seams the whole system already runs on — runtime (models propose, the core disposes), driver (no model in the publish path), storage (files are canon).

| capability | who does it | how its output enters cronfounder |
|---|---|---|
| image / video generation | the client (its MCP servers / API keys / native tools) | a file dropped in the staging dir, referenced by a content card |
| browsing for research | the client (its browser tools) | as evidence inside proposed artifacts — no new machinery |
| publishing via a web UI | nobody by default — it skips the driver seam | only ever as an explicit human-configured driver mapping |

## Why this needs almost no new code

The dry-run lane already lets a mounting agent exercise any capability it has:

```sh
cronfounder build --dry-run     # cronfounder writes a run bundle
# the agent "wears the hat itself": generates an image/video with its OWN tools
# (a Replicate or fal.ai MCP server, a browser, whatever it has), writes the
# files into the run's staging dir
cronfounder run import <run-id> # cronfounder validates + imports through the
                                # identical pipeline a live runtime run uses
```

The client's capability, cronfounder's custody. No image client, no API keys, no browser in the core.

What *is* text-only today is the byte path, and that's the whole of "media support":

1. **Binary-safe staging import** — copy payload files as bytes (not `readFile(..., "utf8")`), with per-type size caps and a magic-byte check so `payload_type: image` really is a PNG/JPEG/WebP, plus a `sha256` in `meta.md` so `rebuild` verifies integrity without bytes in the journal.
2. **A path to the driver** — expose `{{payload_path}}` (media-posting MCP servers take a local path or URL), so the deterministic core points at bytes instead of parsing them.
3. **A gate the human can actually see** — the `approve_content` card and the HTML inbox embed `<img>`/`<video>` for media payloads. Approving an image you can't see is approval theater.
4. **One schema addition** — optional `attachments: [{file, type, alt?}]` so a post can be text *plus* an image. This is the only ontology change; the rest is plumbing.

The schema already anticipated this: `payload_type` has been `"text" | "image" | "video" | "html"` since v0.1, and every channel declares an `acceptance:` list checked at design time.

## The computer-use stance (doctrine, not code)

- **Browsing for research is always welcome.** It happens in the client (or in a hat with WebSearch/WebFetch) and only ever produces *proposals* the deterministic core may refuse. Nothing to add.
- **Publishing by driving a web UI is not a gate workaround.** Putting a model in the side-effect path is exactly what the driver seam forbids (invariant III). Browser-based publishing is permitted only as an **explicit human-configured driver** — e.g. a human wires Playwright MCP or Browserbase as the `push` tool for a channel that has no API, in `.cronfounder/config.json`, eyes open. Never as a way around a refusal.

## What exists today (mid-2026), for the client to bring

- **Browsing:** Claude-in-Chrome (drives your real browser over MCP), Anthropic's computer-use tool (client runs the VM, billed as tokens), OpenAI `computer-use-preview`; production browser MCP servers: [playwright-mcp](https://github.com/microsoft/playwright-mcp) (the 2026 default), [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp), [Browserbase](https://www.browserbase.com/).
- **Image gen** (~1–20¢/image): GPT Image, Imagen 4, FLUX 2, Ideogram — all plain HTTPS.
- **Video gen** ($1–7.50 per 8–10s clip — real money, which is why it belongs behind cronfounder's funding-card economics): Sora 2, Veo 3.1, Kling, Runway.
- **Aggregator MCP servers** — the churn-proof choice: [Replicate MCP](https://replicate.com/docs/reference/mcp) (official) or a [fal.ai MCP server](https://github.com/RamboRogers/fal-image-video-mcp) (downloads results to local paths — a natural fit for staging). One credential, every model; when a vendor API dies you switch a model string, not your plumbing.

## Recommendation

Ship items 1–4 as v0.2.0 "media support" — small, deterministic, fully testable offline with the stub runtime and mock driver. Rely on the dry-run operator lane for generation (document Replicate/fal MCP as the recommended tools). Defer unattended in-hat generation until a real company needs it under cron. Keep cronfounder vendor-blind: no image, video, or browser client ever lives in the core.
