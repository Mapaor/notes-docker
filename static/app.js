const form = document.querySelector('#note-form');
const contentInput = document.querySelector('#content');
const notesElement = document.querySelector('#notes');
const statusElement = document.querySelector('#status');
const deleteOldestButton = document.querySelector('#delete-oldest');
const activarConfirmacioEliminar = false;
let currentNotes = [];
let editingNoteId = null;

function showStatus(message = '') { statusElement.textContent = message; }

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return 'fa uns segons';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `fa ${minutes} minut${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `fa ${hours} hor${hours === 1 ? 'a' : 'es'}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ahir';
  return `fa ${days} dies`;
}

function appendTextWithLinks(element, content) {
  const urlPattern = /https?:\/\/[^\s<]+/gi;
  let cursor = 0;
  for (const match of content.matchAll(urlPattern)) {
    const url = match[0].replace(/[),.;!?]+$/, '');
    const start = match.index;
    element.append(document.createTextNode(content.slice(cursor, start)));
    const link = document.createElement('a');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = url;
    element.append(link);
    cursor = start + url.length;
  }
  element.append(document.createTextNode(content.slice(cursor)));
}

function renderNotes(notes) {
  currentNotes = notes;
  deleteOldestButton.hidden = notes.length === 0;
  const unavailable = notes.length < 10;
  deleteOldestButton.classList.toggle('is-disabled', unavailable);
  deleteOldestButton.setAttribute('aria-disabled', String(unavailable));
  deleteOldestButton.dataset.confirming = 'false';
  deleteOldestButton.textContent = 'Elimina les últimes 10 notes';
  notesElement.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No hi ha cap nota de moment.';
    notesElement.append(empty);
    return;
  }
  for (const note of notes) {
    const article = document.createElement('article'); article.className = 'note';
    const body = document.createElement('div'); body.className = 'note-content'; appendTextWithLinks(body, note.content);
    const meta = document.createElement('div'); meta.className = 'note-meta';
    const time = document.createElement('time'); time.dateTime = new Date(note.created_at * 1000).toISOString(); time.textContent = relativeTime(note.created_at);
    const actions = document.createElement('div'); actions.className = 'actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copia'; copy.addEventListener('click', () => copyNote(note.content, copy));
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edita'; edit.addEventListener('click', () => editNote(note));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Elimina'; remove.addEventListener('click', () => confirmDelete(note.id, remove));
    actions.append(copy, edit, remove); meta.append(time, actions); article.append(body, meta); notesElement.append(article);
  }
}

async function loadNotes() {
  try { const response = await fetch('/api/notes'); if (!response.ok) throw new Error(); renderNotes(await response.json()); }
  catch { showStatus('No s\'han pogut carregar les notes. Comprova la connexió i torna-ho a provar.'); }
}

async function submitNote(event) {
  event.preventDefault();
  if (!contentInput.value.trim()) { showStatus('Escriu alguna cosa abans d\'afegir una nota.'); contentInput.focus(); return; }
  const button = form.querySelector('button'); button.disabled = true; showStatus();
  const editing = editingNoteId !== null;
  const url = editing ? `/api/notes/${editingNoteId}` : '/api/notes';
  const method = editing ? 'PUT' : 'POST';
  try {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: contentInput.value }) });
    if (!response.ok) throw new Error();
    contentInput.value = '';
    editingNoteId = null;
    button.textContent = 'Afegir nota';
    button.title = 'Afegir nota';
    await loadNotes();
    contentInput.focus();
  } catch {
    showStatus(`No s\'ha pogut ${editing ? 'guardar' : 'afegir'} la nota. Comprova la connexió i torna-ho a provar.`);
  } finally { button.disabled = false; }
}

function editNote(note) {
  editingNoteId = note.id;
  contentInput.value = note.content;
  const button = form.querySelector('button');
  button.textContent = 'Guardar nota';
  button.title = 'Guardar nota';
  contentInput.focus();
  contentInput.setSelectionRange(contentInput.value.length, contentInput.value.length);
}

function copyWithFallback(content) {
  const fallback = document.createElement('textarea');
  fallback.value = content;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('copy failed');
}

async function copyNote(content, button) {
  try {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(content); }
      catch { copyWithFallback(content); }
    } else {
      copyWithFallback(content);
    }
    const oldText = button.textContent; button.textContent = 'Copiada'; setTimeout(() => { button.textContent = oldText; }, 1200);
  }
  catch { showStatus('No s\'ha pogut accedir al porta-retalls.'); }
}

function confirmDelete(id, button) {
  if (!activarConfirmacioEliminar) {
    deleteNote(id);
    return;
  }
  if (button.dataset.confirming === 'true') {
    deleteNote(id);
    return;
  }
  button.dataset.confirming = 'true';
  button.textContent = 'Confirma';
  setTimeout(() => {
    if (button.dataset.confirming === 'true') {
      button.dataset.confirming = 'false';
      button.textContent = 'Elimina';
    }
  }, 3000);
}

async function deleteNote(id) {
  try { const response = await fetch(`/api/notes/${id}`, { method: 'DELETE' }); if (!response.ok) throw new Error(); await loadNotes(); }
  catch { showStatus('No s\'ha pogut eliminar la nota. Comprova la connexió i torna-ho a provar.'); }
}

async function deleteOldestNotes() {
  const oldestNotes = [...currentNotes]
    .sort((first, second) => first.created_at - second.created_at || first.id - second.id)
    .slice(0, 10);
  deleteOldestButton.classList.add('is-disabled');
  deleteOldestButton.setAttribute('aria-disabled', 'true');
  try {
    const responses = await Promise.all(oldestNotes.map((note) => fetch(`/api/notes/${note.id}`, { method: 'DELETE' })));
    if (responses.some((response) => !response.ok)) throw new Error();
    await loadNotes();
  } catch {
    deleteOldestButton.classList.remove('is-disabled');
    deleteOldestButton.setAttribute('aria-disabled', 'false');
    deleteOldestButton.dataset.confirming = 'false';
    deleteOldestButton.textContent = 'Elimina les últimes 10 notes';
    showStatus('No s\'han pogut eliminar les notes. Comprova la connexió i torna-ho a provar.');
  }
}

function confirmDeleteOldest(event) {
  event.preventDefault();
  if (deleteOldestButton.getAttribute('aria-disabled') === 'true') return;
  if (!activarConfirmacioEliminar) {
    deleteOldestNotes();
    return;
  }
  if (deleteOldestButton.dataset.confirming === 'true') {
    deleteOldestNotes();
    return;
  }
  deleteOldestButton.dataset.confirming = 'true';
  deleteOldestButton.textContent = 'Confirmar eliminació de les últimes 10 notes';
  setTimeout(() => {
    if (deleteOldestButton.dataset.confirming === 'true') {
      deleteOldestButton.dataset.confirming = 'false';
      deleteOldestButton.textContent = 'Elimina les últimes 10 notes';
    }
  }, 3000);
}

form.addEventListener('submit', submitNote);
deleteOldestButton.addEventListener('click', confirmDeleteOldest);
deleteOldestButton.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') confirmDeleteOldest(event);
});
contentInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
loadNotes();
setInterval(() => document.querySelectorAll('time').forEach((time) => { time.textContent = relativeTime(Math.floor(new Date(time.dateTime).getTime() / 1000)); }), 60000);