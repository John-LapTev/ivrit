import { ALL_STORES, DB_NAME, DB_VERSION, EXPORT_SCHEMA_VERSION, MAX_LEVEL, STORE_EXAMS, STORE_GRAMMAR, STORE_HARD, STORE_LETTERS, STORE_SETTINGS, STORE_SRS, STORE_STATS, STORE_WORDS } from './constants.js';
import { betterExam, earlierLetter, fresherSrs, mergeDay, mergeHard, mergeLesson, mergeRecords, mergeSettings } from './db-merge.js';
import { normalizeHebrew, translit, wordKey } from './translit.js';
import { SEED_WORDS } from '../data/words.js';

/* ═══════════════════ DB — IndexedDB ═══════════════════
   Работа с базой идёт через «драйвер»: обычно это IndexedDB, но если браузер её не даёт
   (версия «одним файлом» по file:// — Chrome там просто не отвечает на запрос открытия),
   приложение переключается на память. Тогда всё работает и всё видно, только выученное
   не переживёт закрытия вкладки — об этом сразу говорится на экране.                    */

export let database = null;
let driver = null;
export let memoryOnly = false;      // правда ли, что база не открылась и мы живём в памяти

/** Сколько ждём ответа от браузера, прежде чем считать, что базы не будет. */
/* Сколько ждать ответа от IndexedDB. Было 4 секунды — этого хватало настольному браузеру,
   но не телефону: на первом запуске он одновременно тянет модули, ставит Service Worker
   и заводит базу, и не укладывается. Джон 04.09.2026 получил из-за этого «браузер не дал
   сохранять данные» на живом приложении — то есть учился без сохранения прогресса. */
const OPEN_TIMEOUT_MS = 20000;

/** Модули не могут присваивать чужой импорт, поэтому соединение хранится здесь
    и открывается через connect(): снаружи остаётся только вызов. */
export async function connect() {
  // Одна повторная попытка: отказ чаще всего временный (телефон занят первым запуском),
  // а цена ошибки высокая — человек учится, и прогресс молча не сохраняется.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      database = await openDatabase();
      driver = indexedDbDriver(database);
      memoryOnly = false;
      return database;
    } catch (error) {
      if (attempt === 0) continue;
      // Не падаем: без базы приложение всё равно должно открыться и показать себя
      database = null;
      driver = memoryDriver();
      memoryOnly = true;
    }
  }
  return database;
}

/**
 * Открывает базу и создаёт хранилища. Схема меняется только здесь.
 * Три вещи, без которых открытие однажды зависало навсегда:
 *  · `onblocked` — другая вкладка держит старую версию схемы;
 *  · `versionchange` — наоборот, это мы держим базу, а обновиться хочет соседняя вкладка;
 *  · таймаут — по file:// браузер не отвечает вовсе, ни успехом, ни ошибкой.
 */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const timer = setTimeout(
      () => finish(reject, new Error('браузер не отвечает на запрос к базе данных')),
      OPEN_TIMEOUT_MS,
    );

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      finish(reject, error);
      return;
    }

    /* Каждое хранилище заводится только если его ещё нет: база у человека уже с данными,
       и вторая версия схемы обязана ДОПОЛНИТЬ её, а не пересоздать. */
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_WORDS)) {
        const words = db.createObjectStore(STORE_WORDS, { keyPath: 'id', autoIncrement: true });
        // Ключ — голое написание без огласовок: иначе одно слово с точками и без точек
        // легло бы в базу дважды, и словарь раздвоился бы на глазах у владельца
        words.createIndex('key', 'key', { unique: true });
        words.createIndex('topic', 'topic', { unique: false });
        words.createIndex('level', 'level', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SRS)) {
        const srs = db.createObjectStore(STORE_SRS, { keyPath: 'wordId' });
        srs.createIndex('due', 'due', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STATS)) db.createObjectStore(STORE_STATS, { keyPath: 'date' });
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_EXAMS)) db.createObjectStore(STORE_EXAMS, { keyPath: 'level' });
      // прогресс по буквам алефбета
      if (!db.objectStoreNames.contains(STORE_LETTERS)) db.createObjectStore(STORE_LETTERS, { keyPath: 'letter' });
      // слова, помеченные как трудные
      if (!db.objectStoreNames.contains(STORE_HARD)) db.createObjectStore(STORE_HARD, { keyPath: 'wordId' });
      // Вторая версия схемы: уроки грамматики и разговоры
      if (!db.objectStoreNames.contains(STORE_GRAMMAR)) db.createObjectStore(STORE_GRAMMAR, { keyPath: 'lessonId' });
    };

    // Соседняя вкладка держит старую версию: ждать её бесполезно — говорим об этом прямо
    request.onblocked = () => {
      clearTimeout(timer);
      finish(reject, new Error('база открыта в другой вкладке со старой версией'));
    };

    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      /* Опоздали: обещание уже отклонено по таймауту, и эту базу никто не держит.
         Не закрыть её — значит оставить соединение, которое молча заблокирует
         следующий апгрейд схемы и уведёт человека в режим без сохранения. */
      if (settled) { db.close(); return; }
      // Обновиться хочет соседняя вкладка — отпускаем базу, иначе повиснет уже она
      db.addEventListener('versionchange', () => db.close());
      finish(resolve, db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      finish(reject, request.error || new Error('не удалось открыть базу данных'));
    };
  });
}

