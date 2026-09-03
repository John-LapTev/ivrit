import { OPTIONS_PER_QUESTION, STORE_SRS } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { qualityFromVerdict } from '../core/modes.js';
import { shuffle } from '../core/random.js';
import { releaseMicrophone } from '../core/recorder.js';
import { buildChunks, checkSentence, splitPhrase } from '../core/sentence-order.js';
import { speech } from '../core/speech.js';
import { applySm2, createSrsRecord } from '../core/srs.js';
import { state } from '../core/state.js';
import { updateDayStats } from '../core/stats.js';
import { wordKey } from '../core/translit.js';
import { TEACHER_DAYS } from '../data/teacher-days.js';
import { el, fill, plural, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { attemptDetails, recordButton } from './pronounce.js';
import { showScreen } from './screens.js';
import { markTeacherStep, renderTeacherDay } from './teacher-course.js';
import { bigWord, wordLine } from './word.js';

/* ═══════════════════ TEACHER-TASKS — задания дня программы ═══════════════════

   Содержание файла:
     МАТЕРИАЛ   — где задание берёт слова и фразы: словарь ищется по ключу, фразы
                  копятся из пройденных дней;
     ЗАПУСК     — по заданию на вид: слова дня, узнавание, на слух, сборка фразы,
                  перевод, проговаривание вслух, экзамен;
     ЭКРАН      — отрисовка текущего вопроса и итога подхода;
     ПРОВЕРКА   — разбор ответа, статистика дня, возврат ошибок экзамена в повторение.

   Печати НА ИВРИТЕ здесь нет ни в одном задании: ивритской раскладки у владельца нет,
   и «набери слово» превращалось бы в возню с клавиатурой вместо языка. Вместо этого —
   выбор из вариантов, сборка из кусков и ответ по-русски.

   Весь ивритский текст выводится через ui/word.js (bigWord, wordLine): там живут кнопка
   «спрятать огласовки» и направление письма. Прямого сравнения ивритских строк в файле
   тоже нет — только через wordKey и разбор из core/sentence-order.js.                  */

/* ═══════════════════ МАТЕРИАЛ ═══════════════════ */

/* Сколько вопросов в подходе. На слух и узнавание — самые дешёвые по времени и самые
   полезные, поэтому их больше; проговаривание вслух короче: оно утомительнее всего. */
const STEP_SIZE = { recognize: 8, ear: 8, build: 6, translate: 6, speak: 5 };

/* Доля сегодняшнего материала в подходе. Остальное добирается из пройденных дней:
   иначе старое перестанет попадаться, а ради повторения всё и затевалось. */
const TODAY_SHARE = 2 / 3;

const DECOY_CHUNKS = 4;      // сколько лишних кусков подмешать в сборку фразы

/** Словарь по ключу слова. Пересобирается, когда словарь вырос: список слов живёт
    в state и меняется при добавлении вручную или при импорте. */
let wordIndex = null;
let wordIndexSize = -1;

function wordsByKey() {
  if (wordIndex && wordIndexSize === state.words.length) return wordIndex;
  wordIndex = new Map();
  state.words.forEach((word) => {
    const key = wordKey(word.heb);
    if (key && !wordIndex.has(key)) wordIndex.set(key, word);
  });
  wordIndexSize = state.words.length;
  return wordIndex;
}

/**
 * Слово программы в словаре. Ищем по ключу (согласные без огласовок и без конечных
 * форм), а не по строке: в программе слово может стоять с другой огласовкой или
 * в конце фразы с конечной буквой — по строке оно просто не нашлось бы.
 */
export function findCourseWord(heb) {
  return wordsByKey().get(wordKey(heb)) || null;
}

/** Слова, которые программа ввела по этот день включительно — уже как записи словаря. */
function courseWords(uptoDay) {
  const picked = [];
  const seen = new Set();
  TEACHER_DAYS.filter((entry) => entry.day <= uptoDay).forEach((entry) => {
    (entry.words || []).forEach((heb) => {
      const word = findCourseWord(heb);
      if (!word || seen.has(word.id)) return;
      seen.add(word.id);
      picked.push(word);
    });
  });
  return picked;
}

/** Фразы по этот день включительно, без повторов: одна фраза встречается в разных днях. */
function coursePhrases(uptoDay) {
  const seen = new Set();
  const out = [];
  TEACHER_DAYS.filter((entry) => entry.day <= uptoDay).forEach((entry) => {
    (entry.phrases || []).forEach((phrase) => {
      const key = wordKey(phrase.heb);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(phrase);
    });
  });
  return out;
}

/** Общая мерка вопроса: и слово, и фраза выглядят одинаково — иврит, чтение, перевод. */
const questionOfWord = (word) => ({
  heb: word.heb, translit: word.translit, translation: word.translation, word,
});

const questionKey = (item) => wordKey(item.heb);

/** Набор вопросов: примерно две трети сегодняшних, остальное — из пройденного. */
function mixByDay(today, earlier, size) {
  const fresh = shuffle(today);
  const keys = new Set(fresh.map(questionKey));
  const old = shuffle(earlier.filter((item) => !keys.has(questionKey(item))));
  const fromToday = fresh.slice(0, Math.ceil(size * TODAY_SHARE));
  const chosen = fromToday.concat(old.slice(0, size - fromToday.length));
  // прошлых не хватило (первые дни) — добираем сегодняшними, чтобы подход был полным
  if (chosen.length < size) {
    chosen.push(...fresh.slice(fromToday.length, fromToday.length + size - chosen.length));
  }
  return shuffle(chosen);
}

/** Фразы для задания: свои плюс из пройденных дней. */
function taskPhrases(entry, size) {
  return mixByDay((entry.phrases || []).slice(), coursePhrases(entry.day - 1), size);
}

/**
 * Слова для задания. `earlierOnly` — это повторение: сегодняшние слова человек только
 * что посмотрел, спрашивать их тут же бессмысленно, а вот прошлые пора освежить.
 */
function taskWords(entry, size, earlierOnly) {
  const earlier = courseWords(entry.day - 1).map(questionOfWord);
  if (earlierOnly) return shuffle(earlier).slice(0, size);
  const today = (entry.words || []).map(findCourseWord).filter(Boolean).map(questionOfWord);
  return mixByDay(today, earlier, size);
}

/* ═══════════════════ ЗАПУСК ═══════════════════ */

const TASK_TITLES = {
  words: 'Слова дня',
  recognize: 'Узнай слово',
  ear: 'Что тебе сказали?',
  build: 'Собери фразу',
  translate: 'Напиши перевод',
  speak: 'Скажи вслух',
};

/** Порог экзамена в процентах: ниже — день не закрывается, но попыток сколько угодно. */
export const EXAM_PASS_SHARE = 80;

/** Пустой подход: общая заготовка, чтобы поля задания не расходились между видами. */
function newTask(kind, entry, items, step) {
  return {
    kind, step: step || kind, day: entry.day, items,
    index: 0, done: 0, mistakes: [],
    chosen: [], bank: [], options: null, optionsFor: null,
    revealed: false, attempt: null, recording: false, asking: false, checking: false,
    stopRecording: null, playingGroups: false,
    exam: false, parts: null, part: 0, examDone: 0, examTotal: 0, examWrong: [],
  };
}

function openTask(task) {
  state.teacherTask = task;
  showScreen('teacher-task');
  renderTeacherTask();
}

/** Слова дня: карточка со словом, чтением, переводом и озвучкой. Не спрашиваем — показываем. */
export function startTeacherWords(entry, step) {
  const items = (entry.words || []).map(findCourseWord).filter(Boolean).map(questionOfWord);
  if (!items.length) { toast('Слова этого дня не нашлись в словаре.', true); return; }
  openTask(newTask('words', entry, items, step));
}

/** Узнай слово: слово на иврите, четыре перевода на выбор. */
export function startTeacherRecognize(entry, step, earlierOnly) {
  const items = taskWords(entry, STEP_SIZE.recognize, earlierOnly);
  if (!items.length) {
    toast(earlierOnly ? 'Повторять пока нечего — это первый день.' : 'Слова этого дня не нашлись в словаре.', true);
    return;
  }
  openTask(newTask('recognize', entry, items, step));
}

/** Фраза на слух: только звук, ответ — перевод из четырёх. */
export function startTeacherEar(entry, step) {
  const items = phrasesOrWords(entry, STEP_SIZE.ear);
  if (!items.length) { toast('Для этого дня фраз пока нет.', true); return; }
  if (!speech.available) { toast('Нужен звук: ивритского голоса и записей в системе нет.', true); return; }
  const task = newTask('ear', entry, items, step);
  openTask(task);
  speech.speak(items[0].heb);
}

/** Собери фразу из кусков, среди которых есть лишние. */
export function startTeacherBuild(entry, step) {
  const items = taskPhrases(entry, STEP_SIZE.build);
  if (!items.length) { toast('Для этого дня фраз пока нет.', true); return; }
  const task = newTask('build', entry, items, step);
  fillChunkBank(task);
  openTask(task);
}

/** Напиши перевод: фраза на иврите, ответ по-русски. */
export function startTeacherTranslate(entry, step) {
  const items = phrasesOrWords(entry, STEP_SIZE.translate);
  if (!items.length) { toast('Для этого дня фраз пока нет.', true); return; }
  openTask(newTask('translate', entry, items, step));
}

/** Скажи вслух: сказал сам — сверился с записью. */
export function startTeacherSpeak(entry, step) {
  const items = phrasesOrWords(entry, STEP_SIZE.speak);
  if (!items.length) { toast('Для этого дня фраз пока нет.', true); return; }
  openTask(newTask('speak', entry, items, step));
}

/** В первые дни фраз мало даже вместе с прошлыми — тогда добираем словами: они звучат
    так же, и выбор из четырёх переводов остаётся осмысленным. */
function phrasesOrWords(entry, size) {
  const phrases = taskPhrases(entry, size);
  if (phrases.length >= size) return phrases;
  const keys = new Set(phrases.map(questionKey));
  const words = courseWords(entry.day).map(questionOfWord).filter((item) => !keys.has(questionKey(item)));
  return phrases.concat(shuffle(words).slice(0, size - phrases.length));
}

/* ——— Экзамен ———
   Три части подряд: понял на слух → собрал фразу → перевёл своими словами. Проговаривание
   в экзамен не входит намеренно: там человек сам себе судья («сказал так же» / «вышло
   иначе»), и оценка из такого ответа выйдет не честнее подбрасывания монеты.
   Слова из проваленных фраз возвращаются в повторение — это важнее самой оценки.       */

const EXAM_PARTS = ['ear', 'build', 'translate'];
const EXAM_PART_NAMES = { ear: 'что тебе сказали', build: 'собери фразу', translate: 'напиши перевод' };

export function startTeacherExam(entry, step) {
  // У экзаменационного дня своих фраз может не быть вовсе: тогда спрашиваем всё пройденное
  const pool = (entry.phrases || []).length ? entry.phrases.slice() : coursePhrases(entry.day);
  const items = shuffle(pool);
  if (!items.length) { toast('Фразы для экзамена не найдены.', true); return; }

  const size = Math.max(1, Math.round(items.length / EXAM_PARTS.length));
  const parts = EXAM_PARTS
    .map((kind, order) => ({
      kind,
      items: order === EXAM_PARTS.length - 1 ? items.slice(order * size) : items.slice(order * size, (order + 1) * size),
    }))
    .filter((part) => part.items.length);

  const task = newTask(parts[0].kind, entry, parts[0].items, step || 'exam');
  task.exam = true;
  task.parts = parts;
  task.examTotal = items.length;
  if (task.kind === 'build') fillChunkBank(task);
  openTask(task);
  if (task.kind === 'ear') speech.speak(task.items[0].heb);
}

/** Переход к следующей части экзамена; накопленный счёт сохраняем. */
function nextExamPart(task) {
  const done = task.examDone + task.done;
  const wrong = task.examWrong.concat(task.mistakes);
  const part = task.part + 1;
  const next = Object.assign({}, task, {
    kind: task.parts[part].kind, items: task.parts[part].items,
    index: 0, done: 0, mistakes: [], chosen: [], bank: [], options: null, optionsFor: null,
    revealed: false, part, examDone: done, examWrong: wrong,
  });
  state.teacherTask = next;
  if (next.kind === 'build') fillChunkBank(next);
  renderTeacherTask();
  if (next.kind === 'ear') speech.speak(next.items[0].heb);
}

/**
 * Какое задание открывает шаг дня. Названий у шага бывает несколько: программу пишет
 * соседний модуль, и как он назовёт «повторение» — `warmup` или `review` — дело его.
 */
const STEP_TASKS = {
  words: startTeacherWords,
  learn: startTeacherWords,
  recognize: startTeacherRecognize,
  choice: startTeacherRecognize,
  warmup: (entry, step) => startTeacherRecognize(entry, step, true),
  review: (entry, step) => startTeacherRecognize(entry, step, true),
  ear: startTeacherEar,
  listen: startTeacherEar,
  build: startTeacherBuild,
  translate: startTeacherTranslate,
  type: startTeacherTranslate,
  speak: startTeacherSpeak,
  exam: startTeacherExam,
};

/**
 * Открывает задание дня. Возвращает `false`, если шаг не наш (правило грамматики,
 * сценка, буквы) — тогда экран дня открывает его сам.
 * Отметка о выполнении ставится ровно тем именем шага, с которым задание позвали.
 */
export function runTaskStep(entry, step) {
  const start = STEP_TASKS[step];
  if (!start) return false;
  start(entry, step);
  return true;
}

/** Пройти то же задание заново: материал подбирается снова, значит и набор будет другим. */
export function restartTeacherTask() {
  const task = state.teacherTask;
  if (!task) { showScreen('teacher'); return; }
  const entry = TEACHER_DAYS.find((item) => item.day === task.day);
  if (!entry) { toast('День программы не найден.', true); return; }
  releaseMicrophone();
  speech.stop();
  // У экзамена вид задания меняется от части к части — его перезапускаем целиком
  const start = task.exam ? startTeacherExam : (STEP_TASKS[task.step] || STEP_TASKS[task.kind]);
  if (!start) { toast('Это задание заново не открыть.', true); return; }
  start(entry, task.step);
}

/** Выйти из задания, ничего не отмечая. */
export function exitTeacherTask() {
  releaseMicrophone();
  speech.stop();
  state.teacherTask = null;
  showScreen('teacher-day');
  renderTeacherDay();
}

/* ═══════════════════ ЭКРАН ═══════════════════ */

/** Круглая кнопка «послушать» — она же повторяет фразу в задании на слух. */
const soundRound = (text, label) => el('button', {
  class: 'speak-btn', type: 'button', 'aria-label': label || 'Послушать',
  onclick: () => { if (!speech.speak(text)) toast('Ивритского голоса в системе нет.', true); },
}, uiIcon('sound', 20));

const soundLine = (text, label) => el('button', {
  class: 'btn btn-quiet btn-small', type: 'button',
  onclick: () => { if (!speech.speak(text)) toast('Ивритского голоса в системе нет.', true); },
}, iconLabel('sound', label));

export function renderTeacherTask(feedback) {
  const task = state.teacherTask;
  if (!task) { showScreen('teacher'); return; }
  // Молча падать в консоль нельзя: без разметки экрана человек увидит просто пустоту
  if (!document.getElementById('teacher-task-body')) {
    toast('Экран заданий не открылся — в разметке нет блока заданий.', true);
    return;
  }

  const heading = document.getElementById('teacher-task-heading');
  if (heading) {
    heading.textContent = task.exam
      ? `Экзамен · ${EXAM_PART_NAMES[task.kind] || ''}`
      : TASK_TITLES[task.kind] || 'Задание';
  }

  if (task.index >= task.items.length) { renderTaskSummary(task); return; }

  const item = task.items[task.index];
  const counter = el('p', { class: 'faint center', text: `${task.index + 1} из ${task.items.length}` });

  if (task.kind === 'words') { fill('teacher-task-body', [counter].concat(renderWordCard(task, item))); return; }
  if (task.kind === 'speak') { fill('teacher-task-body', [counter].concat(renderSpeakTask(task, item))); return; }

  const children = [counter].concat(
    task.kind === 'build' ? renderBuildTask(task, item, feedback)
      : task.kind === 'translate' ? renderTranslateTask(task, item, feedback)
      : renderChoiceTask(task, item, feedback),
  );

  if (feedback) {
    children.push(el('p', {
      class: feedback.correct ? 'verdict is-ok' : 'verdict is-err',
      role: 'status', 'aria-live': 'polite',
      text: feedback.correct ? 'Верно' : feedback.message,
    }));
    if (!feedback.correct && feedback.hint) children.push(el('p', { class: 'faint center', text: feedback.hint }));
    if (!feedback.correct) children.push(phraseBreakdown(item));
    children.push(el('div', { class: 'center' }, el('button', {
      class: 'btn btn-wide', type: 'button', onclick: () => goNextQuestion(task),
    }, 'Дальше')));
  } else {
    // В задании на слух и в узнавании ответ даётся нажатием варианта — кнопки «Проверить» там нет
    const needsCheck = task.kind === 'build' || task.kind === 'translate';
    children.push(el('div', { class: 'center' }, [
      needsCheck ? el('button', {
        class: 'btn btn-wide', type: 'button', onclick: () => checkTeacherAnswer(),
      }, 'Проверить') : null,
      // «Не знаю» — тоже ответ, и неверный: вопрос уходит в ошибки и вернётся в конце подхода
      task.exam ? null : el('button', {
        class: needsCheck ? 'btn btn-quiet btn-wide' : 'btn btn-quiet', type: 'button',
        onclick: () => giveUpTeacherAnswer(),
      }, 'Не знаю'),
    ]));
  }

  fill('teacher-task-body', children);
  const field = document.getElementById('teacher-answer');
  if (field && !feedback) {
    field.focus();
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); checkTeacherAnswer(); }
    });
  }
}

