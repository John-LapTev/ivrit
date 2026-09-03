import { STORE_GRAMMAR } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { shuffle } from '../core/random.js';
import { buildChunks, checkSentence, splitPhrase } from '../core/sentence-order.js';
import { speech } from '../core/speech.js';
import { isLearned } from '../core/srs.js';
import { state } from '../core/state.js';
import { translitPhrase, wordKey } from '../core/translit.js';
import { DIALOGS } from '../data/dialogs.js';
import { el, fill, plural, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { wordLine } from './word.js';

/* ═══════════════════ РАЗГОВОРЫ — сценки из жизни ═══════════════════

   Сценка идёт по шагам, как переписка: реплику собеседника человек читает и слушает,
   свою — собирает из кусков. Печатать иврит с русской клавиатуры невозможно, поэтому
   от китайского «набери ответ» здесь остался только разбор: те же вопросы «слова не те
   или порядок другой» задаёт checkSentence.

   Слои файла:
     ПРОГРЕСС    — что сохраняется о сценке и когда открывается режим «без подсказок»;
     СПИСОК      — плитки сценок;
     ЗАХОД       — состояние прохождения, переходы между шагами;
     ЭКРАН       — лента реплик, карточка своей реплики, банк кусков;
     ПРОВЕРКА    — сборка ответа, разбор, показ образца.                              */

/* ═══════════════════ ПРОГРЕСС ═══════════════════ */

/**
 * Отметки о сценках лежат в общей карте прогресса уроков: у разговора и урока
 * грамматики одна и та же запись, различает их только приставка в ключе.
 * Карта создаётся при первом обращении — экраны подключаются к приложению
 * по одному, и разговоры не должны падать оттого, что уроков ещё нет.
 */
function progressStore() {
  if (!(state.grammarProgress instanceof Map)) state.grammarProgress = new Map();
  return state.grammarProgress;
}

const progressKey = (dialogId) => `dialog:${dialogId}`;

const dialogProgress = (dialogId) => progressStore().get(progressKey(dialogId)) || null;

/** Готовая запись: либо сохранённая раньше, либо чистая. */
function progressRecord(dialogId) {
  return dialogProgress(dialogId)
    || { lessonId: progressKey(dialogId), correct: 0, total: 0, done: false, hardDone: false };
}

async function saveProgress(record) {
  record.updatedAt = new Date().toISOString();
  progressStore().set(record.lessonId, record);
  try {
    await dbPut(STORE_GRAMMAR, record);
  } catch (error) {
    toast('Прогресс разговора не сохранился: база не ответила. Попробуй пройти сценку ещё раз.', true);
  }
}

const isMine = (step) => step.who === 'я';

/**
 * Слова словаря, которые встречаются в сценке. Сравниваем только через wordKey (splitPhrase
 * им и отвечает): в тексте слово стоит с огласовками, а в словаре — в словарной форме.
 * Составные статьи вроде «בֹּקֶר טוֹב» засчитываются, когда в сценке есть обе части.
 */
function dialogWords(dialog) {
  const keys = new Set();
  dialog.steps.forEach((step) => splitPhrase(step.heb).forEach((key) => keys.add(key)));
  return state.words.filter((word) => {
    const parts = splitPhrase(word.heb);
    if (!parts.length) return keys.has(wordKey(word.heb));
    return parts.every((part) => keys.has(part));
  });
}

/**
 * Готовность сценки к режиму «без подсказок»: все её слова выучены, то есть пережили
 * три верных повторения подряд. Пока не выполнено — режим виден, но закрыт: смысл
 * в том, чтобы читать иврит без костылей, а не угадывать незнакомые слова.
 */
function dialogReadiness(dialog) {
  const words = dialogWords(dialog);
  const learned = words.filter((word) => isLearned(state.srs.get(word.id))).length;
  return { total: words.length, learned, allowed: words.length > 0 && learned === words.length };
}

/* ═══════════════════ СПИСОК СЦЕНОК ═══════════════════ */

export function renderDialogList() {
  fill('dialog-list', DIALOGS.map((dialog) => {
    const progress = dialogProgress(dialog.id);
    const readiness = dialogReadiness(dialog);
    const mine = dialog.steps.filter(isMine).length;

    const badges = [];
    if (progress && progress.done) badges.push(el('span', { class: 'badge badge-ok', text: 'пройдена' }));
    badges.push(readiness.allowed
      ? el('span', { class: 'badge badge-accent', text: 'без подсказок открыт' })
      : el('span', { class: 'badge' }, [
        uiIcon('lock', 14),
        el('span', { text: ` ${readiness.learned}/${readiness.total}` }),
      ]));

    return el('button', {
      class: 'lesson-row', type: 'button',
      onclick: () => openDialog(dialog.id, state.screen),
    }, [
      el('span', { class: 'lesson-title' }, [
        el('div', { text: dialog.title }),
        el('div', {
          class: 'faint',
          text: `${dialog.place} · ${mine} ${plural(mine, 'твоя реплика', 'твои реплики', 'твоих реплик')}`,
        }),
      ]),
      el('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, badges),
    ]);
  }));
}

/* ═══════════════════ ЗАХОД ═══════════════════ */

const dialogSession = {
  dialog: null,
  step: 0,
  placed: [],        // куски, поставленные в ответ, по порядку
  bank: [],          // куски, оставшиеся внизу
  hints: 0,          // сколько слов подсказано на текущей реплике
  attempts: 0,       // проверок на текущей реплике
  clean: 0,          // реплик, собранных с первого раза
  hard: false,       // режим «без подсказок»: ни перевода, ни чтения
  feedback: null,    // разбор последней проверки
  answered: false,   // реплика закрыта: собрана верно или показана
  revealed: false,   // ответ показывали на текущей реплике
  usedReveal: false, // ...хоть раз за всю сценку
  finished: false,   // итог сценки уже записан
  from: 'grammar',   // куда возвращает кнопка «назад»
};

const currentStep = () => (dialogSession.dialog ? dialogSession.dialog.steps[dialogSession.step] : null);

/**
 * Куски для сборки. Обычно их даёт сама сценка вместе с обманками; если банк не заполнен,
 * берём слова самой фразы — собрать реплику можно будет в любом случае.
 */
function stepChunks(step) {
  const bank = Array.isArray(step.bank) ? step.bank.filter(Boolean) : [];
  const pieces = bank.length ? bank : buildChunks(step.heb).words;
  return shuffle(pieces).map((text, index) => ({ id: index, text }));
}

/** Переход на шаг: всё, что относится к предыдущей реплике, обнуляется. */
function startStep(index) {
  dialogSession.step = index;
  dialogSession.placed = [];
  dialogSession.hints = 0;
  dialogSession.attempts = 0;
  dialogSession.feedback = null;
  dialogSession.answered = false;
  dialogSession.revealed = false;
  const step = currentStep();
  dialogSession.bank = step && isMine(step) ? stepChunks(step) : [];
}

export function openDialog(dialogId, from) {
  const dialog = DIALOGS.find((item) => item.id === dialogId);
  if (!dialog) { toast('Такой сценки нет — обнови страницу.', true); return; }
  dialogSession.dialog = dialog;
  dialogSession.from = from && from !== 'dialog' ? from : 'grammar';
  dialogSession.hard = false;
  dialogSession.clean = 0;
  dialogSession.usedReveal = false;
  dialogSession.finished = false;
  startStep(0);
  showScreen('dialog');
  document.getElementById('dialog-heading').textContent = dialog.title;
  document.getElementById('dialog-intro').textContent = `Где это происходит: ${dialog.place}`;
  renderDialog();
}

export function restartDialog() {
  if (!dialogSession.dialog) { showScreen(dialogSession.from); return; }
  dialogSession.clean = 0;
  dialogSession.usedReveal = false;
  dialogSession.finished = false;
  startStep(0);
  renderDialog();
}

export function exitDialog() {
  showScreen(dialogSession.from || 'grammar');
}

const advance = () => { startStep(dialogSession.step + 1); renderDialog(); };

/* ═══════════════════ ЭКРАН ═══════════════════ */

export function renderDialog() {
  if (!dialogSession.dialog) { showScreen(dialogSession.from || 'home'); return; }
  const children = [renderModeSwitch()];

  // Лента: всё, что уже сказано
  dialogSession.dialog.steps.slice(0, dialogSession.step).forEach((step) => children.push(renderBubble(step)));

  const step = currentStep();
  if (!step) {
    if (!dialogSession.finished) { dialogSession.finished = true; finishDialog(); }
    children.push(renderFinish());
  } else if (!isMine(step)) {
    children.push(renderBubble(step));
    children.push(el('button', { class: 'btn btn-wide', type: 'button', onclick: advance }, 'Дальше →'));
  } else {
    children.push(renderOwnStep(step));
  }

  fill('dialog-thread', children);
}

/** Переключатель «с подсказками / без подсказок» и счётчик, чего для него не хватает. */
function renderModeSwitch() {
  const readiness = dialogReadiness(dialogSession.dialog);
  const row = el('div', { class: 'chip-scroll', style: 'margin-bottom:16px' }, [
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': !dialogSession.hard,
      onclick: () => { dialogSession.hard = false; renderDialog(); },
    }, 'С подсказками'),
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': dialogSession.hard, disabled: !readiness.allowed,
      title: readiness.allowed ? 'Ни перевода, ни чтения' : 'Откроется, когда выучишь слова сценки',
      onclick: () => { dialogSession.hard = true; renderDialog(); },
    }, readiness.allowed ? [el('span', { text: 'Без подсказок' })] : iconLabel('lock', 'Без подсказок')),
  ]);

  const note = readiness.allowed
    ? el('p', { class: 'faint', text: 'Режим без подсказок открыт: остаётся только иврит — ни перевода, ни чтения русскими буквами.' })
    : el('p', {
      class: 'faint',
      text: `Режим без подсказок откроется, когда выучишь слова этой сценки (${readiness.learned} из ${readiness.total}).`,
    });

  return el('div', {}, [row, note]);
}

