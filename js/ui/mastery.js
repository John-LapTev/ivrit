import { speech } from '../core/speech.js';
import { isStarted } from '../core/srs.js';
import { state } from '../core/state.js';
import { splitHebrewLetters, wordKey } from '../core/translit.js';
import { el, fill, plural } from './dom.js';

/* ——— Изученные слова: насколько слово закреплено ———
   Иван 03.09.2026: «хочу видеть не на глаз, а по цифрам, какие слова даются тяжелее».
   Счёт слова = верные ответы минус ошибки во всех режимах («не знаю» — тоже ошибка).
   Ошибся — счёт падает, и слово откатывается назад: так видно настоящее положение дел,
   а не сумму попыток.                                                                  */

/* Три верхних ранга носят свои имена (Иван 03.09.2026: золотой, алмазный, рубиновый)
   и живую рамку: по контуру бежит светящаяся линия. Приём взят из примера, который он
   прислал (Uiverse, june7011): градиент «прозрачный → цвет → прозрачный» плюс его же
   размытая копия под ним — она и даёт свечение. */
export const WORD_RANKS = [
  { id: 'none', from: 0, title: 'Новое', color: 'нет рамки',
    note: 'ответов пока мало или ошибок столько же, сколько верных' },
  { id: 'bronze', from: 5, title: 'Бронза', color: 'бронзовая рамка',
    note: 'слово начало держаться' },
  { id: 'silver', from: 12, title: 'Серебро', color: 'серебряная, светится',
    note: 'узнаёшь уверенно' },
  { id: 'gold', from: 22, title: 'Золото', color: 'по золотой рамке бежит свет',
    note: 'почти не ошибаешься', glow: true },
  { id: 'diamond', from: 35, title: 'Алмаз', color: 'холодный блеск по контуру',
    note: 'знаешь без раздумий', glow: true },
  { id: 'ruby', from: 50, title: 'Рубин', color: 'красная линия, живое свечение',
    note: 'закреплено намертво', glow: true },
];

/** Верные, ошибки и чистый счёт слова. Ошибка ударения — тоже ошибка, но своя: слово узнано. */
export function wordScore(word) {
  const record = state.srs.get(word.id);
  if (!record) return { right: 0, wrong: 0, score: 0, seen: 0 };
  const wrong = (record.errors || 0) + (record.stressErrors || 0);
  const right = Math.max(0, (record.seen || 0) - wrong);
  return { right, wrong, score: Math.max(0, right - wrong), seen: record.seen || 0 };
}

export function rankOf(score) {
  let found = WORD_RANKS[0];
  WORD_RANKS.forEach((rank) => { if (score >= rank.from) found = rank; });
  return found;
}

const nextRank = (rank) => WORD_RANKS[WORD_RANKS.indexOf(rank) + 1] || null;

/** Размер слова в плитке: с шести букв слово уже переносится на две строки, поэтому
    крупный кегль оставляем коротким. Считаем именно буквы — огласовки ширины не
    добавляют, поэтому берём splitHebrewLetters, а не длину строки. */
const HEB_SIZES = { 1: 32, 2: 32, 3: 30, 4: 26, 5: 22, 6: 19, 7: 17 };
const hebSize = (heb) => HEB_SIZES[Math.min(splitHebrewLetters(heb).length, 7)] || 15;

/** Слова, которые уже были в тренировке — новые в список не попадают. */
const studiedWords = () => state.words.filter((word) => isStarted(state.srs.get(word.id)));

