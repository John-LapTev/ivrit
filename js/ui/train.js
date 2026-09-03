import { MAX_LEVEL, QUALITY_EASY, QUALITY_FORGOT, QUALITY_HARD } from '../core/constants.js';
import { MODES, dueWords, finishExam, isWordAvailable, matchesTopic, nextQuestion, recordAnswer, session, shuffle, startExam, startSession, troubleWords } from '../core/modes.js';
import { stripNiqqud } from '../core/translit.js';
import { speech } from '../core/speech.js';
import { isStarted } from '../core/srs.js';
import { state } from '../core/state.js';
import { el, fill, toast } from './dom.js';
import { bigWord, hebText } from './word.js';
import { hardMark } from './hard-mark.js';
import { uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { markTeacherStep, renderTeacherDay, teacherDay } from './teacher-course.js';
import { runTeacherStep } from './teacher-words.js';

/* ——— Показ слова ——— */

/**
 * Слово на экране: в базе оно лежит с огласовками, а кнопка «спрятать огласовки»
 * показывает голое написание — так читают в жизни. Через эту функцию проходит
 * ВСЁ, что выводится на иврите, иначе половина экрана останется с точками.
 */

/* ——— Запуск тренировки ——— */

/**
 * Для режимов со звуком берём только те слова, которые действительно прозвучат:
 * встроенная запись есть не у всех (свои слова пользователя её не имеют),
 * а системный голос может отсутствовать.
 */
function withSound(words) {
  if (speech.voice) return words;
  return words.filter((word) => speech.hasClip(word.heb));
}

export function beginTraining() {
  const mode = MODES.find((item) => item.id === state.mode);
  const due = mode.needsVoice ? withSound(dueWords()) : dueWords();
  let words = due.slice(0, state.sessionLimit);
  if (!words.length) {
    const started = state.words.filter((word) => isStarted(state.srs.get(word.id))
      && isWordAvailable(word) && matchesTopic(word));
    words = shuffle(mode.needsVoice ? withSound(started) : started).slice(0, state.sessionLimit);
  }
  if (!words.length) { toast('Нечего повторять — сначала пройди новые слова.'); return; }
  if (mode.needsVoice && !speech.available) { toast('Для этого режима нужен звук: включи голос в системе.', true); return; }
  startSession({ mode: state.mode, words });
  showScreen('train');
  renderTrain();
}

export function beginExam(level) {
  startExam(level);
  showScreen('train');
  renderTrain();
}

export function beginTroubleRun() {
  const words = troubleWords(state.sessionLimit);
  if (!words.length) { toast('Ошибок пока нет — и хорошо.'); return; }
  startSession({ mode: state.mode, words });
  showScreen('train');
  renderTrain();
}

/* ——— Экран тренировки ——— */

export function renderTrain(feedback) {
  const counter = document.getElementById('train-counter');
  const progress = document.getElementById('train-progress');
  const verdictNode = document.getElementById('train-verdict');
  const keysNode = document.getElementById('train-keys');
  fill('train-actions', []);
  verdictNode.className = 'verdict';
  verdictNode.textContent = '';

  if (!session.question) { renderSessionSummary(); return; }

  const total = session.exam ? session.exam.total : session.queue.length;
  counter.textContent = session.exam
    ? `Экзамен · вопрос ${session.index + 1} из ${total}`
    : `${session.index + 1} из ${total}`;
  progress.style.width = `${Math.round((session.index / Math.max(total, 1)) * 100)}%`;

  const question = session.question;
  if (question.kind === 'choice') renderChoiceQuestion(question, feedback);
  if (question.kind === 'input') renderInputQuestion(question, feedback);
  if (question.kind === 'flip') renderFlipQuestion(question);

  if (feedback) {
    verdictNode.textContent = feedback.message;
    verdictNode.className = `verdict is-${feedback.verdict === 'correct' ? 'ok' : 'err'}`;
    if (feedback.verdict !== 'correct') {
      fill('train-actions', el('button', { class: 'btn', type: 'button', onclick: advanceQuestion }, 'Дальше →'));
    }
  }

  keysNode.textContent = question.kind === 'flip' ? 'Пробел — перевернуть · 1, 2, 3 — оценка · S — озвучить · Esc — выйти'
    : question.kind === 'input' ? (question.byEar
        ? 'Enter — проверить · 0 — не знаю · S — повторить звук · Esc — выйти'
        : 'Enter — проверить · 0 — не знаю · S — озвучить · Esc — выйти')
    : 'Клавиши 1–4 — ответ · 0 — не знаю · S — озвучить · Esc — выйти';
}

export function cardClass(feedback) {
  if (!feedback) return 'train-card';
  if (feedback.verdict === 'correct') return 'train-card is-ok';
  return 'train-card is-err';
}

export function speakButton(text, big) {
  return el('button', {
    class: big ? 'speak-btn is-big' : 'speak-btn', type: 'button',
    'aria-label': 'Озвучить', title: 'Озвучить (S)',
    onclick: () => { if (!speech.speak(text)) toast('Ивритского голоса в системе нет.', true); },
  }, uiIcon('sound', 20));
}

function renderChoiceQuestion(question, feedback) {
  const word = question.word;
  const showAnswer = Boolean(feedback);

  const cardChildren = [];
  if (question.hideWord) {
    cardChildren.push(speakButton(word.heb, true));
    cardChildren.push(el('p', { class: 'faint', text: 'Нажми и послушай — что это значит?' }));
    if (showAnswer) {
      cardChildren.push(bigWord(word.heb));
      cardChildren.push(el('div', { class: 'card-translit', text: word.translit }));
    }
  } else if (question.optionField === 'translation') {
    // Здесь проверяется перевод, а не чтение, поэтому в обычной тренировке чтение видно
    // сразу: на слух слово разобрать удаётся не всегда (просьба владельца). На экзамене
    // подсказки быть не должно — там оно появляется только вместе с ответом.
    cardChildren.push(bigWord(word.heb));
    if (!session.exam || showAnswer) {
      cardChildren.push(el('div', { class: 'card-translit', text: word.translit }));
    }
    if (speech.available) cardChildren.push(speakButton(word.heb));
  } else {
    cardChildren.push(el('div', { class: 'card-question', text: word.translation }));
    if (showAnswer) cardChildren.push(el('div', { class: 'card-translit', text: word.translit }));
  }

  /* Кружок помечает изучаемое ИВРИТСКОЕ слово. Поэтому он стоит у вариантов только там,
     где варианты и есть слова на иврите. Когда выбираешь русский перевод, помечать русское
     слово бессмысленно (Иван 03.09.2026: «я же не русское слово учу») — там кружок один,
     в углу карточки, и относится к загаданному слову.                                  */
  const markOptions = question.optionField === 'heb';
  if (!markOptions) cardChildren.push(hardMark(word, 'card-mark'));

  const options = question.options.map((option, index) => {
    const isCorrect = index === question.correctIndex;
    const chosen = feedback && feedback.chosenIndex === index;
    const classes = ['option'];
    if (showAnswer && isCorrect) classes.push('is-ok');
    if (showAnswer && chosen && !isCorrect) classes.push('is-err');
    const label = markOptions ? hebText(option.heb) : option[question.optionField];
    const button = el('button', {
      class: classes.join(' '), type: 'button', disabled: session.answered,
      onclick: () => answerChoice(index),
    }, [
      el('span', { class: 'option-key', text: String(index + 1) }),
      el('span', { class: `option-body${markOptions ? ' heb' : ''}`, text: label }),
    ]);
    // Кружок — отдельная кнопка рядом, а не внутри варианта: иначе нажатие на метку
    // засчитывалось бы как ответ, да и кнопка внутри кнопки — неверная разметка.
    return markOptions ? el('div', { class: 'option-row' }, [button, hardMark(option)]) : button;
  });

  fill('train-body', [
    el('div', { class: cardClass(feedback) }, cardChildren),
    el('div', { class: 'options' }, options.concat(feedback ? [] : [unknownButton()])),
  ]);
}

/**
 * «Не знаю» вместо угадывания: случайно ткнув верный вариант, человек получил бы
 * зачёт за слово, которого не помнит, и оно ушло бы из повторений. Прямая просьба владельца.
 */
function unknownButton() {
  return el('button', {
    class: 'btn btn-quiet btn-wide', type: 'button', style: 'margin-top:6px',
    onclick: answerUnknown,
  }, 'Не знаю — показать ответ');
}

async function answerUnknown() {
  if (session.answered) return;
  session.answered = true;
  const word = session.question.word;
  await recordAnswer(word, 'wrong');
  renderTrain({ verdict: 'wrong', message: `${hebText(word.heb)} — ${word.translit} — ${word.translation}` });
}

/* Ударение в чтении — подсказка глазу, а не часть ответа: значка ударения на клавиатуре
   нет, поэтому при сверке он и регистр отбрасываются. */
const TRAIN_STRESS_MARK = '́';
const normalizeReading = (text) => String(text || '')
  .normalize('NFD')
  .split(TRAIN_STRESS_MARK).join('')
  .normalize('NFC')
  .toLowerCase()
  .replace(/\s+/gu, ' ')
  .trim();

function renderInputQuestion(question, feedback) {
  const word = question.word;
  // Без примера прямо в поле: готовое «шалом» раскрывало бы ответ на первом же слове.
  const input = el('input', {
    type: 'text', id: 'translit-input', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', disabled: session.answered,
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); answerTranslit(input.value); }
  });

  // В диктанте слово скрыто до ответа — иначе это не проверка слуха
  const cardChildren = [];
  if (question.byEar && !feedback) {
    cardChildren.push(speakButton(word.heb, true));
    cardChildren.push(el('p', { class: 'faint', text: 'Слушай и запиши чтение русскими буквами' }));
  } else {
    cardChildren.push(bigWord(word.heb));
    if (feedback) {
      cardChildren.push(el('div', { class: 'card-translit', text: word.translit }));
      cardChildren.push(el('div', { class: 'card-translation', text: word.translation }));
    } else {
      cardChildren.push(el('p', { class: 'faint', text: 'Напечатай чтение русскими буквами' }));
    }
    if (speech.available) cardChildren.push(speakButton(word.heb));
  }

  // В режимах без вариантов ответа кружок стоит в углу карточки — метка нужна всюду
  cardChildren.push(hardMark(word, 'card-mark'));

  fill('train-body', [
    el('div', { class: cardClass(feedback) }, cardChildren),
    el('div', { class: 'options' }, [
      input,
      el('button', {
        class: 'btn btn-wide', type: 'button', disabled: session.answered,
        onclick: () => answerTranslit(input.value),
      }, 'Проверить'),
      feedback ? null : unknownButton(),
    ].filter(Boolean)),
  ]);
  if (!session.answered) {
    input.focus();
    if (question.byEar) speech.speak(word.heb);   // диктант сразу проигрывает слово
  }
}