function goNextQuestion(task) {
  task.index += 1;
  task.options = null;
  task.optionsFor = null;
  if (task.kind === 'build' && task.index < task.items.length) fillChunkBank(task);
  renderTeacherTask();
  const next = task.items[task.index];
  if (task.kind === 'ear' && next) speech.speak(next.heb);
}

/* ——— Слова дня ——— */

function renderWordCard(task, item) {
  const word = item.word;
  return [
    el('div', { class: 'card center' }, [
      bigWord(item.heb),
      el('div', { class: 'card-translit', text: item.translit || '' }),
      el('div', { class: 'card-translation', text: item.translation || '' }),
      speech.available ? el('div', { class: 'center', style: 'margin-top:14px' }, soundRound(item.heb)) : null,
      word && word.example ? el('div', { class: 'example-block', style: 'margin-top:18px' }, [
        el('div', { class: 'sentence' }, wordLine(word.example.heb)),
        el('div', { class: 'sentence-translit translit', text: word.example.translit || '' }),
        el('div', { class: 'sentence-translation', text: word.example.translation || '' }),
      ]) : null,
    ]),
    el('div', { class: 'center' }, [
      el('button', {
        class: 'btn btn-wide', type: 'button', onclick: () => {
          // «Назад» и снова «Дальше» не должны надувать статистику: считаем самый дальний шаг
          if (task.index >= task.done) { countStudy(task, 'seen'); task.done = task.index + 1; }
          task.index += 1;
          renderTeacherTask();
        },
      }, task.index + 1 === task.items.length ? 'Последнее — к итогу' : 'Дальше'),
      task.index > 0 ? el('button', {
        class: 'btn btn-quiet btn-wide', type: 'button', onclick: () => {
          task.index -= 1;
          renderTeacherTask();
        },
      }, 'Назад') : null,
    ]),
  ];
}

