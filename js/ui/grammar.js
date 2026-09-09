import { STORE_GRAMMAR } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { shuffle } from '../core/modes.js';
import { buildChunks, checkSentence } from '../core/sentence-order.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { wordKey } from '../core/translit.js';
import { GRAMMAR_LESSONS } from '../data/grammar.js';
import { el, fill, plural, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen, syncBackButton } from './screens.js';
import { finishTeacherReturn } from './train.js';
import { hebText, wordLine } from './word.js';

/* ═══════════════════ ГРАММАТИКА — список уроков и сам урок ═══════════════════
   Урок устроен в три слоя: правило одной строкой → объяснение и три примера →
   тренажёр «собери фразу». Последний и есть проверка: правило можно прочитать и
   кивнуть, а собрать фразу без него не получится.                                */

/** Сколько лишних слов подмешивается к кускам: два заставляют думать, но не гадать. */
const DISTRACTOR_LIMIT = 2;

/** Короткий приговор в шапке разбора; подробности берём из checkSentence. */
const SHORT_VERDICT = {
  order: 'Слова верные, порядок нет',
  extra: 'Слово лишнее',
  missing: 'Фраза не дособрана',
  wrong: 'Слово не то',
};

/** Объяснение приходит одной строкой в несколько абзацев — разводим их по <p>. */
const paragraphsOf = (text) => String(text || '')
  .split(/\n+/)
  .map((part) => part.trim())
  .filter(Boolean);

/* ——— Список уроков ——— */

export function renderLessonList() {
  fill('lesson-list', GRAMMAR_LESSONS.map((lesson, index) => {
    const progress = state.grammarProgress.get(lesson.id);
    const count = lesson.drills.length;
    const badge = progress && progress.done
      ? el('span', { class: 'badge badge-ok', text: 'пройден' })
      : el('span', { class: 'badge', text: `${count} ${plural(count, 'фраза', 'фразы', 'фраз')}` });
    return el('button', {
      class: 'lesson-row', type: 'button',
      onclick: () => openLesson(lesson.id, { screen: 'grammar' }),
    }, [
      el('span', { class: 'faint num', text: String(index + 1) }),
      el('span', { class: 'lesson-title' }, [
        el('div', { text: lesson.title }),
        // Правило смешанное: русский текст со вставками на иврите. Через hebText, чтобы
        // кнопка «спрятать огласовки» действовала и здесь.
        el('div', { class: 'faint ru', text: hebText(lesson.rule) }),
      ]),
      badge,
    ]);
  }));
}

/* ——— Открытие урока ——— */

/**
 * @param {string} lessonId — id урока из GRAMMAR_LESSONS
 * @param {{screen: string, day?: number}} [from] — откуда пришли, для кнопки «назад»
 */
export function openLesson(lessonId, from) {
  const lesson = GRAMMAR_LESSONS.find((item) => item.id === lessonId);
  if (!lesson) { toast('Такого урока нет — открой другой из списка.', true); return; }
  if (from) state.cameFrom.lesson = from;
  // Копия с перемешанными упражнениями: сам урок портить нельзя, а порядок фраз должен
  // быть новым при каждом заходе, иначе к третьему разу помнится очередь, а не язык.
  state.lesson = Object.assign({}, lesson, { drills: shuffle(lesson.drills) });
  state.drillIndex = 0;
  state.drillChunks = [];
  drillBank.forIndex = null;
  showScreen('lesson');
  document.getElementById('lesson-heading').textContent = state.lesson.title;
  syncBackButton('lesson-back', 'lesson', '← К списку', 'grammar');
  renderLesson();
}

/** Пройти урок заново, не выходя с экрана: порядок упражнений будет другим. */
export function restartLesson() {
  if (state.lesson) openLesson(state.lesson.id);
}

/* ——— Экран урока ——— */

function renderLesson(verdict) {
  const lesson = state.lesson;
  const children = [
    el('div', { class: 'lesson-rule ru', text: hebText(lesson.rule) }),
    el('div', { class: 'card', style: 'margin-top:16px' },
      paragraphsOf(lesson.text).map((paragraph) => el('p', { class: 'ru', text: hebText(paragraph) }))),
    el('h3', { text: 'Как это выглядит' }),
  ];
  lesson.examples.forEach((example) => children.push(renderExample(example)));
  children.push(el('h3', { text: 'Собери фразу' }));
  children.push(renderDrill(verdict));
  fill('lesson-body', children);
}

function renderExample(example) {
  return el('div', { class: 'example-block' }, [
    el('div', { class: 'sentence' }, wordLine(example.heb)),
    el('div', { class: 'sentence-translit translit', text: example.translit }),
    el('div', { class: 'sentence-translation ru', text: example.translation }),
    speech.available ? listenButton(example.heb, 'Послушать') : null,
  ].filter(Boolean));
}