function renderFlipQuestion(question) {
  const word = question.word;
  const front = [bigWord(word.heb)];
  if (speech.available) front.push(speakButton(word.heb));

  const back = [
    bigWord(word.heb),
    el('div', { class: 'card-translit', text: word.translit }),
    el('div', { class: 'card-translation', text: word.translation }),
  ];
  if (word.example && word.example.heb) {
    back.push(el('div', { class: 'example-block', style: 'text-align:right;margin-top:8px' }, [
      el('div', { class: 'heb', style: 'font-size:26px;line-height:1.5', text: hebText(word.example.heb) }),
      el('div', { class: 'sentence-translit', text: word.example.translit || '' }),
      el('div', { class: 'sentence-translation', text: word.example.translation || '' }),
    ]));
  }
  if (speech.available) back.push(speakButton(word.heb));

  const card = el('div', { class: 'train-card' },
    (session.flipped ? back : front).concat([hardMark(word, 'card-mark')]));
  const actions = session.flipped
    ? el('div', { class: 'options' }, [
        el('button', { class: 'option', type: 'button', onclick: () => answerFlashcard(QUALITY_FORGOT) },
          [el('span', { class: 'option-key', text: '1' }), 'Не помню']),
        el('button', { class: 'option', type: 'button', onclick: () => answerFlashcard(QUALITY_HARD) },
          [el('span', { class: 'option-key', text: '2' }), 'Трудно']),
        el('button', { class: 'option', type: 'button', onclick: () => answerFlashcard(QUALITY_EASY) },
          [el('span', { class: 'option-key', text: '3' }), 'Легко']),
      ])
    : el('div', { class: 'options' }, el('button', {
        class: 'btn btn-wide', type: 'button', onclick: flipCard,
      }, 'Перевернуть (пробел)'));

  fill('train-body', [card, actions]);
}

