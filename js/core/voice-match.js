/* ═══════════════════ VOICE-MATCH — «те ли звуки прозвучали» ═══════════════════
   Вся проверка произношения: что именно было сказано — гласные, согласные, их порядок.

   Владелец просил «вторую модель, которая слушает слово». Настоящая модель распознавания
   весит десятки мегабайт, тянет за собой WASM и на голосе новичка с русским акцентом
   ошибается ровно там, где важна точность. Здесь другого рода решение: у каждой фразы
   есть образцовая запись, и мы сравниваем звучание попытки прямо с ней — по спектру,
   с выравниванием во времени. Никаких моделей, никакой сети, полсотни строк математики.

   Проверено на 117 парах записей двух разных голосов (25.08.2026): та же фраза даёт
   0,07-0,19, разные фразы — 0,20-0,59, ни одного пересечения. Сравниваются не сами
   спектры, а их косинус-коэффициенты (MFCC) — на голых мел-энергиях шесть пар разных
   фраз попадали в диапазон одинаковых.                                                  */

const MFCC_RATE = 16000;
const MFCC_WINDOW = 512;          // 32 мс — внутри окна звук считается неизменным
const HOP = 160;             // шаг 10 мс
const BANDS = 26;            // полос мел-фильтра
const COEFFICIENTS = 13;     // сколько косинус-коэффициентов берём: дальше идёт шум
const SILENT = 0.015;        // тише — тишина, в сравнение не идёт
const MEL_LOW = 80;
const MEL_HIGH = 7600;

/* ——— Быстрое преобразование Фурье ———
   Своё, потому что браузер даёт спектр только у живого звука (AnalyserNode), а нам нужен
   спектр по кускам уже записанного. Классический радикс-2, длина окна — степень двойки. */

function fftMagnitudes(input) {
  const size = input.length;
  const real = Float32Array.from(input);
  const imaginary = new Float32Array(size);

  // перестановка по обратному порядку битов
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const swapReal = real[i]; real[i] = real[j]; real[j] = swapReal;
      const swapImaginary = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = swapImaginary;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let rotationReal = 1;
      let rotationImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const even = start + index;
        const odd = even + length / 2;
        const oddReal = real[odd] * rotationReal - imaginary[odd] * rotationImaginary;
        const oddImaginary = real[odd] * rotationImaginary + imaginary[odd] * rotationReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = rotationReal * stepReal - rotationImaginary * stepImaginary;
        rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
        rotationReal = nextReal;
      }
    }
  }

  const half = size / 2 + 1;
  const magnitudes = new Float32Array(half);
  for (let i = 0; i < half; i += 1) {
    magnitudes[i] = real[i] * real[i] + imaginary[i] * imaginary[i];
  }
  return magnitudes;
}

/** Треугольные фильтры по шкале мел: низкие частоты разбираем подробно, высокие грубо —
    примерно так их различает ухо. Считаем один раз, дальше только умножаем. */
const MEL_BANK = (() => {
  const toMel = (hertz) => 2595 * Math.log10(1 + hertz / 700);
  const toHertz = (mel) => 700 * (10 ** (mel / 2595) - 1);
  const lowMel = toMel(MEL_LOW);
  const highMel = toMel(MEL_HIGH);
  const edges = Array.from({ length: BANDS + 2 },
    (unused, i) => toHertz(lowMel + ((highMel - lowMel) * i) / (BANDS + 1)));
  const bins = MFCC_WINDOW / 2 + 1;
  const frequency = (bin) => (bin * MFCC_RATE) / MFCC_WINDOW;

  return edges.slice(0, BANDS).map((low, band) => {
    const middle = edges[band + 1];
    const high = edges[band + 2];
    const weights = new Float32Array(bins);
    for (let bin = 0; bin < bins; bin += 1) {
      const hertz = frequency(bin);
      if (hertz >= low && hertz <= middle) weights[bin] = (hertz - low) / Math.max(middle - low, 1e-9);
      else if (hertz >= middle && hertz <= high) weights[bin] = (high - hertz) / Math.max(high - middle, 1e-9);
    }
    return weights;
  });
})();

const HANN = Float32Array.from({ length: MFCC_WINDOW },
  (unused, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (MFCC_WINDOW - 1)));

/* Косинусное преобразование (DCT-II) готовим таблицей: кадров сотни, а таблица одна. */
const DCT_TABLE = Array.from({ length: COEFFICIENTS }, (unused, k) =>
  Float32Array.from({ length: BANDS },
    (nothing, band) => Math.cos((Math.PI * (k + 1) * (band + 0.5)) / BANDS)));

/**
 * Портрет звучания: по кадру на каждые 10 мс, в кадре — 13 чисел о форме спектра.
 * Это классические мел-кепстральные коэффициенты: они описывают, какой звук произнесён,
 * почти не завися от высоты голоса и громкости. Нулевой коэффициент (общая громкость)
 * отброшен, а среднее по всей записи вычитается — так снимается окраска микрофона,
 * иначе чужая гарнитура выглядела бы как другое произношение.
 */
