import { isLearned } from '../core/srs.js';
import { state } from '../core/state.js';
import { el, fill, svgEl } from './dom.js';
import { showScreen } from './screens.js';

/* ——— Ранг ученика ———
   Просьба владельца «для веселья»: свой уровень со шкалой и рисунком.
   Опыт не хранится отдельно — он всегда пересчитывается из того, что уже сделано,
   поэтому его невозможно рассинхронизировать с реальным прогрессом.

   Ступеней девять: три зверя (орёл → леопард → левиафан), внутри каждого три металла
   (лазурь → серебро → золото). Названия — настоящие ивритские слова, так ступени
   заодно работают словарём: תְּכֵלֶת «лазурь», כֶּסֶף «серебро», זָהָב «золото»,
   נֶשֶׁר «орёл», נָמֵר «леопард», לִוְיָתָן «левиафан» — морской змей из книги Иова.
   Персонаж — странник: дорожный плащ, шляпа от солнца, прямой меч.  */

const XP_PER_CORRECT = 1;        // верный ответ в тренировке
const XP_PER_LEARNED = 5;        // выученное слово
const XP_PER_EXAM = 25;          // сданный экзамен

const RANK_METALS = {
  lazur: { from: '#1F7A63', to: '#3FB89A', stroke: '#165A49', soft: '#3FB89A' },
  serebro: { from: '#7C8794', to: '#D8DEE6', stroke: '#5C6570', soft: '#A9B2BE' },
  zoloto: { from: '#A9761B', to: '#F5D169', stroke: '#7C5410', soft: '#E0B45A' },
};

const PLAYER_RANKS = [
  { level: 1, xp: 0, heb: 'נֶשֶׁר תְּכֵלֶת', translit: 'не́шер техе́лет', name: 'Лазурный орёл', beast: 'eagle', metal: 'lazur' },
  { level: 2, xp: 60, heb: 'נֶשֶׁר כֶּסֶף', translit: 'не́шер ке́сеф', name: 'Серебряный орёл', beast: 'eagle', metal: 'serebro' },
  { level: 3, xp: 160, heb: 'נֶשֶׁר זָהָב', translit: 'не́шер заhа́в', name: 'Золотой орёл', beast: 'eagle', metal: 'zoloto' },
  { level: 4, xp: 320, heb: 'נָמֵר תְּכֵלֶת', translit: 'наме́р техе́лет', name: 'Лазурный леопард', beast: 'tiger', metal: 'lazur' },
  { level: 5, xp: 560, heb: 'נָמֵר כֶּסֶף', translit: 'наме́р ке́сеф', name: 'Серебряный леопард', beast: 'tiger', metal: 'serebro' },
  { level: 6, xp: 900, heb: 'נָמֵר זָהָב', translit: 'наме́р заhа́в', name: 'Золотой леопард', beast: 'tiger', metal: 'zoloto' },
  { level: 7, xp: 1400, heb: 'לִוְיָתָן תְּכֵלֶת', translit: 'ливята́н техе́лет', name: 'Лазурный левиафан', beast: 'dragon', metal: 'lazur' },
  { level: 8, xp: 2100, heb: 'לִוְיָתָן כֶּסֶף', translit: 'ливята́н ке́сеф', name: 'Серебряный левиафан', beast: 'dragon', metal: 'serebro' },
  { level: 9, xp: 3000, heb: 'לִוְיָתָן זָהָב', translit: 'ливята́н заhа́в', name: 'Золотой левиафан', beast: 'dragon', metal: 'zoloto' },
];

function playerExperience() {
  const days = Array.from(state.stats.values());
  const correct = days.reduce((sum, day) => sum + (day.correct || 0), 0);
  const learned = state.words.filter((word) => isLearned(state.srs.get(word.id))).length;
  const exams = Array.from(state.exams.values()).filter((record) => record.passed).length;
  return correct * XP_PER_CORRECT
    + learned * XP_PER_LEARNED
    + exams * XP_PER_EXAM;
}

