/* ═══════════════════ RECORDER — запись голоса с микрофона ═══════════════════
   Нужна одному заданию: сказать вслух и проверить себя. Записанное никуда не уходит —
   разбор считается прямо в браузере (см. core/voice-match.js), в сеть не отправляется ничего.
   Это принципиально: приложение офлайновое, и голос владельца остаётся у него.        */

let stream = null;
let recorder = null;

/** Просит микрофон один раз и держит поток: повторное разрешение не запрашивается. */
async function ensureStream() {
  if (stream && stream.active) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ audio: {
    echoCancellation: true, noiseSuppression: true, autoGainControl: false,
  } });
  return stream;
}

export const canRecord = () => Boolean(navigator.mediaDevices && window.MediaRecorder);

/** Начинает запись; возвращает функцию остановки, которая отдаёт готовый кусок звука. */
export async function startRecording() {
  const active = await ensureStream();
  const parts = [];
  recorder = new MediaRecorder(active);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) parts.push(event.data);
  });
  recorder.start();

  return () => new Promise((resolve) => {
    recorder.addEventListener('stop', () => resolve(new Blob(parts, { type: recorder.mimeType })),
      { once: true });
    if (recorder.state !== 'inactive') recorder.stop();
  });
}

/** Отпускает микрофон — чтобы не горел индикатор записи, когда задание закрыто. */
export function releaseMicrophone() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  recorder = null;
}
