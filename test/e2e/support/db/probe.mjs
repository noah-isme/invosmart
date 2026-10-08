// Runs both probes and prints a summary table. Exit code follows probe-single only.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const rows = [];
let exitCode = 0;
for (const [name, file] of [
  ["single", "probe-single.mjs"],
  ["two-clients", "probe-two-clients.mjs"],
]) {
  const res = spawnSync(process.execPath, [resolve(dir, file)], { encoding: "utf8", env: process.env });
  const line = res.stdout.trim().split("\n").filter(Boolean).pop() ?? "(no output)";
  rows.push([name, line, res.status === 0 ? "pass" : "FAIL"]);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (name === "single" && res.status !== 0) exitCode = 1;
}
console.log("\nprobe        result                       status");
for (const [n, r, s] of rows) console.log(`${n.padEnd(12)} ${r.padEnd(28)} ${s}`);
process.exit(exitCode);