/* ——— Драйвер поверх IndexedDB ——— */

function indexedDbDriver(db) {
  const run = (storeName, mode, action) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.onerror = () => reject(transaction.error);
    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      transaction.oncomplete = () => resolve();
    }
  });

  return {
    getAll: (store) => run(store, 'readonly', (s) => s.getAll()),
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
    delete: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    clear: (store) => run(store, 'readwrite', (s) => s.clear()),
    /** Пакетная запись: одна транзакция на все записи, иначе на сотне слов браузер задыхается. */
    putMany: (storeName, values) => new Promise((resolve, reject) => {
      if (!values.length) return resolve();
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      values.forEach((value) => store.put(value));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }),
    /** Несколько хранилищ в одной транзакции: импорт применяется целиком или никак. */
    putManyAcross: (batches) => new Promise((resolve, reject) => {
      const names = batches.map((batch) => batch.store);
      if (!names.length) return resolve();
      const transaction = db.transaction(names, 'readwrite');
      batches.forEach(({ store, values }) => {
        const target = transaction.objectStore(store);
        values.forEach((value) => target.put(value));
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('запись отменена'));
    }),
  };
}

/* ——— Драйвер в памяти: тот же набор действий, только хранится в Map ———
   Ключи у хранилищ разные (id, wordId, key…), поэтому драйвер знает, какое поле у кого
   ключевое, а словам сам раздаёт номера — как это делает автоинкремент базы.          */

const KEY_FIELD = {
  [STORE_WORDS]: 'id',
  [STORE_SRS]: 'wordId',
  [STORE_STATS]: 'date',
  [STORE_SETTINGS]: 'key',
  [STORE_EXAMS]: 'level',
  [STORE_LETTERS]: 'letter',
  [STORE_HARD]: 'wordId',
  [STORE_GRAMMAR]: 'lessonId',
};

function memoryDriver() {
  const tables = new Map(ALL_STORES.map((name) => [name, new Map()]));
  let nextId = 1;

  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const put = (name, value) => {
    const field = KEY_FIELD[name] || 'id';
    const copy = Object.assign({}, value);
    if (copy[field] === undefined) copy[field] = nextId++;
    if (name === STORE_WORDS && typeof copy.id === 'number' && copy.id >= nextId) nextId = copy.id + 1;
    table(name).set(copy[field], copy);
    return copy[field];
  };

  return {
    getAll: async (name) => Array.from(table(name).values()),
    get: async (name, key) => table(name).get(key),
    put: async (name, value) => put(name, value),
    delete: async (name, key) => { table(name).delete(key); },
    clear: async (name) => { table(name).clear(); },
    putMany: async (name, values) => { values.forEach((value) => put(name, value)); },
    putManyAcross: async (batches) => {
      batches.forEach(({ store, values }) => values.forEach((value) => put(store, value)));
    },
  };
}

