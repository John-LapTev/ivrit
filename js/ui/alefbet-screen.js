import { STORE_LETTERS } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { CONFUSING_PAIRS, DAGESH_NOTE, LETTERS, VOWELS } from '../data/alefbet.js';
import { pickRandom, shuffle } from '../core/random.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { translit } from '../core/translit.js';
import { el, fill, plural, toast } from './dom.js';
import { showScreen } from './screens.js';

/* ═══════════════════ ALEFBET — экран букв и чтения ═══════════════════
   Место раздела пиньиня в китайской версии, но задача другая. Пиньинь — подпорка,
   которую потом отбрасывают; ивритские буквы — само письмо, и без них дальше никак.

   Пять вкладок идут в том порядке, в каком этому учат:
     Буквы     — узнать начертание, имя и звук;
     Огласовки — понять, откуда берутся гласные, которых в буквах нет;
     Чтение    — сложить букву с огласовкой в слог: ба-бэ-би-бо-бу. Главная вкладка;
     Похожие   — отдельно погонять пары, на которых спотыкаются все (ד/ר, ב/כ, ם/ס);
     От руки   — узнать букву в рукописном начертании: ступень между алефбетом
                 и режимом «От руки» в тренировке, где ими написаны целые слова.      */

/** Пять основных огласовок для таблицы чтения: с них начинают, остальные — потом. */
const READING_VOWELS = [
  { mark: 'ַ', sound: 'а', name: 'пата́х' },
  { mark: 'ֶ', sound: 'э', name: 'сего́ль' },
  { mark: 'ִ', sound: 'и', name: 'хири́к' },
  { mark: 'ֹ', sound: 'о', name: 'хола́м' },
  { mark: 'ֻ', sound: 'у', name: 'кубу́ц' },
];

/** Буквы, которые своего звука не дают: слог из них — это чистая гласная. */
const SILENT_LETTERS = new Set(['א', 'ע']);

/** Точка внутри буквы (дагеш) меняет звук у трёх букв. В таблице чтения им нужно по два
    ряда: без неё и с ней — иначе не видно, чем בּ отличается от ב, а это половина ошибок. */
const DAGESH_MARK = 'ּ';
const DOUBLE_SOUND = { 'ב': 'бет с точкой', 'כ': 'каф с точкой', 'פ': 'пей с точкой' };

const letterProgress = (letter) => state.letterProgress.get(letter) || null;
const isLetterLearned = (letter) => Boolean(letterProgress(letter));

async function markLearned(letter) {
  const record = { letter, learned: true, at: Date.now() };
  state.letterProgress.set(letter, record);
  try {
    await dbPut(STORE_LETTERS, record);
  } catch (error) {
    toast('Не вышло запомнить отметку — попробуй ещё раз.', true);
  }
}

/** Озвучить слог или букву: если записи нет, честно молчим и говорим об этом. */
function speakOrExplain(text) {
  if (speech.speak(text)) return;
  toast('Для этого звука пока нет записи.', true);
}

/* ——— Вкладка «Буквы» ——— */

function letterCard(item) {
  const learned = isLetterLearned(item.letter);
  return el('div', { class: `card alefbet-card${learned ? ' is-learned' : ''}` }, [
    el('div', { class: 'alefbet-head' }, [
      /* Два лица одной буквы. В Израиле от руки пишут курсивом, и рукописная строка
         на печатные буквы не похожа совсем — без второго начертания записку, ценник
         от руки или заполненный бланк не прочитать. */
      el('div', { class: 'alefbet-faces' }, [
        el('div', {}, [
          el('div', { class: 'alefbet-glyph heb', text: item.letter }),
          el('div', { class: 'faint center', text: 'печатная' }),
        ]),
        el('div', {}, [
          el('div', { class: 'alefbet-glyph heb is-script', text: item.letter }),
          el('div', { class: 'faint center', text: 'от руки' }),
        ]),
      ]),
      item.final ? el('div', { class: 'alefbet-final' }, [
        el('div', { class: 'alefbet-glyph heb is-small', text: item.final }),
        el('div', { class: 'alefbet-glyph heb is-small is-script', text: item.final }),
        el('div', { class: 'faint', text: 'в конце слова' }),
      ]) : null,
      el('div', { class: 'alefbet-facts' }, [
        el('b', { text: item.ru }),
        el('div', { class: 'heb alefbet-name', text: item.name }),
        el('div', { text: `звук: ${item.sound}` }),
        el('div', { class: 'faint', text: `числовое значение: ${item.value}` }),
      ]),
    ].filter(Boolean)),
    item.soundNote ? el('p', { class: 'faint', text: item.soundNote }) : null,
    el('p', { text: item.look }),
    el('p', { class: 'alefbet-confuse', text: item.confuse }),
    el('button', {
      class: learned ? 'btn btn-quiet btn-small' : 'btn btn-small', type: 'button',
      onclick: async (event) => {
        await markLearned(item.letter);
        event.target.replaceWith(el('span', { class: 'faint', text: '✓ отмечена как выученная' }));
      },
    }, learned ? '✓ выучена' : 'Отметить: выучил'),
  ].filter(Boolean));
}

