import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import WebSocket from "ws";

const root = resolve(import.meta.dirname, "../..");
const reportPath = resolve(root, "reports/bailian-asr-scene-evaluation.json");
const endpoint = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const candidates = [
  { id: "paraformer-realtime-v2", cnyPerSecond: 0.00024 },
  { id: "fun-asr-realtime", cnyPerSecond: 0.00033 },
];
const apiKey = await loadApiKey();
if (!apiKey) throw new Error("BAILIAN_API_KEY is required in the repository .env");

const temporary = await mkdtemp(resolve(tmpdir(), "duoduo-asr-eval-"));
const samples = [
  await synthesize("stock-synthetic", "stock_finance", "光伏板块现在不要追高，等中报风险释放并且成交量重新放大以后再考虑。", temporary),
  await synthesize("commerce-synthetic", "ecommerce", "这款防晒霜直播间到手价七十九元，今天下单赠送旅行装，晚上十二点活动结束。", temporary),
  {
    id: "stock-live-short",
    domain: "stock_finance",
    kind: "live_reference",
    audioFile: resolve(root, "samples/audio/raw/C2_31544105137_20260709_0224_10s_page_capture_16k_mono.wav"),
    reference: "是卖出了68.2，我们去除以成交额，再乘以100。现在是多少呢？就负5.0。好，那么负五。",
  },
];

const results = [];
for (const candidate of candidates) {
  const runs = [];
  for (const sample of samples) {
    const startedAt = Date.now();
    try {
      const pcm = extractPcm(await readFile(sample.audioFile));
      const output = await recognize(candidate.id, pcm);
      const hypothesis = output.sentences.map((sentence) => sentence.text).join("");
      const cer = characterErrorRate(sample.reference, hypothesis);
      const timestampCoverage = output.sentences.length
        ? output.sentences.filter((sentence) => Number.isFinite(sentence.beginTime) && Number.isFinite(sentence.endTime) && sentence.endTime >= sentence.beginTime).length / output.sentences.length
        : 0;
      runs.push({
        id: sample.id,
        domain: sample.domain,
        kind: sample.kind,
        succeeded: true,
        latencyMs: Date.now() - startedAt,
        audioSeconds: pcm.length / 2 / 16_000,
        sentenceCount: output.sentences.length,
        cer,
        timestampCoverage,
        hypothesis,
      });
    } catch (error) {
      runs.push({ id: sample.id, domain: sample.domain, kind: sample.kind, succeeded: false, latencyMs: Date.now() - startedAt, error: safeError(error) });
    }
  }
  const synthetic = runs.filter((run) => run.kind === "synthetic");
  const averageSyntheticCer = synthetic.reduce((sum, run) => sum + (run.cer ?? 1), 0) / synthetic.length;
  const timestampCoverage = runs.reduce((sum, run) => sum + (run.timestampCoverage ?? 0), 0) / runs.length;
  const audioSeconds = runs.reduce((sum, run) => sum + (run.audioSeconds ?? 0), 0);
  const passed = runs.every((run) => run.succeeded) && averageSyntheticCer <= 0.15 && timestampCoverage === 1;
  results.push({ modelId: candidate.id, passed, averageSyntheticCer, timestampCoverage, estimatedCostCny: audioSeconds * candidate.cnyPerSecond, cnyPerHour: candidate.cnyPerSecond * 3600, runs });
  process.stdout.write(`${candidate.id}: passed=${passed} syntheticCER=${averageSyntheticCer.toFixed(3)} timestamps=${timestampCoverage.toFixed(2)}\n`);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  provider: "bailian",
  region: "cn-beijing",
  scene: "asr_extraction",
  domains: ["stock_finance", "ecommerce"],
  gate: { maximumSyntheticCer: 0.15, timestampCoverage: 1, allRunsMustSucceed: true },
  caveat: "电商与股票基准语句为系统 TTS；股票另含一段真实直播短音频，其参考文本来自既有 Paraformer 转写，只作为协议和稳定性辅助证据。",
  results,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`report=${reportPath}\n`);