/* ——— Общие операции: наружу видны только они ——— */

const useDriver = () => {
  if (!driver) throw new Error('база ещё не открыта');
  return driver;
};

export const dbGetAll = (store) => useDriver().getAll(store);
export const dbGet = (store, key) => useDriver().get(store, key);
export const dbPut = (store, value) => useDriver().put(store, value);
export const dbDelete = (store, key) => useDriver().delete(store, key);
export const dbClear = (store) => useDriver().clear(store);
export const dbPutMany = (store, values) => useDriver().putMany(store, values);
const dbPutManyAcross = (batches) => useDriver().putManyAcross(batches);

export async function getSetting(key, fallback) {
  const record = await dbGet(STORE_SETTINGS, key);
  return record === undefined ? fallback : record.value;
}

export const setSetting = (key, value) => dbPut(STORE_SETTINGS, { key, value });

/** Ключ записи: у своих слов он уже лежит в поле, у чужих считается по написанию. */
/* Ключ считаем по написанию, а не берём из записи: в файле с другого устройства поле
   могло разойтись со словом, и тогда в словаре завёлся бы невидимый дубль. */
const recordKey = (word) => wordKey(word.heb) || word.key;

/** Поля, которые появились в словаре позже самой базы, — их же дописывает досев. */
const LATE_FIELDS = ['gender', 'plural', 'pluralTranslit'];

/** Запись словаря: показываем `heb` с огласовками, сравниваем и ищем по `key` без них. */
const toWordRecord = (word, key) => {
  const record = {
    heb: normalizeHebrew(word.heb),
    key,
    translit: word.translit || translit(word.heb, word.stress),
    translation: word.translation,
    pos: word.pos,
    topic: word.topic,
    level: Math.min(word.ulpan, MAX_LEVEL),
    ulpan: word.ulpan,
    example: word.example,
    tags: [],
    createdAt: new Date().toISOString(),
  };
  // Род есть только у существительных, множественное число — не у всех: пустых полей не заводим.
  // Форма множественного числа нормализуется так же, как само слово: иначе один и тот же
  // никуд из разных источников даст разные байты.
  if (word.gender) record.gender = word.gender;
  if (word.plural) {
    record.plural = normalizeHebrew(word.plural);
    record.pluralTranslit = word.pluralTranslit;
  }
  return record;
};

/**
 * Стартовый словарь без повторов. Ключ уникален в базе, и один повтор внутри пачки уронил
 * бы всю транзакцию целиком, поэтому дубликаты отсеиваются здесь, а не в браузере.
 * @param {(key: string) => boolean} isKnown — такое слово уже есть в базе
 */
function seedRecords(isKnown) {
  const seen = new Set();
  const records = [];
  SEED_WORDS.forEach((word) => {
    const key = wordKey(word.heb);
    if (!key || seen.has(key) || isKnown(key)) return;
    seen.add(key);
    records.push(toWordRecord(word, key));
  });
  return records;
}

/** Первое открытие: заливаем стартовый словарь. Существующую базу не трогаем. */
export async function seedDatabaseIfEmpty() {
  const existing = await dbGetAll(STORE_WORDS);
  if (existing.length) return existing.length;
  const seed = seedRecords(() => false);
  await dbPutMany(STORE_WORDS, seed);
  return seed.length;
}

