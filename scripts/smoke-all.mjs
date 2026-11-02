#!/usr/bin/env node
/**
 * KNOUX REC — smoke suite runner.
 *
 * `npm run smoke:all` used to be 25 `npm run …` calls joined by `&&`. That has
 * two failure modes this replaces:
 *
 *  1. The first failing suite stops every later suite, so a report of "suite N
 *     failed" says nothing about suites N+1…25, which were never executed.
 *     During this mission that masked 24 suites behind one splash-selector
 *     regression.
 *  2. A suite that no longer exists in the chain simply disappears from the
 *     evidence. `smoke:region` — the selected-area capture gate — was exactly
 *     such an omission.
 *
 * Here every registered suite runs whether or not its neighbours passed, and
 * the aggregate exit code is 1 if any single suite failed. The list is derived
 * from package.json, so registering a suite is enough to include it.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).scripts;

const onlyIndex = process.argv.indexOf("--only");
// Accept either spelling: --only recording,region and
// --only smoke:recording,smoke:region both select the same two suites.
const only =
  onlyIndex === -1
    ? null
    : process.argv[onlyIndex + 1]
        .split(",")
        .map((name) => `smoke:${name.trim().replace(/^smoke:/, "")}`)
        .filter((name) => name !== "smoke:");

if (only) {
  const unknown = only.filter((name) => !Object.keys(scripts).includes(name));
  if (unknown.length) {
    console.error(`smoke-all: unknown suite(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
}

const suites = Object.keys(scripts)
  .filter((name) => name.startsWith("smoke:") && name !== "smoke:all")
  .filter((name) => !only || only.includes(name))
  .sort();

if (suites.length === 0) {
  console.error("smoke-all: no suites selected");
  process.exit(2);
}

const results = [];
const started = Date.now();

// Each suite starts its own Chromium with a fake capture device. Run back to
// back, the previous instance is still tearing down while the next one asks
// the compositor for frames, and the capture-dependent suites (trim, template
// export, selected-area, screen) then measure zero chunks from a loop that is
// still painting. Passing individually and failing in aggregate is the
// signature. A short settle between suites removes the overlap.
const settleMs = Number(process.env.KNOUX_SMOKE_SETTLE_MS ?? 2500);
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, settleMs);
  });

// A sweep is the only run that executes every suite, so its transcript is the
// evidence. It used to live only on stdout, and one invocation piped through
// `tail` lost the failing check line of a recorder failure for good. Each suite
// now writes its own full log next to the summary.
const logDir = path.join(
  root,
  "artifacts",
  "smoke",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(logDir, { recursive: true });

for (const name of suites) {
  const command = scripts[name];
  // Suites are "node scripts/<file>.mjs"; run node directly rather than
  // nesting an npm process per suite.
  const [, file, ...rest] = command.split(/\s+/);
  const label = name.replace(/^smoke:/, "");
  process.stdout.write(`\n──── ${label} ────\n`);
  const start = Date.now();
  const run = spawnSync(process.execPath, [file, ...rest], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const ms = Date.now() - start;
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  // Echo without a trailing newline: the suites already end their own lines,
  // and adding one per suite inserts blank rows into the transcript.
  process.stdout.write(output);
  const status =
    run.error !== undefined ? "CRASHED" : run.status === 0 ? "PASS" : "FAIL";
  writeFileSync(
    path.join(logDir, `${label}.txt`),
    `# ${label} · ${status} · ${ms} ms · exit ${run.status}\n\n${output}`,
  );
  results.push({
    label,
    status,
    code: run.error ? String(run.error.message) : run.status,
    ms,
  });
  if (status !== "PASS") {
    process.stdout.write(`!! ${label} ${status} (${ms} ms)\n`);
  } else {
    process.stdout.write(`ok ${label} (${ms} ms)\n`);
  }
  await settle();
}

const counts = { PASS: 0, FAIL: 0, CRASHED: 0 };
for (const result of results) counts[result.status] += 1;

process.stdout.write("\n══════════ SMOKE SUMMARY ══════════\n");
for (const result of results) {
  const detail = result.status === "PASS" ? "" : ` exit ${result.code}`;
  process.stdout.write(
    `  ${result.status.padEnd(7)} ${result.label.padEnd(20)} ${(result.ms / 1000).toFixed(1)}s${detail}\n`,
  );
}
process.stdout.write(
  `\n${results.length} suites · ${counts.PASS} passed · ${counts.FAIL} failed · ${counts.CRASHED} crashed · ${(
    (Date.now() - started) /
    1000
  ).toFixed(0)}s wall\n`,
);
process.stdout.write(`Transcript: ${path.relative(root, logDir)}\n`);

writeFileSync(
  path.join(logDir, "summary.json"),
  JSON.stringify(
    {
      startedAt: new Date(started).toISOString(),
      wallSeconds: (Date.now() - started) / 1000,
      base: process.env.KNOUX_BASE_URL ?? "http://localhost:4173/",
      counts,
      suites: results,
    },
    null,
    2,
  ),
);

process.exit(counts.FAIL + counts.CRASHED > 0 ? 1 : 0);
