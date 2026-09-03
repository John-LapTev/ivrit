import { STORE_LETTERS } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { CONFUSING_PAIRS, DAGESH_NOTE, LETTERS, VOWELS } from '../data/alefbet.js';
import { pickRandom, shuffle } from '../core/random.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { translit } from '../core/translit.js';
import { el, fill, plural, toast } from './dom.js';

/* ═══════════════════ ALEFBET — экран букв и чтения ═══════════════════
   Место раздела пиньиня в китайской версии, но задача другая. Пиньинь — подпорка,
   которую потом отбрасывают; ивритские буквы — само письмо, и без них дальше никак.

   Четыре вкладки идут в том порядке, в каком этому учат:
     Буквы     — узнать начертание, имя и звук;
     Огласовки — понять, откуда берутся гласные, которых в буквах нет;
     Чтение    — сложить букву с огласовкой в слог: ба-бэ-би-бо-бу. Главная вкладка;
     Похожие   — отдельно погонять пары, на которых спотыкаются все (ד/ר, ב/כ, ם/ס).  */

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
      el('div', { class: 'alefbet-glyph heb', text: item.letter }),
      item.final ? el('div', { class: 'alefbet-final' }, [
        el('div', { class: 'alefbet-glyph heb is-small', text: item.final }),
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
    el('span', { class: 'heb alefbet-tile-glyph', text: item.letter }),
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

function nextConfusingRound() {
  const pair = pickRandom(CONFUSING_PAIRS);
  const asked = pickRandom(pair.pair);
  state.confusing = { pair, asked, options: shuffle(pair.pair.slice()), answer: null };
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
    el('p', { class: 'faint', text: 'Пары, на которых спотыкаются все. Показана буква — '
      + 'выбери её имя. Подсказка появится после ответа.' }),
    el('div', { class: 'card confusing-card' }, [
      el('div', { class: 'heb confusing-glyph', text: round.asked }),
      el('div', { class: 'confusing-options' }, round.options.map((letter) => {
        const correct = letter === round.asked;
        const answered = round.answer !== null;
        const classes = ['btn', 'btn-wide'];
        if (answered && correct) classes.push('is-right');
        if (answered && round.answer === letter && !correct) classes.push('is-wrong');
        if (!answered) classes.push('btn-quiet');
        return el('button', {
          class: classes.join(' '), type: 'button', disabled: answered,
          onclick: () => { round.answer = letter; renderAlefbet(); },
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

/* ——— Сборка экрана ——— */

const TABS = [
  { id: 'letters', title: 'Буквы', render: renderLetters },
  { id: 'vowels', title: 'Огласовки', render: renderVowels },
  { id: 'reading', title: 'Чтение', render: renderReading },
  { id: 'confusing', title: 'Похожие', render: renderConfusing },
];

export function switchAlefbetTab(id) {
  state.alefbetTab = TABS.some((tab) => tab.id === id) ? id : 'letters';
  renderAlefbet();
}

export function renderAlefbet() {
  const current = state.alefbetTab || 'letters';
  const tab = TABS.find((item) => item.id === current) || TABS[0];
  const learned = LETTERS.filter((item) => isLetterLearned(item.letter)).length;

  fill('alefbet-body', [
    /* Вкладки — теми же чипами, что и во всём приложении. Раньше здесь были свои классы
       `tabs`/`tab-btn`, которым в стилях не соответствовало НИЧЕГО: на телефоне это
       выглядело мелким серым текстом, и Джон 04.09.2026 просто не нашёл раздел чтения. */
    el('div', { class: 'chip-scroll' }, TABS.map((item) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': item.id === current,
      onclick: () => switchAlefbetTab(item.id),
    }, item.title))),
    learned ? el('p', { class: 'faint alefbet-progress',
      text: `${learned} ${plural(learned, 'буква', 'буквы', 'букв')} отмечено как выученные.` }) : null,
    ...tab.render(),
  ].filter(Boolean));
}

/** Значок раздела для нижних вкладок — первая буква алефбета. */
export const alefbetTabIcon = () => el('span', { class: 'tab-icon heb', 'aria-hidden': 'true', text: 'א' });
