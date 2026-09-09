import { setSetting } from '../core/db.js';
import { speech } from '../core/speech.js';
import { dayKey } from '../core/srs.js';
import { state } from '../core/state.js';
import { wordKey } from '../core/translit.js';
import { TEACHER_DAYS } from '../data/teacher-days.js';
import { el, fill, plural, toast } from './dom.js';
import { hardMark } from './hard-mark.js';
import { hardCard } from './hard-screen.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { EXAM_PASS_SHARE, startTeacherExam } from './teacher-tasks.js';
import { runTeacherStep, setPlayAllButton, speakSingleWord, startTeacherReview, teacherDueCount } from './teacher-words.js';
import { hebText, wordLine } from './word.js';

/* ——— Режим учителя: ведение по программе ———
   Тридцать дней подряд, каждый десятый — экзамен. Прогресс по словам общий с обычным
   режимом, но шаги дня программа не пропускает: даже знакомое слово проговаривается
   заново — так же, как это делал бы репетитор.

   Слов на иврите в этом файле нет ни одного жёстко зашитого: программа хранит написание
   с огласовками, словарь — тоже, а сверяются они через wordKey() (согласные без точек).
   Иначе одно слово раздваивалось бы на «с огласовками» и «без».                        */

/* Минуты — прикидка по числу вопросов на шаге, а не круглые числа: раньше «Повторение»
   обещало 12 минут на восемь нажатий, а «Сказать вслух» — 6 на пять записей голоса
   с прослушиванием образца. Человек сверяет обещание с часами и перестаёт верить экрану. */
const TEACHER_STEPS = {
  warmup: { title: 'Повторение', note: 'Начинаем со старого: слова прошлых дней — узнаёшь их по написанию.', minutes: 4 },
  learn: { title: 'Новые слова', note: 'Карточки со звуком: посмотри, послушай и повтори каждое.', minutes: 5 },
  review: { title: 'Повторение', note: 'Слова прошлых дней — те, что пора освежить.', minutes: 4 },
  grammar: { title: 'Правило дня', note: 'Одна структура: почему слова стоят именно так.', minutes: 8 },
  build: { title: 'Собрать фразу', note: 'Из кусков, среди которых есть лишние.', minutes: 6 },
  type: { title: 'Перевести фразу', note: 'Фраза на иврите — пишешь по-русски, что она значит. Без вариантов на выбор.', minutes: 6 },
  ear: { title: 'Фразы на слух', note: 'Только звук, без текста: что тебе сказали?', minutes: 4 },
  speak: { title: 'Сказать вслух', note: 'Прочитай сам, потом сверься с записью.', minutes: 8 },
  listen: { title: 'Слова на слух', note: 'Слова дня без текста: ухо должно узнавать буквы и огласовки, а не глаз.', minutes: 3 },
  dialog: { title: 'Разговор', note: 'Живая сценка: тебе говорят — ты отвечаешь. Слова для неё уже пройдены.', minutes: 8 },
  // Экзаменационный день состоит из одного шага, и называется он так же, как задание
  exam: { title: 'Экзамен', note: 'Три части подряд: понять на слух, собрать фразу, перевести.', minutes: 20 },
};

/** Какие задания открыты в этот день: сложное подключается, когда набран запас слов. */
function teacherStepsFor(entry) {
  if (entry.kind === 'exam') return ['exam'];
  const words = entry.words || [];
  const phrases = entry.phrases || [];
  const steps = [];
  if (entry.day >= 2 && words.length) steps.push('warmup');
  if (words.length) steps.push('learn');
  else steps.push('review');
  if (entry.lesson) steps.push('grammar');
  if (entry.day >= 4 && phrases.length) steps.push('build');
  if (entry.day >= 11 && phrases.length) steps.push('type');
  if (phrases.length) steps.push('ear', 'speak');
  steps.push('listen');
  // Сценка ставится в тот день, к которому пройдено большинство её слов (.work/plan-dialogs.mjs)
  if (entry.dialog) steps.push('dialog');
  return steps;
}

