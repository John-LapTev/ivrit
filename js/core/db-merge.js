/* ═══════════════════ СЛИЯНИЕ БАЗ ═══════════════════
   Джон учит с двух устройств. Раньше импорт писал поверх: загрузил на телефон вчерашнюю
   выгрузку с компьютера — и сегодняшняя работа исчезала (аудит 03.09.2026). Здесь собраны
   правила, по которым две записи об одном и том же превращаются в одну: потерять сделанное
   хуже, чем недосчитать.

   Отдельный модуль, потому что core/db.js — это про хранилище (драйверы, чтение, запись,
   засев), а слияние — про смысл данных: какая отметка важнее, что складывать, что объединять. */

/** Что новее: сравниваем по дню последнего показа, а при равенстве — по числу повторов. */
export function fresherSrs(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  const myDay = mine.lastSeenDay || '';
  const theirDay = theirs.lastSeenDay || '';
  if (myDay !== theirDay) return myDay > theirDay ? mine : theirs;
  return (mine.seen || 0) >= (theirs.seen || 0) ? mine : theirs;
}

/** День статистики: берём большее по каждому числу — так ни один прогон не пропадёт. */
export function mergeDay(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  const merged = Object.assign({}, theirs, mine);
  ['reviewed', 'correct', 'errors', 'stressErrors', 'learned'].forEach((field) => {
    merged[field] = Math.max(mine[field] || 0, theirs[field] || 0);
  });
  merged.byMode = Object.assign({}, theirs.byMode, mine.byMode);
  return merged;
}

/** Экзамен: в базе и так хранится лучшая попытка — её и оставляем. */
export function betterExam(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  if (mine.passed !== theirs.passed) return mine.passed ? mine : theirs;
  return (mine.score || 0) >= (theirs.score || 0) ? mine : theirs;
}

/** Настройки: открытый уровень назад не откатываем, остальное берём из файла. */
export function mergeSettings(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  if (mine.key === 'unlockedLevel') {
    return (mine.value || 0) >= (theirs.value || 0) ? mine : theirs;
  }
  if (mine.key === 'teacher') return mergeTeacher(mine, theirs);
  return theirs;
}

/**
 * Программа занятий — не настройка, а прогресс: под ключом `teacher` лежит весь курс
 * (текущий день, отметки шагов, закрытые дни). Перезаписать её файлом значит откатить
 * учёбу — ровно то, ради чего слияние и переписали. День берём дальний, шаги объединяем.
 */
function mergeTeacher(mine, theirs) {
  const my = mine.value || {};
  const their = theirs.value || {};
  const steps = {};
  Object.keys(Object.assign({}, their.steps, my.steps)).forEach((day) => {
    steps[day] = Object.assign({}, (their.steps || {})[day], (my.steps || {})[day]);
  });
  const finished = new Set([...(their.finishedDays || []), ...(my.finishedDays || [])]);
  // Даты — строки вида ГГГГ-ММ-ДД (dayKey), поэтому сравниваются как обычный текст:
  // начали раньше из двух, заходили — позже из двух.
  const startedAt = [my.startedAt, their.startedAt].filter(Boolean).sort()[0] || null;
  const lastDay = [my.lastDay, their.lastDay].filter(Boolean).sort().pop() || null;
  return {
    key: 'teacher',
    value: {
      day: Math.max(my.day || 1, their.day || 1),
      steps,
      startedAt,
      finishedDays: Array.from(finished).sort((a, b) => a - b),
      lastDay,
      returned: Boolean(my.returned || their.returned),
    },
  };
}

/** Сливает два списка записей по ключу, разрешая столкновения переданной функцией. */
export function mergeRecords(currentList, incomingList, keyField, resolve) {
  const result = new Map(currentList.map((record) => [record[keyField], record]));
  incomingList.forEach((incoming) => {
    const key = incoming[keyField];
    result.set(key, resolve(result.get(key), incoming));
  });
  return Array.from(result.values());
}


/**
 * Трудное слово: метка ставится вручную, а `passed` — какие из четырёх режимов слово
 * одолело — копится на каждом устройстве отдельно, поэтому заход с телефона не должен
 * пропадать при загрузке файла на компьютере. Объединять можно только внутри ОДНОГО круга:
 * новый круг обнуляет `passed` и увеличивает `runs` (см. `core/hard-words.js`), поэтому
 * при разных `runs` берём запись из круга поновее целиком.
 */
export function mergeHard(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  const myRuns = mine.runs || 0;
  const theirRuns = theirs.runs || 0;
  if (myRuns !== theirRuns) return myRuns > theirRuns ? mine : theirs;
  return Object.assign({}, theirs, mine, {
    passed: Object.assign({}, theirs.passed, mine.passed),
  });
}

/** Отметка буквы — факт «выучил», снять его нельзя: оставляем ту, что поставлена раньше. */
export function earlierLetter(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  if (!mine.at) return theirs;      // запись без даты уступает записи с датой
  if (!theirs.at) return mine;
  return mine.at <= theirs.at ? mine : theirs;
}

/**
 * Урок грамматики или разговорная сценка. Счётчики копятся от каждого прохода, поэтому
 * записи разных устройств по ним несравнимы: берём большее. «Пройдено» не отменяем —
 * на одном устройстве урок мог быть закрыт, на другом только начат.
 */
export function mergeLesson(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  return Object.assign({}, theirs, mine, {
    correct: Math.max(mine.correct || 0, theirs.correct || 0),
    total: Math.max(mine.total || 0, theirs.total || 0),
    done: Boolean(mine.done || theirs.done),
    hardDone: Boolean(mine.hardDone || theirs.hardDone),
  });
}
