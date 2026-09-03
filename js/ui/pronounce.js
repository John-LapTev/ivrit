import { canRecord, startRecording } from '../core/recorder.js';
import { speech } from '../core/speech.js';
import { compareSound, soundProfile } from '../core/voice-match.js';
import { el, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';

/* ═══════════════════ PRONOUNCE — проверка собственного произношения ═══════════════════
   Записал фразу — сравнили с образцовой записью той же фразы — сказали, похоже или нет.
   Никаких моделей распознавания: звучание сравнивается по спектру с выравниванием
   во времени (core/voice-match.js). Запись никуда не уходит, всё считается прямо
   в браузере.

   Модуль общий для заданий программы и раздела трудных слов: раньше все эти семьдесят
   строк были скопированы в оба экрана, и тексты вердиктов уже успели разойтись
   (аудит 03.09.2026).                                                                  */

const SAMPLE_RATE = 16000;           // столько же ждёт разбор в core/voice-match.js

/** Приводит запись к 16 кГц моно — с этим считать проще и быстрее. */
async function toSamples(blob) {
  const bytes = await blob.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await context.decodeAudioData(bytes);
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Раскладывает запись на портрет звучания — то, что и сравнивается с образцом. */
export async function analyseClip(blob) {
  return soundProfile(await toSamples(blob));
}

export async function analyseUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('запись недоступна');
  return analyseClip(await response.blob());
}

/** Короткий вывод по проверке; подробности с процентами показывает attemptDetails. */
function verdictOf(sound) {
  if (sound.ok) return { ok: true, text: 'Похоже на образец.' };
  return { ok: false, text: 'Пока не похоже. Послушай образец и повтори за ним.' };
}

/**
 * Записывает попытку и сравнивает её с образцом. Состояние держит вызывающий экран
 * (у него свой объект задания), поэтому сюда передаётся и объект, и функция перерисовки —
 * так один и тот же разбор работает и в задании программы, и в трудных словах.
 */
export async function recordAttempt(holder, heb, rerender) {
  if (!canRecord()) { toast('Этот браузер не даёт доступ к микрофону.', true); return; }
  if (holder.recording || holder.asking) return;   // разрешение уже просим — второй раз не надо
  const referenceUrl = speech.clipUrl(heb);
  if (!referenceUrl) { toast('Для этой фразы нет образцовой записи — сравнить не с чем.', true); return; }
  try {
    // Разрешение на микрофон браузер спрашивает у человека, и ответа может не быть долго.
    // Поэтому сначала показываем, что ждём, и только потом начинаем запись.
    holder.asking = true;
    holder.attempt = null;
    rerender();
    const stop = await startRecording();
    holder.asking = false;
    holder.recording = true;
    rerender();
    holder.stopRecording = async () => {
      holder.recording = false;
      holder.checking = true;
      rerender();
      try {
        const blob = await stop();
        const [reference, attempt] = await Promise.all([analyseUrl(referenceUrl), analyseClip(blob)]);
        const sound = compareSound(reference, attempt);
        holder.attempt = Object.assign(verdictOf(sound), { sound });
      } catch (error) {
        holder.attempt = { ok: false, text: 'Не получилось разобрать запись. Попробуй ещё раз.' };
      }
      holder.checking = false;
      rerender();
    };
  } catch (error) {
    holder.asking = false;
    holder.recording = false;
    toast('Микрофон не разрешён — проверить произношение не выйдет.', true);
    rerender();
  }
}

/** Подробность проверки строкой: насколько близко прозвучали сами звуки. */
export function attemptDetails(attempt) {
  if (!attempt || !attempt.sound) return null;
  return el('div', { class: 'check-list' }, [
    el('div', { class: 'check-line' }, [
      uiIcon(attempt.sound.ok ? 'check' : 'close', 14),
      el('span', {}, [
        el('b', { text: 'Звуки: ' }),
        el('span', { text: attempt.sound.text }),
      ]),
    ]),
  ]);
}

/** Кнопка записи со всеми её состояниями: просим микрофон, пишем, слушаем. */
export function recordButton(holder, heb, rerender, wide) {
  if (!canRecord()) return null;
  return el('button', {
    class: holder.recording ? `btn${wide ? ' btn-wide' : ''}` : `btn btn-quiet${wide ? ' btn-wide' : ''}`,
    type: 'button', disabled: Boolean(holder.asking || holder.checking),
    onclick: () => (holder.recording ? holder.stopRecording() : recordAttempt(holder, heb, rerender)),
  }, holder.asking ? iconLabel('sound', 'Разреши микрофон…')
    : holder.recording ? iconLabel('stop', 'Готово, проверь')
    : iconLabel('sound', 'Записать себя и проверить'));
}
