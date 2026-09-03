import { CHART_DAYS, EXAM_PASS_SCORE, EXAM_QUESTION_COUNT, EXAM_READY_RATIO, FINAL_EXAM_LEVEL, FINAL_EXAM_QUESTIONS, FINAL_EXAM_RATIO, MAX_LEVEL } from '../core/constants.js';
import { examReadiness, finalExamReadiness, troubleWords } from '../core/modes.js';
import { addDays, dayKey, isLearned, isStarted } from '../core/srs.js';
import { ACHIEVEMENTS, achievementFacts, calcStreak } from '../core/stats.js';
import { state } from '../core/state.js';
import { el, fill } from './dom.js';
import { wordLine } from './word.js';
import { iconLabel, uiIcon } from './icons.js';
import { renderMastery } from './mastery.js';
import { renderPlayerCard } from './rank.js';
import { topicIcon } from './topic-icons.js';
import { beginExam, beginTroubleRun } from './train.js';

/* ——— Раздел «Прогресс»: график, экзамены, достижения ———
   Вынесен из core/stats.js: там он был чужим — рисование экранов в слое логики
   (аудит 03.09.2026). В core остались только счётчики и факты для достижений.      */

function renderChart() {
  const today = dayKey();
  const days = [];
  for (let offset = CHART_DAYS - 1; offset >= 0; offset -= 1) {
    const key = addDays(today, -offset);
    days.push({ key, value: (state.stats.get(key) || {}).learned || 0 });
  }
  const maximum = Math.max(1, ...days.map((day) => day.value));
  const width = 320;
  const height = 120;
  const gap = 2;
  const barWidth = (width - gap * (CHART_DAYS - 1)) / CHART_DAYS;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height + 16}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `График выученных слов за ${CHART_DAYS} дней`);

  // Столбики красим акцент-градиентом дизайн-системы — он живёт в defs самого SVG.
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  gradient.setAttribute('id', 'chart-gradient');
  gradient.setAttribute('x1', '0'); gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '0'); gradient.setAttribute('y2', '1');
  [['0%', '#a78bfa'], ['100%', '#60a5fa']].forEach(([offset, color]) => {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    gradient.append(stop);
  });
  defs.append(gradient);
  svg.append(defs);

  days.forEach((day, index) => {
    const barHeight = day.value ? Math.max(2, (day.value / maximum) * height) : 1;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(index * (barWidth + gap)));
    rect.setAttribute('y', String(height - barHeight));
    rect.setAttribute('width', String(barWidth));
    rect.setAttribute('height', String(barHeight));
    rect.setAttribute('rx', '1');
    if (!day.value) rect.setAttribute('opacity', '0.25');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${day.key}: ${day.value}`;
    rect.append(title);
    svg.append(rect);
  });

  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  axis.setAttribute('class', 'chart-axis');
  axis.setAttribute('x1', '0'); axis.setAttribute('y1', String(height));
  axis.setAttribute('x2', String(width)); axis.setAttribute('y2', String(height));
  svg.append(axis);

  const labelLeft = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  labelLeft.setAttribute('x', '0'); labelLeft.setAttribute('y', String(height + 12));
  labelLeft.textContent = `${CHART_DAYS} дней назад`;
  const labelRight = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  labelRight.setAttribute('x', String(width)); labelRight.setAttribute('y', String(height + 12));
  labelRight.setAttribute('text-anchor', 'end');
  labelRight.textContent = 'сегодня';
  svg.append(labelLeft, labelRight);
  return svg;
}

/* ——— Экзамены: видно все, включая закрытые, и что нужно для допуска ——— */

/**
 * Экзамены уровней — внутренняя проверка приложения, а не экзамен ульпана: они закрепляют то,
 * что пройдено здесь. Итоговый экзамен собирает все уровни разом и потому строже.
 */
function examPlan() {
  return [1, 2, 3].map((level) => {
    const readiness = examReadiness(level);
    const record = state.exams.get(level);
    const previousPassed = level === 1 || (state.exams.get(level - 1) || {}).passed;
    return {
      level,
      title: `Экзамен уровня ${level}`,
      questions: EXAM_QUESTION_COUNT,
      pass: EXAM_PASS_SCORE,
      readiness,
      record,
      previousPassed,
      unlocked: Boolean(previousPassed) && readiness.allowed,
    };
  });
}

function renderExams() {
  const children = [
    el('p', { class: 'muted', text: 'Это внутренние экзамены приложения: они проверяют слова, которые ты здесь прошёл. К официальным экзаменам ульпана отношения не имеют.' }),
  ];

  examPlan().forEach((exam) => {
    const needed = Math.ceil(exam.readiness.total * EXAM_READY_RATIO);
    const percent = exam.readiness.total ? Math.round((exam.readiness.ready / exam.readiness.total) * 100) : 0;
    const card = el('div', { class: exam.unlocked ? 'card exam-card' : 'card exam-card is-locked' }, [
      el('div', { class: 'row-between' }, [
        el('b', { class: 'exam-title' }, exam.unlocked ? [el('span', { text: exam.title })] : iconLabel('lock', exam.title)),
        exam.record
          ? el('span', { class: exam.record.passed ? 'badge badge-ok' : 'badge badge-err',
              text: exam.record.passed ? `сдан ${exam.record.score}/${exam.record.total}` : `не сдан ${exam.record.score}/${exam.record.total}` })
          : el('span', { class: 'badge', text: `${exam.questions} вопросов` }),
      ]),
      el('div', { class: 'level-bar' }, el('span', { style: `width:${percent}%` })),
      el('p', { class: 'faint', text: `Закреплено слов: ${exam.readiness.ready} из ${exam.readiness.total}. Для допуска нужно ${needed}. Слово закрепляется после двух верных повторений.` }),
      el('div', { class: exam.previousPassed ? 'exam-requirement is-done' : 'exam-requirement' }, [
        el('span', { class: 'exam-mark' }, exam.previousPassed ? uiIcon('check', 14) : el('span', { text: '·' })),
        el('span', { text: exam.level === 1 ? 'Уровень открыт с самого начала' : `Сдан экзамен уровня ${exam.level - 1}` }),
      ]),
      el('div', { class: exam.readiness.allowed ? 'exam-requirement is-done' : 'exam-requirement' }, [
        el('span', { class: 'exam-mark' }, exam.readiness.allowed ? uiIcon('check', 14) : el('span', { text: '·' })),
        el('span', { text: `Закрепить ${needed} слов уровня ${exam.level}` }),
      ]),
    ]);

    if (exam.unlocked) {
      card.append(el('button', {
        class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
        onclick: () => beginExam(exam.level),
      }, exam.record && exam.record.passed ? 'Пересдать' : 'Сдавать'));
    }
    children.push(card);
  });

  // Итоговый экзамен — единственный, который претендует на серьёзность
  const finalReadiness = finalExamReadiness();
  const finalRecord = state.exams.get(FINAL_EXAM_LEVEL);
  const finalCard = el('div', { class: finalReadiness.allowed ? 'card exam-card' : 'card exam-card is-locked' }, [
    el('div', { class: 'row-between' }, [
      el('b', { class: 'exam-title' }, finalReadiness.allowed ? [el('span', { text: 'Итоговый экзамен' })] : iconLabel('lock', 'Итоговый экзамен')),
      finalRecord
        ? el('span', { class: finalRecord.passed ? 'badge badge-ok' : 'badge badge-err',
            text: `${finalRecord.score}/${finalRecord.total}` })
        : el('span', { class: 'badge', text: `${FINAL_EXAM_QUESTIONS} вопросов` }),
    ]),
    el('p', { class: 'faint', text: `Все уровни разом, ${FINAL_EXAM_QUESTIONS} вопросов вперемешку, проходной балл — ${Math.round(FINAL_EXAM_RATIO * 100)}% (${Math.ceil(FINAL_EXAM_QUESTIONS * FINAL_EXAM_RATIO)} правильных). Здесь спрашивают и перевод, и написание слова, и чтение на слух.` }),
    el('div', { class: finalReadiness.allowed ? 'exam-requirement is-done' : 'exam-requirement' }, [
      el('span', { class: 'exam-mark' }, finalReadiness.allowed ? uiIcon('check', 14) : el('span', { text: '·' })),
      el('span', { text: `Сдать экзамены всех трёх уровней (сдано ${finalReadiness.passedLevels} из ${MAX_LEVEL})` }),
    ]),
  ]);
  if (finalReadiness.allowed) {
    finalCard.append(el('button', {
      class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
      onclick: () => beginExam(FINAL_EXAM_LEVEL),
    }, finalRecord && finalRecord.passed ? 'Пересдать' : 'Сдавать итоговый'));
  }
  children.push(finalCard);

  fill('progress-body', children);
}

/* ——— Достижения ——— */

function renderAchievements() {
  const facts = achievementFacts();
  const earned = ACHIEVEMENTS.filter((item) => item.check(facts));
  const children = [
    renderPlayerCard(),
    el('h2', { text: 'Достижения' }),
    el('p', { class: 'muted', text: `Получено ${earned.length} из ${ACHIEVEMENTS.length}. Остальные видны сразу — чтобы понимать, к чему идти.` }),
    el('div', { class: 'badge-grid' }, ACHIEVEMENTS.map((item) => {
      const done = item.check(facts);
      return el('div', { class: done ? 'achievement' : 'achievement is-locked' }, [
        topicIcon(item.icon, 40),
        el('div', { class: 'achievement-name', text: item.name }),
        el('div', { class: 'achievement-note', text: done ? 'получено' : item.note }),
      ]);
    })),
  ];
  fill('progress-body', children);
}

export function switchProgressTab(tab) {
  state.progressTab = tab;
  document.querySelectorAll('[data-progress-tab]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.progressTab === tab));
  });
  const titles = { stats: 'Прогресс', exams: 'Экзамены', awards: 'Достижения',
    mastery: 'Изученные слова' };
  document.getElementById('progress-heading').textContent = titles[tab];
  if (tab === 'stats') renderProgress();
  else if (tab === 'exams') renderExams();
  else if (tab === 'mastery') renderMastery();
  else renderAchievements();
}

function renderProgress() {
  const learned = state.words.filter((word) => isLearned(state.srs.get(word.id))).length;
  const started = state.words.filter((word) => {
    const record = state.srs.get(word.id);
    return isStarted(record) && !isLearned(record);
  }).length;
  const fresh = state.words.length - learned - started;
  const streak = calcStreak();
  const today = state.stats.get(dayKey()) || { reviewed: 0, errors: 0 };
  const trouble = troubleWords(10);

  const children = [
    el('div', { class: 'card center' }, [
      el('div', { class: 'today-count' }, el('b', { text: String(streak) })),
      el('div', { class: 'muted', text: streak === 0 ? 'дней подряд — начни сегодня'
        : streak === 1 ? 'день подряд' : 'дней подряд' }),
      el('p', { class: 'faint', text: `Сегодня: ${today.reviewed} повторений, ошибок ${today.errors}` }),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, [
        el('div', {}, [el('b', { text: String(learned) }), el('span', { text: 'выучено' })]),
        el('div', {}, [el('b', { text: String(started) }), el('span', { text: 'в работе' })]),
        el('div', {}, [el('b', { text: String(fresh) }), el('span', { text: 'не начато' })]),
      ]),
    ]),
    el('h2', { text: 'Выучено по дням' }),
    el('div', { class: 'card' }, renderChart()),
    el('h2', { text: 'Чаще всего ошибаешься' }),
  ];

  if (!trouble.length) {
    children.push(el('p', { class: 'faint', text: 'Ошибок пока нет — список появится, когда будут.' }));
  } else {
    children.push(el('div', {}, trouble.map((word) => {
      const record = state.srs.get(word.id);
      return el('div', { class: 'word-row' }, [
        wordLine(word.heb),
        el('span', { class: 'word-meta' }, [
          el('div', { class: 'word-translit', text: word.translit }),
          el('div', { class: 'word-translation', text: word.translation }),
        ]),
        el('span', { class: 'badge badge-err', text: `${record.errors + record.stressErrors}` }),
      ]);
    })));
    children.push(el('button', {
      class: 'btn btn-wide', type: 'button', style: 'margin-top:16px', onclick: beginTroubleRun,
    }, 'Прогнать только их'));
  }

  fill('progress-body', children);
}
