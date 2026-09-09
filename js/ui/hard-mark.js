import { isHard, toggleHard } from '../core/hard-words.js';
import { el, fill, toast } from './dom.js';
import { uiIcon } from './icons.js';
import { hebText, wordLine } from './word.js';

/* ——— Кружок «трудное слово» ———
   Отзыв 03.09.2026: часть слов он угадывает методом исключения — такое слово надо помечать
   прямо там, где оно попалось. Метка ручная и держится, пока он сам её не снимет;
   приложение её не ставит и не убирает.

   Отдельный модуль, потому что кружок нужен и в тренировке, и в словах дня, а тянуть
   ради него весь экран тренировки в программу занятия — значит замкнуть слои в кольцо. */

/**
 * @param {object} word — слово из словаря
 * @param {string} [extraClass] — например `card-mark`, чтобы посадить кружок в угол карточки
 */
export function hardMark(word, extraClass) {
  const marked = isHard(word.id);
  const classes = ['option-mark'];
  if (marked) classes.push('is-hard');
  if (extraClass) classes.push(extraClass);
  const button = el('button', {
    class: classes.join(' '), type: 'button', 'aria-pressed': marked,
    'aria-label': marked ? `${hebText(word.heb)}: снять метку «трудное»` : `${hebText(word.heb)}: пометить как трудное`,
    title: marked ? 'Помечено как трудное — нажми, чтобы снять' : 'Пометить: это слово я не помню уверенно',
    onclick: async (event) => {
      // Кружок часто лежит поверх кнопки-карточки: нажатие на метку не должно её запускать
      event.stopPropagation();
      const nowHard = await toggleHard(word.id);
      button.classList.toggle('is-hard', nowHard);
      button.setAttribute('aria-pressed', String(nowHard));
      fill(button, nowHard ? uiIcon('check', 14) : null);
      // Слово отдельным узлом: тире рядом с ивритом без изоляции перепрыгивает внутрь него
      toast([wordLine(word.heb), nowHard ? ' — в трудных словах' : ' — метка снята']);
    },
  }, marked ? uiIcon('check', 14) : null);
  return button;
}
