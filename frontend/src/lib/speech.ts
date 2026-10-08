import { api } from '../api';

// Speech recognition for the speaking minigames. Either the browser's own
// recogniser (Chrome / Edge) or recording + a Whisper-compatible service
// (Google Colab notebook or an API) configured in Configuration → Services.

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionEvent {
  results: ArrayLike<ArrayLike<RecognitionAlternative> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  maxAlternatives: number;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionConstructor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function browserRecognitionAvailable(): boolean {
  return recognitionConstructor() !== null;
}

export interface Listening {
  result: Promise<string[]>;
  stop(): void;
  // 0..1 microphone level for the meter (recording mode only).
  level(): number;
}

function listenWithBrowser(locale: string): Listening {
  const Constructor = recognitionConstructor();
  if (!Constructor) throw new Error('This browser has no built-in speech recognition. Choose Colab or an API in Configuration → Services.');
  const recognition = new Constructor();
  recognition.lang = locale;
  recognition.maxAlternatives = 5;
  recognition.interimResults = false;
  recognition.continuous = false;
  const result = new Promise<string[]>((resolve, reject) => {
    const heard: string[] = [];
    recognition.onresult = (event) => {
      for (let i = 0; i < event.results.length; i++) {
        const alternatives = event.results[i];
        for (let j = 0; j < alternatives.length; j++) heard.push(alternatives[j].transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') resolve([]);
      else
        reject(
          new Error(
            event.error === 'network'
              ? 'Speech recognition needs Google servers, which are unavailable here (e.g. inside the desktop window). Use Colab or an API instead.'
              : `Speech recognition error: ${event.error}`
          )
        );
    };
    recognition.onend = () => resolve(heard);
  });
  recognition.start();
  return { result, stop: () => recognition.stop(), level: () => 0 };
}

function listenWithRecorder(target: string): Listening {
  let stopRequested = false;
  let stopRecording: () => void = () => {
    stopRequested = true;
  };
  let currentLevel = 0;
  const result = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let spoke = false;
    let silentSince = performance.now();
    const startedAt = performance.now();
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    stopRecording = () => {
      if (recorder.state === 'recording') recorder.stop();
    };
    // Stop automatically after the learner finishes speaking.
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      currentLevel = Math.min(1, rms * 8);
      const now = performance.now();
      if (rms > 0.03) {
        spoke = true;
        silentSince = now;
      }
      if ((spoke && now - silentSince > 1300) || now - startedAt > 15000 || (!spoke && now - startedAt > 7000)) stopRecording();
    }, 60);
    recorder.start();
    if (stopRequested) stopRecording();
    await stopped;
    window.clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    if (!spoke) return [];
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const { text } = await api.transcribe(target, blob);
    return text ? [text] : [];
  })();
  return { result, stop: () => stopRecording(), level: () => currentLevel };
}

export function startListening(provider: string, target: string, locale: string): Listening {
  return provider === 'browser' ? listenWithBrowser(locale) : listenWithRecorder(target);
}