/* ——— Программа и словарь: сверка по ключу слова ——— */

/** Ключи всех слов, которые курс успел дать до этого дня. */
function courseKeysBefore(day) {
  const keys = new Set();
  TEACHER_DAYS.filter((entry) => entry.day < day)
    .forEach((entry) => (entry.words || []).forEach((heb) => {
      const key = wordKey(heb);
      if (key) keys.add(key);
    }));
  return keys;
}

/** Слово программы в словаре. Строки не сравниваем: у одного слова две записи —
    с огласовками и без, а ключ у них общий. */
let courseWordIndex = new Map();
let courseWordIndexSource = null;

/** Указатель «ключ → слово». Пересобирается, когда список слов сменился целиком. */
function courseWordsByKey() {
  if (courseWordIndexSource !== state.words) {
    courseWordIndex = new Map();
    // Ключ у записи уже посчитан при заливке (core/db.js) — пересчитывать его на каждый
    // поиск значило бы гонять разбор письма по всему словарю на каждое слово дня
    state.words.forEach((word) => {
      const key = word.key || wordKey(word.heb);
      if (key && !courseWordIndex.has(key)) courseWordIndex.set(key, word);
    });
    courseWordIndexSource = state.words;
  }
  return courseWordIndex;
}

export function wordByHeb(heb) {
  const key = wordKey(heb);
  if (!key) return null;
  return courseWordsByKey().get(key) || null;
}

/** Все слова, пройденные курсом до этого дня — из них берём и повторение, и лишние куски. */
export function teacherWordsBefore(day) {
  const keys = courseKeysBefore(day);
  return state.words.filter((word) => keys.has(wordKey(word.heb)));
}

/** Слово этого дня уже давали раньше — значит это не новое, а возврат. Подписываем прямо
    на карточке, иначе повтор читается как «опять что-то незнакомое». */
function seenEarlier(entry, heb) {
  return courseKeysBefore(entry.day).has(wordKey(heb));
}

/* ——— Прогресс курса ——— */

export const teacherDay = (day) => TEACHER_DAYS.find((entry) => entry.day === day) || null;

/**
 * Отметки курса: какой день сейчас, что в каком дне сделано, когда начали и когда
 * заходили в последний раз. Старая запись могла быть неполной — недостающее подставляем,
 * иначе отметка шага падала бы на пустом объекте.
 */
export function teacherProgress() {
  const saved = state.teacher || {};
  return closeFullDays({
    day: saved.day || 1,
    steps: saved.steps || {},
    startedAt: saved.startedAt || null,
    // Копия, а не ссылка: пересчёт ниже дописывает дни, и без копии он молча правил бы
    // сохранённую запись — состояние менялось бы там, где его только читают
    finishedDays: (saved.finishedDays || []).slice(),
    lastDay: saved.lastDay || null,
    returned: Boolean(saved.returned),
  });
}

/**
 * Досчитывает закрытые дни по отметкам шагов. Обычно это делает `markTeacherStep`, но
 * отметки приезжают и со стороны: при импорте базы шаги одного дня сливаются с двух
 * устройств, и день оказывается собран целиком, хотя ни одна отметка на этом устройстве
 * не ставилась. Без пересчёта день висел бы как незакрытый, а следующий — запертым.
 */
function closeFullDays(progress) {
  TEACHER_DAYS.forEach((entry) => {
    const done = teacherStepsFor(entry).every((step) => (progress.steps[entry.day] || {})[step]);
    if (!done || progress.finishedDays.includes(entry.day)) return;
    progress.finishedDays.push(entry.day);
    if (progress.day === entry.day && entry.day < TEACHER_DAYS.length) progress.day = entry.day + 1;
  });
  progress.finishedDays.sort((first, second) => first - second);
  return progress;
}

/** Отметки хранятся по дню и шагу: «день 3, слова» — сделано. */
export function teacherStepDone(day, step) {
  const progress = teacherProgress();
  return Boolean((progress.steps[day] || {})[step]);
}