function renderLetters() {
  const learned = LETTERS.filter((item) => isLetterLearned(item.letter)).length;
  const grid = el('div', { class: 'alefbet-grid' }, LETTERS.map((item) => el('button', {
    class: `alefbet-tile${isLetterLearned(item.letter) ? ' is-learned' : ''}`, type: 'button',
    'aria-label': `${item.ru}, звук ${item.sound}`,
    onclick: () => { state.alefbetLetter = item.letter; renderAlefbet(); },
  }, [
    el('span', { class: 'alefbet-tile-pair' }, [
      el('span', { class: 'heb alefbet-tile-glyph', text: item.letter }),
      el('span', { class: 'heb alefbet-tile-script', text: item.letter }),
    ]),
    el('span', { class: 'alefbet-tile-name', text: item.ru }),
  ])));

  const chosen = LETTERS.find((item) => item.letter === state.alefbetLetter) || LETTERS[0];
  return [
    el('p', { class: 'faint', text: `Двадцать две буквы, все согласные — гласных в письме нет, `
      + `их показывают точками под буквами. Выучено ${learned} из ${LETTERS.length}.` }),
    grid,
    letterCard(chosen),
  ];
}

/* ——— Вкладка «Огласовки» ——— */

function renderVowels() {
  return [
    el('p', { class: 'faint', text: 'Буквы иврита — только согласные. Гласные показывают точками '
      + 'и чёрточками под буквой: это и есть огласовки. В книгах и на вывесках их не ставят — '
      + 'их учат, чтобы научиться читать, а потом узнают слова целиком.' }),
    el('div', { class: 'vowel-list' }, VOWELS.map((vowel) => el('div', { class: 'vowel-row' }, [
      el('span', { class: 'heb vowel-sign', text: vowel.sign }),
      el('div', {}, [
        el('b', { text: `${vowel.ru} — звук «${vowel.sound}»` }),
        el('div', { class: 'heb vowel-name', text: vowel.name }),
        el('div', { class: 'faint', text: vowel.note }),
      ]),
    ]))),
    el('div', { class: 'card' }, [
      el('b', { text: DAGESH_NOTE.title }),
      el('div', { class: 'dagesh-row' }, DAGESH_NOTE.changes.map((change) => el('div', { class: 'dagesh-pair' }, [
        el('span', { class: 'heb', text: change.pair }),
        el('span', { class: 'faint', text: change.ru }),
      ]))),
      el('p', { class: 'faint', text: DAGESH_NOTE.text }),
    ]),
  ];
}

/* ——— Вкладка «Чтение»: буква + огласовка = слог ——— */

/** Слог как его пишут: буква, потом огласовка. Чтение считает движок по тем же правилам. */
const syllableOf = (letter, mark) => letter + mark;

/** Ряды таблицы: буквы по порядку, а у трёх «бегед-кефет» — сразу два ряда. */
function readingRows() {
  return LETTERS.flatMap((item) => (DOUBLE_SOUND[item.letter]
    ? [{ letter: item.letter, ru: item.ru }, { letter: item.letter, ru: DOUBLE_SOUND[item.letter], dagesh: true }]
    : [{ letter: item.letter, ru: item.ru }]));
}

