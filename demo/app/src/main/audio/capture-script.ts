export const START_PAGE_CAPTURE_SCRIPT = `(async () => {
  if (window.__duoduoCaptureStop) return true;
  const video = [...document.querySelectorAll('video')].find((item) => !item.paused && item.readyState >= 2) || document.querySelector('video');
  if (!video) throw new Error('VIDEO_NOT_FOUND');
  if (video.paused) await video.play();
  const stream = video.captureStream?.() || video.mozCaptureStream?.();
  if (!stream || !stream.getAudioTracks().length) throw new Error('AUDIO_TRACK_NOT_FOUND');
  let context, source, processor, silence;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const node of [processor, source, silence]) { try { node?.disconnect(); } catch {} }
    stream.getTracks().forEach((track) => track.stop());
    if (window.__duoduoCaptureStop === stop) {
      delete window.__duoduoCaptureStream;
      delete window.__duoduoCaptureVideo;
      delete window.__duoduoCaptureContext;
      delete window.__duoduoCaptureStop;
    }
    await context?.close();
  };
  window.__duoduoCaptureStop = stop;
  window.__duoduoCaptureStream = stream;
  window.__duoduoCaptureVideo = video;
  try {
    stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
      if (!stopped) window.postMessage({ source: 'duoduo-room-capture-ended' }, '*');
    }, { once: true }));
    context = new AudioContext({ sampleRate: 16000 });
    window.__duoduoCaptureContext = context;
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(2048, 1, 1);
    silence = context.createGain(); silence.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (stopped) return;
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      window.postMessage({ source: 'duoduo-room-capture', sampleRate: context.sampleRate, samples }, '*', [samples.buffer]);
    };
    source.connect(processor); processor.connect(silence); silence.connect(context.destination);
    if (context.state === 'suspended') await context.resume();
    return true;
  } catch (error) { await stop().catch(() => {}); throw error; }
})()`;

export const STOP_PAGE_CAPTURE_SCRIPT = `(async () => { await window.__duoduoCaptureStop?.(); return true; })()`;
