import { state } from '../core/state.js';
import { renderDialogList } from './dialogs-screen.js';
import { renderLessonList } from './grammar.js';

/* ——— Вкладки раздела «Порядок слов» ———
   Правила и разговоры живут на одном экране: и то, и другое — про то, как слова
   выстраиваются во фразу. Разные экраны развели бы одну тему по разным углам. */

const TAB_TITLES = { rules: 'Порядок слов', dialogs: 'Разговоры' };

export function switchGrammarTab(tab) {
  const active = TAB_TITLES[tab] ? tab : 'rules';
  state.grammarTab = active;
  document.querySelectorAll('[data-grammar-tab]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.grammarTab === active));
  });
  document.getElementById('grammar-rules').classList.toggle('hidden', active !== 'rules');
  document.getElementById('grammar-dialogs').classList.toggle('hidden', active !== 'dialogs');
  document.getElementById('grammar-heading').textContent = TAB_TITLES[active];
  if (active === 'dialogs') renderDialogList();
  else renderLessonList();
}
