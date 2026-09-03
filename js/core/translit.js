/* ═══════════════════ TRANSLIT — огласовки → русское чтение ═══════════════════
   Только здесь живёт знание о том, как читается ивритское письмо: буква + огласовка →
   звук. Всё остальное приложение (карточки, тренировки, озвучка) берёт чтение отсюда
   и само в буквы не лезет.

   Почему считаем, а не храним: чтение, записанное руками у каждого слова, неизбежно
   разъезжается — где-то «шабат», где-то «шаббат». Здесь одно правило на всё приложение,
   и оно же проверяет слова, которые владелец добавит сам.

   Ручная замена всё же предусмотрена (поле `translit` у слова): огласовка «камац катан»
   и часть заимствований по правилам не выводятся, машина тут бессильна.               */

/* ——— Знаки огласовок (Unicode) ——— */
const SHVA = 'ְ';
const HATAF_SEGOL = 'ֱ';
const HATAF_PATAH = 'ֲ';
const HATAF_QAMATS = 'ֳ';
const HIRIQ = 'ִ';
const TSERE = 'ֵ';
const SEGOL = 'ֶ';
const PATAH = 'ַ';
const QAMATS = 'ָ';
const HOLAM = 'ֹ';
const HOLAM_HASER = 'ֺ';
const QUBUTS = 'ֻ';
const DAGESH = 'ּ';       // он же мапик в «ה» и шурук в «ו»
const METEG = 'ֽ';
const RAFE = 'ֿ';
const SHIN_DOT = 'ׁ';
const SIN_DOT = 'ׂ';
const QAMATS_QATAN = 'ׇ';
const STRESS_MARK = '́';  // комбинируемое ударение: ставится ПОСЛЕ гласной буквы

/** Всё, что может висеть на букве. Порядок в строке бывает любой — разбираем по множеству. */
const MARKS = new Set([SHVA, HATAF_SEGOL, HATAF_PATAH, HATAF_QAMATS, HIRIQ, TSERE, SEGOL,
  PATAH, QAMATS, HOLAM, HOLAM_HASER, QUBUTS, DAGESH, METEG, RAFE, SHIN_DOT, SIN_DOT,
  QAMATS_QATAN]);

/** Огласовка → гласный звук. Шва считается отдельно: она то звучит, то нет. */
const VOWEL_SOUND = {
  [PATAH]: 'а', [QAMATS]: 'а', [HATAF_PATAH]: 'а',
  [SEGOL]: 'е', [TSERE]: 'е', [HATAF_SEGOL]: 'е',
  [HIRIQ]: 'и',
  [HOLAM]: 'о', [HOLAM_HASER]: 'о', [HATAF_QAMATS]: 'о', [QAMATS_QATAN]: 'о',
  [QUBUTS]: 'у',
};

/**
 * Слова, где камац читается как «о» (камац катан), а знака U+05C7 в тексте нет.
 * Список короткий намеренно: правило неразрешимо машиной, поэтому в данных огласовку
 * положено ставить знаком камац-катан, а здесь — только самые ходовые исключения.
 */
const QAMATS_QATAN_WORDS = { 'כָּל': 'коль', 'רָב': 'ров' };

/**
 * Согласные. `hard` — звучание с дагешем, `soft` — без него.
 * Три буквы (ב, כ, פ) меняют звук от точки внутри — это «бегед-кефет» современного иврита.
 */
const CONSONANTS = {
  'א': { soft: '', silent: true },
  'ב': { soft: 'в', hard: 'б' },
  'ג': { soft: 'г' },
  'ד': { soft: 'д' },
  'ה': { soft: 'h' },
  'ו': { soft: 'в' },
  'ז': { soft: 'з' },
  'ח': { soft: 'х' },
  'ט': { soft: 'т' },
  'י': { soft: 'й' },
  'כ': { soft: 'х', hard: 'к' },
  'ך': { soft: 'х', hard: 'к', final: true },
  'ל': { soft: 'л' },
  'מ': { soft: 'м' },
  'ם': { soft: 'м', final: true },
  'נ': { soft: 'н' },
  'ן': { soft: 'н', final: true },
  'ס': { soft: 'с' },
  'ע': { soft: '', silent: true },
  'פ': { soft: 'ф', hard: 'п' },
  'ף': { soft: 'ф', hard: 'п', final: true },
  'צ': { soft: 'ц' },
  'ץ': { soft: 'ц', final: true },
  'ק': { soft: 'к' },
  'ר': { soft: 'р' },
  'ש': { soft: 'ш' },   // уточняется точкой: справа — «ш», слева — «с»
  'ת': { soft: 'т' },
};

/** Конечная форма → обычная. Нужно и для поиска по словарю, и для разбора корня. */
export const FINAL_TO_REGULAR = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export const REGULAR_TO_FINAL = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };

export const isHebrewLetter = (char) => char >= 'א' && char <= 'ת';
export const isNiqqudMark = (char) => MARKS.has(char);

/**
 * Приведение ивритской строки к единому виду. Обязательно ВЕЗДЕ, где строки сравниваются
 * или служат ключом: одна и та же огласовка из разных источников даёт разные байты,
 * и «שָׁלוֹם» из словаря не совпадёт с «שָׁלוֹם» из программы занятий.
 */
