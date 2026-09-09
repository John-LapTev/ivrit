/* ═══════════════════ Волна от точки касания ═══════════════════

   На телефоне :hover не существует, а `transform: scale(.97)` слишком тихий —
   палец закрывает кнопку и человек не понимает, засчиталось нажатие или нет.
   Волна расходится из точки, которой коснулись, и снимает этот вопрос.

   Один слушатель на документ вместо обработчика на каждой кнопке: кнопки в этом
   приложении перерисовываются целыми экранами, вешать на них что-то поштучно —
   значит терять слушатели при каждой перерисовке.                                */

/** Элементы, у которых волна уместна: их нажимают, и у них есть своё ложе. */
const TARGETS = '.btn, .chip, .tab, .mode-btn, .topic-tile, .option, .speak-btn, .icon-btn, '
  + '.day-word, .word-row, .lesson-row, .side-row';

export function startRipple() {
  document.addEventListener('pointerdown', (event) => {
    // Клавиатурный «клик» приходит без координат — волна уехала бы в левый верхний угол
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target.closest(TARGETS);
    if (!target || target.disabled) return;

    const box = target.getBoundingClientRect();
    // Диаметр по дальнему углу: волна обязана накрыть кнопку целиком
    const size = Math.hypot(Math.max(event.clientX - box.left, box.right - event.clientX),
      Math.max(event.clientY - box.top, box.bottom - event.clientY)) * 2;

    const wave = document.createElement('span');
    wave.className = 'ripple';
    wave.style.width = `${size}px`;
    wave.style.height = `${size}px`;
    wave.style.left = `${event.clientX - box.left - size / 2}px`;
    wave.style.top = `${event.clientY - box.top - size / 2}px`;
    wave.addEventListener('animationend', () => wave.remove());
    target.appendChild(wave);
  });
}