export async function markTeacherStep(day, step) {
  const progress = teacherProgress();
  progress.steps[day] = Object.assign({}, progress.steps[day], { [step]: true });
  if (!progress.startedAt) progress.startedAt = dayKey();
  // Возвращение после перерыва — отдельная награда: бросают обычно именно здесь
  if (daysAway(progress.lastDay) >= 3) progress.returned = true;
  progress.lastDay = dayKey();

  const entry = teacherDay(day);
  const all = entry && teacherStepsFor(entry).every((item) => (progress.steps[day] || {})[item]);
  if (all && !progress.finishedDays.includes(day)) {
    progress.finishedDays.push(day);
    if (progress.day === day && day < TEACHER_DAYS.length) progress.day = day + 1;
  }
  state.teacher = progress;

  try {
    await setSetting('teacher', progress);
  } catch {
    // Отметка на экране уже стоит, но до перезагрузки она не доживёт — про это надо сказать
    toast('Отметку занятия не удалось сохранить: браузер не дал записать данные. '
      + 'Проверь, что для сайта разрешено хранение.', true);
  }

  if (state.screen === 'teacher-day') renderTeacherDay();
  renderTeacher();
}

/** Сколько дней курса позади и сколько осталось — для шкалы и подписи. */
/**
 * Следующий шаг занятия — то единственное, что предлагается сделать прямо сейчас.
 * Главная спрашивает об этом курс, а не считает сама: правила «какие шаги есть у дня»
 * живут здесь и в одном экземпляре.
 * @returns {null|{day: number, title: string, step: string|null, stepTitle: string,
 *   note: string, done: number, total: number, finished: boolean, exam: boolean}}
 */
export function nextTeacherStep() {
  const progress = teacherProgress();
  const entry = teacherDay(Math.min(progress.day, TEACHER_DAYS.length));
  if (!entry) return null;
  const steps = teacherStepsFor(entry);
  const done = steps.filter((step) => (progress.steps[entry.day] || {})[step]).length;
  const step = steps.find((item) => !(progress.steps[entry.day] || {})[item]) || null;
  const info = TEACHER_STEPS[step] || {};
  return {
    day: entry.day,
    title: entry.title,
    step,
    stepTitle: info.title || 'День пройден',
    note: info.note || 'Все задания этого дня сделаны.',
    done,
    total: steps.length,
    finished: !step,
    exam: entry.kind === 'exam',
    // Весь курс пройден: последний день закрыт и следующего нет
    courseOver: !step && entry.day >= TEACHER_DAYS.length,
  };
}

export function teacherSummary() {
  const progress = teacherProgress();
  const done = progress.finishedDays.length;
  return {
    done,
    total: TEACHER_DAYS.length,
    left: TEACHER_DAYS.length - done,
    current: Math.min(progress.day, TEACHER_DAYS.length),
    started: progress.startedAt,
    away: daysAway(progress.lastDay),
  };
}

/** Сколько дней человек не заходил. Курс от перерыва не сдвигается и не сгорает —
    просто предупреждаем и предлагаем сперва освежить пройденное. */
function daysAway(lastDay) {
  if (!lastDay) return 0;
  const gap = Math.round((new Date(dayKey()) - new Date(lastDay)) / 86400000);
  return gap > 1 ? gap : 0;
}

/* ——— Экран курса: тридцать дней списком ——— */