/** Плитка слова. Одна и та же и в общей сетке, и в легенде — чтобы образец не врал. */
function wordTile(word, counts) {
  const rank = rankOf(counts.score);
  return el('button', {
    class: `mastery-tile is-${rank.id}`, type: 'button',
    title: `${word.heb} — ${word.translation}\nверно ${counts.right}, ошибок ${counts.wrong}, `
      + `счёт ${counts.score} · ${rank.title}`,
    'aria-label': `${word.heb}: верно ${counts.right}, ошибок ${counts.wrong}`,
    onclick: () => { if (speech.available) speech.speak(word.heb); },
  }, [
    // Размытая копия бегущей линии: она и есть свечение. Чёткую линию рисует ::after,
    // обе крутятся с одним периодом, поэтому свет идёт единым пятном.
    rank.glow ? el('span', { class: 'tile-glow', 'aria-hidden': 'true' },
      el('span', { class: 'tile-ring' })) : null,
    // Длинное слово в плитку по-крупному не влезает — уменьшаем ровно настолько, сколько нужно
    el('span', { class: 'heb mastery-heb', text: word.heb,
      style: `font-size:${hebSize(word.heb)}px` }),
    el('span', { class: 'mastery-translit', text: word.translit }),
    el('span', { class: 'mastery-score' }, [
      el('b', { class: 'is-right', text: `+${counts.right}` }),
      counts.wrong ? el('b', { class: 'is-wrong', text: `−${counts.wrong}` }) : null,
    ].filter(Boolean)),
  ].filter(Boolean));
}

/** Образец ранга в легенде: та же рамка и то же свечение, но внутри одно название.
    Иван 03.09.2026: слово, чтение и цифры на образце лишние — легенда от них разъезжалась. */
function rankSample(rank) {
  return el('span', { class: `mastery-tile is-sample is-${rank.id}` }, [
    rank.glow ? el('span', { class: 'tile-glow', 'aria-hidden': 'true' },
      el('span', { class: 'tile-ring' })) : null,
    el('span', { text: rank.title }),
  ].filter(Boolean));
}

export function renderMastery() {
  const words = studiedWords().map((word) => Object.assign({ word }, wordScore(word)))
    .sort((first, second) => second.score - first.score
      || second.right - first.right
      // сравниваем не видимые строки, а ключ без огласовок: точки порядок бы перемешали
      || wordKey(first.word.heb).localeCompare(wordKey(second.word.heb)));

  if (!words.length) {
    fill('progress-body', el('div', { class: 'card' }, [
      el('b', { text: 'Пока пусто' }),
      el('p', { class: 'faint', text: 'Слово появляется здесь, когда ты ответил на него хотя бы раз. '
        + 'Пройди тренировку — и возвращайся.' }),
    ]));
    return;
  }

  const children = [
    el('div', { class: 'card' }, [
      el('b', { text: 'Как читать цвета' }),
      el('p', { class: 'faint', text: 'Счёт слова — это верные ответы минус ошибки. '
        + 'Ошибся или нажал «не знаю» — счёт падает, слово откатывается назад. Считаются все '
        + 'режимы, кроме экзаменов: там приложение только проверяет и в статистику не пишет.' }),
      // Образцы — настоящие плитки со случайными словами: так видно и цвет, и анимацию.
      // Числа на них показательные, в общий список и в статистику они не идут.
      el('div', { class: 'rank-legend' }, WORD_RANKS.map((rank) => {
        const next = nextRank(rank);
        return el('div', { class: 'rank-legend-row' }, [
          rankSample(rank),
          el('span', {}, [
            el('div', { class: 'rank-legend-title', text: next
              ? `счёт ${rank.from}–${next.from - 1}` : `счёт ${rank.from} и выше` }),
            el('div', { class: 'faint', text: rank.note }),
          ]),
        ]);
      })),
    ]),
  ];

  // Сводка по уровням: сколько слов докатилось до каждого цвета
  const counts = new Map(WORD_RANKS.map((rank) => [rank.id, 0]));
  words.forEach((item) => {
    const rank = rankOf(item.score);
    counts.set(rank.id, counts.get(rank.id) + 1);
  });
  children.push(el('p', { class: 'faint', style: 'margin-top:20px',
    text: `${words.length} ${plural(words.length, 'слово', 'слова', 'слов')} в работе: `
      + WORD_RANKS.slice().reverse().filter((rank) => counts.get(rank.id))
        .map((rank) => `${rank.title.toLowerCase()} — ${counts.get(rank.id)}`).join(', ') + '.' }));

  children.push(el('div', { class: 'mastery-grid' },
    words.map((item) => wordTile(item.word, item))));

  fill('progress-body', children);
}
