const { buildSync } = require("esbuild");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

const temporary = mkdtempSync(join(tmpdir(), "duoduo-live-recovery-"));
const entry = join(temporary, "main.cjs");
const report = join(temporary, "report.json");
buildSync({
  entryPoints: [resolve("tests/electron/live-recovery-main.ts")], outfile: entry,
  bundle: true, platform: "node", format: "cjs", external: ["electron"],
  define: { "process.env.WS_NO_BUFFER_UTIL": '"1"', "process.env.WS_NO_UTF_8_VALIDATE": '"1"' },
});
buildSync({
  entryPoints: [resolve("src/preload/room-capture.ts")], outfile: join(temporary, "room-capture.js"),
  bundle: true, platform: "node", format: "cjs", external: ["electron"],
});
const child = spawn(require("electron"), [entry, `--user-data-dir=${join(temporary, "profile")}`], {
  cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1", DUODUO_RECOVERY_REPORT: report },
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
const timer = setTimeout(() => child.kill("SIGTERM"), 45_000);
child.on("error", (error) => { process.stderr.write(`${error.stack}\n`); });
child.on("exit", (code) => {
  clearTimeout(timer);
  try {
    const result = JSON.parse(readFileSync(report, "utf8"));
    if (code !== 0 || result.ok !== true) throw new Error(`Electron recovery failed (exit ${code}): ${JSON.stringify(result)}`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 0;
  } catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
  finally { rmSync(temporary, { recursive: true, force: true }); }
});
