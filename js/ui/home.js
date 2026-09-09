import { ALL_TOPICS } from '../core/constants.js';
import { dueWords } from '../core/modes.js';
import { isStarted } from '../core/srs.js';
import { calcStreak } from '../core/stats.js';
import { state } from '../core/state.js';
import { LETTERS } from '../data/alefbet.js';
import { el, fill, plural } from './dom.js';
import { hardCard } from './hard-screen.js';
import { uiIcon } from './icons.js';
import { sideRow } from './rows.js';
import { showScreen } from './screens.js';
import { nextTeacherStep, openTeacherDay, teacherSummary } from './teacher-course.js';
import { beginTraining } from './train.js';

/* ═══════════════════ ГЛАВНАЯ — «что делать прямо сейчас» ═══════════════════

   Раньше здесь стояли три карточки подряд, и каждая звала заниматься своими словами:
   программа, занятие дня и счётчик повторений. Плюс двадцать плиток, которые ничего
   не открывали, а молча меняли настройку будущей тренировки. Человек, открывший
   приложение впервые, видел «177 новых слов» и не понимал, с чего начать.

   Теперь порядок один и он же порядок обучения:
     1. буквы — пока алефбет не пройден, всё остальное бессмысленно: слова написаны ими;
     2. занятие дня — один следующий шаг курса, одна кнопка;
     3. повторение — только если сроки правда наступили;
     4. трудные слова — только если они помечены;
     5. свободная тренировка — отдельным экраном, где и живёт выбор режима и темы.

   Правило экрана: одно главное действие. Остальное — тише и ниже.               */

/** Сколько букв алефбета отмечено выученными. */
const lettersLearned = () => LETTERS.filter((letter) => state.letterProgress.get(letter.letter)).length;

/** Слово в работе: его уже показывали в тренировке или на занятии. */
const startedWords = () => state.words.filter((word) => isStarted(state.srs.get(word.id)));

export function renderHome() {
  renderStatusLine();
  renderNowCard();
  renderReviewCard();
  // Раздел трудных слов виден, только когда есть что повторять — иначе пустая карточка
  fill('hard-card', hardCard('home'));
  renderPracticeCard();
}

/** Строка состояния: день курса и серия — чтобы было видно, что вчера что-то было. */
function renderStatusLine() {
  const summary = teacherSummary();
  const streak = calcStreak();
  const parts = [
    el('span', {}, [uiIcon('cap', 16), ` День ${summary.current} из ${summary.total}`]),
  ];
  if (streak > 1) parts.push(el('span', {}, [uiIcon('flame', 16), ` ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд`]));
  const learned = startedWords().length;
  if (learned) parts.push(el('span', { class: 'faint', text: `${learned} ${plural(learned, 'слово', 'слова', 'слов')} в работе` }));
  fill('home-status', el('div', { class: 'status-line' }, parts));
}

/**
 * Единственное главное действие. Порядок проверок и есть порядок обучения:
 * буквы → занятие дня → (курс пройден) поддержка.
 */
function renderNowCard() {
  const known = lettersLearned();
  if (known < LETTERS.length) return renderLettersFirst(known);

  const next = nextTeacherStep();
  if (!next) return fill('now-card', bigAction({
    label: 'Занятие',
    title: 'Программа готова к запуску',
    note: 'Тридцать дней по порядку: слова, правило, фразы на слух и вслух.',
    action: 'Открыть программу',
    onclick: () => showScreen('teacher'),
  }));

  if (next.courseOver) return renderCourseOver();

  if (next.finished) {
    return fill('now-card', bigAction({
      label: `День ${next.day} · сделан`,
      title: next.title,
      note: 'Все задания дня закрыты. Завтра — следующий день; сегодня можно повторить слова.',
      action: `Открыть день ${next.day + 1}`,
      onclick: () => openTeacherDay(next.day + 1),
      quiet: true,
    }));
  }

  fill('now-card', bigAction({
    label: `День ${next.day} · шаг ${next.done + 1} из ${next.total}`,
    title: next.exam ? 'Экзамен' : next.stepTitle,
    note: next.note,
    action: next.done ? 'Продолжить занятие' : 'Начать занятие',
    onclick: () => openTeacherDay(next.day),
    progress: next.total ? Math.round((next.done / next.total) * 100) : 0,
  }));
}

