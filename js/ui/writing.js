import { LETTERS } from '../data/alefbet.js';
import { state } from '../core/state.js';
import { el, fill, svgEl, toast } from './dom.js';
import { showScreen } from './screens.js';

/* ═══════════════════ Пропись: показать письмо и дать обвести ═══════════════════

   ⚠️ Порядок линий в иврите НЕ закреплён. В китайском порядок штрихов кодифицирован
   и его проверяют на экзамене; здесь любой источник признаёт, что есть привычный способ,
   но допустимы варианты. Поэтому экран учит форме и ходу руки, а не заучиванию номеров,
   и говорит об этом прямо — иначе человек решит, что «неправильный» порядок это ошибка.

   Линии лежат в data/strokes.js (собраны из тех же шрифтов, что показывают буквы).
   Файл весит 30 КБ и нужен только здесь, поэтому грузится по требованию — динамическим
   import(), а не сверху вместе со всем приложением.                                    */

const BOX = 1024;              // поле, в котором заданы линии
const HIT = 132;               // допуск попадания пальцем, в единицах поля
const AHEAD = 3;               // на сколько точек вперёд разрешено «перепрыгнуть»

let strokesData = null;        // {буква: {print:[...], hand:[...]}}, грузится один раз
let session = null;            // текущая буква: начертание, шаг обводки, прогресс

/** Данные линий — по требованию: экран прописи открывают не в каждый заход. */
async function loadStrokes() {
  if (strokesData) return strokesData;
  const module = await import('../data/strokes.js');
  strokesData = module.LETTER_STROKES;
  return strokesData;
}

export async function openWriting(letter, from) {
  const item = LETTERS.find((entry) => entry.letter === letter);
  if (!item) return;
  state.cameFrom.writing = { screen: from || 'alefbet' };
  session = { letter, item, script: Boolean(state.alefbetScript), mode: 'show', stroke: 0, progress: 0, done: [] };
  showScreen('writing');
  try {
    await loadStrokes();
  } catch (error) {
    toast('Не удалось загрузить прописи. Обнови страницу.', true);
    showScreen('alefbet');
    return;
  }
  renderWriting();
  playShow();
}

/** Линии текущей буквы в выбранном начертании. */
function currentStrokes() {
  const entry = strokesData && strokesData[session.letter];
  if (!entry) return [];
  return entry[session.script ? 'hand' : 'print'] || [];
}

export function renderWriting() {
  if (!session) { showScreen('alefbet'); return; }
  /* showScreen зовёт отрисовку сразу, а линии грузятся следом — до их приезда рисуем
     заглушку. Без неё board() лез в пустые данные и валил показ экрана целиком. */
  if (!strokesData) {
    fill('writing-body', el('p', { class: 'faint', text: 'Готовлю прописи…' }));
    return;
  }
  const strokes = currentStrokes();
  const item = session.item;

  fill('writing-body', [
    el('div', { class: 'row-between writing-head' }, [
      el('div', {}, [
        el('b', { text: `${item.ru} — ${item.letter}` }),
        el('div', { class: 'faint', text: session.script
          ? 'Рукописное начертание: так пишут записку и заполняют бланк.'
          : 'Печатное начертание: так пишут в тетради, когда учат буквы.' }),
      ]),
      el('button', {
        class: 'btn btn-quiet btn-small', type: 'button',
        onclick: () => { session.script = !session.script; resetTrace(); renderWriting(); playShow(); },
      }, session.script ? 'Печатное' : 'От руки'),
    ]),

    el('div', { class: 'card writing-card' }, [board(strokes)]),

    el('div', { class: 'row writing-actions' }, [
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: playShow }, 'Показать'),
      el('button', {
        class: session.mode === 'trace' ? 'btn btn-quiet' : 'btn', type: 'button',
        onclick: () => { session.mode = session.mode === 'trace' ? 'show' : 'trace'; resetTrace(); renderWriting(); },
      }, session.mode === 'trace' ? 'Готово' : 'Обвести'),
    ]),

    el('p', { class: 'faint writing-note', text: session.mode === 'trace'
      ? `Веди по линии от точки. Движение ${session.stroke + 1} из ${strokes.length}.`
      : 'Порядок движений в иврите не закреплён — это привычный способ, а не единственный. '
        + 'Важнее форма и то, куда ведёт рука.' }),
  ]);
}

