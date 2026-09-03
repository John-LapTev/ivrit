import { dueWords } from '../core/modes.js';
import { dayKey } from '../core/srs.js';
import { state } from '../core/state.js';
import { el, fill } from './dom.js';
import { uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { teacherDay, teacherSummary } from './teacher-course.js';
import { beginTraining } from './train.js';

/* ——— Занятие дня ———
   Просьба владельца: одна кнопка на случай, когда нет времени выбирать самому.
   Новых механик занятие не вводит: это список дел с отметками, а сами дела
   открывают уже существующие режимы. Отметка ставится по факту, из сегодняшних данных. */

/** Сколько карточек отвечено сегодня — по дневной статистике. */
function answeredToday() {
  return (state.stats.get(dayKey()) || {}).reviewed || 0;
}

const DAILY_GOALS = {
  words: 10,
};

/** Дела дня: что открыть и как понять, что дело сделано. */
function dailySteps() {
  return [
    {
      id: 'words',
      title: 'Слова',
      note: dueWords().length
        ? `${Math.min(dueWords().length, state.sessionLimit)} карточек по срокам повторения.`
        : 'Повторить пройденное — на интервалы это не повлияет.',
      done: answeredToday() >= DAILY_GOALS.words,
      progress: `${Math.min(answeredToday(), DAILY_GOALS.words)} / ${DAILY_GOALS.words}`,
      start: () => { beginTraining(); },
    },
  ];
}

/* ——— Программа занятий на главной ———
   Единственная карточка со своим знаком: с неё начинают, и она должна быть заметна
   среди обычных белых островов. */
export function renderTeacherCard() {
  const summary = teacherSummary();
  const started = Boolean(state.teacher);
  const current = teacherDay(summary.current);
  fill('teacher-card', el('div', { class: 'card teacher-home' }, [
    el('div', { class: 'teacher-home-top' }, [
      el('span', { class: 'teacher-figure' }, uiIcon('cap', 30)),
      el('div', { class: 'teacher-home-text' }, [
        el('div', { class: 'row-between' }, [
          el('b', { text: 'Программа занятий' }),
          el('span', { class: 'faint', text: started
            ? `день ${summary.current} из ${summary.total}` : 'месяц по порядку' }),
        ]),
        el('p', { class: 'faint', style: 'margin:6px 0 0', text: started
          ? (current ? current.title : 'курс пройден')
          : 'Каждый день своё: новые слова, правило, фразы на слух и вслух. '
            + 'Ведёт по порядку и ничего не пропускает.' }),
      ]),
    ]),
    el('button', { class: 'btn btn-wide', type: 'button', style: 'margin-top:14px',
      onclick: () => showScreen('teacher') }, started ? 'Продолжить' : 'Открыть программу'),
  ]));
}

export function renderDailyCard() {
  const steps = dailySteps();
  const doneCount = steps.filter((step) => step.done).length;

  fill('daily-card', el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: 'Занятие дня' }),
      el('span', { class: 'faint', text: doneCount === steps.length
        ? 'всё сделано' : `${doneCount} из ${steps.length}` }),
    ]),
    el('div', { class: 'daily-steps' }, steps.map((step) => el('button', {
      class: `daily-step${step.done ? ' is-done' : ''}`, type: 'button',
      onclick: step.start,
    }, [
      el('span', { class: 'daily-mark' }, step.done ? uiIcon('check', 15) : null),
      el('span', { class: 'daily-text' }, [
        el('div', { text: step.title }),
        el('div', { class: 'faint', text: step.note }),
      ]),
      el('span', { class: 'faint', text: step.progress }),
    ]))),
  ]));
}