/**
 * Слова, которые уже лежат в базе, дополняются полями из новой версии словаря.
 * Дописываются только ПУСТЫЕ места и только у слов самого словаря (ключ нашёлся
 * в стартовом наборе): свои слова владельца и его правки остаются нетронутыми.
 * Отдельная версия схемы для этого не нужна — хранилища и индексы прежние, меняется
 * только содержимое записей. Поднимать `DB_VERSION` тут даже вредно: апгрейд ждёт
 * закрытия всех вкладок, а не дождавшись — уводит приложение в память без сохранения.
 * @param {Map<string, object>} known — что уже лежит в базе, по ключу слова
 * @returns {object[]} записи, которые надо перезаписать целиком (put заменяет запись)
 */
function patchExistingWords(known) {
  const patched = new Map();

  SEED_WORDS.forEach((word) => {
    const key = wordKey(word.heb);
    const record = known.get(key);
    // Слово владельца (ulpan 0) не трогаем, даже если ключ совпал со словарным:
    // род и множественное от чужого значения на его карточке — хуже, чем их отсутствие
    if (!record || patched.has(record.id) || !record.ulpan) return;
    const source = toWordRecord(word, key);
    const patch = {};
    LATE_FIELDS.forEach((field) => {
      if (source[field] && !record[field]) patch[field] = source[field];
    });
    // id обязан сохраниться: к нему привязаны повторения, статистика и «трудные слова»
    if (Object.keys(patch).length) patched.set(record.id, Object.assign({}, record, patch));
  });

  /* Слова, заведённые владельцем до того, как `saveWord` научился писать `key`, лежат
     без него — а уникальный индекс базы построен именно по этому полю. Проставляем. */
  known.forEach((record, key) => {
    if (record.key || patched.has(record.id)) return;
    patched.set(record.id, Object.assign({}, record, { key }));
  });

  return Array.from(patched.values());
}

/**
 * Досев после обновления приложения: слова, добавленные в новой версии, попадают
 * и в уже заполненную базу, а старые записи дополняются новыми полями.
 * Прогресс и свои слова при этом не трогаются.
 * @returns {Promise<number>} сколько НОВЫХ слов приехало (о дополненных полях не сообщаем)
 */
export async function seedMissingWords() {
  const existing = await dbGetAll(STORE_WORDS);
  const known = new Map(existing.map((record) => [recordKey(record), record]));
  const missing = seedRecords((key) => known.has(key));
  if (missing.length) await dbPutMany(STORE_WORDS, missing);

  /* Досев полей — украшение карточки, а не условие работы: если он не прошёл,
     приложение обязано открыться и учить дальше, а не показывать отказ базы. */
  try {
    const patched = patchExistingWords(known);
    if (patched.length) await dbPutMany(STORE_WORDS, patched);
  } catch (error) {
    // молча: слова на месте, не хватает только рода и множественного числа
  }

  return missing.length;
}

/* ——— Экспорт и импорт всей базы ——— */

export async function exportDatabase() {
  const [words, srs, stats, settings, exams, letters, hard, grammar] = await Promise.all([
    dbGetAll(STORE_WORDS), dbGetAll(STORE_SRS), dbGetAll(STORE_STATS), dbGetAll(STORE_SETTINGS),
    dbGetAll(STORE_EXAMS), dbGetAll(STORE_LETTERS), dbGetAll(STORE_HARD), dbGetAll(STORE_GRAMMAR),
  ]);
  return {
    app: 'ivrit',
    schema: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    words, srs, stats, settings, exams, letters, hard, grammar,
  };
}

