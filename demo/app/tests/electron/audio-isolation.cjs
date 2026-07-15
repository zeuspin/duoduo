const { app, BrowserWindow, ipcMain, session } = require("electron");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const frequencies = [440, 660, 880];
const captures = new Map();
const ended = new Set();
const windows = [];

function dominantFrequency(samples, sampleRate) {
  let bestFrequency = 0; let bestPower = -Infinity;
  for (let frequency = 350; frequency <= 950; frequency += 5) {
    let real = 0; let imaginary = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const angle = 2 * Math.PI * frequency * index / sampleRate;
      real += samples[index] * Math.cos(angle); imaginary -= samples[index] * Math.sin(angle);
    }
    const power = real * real + imaginary * imaginary;
    if (power > bestPower) { bestPower = power; bestFrequency = frequency; }
  }
  return bestFrequency;
}

ipcMain.on("room-capture:audio", (_event, payload) => {
  const list = captures.get(payload.token);
  if (list && list.length < 8192) list.push(...payload.samples);
});
ipcMain.on("room-capture:ended", (_event, payload) => ended.add(payload.token));

app.whenReady().then(async () => {
  const preload = resolve(".vite/build/room-capture.js");
  for (const frequency of frequencies) {
    const token = `room-${frequency}`; captures.set(token, []);
    const isolated = session.fromPartition(`fixture-${frequency}-${Date.now()}`);
    const win = new BrowserWindow({ show: false, webPreferences: { preload, session: isolated, additionalArguments: [`--duoduo-capture-token=${token}`], contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    windows.push(win); win.webContents.setAudioMuted(true);
    const source = pathToFileURL(resolve(`tests/fixtures/live-room/${frequency}.mp4`)).href;
    await win.loadFile(resolve("tests/fixtures/live-room/player.html"), { query: { src: source } });
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    await win.webContents.executeJavaScript(`(() => { const video=document.querySelector('video'); const stream=video.captureStream(); window.__duoduoCaptureStream=stream; stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>window.postMessage({source:'duoduo-room-capture-ended'},'*'),{once:true})); const context=new AudioContext({sampleRate:16000}); const source=context.createMediaStreamSource(stream); const processor=context.createScriptProcessor(2048,1,1); const silence=context.createGain(); silence.gain.value=0; processor.onaudioprocess=(event)=>{const samples=new Float32Array(event.inputBuffer.getChannelData(0));window.postMessage({source:'duoduo-room-capture',sampleRate:context.sampleRate,samples},'*',[samples.buffer]);};source.connect(processor);processor.connect(silence);silence.connect(context.destination); })()`, true);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 3500));
  const results = frequencies.map((expected) => {
    const samples = Float32Array.from(captures.get(`room-${expected}`).slice(0, 8192));
    return { expected, actual: dominantFrequency(samples, 16000), samples: samples.length };
  });
  await Promise.all(windows.map((win) => win.webContents.executeJavaScript(`window.__duoduoCaptureStream.getAudioTracks()[0].dispatchEvent(new Event('ended'))`,true)));
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  const ok = results.every((item) => item.samples >= 4096 && Math.abs(item.actual - item.expected) <= 10) && ended.size === 3;
  process.stdout.write(`${JSON.stringify({ ok, results, endedTracks: ended.size })}\n`);
  for (const win of windows) win.destroy();
  app.exit(ok ? 0 : 1);
}).catch((error) => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
