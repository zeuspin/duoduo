const { createServer } = require("node:http");
const { mkdtemp, writeFile, mkdir } = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { WebSocketServer } = require("ws");

const execFileAsync = promisify(execFile);
const rooms = ["440", "660", "880"];
const durationMs = Number(process.env.DUODUO_SOAK_DURATION_MS || 1_200_000);
const sampleEveryMs = Number(process.env.DUODUO_SOAK_SAMPLE_MS || 30_000);

async function listen(server) { await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen)); return server.address().port; }

async function processTree(rootPid) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss=,comm="]);
  const rows = stdout.trim().split("\n").map((line) => { const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/); return match ? {pid:Number(match[1]),ppid:Number(match[2]),rssKb:Number(match[3]),command:match[4]} : null; }).filter(Boolean);
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) { changed=false; for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) { ids.add(row.pid); changed=true; } }
  const processes = rows.filter((row) => ids.has(row.pid));
  return { rssMb: processes.reduce((sum, row) => sum + row.rssKb, 0) / 1024, processCount: processes.length, pids: processes.map((row) => row.pid) };
}

function median(values) { const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.floor(sorted.length/2)]; }
async function activePids(pids) { if (!pids.length) return []; const { stdout } = await execFileAsync("ps", ["-p", pids.join(","), "-o", "pid="]).catch(() => ({ stdout: "" })); return stdout.trim().split(/\s+/).filter(Boolean).map(Number); }

(async () => {
  const http = createServer((request, response) => {
    if (request.url.endsWith(".mp4")) { response.setHeader("content-type", "video/mp4"); createReadStream(resolve(`tests/fixtures/live-room/${request.url.slice(1,-4)}.mp4`)).pipe(response); return; }
    const room = request.url.slice(1); if (!rooms.includes(room)) return response.writeHead(404).end();
    response.setHeader("content-type", "text/html; charset=utf-8"); response.end(`<!doctype html><meta property="og:title" content="压力测试 ${room}"><video autoplay loop playsinline src="/${room}.mp4"></video><script>document.querySelector('video').play()</script>`);
  });
  const httpPort = await listen(http);
  const asrHttp = createServer(); const wss = new WebSocketServer({ server: asrHttp });
  wss.on("connection", (socket) => { let room=""; let lastSent=0; let index=0; socket.on("message", (data,binary) => { if(!binary){room=JSON.parse(data).room||room;return;} if(Date.now()-lastSent<1000)return; lastSent=Date.now(); socket.send(JSON.stringify({type:"final",room,segment:`soak-${index++}`,startMs:index*1000,endMs:index*1000+900,text:`房间 ${room} 的持续压力识别文本 ${index}`})); }); });
  const asrPort = await listen(asrHttp);
  const userData = await mkdtemp(join(tmpdir(), "duoduo-soak-")); const now = new Date().toISOString();
  await writeFile(join(userData,"rooms.json"),JSON.stringify(rooms.map((roomId)=>({roomId,canonicalUrl:`https://live.douyin.com/${roomId}`,schedule:null,monitoring:true,createdAt:now,updatedAt:now}))));
  await writeFile(join(userData,"settings.json"),JSON.stringify({provider:{type:"duoduo-streaming-asr-v1",endpoint:`ws://127.0.0.1:${asrPort}`,auth:"none"},secrets:{}}));
  const executable=resolve("out/Duoduo Live-darwin-arm64/Duoduo Live.app/Contents/MacOS/Duoduo Live");
  const child=spawn(executable,[`--user-data-dir=${userData}`,"--disable-renderer-backgrounding","--disable-background-timer-throttling"],{cwd:resolve("."),env:{...process.env,DUODUO_FIXTURE_ORIGIN:`http://127.0.0.1:${httpPort}`},stdio:"ignore"});
  const samples=[]; const startedAt=Date.now();
  while(Date.now()-startedAt<durationMs){ await new Promise((resolveWait)=>setTimeout(resolveWait,Math.min(sampleEveryMs,durationMs-(Date.now()-startedAt)))); samples.push({elapsedMs:Date.now()-startedAt,...await processTree(child.pid)}); }
  child.kill("SIGTERM");
  const exitCode=await Promise.race([new Promise((resolveExit)=>child.once("exit",resolveExit)),new Promise((resolveTimeout)=>setTimeout(()=>resolveTimeout("timeout"),15_000))]);
  if(exitCode==="timeout")child.kill("SIGKILL");
  for(const client of wss.clients)client.terminate(); await new Promise((resolveClose)=>wss.close(()=>asrHttp.close(()=>http.close(resolveClose))));
  await new Promise((resolveWait)=>setTimeout(resolveWait,1000));
  const remainingPids=await activePids(samples.at(-1)?.pids ?? []); const remaining=remainingPids.length;
  const halfway=samples.filter((sample)=>sample.elapsedMs>=durationMs*.45&&sample.elapsedMs<=durationMs*.6).map((sample)=>sample.rssMb);
  const ending=samples.slice(-Math.min(3,samples.length)).map((sample)=>sample.rssMb);
  const midpointMedian=median(halfway.length?halfway:samples.map((sample)=>sample.rssMb)); const endingMedian=median(ending); const secondHalfGrowth=(endingMedian-midpointMedian)/midpointMedian;
  const report={startedAt:new Date(startedAt).toISOString(),durationMs,sampleEveryMs,midpointMedianMb:midpointMedian,endingMedianMb:endingMedian,peakMb:Math.max(...samples.map((sample)=>sample.rssMb)),secondHalfGrowth,remainingProcesses:remaining,remainingPids,samples};
  await mkdir(resolve("reports"),{recursive:true}); await writeFile(resolve("reports/resource-soak.json"),`${JSON.stringify(report,null,2)}\n`);
  if(secondHalfGrowth>.2)throw new Error(`RSS growth ${(secondHalfGrowth*100).toFixed(1)}% exceeds 20%`);
  if(remaining!==0)throw new Error(`${remaining} residual processes`);
  process.stdout.write(`${JSON.stringify({ok:true,durationMs,midpointMedianMb:midpointMedian.toFixed(1),endingMedianMb:endingMedian.toFixed(1),growthPercent:(secondHalfGrowth*100).toFixed(1),peakMb:report.peakMb.toFixed(1)})}\n`);
})().catch((error)=>{process.stderr.write(`${error.stack}\n`);process.exit(1)});
