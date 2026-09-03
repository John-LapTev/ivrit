import { MAX_LEVEL, STORE_STATS } from './constants.js';
import { dbPut } from './db.js';
import { addDays, dayKey, isLearned } from './srs.js';
import { state } from './state.js';

/* ═══════════════════ STATS — дневные счётчики, серия, факты для достижений ═══════════════════
   Только цифры. Экраны прогресса и настроек живут в ui/progress.js и ui/settings.js:
   рисование в слое логики было ошибкой (аудит 03.09.2026).                                   */

export async function updateDayStats(delta) {
  const key = dayKey();
  const existing = state.stats.get(key)
    || { date: key, reviewed: 0, correct: 0, errors: 0, stressErrors: 0, learned: 0, byMode: {} };
  existing.reviewed += delta.reviewed || 0;
  existing.correct += delta.correct || 0;
  existing.errors += delta.errors || 0;
  existing.stressErrors += delta.stressErrors || 0;
  existing.learned += delta.learned || 0;
  if (delta.mode) existing.byMode[delta.mode] = (existing.byMode[delta.mode] || 0) + 1;
  state.stats.set(key, existing);
  await dbPut(STORE_STATS, existing);
}

/** Дней подряд с занятиями. Сегодняшний «прогул» ещё не рвёт цепочку — день не кончился. */
export function calcStreak() {
  let cursor = dayKey();
  if (!(state.stats.get(cursor) || {}).reviewed) cursor = addDays(cursor, -1);
  let streak = 0;
  while ((state.stats.get(cursor) || {}).reviewed > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export const ACHIEVEMENTS = [
  { id: 'first-session', name: 'Первый шаг', note: 'первая пройденная тренировка',
    icon: 'Приветствия', check: (facts) => facts.reviewed > 0 },
  { id: 'streak-7', name: 'Неделя подряд', note: '7 дней занятий без пропусков',
    icon: 'Время', check: (facts) => facts.streak >= 7 },
  { id: 'streak-30', name: 'Месяц подряд', note: '30 дней занятий без пропусков',
    icon: 'Время', check: (facts) => facts.streak >= 30 },
  { id: 'learned-25', name: 'Двадцать пять', note: '25 выученных слов',
    icon: 'Учёба', check: (facts) => facts.learned >= 25 },
  { id: 'learned-100', name: 'Сотня слов', note: '100 выученных слов',
    icon: 'Учёба', check: (facts) => facts.learned >= 100 },
  { id: 'exam-1', name: 'Первый экзамен', note: 'сдан экзамен уровня',
    icon: 'Вопросы', check: (facts) => facts.examsPassed >= 1 },
  { id: 'exam-all', name: 'Все уровни', note: 'сданы экзамены всех уровней',
    icon: 'Магазин', check: (facts) => facts.examsPassed >= MAX_LEVEL },
  { id: 'clean-day', name: 'День без ошибок', note: '20 повторений за день и ни одной ошибки',
    icon: 'Здоровье', check: (facts) => facts.cleanDay },
];

export function achievementFacts() {
  const days = Array.from(state.stats.values());
  const learned = state.words.filter((word) => isLearned(state.srs.get(word.id))).length;
  const examsPassed = Array.from(state.exams.values()).filter((record) => record.passed && record.level <= MAX_LEVEL).length;
  return {
    reviewed: days.reduce((sum, day) => sum + day.reviewed, 0),
    streak: calcStreak(),
    learned,
    examsPassed,
    cleanDay: days.some((day) => day.reviewed >= 20 && day.errors === 0),
  };
}
