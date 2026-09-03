import { releaseMicrophone } from '../core/recorder.js';
import { state } from '../core/state.js';
import { switchProgressTab } from './progress.js';
import { renderSettings } from './settings.js';
import { renderDictionary } from './dict.js';
import { renderAlefbet } from './alefbet-screen.js';
import { renderDialog } from './dialogs-screen.js';
import { renderHardScreen } from './hard-screen.js';
import { renderHome } from './home.js';
import { renderPlayerBadge } from './rank.js';
import { switchGrammarTab } from './tabs.js';
import { renderTeacher, renderTeacherDay } from './teacher-course.js';
import { renderTeacherTask } from './teacher-tasks.js';

const SCREEN_TITLES = {
  home: 'Иврит с нуля',
  train: 'Тренировка',
  alefbet: 'Алефбет',
  dict: 'Слова',
  add: 'Новое слово',
  bulk: 'Список слов',
  grammar: 'Порядок слов',
  lesson: 'Урок',
  dialog: 'Разговор',
  teacher: 'Программа занятий',
  'teacher-day': 'Занятие',
  'teacher-task': 'Задание',
  progress: 'Прогресс',
  settings: 'Настройки',
  hard: 'Трудные слова',
  'hard-drill': 'Трудные слова',
};

const TAB_FOR_SCREEN = { home: 'home', train: 'home', alefbet: 'alefbet', dict: 'dict', add: 'dict', bulk: 'dict',
  grammar: 'grammar', lesson: 'grammar', dialog: 'grammar',
  teacher: 'teacher', 'teacher-day': 'teacher', 'teacher-task': 'teacher',
  hard: 'home', 'hard-drill': 'home',
  progress: 'progress', settings: 'settings' };

/** Вернуться туда, откуда пришли на этот экран. Если неизвестно — в раздел по умолчанию. */
export function goBack(screen, fallback) {
  const from = state.cameFrom[screen];
  if (from && from.screen === 'teacher-day') {
    state.teacherDay = from.day || state.teacherDay;
    showScreen('teacher-day');
    return;
  }
  showScreen((from && from.screen) || fallback);
}

/** Подписывает кнопку возврата под то место, откуда пришли. */
export function syncBackButton(id, screen, fallbackLabel, fallbackScreen) {
  const button = document.getElementById(id);
  if (!button) return;
  const from = state.cameFrom[screen];
  const label = from && from.screen === 'teacher-day' ? '← К занятию'
    : from && from.screen === 'home' ? '← На главную'
    : fallbackLabel;
  button.textContent = label;
  button.onclick = () => goBack(screen, fallbackScreen);
}

export function showScreen(name) {
  // Уходим с задания — отпускаем микрофон, иначе в браузере продолжает гореть
  // индикатор записи, хотя проверять уже нечего.
  if (state.screen === 'teacher-task' && name !== 'teacher-task') releaseMicrophone();
  if (state.screen === 'hard-drill' && name !== 'hard-drill') releaseMicrophone();
  state.screen = name;
  document.querySelectorAll('.screen').forEach((node) => {
    node.classList.toggle('is-active', node.id === `screen-${name}`);
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    if (TAB_FOR_SCREEN[name] === tab.dataset.go) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  document.getElementById('header-title').textContent = SCREEN_TITLES[name] || '';
  const isDrill = name === 'train' || name === 'hard-drill';
  document.getElementById('tabbar').classList.toggle('hidden', isDrill);
  document.body.classList.toggle('is-training', isDrill);
  renderPlayerBadge();
  window.scrollTo(0, 0);

  if (name === 'home') renderHome();
  if (name === 'alefbet') renderAlefbet();
  if (name === 'dict') renderDictionary();
  if (name === 'grammar') switchGrammarTab(state.grammarTab);
  if (name === 'dialog') renderDialog();
  if (name === 'teacher') renderTeacher();
  if (name === 'teacher-day') renderTeacherDay();
  if (name === 'teacher-task') renderTeacherTask();
  if (name === 'hard') renderHardScreen();
  if (name === 'progress') switchProgressTab(state.progressTab);
  if (name === 'settings') renderSettings();
}