/** Разбирает файл и считает, что изменится. Ничего не пишет — только отчёт. */
export async function planImport(payload) {
  if (!payload || payload.app !== 'ivrit' || !Array.isArray(payload.words)) {
    throw new Error('Это не файл базы иврита.');
  }
  if (payload.schema > EXPORT_SCHEMA_VERSION) {
    throw new Error('Файл сделан более новой версией приложения.');
  }
  const current = await dbGetAll(STORE_WORDS);
  const currentKeys = new Set(current.map(recordKey));
  /* Считаем ровно так же, как потом применяем: слово без ключа в базу не попадёт,
     а повтор внутри самого файла добавится один раз. Иначе диалог обещает одно число,
     а в базу приезжает другое. */
  const fresh = [];
  const seen = new Set();
  payload.words.forEach((word) => {
    const key = recordKey(word);
    if (!key || seen.has(key) || currentKeys.has(key)) return;
    seen.add(key);
    fresh.push(word);
  });
  return {
    payload,
    newWords: fresh.length,
    knownWords: payload.words.length - fresh.length,
    progressRecords: (payload.srs || []).length,
    days: (payload.stats || []).length,
    letters: (payload.letters || []).length,
    lettersLearned: (payload.letters || []).filter((record) => record.learned).length,
    hardWords: (payload.hard || []).length,
  };
}

/**
 * Применяет разобранный импорт: слова дополняются, прогресс переносится по ключам слов.
 * Пишется в два захода: сперва новые слова (им база выдаёт `id`, к которым потом
 * привязывается прогресс), затем весь прогресс одной транзакцией. Порядок выбран так,
 * что обрыв посередине оставит лишние слова без прогресса — это лечится повторной
 * загрузкой того же файла, в отличие от обратного порядка, где прогресс повис бы в пустоте.
 */
export async function applyImport(plan) {
  const payload = plan.payload;
  const current = await dbGetAll(STORE_WORDS);
  const currentByKey = new Map(current.map((word) => [recordKey(word), word]));

  // Слова: новые добавляем, существующие оставляем как есть (перевод пользователя важнее).
  const incomingIdToKey = new Map();
  const toInsert = [];
  payload.words.forEach((word) => {
    const key = recordKey(word);
    if (!key) return;
    incomingIdToKey.set(word.id, key);
    if (currentByKey.has(key)) return;
    const copy = Object.assign({}, word, { key });
    delete copy.id;
    toInsert.push(copy);
    currentByKey.set(key, copy);   // повтор в самом файле не должен уйти в базу дважды
  });
  await dbPutMany(STORE_WORDS, toInsert);

  // Прогресс привязан к id, а id при вставке новые — сопоставляем по ключам слов.
  const after = await dbGetAll(STORE_WORDS);
  const idByKey = new Map(after.map((word) => [recordKey(word), word.id]));
  const remapByWord = (records) => (records || []).map((record) => {
    const key = incomingIdToKey.get(record.wordId);
    const wordId = idByKey.get(key);
    return wordId ? Object.assign({}, record, { wordId }) : null;
  }).filter(Boolean);

  const [srs, stats, exams, letters, settings, hard, grammar] = await Promise.all([
    dbGetAll(STORE_SRS), dbGetAll(STORE_STATS), dbGetAll(STORE_EXAMS),
    dbGetAll(STORE_LETTERS), dbGetAll(STORE_SETTINGS), dbGetAll(STORE_HARD),
    dbGetAll(STORE_GRAMMAR),
  ]);

  await dbPutManyAcross([
    { store: STORE_SRS, values: mergeRecords(srs, remapByWord(payload.srs), 'wordId', fresherSrs) },
    { store: STORE_HARD, values: mergeRecords(hard, remapByWord(payload.hard), 'wordId', mergeHard) },
    { store: STORE_STATS, values: mergeRecords(stats, payload.stats || [], 'date', mergeDay) },
    { store: STORE_EXAMS, values: mergeRecords(exams, payload.exams || [], 'level', betterExam) },
    { store: STORE_LETTERS, values: mergeRecords(letters, payload.letters || [], 'letter', earlierLetter) },
    { store: STORE_GRAMMAR, values: mergeRecords(grammar, payload.grammar || [], 'lessonId', mergeLesson) },
    { store: STORE_SETTINGS, values: mergeRecords(settings, payload.settings || [], 'key', mergeSettings) },
  ]);
}
