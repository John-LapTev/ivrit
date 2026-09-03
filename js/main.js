import { AUDIO_CACHE, DEFAULT_SESSION_LIMIT, DEFAULT_SPEECH_RATE, NIQQUD_HIDDEN_DEFAULT, STORE_EXAMS, STORE_GRAMMAR, STORE_HARD, STORE_LETTERS, STORE_SRS, STORE_STATS, STORE_WORDS, USER_LEVEL } from './core/constants.js';
import { dbGetAll, getSetting, connect, memoryOnly, seedDatabaseIfEmpty, seedMissingWords, setSetting } from './core/db.js';
import { translitPhrase } from './core/translit.js';
import { speech } from './core/speech.js';
import { state } from './core/state.js';
import { switchProgressTab } from './ui/progress.js';
import { cacheAllAudio, checkSound, exportToFile, importFromFile, renderSettings, resetProgress, shareDatabase, toggleTheme } from './ui/settings.js';
import { closeCharSheet, parseBulkInput, renderBulkPreview, renderDictionary, saveWord } from './ui/dict.js';
import { el, fill, toast } from './ui/dom.js';
import { allTopics, renderHome } from './ui/home.js';
import { ALL_TOPICS, uiIcon } from './ui/icons.js';
import { showScreen } from './ui/screens.js';
import { beginTraining, exitTraining, handleKeydown, restartTraining } from './ui/train.js';
import { exitHardDrill, handleHardKey, restartHardDrill } from './ui/hard-drill.js';
import { exitDialog } from './ui/dialogs-screen.js';
import { restartLesson } from './ui/grammar.js';
import { switchGrammarTab } from './ui/tabs.js';
import { exitTeacherTask, restartTeacherTask } from './ui/teacher-tasks.js';

/* ═══════════════════ Запуск ═══════════════════ */

export async function loadEverything() {
  const [words, srsRecords, statsRecords, examRecords, hardRecords, letterRecords, grammarRecords] =
    await Promise.all([
      dbGetAll(STORE_WORDS), dbGetAll(STORE_SRS), dbGetAll(STORE_STATS),
      dbGetAll(STORE_EXAMS), dbGetAll(STORE_HARD),
      dbGetAll(STORE_LETTERS), dbGetAll(STORE_GRAMMAR),
    ]);
  state.words = words;
  state.srs = new Map(srsRecords.map((record) => [record.wordId, record]));
  state.stats = new Map(statsRecords.map((record) => [record.date, record]));
  state.exams = new Map(examRecords.map((record) => [record.level, record]));
  state.hard = new Map(hardRecords.map((record) => [record.wordId, record]));
  state.letterProgress = new Map(letterRecords.map((record) => [record.letter, record]));
  // Уроки грамматики и разговоры лежат в одном хранилище: у сценки ключ `dialog:<id>`
  state.grammarProgress = new Map(grammarRecords.map((record) => [record.lessonId, record]));
  // Отметки программы занятий живут в настройках одной записью: день, шаги, даты
  state.teacher = await getSetting('teacher', null);
  state.unlockedLevel = await getSetting('unlockedLevel', 1);
  state.sessionLimit = await getSetting('sessionLimit', DEFAULT_SESSION_LIMIT);
  speech.rate = await getSetting('speechRate', DEFAULT_SPEECH_RATE);
  state.niqqudHidden = await getSetting('niqqudHidden', NIQQUD_HIDDEN_DEFAULT);

  const datalist = document.getElementById('topic-options');
  fill(datalist, allTopics().filter((topic) => topic !== ALL_TOPICS)
    .map((topic) => el('option', { value: topic })));
}

/** Держит `--header-h` равной реальной высоте шапки: при крупном системном шрифте
    она выше, и содержимое экрана заезжало под неё (жалоба владельца 15.08.2026). */
function trackHeaderHeight() {
  const header = document.querySelector('.app-header');
  const apply = () => {
    document.documentElement.style.setProperty('--header-h', `${Math.ceil(header.offsetHeight)}px`);
  };
  apply();
  if ('ResizeObserver' in window) new ResizeObserver(apply).observe(header);
  window.addEventListener('resize', apply);
}

