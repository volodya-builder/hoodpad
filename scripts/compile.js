#!/usr/bin/env node
/**
 * Compiles all contracts with solc-js (no external downloads needed).
 * Artifacts (abi + bytecode) land in ./artifacts/<ContractName>.json
 */
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.join(__dirname, "..");
const CONTRACTS = path.join(ROOT, "contracts");
const OUT = path.join(ROOT, "artifacts");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".sol") ? [p] : [];
  });
}

const sources = {};
for (const file of walk(CONTRACTS)) {
  const rel = path.relative(CONTRACTS, file).split(path.sep).join("/");
  sources[rel] = { content: fs.readFileSync(file, "utf8") };
}

function findImport(importPath) {
  // node_modules imports (@openzeppelin/...)
  const candidates = [
    path.join(ROOT, "node_modules", importPath),
    path.join(CONTRACTS, importPath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { contents: fs.readFileSync(c, "utf8") };
  }
  return { error: "not found: " + importPath };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris", // avoid PUSH0 for widest L2 compatibility
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
    },
  },
};

const output = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImport })
);

let failed = false;
for (const err of output.errors || []) {
  if (err.severity === "error") {
    failed = true;
    console.error(err.formattedMessage);
  } else if (process.env.VERBOSE) {
    console.warn(err.formattedMessage);
  }
}
if (failed) process.exit(1);

fs.mkdirSync(OUT, { recursive: true });
let count = 0;
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, data] of Object.entries(contracts)) {
    // only emit artifacts for our own sources
    if (!(file in sources)) continue;
    fs.writeFileSync(
      path.join(OUT, `${name}.json`),
      JSON.stringify(
        {
          contractName: name,
          sourceName: file,
          abi: data.abi,
          bytecode: "0x" + data.evm.bytecode.object,
          deployedBytecode: "0x" + data.evm.deployedBytecode.object,
        },
        null,
        2
      )
    );
    count++;
  }
}
console.log(`Compiled ${count} contracts -> artifacts/`);