function readingCell(item, vowel) {
  const syllable = syllableOf(item.letter + (item.dagesh ? DAGESH_MARK : ''), vowel.mark);
  const sound = SILENT_LETTERS.has(item.letter) ? vowel.sound : translit(syllable, 0);
  return el('button', {
    class: 'reading-cell', type: 'button',
    'aria-label': `${item.ru} с огласовкой ${vowel.name}: ${sound}`,
    onclick: () => speakOrExplain(syllable),
  }, [
    el('span', { class: 'heb reading-glyph', text: syllable }),
    el('span', { class: 'reading-sound', text: sound }),
  ]);
}

function renderReading() {
  return [
    el('p', { class: 'faint', text: 'Вот как это работает: берём букву, ставим под неё огласовку — '
      + 'получается слог. Прочитай ряд вслух: ба-бэ-би-бо-бу. Нажатие озвучивает.' }),
    el('div', { class: 'reading-head' }, [
      el('span', {}),
      ...READING_VOWELS.map((vowel) => el('span', { class: 'reading-vowel' }, [
        el('span', { class: 'heb', text: vowel.mark }),
        el('span', { class: 'faint', text: vowel.sound }),
      ])),
    ]),
    el('div', { class: 'reading-grid' }, readingRows().flatMap((row) => [
      el('span', { class: 'reading-label' }, [
        el('span', { class: 'heb', text: row.letter + (row.dagesh ? DAGESH_MARK : '') }),
        el('span', { class: 'faint', text: row.ru }),
      ]),
      ...READING_VOWELS.map((vowel) => readingCell(row, vowel)),
    ])),
  ];
}

/* ——— Вкладка «Похожие»: тренажёр пар, на которых спотыкаются ——— */

/* Вариантов четыре, а не два: выбор из пары — это подбрасывание монеты, и человек
   получает «верно» ровно в половине случаев, ничего при этом не узнав. Двое из четырёх —
   та самая путаная пара, ещё двое взяты из остальных букв. */
const CONFUSING_OPTIONS = 4;

function nextConfusingRound() {
  const pair = pickRandom(CONFUSING_PAIRS);
  const asked = pickRandom(pair.pair);
  const options = pair.pair.slice();
  const rest = LETTERS.map((item) => item.letter).filter((letter) => !options.includes(letter));
  shuffle(rest).slice(0, CONFUSING_OPTIONS - options.length).forEach((letter) => options.push(letter));
  // Счёт держим между раундами: без него тренажёр не даёт понять, узнаёшь ты буквы или нет
  const previous = state.confusing || { right: 0, total: 0 };
  state.confusing = {
    pair, asked, options: shuffle(options), answer: null,
    right: previous.right || 0, total: previous.total || 0,
  };
}

function renderConfusing() {
  if (!state.confusing) nextConfusingRound();
  const round = state.confusing;
  const target = LETTERS.find((item) => item.letter === round.asked
    || item.final === round.asked);
  const nameOf = (letter) => {
    const found = LETTERS.find((item) => item.letter === letter);
    if (found) return found.ru;
    const owner = LETTERS.find((item) => item.final === letter);
    return owner ? `${owner.ru} софи́т` : letter;
  };

  return [
    el('div', { class: 'row-between hand-head' }, [
      el('p', { class: 'faint', text: 'Пары, на которых спотыкаются все: '
        + 'показана буква — выбери её имя.' }),
      round.total ? el('span', { class: 'faint', text: `${round.right} из ${round.total}` }) : null,
    ].filter(Boolean)),
    el('div', { class: 'card confusing-card' }, [
      el('div', { class: 'heb confusing-glyph', text: round.asked }),
      el('div', { class: 'confusing-options' }, round.options.map((letter) => {
        const correct = letter === round.asked;
        const answered = round.answer !== null;
        /* Тихими остаются все, кроме верной: до ответа — потому что ни одна не главная,
           после — потому что цветом отмечен только результат. Раньше `btn-quiet` снимался
           со всех разом, и после ответа четыре кнопки светились градиентом одинаково —
           было не видно, где верно, а где мимо. */
        const classes = ['btn', 'btn-wide'];
        if (answered && correct) classes.push('is-right');
        else if (answered && round.answer === letter) classes.push('is-wrong', 'btn-quiet');
        else classes.push('btn-quiet');
        return el('button', {
          class: classes.join(' '), type: 'button', disabled: answered,
          onclick: () => {
            round.answer = letter;
            round.total += 1;
            if (letter === round.asked) round.right += 1;
            renderAlefbet();
          },
        }, nameOf(letter));
      })),
      round.answer !== null ? el('div', { class: 'confusing-hint' }, [
        el('p', { text: round.pair.hint }),
        target && target.confuse ? el('p', { class: 'faint', text: target.confuse }) : null,
        el('button', {
          class: 'btn btn-wide', type: 'button',
          onclick: () => { nextConfusingRound(); renderAlefbet(); },
        }, 'Дальше →'),
      ].filter(Boolean)) : null,
    ].filter(Boolean)),
  ];
}

