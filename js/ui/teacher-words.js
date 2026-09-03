import { shuffle, startSession } from '../core/modes.js';
import { speech } from '../core/speech.js';
import { createSrsRecord, dayKey, isDue } from '../core/srs.js';
import { state } from '../core/state.js';
import { fill, toast } from './dom.js';
import { openLesson } from './grammar.js';
import { iconLabel } from './icons.js';
import { showScreen } from './screens.js';
import { teacherDay, teacherWordsBefore, wordByHeb } from './teacher-course.js';
import { runTaskStep } from './teacher-tasks.js';
import { renderTrain } from './train.js';

/* ——— Слова занятия: озвучка подряд и шаги, которые открывают уже готовые режимы ———

   Здесь нет ни одной своей механики упражнения: подходы дня живут в ui/teacher-tasks.js,
   правило — в ui/grammar.js, повторение — в обычной тренировке. Этот файл только сводит
   их вместе и озвучивает список слов дня.

   Слова на иврите сравниваются исключительно через словарь (wordByHeb → wordKey):
   строку с огласовками и без огласовок нельзя ставить рядом знак в знак.               */

/* ——— Прогон списка слов подряд ———
   Ждём конца каждой записи и только потом делаем паузу: по таймеру записи наезжали
   друг на друга, обрывались и звучали не в том порядке, в каком написаны.          */

const WORD_PAUSE = 450;
let wordsInTurnRun = 0;

/** Подсветить слово, которое звучит прямо сейчас. Перерисовывать весь день ради этого
    не нужно — меняем класс у одной плитки. */
function markSpeakingWord(heb) {
  document.querySelectorAll('.day-word.is-speaking')
    .forEach((node) => node.classList.remove('is-speaking'));
  if (!heb) return;
  const node = Array.from(document.querySelectorAll('.day-word'))
    .find((item) => item.dataset.heb === heb);
  if (node) node.classList.add('is-speaking');
}

/** Кнопка над словами: пока идёт прогон, она останавливает. */
export function setPlayAllButton(playing, list) {
  const button = document.getElementById('day-play-all');
  if (!button) return;
  fill(button, playing ? iconLabel('stop', 'Остановить') : iconLabel('sound', 'Прослушать все'));
  button.onclick = () => (playing ? stopWordsInTurn() : speakWordsInTurn(list));
}

function stopWordsInTurn() {
  wordsInTurnRun += 1;
  speech.stop();
  markSpeakingWord(null);
  const entry = teacherDay(state.teacherDay);
  setPlayAllButton(false, (entry && entry.words) || []);
}

/** Одно слово по нажатию: подсветка держится, пока звучит запись. */
export async function speakSingleWord(heb) {
  stopWordsInTurn();
  const run = wordsInTurnRun + 1;
  wordsInTurnRun = run;
  markSpeakingWord(heb);
  const played = await speech.speakUntilEnd(heb);
  if (!played) toast('Ивритского голоса в системе нет.', true);
  if (run === wordsInTurnRun) markSpeakingWord(null);
}

async function speakWordsInTurn(list) {
  const run = wordsInTurnRun + 1;      // повторное нажатие отменяет прошлый прогон
  wordsInTurnRun = run;
  setPlayAllButton(true, list);
  for (const heb of list) {
    if (run !== wordsInTurnRun || state.screen !== 'teacher-day') { markSpeakingWord(null); return; }
    markSpeakingWord(heb);
    const played = await speech.speakUntilEnd(heb);
    if (!played) {
      toast('Ивритского голоса в системе нет.', true);
      stopWordsInTurn();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, WORD_PAUSE));
  }
  if (run === wordsInTurnRun) stopWordsInTurn();
}

/* ——— Повторение пройденного ——— */

const TEACHER_REVIEW_SIZE = 15;

/** Сколько слов курса просрочено — показываем прямо в карточке шага. */
export function teacherDueCount(entry) {
  if (!entry) return 0;
  const today = dayKey();
  return teacherWordsBefore(entry.day)
    .filter((word) => isDue(state.srs.get(word.id) || createSrsRecord(word.id), today)).length;
}

/**
 * Прогон пройденного: сперва то, что пора повторить по срокам, потом остальное.
 * С русского на иврит — узнавать легко, вспоминать трудно, а в разговоре нужно второе.
 * @param {object} entry — день программы
 * @param {boolean} [asStep] — правда ли это шаг занятия (тогда он закроется по итогу)
 */
export function startTeacherReview(entry, asStep = true) {
  if (!entry) { toast('День программы не найден.', true); return; }
  // Кнопка «Освежить пройденное» зовёт не как шаг: там нужны и слова текущего дня тоже
  const learned = teacherWordsBefore(entry.day + (asStep ? 0 : 1));
  if (!learned.length) { toast('Повторять пока нечего — пройди первый день.', true); return; }
  const today = dayKey();
  const due = learned.filter((word) => isDue(state.srs.get(word.id) || createSrsRecord(word.id), today));
  const rest = shuffle(learned.filter((word) => !due.includes(word)));
  const words = due.concat(rest).slice(0, TEACHER_REVIEW_SIZE);
  state.teacherReturn = asStep ? { day: entry.day, step: 'review' } : null;
  startSession({ mode: 'ru2heb', words });
  showScreen('train');
  renderTrain();
}

/* ——— Слова дня на слух ———
   Единственный шаг, который открывает обычную тренировку в режиме «На слух»: звучит
   слово, текста нет. Ухо тренируется на буквах и огласовках внутри настоящих слов —
   отдельного тренажёра слогов у иврита нет и быть не может, слог здесь не единица. */

function startTeacherListen(entry) {
  const words = (entry.words || []).map(wordByHeb).filter(Boolean);
  if (!words.length) { toast('Слова этого дня не найдены в словаре.', true); return; }
  const sounded = speech.voice ? words : words.filter((word) => speech.hasClip(word.heb));
  if (!sounded.length) {
    toast('Слова дня нечем озвучить: в системе нет ивритского голоса, а записей для них тоже нет.', true);
    return;
  }
  state.teacherReturn = { day: entry.day, step: 'listen' };
  startSession({ mode: 'listen', words: sounded });
  showScreen('train');
  renderTrain();
}

/* ——— Что открывает шаг занятия ——— */

/**
 * Шаги, которые умеет открывать сам экран заданий, уходят в ui/teacher-tasks.js.
 * Здесь остаются двое, у которых свой экран: правило грамматики и слова на слух.
 */
export function runTeacherStep(entry, step) {
  if (!entry) { toast('День программы не найден.', true); return; }
  if (step === 'grammar') {
    if (!entry.lesson) { toast('У этого дня нет своего правила.', true); return; }
    state.teacherReturn = { day: entry.day, step: 'grammar' };
    openLesson(entry.lesson, { screen: 'teacher-day', day: entry.day });
    return;
  }
  if (step === 'listen') { startTeacherListen(entry); return; }
  if (runTaskStep(entry, step)) return;
  toast('Это задание пока не открыть — расскажи об этом, что-то в программе не сходится.', true);
}
