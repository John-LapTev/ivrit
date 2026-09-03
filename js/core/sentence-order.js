import { normalizeHebrew, wordKey } from './translit.js';

/* ═══════════════════ SENTENCE-ORDER — разбор собранной фразы ═══════════════════
   Задание «собери фразу из кусков» должно не просто говорить «неверно», а объяснять,
   что именно не так: слова взяты не те или порядок другой. Разница важная — во втором
   случае человек уже почти прав.

   Почему это переписано, а не перенесено: в китайской версии куском был иероглиф,
   и «те же знаки в другом порядке» работало, потому что знак там ≈ слово. На иврите
   слова разделены пробелами, зато буквы у разных слов общие — сравнение наборов БУКВ
   давало бы «слова верные, порядок нет» почти на любой ошибке.                     */

/** Знаки, которые в разборе не участвуют: пунктуация, гереш, гершаим, макаф. */
const PUNCTUATION = /[.,!?;:()«»"'׳״־–—-]/gu;

/** Слитные приставки: для новичка слово с приставкой — один кусок, так честнее. */
const HEBREW = /[֐-׿]/u;

/** Фраза → список слов, приведённых к сравнимому виду. */
export function splitPhrase(text) {
  return normalizeHebrew(text)
    .replace(PUNCTUATION, ' ')
    .split(/\s+/)
    .filter((part) => HEBREW.test(part))
    .map((part) => wordKey(part))
    .filter(Boolean);
}

/** Одинаков ли НАБОР слов — без учёта порядка. Мультимножество, а не множество:
    «אֲנִי רוֹצֶה אֲנִי» и «אֲנִי רוֹצֶה» — разные фразы. */
function sameWordSet(first, second) {
  if (first.length !== second.length) return false;
  const counts = new Map();
  first.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  for (const word of second) {
    const left = counts.get(word);
    if (!left) return false;
    counts.set(word, left - 1);
  }
  return true;
}

/** Первое слово, которое встало не на своё место — на него и показываем. */
function firstMismatch(answer, correct) {
  for (let index = 0; index < Math.max(answer.length, correct.length); index += 1) {
    if (answer[index] !== correct[index]) return index;
  }
  return -1;
}

/**
 * Разбор ответа.
 * @returns {{ok: boolean, kind: string, text: string, at: number}}
 *   kind: 'right' | 'order' | 'extra' | 'missing' | 'wrong'
 *   at — номер слова, на котором разошлось (−1, если неприменимо)
 */
export function checkSentence(answer, correct) {
  const given = splitPhrase(answer);
  const want = splitPhrase(correct);

  if (given.length === want.length && given.every((word, index) => word === want[index])) {
    return { ok: true, kind: 'right', text: 'Верно.', at: -1 };
  }
  if (!given.length) {
    return { ok: false, kind: 'missing', text: 'Фраза пустая — собери её из кусков.', at: -1 };
  }
  if (sameWordSet(given, want)) {
    return {
      ok: false, kind: 'order',
      text: 'Слова все верные, но порядок другой. В иврите определение идёт ПОСЛЕ того, '
        + 'к чему относится: «дом большой», а не «большой дом».',
      at: firstMismatch(given, want),
    };
  }
  if (given.length > want.length) {
    return { ok: false, kind: 'extra', text: 'Лишнее слово — во фразе их меньше.', at: firstMismatch(given, want) };
  }
  if (given.length < want.length) {
    return { ok: false, kind: 'missing', text: 'Фраза не дособрана — не хватает слова.', at: given.length };
  }
  return { ok: false, kind: 'wrong', text: 'Не то слово. Посмотри перевод ещё раз.', at: firstMismatch(given, want) };
}

/**
 * Куски для сборки: слова фразы вперемешку плюс обманки.
 * Обманки берутся из чужих фраз, а не выдумываются — так они выглядят правдоподобно.
 */
export function buildChunks(correct, distractors = []) {
  const words = normalizeHebrew(correct).replace(PUNCTUATION, ' ').split(/\s+/)
    .filter((part) => HEBREW.test(part));
  const keys = new Set(words.map((word) => wordKey(word)));
  const extra = distractors.filter((word) => !keys.has(wordKey(word)));
  return { words, extra };
}