/** Поле с буквой: серый след, поверх — линии и палец. */
function board(strokes) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${BOX} ${BOX}`, class: 'writing-board',
    role: 'img', 'aria-label': `Как пишется буква ${session.item.ru}`,
  });

  /* Сама буква бледным следом — по ней и ведут. Контур лежит в данных рядом с линиями
     и посчитан тем же масштабом: набранный текстом знак вставал мимо линий. */
  const entry = strokesData[session.letter];
  const outline = entry && entry[session.script ? 'handOutline' : 'printOutline'];
  if (outline) svg.append(svgEl('path', { d: outline, class: 'writing-ghost' }));

  strokes.forEach((points, index) => {
    const path = svgEl('path', {
      d: pathData(points), class: 'writing-line',
      'data-index': String(index),
    });
    if (session.mode === 'trace') {
      if (session.done.includes(index)) path.classList.add('is-done');
      else if (index === session.stroke) path.classList.add('is-current');
      else path.classList.add('is-later');
    }
    svg.append(path);
  });

  // Точка начала текущего движения — с неё ведут
  if (session.mode === 'trace' && strokes[session.stroke]) {
    const [x, y] = strokes[session.stroke][session.progress] || strokes[session.stroke][0];
    svg.append(svgEl('circle', { cx: x, cy: y, r: 34, class: 'writing-start' }));
  }

  if (session.mode === 'trace') bindTrace(svg, strokes);
  return svg;
}

const pathData = (points) => 'M' + points.map(([x, y]) => `${x},${y}`).join(' L');

/* ——— Показ: линии рисуются одна за другой ——— */

function playShow() {
  const svg = document.querySelector('.writing-board');
  if (!svg) return;
  const lines = [...svg.querySelectorAll('.writing-line')];
  lines.forEach((line) => {
    const length = line.getTotalLength();
    line.style.strokeDasharray = String(length);
    line.style.strokeDashoffset = String(length);
    line.style.animation = 'none';
  });
  // Каждая линия ждёт, пока пройдут все предыдущие: рука не пишет две черты разом
  let delay = 0;
  lines.forEach((line) => {
    const length = line.getTotalLength();
    const duration = Math.max(0.45, Math.min(1.6, length / 900));
    line.style.animation = `writing-draw ${duration}s linear ${delay}s forwards`;
    delay += duration + 0.18;
  });
}

/* ——— Обводка пальцем ——— */

function resetTrace() {
  session.stroke = 0;
  session.progress = 0;
  session.done = [];
}

/** Точка события в координатах поля 1024. */
function toBoard(svg, event) {
  const box = svg.getBoundingClientRect();
  return [
    (event.clientX - box.left) / box.width * BOX,
    (event.clientY - box.top) / box.height * BOX,
  ];
}

function bindTrace(svg, strokes) {
  const move = (event) => {
    if (!session || session.mode !== 'trace') return;
    const points = strokes[session.stroke];
    if (!points) return;
    const [x, y] = toBoard(svg, event);

    /* Разрешаем «перепрыгнуть» несколько точек вперёд: палец идёт быстрее, чем частота
       событий, и на быстром движении между двумя кадрами укладывается полтора сантиметра.
       Назад не отматываем — иначе дрожь руки откатывала бы прогресс. */
    for (let step = 0; step < AHEAD && session.progress < points.length - 1; step += 1) {
      const [nx, ny] = points[session.progress + 1];
      if (Math.hypot(nx - x, ny - y) > HIT) break;
      session.progress += 1;
    }

    if (session.progress >= points.length - 1) finishStroke(strokes);
    else refreshTrace(svg, strokes);
  };

  svg.addEventListener('pointerdown', (event) => {
    // Захват держит палец на доске, даже если он уехал за её край. Не везде разрешён —
    // без него обводка всё равно работает, поэтому отказ гасим молча.
    try { svg.setPointerCapture(event.pointerId); } catch (error) { /* не беда */ }
    move(event);
  });
  svg.addEventListener('pointermove', (event) => {
    if (event.buttons === 0 && event.pointerType === 'mouse') return;
    move(event);
  });
}

function finishStroke(strokes) {
  session.done.push(session.stroke);
  session.progress = 0;
  session.stroke += 1;
  if (session.stroke >= strokes.length) {
    session.mode = 'show';
    renderWriting();
    toast('Буква написана целиком.');
    return;
  }
  /* Доску НЕ пересобираем: палец держит захват именно этого узла, и подмена SVG между
     движениями рвала обводку на втором штрихе. Меняем только то, что должно измениться. */
  const svg = document.querySelector('.writing-board');
  if (!svg) { renderWriting(); return; }
  svg.querySelectorAll('.writing-line').forEach((line) => {
    const index = Number(line.dataset.index);
    line.classList.toggle('is-done', session.done.includes(index));
    line.classList.toggle('is-current', index === session.stroke);
    line.classList.toggle('is-later', index > session.stroke);
    if (session.done.includes(index)) {
      line.style.strokeDasharray = '';
      line.style.strokeDashoffset = '';
    }
  });
  const note = document.querySelector('.writing-note');
  if (note) note.textContent = `Веди по линии от точки. Движение ${session.stroke + 1} из ${strokes.length}.`;
  refreshTrace(svg, strokes);
}

/** Перерисовать только то, что меняется на ходу: точку-цель и пройденную часть. */
function refreshTrace(svg, strokes) {
  const points = strokes[session.stroke];
  const start = svg.querySelector('.writing-start');
  if (start && points[session.progress]) {
    start.setAttribute('cx', String(points[session.progress][0]));
    start.setAttribute('cy', String(points[session.progress][1]));
  }
  const line = svg.querySelector(`.writing-line[data-index="${session.stroke}"]`);
  if (!line) return;
  const share = session.progress / Math.max(points.length - 1, 1);
  const length = line.getTotalLength();
  line.style.strokeDasharray = String(length);
  line.style.strokeDashoffset = String(length * (1 - share));
  line.style.animation = 'none';
}