/* ——— Ответы ——— */

let advanceTimer = null;
export function scheduleAdvance() {
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(advanceQuestion, 700);
}

function advanceQuestion() {
  clearTimeout(advanceTimer);
  session.index += 1;
  nextQuestion();
  renderTrain();
}

export async function answerChoice(index) {
  if (session.answered) return;
  session.answered = true;
  const question = session.question;
  const correct = index === question.correctIndex;
  await recordAnswer(question.word, correct ? 'correct' : 'wrong');
  const right = question.options[question.correctIndex];
  renderTrain({
    verdict: correct ? 'correct' : 'wrong',
    chosenIndex: index,
    message: correct ? 'Верно' : `Правильно: ${hebText(right.heb)} — ${right.translit} — ${right.translation}`,
  });
  if (correct) scheduleAdvance();
}

async function answerTranslit(value) {
  if (session.answered) return;
  const typed = String(value || '').trim();
  if (!typed) { toast('Напечатай чтение русскими буквами — например «шалом»'); return; }
  session.answered = true;
  const question = session.question;
  const correct = normalizeReading(typed) === normalizeReading(question.word.translit);
  const verdict = correct ? 'correct' : 'wrong';
  await recordAnswer(question.word, verdict);
  renderTrain({ verdict, message: correct ? 'Верно' : `Правильно: ${question.word.translit}` });
  if (correct) scheduleAdvance();
}