export const normalizeHebrew = (text) => String(text || '').normalize('NFC');

/**
 * Ключ слова: только согласные, без огласовок, конечные буквы приведены к обычным.
 * По нему приложение ищет слово, сверяет программу со словарём и склеивает базы при
 * импорте. Показываем при этом всегда полную форму с огласовками — ключ только внутри.
 *
 * Почему именно так: кнопка «спрятать огласовки» показывает голое слово, и если бы ключом
 * была видимая строка, одно слово раздвоилось бы на два — с точками и без.
 */
export function wordKey(text) {
  return Array.from(normalizeHebrew(text))
    .filter((char) => !MARKS.has(char))
    .map((char) => FINAL_TO_REGULAR[char] || char)
    .join('')
    .trim();
}

/** Разбор на буквы: каждая со всеми своими точками. Нужен прописям и разбору слова. */
export function splitHebrewLetters(text) {
  const letters = [];
  for (const char of Array.from(normalizeHebrew(text))) {
    if (MARKS.has(char) && letters.length) letters[letters.length - 1] += char;
    else letters.push(char);
  }
  return letters;
}

/** Снять огласовки — то, что делает кнопка «спрятать огласовки». */
export function stripNiqqud(text) {
  if (!text) return '';
  return Array.from(text).filter((char) => !MARKS.has(char)).join('');
}

export function hasNiqqud(text) {
  return Array.from(text || '').some((char) => MARKS.has(char));
}

/**
 * Разбирает слово на буквы со всем, что к ним прицеплено.
 * Возвращает список: { letter, marks:Set, vowel, isSpace }.
 */
function parseLetters(text) {
  const units = [];
  for (const char of Array.from(text || '')) {
    if (MARKS.has(char)) {
      const last = units[units.length - 1];
      if (last && !last.isSpace) last.marks.add(char);
      continue;
    }
    units.push({ letter: char, marks: new Set(), isSpace: !isHebrewLetter(char) });
  }
  units.forEach((unit, index) => {
    unit.vowel = Object.keys(VOWEL_SOUND).find((mark) => unit.marks.has(mark)) || null;
    // Камац перед хатаф-камацем читается «о»: цоhора́йим, а не цаhора́йим.
    const next = units[index + 1];
    if (unit.vowel === QAMATS && next && next.marks.has(HATAF_QAMATS)) unit.vowel = QAMATS_QATAN;
  });
  return units;
}

/**
 * Звучит ли шва. В живой израильской речи она почти всегда немая — произносится
 * в начале слова (там сидят приставки бе-, ле-, ке-, ве-: бевакаша́, бесе́дер, мео́д)
 * и второй из двух подряд. Классическое правило «шва после долгой гласной звучит»
 * современной речи не соответствует: שְׁלוֹמְךָ говорят «шломха», а не «шеломеха».
 * Такие слова правятся полем `translit` у самого слова.
 */
function shvaSounds(units, index) {
  const unit = units[index];
  if (!unit.marks.has(SHVA)) return false;
  const previous = units[index - 1];
  if (!previous || previous.isSpace) return true;                             // в начале слова
  if (previous.marks.has(SHVA) && !shvaSounds(units, index - 1)) return true;  // вторая из двух
  return false;
}

/** Согласный звук буквы с учётом дагеша и точки над «ש». */
function consonantSound(unit) {
  const table = CONSONANTS[unit.letter];
  if (!table) return unit.letter;
  if (unit.letter === 'ש') return unit.marks.has(SIN_DOT) ? 'с' : 'ш';
  if (table.hard && unit.marks.has(DAGESH)) return table.hard;
  return table.soft;
}

/**
 * Главная работа: слово с огласовками → куски звучания.
 * Возвращает список кусков { text, isVowel } — по ним ставится ударение
 * и собирается готовая строка.
 */
function toChunks(text) {
  const units = parseLetters(text);
  const chunks = [];
  const push = (value, isVowel) => { if (value) chunks.push({ text: value, isVowel }); };
  /** Ждёт ли предыдущая согласная свою гласную — от этого зависит чтение «ו» и «י». */
  const consonantIsBare = () => {
    const last = chunks[chunks.length - 1];
    return Boolean(last) && !last.isVowel;
  };

  units.forEach((unit, index) => {
    if (unit.isSpace) { push(unit.letter, false); return; }
    const previous = units[index - 1];
    const next = units[index + 1];
    const isLast = !next || next.isSpace;

    /* «ו» чаще не согласная, а знак гласного: וֹ читается «о», וּ — «у».
       Согласной она остаётся, когда несёт собственную огласовку: מִצְוָה — «мицва». */
    if (unit.letter === 'ו' && !unit.marks.has(SHVA)) {
      const isHolam = unit.vowel === HOLAM || unit.vowel === HOLAM_HASER;
      if (isHolam && !unit.marks.has(DAGESH)) { push('о', true); return; }
      if (!unit.vowel && unit.marks.has(DAGESH)) { push('у', true); return; }
    }

    /* «י» после хирика — та же «и», отдельного звука не даёт; после цере/сеголя даёт «й». */
    if (unit.letter === 'י' && !unit.vowel && !unit.marks.has(SHVA) && previous) {
      if (previous.vowel === HIRIQ) return;
      if (previous.vowel === TSERE || previous.vowel === SEGOL) { push('й', false); return; }
    }

    /* Немая «ה» в конце слова: תּוֹרָה — «тора», а не «тораh». Мапик (точка) её оживляет. */
    if (unit.letter === 'ה' && isLast && !unit.vowel && !unit.marks.has(DAGESH)) return;
    /* «א» в конце слова без огласовки тоже молчит. */
    if (unit.letter === 'א' && isLast && !unit.vowel) return;

    push(consonantSound(unit), false);

    if (unit.vowel) {
      push(VOWEL_SOUND[unit.vowel], true);
      return;
    }
    if (unit.marks.has(SHVA) && shvaSounds(units, index)) push('е', true);
  });

  return chunks;
}