/** Пока буквы не выучены, всё остальное — угадывание: слова написаны этими буквами. */
function renderLettersFirst(known) {
  fill('now-card', bigAction({
    label: 'Шаг первый',
    title: 'Выучи буквы',
    note: known
      ? `Отмечено ${known} из ${LETTERS.length}. Открой алефбет и отметь те, что уже узнаёшь.`
      : 'Двадцать две буквы и огласовки под ними. Без них слова читать нечем — начни отсюда.',
    action: known ? 'Продолжить алефбет' : 'Открыть алефбет',
    onclick: () => showScreen('alefbet'),
    progress: Math.round((known / LETTERS.length) * 100),
    aside: el('button', {
      class: 'btn btn-quiet btn-small', type: 'button',
      onclick: () => showScreen('teacher'),
    }, 'Буквы знаю — к программе'),
  }));
}

/** Тридцать дней позади: дальше человека держат повторения, разговоры и трудные слова. */
function renderCourseOver() {
  fill('now-card', bigAction({
    label: 'Программа пройдена',
    title: 'Тридцать дней позади',
    note: 'Дальше язык держат повторения по срокам и живая речь: разговоры, трудные слова, экзамены уровней.',
    action: 'Открыть разговоры',
    onclick: () => { state.grammarTab = 'dialogs'; showScreen('grammar'); },
  }));
}

/** Повторение показываем, только когда сроки правда наступили. */
function renderReviewCard() {
  const due = dueWords();
  const started = due.filter((word) => isStarted(state.srs.get(word.id)));
  if (!started.length) { fill('review-card', []); return; }

  const count = Math.min(started.length, state.sessionLimit);
  fill('review-card', sideRow({
    title: `Повторить ${started.length} ${plural(started.length, 'слово', 'слова', 'слов')}`,
    note: count < started.length
      ? `Срок подошёл. В заход возьмём ${count} — это минут на десять.`
      : 'Срок подошёл — освежить и забыть до следующего раза.',
    // Повторение начинается сразу: лишний экран с настройками между «пора повторить»
    // и первым словом — это ровно то, из-за чего повторение откладывают
    onclick: () => { state.topic = ALL_TOPICS; beginTraining(); },
  }));
}

/** Свободная тренировка — не на главной, а отдельным экраном: там и режимы, и темы. */
function renderPracticeCard() {
  const started = startedWords().length;
  fill('practice-card', sideRow({
    title: 'Свободная тренировка',
    note: started
      ? 'Семь режимов и любая тема — когда хочется погонять слова вне программы.'
      : 'Появится, когда пройдёшь первые слова: гонять пока нечего.',
    onclick: () => showScreen('practice'),
  }));
}


/**
 * Карточка главного действия. Один заголовок, одно пояснение, одна кнопка —
 * остальное сюда не кладём, иначе экран снова превратится в витрину.
 */
function bigAction(options) {
  const children = [
    el('div', { class: 'now-label', text: options.label }),
    el('h2', { class: 'now-title', text: options.title }),
    el('p', { class: 'faint', text: options.note }),
  ];
  // Пустая дорожка на нуле — это серая плашка ни о чём: показываем, когда есть что показывать
  if (options.progress) {
    children.push(el('div', { class: 'now-progress' }, [
      el('div', { class: 'level-bar' }, el('span', { style: `width:${options.progress}%` })),
      el('span', { class: 'now-percent num', text: `${options.progress}%` }),
    ]));
  }
  children.push(el('button', {
    class: options.quiet ? 'btn btn-quiet btn-wide' : 'btn btn-wide',
    type: 'button', onclick: options.onclick,
  }, options.action));
  if (options.aside) children.push(el('div', { class: 'center now-aside' }, options.aside));
  // Карточка действия — главный предмет экрана, поэтому стоит выше остальных
  return el('div', { class: 'card is-lift now-card' }, children);
}

/** Список тем словаря: нужен экрану свободной тренировки и словарю. */
export function allTopics() {
  const topics = new Set(state.words.map((word) => word.topic).filter(Boolean));
  return [ALL_TOPICS].concat(Array.from(topics).sort());
}