/** Кнопка «Послушать»: и у реплик собеседника, и у своих — слышать надо обе стороны. */
function dialogListenButton(text) {
  return el('button', {
    class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:8px',
    onclick: () => {
      if (!speech.speak(text)) toast('Звука для этой фразы нет: ни записи, ни ивритского голоса в системе.', true);
    },
  }, iconLabel('sound', 'Послушать'));
}

function renderBubble(step) {
  const bubble = el('div', { class: 'bubble' }, [
    el('div', { class: 'bubble-heb' }, wordLine(step.heb)),
    dialogSession.hard ? null : el('div', { class: 'bubble-translit', text: step.translit }),
    dialogSession.hard ? null : el('div', { class: 'bubble-translation', text: step.translation }),
  ].filter(Boolean));
  if (speech.available) bubble.append(dialogListenButton(step.heb));
  return el('div', { class: isMine(step) ? 'bubble-row is-you' : 'bubble-row' }, bubble);
}

/* ——— Своя реплика: собрать из кусков ——— */

/** Кусок фразы. В ответе нажатие возвращает его в банк, в банке — ставит в конец ответа. */
function chunkButton(chunk, options) {
  return el('button', {
    class: options.wrong ? 'chunk is-err' : 'chunk', type: 'button',
    disabled: dialogSession.answered, title: options.title,
    onclick: options.onclick,
  }, wordLine(chunk.text));
}

