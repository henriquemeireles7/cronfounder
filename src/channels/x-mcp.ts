#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { oauthAuthorization } from "./x-oauth.js";

const API_BASE = (process.env.CRONFOUNDER_X_API ?? "https://api.x.com").replace(/\/$/, "");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing $${name}; add it to .cronfounder/env and run cronfounder doctor`);
  return value;
}

function toolError(message: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function createPost(text: string) {
  const url = `${API_BASE}/2/tweets`;
  let authorization: string;
  try {
    authorization = oauthAuthorization("POST", url, {
      apiKey: required("X_API_KEY"),
      apiKeySecret: required("X_API_KEY_SECRET"),
      accessToken: required("X_ACCESS_TOKEN"),
      accessTokenSecret: required("X_ACCESS_TOKEN_SECRET"),
    });
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return toolError(
      `E_PUSH_UNCERTAIN: X request ended without a response (${error instanceof Error ? error.message : String(error)}); verify on x.com before retrying`,
    );
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return toolError(
      `E_PUSH_UNCERTAIN: X response ended before its body arrived (${error instanceof Error ? error.message : String(error)}); verify on x.com before retrying`,
    );
  }
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    // Error text below deliberately stays bounded and useful.
  }
  const detail = String(body?.detail ?? body?.title ?? body?.errors?.[0]?.message ?? raw).slice(0, 300);
  if (response.status === 401) {
    return toolError(
      "X rejected the OAuth credentials (401); sync the machine clock, check all four X credentials, and regenerate the access token after enabling Read and write",
    );
  }
  if (response.status === 403 && /duplicate/i.test(detail)) {
    return toolError(`X rejected duplicate content (403): ${detail || "change the post text before retrying"}`);
  }
  if (response.status === 403) {
    return toolError(
      `X refused the post (403): ${detail || "check app permissions"}; set the app to Read and write, then regenerate the access token and secret`,
    );
  }
  if (response.status === 429) {
    return toolError(`X rate or spending limit reached (429): ${detail || "check the developer console and spending cap"}`);
  }
  if (!response.ok) {
    return toolError(`X create post failed (HTTP ${response.status}): ${detail || "empty response"}`);
  }
  const id = body?.data?.id;
  if (typeof id !== "string" || id.length === 0) {
    return toolError("E_PUSH_UNCERTAIN: X accepted the request but returned no data.id; verify on x.com before retrying");
  }
  return { content: [{ type: "text" as const, text: id }] };
}

const server = new McpServer({ name: "cronfounder-x", version: "0.1.0" });
server.registerTool(
  "create_post",
  {
    description: "create one text post on X using OAuth 1.0a user context",
    inputSchema: { text: z.string().min(1) },
  },
  ({ text }) => createPost(text),
);

await server.connect(new StdioServerTransport());