/** Русское письмо: «э» в начале слова и после гласной, «е» после согласной. */
function fixE(chunks) {
  chunks.forEach((chunk, index) => {
    if (chunk.text !== 'е') return;
    const previous = chunks[index - 1];
    const afterConsonant = previous && !previous.isVowel && previous.text.trim();
    if (!afterConsonant) chunk.text = 'э';
  });
}

/** «й» перед гласной сливается в одну букву: йад → яд, йеш → еш, йу → ю. */
const YOD_PAIRS = { а: 'я', е: 'е', э: 'е', у: 'ю' };

function mergeYod(chunks) {
  for (let index = chunks.length - 2; index >= 0; index -= 1) {
    const current = chunks[index];
    const next = chunks[index + 1];
    if (current.text !== 'й' || !next || !next.isVowel) continue;
    const merged = YOD_PAIRS[next.text];
    if (!merged) continue;               // «йо» и «йи» пишем раздельно: йом, йисраэль
    chunks.splice(index, 2, { text: merged, isVowel: true });
  }
}

/** Ламед без гласной по-русски мягкая: исраэ́ль, о́хель, шульха́н, коль. */
function softenLamed(chunks) {
  chunks.forEach((chunk, index) => {
    const next = chunks[index + 1];
    if (chunk.text === 'л' && (!next || !next.isVowel)) chunk.text = 'ль';
  });
}

/**
 * Ударение. В иврите оно чаще на последнем слоге, поэтому 1 — последний слог,
 * 2 — предпоследний и так далее. Ноль означает «не ставить» (односложные слова).
 */
function markStress(chunks, stressFromEnd) {
  if (!stressFromEnd) return;
  const vowels = chunks.filter((chunk) => chunk.isVowel);
  if (vowels.length < 2) return;         // в одном слоге ударение не показывают
  const target = vowels[vowels.length - stressFromEnd];
  if (target) target.text += STRESS_MARK;
}

/**
 * Слово с огласовками → русское чтение.
 * @param {string} text — слово или фраза на иврите с огласовками
 * @param {number} [stressFromEnd=1] — номер ударного слога с конца; 0 — без ударения
 */
export function translit(text, stressFromEnd = 1) {
  if (!text) return '';
  const words = String(text).split(/(\s+|[^֐-׿\s]+)/u);
  return words.map((word) => {
    if (!/[א-ת]/u.test(word)) return word;
    const known = QAMATS_QATAN_WORDS[word];
    if (known) return known;
    const chunks = toChunks(word);
    fixE(chunks);
    mergeYod(chunks);
    softenLamed(chunks);
    markStress(chunks, stressFromEnd);
    return chunks.map((chunk) => chunk.text).join('');
  }).join('');
}

/**
 * Чтение фразы: каждое слово получает своё ударение (по умолчанию на последний слог).
 * @param {string} phrase
 * @param {number[]} [stresses] — ударения по словам, если они не на последнем слоге
 */
export function translitPhrase(phrase, stresses) {
  const parts = String(phrase || '').split(/(\s+)/u);
  let wordIndex = 0;
  return parts.map((part) => {
    if (!/[א-ת]/u.test(part)) return part;
    const stress = stresses && stresses.length ? (stresses[wordIndex] ?? 1) : 1;
    wordIndex += 1;
    return translit(part, stress);
  }).join('');
}

/**
 * Разбор слова на слоги — для тренажёра чтения и для подсветки.
 * Слог здесь считается по-школьному: согласная плюс гласная, как учат читать алефбет.
 */
export function splitSyllables(text) {
  const units = parseLetters(text);
  const syllables = [];
  let current = '';
  units.forEach((unit, index) => {
    if (unit.isSpace) {
      if (current) { syllables.push(current); current = ''; }
      return;
    }
    const marks = Array.from(unit.marks).join('');
    current += unit.letter + marks;
    const sounds = unit.vowel || (unit.marks.has(SHVA) && shvaSounds(units, index));
    if (sounds) { syllables.push(current); current = ''; }
  });
  if (current) {
    if (syllables.length) syllables[syllables.length - 1] += current;
    else syllables.push(current);
  }
  return syllables;
}
