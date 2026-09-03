export function el(tag, options, children) {
  const node = document.createElement(tag);
  Object.entries(options || {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    // aria-* живёт строками: aria-pressed="false" — это осмысленное состояние, а не отсутствие
    // атрибута. Обычные же булевы атрибуты (disabled) при false просто не ставятся.
    const isAria = key.startsWith('aria-');
    if (value === false && !isAria) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? 'true' : String(value));
  });
  const list = Array.isArray(children) ? children : [children];
  list.forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(typeof child === 'object' ? child : String(child));
  });
  return node;
}

export function fill(target, children) {
  const node = typeof target === 'string' ? document.getElementById(target) : target;
  node.textContent = '';
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => node.append(child));
  return node;
}

/**
 * Своё окно подтверждения вместо системного confirm: в нём можно объяснить последствия
 * и дать кнопку «сначала выгрузить файл» — данные пользователя важнее лишнего клика.
 */
export function askConfirm(options) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog');
    const close = (answer) => {
      overlay.classList.add('hidden');
      document.removeEventListener('keydown', onKey, true);
      resolve(answer);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(false); }
    };

    const children = [
      el('h2', { id: 'dialog-title', style: 'margin-top:0', text: options.title }),
      el('p', { text: options.text }),
    ];
    if (options.hint) children.push(el('p', { class: 'faint', text: options.hint }));
    const row = el('div', { class: 'row', style: 'margin-top:24px' }, [
      el('button', { class: 'btn', type: 'button', onclick: () => close(true) }, options.confirmLabel || 'Продолжить'),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => close(false) }, 'Отмена'),
    ]);
    // Кнопку выгрузки передаёт вызывающий: dom.js — самый нижний модуль, и тянуть сюда
    // экран настроек значило бы замкнуть кольцо через половину приложения.
    if (options.exportFirst) {
      row.append(el('button', {
        class: 'btn btn-quiet', type: 'button', onclick: () => options.exportFirst(),
      }, 'Сначала выгрузить файл'));
    }
    children.push(row);

    fill('dialog-body', children);
    overlay.classList.remove('hidden');
    document.addEventListener('keydown', onKey, true);
  });
}

let toastTimer = null;
export function toast(message, isError) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.toggle('is-err', Boolean(isError));
  node.classList.add('is-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-open'), 3200);
}

/* Оба помощника ниже — общие мелочи вывода, а не чья-то частная логика:
   svgEl рисует значки и графики, plural склоняет русские числительные. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Узел SVG с атрибутами: графики прогресса и значки интерфейса. */
export const svgEl = (tag, attributes) => {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
};

/** Русское число словами: «осталось 3 дня». */
export function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