function bindEvents() {
  trackHeaderHeight();
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('settings-theme').addEventListener('click', toggleTheme);
  document.getElementById('start-btn').addEventListener('click', beginTraining);
  document.getElementById('train-exit').addEventListener('click', exitTraining);
  document.getElementById('hard-exit').addEventListener('click', exitHardDrill);
  document.getElementById('hard-back').addEventListener('click', () => showScreen(state.hardReturn || 'home'));

  // «Заново» — пройти тот же блок ещё раз, не выходя с экрана (просьба владельца 25.08.2026)
  document.getElementById('train-restart').addEventListener('click', restartTraining);
  document.getElementById('hard-restart').addEventListener('click', restartHardDrill);

  document.querySelectorAll('[data-go]').forEach((node) => {
    node.addEventListener('click', () => showScreen(node.dataset.go));
  });

  document.getElementById('dict-add-btn').addEventListener('click', () => showScreen('add'));
  document.getElementById('dict-import-btn').addEventListener('click', () => showScreen('bulk'));
  document.getElementById('dict-search').addEventListener('input', (event) => {
    state.dictSearch = event.target.value;
    renderDictionary();
  });

  document.querySelectorAll('[data-progress-tab]').forEach((button) => {
    button.addEventListener('click', () => switchProgressTab(button.dataset.progressTab));
  });
  document.querySelectorAll('[data-grammar-tab]').forEach((button) => {
    button.addEventListener('click', () => switchGrammarTab(button.dataset.grammarTab));
  });

  // Экраны урока, разговора и задания дня: «назад» и «заново» у каждого свои
  document.getElementById('lesson-restart').addEventListener('click', restartLesson);
  document.getElementById('dialog-back').addEventListener('click', exitDialog);
  document.getElementById('teacher-task-back').addEventListener('click', exitTeacherTask);
  document.getElementById('teacher-task-restart').addEventListener('click', restartTeacherTask);

  document.getElementById('add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const heb = document.getElementById('add-heb').value.trim();
    const translation = document.getElementById('add-translation').value.trim();
    if (!heb || !translation) { toast('Нужно слово на иврите и перевод.', true); return; }
    const exampleHeb = document.getElementById('add-example').value.trim();
    try {
      await saveWord({
        heb,
        translit: document.getElementById('add-translit').value.trim(),
        translation,
        pos: '',
        topic: document.getElementById('add-topic').value.trim() || 'Мои слова',
        level: USER_LEVEL,
        example: exampleHeb ? {
          heb: exampleHeb,
          translit: translitPhrase(exampleHeb),
          translation: document.getElementById('add-example-translation').value.trim(),
        } : null,
      });
      event.target.reset();
      toast(`${heb} добавлено`);
      showScreen('dict');
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.getElementById('bulk-check').addEventListener('click', () => {
    const text = document.getElementById('bulk-input').value;
    state.bulkRows = parseBulkInput(text);
    if (!state.bulkRows.length) { toast('Вставь хотя бы одну строку.', true); return; }
    renderBulkPreview();
  });

  document.getElementById('rate-input').addEventListener('input', async (event) => {
    speech.rate = Number(event.target.value);
    document.getElementById('rate-value').textContent = speech.rate.toFixed(2);
    await setSetting('speechRate', speech.rate);
  });
  document.getElementById('sound-check').addEventListener('click', checkSound);
  document.getElementById('rate-test').addEventListener('click', () => {
    if (!speech.speak('שָׁלוֹם')) toast('Голоса иврита в системе нет.', true);
  });

  document.getElementById('limit-input').addEventListener('input', async (event) => {
    state.sessionLimit = Number(event.target.value);
    document.getElementById('limit-value').textContent = String(state.sessionLimit);
    await setSetting('sessionLimit', state.sessionLimit);
  });

  document.getElementById('offline-btn').addEventListener('click', cacheAllAudio);
  document.getElementById('share-btn').addEventListener('click', shareDatabase);
  document.getElementById('export-btn').addEventListener('click', exportToFile);
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) importFromFile(file);
    event.target.value = '';
  });
  document.getElementById('reset-btn').addEventListener('click', resetProgress);

  /**
   * Принудительное обновление. Офлайн-кеш по своей природе показывает сохранённую копию,
   * и на установленном приложении новая версия иногда ждёт закрытия всех окон. Эта кнопка
   * снимает кеш и перезагружает страницу — данные пользователя лежат отдельно, в базе.
   */
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    toast('Забираю свежую версию…');
    // Порядок важен: сперва убеждаемся, что сервер отвечает, и только потом трогаем
    // сохранённую копию. Иначе при обрыве связи человек остаётся вообще без приложения
    // (так и случилось у владельца 17.08.2026).
    try {
      const check = await fetch(`index.html?v=${Date.now()}`, { cache: 'no-store' });
      if (!check.ok) throw new Error(String(check.status));
    } catch (error) {
      toast('Сервер сейчас не отвечает — оставляю рабочую копию как есть.', true);
      return;
    }
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      // кеш записей не трогаем: он не про версию, а качать его заново — девять мегабайт
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== AUDIO_CACHE).map((key) => caches.delete(key)));
    } catch (error) {
      // даже если что-то не вышло, перезагрузка всё равно подтянет новое
    }
    // Не reload(): он может взять страницу из кеша браузера — уходим на адрес с меткой
    window.location.replace(`${location.pathname}?v=${Date.now()}`);
  });
  document.getElementById('install-btn').addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    renderSettings();
  });

  // Полный экран: в установленном приложении окно всё равно остаётся окном, отсюда и кнопка.
  const fullscreenButton = document.getElementById('fullscreen-btn');
  const syncFullscreenButton = () => {
    const isFull = Boolean(document.fullscreenElement);
    fullscreenButton.textContent = isFull ? '⤡' : '⤢';
    fullscreenButton.setAttribute('aria-label', isFull ? 'Свернуть из полного экрана' : 'Развернуть на весь экран');
    fullscreenButton.title = isFull ? 'Свернуть' : 'Во весь экран';
  };
  fullscreenButton.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      toast('Браузер не дал развернуть на весь экран.', true);
    }
  });
  document.addEventListener('fullscreenchange', syncFullscreenButton);
  syncFullscreenButton();

  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('keydown', handleHardKey);
  document.addEventListener('click', (event) => {
    const sheet = document.getElementById('char-sheet');
    if (sheet.classList.contains('is-open') && !sheet.contains(event.target)
      && !event.target.closest('.word-row')) closeCharSheet();
  });
}

