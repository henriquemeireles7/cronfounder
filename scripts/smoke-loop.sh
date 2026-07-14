#!/bin/sh
# smoke-loop <workdir> <cronfounder invocation...> — the keyless demo loop,
# asserted through the funding card. The one script both CI (packed tarball)
# and the weekly health cron (published npm package) run, so the loop and its
# assertion can't drift between them.
set -eu
WORK="$1"; shift
cd "$WORK"
export CRONFOUNDER_NOW="${CRONFOUNDER_NOW:-2026-07-13T12:00:00Z}"
"$@" init demo --demo --yes --quiet
cd demo
"$@" inbox --json | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  const j = JSON.parse(d);
  if (!j.ok || j.data.open.length !== 1 || j.data.open[0].kind !== "approve_hypothesis") {
    console.error("demo loop did not reach the funding card:", d);
    process.exit(1);
  }
  console.log("funding card reached: " + j.data.open[0].id);
});
'
"$@" resolve R-1 --approve --quiet
"$@" build --quiet
"$@" rebuild --quiet
echo "the demo loop closes"