/* ——— Узнай слово и фраза на слух ——— */

/**
 * Варианты ответа: правильный перевод плюс чужие из уже пройденного. Незнакомые слова
 * среди ответов превращают выбор в угадайку по знакомости, поэтому пул — только курс.
 */
function choiceOptions(item, day, byEar) {
  const fromCourse = courseWords(day).map((word) => word.translation)
    .concat(byEar ? coursePhrases(day).map((phrase) => phrase.translation) : []);
  const wrong = (list) => Array.from(new Set(list)).filter((text) => text && text !== item.translation);
  let others = wrong(fromCourse);
  // В первые дни чужих переводов почти нет — добираем словарём, иначе на экране
  // окажется два варианта вместо четырёх и выбор станет бессмысленным
  if (others.length < OPTIONS_PER_QUESTION - 1) {
    others = wrong(fromCourse.concat(state.words.map((word) => word.translation)));
  }
  return shuffle([item.translation].concat(shuffle(others).slice(0, OPTIONS_PER_QUESTION - 1)));
}

function renderChoiceTask(task, item, feedback) {
  const byEar = task.kind === 'ear';
  if (!task.options || task.optionsFor !== questionKey(item)) {
    task.options = choiceOptions(item, task.day, byEar);
    task.optionsFor = questionKey(item);
  }

  const card = byEar
    ? el('div', { class: 'card center' }, [
      soundRound(item.heb, 'Повторить фразу'),
      el('p', { class: 'faint', style: 'margin-top:16px', text: 'Послушай и выбери, что это значит.' }),
      feedback ? el('div', { class: 'sentence' }, wordLine(item.heb)) : null,
      feedback ? el('div', { class: 'sentence-translit translit', text: item.translit || '' }) : null,
    ])
    : el('div', { class: 'card center' }, [
      bigWord(item.heb),
      feedback ? el('div', { class: 'card-translit', text: item.translit || '' }) : null,
      speech.available ? el('div', { class: 'center', style: 'margin-top:12px' }, soundRound(item.heb)) : null,
      el('p', { class: 'faint', style: 'margin-top:14px', text: 'Что это значит?' }),
    ]);

  return [
    card,
    el('div', { class: 'options' }, task.options.map((option, index) => {
      const chosen = feedback && feedback.answer === option;
      const right = option === item.translation;
      const mark = feedback ? (right ? ' is-ok' : chosen ? ' is-err' : '') : '';
      return el('button', {
        class: `option${mark}`, type: 'button', disabled: Boolean(feedback),
        onclick: () => checkTeacherAnswer(option),
      }, [
        el('span', { class: 'option-key', text: String(index + 1) }),
        el('span', { class: 'option-body', text: option }),
      ]);
    })),
  ];
}

