// Поднимает локальную сеть В ТОМ ЖЕ процессе и прогоняет тесты.
// Так не нужен отдельный фоновый узел: `node scripts/run-tests.mjs [файлы]`
import { createRequire } from "module";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.GANACHE_FROM || "/tmp/node_modules/");
const ganache = require("ganache");

const ACCOUNTS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
].map((secretKey) => ({ secretKey, balance: "0x3635C9ADC5DEA00000" })); // 1000 ETH

const server = ganache.server({
  wallet: { accounts: ACCOUNTS },
  chain: { chainId: 31337 },
  miner: { blockGasLimit: 30_000_000 },
  logging: { quiet: true },
});

await server.listen(8545);

const files = process.argv.slice(2).map((f) => path.resolve(__dirname, "..", f));
let failed = 0;
run({ files, concurrency: 1, timeout: 120_000 })
  .on("test:fail", () => { failed = 1; })
  .compose(spec)
  .pipe(process.stdout)
  .on("finish", async () => {
    await server.close();
    process.exit(failed);
  });
