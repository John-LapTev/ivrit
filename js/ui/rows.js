import { el } from './dom.js';
import { uiIcon } from './icons.js';

/* ═══════════════════ Строка-ход ═══════════════════

   Второстепенное действие экрана выглядит СТРОКОЙ, а не ещё одной карточкой.
   Главное действие на экране одно, и его рисует остров; если каждый следующий ход
   тоже оформить плашкой, экран снова превращается в витрину, где всё кричит поровну.
   Строки разделяет волосяная линия — так же, как строки любого списка.              */

export function sideRow(options) {
  return el('button', { class: 'side-row', type: 'button', onclick: options.onclick }, [
    el('span', { class: 'side-text' }, [
      el('b', { text: options.title }),
      el('span', { class: 'faint', text: options.note }),
    ]),
    uiIcon('arrow-right', 20),
  ]);
}
