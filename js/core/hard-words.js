import { HARD_BATCH_SIZE, STORE_HARD } from './constants.js';
import { dbDelete, dbPut } from './db.js';
import { shuffle } from './random.js';
import { dayKey, isStarted } from './srs.js';
import { state } from './state.js';

/* ═══════════════════ HARD — трудные слова ═══════════════════
   Иван 03.09.2026: «какие-то слова я помню сразу, а какие-то угадываю методом исключения».
   Кружок у варианта ответа помечает именно такое слово. Метка ручная и держится, пока он
   сам её не снимет: приложение её не ставит и не убирает.

   Раздел с этими словами — отдельный, необязательный. Интервалы повторений (SM-2) он
   намеренно НЕ трогает: это прогон для себя, а не проверка, и слово не должно улететь
   в дальние повторения только потому, что здесь его прогнали лишний раз.               */

/** Четыре прохода по слову — от узнавания к самостоятельной речи, в этом порядке.
    Значок — первая буква ивритского названия режима: בְּחִירָה (выбор), כְּתִיבָה (письмо),
    תַּרְגּוּם (перевод), דִּבּוּר (речь). */
export const HARD_MODES = [
  { id: 'choice', icon: 'ב', title: 'Выбрать из четырёх',
    note: 'Русский на карточке — выбираешь нужное слово на иврите.' },
  { id: 'typeHeb', icon: 'כ', title: 'Написать на иврите',
    note: 'Русский на карточке — набираешь слово ивритскими буквами.' },
  { id: 'typeRu', icon: 'ת', title: 'Написать перевод',
    note: 'Слово на иврите — набираешь перевод по-русски.' },
  { id: 'speak', icon: 'ד', title: 'Сказать вслух',
    note: 'Русский на карточке — говоришь на иврите, запись сверяется с образцом.' },
];

export const hardMode = (id) => HARD_MODES.find((mode) => mode.id === id) || null;

export const isHard = (wordId) => state.hard.has(wordId);

/** Помеченные слова в том порядке, в каком их отмечали: заходы идут по этому списку. */
export function hardWords() {
  return Array.from(state.hard.values())
    .sort((first, second) => String(first.addedAt).localeCompare(String(second.addedAt))
      || first.wordId - second.wordId)
    .map((record) => state.words.find((word) => word.id === record.wordId))
    .filter(Boolean);
}

export const hardCount = () => hardWords().length;

/** Пройден ли этим словом конкретный режим в текущем круге. */
export function hardModePassed(wordId, modeId) {
  const record = state.hard.get(wordId);
  return Boolean(record && record.passed && record.passed[modeId]);
}

/** Ставит или снимает метку. Возвращает новое состояние — по нему рисуется кружок. */
export async function toggleHard(wordId) {
  if (state.hard.has(wordId)) {
    state.hard.delete(wordId);
    await dbDelete(STORE_HARD, wordId);
    return false;
  }
  const record = { wordId, addedAt: new Date().toISOString(), passed: {}, runs: 0 };
  state.hard.set(wordId, record);
  await dbPut(STORE_HARD, record);
  return true;
}

/** Отмечает, что слово прошло режим. Ошибки ничего не отмечают — слово остаётся в очереди. */
export async function markHardPassed(wordId, modeId) {
  const record = state.hard.get(wordId);
  if (!record) return;
  const updated = Object.assign({}, record, {
    passed: Object.assign({}, record.passed, { [modeId]: true }),
    lastDay: dayKey(),
  });
  state.hard.set(wordId, updated);
  await dbPut(STORE_HARD, updated);
}

/**
 * Заход в режим: десять слов. Сначала те, что этот режим ещё не проходили; если их
 * осталось меньше десяти — добираем случайными из уже пройденных, чтобы заход всегда
 * был полным (прямая просьба Ивана: «осталось 3 — беру ещё 7 рандомно из прошедших»).
 */
export function hardBatch(modeId) {
  /* В заход идут только слова, которые человек действительно проходил. Кружок стоит
     у каждого варианта ответа, поэтому в список легко попадает обманка — и потом всплывает
     как слово для повторения (Иван 03.09.2026: «слова „сын“ у нас вообще не было»).
     Метку с таких слов снимает он сам, а до тех пор они просто не мешают. */
  const words = hardWords().filter((word) => isStarted(state.srs.get(word.id)));
  const pending = words.filter((word) => !hardModePassed(word.id, modeId));
  const passed = words.filter((word) => hardModePassed(word.id, modeId));
  const batch = pending.slice(0, HARD_BATCH_SIZE);
  if (batch.length < HARD_BATCH_SIZE) {
    batch.push(...shuffle(passed).slice(0, HARD_BATCH_SIZE - batch.length));
  }
  return shuffle(batch);
}

/** Сколько слов уже прошло режим и сколько осталось — для подписи под кнопкой режима.
    Считаем по тем же словам, что идут в заход: непройденные в счёт не берём. */
export function hardModeProgress(modeId) {
  const words = hardWords().filter((word) => isStarted(state.srs.get(word.id)));
  const done = words.filter((word) => hardModePassed(word.id, modeId)).length;
  return { done, total: words.length, left: words.length - done };
}

/** Общая шкала раздела: каждое слово должно пройти все четыре режима. */
export function hardProgress() {
  const words = hardWords().filter((word) => isStarted(state.srs.get(word.id)));
  const total = words.length * HARD_MODES.length;
  const done = words.reduce((sum, word) =>
    sum + HARD_MODES.filter((mode) => hardModePassed(word.id, mode.id)).length, 0);
  const runs = words.reduce((max, word) => {
    const record = state.hard.get(word.id);
    return Math.max(max, (record && record.runs) || 0);
  }, 0);
  const fullyDone = words.filter((word) =>
    HARD_MODES.every((mode) => hardModePassed(word.id, mode.id))).length;
  return { done, total, fullyDone, percent: total ? Math.round((done / total) * 100) : 0,
    complete: total > 0 && done === total, round: runs + 1 };
}

/** Круг закрыт — начинаем новый: отметки режимов обнуляются, метки остаются на месте. */
export async function startNewHardRound() {
  const records = Array.from(state.hard.values()).map((record) => Object.assign({}, record, {
    passed: {}, runs: ((record.runs || 0) + 1),
  }));
  for (const record of records) {
    state.hard.set(record.wordId, record);
    await dbPut(STORE_HARD, record);
  }
}
