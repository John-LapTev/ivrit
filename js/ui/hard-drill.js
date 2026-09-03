import { OPTIONS_PER_QUESTION, STORE_SRS } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { hardBatch, hardMode, hardModePassed, markHardPassed } from '../core/hard-words.js';
import { releaseMicrophone } from '../core/recorder.js';
import { isWordAvailable, pickDistractors } from '../core/modes.js';
import { shuffle } from '../core/random.js';
import { applyPractice, createSrsRecord, isStarted } from '../core/srs.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { updateDayStats } from '../core/stats.js';
import { wordKey } from '../core/translit.js';
import { el, fill, plural, toast } from './dom.js';
import { bigWord, wordLine } from './word.js';
import { cardClass, speakButton } from './train.js';
import { iconLabel } from './icons.js';
import { renderHardScreen } from './hard-screen.js';
import { attemptDetails, recordButton } from './pronounce.js';
import { showScreen } from './screens.js';

/* ——— Заход по трудным словам ———
   Четыре режима из hard-words.js, у каждого свой экран. Общее у всех одно: заход берёт
   десять слов, верный ответ отмечает режим пройденным, ошибка возвращает слово в конец
   очереди. Интервалы повторений (SM-2) здесь не трогаются намеренно — см. hard-words.js. */

const drill = {
  mode: null,
  queue: [],
  index: 0,
  correct: 0,
  wrong: 0,
  answered: false,
  revealed: false,
  requeued: new Set(),
  options: null,        // варианты текущего вопроса в режиме выбора
  attempt: null,        // разбор записи голоса в режиме «сказать вслух»
  recording: false,
  asking: false,
  checking: false,
  stopRecording: null,
};

export function beginHardDrill(modeId) {
  const mode = hardMode(modeId);
  if (!mode) return;
  const words = hardBatch(modeId);
  if (!words.length) { toast('Сначала пометь слова кружком в тренировке.'); return; }
  if (modeId === 'speak' && !speech.available) {
    toast('Для этого режима нужен звук: включи ивритский голос в системе.', true);
    return;
  }
  startDrill(modeId, words);
}

function startDrill(modeId, words) {
  drill.mode = modeId;
  drill.queue = words.slice();
  drill.index = 0;
  drill.correct = 0;
  drill.wrong = 0;
  drill.answered = false;
  drill.revealed = false;
  drill.requeued = new Set();
  /* Варианты обязательно сбрасывать: без этого новый заход открывался со списком ответов
     от прошлого вопроса — и правильного среди них не было вовсе (Иван 03.09.2026). */
  drill.options = null;
  clearAttempt();
  showScreen('hard-drill');
  renderHardDrill();
}

function clearAttempt() {
  drill.attempt = null;
  drill.recording = false;
  drill.asking = false;
  drill.checking = false;
  drill.stopRecording = null;
}

export function restartHardDrill() {
  if (!drill.mode) { showScreen('hard'); return; }
  startDrill(drill.mode, hardBatch(drill.mode));
}

export function exitHardDrill() {
  releaseMicrophone();
  drill.mode = null;
  showScreen('hard');
}

/* ——— Экран ——— */

export function renderHardDrill(feedback) {
  const mode = hardMode(drill.mode);
  if (!mode) { showScreen('hard'); return; }
  const total = drill.queue.length;
  const word = drill.queue[drill.index];

  document.getElementById('hard-drill-title').textContent = mode.title;
  document.getElementById('hard-drill-counter').textContent = word
    ? `${drill.index + 1} из ${total}` : '';
  document.getElementById('hard-drill-progress').style.width =
    `${Math.round((drill.index / Math.max(total, 1)) * 100)}%`;
  const verdictNode = document.getElementById('hard-drill-verdict');
  verdictNode.className = 'verdict';
  verdictNode.textContent = '';
  fill('hard-drill-actions', []);

  if (!word) { renderDrillSummary(); return; }

  if (drill.mode === 'choice') renderChoiceStep(word, feedback);
  if (drill.mode === 'typeHeb') renderTypeStep(word, feedback, true);
  if (drill.mode === 'typeRu') renderTypeStep(word, feedback, false);
  if (drill.mode === 'speak') renderSpeakStep(word);

  if (feedback) {
    verdictNode.textContent = feedback.message;
    verdictNode.className = `verdict is-${feedback.correct ? 'ok' : 'err'}`;
    /* Дальше — только по нажатию, даже когда ответ верный. Здесь слово не просто проверяют,
       а разглядывают: написание, чтение, звук. Автопереход через секунду этого не даёт
       (просьба Ивана 03.09.2026). В обычной тренировке всё осталось как было. */
    fill('hard-drill-actions', el('button', {
      class: 'btn', type: 'button', onclick: advanceHardStep,
    }, 'Дальше →'));
  }
}