export function soundProfile(samples) {
  const frames = [];
  for (let start = 0; start + MFCC_WINDOW <= samples.length; start += HOP) {
    let power = 0;
    const piece = new Float32Array(MFCC_WINDOW);
    for (let i = 0; i < MFCC_WINDOW; i += 1) {
      const value = samples[start + i];
      power += value * value;
      piece[i] = value * HANN[i];
    }
    if (Math.sqrt(power / MFCC_WINDOW) < SILENT) continue;

    const spectrum = fftMagnitudes(piece);
    const energies = new Float32Array(BANDS);
    for (let band = 0; band < BANDS; band += 1) {
      const weights = MEL_BANK[band];
      let energy = 0;
      for (let bin = 0; bin < weights.length; bin += 1) energy += weights[bin] * spectrum[bin];
      energies[band] = Math.log(energy + 1e-10);
    }

    const frame = new Float32Array(COEFFICIENTS);
    for (let k = 0; k < COEFFICIENTS; k += 1) {
      const basis = DCT_TABLE[k];
      let sum = 0;
      for (let band = 0; band < BANDS; band += 1) sum += energies[band] * basis[band];
      frame[k] = sum * Math.sqrt(2 / BANDS);
    }
    frames.push(frame);
  }

  // среднее по записи — это про микрофон и комнату, а не про сказанное
  if (frames.length) {
    const average = new Float64Array(COEFFICIENTS);
    frames.forEach((frame) => frame.forEach((value, k) => { average[k] += value; }));
    for (let k = 0; k < COEFFICIENTS; k += 1) average[k] /= frames.length;
    frames.forEach((frame) => {
      for (let k = 0; k < COEFFICIENTS; k += 1) frame[k] -= average[k];
    });
  }
  return frames;
}

/** Косинусное расстояние двух кадров: 0 — звучат одинаково, 1 — совсем по-разному. */
function frameDistance(first, second) {
  let dot = 0;
  let firstNorm = 0;
  let secondNorm = 0;
  for (let i = 0; i < COEFFICIENTS; i += 1) {
    dot += first[i] * second[i];
    firstNorm += first[i] * first[i];
    secondNorm += second[i] * second[i];
  }
  return 1 - dot / (Math.sqrt(firstNorm * secondNorm) + 1e-9);
}

/**
 * Расстояние между двумя записями с выравниванием во времени: говорить можно быстрее
 * или медленнее образца, и это не ошибка — важно, что звуки идут в том же порядке.
 */
export function soundDistance(reference, attempt) {
  if (!reference || !attempt || reference.length < 3 || attempt.length < 3) return null;

  const width = attempt.length + 1;
  let previous = new Float64Array(width).fill(Infinity);
  let current = new Float64Array(width);
  previous[0] = 0;

  for (let i = 1; i <= reference.length; i += 1) {
    current[0] = Infinity;
    for (let j = 1; j <= attempt.length; j += 1) {
      const step = Math.min(previous[j], current[j - 1], previous[j - 1]);
      current[j] = frameDistance(reference[i - 1], attempt[j - 1]) + step;
    }
    const swap = previous; previous = current; current = swap;
  }
  return previous[attempt.length] / (reference.length + attempt.length);
}

/* ——— Шкала ———
   На проверенных записях граница проходит около 0,19: своё до 0,185, чужое от 0,201.
   Но это два синтезированных голоса в тишине. Живой человек с русским акцентом, в комнате
   и через телефонный микрофон заведомо дальше от образца, поэтому шкала растянута:
   вердикта «сказано неверное слово» здесь нет, есть мера близости. Решение остаётся
   за человеком, а линии на экране показывают, где именно разошлось.                    */
const VERY_CLOSE = 0.10;     // ближе не бывает даже у другого голоса с той же фразой
const FAR = 0.45;            // дальше — заведомо другое звучание

/** Насколько похоже прозвучали сами звуки: 1 — как в образце, 0 — совсем другое. */
export function soundMatch(reference, attempt) {
  const distance = soundDistance(reference, attempt);
  if (distance === null) return null;
  return Math.max(0, Math.min(1, 1 - (distance - VERY_CLOSE) / (FAR - VERY_CLOSE)));
}

export function compareSound(reference, attempt) {
  const match = soundMatch(reference, attempt);
  if (match === null) return { ok: false, text: 'Слишком коротко — скажи фразу целиком.' };
  const percent = Math.round(match * 100);
  if (match >= 0.75) return { ok: true, match, text: `${percent} % — звучит близко к образцу.` };
  if (match >= 0.5) {
    return { ok: false, match, text: `${percent} % — узнаётся, но часть звуков ушла в сторону.` };
  }
  return { ok: false, match, text: `${percent} % — звучит заметно иначе, послушай образец ещё раз.` };
}