/* ——— Собери фразу ——— */

/**
 * Куски фразы плюс чужие слова: иначе ответ собирается перебором, без понимания.
 * Лишние берём только из пройденного — незнакомое слово отсеивается само собой,
 * и задание становится не сложнее, а легче.
 */
function fillChunkBank(task) {
  const item = task.items[task.index];
  const learned = courseWords(task.day).map((word) => word.heb);
  const source = learned.length >= DECOY_CHUNKS * 2 ? learned : state.words.map((word) => word.heb);
  // Одно и то же слово не должно попасть в лишние дважды: в словаре оно может стоять
  // с разными огласовками, а на вид это один и тот же кусок
  const pool = Array.from(new Map(source.map((heb) => [wordKey(heb), heb])).values());
  const { words, extra } = buildChunks(item.heb, shuffle(pool));
  task.bank = shuffle(
    words.map((text, index) => ({ text, index }))
      .concat(extra.slice(0, DECOY_CHUNKS).map((text, index) => ({ text, index: -1 - index }))),
  );
  task.chosen = [];
}

function renderBuildTask(task, item, feedback) {
  const children = [
    el('div', { class: 'card center' }, [
      el('div', { class: 'card-question', text: item.translation }),
      feedback ? el('div', { class: 'sentence', style: 'margin-top:12px' }, wordLine(item.heb)) : null,
      feedback ? el('div', { class: 'sentence-translit translit', text: item.translit || '' }) : null,
    ]),
    // dir=rtl: собранная фраза обязана читаться справа налево, иначе первый выбранный
    // кусок встаёт слева и порядок слов выглядит вывернутым наизнанку
    el('div', { class: 'chunk-slot', dir: 'rtl' }, task.chosen.length
      ? task.chosen.map((chunk, position) => el('button', {
        class: 'chunk', type: 'button', disabled: Boolean(feedback),
        onclick: () => { task.chosen.splice(position, 1); renderTeacherTask(); },
      }, wordLine(chunk.text)))
      : el('span', { class: 'faint', text: 'Нажимай куски снизу' })),
  ];

  /* После проверки лишние куски убираем совсем: ответ уже дан, и разглядывать варианты,
     которые могли бы подойти, только мешает читать разбор. */
  if (feedback) return children;

  const bank = el('div', { class: 'row', style: 'margin-top:12px;justify-content:center' });
  task.bank.forEach((chunk) => {
    if (task.chosen.includes(chunk)) return;
    const button = el('button', {
      class: 'chunk', type: 'button',
      onclick: () => { task.chosen.push(chunk); renderTeacherTask(); },
    }, wordLine(chunk.text));
    // Кусок можно послушать отдельно: на слух слово часто узнаётся раньше, чем в лицо
    if (speech.available && speech.hasClip(chunk.text)) {
      bank.append(el('span', { class: 'chunk-pair' }, [
        button,
        el('button', {
          class: 'chunk-sound', type: 'button', 'aria-label': 'Послушать кусок',
          onclick: (event) => { event.stopPropagation(); speech.speak(chunk.text); },
        }, uiIcon('sound', 20)),
      ]));
    } else {
      bank.append(button);
    }
  });
  children.push(bank);
  return children;
}

