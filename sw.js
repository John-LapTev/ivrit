/* Service Worker приложения «Иврит с нуля» — офлайн-кеш.
 *
 * ВАЖНО: имя кеша кода версионируется. Поменял index.html — подними номер, иначе браузер
 * продолжит показывать старую копию (стратегия cache-first). Подробности и грабли —
 * в knowledge-base/standards/pwa-offline.md
 *
 * Кешей два, и это принципиально:
 *   SHELL — код, шрифты, данные. Версионируется, при обновлении старое стирается.
 *   AUDIO — записи произношения. НЕ версионируется и переживает обновления кода.
 * Раньше кеш был один: каждая новая версия выбрасывала все скачанные записи, и после
 * обновления звук молчал, пока файлы не скачаются заново (17.08.2026 — жалоба владельца).
 */
const CACHE = 'ivrit-v3';          // имя проверяет tools/publish.sh — не переименовывать
const SHELL = `${CACHE}-shell`;
const AUDIO = 'ivrit-audio';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './fonts/Inter-latin.woff2',
  './fonts/Inter-cyrillic.woff2',
  './fonts/NotoSansHebrew.woff2',
  './fonts/NotoSansHebrew-Bold.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/core/constants.js',
  './js/core/db.js',
  './js/core/hard-words.js',
  './js/core/modes.js',
  './js/core/random.js',
  './js/core/recorder.js',
  './js/core/sentence-order.js',
  './js/core/speech.js',
  './js/core/srs.js',
  './js/core/state.js',
  './js/core/stats.js',
  './js/core/translit.js',
  './js/core/voice-match.js',
  './js/data/alefbet.js',
  './js/data/dialogs.js',
  './js/data/grammar.js',
  './js/data/teacher-days.js',
  './js/data/words.js',
  './js/main.js',
  './js/ui/alefbet-screen.js',
  './js/ui/daily.js',
  './js/ui/dialogs-screen.js',
  './js/ui/dict.js',
  './js/ui/dom.js',
  './js/ui/grammar.js',
  './js/ui/hard-drill.js',
  './js/ui/hard-mark.js',
  './js/ui/hard-screen.js',
  './js/ui/home.js',
  './js/ui/icons.js',
  './js/ui/mastery.js',
  './js/ui/progress.js',
  './js/ui/pronounce.js',
  './js/ui/rank.js',
  './js/ui/screens.js',
  './js/ui/settings.js',
  './js/ui/tabs.js',
  './js/ui/teacher-course.js',
  './js/ui/teacher-tasks.js',
  './js/ui/teacher-words.js',
  './js/ui/topic-icons.js',
  './js/ui/train.js',
  './js/ui/word.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' обязательно: обычный запрос браузер может закрыть из своего кеша,
  // и в кеш приложения ляжет вчерашний файл — так свежая версия и не доезжала.
  event.waitUntil(caches.open(SHELL).then((cache) => Promise.all(
    ASSETS.map((url) => fetch(url, { cache: 'reload' })
      .then((response) => (response.ok ? cache.put(url, response) : null))
      .catch(() => null))
  )));
  self.skipWaiting();            // новая версия не ждёт закрытия всех вкладок
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      // чистим только устаревшие кеши кода, записи произношения не трогаем
      keys.filter((key) => key !== SHELL && key !== AUDIO).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Только GET и только свой origin: чужие запросы приложение не делает вовсе.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Записи произношения складываем в отдельный кеш при первом прослушивании.
  if (url.pathname.includes('/audio/') && url.pathname.endsWith('.mp3')) {
    event.respondWith(
      caches.open(AUDIO).then((cache) => cache.match(event.request).then((hit) => hit
        || fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })))
        // сети нет и записи нет — пусть ошибка дойдёт до кода, он возьмёт системный голос
        .catch(() => Response.error())
    );
    return;
  }

  // Код и разметка: сначала спрашиваем сервер, кеш — запасной путь.
  // Раньше было наоборот, и свежая версия не доезжала до человека, пока не поднимут номер
  // кеша: правка есть на сервере, а в браузере старая копия (17.08.2026, жалоба владельца).
  // Указатели записей (audio/index.json, audio/syllables/index.json) растут с каждой
  // новой озвучкой, поэтому им тоже нужен свежий ответ: иначе новые фразы молчат, хотя
  // сами mp3 уже лежат на сервере (найдено 25.08.2026). Прописи (data/strokes.json)
  // сюда не попадают — они большие и меняются редко.
  const isIndex = url.pathname.includes('/audio/') && url.pathname.endsWith('index.json');
  const isCode = isIndex || url.pathname.endsWith('.js') || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/') || url.pathname.endsWith('.webmanifest');
  if (isCode) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match(event.request).then(
        (hit) => hit || caches.match('./index.html')   // офлайн — отдаём, что есть
      ))
    );
    return;
  }

  // Шрифты, прописи, иконки — редко меняются, их быстрее брать из кеша.
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).catch(
      () => caches.match('./index.html')
    ))
  );
});