function flipCard() {
  if (session.flipped || !session.question || session.question.kind !== 'flip') return;
  session.flipped = true;
  renderFlipQuestion(session.question);
}

/* Самооценка карточки идёт в SM-2 как есть: «Не помню» — провал, «Трудно» — тройка,
   «Легко» — пятёрка. Раньше оценка выбрасывалась и обе кнопки давали одно и то же,
   а «лёгкость» слова могла только падать: при качестве 4 прибавка ровно нулевая,
   и за месяцы все слова сползали к минимуму (аудит 03.09.2026). */
async function answerFlashcard(quality) {
  if (session.answered || !session.flipped) return;
  session.answered = true;
  const verdict = quality === QUALITY_FORGOT ? 'wrong' : 'correct';
  await recordAnswer(session.question.word, verdict, quality);
  advanceQuestion();
}

async function renderSessionSummary() {
  document.getElementById('train-counter').textContent = '';
  document.getElementById('train-progress').style.width = '100%';
  document.getElementById('train-keys').textContent = '';

  if (session.exam) {
    const result = await finishExam();
    const passed = result.passed;
    fill('train-body', el('div', { class: 'train-card' }, [
      el('div', { class: 'big-heb heb', text: passed ? 'טוב' : 'שוב', style: 'font-size:72px' }),
      el('div', { class: 'card-question', text: passed
        ? (result.isFinal ? 'Итоговый экзамен сдан' : 'Экзамен сдан')
        : (result.isFinal ? 'Итоговый экзамен не сдан' : 'Экзамен не сдан') }),
      el('div', { class: 'card-translation', text: `${result.score} правильных из ${result.total}` }),
      el('p', { class: 'faint', text: passed
        ? (result.isFinal ? 'Весь словарь приложения пройден. Дальше — новые слова и темы.'
          : result.level < MAX_LEVEL ? `Уровень ${result.level + 1} открыт — новые слова уже в тренировках.`
          : 'Все уровни пройдены, открылся итоговый экзамен.')
        : `Нужно ${result.passScore}. Повтори слова и приходи снова — попыток сколько угодно.` }),
    ]));
    session.exam = null;
  } else {
    const total = session.correct + session.wrong;
    fill('train-body', el('div', { class: 'train-card' }, [
      el('div', { class: 'big-heb heb', text: 'סוף', style: 'font-size:72px' }),
      el('div', { class: 'card-question', text: 'Сессия закончена' }),
      el('div', { class: 'card-translation', text: `${session.correct} верно из ${total}` }),
      el('p', { class: 'faint', text: session.wrong
        ? 'Слова с ошибками вернутся завтра — так они и запоминаются.'
        : 'Ни одной ошибки.' }),
    ]));
  }

  session.active = false;
  const fromTeacher = Boolean(state.teacherReturn);
  // Шаг программы закрывается только безошибочным проходом: иначе «сделано» стоит
  // там, где половина ответов была мимо.
  const clean = session.wrong === 0;
  const actions = [];
  if (fromTeacher && !clean) {
    actions.push(el('p', { class: 'faint center', style: 'margin-bottom:12px',
      text: 'Шаг закроется, когда пройдёшь без ошибок. Ошибки уже в очереди — прогони их.' }));
    actions.push(el('button', { class: 'btn', type: 'button', onclick: () => {
      const back = state.teacherReturn;
      state.teacherReturn = null;
      runTeacherStep(teacherDay(back.day), back.step);
    } }, 'Пройти ещё раз'));
  }
  actions.push(el('button', {
    class: fromTeacher && !clean ? 'btn btn-quiet' : 'btn', type: 'button',
    onclick: () => {
      if (finishTeacherReturn(clean)) return;
      showScreen('home');
    },
  }, fromTeacher ? 'К занятию' : 'На главную'));
  fill('train-actions', actions);
  document.getElementById('train-verdict').textContent = '';
}