/* Рамка карточки красится по вердикту так же, как в обычной тренировке, только вердикт
   здесь простое «верно/неверно» — переводим его в тот же вид. */
const drillCard = (feedback) => cardClass(feedback && { verdict: feedback.correct ? 'correct' : 'wrong' });

/* ——— 1. Выбрать из четырёх ——— */

/**
 * Неверные варианты собирает тот же отбор, что и в обычной тренировке, но пул уже:
 * сначала слова, которые человек действительно видел, потом просто открытые по уровню.
 * Незнакомые слова среди ответов превращают выбор в угадайку по знакомости
 * (Иван 03.09.2026).
 */
function buildOptions(word) {
  const open = state.words.filter((item) => isWordAvailable(item));
  const seen = open.filter((item) => isStarted(state.srs.get(item.id)));
  const pool = seen.length >= OPTIONS_PER_QUESTION ? seen : open;
  return shuffle(pickDistractors(word, pool, 'heb').concat([word]));
}

function renderChoiceStep(word, feedback) {
  // Варианты собираются один раз на вопрос: перерисовка с ответом их не меняет
  if (!drill.options) drill.options = buildOptions(word);
  const options = drill.options;

  fill('hard-drill-body', [
    el('div', { class: drillCard(feedback) }, [
      el('div', { class: 'card-question', text: word.translation }),
      // После ответа слово показывается крупно: человек его учит, а не читает мелкую сноску
      // (просьба Ивана 03.09.2026)
      feedback ? bigWord(word.heb) : null,
      feedback ? el('div', { class: 'card-translit', text: word.translit }) : null,
      feedback && speech.available ? speakButton(word.heb) : null,
    ].filter(Boolean)),
    el('div', { class: 'options' }, options.map((option, index) => {
      const isCorrect = option.id === word.id;
      const chosen = feedback && feedback.chosenIndex === index;
      const classes = ['option'];
      if (feedback && isCorrect) classes.push('is-ok');
      if (feedback && chosen && !isCorrect) classes.push('is-err');
      return el('button', {
        class: classes.join(' '), type: 'button', disabled: drill.answered,
        onclick: () => answerChoiceStep(word, option, index),
      }, [
        el('span', { class: 'option-key', text: String(index + 1) }),
        wordLine(option.heb),
      ]);
    }).concat(feedback ? [] : [hardUnknownButton(word)])),
  ]);
}

async function answerChoiceStep(word, option, index) {
  if (drill.answered) return;
  drill.answered = true;
  const correct = option.id === word.id;
  await finishStep(word, correct, index, correct ? 'Верно'
    : `Правильно: ${word.heb} — ${word.translit}`);
}

/* ——— 2 и 3. Написать самому ——— */

/** Сравнение ответа: у перевода бывает несколько вариантов через запятую — годится любой. */
function normalizeHardAnswer(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^0-9a-zа-яא-ת]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

const hardAnswerVariants = (text) => String(text || '').split(/[,;/]|\bили\b/)
  .map(normalizeHardAnswer).filter(Boolean).concat(normalizeHardAnswer(text));

const matchesHardAnswer = (typed, expected) => hardAnswerVariants(expected).includes(normalizeHardAnswer(typed));

