import { APP_VERSION, AUDIO_CACHE, STORE_EXAMS, STORE_SRS, STORE_STATS } from '../core/constants.js';
import { applyImport, dbClear, exportDatabase, planImport, setSetting } from '../core/db.js';
import { AUDIO_INDEX_URL, VOICE_COST, speech } from '../core/speech.js';
import { dayKey } from '../core/srs.js';
import { state } from '../core/state.js';
import { loadEverything } from '../main.js';
import { askConfirm, el, fill, toast } from './dom.js';
import { renderHome } from './home.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen } from './screens.js';

/* ——— Настройки: звук, огласовки, офлайн-кеш, перенос базы, тема ———
   Тоже вынесено из core/stats.js — это экран, а не логика (аудит 03.09.2026).       */

/* Слово для проверки звука — «привет», с огласовками: в указателе записей слова лежат
   в том же виде, в каком показываются на карточках. */
const HELLO = 'שָׁלוֹם';

export async function checkSound() {
  const box = document.getElementById('sound-check-result');
  fill(box, el('p', { class: 'faint', text: 'Проверяю…' }));
  const lines = [];

  lines.push(speech.clips
    ? `Записи на месте: ${Object.keys(speech.clips).length}.`
    : 'Указатель записей не загрузился — приложение не знает, где брать звук.');

  // Пробуем «шалом»: если его записи нет, берём первую попавшуюся — проверка звука
  // не должна зависеть от того, какие именно слова уже озвучены.
  const clips = speech.clips || {};
  const sample = clips[HELLO] ? HELLO : Object.keys(clips)[0];
  const file = sample ? clips[sample] : null;

  if (file) {
    try {
      const response = await fetch(`audio/${file}`, { cache: 'no-store' });
      const blob = response.ok ? await response.blob() : null;
      lines.push(response.ok
        ? `Файл скачивается: ${Math.round(blob.size / 1024)} КБ.`
        : `Файл не отдаётся: ответ ${response.status}.`);
    } catch (error) {
      lines.push(`Файл не скачался: ${error.message}.`);
    }

    const verdict = await new Promise((resolve) => {
      const player = new Audio(`audio/${file}`);
      player.addEventListener('playing', () => resolve('Запись играет — звук работает.'));
      player.addEventListener('error', () => resolve('Браузер не смог проиграть файл.'));
      player.play().catch((error) => resolve(`Браузер отклонил воспроизведение: ${error.name}. `
        + 'Обычно это значит, что звук вкладки выключен или система его глушит.'));
      setTimeout(() => resolve('Ответа от плеера нет — похоже, звук заблокирован системой.'), 4000);
    });
    lines.push(verdict);
  } else {
    lines.push('Проверять нечего: ни одной записи произношения в приложении нет.');
  }

  lines.push(speech.voice
    ? `Системный голос: ${speech.voice.name}.`
    : 'Системного голоса нет — но для слов приложения он и не нужен.');
  lines.push(`Версия приложения: ${APP_VERSION}.`);

  fill(box, lines.map((line) => el('p', { class: 'faint', style: 'margin:4px 0', text: line })));
}