function renderOwnStep(step) {
  const words = correctWords(step);
  const maxHints = Math.max(words.length - 1, 0);
  const wrongIndex = dialogSession.feedback && !dialogSession.feedback.ok
    ? chunkIndexForWord(dialogSession.placed, dialogSession.feedback.at) : -1;

  const task = [
    // Без подсказок задание не переводится: что сказать, понятно из хода разговора
    el('p', { class: 'card-question', text: dialogSession.hard ? 'Твоя реплика' : step.prompt }),
    el('div', { class: 'chunk-slot' }, dialogSession.placed.length
      ? dialogSession.placed.map((chunk, index) => chunkButton(chunk, {
        wrong: index === wrongIndex, title: 'Убрать обратно', onclick: () => takeBackChunk(index),
      }))
      : el('span', { class: 'faint', text: 'Нажимай куски внизу — они встанут сюда по порядку.' })),
    el('div', { class: 'word-bank' }, dialogSession.bank.map((chunk) => chunkButton(chunk, {
      title: 'Поставить в ответ', onclick: () => placeChunk(chunk.id),
    }))),
    el('div', { class: 'row', style: 'margin-top:14px' }, [
      el('button', {
        class: 'btn btn-small', type: 'button', disabled: dialogSession.answered || !dialogSession.placed.length,
        onclick: () => { checkAnswer(); },
      }, 'Проверить'),
      el('button', {
        class: 'btn btn-quiet btn-small', type: 'button', disabled: dialogSession.answered || !dialogSession.placed.length,
        onclick: () => { returnAllChunks(); renderDialog(); },
      }, 'Заново'),
      dialogSession.hard ? null : el('button', {
        class: 'btn btn-quiet btn-small', type: 'button',
        disabled: dialogSession.answered || dialogSession.hints >= maxHints,
        title: maxHints ? 'Открыть ещё одно слово с начала фразы' : 'Во фразе одно слово — подсказывать нечего',
        onclick: () => { dialogSession.hints += 1; renderDialog(); },
      }, dialogSession.hints ? 'Ещё подсказка' : 'Подсказка'),
      el('button', {
        class: 'btn btn-quiet btn-small', type: 'button', disabled: dialogSession.answered,
        onclick: () => revealAnswer(),
      }, dialogSession.hard ? 'Сдаюсь' : 'Не знаю'),
    ].filter(Boolean)),
  ];

  if (dialogSession.hints) task.push(hintBlock(words));
  if (dialogSession.feedback) renderVerdict(step).forEach((node) => task.push(node));

  return el('div', { class: 'card dialog-task' }, task);
}