/* ——— Вкладка «От руки»: узнать букву в рукописном начертании ———

   Это ступень между алефбетом и режимом «От руки» в тренировке: сначала учишься узнавать
   одну закорючку, потом читаешь ими целые слова. Без этой ступени слово от руки —
   просто вязь, в которой не за что зацепиться.                                          */

const HAND_OPTIONS = 4;

/** Отвлекающие: сперва та буква, с которой эту путают, потом любые. */
function handDistractors(letter) {
  const pair = CONFUSING_PAIRS.find((item) => item.pair.includes(letter));
  const options = [letter];
  if (pair) pair.pair.forEach((item) => { if (!options.includes(item)) options.push(item); });
  const rest = LETTERS.map((item) => item.letter).filter((item) => !options.includes(item));
  shuffle(rest).slice(0, HAND_OPTIONS - options.length).forEach((item) => options.push(item));
  return options.slice(0, HAND_OPTIONS);
}

function nextHandRound() {
  const asked = pickRandom(LETTERS).letter;
  const previous = state.handwriting || { right: 0, total: 0 };
  state.handwriting = {
    asked, options: shuffle(handDistractors(asked)), answer: null,
    right: previous.right || 0, total: previous.total || 0,
  };
}

function renderHandwriting() {
  if (!state.handwriting) nextHandRound();
  const round = state.handwriting;
  const nameOf = (letter) => {
    const found = LETTERS.find((item) => item.letter === letter);
    return found ? found.ru : letter;
  };

  return [
    el('div', { class: 'row-between hand-head' }, [
      el('p', { class: 'faint', text: 'Так эта буква выглядит написанной от руки — узнай её. '
        + 'Печатное начертание появится вместе с ответом.' }),
      round.total ? el('span', { class: 'faint', text: `${round.right} из ${round.total}` }) : null,
    ].filter(Boolean)),
    el('div', { class: 'card confusing-card' }, [
      el('div', { class: 'heb confusing-glyph hand-glyph', text: round.asked }),
      el('div', { class: 'confusing-options' }, round.options.map((letter) => {
        const correct = letter === round.asked;
        const answered = round.answer !== null;
        /* Тихими остаются все, кроме верной: до ответа — потому что ни одна не главная,
           после — потому что цветом отмечен только результат. Раньше `btn-quiet` снимался
           со всех разом, и после ответа четыре кнопки светились градиентом одинаково —
           было не видно, где верно, а где мимо. */
        const classes = ['btn', 'btn-wide'];
        if (answered && correct) classes.push('is-right');
        else if (answered && round.answer === letter) classes.push('is-wrong', 'btn-quiet');
        else classes.push('btn-quiet');
        return el('button', {
          class: classes.join(' '), type: 'button', disabled: answered,
          onclick: () => {
            round.answer = letter;
            round.total += 1;
            if (letter === round.asked) round.right += 1;
            renderAlefbet();
          },
        }, nameOf(letter));
      })),
      round.answer !== null ? el('div', { class: 'confusing-hint' }, [
        // Пара целиком: именно на ней и видно, во что печатная буква превращается от руки
        el('div', { class: 'alefbet-faces hand-faces' }, [
          el('div', {}, [
            el('div', { class: 'alefbet-glyph heb', text: round.asked }),
            el('div', { class: 'faint center', text: 'печатная' }),
          ]),
          el('div', {}, [
            el('div', { class: 'alefbet-glyph heb is-script', text: round.asked }),
            el('div', { class: 'faint center', text: 'от руки' }),
          ]),
        ]),
        el('button', {
          class: 'btn btn-wide', type: 'button',
          onclick: () => { nextHandRound(); renderAlefbet(); },
        }, 'Дальше →'),
      ]) : null,
    ].filter(Boolean)),
  ];
}