function voiceHelp() {
  // Со встроенными записями звук работает и без системного голоса — это главное, что нужно сказать.
  if (speech.clips) {
    return [
      el('p', { text: `Звук работает: в приложение встроено ${Object.keys(speech.clips).length} записей произношения. Они лежат внутри и не требуют ни интернета, ни голосов системы.` }),
      el('p', { class: 'faint', text: 'Системный голос нужен только для слов, которые ты добавил сам, — для них записи нет. Если он не найден, такие слова будут молчать.' }),
    ];
  }

  const steps = [
    ['Chrome на компьютере', 'обычно приносит ивритский голос сам — открой приложение в Chrome и нажми «Проверить снова».'],
    ['Windows', 'Параметры → Время и язык → Речь → Добавить голоса → «Иврит (Израиль)».'],
    ['Android', 'Настройки → Спец. возможности → Синтез речи → Google → Установить языки → иврит.'],
    ['iPhone и iPad', 'Настройки → Универсальный доступ → Устный контент → Голоса → Иврит.'],
    ['macOS', 'Системные настройки → Универсальный доступ → Устный контент → Системный голос → Управление голосами → иврит.'],
  ];
  const list = el('div', { class: 'stack', style: 'margin-top:12px' }, steps.map(([system, action]) =>
    el('div', { class: 'faint' }, [el('b', { text: `${system}: ` }), action])));

  return [
    el('p', { text: 'Ивритского голоса в системе нет — режим «На слух» выключен, кнопки озвучки молчат.' }),
    list,
    el('button', {
      class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:12px',
      onclick: async () => {
        speech.voice = null;
        speech.ready = false;
        await speech.init();
        renderSettings();
        renderHome();
        toast(speech.available ? 'Голос найден — звуковые режимы включены.' : 'Голос всё ещё не виден.', !speech.available);
      },
    }, '↻ Проверить снова'),
  ];
}

/* ——— Огласовки ———
   Огласовки — точки и чёрточки под буквами. Они подсказывают гласные, но в живом
   израильском тексте их не пишут: рано или поздно читать придётся без них. Переключатель
   даёт спрятать их, когда чтение окрепло. Карточку рисуем здесь, а не в разметке, —
   она нужна только на этом экране и только вместе со своим обработчиком.            */

const NIQQUD_CARD_ID = 'niqqud-card';

function ensureNiqqudCard() {
  const existing = document.getElementById(NIQQUD_CARD_ID);
  if (existing) return;

  const card = el('div', { class: 'card', id: NIQQUD_CARD_ID }, [
    el('div', { class: 'row-between' }, [
      el('div', {}, [
        el('b', { text: 'Показывать огласовки' }),
        el('div', { class: 'faint', text: 'Точки под буквами подсказывают гласные. В обычном тексте их не пишут — спрячь, когда сможешь читать без них.' }),
      ]),
      el('button', { class: 'btn btn-quiet btn-small', id: 'niqqud-toggle', type: 'button', onclick: toggleNiqqud }),
    ]),
  ]);
  document.getElementById('settings-theme').closest('.card').before(card);
}

export async function toggleNiqqud() {
  state.niqqudHidden = !state.niqqudHidden;
  await setSetting('niqqudHidden', state.niqqudHidden);
  renderSettings();
}

export function renderSettings() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.getElementById('settings-theme').textContent = dark ? 'Выключить' : 'Включить';
  document.getElementById('rate-value').textContent = speech.rate.toFixed(2);
  document.getElementById('rate-input').value = String(speech.rate);
  document.getElementById('limit-value').textContent = String(state.sessionLimit);
  document.getElementById('limit-input').value = String(state.sessionLimit);

  ensureNiqqudCard();
  document.getElementById('niqqud-toggle').textContent = state.niqqudHidden ? 'Показать' : 'Скрыть';

  document.getElementById('app-version').textContent = APP_VERSION;

  // Пока озвучка не заказана, суммы нет вовсе — показываем одну честную строку.
  const rubles = Math.round(VOICE_COST.usd * VOICE_COST.rate);
  const costRows = [];
  if (VOICE_COST.usd) {
    costRows.push(el('div', { class: 'cost-row' }, [
      el('b', { class: 'cost-sum', text: `$${VOICE_COST.usd.toFixed(2)}` }),
      el('span', { class: 'cost-dash', text: '—' }),
      el('b', { class: 'cost-sum', text: `${rubles} ₽` }),
      el('span', { class: 'faint cost-rate',
        text: `курс ${VOICE_COST.rate.toFixed(2)} ₽${VOICE_COST.updated ? ` · ${VOICE_COST.updated}` : ''}` }),
    ]));
  }
  costRows.push(el('p', { class: 'faint', style: VOICE_COST.usd ? 'margin:14px 0 0' : 'margin:0',
    text: VOICE_COST.clips
      ? `${VOICE_COST.clips} записей слов и фраз`
      : 'Записей пока нет — озвучка ещё не заказана.' }));
  fill('voice-cost', costRows);

  // Chrome прячет установку в меню — показываем свою кнопку, когда браузер разрешил.
  document.getElementById('install-card').classList.toggle('hidden', !state.installPrompt);

  refreshOfflineStatus();       // сколько записей уже лежит офлайн

  const status = document.getElementById('voice-status');
  if (speech.clips) fill(status, voiceHelp());
  else if (speech.voice) fill(status, [`Голос системы: ${speech.voice.name} (${speech.voice.lang}).`]);
  else fill(status, voiceHelp());
  document.getElementById('rate-test').disabled = !speech.available;

  const canShareFiles = Boolean(navigator.canShare
    && navigator.canShare({ files: [new File([''], 'p.json', { type: 'application/json' })] }));
  document.getElementById('share-btn').classList.toggle('hidden', !canShareFiles);
  document.getElementById('share-hint').textContent = canShareFiles
    ? 'Кнопка «Отправить файл» откроет выбор приложения — Telegram, почта, что угодно.'
    : 'Это устройство не умеет отправлять файлы напрямую — скачай файл и перешли его сам.';
}