/** Подсказка открывает фразу с начала по одному слову — последнее не выдаётся никогда. */
function hintBlock(words) {
  const shown = words.slice(0, dialogSession.hints).join(' ');
  return el('div', { class: 'example-block' }, [
    el('div', {
      class: 'faint',
      text: `Начало фразы: ${dialogSession.hints} ${plural(dialogSession.hints, 'слово', 'слова', 'слов')}`,
    }),
    el('div', { class: 'sentence' }, wordLine(shown)),
    el('div', { class: 'sentence-translit', text: translitPhrase(shown) }),
  ]);
}

/** Разбор последней проверки: вердикт, образец и переход дальше. */
function renderVerdict(step) {
  const feedback = dialogSession.feedback;
  const nodes = [];

  if (feedback.ok) {
    nodes.push(el('p', { class: 'verdict is-ok', text: 'Верно' }));
    nodes.push(sampleBlock(step));
    nodes.push(el('button', { class: 'btn btn-wide', type: 'button', onclick: advance }, 'Дальше →'));
    return nodes;
  }

  if (dialogSession.revealed) {
    nodes.push(el('p', { class: 'verdict is-err', text: 'Вот как это говорят' }));
    nodes.push(sampleBlock(step));
    nodes.push(copyForReviewButton(step));
    nodes.push(el('button', { class: 'btn btn-wide', type: 'button', onclick: advance }, 'Дальше →'));
    return nodes;
  }

  // Ошибка не закрывает реплику: куски остаются на месте, их можно переставить и проверить снова.
  // Объяснение берём целиком из разбора — второй раз своими словами оно бы разошлось с ним.
  nodes.push(el('p', { class: 'verdict is-err', text: feedback.text }));
  nodes.push(copyForReviewButton(step));
  return nodes;
}

function sampleBlock(step) {
  // В режиме без подсказок чтение и перевод показываются только тому, кто сдался
  const open = !dialogSession.hard || dialogSession.revealed;
  return el('div', { class: 'example-block' }, [
    el('div', { class: 'sentence' }, wordLine(step.heb)),
    open ? el('div', { class: 'sentence-translit', text: step.translit }) : null,
    open ? el('div', { class: 'sentence-translation', text: step.translation }) : null,
  ].filter(Boolean));
}

/**
 * Живой разбор ответа делает не приложение, а Клод в боте проекта: он объяснит,
 * почему фраза звучит не так, а здесь для этого нет ни грамматики, ни контекста.
 * Кнопка только собирает готовый текст в буфер обмена.
 */