export async function start() {
  try {
    await connect();
    await seedDatabaseIfEmpty();
    const addedWords = await seedMissingWords();

    // Дизайн-система светлая по замыслу, поэтому тёмная тема — только по явному выбору.
    const savedTheme = await getSetting('theme', 'light');
    document.documentElement.dataset.theme = savedTheme;
    fill('theme-toggle', uiIcon(savedTheme === 'dark' ? 'sun' : 'moon', 20));
    // Значки нижней навигации рисуем сами: символы шрифта в каждой системе свои
    document.querySelectorAll('.tab-icon[data-icon]').forEach((slot) => {
      slot.append(uiIcon(slot.dataset.icon, 20));
    });

    await loadEverything();
    bindEvents();
    await speech.init();

    showScreen('home');
    if (memoryOnly) {
      // Версия «одним файлом» по file://: браузер не даёт базу, живём в памяти.
      // Молчать нельзя — человек должен понимать, почему выученное не сохранится.
      toast('Браузер не дал сохранять данные: всё работает, но прогресс исчезнет при закрытии. '
        + 'Для учёбы открой обычную версию.', true);
    } else if (addedWords) {
      toast(`В обновлении новых слов: ${addedWords}`);
    }

    // По file:// Service Worker запрещён браузером — регистрировать его там бессмысленно.
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').then((registration) => {
        registration.update();   // спрашиваем сервер о новой версии при каждом запуске
      }).catch(() => {
        // Без Service Worker приложение просто не будет работать офлайн — не повод падать.
      });
      // И ещё раз — когда человек возвращается к приложению после паузы
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        navigator.serviceWorker.getRegistration().then((registration) => {
          if (registration) registration.update();
        });
      });
      // Новая версия применяется сама, но человек должен понимать, почему всё вдруг изменилось.
      let hadController = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) toast('Приложение обновилось до новой версии.');
        hadController = true;
      });
    }
  } catch (error) {
    document.querySelector('main').prepend(el('div', { class: 'card' }, [
      el('h2', { text: 'Приложение не смогло открыть базу данных' }),
      el('p', { text: String(error && error.message ? error.message : error) }),
      el('p', { class: 'faint', text: 'Чаще всего это значит, что файл открыт двойным кликом. Открой через локальный сервер: bash tools/serve.sh, адрес http://localhost:8321' }),
    ]));
  }
}

/* Ошибка, до которой не дотянулся ни один catch, не должна пропадать беззвучно: почти всегда
   это отказ базы в записи (кончилось место, приватный режим). Человеку важно знать, что
   его ответ не сохранился (аудит 03.09.2026). */
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const text = reason && reason.message ? reason.message : String(reason || '');
  toast(`Что-то не сохранилось: ${text || 'браузер отказал в записи'}`, true);
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  if (state.screen === 'settings') renderSettings();
});

start();