/** Кнопка озвучки. Голоса иврита есть не в каждой системе — молчать в ответ нельзя. */
function listenButton(text, label) {
  return el('button', {
    class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:8px',
    onclick: () => { if (!speech.speak(text)) toast('Ивритского голоса в системе нет.', true); },
  }, iconLabel('sound', label));
}

/* ——— Тренажёр: собери фразу ——— */

function renderDrill(verdict) {
  const lesson = state.lesson;
  const drill = lesson.drills[state.drillIndex];
  if (!drill) return renderLessonDone(lesson);

  const items = bankFor(lesson, drill);
  const chosen = state.drillChunks;
  const children = [
    el('p', { class: 'faint', text: `Фраза ${state.drillIndex + 1} из ${lesson.drills.length}` }),
    el('p', { class: 'card-question ru', text: drill.translation }),
    renderSlot(chosen, verdict),
  ];

  if (!verdict) {
    children.push(renderDrillBank(items, chosen));
    children.push(el('button', {
      class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
      disabled: !chosen.length, onclick: checkDrill,
    }, 'Проверить'));
    return el('div', { class: 'card' }, children);
  }

  // Разбор читается лучше без банка кусков: лишние кнопки только отвлекают от объяснения.
  children.push(el('p', {
    class: verdict.ok ? 'verdict is-ok' : 'verdict is-err',
    text: verdict.ok ? 'Верно' : (SHORT_VERDICT[verdict.kind] || 'Не сходится'),
  }));
  if (!verdict.ok) {
    children.push(el('p', { class: 'faint ru', text: verdict.text }));
    children.push(renderBreakdown(drill, chosen, verdict));
    children.push(el('p', { class: 'faint ru', text: `Правило: ${hebText(lesson.rule)}` }));
  }
  children.push(el('div', { class: 'sentence center' }, wordLine(drill.heb)));
  children.push(el('div', { class: 'sentence-translit translit center', text: drill.translit }));
  if (speech.available) {
    children.push(el('div', { class: 'row center' },
      listenButton(drill.heb, verdict.ok ? 'Послушать ещё раз' : 'Послушать')));
  }
  children.push(el('button', {
    class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
    onclick: () => { state.drillIndex += 1; state.drillChunks = []; renderLesson(); },
  }, 'Дальше →'));
  return el('div', { class: 'card' }, children);
}

/**
 * Собранная фраза. dir="rtl" обязателен: без него первое выбранное слово встаёт слева,
 * и человек читает свой ответ задом наперёд.
 */
function renderSlot(chosen, verdict) {
  if (!chosen.length) {
    return el('div', { class: 'chunk-slot' },
      el('span', { class: 'faint ru', text: 'Нажимай куски снизу — они встанут сюда' }));
  }
  const wrongAt = verdict && !verdict.ok ? verdict.at : -1;
  return el('div', { class: 'chunk-slot', dir: 'rtl' }, chosen.map((item, position) => el('button', {
    class: chunkClass(verdict, position === wrongAt),
    type: 'button', disabled: Boolean(verdict),
    onclick: () => { state.drillChunks.splice(position, 1); renderLesson(); },
  }, wordLine(item.text))));
}

/** Красным помечается ровно то слово, на котором фраза разошлась, а не весь ответ. */
function chunkClass(verdict, isWrongSpot) {
  if (!verdict) return 'chunk';
  if (verdict.ok) return 'chunk is-ok';
  return isWrongSpot ? 'chunk is-err' : 'chunk';
}

function renderDrillBank(items, chosen) {
  const row = el('div', { class: 'row', style: 'margin-top:12px' });
  items.forEach((text, index) => {
    if (chosen.some((item) => item.index === index)) return;
    const chunk = el('button', {
      class: 'chunk', type: 'button',
      onclick: () => { state.drillChunks.push({ index, text }); renderLesson(); },
    }, wordLine(text));
    // Кусок можно послушать отдельно: на слух слово часто узнаётся раньше, чем в лицо.
    if (speech.hasClip(text)) {
      row.append(el('span', { class: 'chunk-pair' }, [
        chunk,
        el('button', {
          class: 'chunk-sound', type: 'button', 'aria-label': `Послушать ${hebText(text)}`,
          onclick: (event) => { event.stopPropagation(); speech.speak(text); },
        }, uiIcon('sound', 20)),
      ]));
    } else {
      row.append(chunk);
    }
  });
  if (!row.children.length) row.append(el('span', { class: 'faint ru', text: 'Все куски расставлены' }));
  return row;
}

/* ——— Набор кусков ———
   Слова фразы вперемешку плюс пара обманок. Обманки берутся из соседних упражнений
   урока, а не выдумываются: чужое настоящее слово выглядит правдоподобно, а значит
   заставляет читать, а не отбрасывать очевидно лишнее. Набор считается один раз на
   фразу, иначе кнопки прыгали бы после каждого нажатия.                              */