/* ——— Напиши перевод ——— */

function renderTranslateTask(task, item, feedback) {
  return [
    el('div', { class: 'card center' }, [
      el('div', { class: 'sentence' }, wordLine(item.heb)),
      speech.available ? el('div', { class: 'center', style: 'margin-top:10px' }, soundRound(item.heb)) : null,
      el('p', { class: 'faint', style: 'margin-top:14px', text: 'Прочитай и напиши, что это значит по-русски.' }),
      feedback ? el('div', { class: 'sentence-translit translit', text: item.translit || '' }) : null,
    ]),
    el('input', {
      type: 'text', id: 'teacher-answer', autocomplete: 'off', autocapitalize: 'off',
      spellcheck: 'false', placeholder: 'Перевод по-русски', 'aria-label': 'Перевод по-русски',
      value: feedback ? feedback.answer : '', disabled: Boolean(feedback),
    }),
  ];
}

/* ——— Скажи вслух ———
   Распознавания речи здесь нет и быть не может: оно уходит в интернет, а приложение
   офлайн. Записанный голос сравнивается по звучанию с образцовой записью
   (ui/pronounce.js), а последнее слово всё равно за человеком: «сказал так же» или нет. */

const GROUP_MAX_WORDS = 2;      // больше двух слов подряд новичку уже не удержать

