import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

const files = [
  "services/offlineAIToolsService.ts",
  "types/visualPatchLab.ts",
  "services/knouxMorphCore.ts",
  "components/ToolboxPanel.tsx",
  "components/ArabicAIToolsPanel.tsx",
  "components/KnouxMorphCorePanel.tsx",
  "components/VisualPatchLabPanel.tsx",
  "components/TemplatesPanel.tsx",
];

for (const file of files) {
  try {
    const text = await readFile(file, "utf8");
    const ids = [...text.matchAll(/\bid:\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)].map((m) => m[1]);
    const toolIds = [...text.matchAll(/\btoolId:\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)].map((m) => m[1]);
    const keys = [...text.matchAll(/^\s{2,6}["']?([a-zA-Z0-9_-]{3,})["']?:\s*\{/gm)].map((m) => m[1]);
    const unique = [...new Set([...ids, ...toolIds])];
    console.log(
      `${file}: ids=${ids.length} unique=${unique.length} toolIds=${toolIds.length} keys=${keys.length}`,
    );
    if (unique.length) console.log(`  ${unique.slice(0, 60).join(", ")}`);
  } catch (error) {
    console.log(`${file}: MISSING ${error.code ?? error}`);
  }
}

for (const pattern of ["**/*arabic*", "**/*Arabic*", "**/*visualPatch*", "**/*morph*"]) {
  console.log(`\nPATTERN ${pattern}`);
  for await (const entry of glob(pattern, { exclude: ["node_modules/**", "dist/**"] })) {
    console.log(`  ${entry}`);
  }
}
