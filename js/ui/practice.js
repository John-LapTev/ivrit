import { ALL_TOPICS } from '../core/constants.js';
import { MODES, dueWords, isWordAvailable } from '../core/modes.js';
import { speech } from '../core/speech.js';
import { isStarted } from '../core/srs.js';
import { state } from '../core/state.js';
import { el, fill, plural } from './dom.js';
import { hardCard } from './hard-screen.js';
import { allTopics } from './home.js';
import { topicIcon } from './topic-icons.js';
import { beginTraining } from './train.js';

/* ═══════════════════ СВОБОДНАЯ ТРЕНИРОВКА ═══════════════════

   Раньше выбор режима и темы стоял на главной: двадцать плиток, которые ничего
   не открывали, а молча меняли настройку будущего захода. Человек нажимал и не понимал,
   почему ничего не произошло.

   Теперь это отдельный экран, и он честно называется тем, чем является: настройка
   одного захода. Сюда приходят по своей воле — когда хочется погонять слова вне
   программы. Главная про этот экран только упоминает.                              */

export function renderPractice() {
  const words = practicePool();
  const due = dueWords().filter((word) => isStarted(state.srs.get(word.id))).length;

  fill('practice-body', [
    el('p', { class: 'muted', text: 'Заход на десять минут: выбери, что и как гонять. '
      + 'На программу занятий это не влияет — но повторения засчитываются.' }),

    el('div', { class: 'card' }, [
      el('div', { class: 'row-between' }, [
        el('b', { text: due ? `К повторению ${due} ${plural(due, 'слово', 'слова', 'слов')}` : 'Свободный заход' }),
        el('span', { class: 'faint', text: `в теме ${words.length} ${plural(words.length, 'слово', 'слова', 'слов')}` }),
      ]),
      el('p', { class: 'faint', id: 'practice-mode-note' }),
      el('button', {
        class: 'btn btn-wide', type: 'button', disabled: !words.length,
        onclick: beginTraining,
      }, due ? 'Повторить' : 'Начать заход'),
    ]),

    el('h2', { text: 'Режим' }),
    el('div', { class: 'mode-grid', id: 'practice-modes' }),

    el('h2', { text: 'Тема' }),
    el('div', { id: 'practice-topics' }),

    el('h2', { text: 'Трудные слова' }),
    el('div', { id: 'practice-hard' }),
  ]);

  renderModes();
  renderTopics();
  renderHardBlock();
}

/* Раздел трудных слов раньше было невозможно найти: его карточка появлялась только
   после того, как человек случайно нажмёт кружок у варианта ответа. Теперь он живёт
   здесь — и виден даже пустым, чтобы стало понятно, зачем этот кружок вообще нужен. */
function renderHardBlock() {
  const card = hardCard('practice');
  fill('practice-hard', card || el('p', { class: 'faint',
    text: 'Пусто. Кружок рядом со словом в тренировке или на занятии помечает его трудным — '
      + 'такие слова потом гоняются отдельно: выбрать, написать на иврите, написать перевод, '
      + 'сказать вслух.' }));
}

/** Слова, которые попадут в заход при нынешних настройках: тема и доступность. */
function practicePool() {
  return state.words.filter((word) => isWordAvailable(word)
    && (state.topic === ALL_TOPICS || word.topic === state.topic));
}

function renderModes() {
  fill('practice-modes', MODES.map((mode) => {
    const blocked = mode.needsVoice && !speech.available;
    return el('button', {
      class: 'mode-btn', type: 'button',
      'aria-pressed': state.mode === mode.id,
      disabled: blocked,
      title: blocked ? 'Нужен ивритский голос в системе' : mode.description,
      onclick: () => { state.mode = mode.id; renderPractice(); },
    }, [el('span', { class: 'mode-icon heb', text: mode.icon }), el('span', { text: mode.title })]);
  }));

  const active = MODES.find((mode) => mode.id === state.mode);
  const note = document.getElementById('practice-mode-note');
  const missingVoice = MODES.some((mode) => mode.needsVoice) && !speech.available;
  if (note) {
    note.textContent = missingVoice
      ? `${active.description} Режимы со звуком выключены: в системе нет ивритского голоса.`
      : active.description;
  }
}

/** Темы плиткой с рисованными иконками: лента чипов обрезалась и прятала половину тем. */
function renderTopics() {
  fill('practice-topics', el('div', { class: 'topic-grid' }, allTopics().map((topic) => {
    const inTopic = (word) => topic === ALL_TOPICS || word.topic === topic;
    const open = state.words.filter((word) => inTopic(word) && isWordAvailable(word)).length;
    const locked = state.words.filter((word) => inTopic(word) && !isWordAvailable(word)).length;
    return el('button', {
      class: 'topic-tile', type: 'button', 'aria-pressed': state.topic === topic,
      onclick: () => { state.topic = topic; renderPractice(); },
    }, [
      topicIcon(topic),
      el('span', {}, [
        el('div', { class: 'topic-name', text: topic }),
        el('div', { class: 'topic-count', text: open === 0 && locked > 0
          ? `${locked} слов, откроются позже`
          : locked > 0 ? `${open} слов, ещё ${locked} впереди` : `${open} слов` }),
      ]),
    ]);
  })));
}