/** Тренировка, запущенная программой, возвращает в занятие. Шаг закрывается только
    пройденной до конца сессией: иначе «выйти» на первом вопросе засчитывало бы день. */
export function finishTeacherReturn(completed) {
  const back = state.teacherReturn;
  if (!back) return false;
  state.teacherReturn = null;
  if (completed) markTeacherStep(back.day, back.step);
  state.teacherDay = back.day;
  showScreen('teacher-day');
  renderTeacherDay();
  return true;
}

/** Прогнать тот же набор заново, не выходя с экрана: слова те же, порядок новый. */
export function restartTraining() {
  if (!session.restart) return;
  clearTimeout(advanceTimer);
  startSession(session.restart);
  renderTrain();
}

export function exitTraining() {
  session.active = false;
  session.exam = null;
  clearTimeout(advanceTimer);
  if (finishTeacherReturn(false)) return;   // тренировку открыла программа — возвращаемся в занятие
  showScreen('home');
}

/* ——— Клавиатура ——— */

export function handleKeydown(event) {
  if (state.screen !== 'train' || !session.question) return;
  const target = event.target;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
  const question = session.question;

  if (event.key === 'Escape') { exitTraining(); return; }
  if (typing && event.key !== 'Escape') return;

  if (event.key === 's' || event.key === 'S' || event.key === 'ы' || event.key === 'Ы') {
    if (!speech.speak(question.word.heb)) toast('Ивритского голоса в системе нет.', true);
    return;
  }
  if (event.key === ' ' && question.kind === 'flip') { event.preventDefault(); flipCard(); return; }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (session.answered) advanceQuestion();
    else if (question.kind === 'flip' && !session.flipped) flipCard();
    return;
  }

  if (event.key === '0' && question.kind !== 'flip') { answerUnknown(); return; }

  const digit = Number(event.key);
  if (!digit) return;
  if (question.kind === 'choice' && digit >= 1 && digit <= question.options.length) answerChoice(digit - 1);
  if (question.kind === 'flip' && session.flipped && digit >= 1 && digit <= 3) {
    answerFlashcard([QUALITY_FORGOT, QUALITY_HARD, QUALITY_EASY][digit - 1]);
  }
}
