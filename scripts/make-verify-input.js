// Собирает ПОЛНЫЙ standard-json input (все исходники, включая OpenZeppelin)
// для верификации контрактов в Blockscout.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTRACTS = path.join(ROOT, "contracts");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".sol") ? [p] : [];
  });
}

const sources = {};
const queue = [];
for (const file of walk(CONTRACTS)) {
  const rel = path.relative(CONTRACTS, file).split(path.sep).join("/");
  sources[rel] = { content: fs.readFileSync(file, "utf8") };
  queue.push([rel, sources[rel].content]);
}

// рекурсивно подтягиваем импорты (@openzeppelin/...)
const IMP = /import\s+(?:{[^}]*}\s+from\s+)?"([^"]+)";/g;
function resolve(from, imp) {
  if (imp.startsWith(".")) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(from), imp));
  }
  return imp; // node_modules style path used as-is
}
while (queue.length) {
  const [from, content] = queue.pop();
  for (const m of content.matchAll(IMP)) {
    const key = resolve(from, m[1]);
    if (sources[key]) continue;
    const fsPath = key.startsWith("@")
      ? path.join(ROOT, "node_modules", key)
      : path.join(CONTRACTS, key);
    if (!fs.existsSync(fsPath)) { console.error("missing:", key); continue; }
    const c = fs.readFileSync(fsPath, "utf8");
    sources[key] = { content: c };
    queue.push([key, c]);
  }
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi"] } },
  },
};
fs.writeFileSync(path.join(ROOT, "verification-input.json"), JSON.stringify(input, null, 1));
console.log("sources:", Object.keys(sources).length, "-> verification-input.json");