export function renderTeacher() {
  const summary = teacherSummary();
  const share = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
  const children = [
    el('div', { class: 'card' }, [
      el('div', { class: 'row-between' }, [
        el('b', { text: `День ${summary.current} из ${summary.total}` }),
        el('span', { class: 'faint', text: summary.left
          ? `осталось ${summary.left} ${plural(summary.left, 'день', 'дня', 'дней')}`
          : 'курс пройден' }),
      ]),
      el('div', { class: 'progress-line' }, el('span', { style: `width:${share}%` })),
      el('p', { class: 'faint',
        text: 'Час в день: новые слова, правило, фразы на слух и вслух. Каждый десятый день — экзамен.' }),
    ]),
  ];

  // Пропуск — обычное дело. Ни серия, ни день не сгорают: предлагаем сперва освежить
  if (summary.away && summary.done) {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: `Перерыв ${summary.away} ${plural(summary.away, 'день', 'дня', 'дней')}` }),
      el('p', { class: 'faint', text: 'Ничего не пропало, день остался тот же. Начни с повторения — '
        + 'вернём то, что подзабылось, и пойдём дальше.' }),
      el('button', { class: 'btn btn-small', type: 'button',
        onclick: () => startTeacherReview(teacherDay(summary.current), false) }, 'Освежить пройденное'),
    ]));
  }

  const current = teacherDay(summary.current);
  if (current) {
    // Название дня в подпись кнопки не вставляем: «Заниматься · Здравствуйте и до свидания»
    // не влезает в строку, кнопка распухает на две и перестаёт быть капсулой.
    // Название дня и так стоит рядом — в заголовке карточки и в списке.
    children.push(el('button', {
      class: 'btn btn-wide teacher-go', type: 'button',
      onclick: () => openTeacherDay(current.day),
    }, summary.done >= summary.total ? 'Повторить последний день' : 'Заниматься'));
  }

  children.push(el('h3', { text: 'Программа' }));
  const progress = teacherProgress();
  children.push(el('div', {}, TEACHER_DAYS.map((entry) => {
    const done = progress.finishedDays.includes(entry.day);
    const isCurrent = entry.day === summary.current;
    const locked = entry.day > summary.current;
    const words = (entry.words || []).length;
    const phrases = (entry.phrases || []).length;
    return el('button', {
      class: `lesson-row${isCurrent ? ' is-current' : ''}`, type: 'button', disabled: locked,
      onclick: () => openTeacherDay(entry.day),
    }, [
      el('span', { class: 'faint', text: String(entry.day) }),
      el('span', { class: 'lesson-title' }, [
        el('div', { text: entry.title }),
        el('div', { class: 'faint', text: entry.kind === 'exam'
          ? `${phrases} ${plural(phrases, 'фраза', 'фразы', 'фраз')} на проверку`
          : words ? `${words} ${plural(words, 'новое слово', 'новых слова', 'новых слов')}`
          : 'повторение пройденного' }),
      ]),
      done ? el('span', { class: 'badge badge-ok', text: 'пройден' })
        : locked ? el('span', { class: 'badge' }, uiIcon('lock', 16))
        : el('span', { class: 'badge', text: isCurrent ? 'сегодня' : 'открыт' }),
    ]);
  })));

  fill('teacher-body', children);
}

/* ——— Экран одного дня: слова и шаги ——— */

export function openTeacherDay(day) {
  state.teacherDay = day;
  showScreen('teacher-day');
  renderTeacherDay();
}

