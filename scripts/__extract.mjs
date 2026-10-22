import fs from "node:fs";

const src = fs.readFileSync("components/ArabicAIToolsPanel.tsx", "utf8");
const start = src.indexOf("ARABIC_AI_TOOLS: AITool[] = [");
const body = src.slice(start, src.indexOf("];", start));
const re =
  /icon:\s*"([^"]*)",\s*title:\s*"([^"]*)",\s*difficulty:\s*"([^"]*)",[\s\S]*?desc:\s*"([^"]*)",[\s\S]*?modelSize:\s*(\d+),\s*time:\s*(\d+)/g;
const arabic = [];
let match;
while ((match = re.exec(body)) !== null) {
  arabic.push({
    icon: match[1],
    title: match[2],
    difficulty: match[3],
    desc: match[4],
    modelSize: Number(match[5]),
    time: Number(match[6]),
  });
}

const off = fs.readFileSync("src/data/offlineAICatalog.ts", "utf8");
const offRe =
  /"id":\s*"([^"]+)",\s*"name":\s*"([^"]+)",\s*"nameEn":\s*"([^"]+)",\s*"category":\s*"([^"]+)",\s*"modelPath":\s*"([^"]+)",\s*"modelSize":\s*(\d+)/g;
const offline = [];
while ((match = offRe.exec(off)) !== null) {
  offline.push({
    id: match[1],
    name: match[2],
    nameEn: match[3],
    category: match[4],
    modelPath: match[5],
    modelSize: Number(match[6]),
  });
}

fs.writeFileSync("artifacts/catalog-compare.json", JSON.stringify({ arabic, offline }, null, 1), "utf8");
console.log("arabic", arabic.length, "offline", offline.length);
