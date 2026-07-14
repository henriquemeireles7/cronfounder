/**
 * Frontmatter with authority discipline.
 *
 * Files are canon for prose and human-owned frontmatter. Some frontmatter
 * fields are machine-owned mirrors of ledger state (metric.status,
 * hypothesis.state, content.state, ...). The core edits machine-owned fields
 * SURGICALLY via the yaml Document API so every human-owned byte — comments,
 * ordering, formatting — survives untouched.
 *
 * YAML discipline: core-serialized values are plain JSON-compatible scalars;
 * dates are ISO strings (never YAML timestamps); aliases and custom tags are
 * rejected on read.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { parseDocument, Document, isMap } from "yaml";
import { CronfounderError, EXIT } from "../errors.js";

const FM_OPEN = "---\n";

export interface FrontmatterFile {
  path: string;
  data: Record<string, unknown>;
  body: string;
  doc: Document;
  raw: string;
}

const YAML_OPTS = {
  intAsBigInt: false,
  uniqueKeys: true,
  strict: true,
  customTags: [] as never[],
  version: "1.2" as const,
  // keep ISO strings as strings — never parse into Date objects
  schema: "core" as const,
};

function splitFrontmatter(raw: string, file: string): { fm: string; body: string } {
  if (!raw.startsWith(FM_OPEN)) {
    throw new CronfounderError({
      code: "E_FRONTMATTER_MISSING",
      exit: EXIT.VALIDATION,
      problem: `${file} has no frontmatter block`,
      cause: "the file must start with '---' followed by YAML frontmatter",
      fix: "add a frontmatter block; see the templates/ directory for the expected shape of each file type",
    });
  }
  const end = raw.indexOf("\n---", FM_OPEN.length - 1);
  if (end === -1) {
    throw new CronfounderError({
      code: "E_FRONTMATTER_UNTERMINATED",
      exit: EXIT.VALIDATION,
      problem: `${file} frontmatter never closes`,
      cause: "missing the closing '---' line",
      fix: "close the frontmatter block with a line containing only '---'",
    });
  }
  const fm = raw.slice(FM_OPEN.length, end + 1);
  let body = raw.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  return { fm, body };
}

export async function readFm(file: string): Promise<FrontmatterFile> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    throw new CronfounderError({
      code: "E_FILE_MISSING",
      exit: EXIT.ERROR,
      problem: `cannot read ${file}`,
      cause: e instanceof Error ? e.message : String(e),
      fix: "check the path exists; if the ledger references a deleted file, run: cronfounder rebuild",
    });
  }
  const { fm, body } = splitFrontmatter(raw, file);
  const doc = parseDocument(fm, YAML_OPTS);
  if (doc.errors.length > 0) {
    const err = doc.errors[0]!;
    const line = err.linePos?.[0]?.line;
    throw new CronfounderError({
      code: "E_YAML_INVALID",
      exit: EXIT.VALIDATION,
      problem: `${file}${line ? `:${line + 1}` : ""} frontmatter is invalid YAML: ${err.message.split("\n")[0]}`,
      cause: "malformed YAML — often an unquoted colon or bad indentation",
      fix: "quote string values containing ':' and check indentation; dates must be quoted ISO strings",
    });
  }
  // bounded alias budget: prevents alias-bomb payloads without rejecting plain docs
  const data = (doc.toJS({ maxAliasCount: 32 }) ?? {}) as Record<string, unknown>;
  return { path: file, data, body, doc, raw };
}

/**
 * Surgically set machine-owned fields (dot paths) and atomically rewrite the
 * file, preserving all other frontmatter bytes and the body verbatim.
 */
export async function patchFm(file: string, patches: Record<string, unknown>): Promise<void> {
  const f = await readFm(file);
  for (const [dotted, value] of Object.entries(patches)) {
    const keys = dotted.split(".");
    if (value === undefined) {
      f.doc.deleteIn(keys);
    } else {
      f.doc.setIn(keys, value);
    }
  }
  if (!isMap(f.doc.contents)) {
    throw new CronfounderError({
      code: "E_YAML_INVALID",
      exit: EXIT.VALIDATION,
      problem: `${file} frontmatter is not a YAML mapping`,
      cause: "the frontmatter block must be a key/value mapping",
      fix: "restructure the frontmatter as 'key: value' pairs",
    });
  }
  const fmOut = f.doc.toString({ lineWidth: 0 });
  await atomicWrite(file, `---\n${fmOut}---\n\n${f.body.replace(/^\n/, "")}`);
}

/** Serialize a brand-new frontmatter file from data + body (core-generated files). */
export function serializeFm(data: Record<string, unknown>, body: string): string {
  const doc = new Document(data);
  return `---\n${doc.toString({ lineWidth: 0 })}---\n\n${body}`;
}

/**
 * Resolve `name` under `baseDir` and return the absolute path ONLY if it stays
 * inside baseDir; otherwise null. Blocks `..`, absolute paths, and symlink-free
 * traversal from model-authored path components (e.g. content payload_file).
 */
export function containedJoin(baseDir: string, name: string): string | null {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, name);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

/** Write via temp file + rename in the same directory (atomic on POSIX). */
export async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, file);
}

/** Append a line to a file, creating parent dirs. Used for journals/events. */
export async function appendLine(file: string, line: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, line.endsWith("\n") ? line : line + "\n", "utf8");
}