function playerRank() {
  const xp = playerExperience();
  let current = PLAYER_RANKS[0];
  PLAYER_RANKS.forEach((rank) => { if (xp >= rank.xp) current = rank; });
  const next = PLAYER_RANKS.find((rank) => rank.xp > xp) || null;
  const span = next ? next.xp - current.xp : 1;
  const done = next ? xp - current.xp : 1;
  return {
    xp,
    rank: current,
    next,
    percent: Math.round((done / span) * 100),
    toNext: next ? next.xp - xp : 0,
  };
}

/* ——— Рисунки ———
   Четыре штуки: странник, орёл, леопард, левиафан. Металл задаётся параметром, поэтому
   девять ступеней обходятся четырьмя рисунками. Градиенту нужен свой id на каждый
   экземпляр, иначе два рисунка на экране перебивают заливку друг другу.          */

let rankPaintCounter = 0;

function rankGradient(svg, metal) {
  const colors = RANK_METALS[metal] || RANK_METALS.lazur;
  rankPaintCounter += 1;
  const id = `rank-paint-${rankPaintCounter}`;
  const gradient = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(svgEl('stop', { offset: '0', 'stop-color': colors.from }));
  gradient.append(svgEl('stop', { offset: '1', 'stop-color': colors.to }));
  const defs = svgEl('defs', {});
  defs.append(gradient);
  svg.append(defs);
  return { fill: `url(#${id})`, stroke: colors.stroke, soft: colors.soft };
}

function rankCanvas(size) {
  return svgEl('svg', {
    viewBox: '0 0 120 120', width: size || 48, height: size || 48,
    'aria-hidden': 'true', class: 'rank-art',
  });
}

