import { STORE_WORDS, USER_LEVEL } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { isWordAvailable } from '../core/modes.js';
import { wordKey } from '../core/translit.js';
import { speech } from '../core/speech.js';
import { isLearned, isStarted } from '../core/srs.js';
import { state } from '../core/state.js';
import { el, fill, toast } from './dom.js';
import { bigWord, wordLine } from './word.js';
import { allTopics } from './home.js';
import { ALL_TOPICS, iconLabel } from './icons.js';
import { showScreen } from './screens.js';

/* ——— Словарь ——— */

export async function saveWord(word) {
  // Сравниваем по ключу: одно и то же слово с огласовками и без них — не два разных.
  const key = wordKey(word.heb);
  const exists = state.words.find((item) => wordKey(item.heb) === key);
  if (exists) throw new Error('Такое слово уже есть.');
  const record = Object.assign({ tags: [], ulpan: 0, createdAt: new Date().toISOString() }, word);
  const id = await dbPut(STORE_WORDS, record);
  record.id = id;
  state.words.push(record);
  return record;
}

export function renderDictionary() {
  const topics = allTopics();
  fill('dict-topics', topics.map((topic) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': state.dictTopic === topic,
    onclick: () => { state.dictTopic = topic; renderDictionary(); },
  }, topic)));

  const search = state.dictSearch.trim();
  const searchLower = search.toLowerCase();
  // Иврит ищем по ключу — тогда слово находится и с огласовками, и голым написанием.
  const searchKey = wordKey(search);
  const visible = state.words.filter((word) => {
    if (state.dictTopic !== ALL_TOPICS && word.topic !== state.dictTopic) return false;
    if (!search) return true;
    return (searchKey !== '' && wordKey(word.heb).includes(searchKey))
      || String(word.translit || '').toLowerCase().includes(searchLower)
      || word.translation.toLowerCase().includes(searchLower);
  }).sort((first, second) => first.level - second.level || first.id - second.id);

  document.getElementById('dict-count').textContent =
    `${visible.length} слов · всего в базе ${state.words.length}`;

  fill('dict-list', visible.map((word) => {
    const record = state.srs.get(word.id);
    const locked = !isWordAvailable(word);
    const status = locked ? el('span', { class: 'badge', text: `уровень ${word.level}` })
      : isLearned(record) ? el('span', { class: 'badge badge-ok', text: 'выучено' })
      : isStarted(record) ? el('span', { class: 'badge badge-accent', text: 'в работе' })
      : el('span', { class: 'badge', text: 'новое' });
    return el('button', {
      class: locked ? 'word-row is-locked' : 'word-row', type: 'button',
      onclick: () => openWordSheet(word),
    }, [
      wordLine(word.heb),
      el('span', { class: 'word-meta' }, [
        el('div', { class: 'word-translit', text: word.translit }),
        el('div', { class: 'word-translation', text: word.translation }),
      ]),
      status,
    ]);
  }));
}

function openWordSheet(word) {
  const record = state.srs.get(word.id);
  const children = [
    bigWord(word.heb),
    el('div', { class: 'card-translit', id: 'char-sheet-title', text: word.translit }),
    el('div', { class: 'card-translation', text: word.translation }),
    el('p', { class: 'faint', text: [word.pos, word.topic, `уровень ${word.level || 'свой'}`].filter(Boolean).join(' · ') }),
  ];

  if (word.example && word.example.heb) {
    children.push(el('div', { class: 'example-block', style: 'text-align:left' }, [
      el('div', { class: 'sentence', text: word.example.heb }),
      el('div', { class: 'sentence-translit', text: word.example.translit || '' }),
      el('div', { class: 'sentence-translation', text: word.example.translation || '' }),
    ]));
  }
  if (record) {
    children.push(el('p', { class: 'faint', text:
      `Показов: ${record.seen} · ошибок: ${record.errors} · ошибок ударения: ${record.stressErrors} · следующий показ: ${record.due}` }));
  }
  const row = el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' });
  if (speech.available) {
    row.append(el('button', { class: 'btn btn-quiet btn-small', type: 'button',
      onclick: () => speech.speak(word.heb) }, iconLabel('sound', 'Слово')));
    if (word.example && word.example.heb) {
      row.append(el('button', { class: 'btn btn-quiet btn-small', type: 'button',
        onclick: () => speech.speak(word.example.heb) }, iconLabel('sound', 'Пример')));
    }
  }
  row.append(el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: closeCharSheet }, 'Закрыть'));
  children.push(row);
  fill('char-sheet-body', children);
  document.getElementById('char-sheet').classList.add('is-open');
}

export function closeCharSheet() {
  document.getElementById('char-sheet').classList.remove('is-open');
}

/* ——— Массовый импорт списком ——— */

export function parseBulkInput(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[;\t]/).map((part) => part.trim());
    const heb = parts[0];
    const translit = parts[1] || '';
    const translation = parts[2] || '';
    const key = wordKey(heb);
    const duplicate = state.words.some((word) => wordKey(word.heb) === key);
    return {
      heb,
      translit,
      translation,
      include: Boolean(heb) && Boolean(translation) && !duplicate,
      duplicate,
    };
  });
}

export function renderBulkPreview() {
  const rows = state.bulkRows;
  if (!rows.length) { fill('bulk-preview', el('p', { class: 'faint', text: 'Пока пусто.' })); return; }
  const ready = rows.filter((row) => row.include).length;

  const table = el('table', { class: 'preview-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: '' }), el('th', { text: 'Слово' }),
      el('th', { text: 'Чтение' }), el('th', { text: 'Перевод' }), el('th', { text: '' }),
    ])),
    el('tbody', {}, rows.map((row, index) => {
      const checkbox = el('input', { type: 'checkbox', 'aria-label': `Добавить ${row.heb}` });
      checkbox.checked = row.include;
      checkbox.addEventListener('change', () => {
        state.bulkRows[index].include = checkbox.checked;
        renderBulkPreview();
      });
      return el('tr', {}, [
        el('td', {}, checkbox),
        el('td', {}, wordLine(row.heb)),
        el('td', { text: row.translit || '—' }),
        el('td', { text: row.translation || '—' }),
        el('td', {}, row.duplicate ? el('span', { class: 'badge', text: 'уже есть' })
          : !row.translation ? el('span', { class: 'badge badge-err', text: 'нет перевода' }) : ''),
      ]);
    })),
  ]);

  fill('bulk-preview', [
    el('h3', { text: `Проверь перед добавлением: ${ready} из ${rows.length}` }),
    el('div', { class: 'table-wrap' }, table),
    el('button', {
      class: 'btn', type: 'button', disabled: ready === 0, style: 'margin-top:16px',
      onclick: applyBulkImport,
    }, `Добавить ${ready} слов`),
  ]);
}

async function applyBulkImport() {
  const rows = state.bulkRows.filter((row) => row.include);
  let added = 0;
  for (const row of rows) {
    try {
      await saveWord({
        heb: row.heb,
        translit: row.translit,
        translation: row.translation,
        pos: '',
        topic: 'Мои слова',
        level: USER_LEVEL,
        example: null,
      });
      added += 1;
    } catch (error) {
      // Дубликат — пропускаем молча, он и так помечен в таблице.
    }
  }
  state.bulkRows = [];
  document.getElementById('bulk-input').value = '';
  fill('bulk-preview', []);
  toast(`Добавлено слов: ${added}`);
  showScreen('dict');
}
