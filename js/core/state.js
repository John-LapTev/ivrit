import { DEFAULT_SESSION_LIMIT } from './constants.js';
import { ALL_TOPICS } from '../ui/icons.js';

export const state = {
  words: [],
  srs: new Map(),
  stats: new Map(),
  exams: new Map(),
  screen: 'home',
  mode: 'heb2ru',
  topic: ALL_TOPICS,
  unlockedLevel: 1,
  sessionLimit: DEFAULT_SESSION_LIMIT,
  niqqudHidden: false,
  alefbetTab: 'letters',      // какая вкладка раздела букв открыта
  alefbetLetter: 'א',         // разобранная буква на вкладке «Буквы»
  letterProgress: new Map(),  // буква → отметка «выучил»
  confusing: null,            // текущий заход тренажёра похожих букв

  /* ——— Грамматика и разговоры ——— */
  grammarProgress: new Map(),  // id урока (или `dialog:<id>`) → запись прогресса
  grammarTab: 'rules',         // какая вкладка раздела грамматики открыта
  lesson: null,                // разбираемый урок: копия с перемешанными фразами
  drillIndex: 0,               // какая фраза урока идёт сейчас
  drillChunks: [],             // куски этой фразы — кешируются, чтобы кнопки не прыгали

  /* ——— Программа занятий ——— */
  teacher: null,               // отметки курса: день, шаги, дата начала
  teacherDay: 1,               // открытый день программы
  teacherTask: null,           // текущий подход задания дня
  teacherReturn: null,         // { day, step } — куда вернуть и что отметить после тренировки

  /* Откуда пришли на экран: ключ — имя экрана, значение — { screen, day }. День нужен,
     чтобы кнопка «назад» из урока вернула в конкретное занятие программы. */
  cameFrom: {},

  dictSearch: '',
  dictTopic: ALL_TOPICS,
  progressTab: 'stats',
  bulkRows: [],
  installPrompt: null,
  hard: new Map(),        // помеченные кружком трудные слова: wordId → запись прогресса
  hardReturn: 'home',     // куда вернуть кнопку «назад» из раздела трудных слов
};