/** Куски фразы для повторения за диктором. У каждого слова есть своя запись, поэтому
    кусок звучит либо целиком, либо словами подряд. */
function speechGroups(heb) {
  const { words } = buildChunks(heb, []);
  const groups = [];
  for (let start = 0; start < words.length; start += GROUP_MAX_WORDS) {
    const chunk = words.slice(start, start + GROUP_MAX_WORDS);
    groups.push({ text: chunk.join(' '), words: chunk });
  }
  return groups;
}

async function playGroup(group) {
  if (speech.clipUrl(group.text)) { await speech.speakUntilEnd(group.text); return; }
  for (const word of group.words) await speech.speakUntilEnd(word);
}

/** Куски фразы: нажимаешь — звучит, повторяешь вслух, идёшь дальше. */
function shadowingBlock(task, heb) {
  const groups = speechGroups(heb);
  if (groups.length < 2) return null;

  const playAll = async () => {
    if (task.playingGroups) { speech.stop(); task.playingGroups = false; renderTeacherTask(); return; }
    task.playingGroups = true;
    renderTeacherTask();
    for (const group of groups) {
      if (!task.playingGroups) return;
      await playGroup(group);
      await new Promise((resolve) => setTimeout(resolve, 1100));   // тишина на повтор вслух
    }
    task.playingGroups = false;
    renderTeacherTask();
  };

  return el('div', { class: 'shadow-block' }, [
    el('p', { class: 'faint', text: 'Повтори по кускам: слушаешь — говоришь вслух — дальше.' }),
    el('div', { class: 'shadow-groups' }, groups.map((group) => el('button', {
      class: 'shadow-group', type: 'button', onclick: () => playGroup(group),
    }, [wordLine(group.text), uiIcon('sound', 15)]))),
    el('div', { class: 'center' }, el('button', {
      class: 'btn btn-quiet btn-small', type: 'button', onclick: playAll,
    }, task.playingGroups ? iconLabel('stop', 'Остановить') : iconLabel('sound', 'Подряд, с паузами на повтор'))),
  ]);
}

function renderSpeakTask(task, item) {
  if (!task.revealed) {
    const record = recordButton(task, item.heb, renderTeacherTask, true);
    return [
      el('div', { class: 'card center' }, [
        el('div', { class: 'card-question', text: item.translation }),
        el('p', { class: 'faint', style: 'margin-top:16px',
          text: 'Скажи это на иврите вслух — вслух, не про себя. Потом сверишься с записью.' }),
        task.attempt ? el('p', {
          class: task.attempt.ok ? 'verdict is-ok' : 'verdict is-err',
          style: 'margin-top:14px', text: task.attempt.text,
        }) : null,
        task.attempt ? attemptDetails(task.attempt) : null,
        task.checking ? el('p', { class: 'faint', style: 'margin-top:14px', text: 'Слушаю…' }) : null,
      ]),
      record ? el('div', { class: 'center' }, record) : null,
      el('div', { class: 'center' }, el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => {
          task.attempt = null;
          releaseMicrophone();
          task.revealed = true;
          renderTeacherTask();
          speech.speak(item.heb);
        },
      }, 'Сказал — проверить себя')),
    ];
  }

  return [
    el('div', { class: 'card center' }, [
      el('div', { class: 'sentence' }, wordLine(item.heb)),
      el('div', { class: 'sentence-translit translit', text: item.translit || '' }),
      el('p', { class: 'faint', text: item.translation }),
      el('div', { class: 'center', style: 'margin-top:12px' }, soundLine(item.heb, 'Послушать, как правильно')),
      shadowingBlock(task, item.heb),
    ]),
    el('div', { class: 'center' }, [
      el('button', {
        class: 'btn btn-wide', type: 'button', onclick: () => advanceSpeak(task, item, true),
      }, 'Сказал так же'),
      // Честность важнее галочки: фраза не засчитывается и вернётся в конце подхода
      el('button', {
        class: 'btn btn-quiet btn-wide', type: 'button', onclick: () => advanceSpeak(task, item, false),
      }, 'Вышло иначе'),
    ]),
  ];
}