function renderTypeStep(word, feedback, byHeb) {
  const input = el('input', {
    type: 'text', id: 'hard-input', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', disabled: drill.answered,
    class: byHeb ? 'heb' : '',
    placeholder: byHeb ? 'Набери на иврите' : 'Набери перевод',
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (drill.answered) advanceHardStep();
    else answerTypeStep(word, input.value, byHeb);
  });

  const cardChildren = byHeb
    ? [
        el('div', { class: 'card-question', text: word.translation }),
        feedback ? bigWord(word.heb) : null,
        feedback ? el('div', { class: 'card-translit', text: word.translit }) : null,
      ]
    : [
        bigWord(word.heb),
        feedback ? el('div', { class: 'card-translit', text: word.translit }) : null,
        feedback ? el('div', { class: 'card-translation', text: word.translation }) : null,
        speech.available ? speakButton(word.heb) : null,
      ];

  fill('hard-drill-body', [
    el('div', { class: drillCard(feedback) }, cardChildren.filter(Boolean)),
    el('div', { class: 'options' }, [
      input,
      el('button', {
        class: 'btn btn-wide', type: 'button', disabled: drill.answered,
        onclick: () => answerTypeStep(word, input.value, byHeb),
      }, 'Проверить'),
      feedback ? null : hardUnknownButton(word),
    ].filter(Boolean)),
  ]);
  if (!drill.answered) input.focus();
}

async function answerTypeStep(word, value, byHeb) {
  if (drill.answered) return;
  const typed = String(value || '').trim();
  if (!typed) { toast(byHeb ? 'Набери слово на иврите.' : 'Набери перевод.'); return; }
  drill.answered = true;
  /* Ивритские строки сверяем ключом, а не напрямую: набирают без огласовок, а в слове они
     есть — и конечная буква у набранного может остаться обычной (см. wordKey в translit.js). */
  const correct = byHeb
    ? wordKey(typed) === wordKey(word.heb)
    : matchesHardAnswer(typed, word.translation);
  await finishStep(word, correct, null, correct ? 'Верно'
    : byHeb ? `Правильно: ${word.heb} — ${word.translit}`
    : `Правильно: ${word.translation}`);
}

/* ——— 4. Сказать вслух ———
   Разбор записи общий с заданиями программы — см. ui/pronounce.js.                     */

function renderSpeakStep(word) {
  if (!drill.revealed) {
    fill('hard-drill-body', [
      el('div', { class: 'train-card' }, [
        el('div', { class: 'card-question', text: word.translation }),
        el('p', { class: 'faint', text: 'Скажи это на иврите вслух. Запись сверится с образцом.' }),
        drill.attempt ? el('p', {
          class: drill.attempt.ok ? 'verdict is-ok' : 'verdict is-err', text: drill.attempt.text,
        }) : null,
        drill.attempt ? attemptDetails(drill.attempt) : null,
        drill.checking ? el('p', { class: 'faint', text: 'Слушаю…' }) : null,
      ].filter(Boolean)),
      el('div', { class: 'options' }, [
        recordButton(drill, word.heb, renderHardDrill, true),
        el('button', {
          class: 'btn btn-wide', type: 'button',
          onclick: () => {
            releaseMicrophone();
            drill.revealed = true;
            renderHardDrill();
            speech.speak(word.heb);
          },
        }, 'Сказал — показать ответ'),
      ].filter(Boolean)),
    ]);
    return;
  }

  fill('hard-drill-body', [
    el('div', { class: 'train-card' }, [
      bigWord(word.heb),
      el('div', { class: 'card-translit', text: word.translit }),
      el('div', { class: 'card-translation', text: word.translation }),
      el('button', { class: 'btn btn-quiet btn-small', type: 'button',
        onclick: () => speech.speak(word.heb) }, iconLabel('sound', 'Послушать, как правильно')),
    ]),
    el('div', { class: 'options' }, [
      el('button', { class: 'btn btn-wide', type: 'button',
        onclick: () => passStep(word),
      }, 'Сказал так же'),
      // Честность важнее галочки: слово не засчитывается и вернётся в конце захода
      el('button', { class: 'btn btn-quiet btn-wide', type: 'button',
        onclick: async () => {
          if (drill.answered) return;
          drill.answered = true;
          drill.wrong += 1;
          await countAnswer(word, false);
          requeue(word);
          advanceHardStep();
        },
      }, 'Вышло иначе'),
    ]),
  ]);
}

/* ——— Общие кнопки и переходы ——— */

function hardUnknownButton(word) {
  return el('button', {
    class: 'btn btn-quiet btn-wide', type: 'button', style: 'margin-top:6px',
    onclick: async () => {
      if (drill.answered) return;
      drill.answered = true;
      await finishStep(word, false, null, `${word.heb} — ${word.translit} — ${word.translation}`);
    },
  }, 'Не помню — показать ответ');
}

