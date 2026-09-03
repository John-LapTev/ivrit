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

   Проверка при правках: `grep "class: 'heb'" app/js` не должен находить ничего вне этого файла. */

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

/**
 * Крупное слово на карточке.
 * @param {string} text — слово на иврите с огласовками
 * @param {number} [max] — предельный размер, когда слово короткое
 */
export function bigWord(text, max) {
  const shown = hebText(text);
  return el('div', {
    class: 'big-heb heb',
    text: shown,
    style: `font-size:${bigWordSize(text, max)}px`,
  });
}

/** Слово в строку — в списках, вариантах ответа, словаре. */
export function wordLine(text, extraClass) {
  return el('span', { class: extraClass ? `heb ${extraClass}` : 'heb', text: hebText(text) });
}
