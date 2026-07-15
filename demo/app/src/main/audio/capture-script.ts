export const START_PAGE_CAPTURE_SCRIPT = `(() => {
  if (window.__duoduoCaptureStop) return true;
  const video = [...document.querySelectorAll('video')].find((item) => !item.paused && item.readyState >= 2) || document.querySelector('video');
  if (!video) throw new Error('VIDEO_NOT_FOUND');
  const stream = video.captureStream?.() || video.mozCaptureStream?.();
  if (!stream || !stream.getAudioTracks().length) throw new Error('AUDIO_TRACK_NOT_FOUND');
  stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => window.postMessage({ source: 'duoduo-room-capture-ended' }, '*'), { once: true }));
  window.__duoduoCaptureStream = stream;
  const context = new AudioContext({ sampleRate: 16000 });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, 1, 1);
  const silence = context.createGain(); silence.gain.value = 0;
  processor.onaudioprocess = (event) => {
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    window.postMessage({ source: 'duoduo-room-capture', sampleRate: context.sampleRate, samples }, '*', [samples.buffer]);
  };
  source.connect(processor); processor.connect(silence); silence.connect(context.destination);
  window.__duoduoCaptureStop = async () => { processor.disconnect(); source.disconnect(); silence.disconnect(); stream.getTracks().forEach((track) => track.stop()); await context.close(); delete window.__duoduoCaptureStream; delete window.__duoduoCaptureStop; };
  return true;
})()`;

export const STOP_PAGE_CAPTURE_SCRIPT = `window.__duoduoCaptureStop?.()`;