/** Орёл: вид спереди, крылья раскрыты, голова в профиль вправо. Начало пути. */
function eagleEmblem(metal, size) {
  const svg = rankCanvas(size);
  const paint = rankGradient(svg, metal);
  const shape = { fill: paint.fill, stroke: paint.stroke, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

  // Крылья — крупными гранями, без мелких перьев: иконка должна читаться и в 32 пикселя
  svg.append(svgEl('path', Object.assign({ d: 'M54 48 L8 28 L22 52 L10 54 L34 72 L54 72 Z' }, shape)));
  svg.append(svgEl('path', Object.assign({ d: 'M66 48 L112 28 L98 52 L110 54 L86 72 L66 72 Z' }, shape)));
  // тело клином, хвост книзу
  svg.append(svgEl('path', Object.assign({ d: 'M60 34 L48 64 L60 104 L72 64 Z' }, shape)));
  // голова с клювом вправо
  svg.append(svgEl('circle', Object.assign({ cx: 60, cy: 30, r: 13 }, shape)));
  svg.append(svgEl('path', Object.assign({ d: 'M72 25 L90 30 L72 37 Z' }, shape)));
  svg.append(svgEl('circle', { cx: 65, cy: 27, r: 2.4, fill: paint.stroke }));
  return svg;
}

/** Леопард: голова анфас, пятна на лбу — без них большого кота не узнать. Середина пути. */
function tigerEmblem(metal, size) {
  const svg = rankCanvas(size);
  const paint = rankGradient(svg, metal);
  const shape = { fill: paint.fill, stroke: paint.stroke, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

  svg.append(svgEl('circle', Object.assign({ cx: 34, cy: 36, r: 15 }, shape)));   // уши
  svg.append(svgEl('circle', Object.assign({ cx: 86, cy: 36, r: 15 }, shape)));
  svg.append(svgEl('path', Object.assign({
    d: 'M60 20 C88 20 98 40 98 62 C98 90 82 104 60 104 C38 104 22 90 22 62 C22 40 32 20 60 20 Z' }, shape)));

  const ink = { fill: 'none', stroke: paint.stroke, 'stroke-width': 3.4,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  // пятна на лбу
  const spot = { fill: paint.stroke, opacity: '.75' };
  svg.append(svgEl('circle', Object.assign({ cx: 50, cy: 38, r: 3.6 }, spot)));
  svg.append(svgEl('circle', Object.assign({ cx: 63, cy: 32, r: 3 }, spot)));
  svg.append(svgEl('circle', Object.assign({ cx: 72, cy: 44, r: 3.4 }, spot)));
  svg.append(svgEl('circle', Object.assign({ cx: 57, cy: 50, r: 2.8 }, spot)));
  // усы по бокам
  svg.append(svgEl('path', Object.assign({ d: 'M26 52l8 4M26 66l9 3M30 80l9 1' }, ink)));
  svg.append(svgEl('path', Object.assign({ d: 'M94 52l-8 4M94 66l-9 3M90 80l-9 1' }, ink)));
  // глаза и нос
  svg.append(svgEl('circle', { cx: 46, cy: 70, r: 4, fill: paint.stroke }));
  svg.append(svgEl('circle', { cx: 74, cy: 70, r: 4, fill: paint.stroke }));
  svg.append(svgEl('path', Object.assign({ d: 'M54 84 L60 90 L66 84 Z' },
    { fill: paint.stroke, stroke: paint.stroke, 'stroke-width': 2, 'stroke-linejoin': 'round' })));
  return svg;
}

/** Левиафан: морской змей — длинное тело кольцом, рога и усы, крыльев нет. Вершина. */
function dragonEmblem(metal, size) {
  const svg = rankCanvas(size);
  const paint = rankGradient(svg, metal);
  const body = { fill: 'none', stroke: paint.fill, 'stroke-width': 13,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const edge = { fill: 'none', stroke: paint.stroke, 'stroke-width': 2.2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: '.75' };

  const spiral = 'M84 34 C64 16 30 26 26 52 C22 78 46 96 68 90 C86 85 92 68 80 60';
  svg.append(svgEl('path', Object.assign({ d: spiral }, body)));
  svg.append(svgEl('path', Object.assign({ d: spiral }, edge)));

  // плавники
  const claw = { fill: 'none', stroke: paint.stroke, 'stroke-width': 2.6,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  svg.append(svgEl('path', Object.assign({ d: 'M34 74l-10 8M28 78l-2 8M40 84l-6 10' }, claw)));
  svg.append(svgEl('path', Object.assign({ d: 'M62 96l-2 10M72 92l4 10' }, claw)));

  // голова: морда, рог, ус
  svg.append(svgEl('circle', Object.assign({ cx: 88, cy: 30, r: 13 },
    { fill: paint.fill, stroke: paint.stroke, 'stroke-width': 2 })));
  svg.append(svgEl('path', Object.assign({ d: 'M92 18l6-10M84 18l-2-11' }, claw)));
  svg.append(svgEl('path', Object.assign({ d: 'M98 34c8 2 12 8 12 14' }, claw)));
  svg.append(svgEl('circle', { cx: 92, cy: 27, r: 2.4, fill: paint.stroke }));
  return svg;
}

/* Ключ beast выбирает рисунок: eagle — орёл, tiger — леопард, dragon — левиафан. */
const RANK_EMBLEMS = { eagle: eagleEmblem, tiger: tigerEmblem, dragon: dragonEmblem };

const rankEmblem = (rank, size) => (RANK_EMBLEMS[rank.beast] || eagleEmblem)(rank.metal, size);

/** Странник: дорожный плащ с запáхом, кушак, прямой меч. Облик растёт со ступенью. */
function warriorFigure(rank, size) {
  const svg = rankCanvas(size);
  const paint = rankGradient(svg, rank.metal);
  const cloth = { fill: paint.fill, stroke: paint.stroke, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  const ink = { fill: 'none', stroke: paint.stroke, 'stroke-width': 2.4,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const tier = rank.beast;

  // накидка на верхней ступени — рисуем первой, она за спиной
  if (tier === 'dragon') {
    svg.append(svgEl('path', Object.assign({
      d: 'M74 40 C104 52 108 84 96 106 L74 96 Z', opacity: '.55' }, cloth)));
  }

  // меч за спиной (на верхней ступени он в руке — ниже)
  if (tier !== 'dragon') {
    svg.append(svgEl('path', Object.assign({ d: 'M40 96 L82 44' },
      { fill: 'none', stroke: paint.stroke, 'stroke-width': 4, 'stroke-linecap': 'round' })));
    svg.append(svgEl('path', Object.assign({ d: 'M74 46l8 6' }, ink)));   // гарда
  }

  // голова, пучок волос
  svg.append(svgEl('circle', Object.assign({ cx: 56, cy: 30, r: 12 }, cloth)));
  svg.append(svgEl('circle', Object.assign({ cx: 56, cy: 14, r: 5 }, cloth)));
  svg.append(svgEl('path', Object.assign({ d: 'M50 33h12' }, ink)));       // намёк на лицо

  // плащ до голеней, запáх направо
  svg.append(svgEl('path', Object.assign({
    d: 'M38 50 C38 44 46 42 56 42 C66 42 74 44 74 50 L80 104 L32 104 Z' }, cloth)));
  svg.append(svgEl('path', Object.assign({ d: 'M56 42 L44 70' }, ink)));   // запáх
  // кушак
  svg.append(svgEl('rect', Object.assign({ x: 34, y: 66, width: 44, height: 9, rx: 3 },
    { fill: paint.stroke, opacity: '.85' })));

  // рукава
  svg.append(svgEl('path', Object.assign({ d: 'M38 52 L24 76 L34 80' }, cloth)));
  svg.append(svgEl('path', Object.assign({ d: 'M74 52 L88 76 L78 80' }, cloth)));

  if (tier === 'tiger') {
    // широкополая шляпа от солнца надета, наручи
    svg.append(svgEl('path', Object.assign({ d: 'M30 24 L56 4 L82 24 Z' }, cloth)));
    svg.append(svgEl('path', Object.assign({ d: 'M26 76h12M82 76h12' }, ink)));
  }
  if (tier === 'eagle') {
    // шляпа висит за спиной на шнурке — путь только начинается
    svg.append(svgEl('path', Object.assign({ d: 'M84 66 a11 7 0 1 0 22 0 z' }, cloth)));
    svg.append(svgEl('path', Object.assign({ d: 'M70 50 C82 54 90 58 94 64' }, ink)));
  }
  if (tier === 'dragon') {
    // меч в руке и вихрь у ног
    svg.append(svgEl('path', Object.assign({ d: 'M88 76 L108 34' },
      { fill: 'none', stroke: paint.stroke, 'stroke-width': 4, 'stroke-linecap': 'round' })));
    svg.append(svgEl('path', Object.assign({ d: 'M100 44l8 4' }, ink)));
    svg.append(svgEl('path', Object.assign({
      d: 'M24 110c12-6 26-6 38 0M34 116c14-5 28-5 42 0' }, ink, { opacity: '.6' })));
  }
  return svg;
}

/** Значок в шапке: эмблема зверя и номер ступени, по нажатию — подробности. */
export function renderPlayerBadge() {
  const state_ = playerRank();
  const rank = state_.rank;
  const button = el('button', {
    class: 'player-badge', type: 'button',
    title: `${rank.name}, опыт ${state_.xp}`,
    'aria-label': `Ступень ${rank.level}, ${rank.name}`,
    onclick: () => { state.progressTab = 'awards'; showScreen('progress'); },
  }, [
    el('span', { class: 'badge-beast heb', style: `color:${RANK_METALS[rank.metal].soft}`,
      text: rank.heb.split(' ')[0] }),
    el('span', { class: 'player-level', text: String(rank.level) }),
  ]);
  fill('player-slot', button);
}

export function renderPlayerCard() {
  const progress = playerRank();
  const rank = progress.rank;
  const metal = RANK_METALS[rank.metal];
  const top = rank.level === PLAYER_RANKS.length;
  return el('div', { class: `card rank-card${top ? ' is-top' : ''}` }, [
    el('div', { class: 'rank-row' }, [
      warriorFigure(rank, 96),
      el('div', { class: 'rank-titles' }, [
        el('div', { class: 'rank-heb heb', text: rank.heb }),
        el('div', { class: 'rank-translit', text: rank.translit }),
        el('div', { class: 'muted', text: rank.name }),
        el('div', { class: 'faint', text: `Ступень ${rank.level} из ${PLAYER_RANKS.length} · опыт ${progress.xp}` }),
      ]),
      rankEmblem(rank, 56),
    ]),
    el('div', { class: 'level-bar' },
      el('span', { style: `width:${progress.percent}%;background:${metal.soft}` })),
    el('p', { class: 'faint', text: progress.next
      ? `До ступени «${progress.next.name.toLowerCase()}» — ${progress.toNext} опыта. `
        + 'Опыт дают верные ответы, выученные слова и сданные экзамены.'
      : 'Выше некуда: золотой левиафан — девятая ступень.' }),
  ]);
}