/** Переход к следующей фразе. Разбор записи и прогон кусков обязательно гасим:
    иначе на новой фразе висел бы вердикт от прошлой, а куски продолжали бы играть. */
function advanceSpeak(task, item, said) {
  speech.stop();
  task.playingGroups = false;
  countStudy(task, said ? 'correct' : 'wrong');
  if (said) task.done += 1;
  else task.mistakes = task.mistakes.concat(item);
  task.attempt = null;
  task.revealed = false;
  task.index += 1;
  renderTeacherTask();
}

/* ——— Итог подхода ——— */

function renderTaskSummary(task) {
  // У экзамена частей несколько: пока они не кончились, показываем переход, а не итог
  if (task.exam && task.part + 1 < task.parts.length) {
    const nextKind = task.parts[task.part + 1].kind;
    fill('teacher-task-body', el('div', { class: 'card center' }, [
      el('b', { text: 'Часть пройдена' }),
      el('p', { class: 'faint', text: `Дальше — ${EXAM_PART_NAMES[nextKind]}.` }),
      el('div', { class: 'center' }, el('button', {
        class: 'btn btn-wide', type: 'button', onclick: () => nextExamPart(task),
      }, 'Продолжить')),
    ]));
    return;
  }

  if (task.kind === 'words') {
    fill('teacher-task-body', el('div', { class: 'card center' }, [
      el('div', { class: 'today-count' }, ['Просмотрено ', el('b', { text: String(task.items.length) }),
        ` ${plural(task.items.length, 'слово', 'слова', 'слов')}`]),
      el('p', { class: 'faint', text: 'Слова показаны. Дальше они вернутся в заданиях и в повторении.' }),
      el('div', { class: 'center' }, el('button', {
        class: 'btn btn-wide', type: 'button', onclick: () => finishTask(task, true, []),
      }, 'Готово')),
    ]));
    return;
  }

  const done = task.exam ? task.examDone + task.done : task.done;
  const total = task.exam ? task.examTotal : task.items.length;
  const share = Math.round((done / Math.max(total, 1)) * 100);
  const passed = share >= EXAM_PASS_SHARE;
  const wrong = task.exam ? task.examWrong.concat(task.mistakes) : [];
  // Обычный шаг закрывается только безошибочным проходом; у экзамена свой порог
  const clean = task.exam ? passed : done === total;

  fill('teacher-task-body', el('div', { class: 'card center' }, [
    el('div', { class: 'today-count' }, ['Верно ', el('b', { text: String(done) }), ` из ${total}`]),
    el('p', { class: 'faint', text: task.exam
      ? (passed ? `Экзамен сдан: ${share} %. Следующий блок открыт.`
        : `Нужно ${EXAM_PASS_SHARE} %, вышло ${share} %. Слова из фраз, где ошибся, вернутся в повторение — приходи снова, попыток сколько угодно.`)
      : done === total ? 'Задание пройдено.'
        : 'Шаг закроется, когда все ответы будут верными — прогони ошибки.' }),
    // Ошибки не должны просто исчезнуть: разбор сразу, пока фраза ещё в голове
    task.mistakes.length && !task.exam ? el('div', { class: 'center' }, el('button', {
      class: 'btn btn-wide', type: 'button', onclick: () => rerunMistakes(task),
    }, `Прогнать ошибки · ${task.mistakes.length}`)) : null,
    el('div', { class: 'center' }, el('button', {
      class: task.mistakes.length && !task.exam ? 'btn btn-quiet btn-wide' : 'btn btn-wide',
      type: 'button', onclick: () => finishTask(task, clean, wrong),
    }, 'Готово')),
  ]));
}

function rerunMistakes(task) {
  const next = Object.assign({}, task, {
    items: task.mistakes, index: 0, done: 0, mistakes: [],
    chosen: [], bank: [], options: null, optionsFor: null, revealed: false,
  });
  state.teacherTask = next;
  if (next.kind === 'build') fillChunkBank(next);
  renderTeacherTask();
  if (next.kind === 'ear') speech.speak(next.items[0].heb);
}

/** Закрытие задания: отметка шага, возврат в день, ошибки экзамена — в повторение. */
async function finishTask(task, clean, wrong) {
  releaseMicrophone();
  speech.stop();
  state.teacherTask = null;
  // Отметка ставится до перерисовки дня: иначе пройденный шаг остался бы без галочки
  if (clean) {
    try {
      await markTeacherStep(task.day, task.step);
    } catch (error) {
      toast('Отметка о шаге не сохранилась: база не отвечает.', true);
    }
  }
  if (wrong.length) await returnExamMistakes(wrong);
  showScreen('teacher-day');
  renderTeacherDay();
}

/**
 * Слова из проваленных фраз возвращаются в повторение уже завтра. Сама оценка забудется,
 * а вот эти слова — нет: их снова спросят.
 */