async function recognize(model, pcm) {
  const taskId = randomUUID();
  const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "duoduo-model-evaluation/1" } });
  const sentences = [];
  let startedResolve;
  let startedReject;
  let finishedResolve;
  let finishedReject;
  const started = new Promise((resolvePromise, rejectPromise) => { startedResolve = resolvePromise; startedReject = rejectPromise; });
  const finished = new Promise((resolvePromise, rejectPromise) => { finishedResolve = resolvePromise; finishedReject = rejectPromise; });
  const timeout = setTimeout(() => { startedReject(new Error("ASR_TIMEOUT")); finishedReject(new Error("ASR_TIMEOUT")); socket.close(); }, 45_000);
  socket.on("open", () => socket.send(JSON.stringify(runTask(taskId, model))));
  socket.on("error", (error) => { startedReject(error); finishedReject(error); });
  socket.on("message", (data) => {
    const message = parseMessage(data);
    if (!message || message.header?.task_id !== taskId) return;
    if (message.header.event === "task-started") startedResolve();
    if (message.header.event === "task-failed") {
      const error = new Error(`ASR_TASK_FAILED:${String(message.header.error_code ?? "unknown")}:${String(message.header.error_message ?? "")}`);
      startedReject(error); finishedReject(error);
    }
    if (message.header.event === "result-generated") {
      const sentence = message.payload?.output?.sentence;
      if (sentence?.sentence_end && typeof sentence.text === "string" && sentence.text.trim()) {
        sentences.push({ text: sentence.text, beginTime: Number(sentence.begin_time), endTime: Number(sentence.end_time) });
      }
    }
    if (message.header.event === "task-finished") finishedResolve();
  });
  try {
    await started;
    const bytesPer100Ms = 16_000 * 2 / 10;
    for (let offset = 0; offset < pcm.length; offset += bytesPer100Ms) {
      socket.send(pcm.subarray(offset, Math.min(offset + bytesPer100Ms, pcm.length)));
      await delay(100);
    }
    socket.send(JSON.stringify(finishTask(taskId)));
    await finished;
    return { sentences };
  } finally {
    clearTimeout(timeout);
    socket.close();
  }
}

async function synthesize(id, domain, reference, directory) {
  const aiff = resolve(directory, `${id}.aiff`);
  const wav = resolve(directory, `${id}.wav`);
  await run("say", ["-v", "Tingting", "-r", "210", reference, "-o", aiff]);
  await run("ffmpeg", ["-loglevel", "error", "-y", "-i", aiff, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  return { id, domain, kind: "synthetic", audioFile: wav, reference };
}

function extractPcm(wav) {
  const dataOffset = wav.indexOf(Buffer.from("data"));
  if (dataOffset < 0 || dataOffset + 8 > wav.length) throw new Error("WAV_DATA_CHUNK_MISSING");
  const size = wav.readUInt32LE(dataOffset + 4);
  return wav.subarray(dataOffset + 8, Math.min(dataOffset + 8 + size, wav.length));
}

function characterErrorRate(reference, hypothesis) {
  const expected = normalize(reference);
  const actual = normalize(hypothesis);
  if (!expected.length) return actual.length ? 1 : 0;
  const previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let row = 1; row <= expected.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= actual.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (expected[row - 1] === actual[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[actual.length] / expected.length;
}

function normalize(value) {
  return value.toLowerCase().replace(/[\s，。！？、；：,.!?;:“”"'（）()]/g, "");
}

function runTask(taskId, model) {
  return { header: { action: "run-task", task_id: taskId, streaming: "duplex" }, payload: { task_group: "audio", task: "asr", function: "recognition", model, parameters: { format: "pcm", sample_rate: 16000, heartbeat: true }, input: {} } };
}

function finishTask(taskId) {
  return { header: { action: "finish-task", task_id: taskId, streaming: "duplex" }, payload: { input: {} } };
}

function parseMessage(data) {
  try { return JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data)); }
  catch { return undefined; }
}

function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

async function run(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command.toUpperCase()}_EXIT_${code}`)));
  });
}

async function loadApiKey() {
  if (process.env.BAILIAN_API_KEY) return process.env.BAILIAN_API_KEY;
  const env = await readFile(resolve(root, "../.env"), "utf8").catch(() => "");
  const line = env.split(/\r?\n/).find((value) => value.startsWith("BAILIAN_API_KEY="));
  return line?.slice("BAILIAN_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).replaceAll(apiKey, "[REDACTED]").slice(0, 500);
}
