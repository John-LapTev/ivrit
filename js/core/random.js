/* ═══════════════════ RANDOM — перемешивание и выбор ═══════════════════
   Отдельный модуль без зависимостей: до него `shuffle` жил в modes.js, а его копия —
   в hard-words.js (аудит 03.09.2026). Держать такое в двух местах нельзя, а тянуть
   ради трёх строк весь слой режимов — тем более.                                     */

/** Перемешивание Фишера — Йетса: исходный список не трогаем, возвращаем копию. */
export function shuffle(list) {
  const copy = list.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