const drillBank = { forIndex: null, items: [] };

/** Слова из чужих фраз урока — материал для обманок. */
function bankPool(lesson, drill) {
  const pool = [];
  lesson.drills.forEach((item) => {
    if (item === drill) return;
    buildChunks(item.heb).words.forEach((word) => pool.push(word));
  });
  return pool;
}

/** Одно и то же слово не должно попасть в обманки дважды: сравнение — по ключу. */
function uniqueWords(words) {
  const seen = new Set();
  return words.filter((word) => {
    const key = wordKey(word);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bankFor(lesson, drill) {
  if (drillBank.forIndex === state.drillIndex) return drillBank.items;
  const { words, extra } = buildChunks(drill.heb, bankPool(lesson, drill));
  const decoys = shuffle(uniqueWords(extra)).slice(0, DISTRACTOR_LIMIT);
  drillBank.items = shuffle(words.concat(decoys));
  drillBank.forIndex = state.drillIndex;
  return drillBank.items;
}

/* ——— Разбор ответа ———
   Сказать «неверно» мало. Между «слова верные, порядок другой» и «взято не то слово»
   пропасть: в первом случае человек уже почти прав и ему нужно правило о порядке, во
   втором — перевод. Кладём его фразу и правильную рядом, слово под слово, и помечаем
   место расхождения; чем именно оно плохо, объясняет текст из checkSentence.         */

function renderBreakdown(drill, chosen, verdict) {
  return el('div', { class: 'order-breakdown' }, [
    breakdownRow('Ты собрал', chosen.map((item) => item.text), verdict.at),
    breakdownRow('Правильно', buildChunks(drill.heb).words, -1),
  ]);
}

function breakdownRow(label, words, markAt) {
  return el('div', { class: 'order-line' }, [
    el('span', { class: 'faint ru order-label', text: label }),
    el('span', { class: 'order-row', dir: 'rtl' }, words.map((word, index) => el('span', {
      class: index === markAt ? 'order-part is-err' : 'order-part',
    }, wordLine(word)))),
  ]);
}

/* ——— Конец урока ——— */

function renderLessonDone(lesson) {
  const progress = state.grammarProgress.get(lesson.id);
  const children = [
    el('div', { style: 'color:var(--ok)' }, uiIcon('check', 56)),
    el('p', { text: 'Урок пройден.' }),
  ];
  // Счёт по уроку копится за все заходы — так и подписан, чтобы не выглядел итогом захода.
  if (progress && progress.total) {
    children.push(el('p', {
      class: 'faint ru',
      text: `Всего по уроку: верно ${progress.correct} из ${progress.total}`,
    }));
  }
  children.push(el('div', { class: 'row', style: 'justify-content:center' }, [
    el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: restartLesson }, 'Ещё раз'),
    state.teacherReturn && state.teacherReturn.step === 'grammar'
      ? el('button', {
          class: 'btn btn-small', type: 'button', onclick: () => finishTeacherReturn(true),
        }, 'К программе дня')
      : el('button', {
          class: 'btn btn-small', type: 'button', onclick: () => showScreen('grammar'),
        }, 'К списку уроков'),
  ]));
  return el('div', { class: 'card center' }, children);
}

/* ——— Проверка ——— */

let drillChecking = false;

async function checkDrill() {
  // Второй клик по «Проверить» до перерисовки засчитывал бы ответ дважды.
  if (drillChecking) return;
  drillChecking = true;
  try {
    await runDrillCheck();
  } finally {
    drillChecking = false;
  }
}

async function runDrillCheck() {
  const lesson = state.lesson;
  const drill = lesson.drills[state.drillIndex];
  // Строки на иврите напрямую не сравниваем: огласовки, конечные формы букв и лишний
  // пробел делают одинаковые фразы разными строками. Разбор — в core/sentence-order.js.
  const answer = state.drillChunks.map((item) => item.text).join(' ');
  const verdict = checkSentence(answer, drill.heb);

  const progress = state.grammarProgress.get(lesson.id)
    || { lessonId: lesson.id, correct: 0, total: 0, done: false };
  progress.total += 1;
  if (verdict.ok) progress.correct += 1;
  if (state.drillIndex + 1 >= lesson.drills.length) progress.done = true;
  progress.updatedAt = new Date().toISOString();
  state.grammarProgress.set(lesson.id, progress);
  try {
    await dbPut(STORE_GRAMMAR, progress);
  } catch (error) {
    toast('Не удалось сохранить прогресс урока — он пропадёт при перезагрузке.', true);
  }

  renderLesson(verdict);
  if (verdict.ok && speech.available) speech.speak(drill.heb);
}
