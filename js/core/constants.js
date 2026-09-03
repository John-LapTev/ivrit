export const APP_VERSION = 'ivrit-v3';   // версия обязана совпадать с CACHE в sw.js
export const AUDIO_CACHE = 'ivrit-audio'; // имя кеша записей — такое же в sw.js

/* ═══════════════════ Константы ═══════════════════ */

export const DB_NAME = 'ivrit';
export const DB_VERSION = 2;      // 1 — первая схема базы иврита, 2 — прогресс грамматики и разговоров
export const STORE_WORDS = 'words';
export const STORE_SRS = 'srs';
export const STORE_STATS = 'stats';
export const STORE_SETTINGS = 'settings';
export const STORE_EXAMS = 'exams';
export const STORE_LETTERS = 'letters';
export const STORE_HARD = 'hard';
/* Уроки грамматики и разговоры лежат в одном хранилище: у сценки ключ `dialog:<id>`,
   у урока — его собственный id. Записи одинаковой формы, разводить их незачем. */
export const STORE_GRAMMAR = 'grammar';
export const ALL_STORES = [STORE_WORDS, STORE_SRS, STORE_STATS, STORE_SETTINGS,
  STORE_EXAMS, STORE_LETTERS, STORE_HARD, STORE_GRAMMAR];

export const EXPORT_SCHEMA_VERSION = 1;

/* SM-2 */
export const EASE_START = 2.5;
export const EASE_MIN = 1.3;
export const INTERVAL_FIRST = 1;
export const INTERVAL_SECOND = 6;
export const QUALITY_FORGOT = 0;
export const QUALITY_HARD = 3;
export const QUALITY_GOOD = 4;
export const QUALITY_EASY = 5;

/* Уровни и экзамен */
export const MAX_LEVEL = 3;
export const EXAM_QUESTION_COUNT = 20;
export const EXAM_PASS_SCORE = 17;
export const EXAM_READY_RATIO = 0.9;      // доля слов уровня, которые должны быть закреплены
export const EXAM_MIN_REPETITIONS = 2;    // «закреплено» = два верных повторения подряд

/* Итоговый экзамен: собирает все уровни разом и потому строже обычных.
   Номер уровня у него условный — он не открывает следующий, а подводит черту. */
export const FINAL_EXAM_LEVEL = 99;
export const FINAL_EXAM_QUESTIONS = 40;
export const FINAL_EXAM_RATIO = 0.9;

/* Прочее */
export const DEFAULT_SESSION_LIMIT = 20;
export const DEFAULT_SPEECH_RATE = 0.9;
export const OPTIONS_PER_QUESTION = 4;
export const NIQQUD_HIDDEN_DEFAULT = false; // огласовки показываем, пока их не скрыли в настройках
export const CHART_DAYS = 30;
export const HARD_BATCH_SIZE = 10;        // сколько трудных слов идёт в один заход
export const USER_LEVEL = 0;              // уровень для слов, добавленных вручную: всегда доступны
