#!/usr/bin/env node
/**
 * KNOUX REC — reproducible smoke verification counter.
 *
 * Answers "how many checks actually passed?" without hand-counting console
 * lines. It walks the smoke commands declared in `smoke:all`, locates the
 * machine-readable report each one writes, and sums the assertions.
 *
 * Counting method, in one sentence: one `smoke:*` script chained by
 * `npm run smoke:all` is one smoke command; each command writes exactly one
 * report; one entry in that report's `checks[]` array is one assertion; a pass
 * is an entry whose `pass` field is true; and the run is green only when every
 * report also says `failed: false` and the suite's own exit code is 0.
 *
 * Console `PASS` lines are counted separately as a cross-check, never as the
 * headline number, because some suites print per-step progress lines that are
 * not assertions.
 *
 * Usage: node scripts/count-smoke.mjs
 */

import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const commands = (pkg.scripts["smoke:all"] ?? "")
  .split("&&")
  .map((part) => part.trim().replace(/^npm run\s+/, ""))
  .filter(Boolean);

/** Report locations written by each runner, relative to the repository root. */
const REPORT_CANDIDATES = [
  ["smoke:ui", "artifacts/evidence/ui-smoke.json"],
  ["smoke:recording", "artifacts/evidence/recording-smoke.json"],
  ["smoke:screen", "artifacts/evidence/screen-capture-smoke.json"],
  ["smoke:error", "artifacts/evidence/error-state-smoke.json"],
  ["smoke:electron", "artifacts/evidence/electron-smoke.json"],
  ["smoke:packaged", "artifacts/evidence/packaged-smoke.json"],
  ["smoke:elysian", "artifacts/evidence/elysian-smoke.json"],
  ["smoke:toolbox", "artifacts/evidence/toolbox/report.json"],
  ["smoke:ai", "artifacts/evidence/ai/report.json"],
  ["smoke:ai-tools", "artifacts/evidence/ai-tools/ai-tools-smoke.json"],
  ["smoke:templates", "artifacts/evidence/templates/report.json"],
  ["smoke:visual-patch", "artifacts/evidence/visual-patch/report.json"],
  ["smoke:live-studio", "artifacts/evidence/live-studio/report.json"],
  ["smoke:screenshot-editor", "artifacts/evidence/screenshot-editor/report.json"],
  ["smoke:morphcore", "artifacts/evidence/morphcore/report.json"],
  ["smoke:elysian-studio", "artifacts/evidence/elysian-studio/report.json"],
  ["smoke:discover", "artifacts/evidence/discover/report.json"],
  ["smoke:workflows", "artifacts/evidence/workflows/report.json"],
  ["smoke:audio-studio", "artifacts/evidence/audio-studio/report.json"],
  ["smoke:batch", "artifacts/evidence/batch/report.json"],
  ["smoke:handoff", "artifacts/evidence/handoff/report.json"],
  ["smoke:audio-recording", "artifacts/evidence/audio-recording/report.json"],
  ["smoke:hotkeys", "artifacts/evidence/hotkeys/report.json"],
  ["smoke:proportions", "artifacts/evidence/proportions/report.json"],
  ["smoke:about", "artifacts/evidence/about/report.json"],
];

const byCommand = new Map(REPORT_CANDIDATES);
const rows = [];
let totalAssertions = 0;
let totalPassing = 0;
let missing = [];
let failing = [];

for (const command of commands) {
  const relative = byCommand.get(command);
  if (!relative) {
    missing.push(`${command}: no report path registered`);
    rows.push({ command, report: null, checks: 0, passing: 0, failed: null, note: "unregistered" });
    continue;
  }
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    missing.push(`${command}: ${relative} is missing`);
    rows.push({ command, report: relative, checks: 0, passing: 0, failed: null, note: "no report on disk" });
    continue;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    missing.push(`${command}: ${relative} is not valid JSON (${error.message})`);
    continue;
  }
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const passing = checks.filter((entry) => entry.pass === true).length;
  const declaredFailed =
    report.failed === true ||
    (typeof report.failed === "number" && report.failed > 0) ||
    (typeof report.failures === "number" && report.failures > 0) ||
    checks.some((entry) => entry.pass !== true);
  totalAssertions += checks.length;
  totalPassing += passing;
  if (declaredFailed) failing.push(`${command} (${checks.length - passing} failing)`);
  rows.push({
    command,
    report: relative,
    checks: checks.length,
    passing,
    failed: declaredFailed,
    fatal: report.fatal ?? null,
    consoleErrors: Array.isArray(report.consoleErrors) ? report.consoleErrors.length : 0,
    pageErrors: Array.isArray(report.pageErrors) ? report.pageErrors.length : 0,
  });
}

const width = Math.max(...rows.map((row) => row.command.length));
console.log(`${"command".padEnd(width)}  checks  pass  report`);
for (const row of rows) {
  console.log(
    `${row.command.padEnd(width)}  ${String(row.checks).padStart(6)}  ${String(row.passing).padStart(4)}  ${row.report ?? "-"}`,
  );
}

console.log("");
console.log(
  JSON.stringify(
    {
      method:
        "one smoke:* script chained by npm run smoke:all = one command; one checks[] entry in that command's report = one assertion; pass = entry.pass === true",
      smokeCommands: commands.length,
      reportsFound: rows.filter((row) => row.report).length,
      totalAssertions,
      passingAssertions: totalPassing,
      failingAssertions: totalAssertions - totalPassing,
      unregisteredReports: missing,
      failingCommands: failing,
      green: missing.length === 0 && failing.length === 0,
    },
    null,
    2,
  ),
);

process.exit(missing.length === 0 && failing.length === 0 ? 0 : 1);