/**
 * Счётчики слова растут и здесь: Иван просил, чтобы «изученные слова» считали все режимы.
 * Интервалы повторений при этом не двигаются — см. applyPractice в core/srs.js.
 */
async function countAnswer(word, correct) {
  const previous = state.srs.get(word.id) || createSrsRecord(word.id);
  const updated = applyPractice(previous, correct);
  state.srs.set(word.id, updated);
  await dbPut(STORE_SRS, updated);
  // День, проведённый только здесь, раньше считался прогулом и рвал серию (аудит 03.09.2026)
  await updateDayStats({ reviewed: 1, correct: correct ? 1 : 0, errors: correct ? 0 : 1,
    mode: `hard:${drill.mode}` });
}

/** Шаг без проверки («сказал так же»): засчитываем и идём дальше.
    Защита от второго нажатия обязательна: на телефоне двойной тап пролистывал слово
    насквозь, и оно вообще не показывалось (аудит 03.09.2026). */
async function passStep(word) {
  if (drill.answered) return;
  drill.answered = true;
  await markHardPassed(word.id, drill.mode);
  await countAnswer(word, true);
  drill.correct += 1;
  advanceHardStep();
}

async function finishStep(word, correct, chosenIndex, message) {
  await countAnswer(word, correct);
  if (correct) {
    drill.correct += 1;
    await markHardPassed(word.id, drill.mode);
  } else {
    drill.wrong += 1;
    requeue(word);
  }
  renderHardDrill({ correct, chosenIndex, message });
}

/** Слово с ошибкой возвращается в конец захода — но только один раз, иначе он не кончится. */
function requeue(word) {
  if (drill.requeued.has(word.id)) return;
  drill.requeued.add(word.id);
  drill.queue.push(word);
}

function advanceHardStep() {
  drill.index += 1;
  drill.answered = false;
  drill.revealed = false;
  drill.options = null;
  clearAttempt();
  releaseMicrophone();
  renderHardDrill();
}

function renderDrillSummary() {
  // Считаем не ответы, а слова: слово, отвеченное со второй попытки, всё равно засчитано
  const unique = Array.from(new Map(drill.queue.map((word) => [word.id, word])).values());
  const passed = unique.filter((word) => hardModePassed(word.id, drill.mode)).length;
  document.getElementById('hard-drill-progress').style.width = '100%';
  fill('hard-drill-body', el('div', { class: 'train-card' }, [
    el('div', { class: 'big-heb heb', text: 'סוֹף', style: 'font-size:64px' }),
    el('div', { class: 'card-question', text: 'Заход закончен' }),
    el('div', { class: 'card-translation', text: `${passed} ${plural(passed, 'слово', 'слова', 'слов')} из ${unique.length}` }),
    el('p', { class: 'faint', text: passed >= unique.length
      ? (drill.wrong ? 'Все слова засчитаны — часть со второй попытки.' : 'Все слова засчитаны с первого раза.')
      : 'Незасчитанные слова попадут в следующий заход этого режима.' }),
  ]));
  fill('hard-drill-actions', [
    el('button', { class: 'btn', type: 'button', onclick: restartHardDrill }, 'Ещё заход'),
    el('button', { class: 'btn btn-quiet', type: 'button',
      onclick: () => { drill.mode = null; showScreen('hard'); renderHardScreen(); } }, 'К разделу'),
  ]);
}

/* ——— Клавиатура ——— */

export function handleHardKey(event) {
  if (state.screen !== 'hard-drill' || !drill.mode) return;
  const target = event.target;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
  if (event.key === 'Escape') { exitHardDrill(); return; }
  if (typing) return;

  const word = drill.queue[drill.index];
  if (!word) return;
  if (event.key === 's' || event.key === 'S' || event.key === 'ы' || event.key === 'Ы') {
    if (!speech.speak(word.heb)) toast('Ивритского голоса в системе нет.', true);
    return;
  }
  if (event.key === 'Enter' && drill.answered) { advanceHardStep(); return; }
  if (drill.mode !== 'choice' || drill.answered) return;
  const digit = Number(event.key);
  const options = drill.options || [];
  if (digit >= 1 && digit <= options.length) answerChoiceStep(word, options[digit - 1], digit - 1);
}
