import { HARD_BATCH_SIZE } from '../core/constants.js';
import { HARD_MODES, hardModeProgress, hardProgress, hardWords, startNewHardRound, toggleHard } from '../core/hard-words.js';
import { isStarted } from '../core/srs.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { el, fill, plural } from './dom.js';
import { wordLine } from './word.js';
import { uiIcon } from './icons.js';
import { beginHardDrill } from './hard-drill.js';
import { showScreen } from './screens.js';

/* ——— Раздел «Трудные слова» ———
   Свой список, свой прогресс, четыре режима подряд. К дневной норме повторений он не
   привязан: сюда заходят, когда хочется добить слова, которые всё время угадываются.   */

export function renderHardScreen() {
  const words = hardWords();
  const body = document.getElementById('hard-body');
  document.getElementById('hard-back').textContent = '← На главную';

  if (!words.length) {
    fill(body, el('div', { class: 'card' }, [
      el('b', { text: 'Пока ни одного слова' }),
      el('p', { class: 'faint', text: 'В тренировке справа от каждого варианта ответа есть кружок. '
        + 'Нажми его на слове, в котором не уверен — оно попадёт сюда. Метка держится, пока сам её не снимешь.' }),
      el('button', { class: 'btn btn-wide', type: 'button', style: 'margin-top:12px',
        onclick: () => showScreen('home') }, 'На главную'),
    ]));
    return;
  }

  const progress = hardProgress();
  const inWork = words.filter((word) => isStarted(state.srs.get(word.id)));
  const children = [
    el('div', { class: 'card' }, [
      el('div', { class: 'row-between' }, [
        el('b', { text: `Круг ${progress.round}` }),
        el('span', { class: 'faint', text: `${inWork.length} ${plural(inWork.length, 'слово', 'слова', 'слов')} в работе` }),
      ]),
      el('div', { class: 'level-bar' }, el('span', { style: `width:${progress.percent}%` })),
      /* Иван прочитал «0 из 75» как число слов и не понял, откуда оно (03.09.2026):
         считаем словами, а сумму проходов уводим в пояснение. */
      el('p', { class: 'faint', style: 'margin:0', text: progress.complete
        ? 'Все слова прошли все четыре режима. Можно начать круг заново или снять метки с тех, что уже держатся в голове.'
        : `Полностью отработано ${progress.fullyDone} из ${inWork.length} `
          + `${plural(inWork.length, 'слова', 'слов', 'слов')}: слово считается пройденным, `
          + `когда одолело все четыре режима (${progress.done} из ${progress.total} проходов).` }),
    ]),
  ];

  if (progress.complete) {
    children.push(el('div', { class: 'center', style: 'margin-top:16px' }, el('button', {
      class: 'btn', type: 'button',
      onclick: async () => { await startNewHardRound(); renderHardScreen(); },
    }, 'Начать круг заново')));
  }

  children.push(el('h2', { text: 'Режимы' }));
  children.push(el('p', { class: 'faint', text: `За заход берётся ${HARD_BATCH_SIZE} слов. `
    + 'Если непройденных осталось меньше, добираются уже пройденные — заход всегда полный.' }));
  children.push(el('div', { class: 'hard-modes' }, HARD_MODES.map((mode, index) => {
    const modeProgress = hardModeProgress(mode.id);
    const blocked = mode.id === 'speak' && !speech.available;
    return el('button', {
      class: 'hard-mode', type: 'button', disabled: blocked,
      title: blocked ? 'Для этого режима нужен звук' : mode.note,
      onclick: () => beginHardDrill(mode.id),
    }, [
      el('span', { class: 'hard-mode-icon heb', text: mode.icon }),
      el('span', { class: 'hard-mode-body' }, [
        el('span', { class: 'hard-mode-title', text: `${index + 1}. ${mode.title}` }),
        el('span', { class: 'faint', text: mode.note }),
      ]),
      el('span', { class: `badge${modeProgress.left ? '' : ' badge-ok'}`,
        text: `${modeProgress.done} из ${modeProgress.total}` }),
    ]);
  })));

  children.push(el('h2', { text: 'Помеченные слова' }));
  children.push(el('p', { class: 'faint', text: 'Крестик справа снимает метку — слово уйдёт из раздела.' }));

  /* Кружок стоит у каждого варианта ответа, и вместе с нужным словом легко пометить
     обманку, которую и не учил (Иван 03.09.2026: «слова „сын“ у нас вообще не было»).
     Такие слова видно по подписи, а эта кнопка убирает их все разом. */
  const untouched = words.filter((word) => !isStarted(state.srs.get(word.id)));
  if (untouched.length) {
    children.push(el('div', { class: 'card', style: 'margin-bottom:16px' }, [
      el('b', { text: `Не из твоих слов: ${untouched.length}` }),
      el('p', { class: 'faint', text: 'Эти слова ты ни разу не проходил — скорее всего, кружок '
        + 'нажался на чужом варианте ответа. В повторение они не идут, но и в списке не нужны.' }),
      el('button', {
        class: 'btn btn-small', type: 'button',
        onclick: async () => {
          for (const word of untouched) await toggleHard(word.id);
          renderHardScreen();
        },
      }, `Убрать все ${untouched.length}`),
    ]));
  }
  words.forEach((word) => {
    const passed = HARD_MODES.filter((mode) => {
      const record = state.hard.get(word.id);
      return record && record.passed && record.passed[mode.id];
    }).length;
    const untouchedWord = !isStarted(state.srs.get(word.id));
    children.push(el('div', { class: `word-row${untouchedWord ? ' is-locked' : ''}` }, [
      wordLine(word.heb),
      el('span', { class: 'word-meta' }, [
        el('div', { class: 'word-translit', text: word.translit }),
        el('div', { class: 'word-translation', text: word.translation }),
        untouchedWord ? el('div', { class: 'faint', text: 'не проходил' }) : null,
      ].filter(Boolean)),
      el('span', { class: 'badge', title: `Пройдено режимов: ${passed} из ${HARD_MODES.length}`,
        text: `${passed}/${HARD_MODES.length}` }),
      speech.available ? el('button', {
        class: 'hard-round', type: 'button', 'aria-label': `Озвучить ${word.heb}`,
        onclick: () => speech.speak(word.heb),
      }, uiIcon('sound', 16)) : null,
      el('button', {
        class: 'hard-round hard-drop', type: 'button', 'aria-label': `Снять метку с ${word.heb}`,
        title: 'Снять метку — слово уйдёт из раздела',
        onclick: async () => { await toggleHard(word.id); renderHardScreen(); },
      }, uiIcon('close', 15)),
    ]));
  });

  fill(body, children);
}

/** Карточка раздела: показывается на главной, когда есть что повторять. */
export function hardCard(fromScreen) {
  const words = hardWords();
  if (!words.length) return null;
  const progress = hardProgress();
  return el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: 'Трудные слова' }),
      el('span', { class: 'faint', text: `${words.length} ${plural(words.length, 'слово', 'слова', 'слов')}` }),
    ]),
    el('div', { class: 'level-bar' }, el('span', { style: `width:${progress.percent}%` })),
    el('p', { class: 'faint', text: progress.complete
      ? 'Круг пройден целиком — можно начать заново.'
      : 'Те, что ты пометил кружком. Отдельный прогон, на сроки повторений он не влияет.' }),
    el('button', {
      class: 'btn btn-quiet btn-wide', type: 'button',
      onclick: () => { state.hardReturn = fromScreen || 'home'; showScreen('hard'); },
    }, 'Повторить трудные слова'),
  ]);
}
