import { EXAM_READY_RATIO, MAX_LEVEL } from '../core/constants.js';
import { MODES, dueWords, examReadiness, isWordAvailable, wordsOfLevel } from '../core/modes.js';
import { speech } from '../core/speech.js';
import { isLearned, isStarted } from '../core/srs.js';
import { state } from '../core/state.js';
import { renderDailyCard, renderTeacherCard } from './daily.js';
import { el, fill, plural } from './dom.js';
import { hardCard } from './hard-screen.js';
import { ALL_TOPICS } from './icons.js';
import { showScreen } from './screens.js';
import { topicIcon } from './topic-icons.js';

/* ——— Главная ——— */

export function renderHome() {
  const due = dueWords();
  document.getElementById('due-count').textContent = String(due.length);
  const hint = document.getElementById('due-hint');
  const startButton = document.getElementById('start-btn');

  if (due.length) {
    // Разделяем: повторение — то, что уже видел, остальное просто новое.
    // Раньше счётчик показывал сумму, и «138 к повторению» пугало на первом же дне.
    const started = due.filter((word) => isStarted(state.srs.get(word.id))).length;
    const fresh = due.length - started;
    document.getElementById('due-count').textContent = String(started || fresh);
    const label = document.getElementById('due-label');
    if (label) label.textContent = started ? plural(started, 'слово', 'слова', 'слов')
      : plural(fresh, 'новое слово', 'новых слова', 'новых слов');
    const heading = document.getElementById('due-heading');
    if (heading) heading.textContent = started ? 'Сегодня к повторению' : 'Готово к изучению';
    hint.textContent = started && fresh
      ? `В сессию попадёт ${Math.min(due.length, state.sessionLimit)}: сперва повторение, `
        + `потом новые (их ждёт ещё ${fresh}).`
      : `В сессию попадёт ${Math.min(due.length, state.sessionLimit)} — это минут на десять.`;
    startButton.textContent = 'Начать';
    startButton.disabled = false;
  } else {
    hint.textContent = 'На сегодня всё. Можно прогнать пройденное — на интервалы это не повлияет.';
    startButton.textContent = 'Повторить пройденное';
    startButton.disabled = state.words.filter((word) => isStarted(state.srs.get(word.id))).length === 0;
  }

  renderTeacherCard();
  renderDailyCard();
  // Раздел трудных слов виден, только когда есть что повторять — иначе пустая карточка
  fill('hard-card', hardCard('home'));
  renderModeGrid();
  renderTopicFilter();
  renderLevelCard();
}

function renderModeGrid() {
  const grid = fill('mode-grid', MODES.map((mode) => {
    const blocked = mode.needsVoice && !speech.available;
    return el('button', {
      class: 'mode-btn', type: 'button',
      'aria-pressed': state.mode === mode.id,
      disabled: blocked,
      title: blocked ? 'Нужен ивритский голос в системе' : mode.description,
      onclick: () => { state.mode = mode.id; renderModeGrid(); },
    }, [el('span', { class: 'mode-icon heb', text: mode.icon }), el('span', { text: mode.title })]);
  }));
  const active = MODES.find((mode) => mode.id === state.mode);
  const missingVoice = MODES.some((mode) => mode.needsVoice) && !speech.available;
  document.getElementById('mode-description').textContent = missingVoice
    ? `${active.description} Режимы со звуком выключены: в системе нет ивритского голоса.`
    : active.description;
  return grid;
}

export function allTopics() {
  const topics = new Set(state.words.map((word) => word.topic).filter(Boolean));
  return [ALL_TOPICS].concat(Array.from(topics).sort());
}

/** Темы плиткой с рисованными иконками: лента чипов обрезалась и прятала половину тем. */
function renderTopicFilter() {
  const grid = el('div', { class: 'topic-grid' }, allTopics().map((topic) => {
    const inTopic = (word) => topic === ALL_TOPICS || word.topic === topic;
    const open = state.words.filter((word) => inTopic(word) && isWordAvailable(word)).length;
    const locked = state.words.filter((word) => inTopic(word) && !isWordAvailable(word)).length;
    return el('button', {
      class: 'topic-tile', type: 'button', 'aria-pressed': state.topic === topic,
      onclick: () => { state.topic = topic; renderHome(); },
    }, [
      topicIcon(topic),
      el('span', {}, [
        el('div', { class: 'topic-name', text: topic }),
        el('div', { class: 'topic-count', text: open === 0 && locked > 0
          ? `${locked} слов, откроются позже`
          : locked > 0 ? `${open} слов, ещё ${locked} закрыто` : `${open} слов` }),
      ]),
    ]);
  }));
  fill('topic-filter', grid);
}

function renderLevelCard() {
  const level = state.unlockedLevel;
  const words = wordsOfLevel(level);
  const learned = words.filter((word) => isLearned(state.srs.get(word.id))).length;
  const readiness = examReadiness(level);
  const examRecord = state.exams.get(level);
  const percent = words.length ? Math.round((learned / words.length) * 100) : 0;

  const children = [
    el('div', { class: 'row-between' }, [
      el('b', { text: `Уровень ${level}` }),
      el('span', { class: 'faint', text: `выучено ${learned} из ${words.length}` }),
    ]),
    el('div', { class: 'level-bar' }, el('span', { style: `width:${percent}%` })),
  ];

  if (examRecord) {
    children.push(el('p', { class: 'faint' }, [
      el('span', { class: examRecord.passed ? 'badge badge-ok' : 'badge badge-err',
        text: examRecord.passed ? 'экзамен сдан' : 'экзамен не сдан' }),
      ` ${examRecord.score} из ${examRecord.total}, ${examRecord.date}`,
    ]));
  }
  children.push(el('p', { class: 'faint', text: readiness.allowed
    ? 'Слова уровня закреплены — экзамен открыт.'
    : `К экзамену закреплено ${readiness.ready} из ${readiness.total} слов (нужно ${Math.ceil(readiness.total * EXAM_READY_RATIO)}).` }));
  if (level < MAX_LEVEL) {
    const locked = state.words.filter((word) => word.level > state.unlockedLevel).length;
    children.push(el('p', { class: 'faint', text: `Слов на следующих уровнях: ${locked} — откроются после экзамена.` }));
  }
  children.push(el('button', {
    class: 'btn btn-quiet btn-wide', type: 'button', style: 'margin-top:12px',
    onclick: () => { state.progressTab = 'exams'; showScreen('progress'); },
  }, 'Все экзамены →'));
  fill('level-card', children);
}
