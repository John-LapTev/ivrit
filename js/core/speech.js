import { DEFAULT_SPEECH_RATE } from './constants.js';
import { normalizeHebrew } from './translit.js';

/* ═══════════════════ SPEECH — озвучка (he-IL) ═══════════════════

   Записи заранее, а не синтез на лету: приложение работает офлайн, а системного голоса
   иврита на настольных системах чаще всего нет вовсе. Поэтому встроенный синтез здесь —
   не запасной путь «на всякий случай», а последняя надежда для слов, которые владелец
   добавил сам и которые никто не озвучивал.

   ⚠️ Ключ записи — слово В ФОРМЕ NFC, с огласовками. Ту же нормализацию делает
   tools/build-audio.py при сборке. Если хоть где-то её пропустить, одна и та же огласовка
   из разных источников даст разные байты, и звук молча исчезнет.                       */

/* Расходы на озвучку. Держим цифрами в коде: приложение офлайн и в сеть за курсом не ходит,
   поэтому и сумма, и курс обновляются руками при выпуске версии. */
export const VOICE_COST = {
  usd: 1.62,           // синтез речи через Media Flow, суммарно за всё время
  rate: 86.89,         // ₽ за доллар, официальный курс ЦБ РФ
  updated: '04.09.2026',
  clips: 1025,        // записей: слова, примеры, фразы программы, грамматика, разговоры
};

export const AUDIO_INDEX_URL = 'audio/index.json';

export const speech = {
  voice: null,
  ready: false,
  rate: DEFAULT_SPEECH_RATE,
  clips: null,        // карта «фраза → файл записи», см. audio/index.json
  player: null,       // текущий проигрыватель, чтобы обрывать предыдущую фразу
  lastSource: null,   // 'запись' или 'синтез' — показывается в настройках при проверке

  async init() {
    // cache: 'reload' обязателен: указатель растёт с каждой новой озвучкой, а браузер
    // держит старую копию — новые фразы оказываются «без звука» даже после обновления.
    try {
      const response = await fetch(AUDIO_INDEX_URL, { cache: 'reload' });
      if (response.ok) {
        const index = await response.json();
        if (index && typeof index === 'object' && Object.keys(index).length) this.clips = index;
      }
    } catch (error) {
      this.clips = null;   // записей нет — работаем на системном голосе, если он есть
    }
    if (!('speechSynthesis' in window)) { this.ready = true; return; }
    const voices = await new Promise((resolve) => {
      const existing = speechSynthesis.getVoices();
      if (existing.length) return resolve(existing);
      const timer = setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
      speechSynthesis.addEventListener('voiceschanged', () => {
        clearTimeout(timer);
        resolve(speechSynthesis.getVoices());
      }, { once: true });
    });
    this.voice = voices.find((item) => item.lang.toLowerCase().startsWith('he')) || null;
    this.ready = true;
  },

  get available() { return Boolean(this.voice) || Boolean(this.clips); },

  /** Имя файла записи для фразы. Единственное место, где ищут по ключу. */
  clipFor(text) {
    if (!this.clips || !text) return null;
    return this.clips[normalizeHebrew(text)] || null;
  },

  hasClip(text) { return Boolean(this.clipFor(text)); },

  /** Путь к образцовой записи — нужен, чтобы сравнить с ней собственное произношение. */
  clipUrl(text) {
    const clip = this.clipFor(text);
    return clip ? `audio/${clip}` : null;
  },

  speak(text) {
    if (!text) return false;
    const clip = this.clipFor(text);
    if (clip) {
      try {
        if (this.player) { this.player.pause(); this.player = null; }
        const player = new Audio(`audio/${clip}`);
        player.playbackRate = this.rate;
        // Запись может не проиграться: файла нет в кеше и нет сети, или автозапуск
        // отклонён. Тогда молчать нельзя — переключаемся на системный голос.
        player.addEventListener('error', () => this.speakBySystem(text), { once: true });
        player.play().catch(() => this.speakBySystem(text));
        this.player = player;
        this.lastSource = 'запись';
        return true;
      } catch (error) {
        // не вышло проиграть запись — падаем на системный голос ниже
      }
    }
    return this.speakBySystem(text);
  },

  /** Системный голос — запасной путь. У иврита он есть далеко не везде. */
  speakBySystem(text) {
    if (!this.voice) return false;
    try {
      speechSynthesis.cancel();   // иначе фразы наслаиваются при быстрых нажатиях
      const utterance = new SpeechSynthesisUtterance(normalizeHebrew(text));
      utterance.voice = this.voice;
      utterance.lang = this.voice.lang || 'he-IL';
      utterance.rate = this.rate;
      speechSynthesis.speak(utterance);
      this.lastSource = 'синтез';
      return true;
    } catch (error) {
      return false;
    }
  },

  /** Оборвать всё, что сейчас звучит. */
  stop() {
    if (this.player) { this.player.pause(); this.player = null; }
    try { speechSynthesis.cancel(); } catch (error) { /* голоса может не быть вовсе */ }
  },

  /**
   * То же самое, но обещание разрешается, когда запись доиграла.
   * Нужно для списков подряд: по таймеру слова наезжают друг на друга и обрываются,
   * а на слух это выглядит как «читает вразнобой».
   */
  speakUntilEnd(text) {
    return new Promise((resolve) => {
      if (!this.speak(text)) { resolve(false); return; }
      const player = this.player;
      if (player && this.hasClip(text)) {
        const finish = () => resolve(true);
        player.addEventListener('ended', finish, { once: true });
        player.addEventListener('error', finish, { once: true });
        return;
      }
      const check = setInterval(() => {
        if (!speechSynthesis.speaking) { clearInterval(check); resolve(true); }
      }, 120);
      setTimeout(() => { clearInterval(check); resolve(true); }, 6000);
    });
  },
};
