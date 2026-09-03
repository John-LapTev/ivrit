import { svgEl } from './dom.js';

/* ═══════════════════ UI — состояние, экраны, навигация ═══════════════════ */

/* ——— Иконки тем: рисованные SVG, не эмодзи (требование владельца 14.08.2026) ———
   Каждая иконка — мягкий цветной круг и поверх него простая фигура. Цвета берутся из темы,
   поэтому иконки одинаково смотрятся и в светлом, и в тёмном оформлении.                */

const TOPIC_ICONS = {
  'Все темы': { color: '#7c82f4', shapes: [
    { tag: 'circle', cx: 9, cy: 9, r: 2.6 }, { tag: 'circle', cx: 15, cy: 9, r: 2.6 },
    { tag: 'circle', cx: 9, cy: 15, r: 2.6 }, { tag: 'circle', cx: 15, cy: 15, r: 2.6 },
  ] },
  /* Служебные слова: предлоги и союзы — «клей», которым держится фраза. */
  'Служебные слова': { color: '#64748b', shapes: [
    ['rect', { x: 5, y: 10, width: 6, height: 4, rx: 2 }],
    ['rect', { x: 13, y: 10, width: 6, height: 4, rx: 2 }],
    ['path', { d: 'M11 12h2' }],
  ] },
  'Приветствия': { color: '#f59e0b', shapes: [
    { tag: 'circle', cx: 12, cy: 12, r: 6.4, fill: 'none', stroke: true },
    { tag: 'circle', cx: 9.8, cy: 10.4, r: 1 }, { tag: 'circle', cx: 14.2, cy: 10.4, r: 1 },
    { tag: 'path', d: 'M9 13.8c.9 1.2 2 1.8 3 1.8s2.1-.6 3-1.8', fill: 'none', stroke: true },
  ] },
  'Общение': { color: '#60a5fa', shapes: [
    { tag: 'path', d: 'M5 8.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H9.5L6.5 16v-2.5H7a2 2 0 0 1-2-2z' },
    { tag: 'path', d: 'M17 10h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-.5v2l-2.5-2H12', fill: 'none', stroke: true },
  ] },
  'Вопросы': { color: '#a78bfa', shapes: [
    { tag: 'circle', cx: 12, cy: 12, r: 7, fill: 'none', stroke: true },
    { tag: 'path', d: 'M10 9.6a2.2 2.2 0 0 1 4 1c0 1.5-2 1.6-2 3', fill: 'none', stroke: true },
    { tag: 'circle', cx: 12, cy: 16.2, r: 1 },
  ] },
  'Числа и время': { color: '#0ea5e9', shapes: [
    { tag: 'circle', cx: 12, cy: 12, r: 7, fill: 'none', stroke: true },
    { tag: 'path', d: 'M12 8v4.3l2.8 1.7', fill: 'none', stroke: true },
  ] },
  'Семья и люди': { color: '#f472b6', shapes: [
    { tag: 'circle', cx: 9, cy: 9.4, r: 2.2 },
    { tag: 'path', d: 'M5.4 17.6c0-2.3 1.6-3.8 3.6-3.8s3.6 1.5 3.6 3.8z' },
    { tag: 'circle', cx: 15.4, cy: 10.2, r: 1.9, opacity: '.55' },
    { tag: 'path', d: 'M12.4 17.6c0-2 1.4-3.3 3-3.3s3 1.3 3 3.3z', opacity: '.55' },
  ] },
  'Еда': { color: '#ef7d5a', shapes: [
    { tag: 'path', d: 'M5 12h14c0 3.3-3.1 6-7 6s-7-2.7-7-6z' },
    { tag: 'path', d: 'M9 9c0-1.2.6-1.8.6-2.6S9 5 9 5M12.5 9c0-1.2.6-1.8.6-2.6s-.6-1.4-.6-1.4', fill: 'none', stroke: true },
  ] },
  'Магазин и деньги': { color: '#22c3a6', shapes: [
    { tag: 'path', d: 'M6 9h12l-1 9.5a1 1 0 0 1-1 .9H8a1 1 0 0 1-1-.9z' },
    { tag: 'path', d: 'M9.4 9V7.6a2.6 2.6 0 0 1 5.2 0V9', fill: 'none', stroke: true },
  ] },
  'Город и дорога': { color: '#3b82f6', shapes: [
    { tag: 'rect', x: 13, y: 6, width: 6, height: 12, rx: 1, opacity: '.55' },
    { tag: 'rect', x: 5, y: 9, width: 6, height: 9, rx: 1 },
    { tag: 'rect', x: 6.6, y: 10.6, width: 1.6, height: 1.6, rx: .3, invert: true },
    { tag: 'rect', x: 6.6, y: 13.8, width: 1.6, height: 1.6, rx: .3, invert: true },
    { tag: 'path', d: 'M5 20.2h3.4M11 20.2h2M15.6 20.2h3.4', fill: 'none', stroke: true },
  ] },
  'Дом и быт': { color: '#f97316', shapes: [
    { tag: 'path', d: 'M12 4.5l7 5.4V19a.9.9 0 0 1-.9.9h-4.2v-5h-3.8v5H5.9A.9.9 0 0 1 5 19V9.9z' },
  ] },
  'Здоровье': { color: '#ef4444', shapes: [
    { tag: 'path', d: 'M12 18.5s-6-3.7-6-7.6A3.4 3.4 0 0 1 12 8.6a3.4 3.4 0 0 1 6 2.3c0 3.9-6 7.6-6 7.6z' },
    { tag: 'path', d: 'M8.6 12.4h2l1-1.6 1.4 3 .9-1.4h1.5', fill: 'none', stroke: true, invert: true },
  ] },
  'Работа и документы': { color: '#8b5cf6', shapes: [
    { tag: 'rect', x: 4.5, y: 8.6, width: 15, height: 10, rx: 2 },
    { tag: 'path', d: 'M9.6 8.6V7.4a1.6 1.6 0 0 1 1.6-1.6h1.6a1.6 1.6 0 0 1 1.6 1.6v1.2', fill: 'none', stroke: true },
    { tag: 'rect', x: 10.6, y: 12.2, width: 2.8, height: 2, rx: .5, invert: true },
  ] },
  'Погода и праздники': { color: '#fbbf24', shapes: [
    { tag: 'circle', cx: 8.6, cy: 7.6, r: 2.8 },
    { tag: 'path', d: 'M8.6 3.4v1.2M11.1 5.1l.9-.9M6.1 5.1l-.9-.9M4.5 7.6H3.3', fill: 'none', stroke: true },
    { tag: 'path', d: 'M7.8 18.4a3.2 3.2 0 0 1 .2-6.4 4.2 4.2 0 0 1 8.1 1.1 2.65 2.65 0 0 1-.1 5.3z', opacity: '.55' },
  ] },
  'Мои слова': { color: '#eab308', shapes: [
    { tag: 'path', d: 'M12 4.8l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L4.5 10.3l5.2-.8z' },
  ] },
};

