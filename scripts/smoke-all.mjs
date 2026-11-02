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
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).scripts;

const onlyIndex = process.argv.indexOf("--only");
const only =
  onlyIndex === -1
    ? null
    : process.argv[onlyIndex + 1].split(",").map((name) => name.trim());

const suites = Object.keys(scripts)
  .filter((name) => name.startsWith("smoke:") && name !== "smoke:all")
  .filter((name) => !only || only.includes(name))
  .sort();

if (suites.length === 0) {
  console.error("smoke-all: no suites selected");
  process.exit(2);
}

if (only) {
  const unknown = only.filter((name) => !Object.keys(scripts).includes(`smoke:${name}`));
  if (unknown.length) {
    console.error(`smoke-all: unknown suite(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
}

const results = [];
const started = Date.now();

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
    stdio: "inherit",
    env: process.env,
  });
  const ms = Date.now() - start;
  const status =
    run.error !== undefined ? "CRASHED" : run.status === 0 ? "PASS" : "FAIL";
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

process.exit(counts.FAIL + counts.CRASHED > 0 ? 1 : 0);