/* ——— Сборка экрана ——— */

const TABS = [
  { id: 'letters', title: 'Буквы', render: renderLetters },
  { id: 'vowels', title: 'Огласовки', render: renderVowels },
  { id: 'reading', title: 'Чтение', render: renderReading },
  { id: 'confusing', title: 'Похожие', render: renderConfusing },
  { id: 'handwriting', title: 'От руки', render: renderHandwriting },
];

export function switchAlefbetTab(id) {
  state.alefbetTab = TABS.some((tab) => tab.id === id) ? id : 'letters';
  renderAlefbet();
}

/* Переключатель начертания на весь раздел. Пары «печатная — от руки» в карточке мало:
   человек ищет рукописные буквы там, где сейчас смотрит, а не там, где я их положил. */
function toggleScript() {
  state.alefbetScript = !state.alefbetScript;
  renderAlefbet();
}

export function renderAlefbet() {
  const current = state.alefbetTab || 'letters';
  const tab = TABS.find((item) => item.id === current) || TABS[0];
  const learned = LETTERS.filter((item) => isLetterLearned(item.letter)).length;

  // Рукописное начертание включается на весь раздел: и таблица чтения, и похожие пары
  document.getElementById('screen-alefbet').classList.toggle('is-script', Boolean(state.alefbetScript));

  fill('alefbet-body', [
    /* Вкладки — теми же чипами, что и во всём приложении. Раньше здесь были свои классы
       `tabs`/`tab-btn`, которым в стилях не соответствовало НИЧЕГО: на телефоне это
       выглядело мелким серым текстом, и Джон 04.09.2026 просто не нашёл раздел чтения. */
    el('div', { class: 'chip-row' }, TABS.map((item) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': item.id === current,
      onclick: () => switchAlefbetTab(item.id),
    }, item.title))),

    // На вкладке «От руки» переключатель бессмыслен: знак там рукописный по самой задаче
    current === 'handwriting' ? null : el('div', { class: 'script-switch' }, [
      el('div', {}, [
        el('b', { text: state.alefbetScript ? 'Показаны рукописные буквы' : 'Показаны печатные буквы' }),
        el('p', { class: 'faint', text: state.alefbetScript
          ? 'Так пишут от руки: записка, ценник, заполненный бланк.'
          : 'Так печатают: вывеска, книга, экран. От руки пишут иначе — включи и сравни.' }),
      ]),
      el('button', {
        class: state.alefbetScript ? 'btn btn-small' : 'btn btn-quiet btn-small',
        type: 'button', 'aria-pressed': Boolean(state.alefbetScript), onclick: toggleScript,
      }, state.alefbetScript ? 'Вернуть печатные' : 'Показать от руки'),
    ]),
    learned ? el('p', { class: 'faint alefbet-progress',
      text: `${learned} ${plural(learned, 'буква', 'буквы', 'букв')} отмечено как выученные.` }) : null,
    ...tab.render(),
    nextStepCard(learned),
  ].filter(Boolean));
}

/**
 * Куда идти после букв. Раньше алефбет был тупиком: выучил двадцать две буквы — и никуда
 * с этим не пошёл, ни одной кнопки наружу. А это первый раздел для того, кто начинает с нуля.
 */
function nextStepCard(learned) {
  const left = LETTERS.length - learned;
  return el('div', { class: 'card center', style: 'margin-top:24px' }, left
    ? [
      el('b', { text: `Осталось отметить ${left} ${plural(left, 'букву', 'буквы', 'букв')}` }),
      el('p', { class: 'faint', text: 'Отмечай те, что узнаёшь без подсказки. Когда закончишь, '
        + 'главная сама поведёт дальше — к первому занятию.' }),
    ]
    : [
      el('b', { text: 'Буквы позади' }),
      el('p', { class: 'faint', text: 'Дальше — слова: программа занятий начинается с приветствий '
        + 'и коротких фраз, которые собраны из этих же букв.' }),
      el('button', {
        class: 'btn', type: 'button', onclick: () => showScreen('teacher'),
      }, 'К программе занятий'),
    ]);
}

/** Значок раздела для нижних вкладок — первая буква алефбета. */
export const alefbetTabIcon = () => el('span', { class: 'tab-icon heb', 'aria-hidden': 'true', text: 'א' });
