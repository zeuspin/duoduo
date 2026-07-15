const { app, BrowserWindow, session } = require("electron");
const rooms = process.argv.slice(2);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(async () => {
  const results = await Promise.all(rooms.map(async (roomId) => {
    const win = new BrowserWindow({ show:false, webPreferences:{session:session.fromPartition(`probe-${roomId}-${Date.now()}`),sandbox:true,contextIsolation:true,backgroundThrottling:false} });
    win.webContents.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36");
    win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
    try {
      const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("dom_ready_timeout")),15000);win.webContents.once("dom-ready",()=>{clearTimeout(timer);resolve()})});
      void win.loadURL(`https://live.douyin.com/${roomId}`).catch(()=>undefined);
      await ready; await new Promise((resolve)=>setTimeout(resolve,1500));
      win.webContents.debugger.attach("1.3"); let evidence; for(let attempt=0;attempt<10&&!evidence;attempt++){const evaluated=await win.webContents.debugger.sendCommand("Runtime.evaluate",{expression:`JSON.stringify((()=>{const v=document.querySelector('video');return{title:document.title,hasVideo:!!v,readyState:v?.readyState||0,audioTracks:v?.captureStream?.().getAudioTracks().length||0,text:(document.body?.innerText||'').slice(0,2000)}})())`,returnByValue:true}); if(evaluated.result.value) evidence=JSON.parse(evaluated.result.value); else await new Promise(resolve=>setTimeout(resolve,500));} win.webContents.debugger.detach(); if(!evidence) throw new Error("evaluation_unavailable");
      const status=/登录后|扫码登录/.test(evidence.text)?"login_required":/直播已结束|暂未开播|已下播/.test(evidence.text)?"offline":evidence.readyState>=2&&evidence.audioTracks>0?"live_with_audio":"unknown";
      return {roomId,status,title:evidence.title,readyState:evidence.readyState,audioTracks:evidence.audioTracks};
    } catch(error) { return {roomId,status:error.message,url:win.webContents.getURL(),loading:win.webContents.isLoading()}; }
    finally { win.destroy(); }
  }));
  process.stdout.write(`${JSON.stringify(results,null,2)}\n`); app.exit(0);
}).catch((error)=>{process.stderr.write(`${error.stack}\n`);app.exit(1)});