export function renderTeacherDay() {
  const entry = teacherDay(state.teacherDay);
  if (!entry) { showScreen('teacher'); return; }

  document.getElementById('teacher-day-heading').textContent = `День ${entry.day} · ${entry.title}`;
  const steps = teacherStepsFor(entry);
  const words = entry.words || [];
  const children = [];

  if (entry.kind === 'exam') {
    const passed = courseKeysBefore(entry.day).size;
    const phrases = (entry.phrases || []).length;
    children.push(el('div', { class: 'card' }, [
      el('b', { text: 'Экзамен' }),
      el('p', { class: 'faint', text: `${phrases} ${plural(phrases, 'фраза', 'фразы', 'фраз')} `
        + `из пройденного (${passed} ${plural(passed, 'слово', 'слова', 'слов')} позади). `
        + 'Три части: понять на слух, собрать фразу из кусков и перевести её. '
        + `Порог — ${EXAM_PASS_SHARE} %; слова из фраз, где ошибёшься, вернутся в повторение.` }),
      el('button', { class: 'btn btn-wide', type: 'button',
        onclick: () => startTeacherExam(entry) }, 'Начать экзамен'),
    ]));
    fill('teacher-day-body', children);
    return;
  }

  // Шапка дня: сколько шагов позади и на сколько примерно времени всё занятие
  const doneSteps = steps.filter((step) => teacherStepDone(entry.day, step)).length;
  const minutes = steps.reduce((sum, step) => sum + TEACHER_STEPS[step].minutes, 0);
  children.push(el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: `Сделано ${doneSteps} из ${steps.length}` }),
      el('span', { class: 'faint',
        text: `примерно ${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}` }),
    ]),
    el('div', { class: 'progress-line', style: 'margin:10px 0 0' },
      el('span', { style: `width:${Math.round((doneSteps / steps.length) * 100)}%` })),
  ]));

  if (words.length) children.push(el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: 'Слова дня' }),
      // Обработчик вешает setPlayAllButton — он же меняет кнопку на «Остановить».
      // Без голоса и без записей нажимать не на что, поэтому вместо кнопки — объяснение
      speech.available
        ? el('button', { class: 'btn btn-quiet btn-small', type: 'button', id: 'day-play-all' },
          iconLabel('sound', 'Прослушать все'))
        : el('span', { class: 'faint', text: 'звука нет: в системе не найден ивритский голос' }),
    ]),
    el('div', { class: 'day-words' }, words.map((heb) => {
      const word = wordByHeb(heb);
      const card = el('button', {
        // Нажал — услышал (разбор слова живёт в разделе «Слова»)
        class: 'day-word', type: 'button', 'aria-label': `Послушать ${hebText(heb)}`,
        dataset: { heb },
        onclick: () => speakSingleWord(heb),
      }, [
        wordLine(heb, 'day-word-heb'),
        el('span', { class: 'translit', text: word ? word.translit : '' }),
        el('span', { class: 'faint', text: word ? word.translation : '' }),
        !word ? el('span', { class: 'word-note', text: 'нет в словаре' })
          : seenEarlier(entry, heb) ? el('span', { class: 'word-note', text: 'уже было раньше' })
          : null,
      ]);
      // Кружок в углу: слово дня можно сразу отправить в трудные, не дожидаясь тренировки.
      // Обёртка нужна, чтобы кнопка не оказалась внутри кнопки
      if (!word) return card;
      return el('div', { class: 'day-word-slot' }, [card, hardMark(word, 'card-mark')]);
    })),
  ]));

  steps.forEach((step) => {
    const info = TEACHER_STEPS[step];
    const done = teacherStepDone(entry.day, step);
    const due = step === 'warmup' ? teacherDueCount(entry) : 0;
    children.push(el('div', { class: `card${done ? ' is-ok' : ''}` }, [
      el('div', { class: 'row-between' }, [
        el('b', { text: info.title }),
        done ? el('span', { class: 'badge badge-ok', text: 'сделано' })
          : due ? el('span', { class: 'badge', text: `${due} ${plural(due, 'слово', 'слова', 'слов')} ждёт` })
          : null,
      ]),
      el('p', { class: 'faint', text: info.note }),
      // Кнопки шага — во flex-строке: у кнопки со значком другая базовая линия,
      // и рядом с обычной она встаёт на другом уровне
      el('div', { class: 'step-actions' }, [
        el('button', {
          class: done ? 'btn btn-quiet btn-small' : 'btn btn-small', type: 'button',
          onclick: () => runTeacherStep(entry, step),
        }, done ? 'Пройти ещё раз' : 'Начать'),
      ]),
    ]));
  });

  // Трудные слова идут отдельным блоком в самом низу: день закрывается и без них
  const hard = hardCard('teacher-day');
  if (hard) {
    children.push(el('h3', { text: 'Не по программе' }));
    children.push(hard);
  }

  fill('teacher-day-body', children);
  if (speech.available) setPlayAllButton(false, words);
}