/* ——— Сколько записей уже лежит офлайн ———
   Просьба владельца: кнопка не должна молчать. Пока непонятно, скачано всё или половина,
   человек жмёт её вслепую и не знает, надо ли ещё раз.                                */

async function audioOfflineStatus() {
  const words = await fetch(AUDIO_INDEX_URL).then((response) => response.json());
  const urls = Object.values(words).map((name) => `audio/${name}`);

  const cache = await caches.open(AUDIO_CACHE);
  const found = await Promise.all(urls.map((url) => cache.match(url).then(Boolean)));
  return { total: urls.length, ready: found.filter(Boolean).length };
}

/** Обновляет надпись и вид кнопки: скачано всё — зелёным, часть — предложением докачать. */
export async function refreshOfflineStatus() {
  const button = document.getElementById('offline-btn');
  const status = document.getElementById('offline-status');
  const card = button.closest('.card');
  if (!('caches' in window)) { status.textContent = 'Этот браузер не умеет хранить записи офлайн.'; return; }

  status.textContent = 'Считаю, что уже скачано…';
  try {
    const { total, ready } = await audioOfflineStatus();
    const left = total - ready;
    card.classList.toggle('is-ok', left === 0);
    if (left === 0) {
      fill(button, iconLabel('check', 'Всё скачано'));
      status.textContent = `Все ${total} записей лежат в памяти — интернет для озвучки не нужен.`;
    } else if (ready === 0) {
      fill(button, [el('span', { text: 'Скачать всю озвучку' })]);
      status.textContent = `Пока не скачано ничего из ${total} записей. Они подтягиваются `
        + 'по мере прослушивания, но можно забрать все разом.';
    } else {
      fill(button, [el('span', { text: `Докачать ${left}` })]);
      status.textContent = `Скачано ${ready} из ${total}. Остальные подтянутся сами при `
        + 'прослушивании — или нажми, чтобы забрать разом.';
    }
  } catch (error) {
    status.textContent = 'Не удалось проверить, что скачано.';
  }
}

/**
 * Кладёт все записи произношения в кеш, чтобы озвучка работала полностью без интернета.
 * Иначе запись подтягивается только при первом прослушивании — в офлайне её просто нет.
 */
