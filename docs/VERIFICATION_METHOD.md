# How KNOuX REC verification numbers are counted

Written because two earlier summaries in this repository quoted smoke totals
that could not be reproduced from the saved reports. This document fixes the
definition, and `scripts/count-smoke.mjs` computes it.

## The counting rule

| Concept | Definition used here |
| --- | --- |
| **Smoke command** | One `smoke:*` script in `package.json`. `npm run smoke:all` chains them with `&&`, so the number of chained commands is the number of smoke commands. |
| **Smoke suite run** | One command executed once, sequentially, against a live `npm run preview` server on `http://localhost:4173/` or against the packaged Windows binary. |
| **Assertion** | One entry in the `checks[]` array of the machine-readable report that command writes. |
| **Passing assertion** | An entry whose `pass` field is exactly `true`. |
| **Green run** | Every report present, every report `failed: false`, no entry with `pass !== true`, and the suite process exit code `0`. |

Console `PASS` lines are **not** the headline number. Some runners print
per-step progress lines that are not assertions, and some print nothing per
assertion at all, so a line count both over- and under-counts depending on the
suite. Line counts are recorded only as a cross-check.

## Why earlier figures disagreed

The summary given before this document said "17 suites / 561 checks". Both
numbers were wrong and in the same direction:

- **17 instead of 18** — the count was taken from a mental model of the suite
  list rather than from `smoke:all`, which at that point chained 18 commands.
- **561 instead of 661** — the total came from counting `PASS` lines in one
  captured log, which missed the suites that write their report without
  echoing every assertion. The `ai-tools` suite alone carries 79 assertions
  that were not in that figure.

The corrected statement, computed from the reports at commit `87cc8f6`, was
**18 smoke commands and 661 passing assertions**.

## Reproducing it

```bash
npm run build && npm run preview &      # serves dist/ on :4173
npm run verify                          # types, lint, i18n, unit tests, build
npm run smoke:all                       # every suite, sequentially
node scripts/count-smoke.mjs            # the totals, from the reports
```

`count-smoke.mjs` prints one row per command with its report path, assertion
count and passing count, then a JSON summary with the method restated. It exits
non-zero if any command has no registered report, if a report is missing from
disk, or if any assertion failed — so a stale or partial run cannot silently
produce a confident total.

## Unit tests are counted separately

`npm test` (Vitest) runs the pure logic suites and is reported on its own line:
test files and tests, taken from Vitest's own summary. Unit tests are never
merged into the smoke total, because they cover different ground: the smoke
suites drive the real UI in Chromium or the packaged binary and read back real
pixels, bytes and files, while the unit suites pin the numeric contracts of the
pipelines those UIs call.

## Evidence that accompanies a claim

A status of `VERIFIED` in `docs/COMPLETE_SERVICE_CATALOG.md` or
`src/app/capabilities.ts` names the file that proves it — a test path, a smoke
script, or both — and the smoke's evidence string states how many assertions
that script carries. Where a suite proves one path through a family of
algorithms rather than every member, the text says so instead of implying
full coverage.
