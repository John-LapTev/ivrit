import { splitHebrewLetters, stripNiqqud } from '../core/translit.js';
import { state } from '../core/state.js';
import { el } from './dom.js';

/* ——— Единственная точка вывода слова на иврите ———
   Всё, что показывает ивритский текст, идёт через этот модуль, а не пишет его в textContent
   напрямую. Причина простая: у ивритской строки две сквозные заботы, и обе легко забыть
   в отдельно взятом месте.

   1. Огласовки. Кнопка «спрятать огласовки» обязана действовать ВЕЗДЕ разом — иначе
      человек прячет точки в тренировке и тут же видит их в словаре.
   2. Направление письма. Иврит идёт справа налево, интерфейс — слева направо; класс `heb`
      ставит isolate, без которого точка в конце русской фразы прыгает внутрь ивритской
      вставки.

   Проверка при правках: слово или фраза СЛОВАРЯ, попавшие на экран мимо `hebText()`, — баг.
   Свой `class: 'heb'` законен только для знаков, которые по смыслу не прячутся: буквы
   и огласовки алефбета, значки режимов, «טוב»/«סוֹף» на итоговой карточке, названия рангов. */

/** Текст с учётом настройки «спрятать огласовки». */
export const hebText = (text) => (state.niqqudHidden ? stripNiqqud(text) : text);

/** Сколько букв в слове — по буквам, а не по символам: огласовки за буквы не считаются. */
const letterCount = (text) => splitHebrewLetters(stripNiqqud(text || '')).length;

/**
 * Размер крупного знака. Иероглиф в китайской версии был один-два, ивритское слово —
 * это пять-девять букв плюс пробелы, и постоянный размер ломал его на две строки
 * (замечено при первом запуске 04.09.2026). Поэтому размер считается от длины.
 */
export function bigWordSize(text, max = 96) {
  const count = letterCount(text);
  if (count <= 3) return max;
  if (count <= 5) return Math.round(max * 0.78);
  if (count <= 7) return Math.round(max * 0.62);
  if (count <= 10) return Math.round(max * 0.48);
  return Math.round(max * 0.38);
}

/* ——— Второе лицо буквы: рукописное начертание под печатным ———

   В Израиле от руки пишут курсивом (ктав яд), и печатная буква к нему не ключ: א от руки
   похожа на «lc», ה на «n», ל на петлю. Человек, знающий только печатные буквы, не прочитает
   ни записку, ни ценник, ни заполненный бланк.

   Поэтому под каждой печатной буквой стоит её рукописная пара — БУКВА ПОД БУКВОЙ, а не
   вторая строка целиком: только так видно, какой закорючке какая печатная буква отвечает
   (требование владельца 09.09.2026). Слово раскладывается в сетку колонок, по колонке
   на букву со всеми её огласовками; пробел между словами — своя пустая колонка.

   Выключается в настройках: `state.scriptShown`.                                        */

/** Ивритская буква (без огласовок и конечных форм — те в том же диапазоне). */
const HEBREW_LETTER = /[\u05D0-\u05EA]/;

/** Одна колонка: печатная буква сверху, рукописная под ней. */
const letterColumn = (letter) => el('span', { class: 'heb-col' }, [
  el('span', { class: 'heb-print', text: letter }),
  el('span', { class: 'heb-hand', text: letter }),
]);

/**
 * Разложить ивритский текст на колонки «печатная над рукописной».
 * @param {string} shown — текст уже с учётом настройки огласовок
 */
function letterColumns(shown) {
  return splitHebrewLetters(shown).map((letter) => {
    // Пробел не буква: он не получает пары, а просто разводит слова
    if (!letter.trim()) return el('span', { class: 'heb-gap' });
    // Запятая, точка, кавычки: от руки они пишутся так же — дублировать нечего
    if (!HEBREW_LETTER.test(letter)) return el('span', { class: 'heb-col', text: letter });
    return letterColumn(letter);
  });
}

/** Показывать ли рукописную пару: настройка плюс наличие самих ивритских букв. */
const showsScript = (shown) => state.scriptShown && /[\u0590-\u05FF]/.test(shown);

/**
 * Крупное слово на карточке.
 * @param {string} text — слово на иврите с огласовками
 * @param {number} [max] — предельный размер, когда слово короткое
 */
export function bigWord(text, max) {
  const shown = hebText(text);
  const style = `font-size:${bigWordSize(text, max)}px`;
  if (!showsScript(shown)) return el('div', { class: 'big-heb heb', text: shown, style });
  return el('div', { class: 'big-heb heb heb-pair', style }, letterColumns(shown));
}

/**
 * Слово ТОЛЬКО рукописным начертанием, крупно. Пары здесь быть не может: в режиме
 * «От руки» печатная буква рядом была бы ответом на сам вопрос.
 * @param {string} text — слово на иврите с огласовками
 * @param {number} [max] — предельный размер, когда слово короткое
 */
export function handWord(text, max) {
  return el('div', {
    class: 'big-heb heb heb-only-hand',
    text: hebText(text),
    style: `font-size:${bigWordSize(text, max)}px`,
  });
}

/**
 * Слово в строку — в списках, вариантах ответа, словаре.
 * @param {string} text — слово на иврите с огласовками
 * @param {string} [extraClass] — класс экрана поверх обязательного `heb`
 * @param {number} [sizePx] — кегль, когда экран считает его сам: в плитке «изученных»
 *   слово из семи букв по общему кеглю в неё просто не влезает
 */
export function wordLine(text, extraClass, sizePx) {
  const shown = hebText(text);
  const style = sizePx ? `font-size:${sizePx}px` : null;
  const base = extraClass ? `heb ${extraClass}` : 'heb';
  if (!showsScript(shown)) return el('span', { class: base, text: shown, style });
  return el('span', { class: `${base} heb-pair`, style }, letterColumns(shown));
}

/* ——— Формы слова: род и множественное число ———
   Живут здесь, а не на экране словаря: форма множественного числа — такой же ивритский
   текст, и выводить её обязано то же единственное место. */

/** Род словом, а не буквой: «ж» в базе — для кода, человеку нужен русский. */
const GENDER_LABEL = { м: 'мужской род', ж: 'женский род' };

/** Часть речи вместе с родом: «существительное, женский род». */
export const posLine = (word) => [word.pos, GENDER_LABEL[word.gender]].filter(Boolean).join(', ');

/**
 * Строка «Множественное число: תּוֹדוֹת — тодо́т».
 * Ивритская форма идёт отдельным островком: склеить её с русской подписью в один
 * textContent нельзя — направление письма разное, и двоеточие с тире перепрыгнут внутрь.
 * Чтение берём готовым из данных (`pluralTranslit`), а не считаем здесь: у части слов
 * чтение поправлено вручную под проглоченную шву, и пересчёт на месте разошёлся бы
 * с чтением единственного числа в той же карточке.
 * @returns {HTMLElement|null} null, если множественного числа у слова нет
 */
export function pluralLine(word) {
  if (!word.plural) return null;
  return el('p', { class: 'faint word-forms' }, [
    'Множественное число: ',
    wordLine(word.plural),
    word.pluralTranslit ? ` — ${word.pluralTranslit}` : null,
  ].filter(Boolean));
}
