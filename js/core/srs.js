import { EASE_MIN, EASE_START, INTERVAL_FIRST, INTERVAL_SECOND, QUALITY_HARD } from './constants.js';

/* ═══════════════════ SRS — интервальные повторения (SM-2) ═══════════════════ */

/** Дата в виде YYYY-MM-DD по местному времени: интервалы считаем днями, не часами. */
export function dayKey(date) {
  const value = date || new Date();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

export function addDays(dayString, count) {
  const [year, month, day] = dayString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + count);
  return dayKey(date);
}

function daysBetween(fromDay, toDay) {
  const [fy, fm, fd] = fromDay.split('-').map(Number);
  const [ty, tm, td] = toDay.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

export function createSrsRecord(wordId) {
  return {
    wordId,
    ease: EASE_START,
    interval: 0,
    repetitions: 0,
    due: dayKey(),
    lapses: 0,
    seen: 0,
    errors: 0,
    stressErrors: 0,
    lastResult: null,
    lastSeenDay: null,
  };
}

/**
 * Классический SM-2: качество ответа 0–5 двигает интервал и «лёгкость» слова.
 * Ошибка (q < 3) сбрасывает счётчик повторений — слово возвращается на завтра.
 */
export function applySm2(record, quality) {
  const updated = Object.assign({}, record);
  updated.seen += 1;
  updated.lastResult = quality;
  updated.lastSeenDay = dayKey();

  if (quality < QUALITY_HARD) {
    updated.repetitions = 0;
    updated.interval = INTERVAL_FIRST;
    updated.lapses += 1;
  } else {
    updated.repetitions += 1;
    if (updated.repetitions === 1) updated.interval = INTERVAL_FIRST;
    else if (updated.repetitions === 2) updated.interval = INTERVAL_SECOND;
    else updated.interval = Math.round(updated.interval * updated.ease);
  }

  const easeShift = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  updated.ease = Math.max(EASE_MIN, updated.ease + easeShift);
  updated.due = addDays(dayKey(), updated.interval);
  return updated;
}

export const isDue = (record, today) => !record.due || record.due <= today;

/* Слово считается выученным, когда пережило три успешных повторения подряд. */
const LEARNED_REPETITIONS = 3;
export const isLearned = (record) => Boolean(record) && record.repetitions >= LEARNED_REPETITIONS;
export const isStarted = (record) => Boolean(record) && record.seen > 0;

/**
 * Ответ в тренировке «для себя» (раздел трудных слов): счётчики растут, интервалы — нет.
 * Иван 03.09.2026: «статистика по слову должна считаться во всех режимах». При этом
 * прогонять слово лишний раз не должно отодвигать его повторение — поэтому ease,
 * interval и due остаются нетронутыми.
 */
export function applyPractice(record, correct) {
  const updated = Object.assign({}, record);
  updated.seen += 1;
  if (!correct) updated.errors += 1;
  updated.lastSeenDay = dayKey();
  return updated;
}