function copyForReviewButton(step) {
  const text = [
    'Разбери мой ответ на иврите.',
    `Задание: ${step.prompt}`,
    `Мой ответ: ${dialogSession.placed.map((chunk) => chunk.text).join(' ') || '—'}`,
    `Образец из приложения: ${step.heb}`,
  ].join('\n');
  return el('button', {
    class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:8px',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('Скопировано — пришли это боту, разберу подробно.');
      } catch (error) {
        toast('Браузер не дал доступ к буферу обмена.', true);
      }
    },
  }, 'Скопировать для разбора у Клода');
}

function renderFinish() {
  const mine = dialogSession.dialog.steps.filter(isMine).length;
  return el('div', { class: 'card center' }, [
    uiIcon('check', 48),
    el('p', { text: 'Разговор пройден целиком.' }),
    el('p', {
      class: 'faint',
      text: `Своих реплик ${mine}, с первого раза ${dialogSession.clean}.`,
    }),
    el('div', { class: 'row', style: 'justify-content:center' }, [
      el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: restartDialog }, 'Ещё раз'),
      el('button', { class: 'btn btn-small', type: 'button', onclick: exitDialog }, 'К разговорам'),
    ]),
  ]);
}

/* ═══════════════════ ПРОВЕРКА ═══════════════════ */

/** Слова образца по порядку — для подсказки и для счёта, сколько их всего. */
const correctWords = (step) => buildChunks(step.heb).words;

/**
 * Кусок, на котором споткнулся разбор. Считаем через слова, а не через номер куска:
 * в банке попадаются куски из двух слов, и номера бы разъехались.
 */
function chunkIndexForWord(placed, wordIndex) {
  if (wordIndex < 0) return -1;
  let counted = 0;
  for (let index = 0; index < placed.length; index += 1) {
    counted += splitPhrase(placed[index].text).length;
    if (wordIndex < counted) return index;
  }
  return -1;
}

function placeChunk(chunkId) {
  const position = dialogSession.bank.findIndex((chunk) => chunk.id === chunkId);
  if (position < 0) return;
  dialogSession.placed.push(dialogSession.bank[position]);
  dialogSession.bank.splice(position, 1);
  dialogSession.feedback = null;   // ответ изменился — старый вердикт врёт
  renderDialog();
}

function takeBackChunk(index) {
  const chunk = dialogSession.placed[index];
  if (!chunk) return;
  dialogSession.placed.splice(index, 1);
  dialogSession.bank.push(chunk);
  dialogSession.feedback = null;
  renderDialog();
}

function returnAllChunks() {
  dialogSession.bank = dialogSession.bank.concat(dialogSession.placed);
  dialogSession.placed = [];
  dialogSession.feedback = null;
}

async function checkAnswer() {
  const step = currentStep();
  if (!step || dialogSession.answered) return;
  const answer = dialogSession.placed.map((chunk) => chunk.text).join(' ');
  const result = checkSentence(answer, step.heb);

  dialogSession.attempts += 1;
  dialogSession.feedback = result;
  if (result.ok) {
    dialogSession.answered = true;
    if (dialogSession.attempts === 1 && !dialogSession.hints) dialogSession.clean += 1;
    speech.speak(step.heb);
  }
  renderDialog();
  await creditAttempt(result.ok);
}

function revealAnswer() {
  const step = currentStep();
  if (!step || dialogSession.answered) return;
  dialogSession.revealed = true;
  dialogSession.usedReveal = true;
  dialogSession.answered = true;
  dialogSession.attempts += 1;
  dialogSession.feedback = { ok: false, kind: 'shown', text: 'Собери её глазами и повтори вслух.', at: -1 };
  renderDialog();
  speech.speak(step.heb);
  creditAttempt(false);
}

/** Каждая проверка идёт в общий счёт сценки: и верная, и нет. */
async function creditAttempt(correct) {
  const record = progressRecord(dialogSession.dialog.id);
  record.total += 1;
  if (correct) record.correct += 1;
  await saveProgress(record);
}

async function finishDialog() {
  const record = progressRecord(dialogSession.dialog.id);
  record.done = true;
  // «Без подсказок» засчитывается только за честный проход: ни одного показанного ответа
  if (dialogSession.hard && !dialogSession.usedReveal) record.hardDone = true;
  await saveProgress(record);
}
