// Ensure the CLI entry is executable after tsc (npm bin links need +x).
import { chmodSync } from "node:fs";
chmodSync(new URL("../dist/cli.js", import.meta.url), 0o755);