export async function cacheAllAudio() {
  const button = document.getElementById('offline-btn');
  const status = document.getElementById('offline-status');
  button.disabled = true;

  try {
    const words = await fetch(AUDIO_INDEX_URL).then((response) => response.json());
    const urls = Object.values(words).map((name) => `audio/${name}`);

    const cache = await caches.open(AUDIO_CACHE);   // тот же кеш, что у Service Worker
    let done = 0;
    let failed = 0;
    const PARALLEL = 8;

    const worker = async () => {
      while (urls.length) {
        const url = urls.pop();
        try {
          const hit = await cache.match(url);
          if (!hit) await cache.add(url);
        } catch (error) {
          failed += 1;
        }
        done += 1;
        if (done % 25 === 0) status.textContent = `Скачано ${done}…`;
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));

    if (failed) {
      status.textContent = `${done - failed} записей на месте, ${failed} не скачались — попробуй ещё раз.`;
    } else {
      await refreshOfflineStatus();
    }
  } catch (error) {
    status.textContent = 'Не вышло скачать записи — проверь интернет и попробуй снова.';
  } finally {
    button.disabled = false;
    if (!document.getElementById('offline-status').textContent.includes('не скачались')) {
      await refreshOfflineStatus();
    }
  }
}

/**
 * Отправляет файл базы через системное окно «Поделиться» — так его можно сразу закинуть
 * себе в Telegram и открыть на другом устройстве, не роясь в папке загрузок.
 * Где такого окна нет (обычно на компьютере) — просто скачиваем файл.
 */
export async function shareDatabase() {
  const payload = await exportDatabase();
  const file = new File([JSON.stringify(payload, null, 2)], `ivrit-${dayKey()}.json`,
    { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Мой прогресс в иврите' });
      toast('Отправлено. На другом устройстве открой файл кнопкой «Загрузить».');
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;   // человек передумал — это не ошибка
    }
  }
  await exportToFile();
}

export async function exportToFile() {
  const payload = await exportDatabase();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `ivrit-${dayKey()}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Файл выгружен — сохрани его в надёжном месте.');
}

export async function importFromFile(file) {
  try {
    const text = await file.text();
    const plan = await planImport(JSON.parse(text));
    const agreed = await askConfirm({
      title: 'Что будет добавлено',
      text: `В файле ${plan.payload.words.length} слов: новых ${plan.newWords}, уже есть ${plan.knownWords}. `
        + `Записей прогресса ${plan.progressRecords}, дней статистики ${plan.days}.`,
      hint: 'Слова, которые уже есть, останутся как есть. Прогресс сливается: по каждому слову '
        + 'остаётся более свежая запись, дни статистики складываются, открытый уровень назад не откатится.',
      confirmLabel: 'Загрузить',
      exportFirst: exportToFile,
    });
    if (!agreed) return;
    await applyImport(plan);
    await loadEverything();
    showScreen('home');
    toast(`Загружено: ${plan.newWords} новых слов.`);
  } catch (error) {
    toast(`Не вышло прочитать файл: ${error.message}`, true);
  }
}

export async function resetProgress() {
  const agreed = await askConfirm({
    title: 'Сбросить прогресс?',
    text: 'Удалятся интервалы повторений, статистика по дням и результаты экзаменов. Сами слова останутся на месте.',
    hint: 'Это не отменить. Если файл базы ещё не выгружен — выгрузи сначала.',
    confirmLabel: 'Сбросить',
    exportFirst: exportToFile,
  });
  if (!agreed) return;
  await Promise.all([dbClear(STORE_SRS), dbClear(STORE_STATS), dbClear(STORE_EXAMS)]);
  await setSetting('unlockedLevel', 1);
  await loadEverything();
  showScreen('home');
  toast('Прогресс сброшен.');
}

/* ——— Тема ——— */

async function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // Кнопка показывает, что произойдёт по нажатию: луна — уйти в тёмную, солнце — вернуться в светлую.
  fill('theme-toggle', uiIcon(theme === 'dark' ? 'sun' : 'moon', 20));
  document.querySelector('meta[name="theme-color"]')
    .setAttribute('content', theme === 'dark' ? '#0f1117' : '#f6f7fb');
  await setSetting('theme', theme);
  if (state.screen === 'settings') renderSettings();
}

export const toggleTheme = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
