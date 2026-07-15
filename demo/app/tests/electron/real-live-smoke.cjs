const { mkdtemp, readFile, writeFile, mkdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  const envText=await readFile(resolve("../../.env"),"utf8");
  const keyLine=envText.split(/\r?\n/).find((line)=>line.startsWith("BAILIAN_API_KEY="));
  if(!keyLine) throw new Error("BAILIAN_API_KEY missing");
  const apiKey=keyLine.slice("BAILIAN_API_KEY=".length).trim().replace(/^['"]|['"]$/g,"");
  const screenshotOnly=process.argv.includes("--screenshot-only");
  const rooms=process.argv.slice(2).filter((value)=>value!=="--screenshot-only"); if(rooms.length<3) throw new Error("at least three rooms required");
  const userData=await mkdtemp(join(tmpdir(),"duoduo-real-")); const now=new Date().toISOString();
  const storedRooms=rooms.map((roomId)=>({
    roomId,
    canonicalUrl:`https://live.douyin.com/${roomId}`,
    schedule:{days:[0,1,2,3,4,5,6],ranges:[{start:"00:00",end:"23:59"}]},
    monitoring:true,
    createdAt:now,
    updatedAt:now,
  }));
  await writeFile(join(userData,"rooms.json"),JSON.stringify(storedRooms));
  await writeFile(join(userData,"settings.json"),JSON.stringify({provider:{type:"bailian",model:"paraformer-realtime-v2",secretId:"smoke-only"},secrets:{}}));
  await mkdir(resolve("reports"),{recursive:true}); const report=resolve("reports/real-live-smoke.json"); const screenshot=resolve("reports/real-live-smoke.png");
  const executable=resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const childEnv={...process.env,DUODUO_REAL_SMOKE:"1",DUODUO_SMOKE_API_KEY:apiKey};
  if(screenshotOnly)Object.assign(childEnv,{DUODUO_E2E_SCREENSHOT:resolve("reports/three-room-real-asr.png"),DUODUO_E2E_TIMEOUT_MS:"180000"});
  else Object.assign(childEnv,{DUODUO_REAL_SMOKE_REPORT:report,DUODUO_REAL_SMOKE_SCREENSHOT:screenshot,DUODUO_REAL_SMOKE_DURATION_MS:"600000"});
  const child=spawn(executable,[".",`--user-data-dir=${userData}`,"--disable-renderer-backgrounding","--disable-background-timer-throttling"],{cwd:resolve("."),env:childEnv,stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",()=>{}); child.stderr.on("data",(data)=>{const text=String(data).replaceAll(apiKey,"[REDACTED]");if(!/task_policy_set|sysctlbyname/.test(text))process.stderr.write(text)});
  const watchdog=setTimeout(()=>child.kill("SIGTERM"),1_200_000); const code=await new Promise((resolveExit)=>child.on("exit",resolveExit));clearTimeout(watchdog);
  if(code!==0)throw new Error(`real smoke exited ${code}`);
  if(screenshotOnly){process.stdout.write(`${JSON.stringify({ok:true,screenshot:childEnv.DUODUO_E2E_SCREENSHOT},null,2)}\n`);return;}
  const result=JSON.parse(await readFile(report,"utf8")); const successful=result.rooms.filter((room)=>room.finalCount>0);
  process.stdout.write(`${JSON.stringify({ok:successful.length>=3,durationMs:result.durationMs,successfulRooms:successful.map((room)=>({roomId:room.roomId,finalCount:room.finalCount})),report,screenshot},null,2)}\n`); if(successful.length<3)process.exit(1);
})().catch((error)=>{process.stderr.write(`${error.stack}\n`);process.exit(1)});