async function returnExamMistakes(items) {
  const seen = new Set();
  try {
    for (const item of items) {
      for (const key of splitPhrase(item.heb)) {
        const word = wordsByKey().get(key);
        if (!word || seen.has(word.id)) continue;
        seen.add(word.id);
        const previous = state.srs.get(word.id) || createSrsRecord(word.id);
        const updated = applySm2(previous, qualityFromVerdict('wrong'));
        updated.errors += 1;
        state.srs.set(word.id, updated);
        await dbPut(STORE_SRS, updated);
      }
    }
  } catch (error) {
    toast('Ошибки экзамена не записались в повторение: база не отвечает.', true);
  }
  return seen.size;
}

/* ═══════════════════ ПРОВЕРКА ═══════════════════ */

/**
 * Занятие в дневной статистике. Без этого день, проведённый за фразами и словами
 * программы, считался бы прогулом. У просмотра карточек ответа нет — он и не пишется
 * в «верно/неверно», только в число повторений.
 */
function countStudy(task, result) {
  updateDayStats({
    reviewed: 1,
    correct: result === 'correct' ? 1 : 0,
    errors: result === 'wrong' ? 1 : 0,
    mode: `teacher:${task.kind}`,
  }).catch(() => toast('Занятие не записалось в статистику: база не отвечает.', true));
}

/* Перевод сверяем мягко: у слова их бывает несколько через запятую, и годится любой,
   а скобки с уточнением («здравствуйте (мн.)») в ответ никто не переписывает. */
function normalizeAnswer(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^0-9a-zа-я]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

const answerVariants = (text) => String(text || '').split(/[,;/]|\bили\b/)
  .map(normalizeAnswer).filter(Boolean).concat(normalizeAnswer(text));

const matchesAnswer = (typed, expected) => answerVariants(expected).includes(normalizeAnswer(typed));

/**
 * Правильный ответ строкой. У сборки фразы ответ — сама фраза, но ивритский текст
 * в простую строку не пишут (см. ui/word.js), поэтому там показываем чтение: фраза
 * целиком всё равно стоит рядом, в карточке и в разборе.
 */
const rightAnswerText = (task, item) => (task.kind === 'build'
  ? `Правильно: ${item.translit || item.translation}`
  : `Правильно: ${item.translation}`);

/** Честно засчитывает «не знаю»: вопрос уходит в ошибки и вернётся в конце подхода. */
function giveUpTeacherAnswer() {
  const task = state.teacherTask;
  const item = task.items[task.index];
  task.mistakes = task.mistakes.concat(item);
  countStudy(task, 'wrong');
  speech.speak(item.heb);
  renderTeacherTask({ correct: false, answer: '', message: rightAnswerText(task, item), hint: '' });
}

function checkTeacherAnswer(chosen) {
  const task = state.teacherTask;
  const item = task.items[task.index];

  if (task.kind === 'ear' || task.kind === 'recognize') {
    finishAnswer(task, item, chosen === item.translation, {
      answer: chosen, message: rightAnswerText(task, item), hint: '',
    });
    return;
  }

  if (task.kind === 'build') {
    if (!task.chosen.length) { toast('Собери фразу из кусков.'); return; }
    const answer = task.chosen.map((chunk) => chunk.text).join(' ');
    // Разбор объясняет, что именно не так: не то слово или не тот порядок
    const verdict = checkSentence(answer, item.heb);
    finishAnswer(task, item, verdict.ok, {
      answer, message: rightAnswerText(task, item), hint: verdict.text,
    });
    return;
  }

  const field = document.getElementById('teacher-answer');
  const typed = field ? field.value.trim() : '';
  if (!typed) { toast('Напиши перевод по-русски.'); return; }
  finishAnswer(task, item, matchesAnswer(typed, item.translation), {
    answer: typed, message: rightAnswerText(task, item), hint: '',
  });
}

/** Общий хвост любой проверки: счёт, ошибки, звук и перерисовка с разбором. */
function finishAnswer(task, item, correct, feedback) {
  if (correct) task.done += 1;
  else task.mistakes = task.mistakes.concat(item);
  countStudy(task, correct ? 'correct' : 'wrong');
  // Фраза звучит и при верном ответе: ответ дан, самое время услышать, как это говорят
  speech.speak(item.heb);
  renderTeacherTask(Object.assign({ correct }, feedback));
}

/** Разбор правильного ответа по словам: само слово, как читается, что значит.
    Без преподавателя «неверно» само по себе ничему не учит. */
function phraseBreakdown(item) {
  const { words } = buildChunks(item.heb, []);
  if (words.length < 2) return null;   // у одиночного слова разбор повторял бы карточку
  return el('div', { class: 'card', style: 'margin-top:12px' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: 'Разбор' }),
      soundLine(item.heb, 'Послушать'),
    ]),
    item.translit ? el('div', { class: 'sentence-translit translit', style: 'margin-top:8px', text: item.translit }) : null,
    el('div', { class: 'stack', style: 'margin-top:8px' }, words.map((text) => {
      const word = findCourseWord(text);
      return el('div', { class: 'row-between' }, [
        wordLine(text),
        el('span', { class: 'faint', text: word ? `${word.translit} · ${word.translation}` : '' }),
      ]);
    })),
  ]);
}