const TOPIC_ICON_FALLBACK = { color: '#7c82f4', shapes: [
  { tag: 'circle', cx: 12, cy: 12, r: 6.6, fill: 'none', stroke: true },
  { tag: 'circle', cx: 12, cy: 12, r: 2.4 },
] };

/** Строит иконку темы: мягкий круг-подложка и фигура поверх. */
export function topicIcon(topic, size) {
  const spec = TOPIC_ICONS[topic] || TOPIC_ICON_FALLBACK;
  const svg = svgEl('svg', { viewBox: '0 0 24 24', width: size || 34, height: size || 34, 'aria-hidden': 'true' });
  svg.append(svgEl('circle', { cx: 12, cy: 12, r: 11.5, fill: spec.color, opacity: '.14' }));
  spec.shapes.forEach((shape) => {
    const attributes = { fill: shape.invert ? 'var(--surface-strong)' : spec.color };
    if (shape.stroke) {
      attributes.fill = shape.fill === 'none' ? 'none' : attributes.fill;
      attributes.stroke = shape.invert ? 'var(--surface-strong)' : spec.color;
      attributes['stroke-width'] = 1.6;
      attributes['stroke-linecap'] = 'round';
      attributes['stroke-linejoin'] = 'round';
    }
    if (shape.opacity) attributes.opacity = shape.opacity;
    ['cx', 'cy', 'r', 'd', 'x', 'y', 'width', 'height', 'rx'].forEach((key) => {
      if (shape[key] !== undefined) attributes[key] = shape[key];
    });
    svg.append(svgEl(shape.tag, attributes));
  });
  return svg;
}
