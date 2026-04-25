const API = 'https://www.speedrun.com/api/v1';

let selectedGame = null;
let splits = [];
let currentSplit = 0;
let startTime = null;
let timerInterval = null;
let running = false;
let splitTimes = [];
let pb = null;

// ── API ──────────────────────────────────────────────────────────────────────

async function searchGame() {
  const query = document.getElementById('game-input').value.trim();
  if (!query) return;

  const resultsEl = document.getElementById('game-results');
  resultsEl.innerHTML = '<div id="loading">Buscando...</div>';

  try {
    const res = await fetch(`${API}/games?name=${encodeURIComponent(query)}&max=10&embed=assets`);
    const { data } = await res.json();

    resultsEl.innerHTML = '';
    if (!data.length) { resultsEl.innerHTML = '<div id="loading">Nenhum jogo encontrado.</div>'; return; }

    data.forEach(game => {
      const div = document.createElement('div');
      div.className = 'game-option';
      const icon = game.assets?.['cover-tiny']?.uri || '';
      div.innerHTML = `${icon ? `<img src="${icon}" alt="">` : ''}<span>${game.names.international}</span>`;
      div.onclick = () => selectGame(game);
      resultsEl.appendChild(div);
    });
  } catch {
    resultsEl.innerHTML = '<div id="loading">Erro ao buscar. Tente novamente.</div>';
  }
}

async function selectGame(game) {
  selectedGame = game;
  document.getElementById('game-results').innerHTML = '';
  document.getElementById('game-input').value = game.names.international;

  const catSelect = document.getElementById('category-select');
  catSelect.innerHTML = '<option>Carregando categorias...</option>';
  document.getElementById('category-section').classList.remove('hidden');
  document.getElementById('timer-section').classList.add('hidden');

  try {
    const res = await fetch(`${API}/games/${game.id}/categories`);
    const { data } = await res.json();

    catSelect.innerHTML = '';
    data.filter(c => c.type === 'per-game').forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      catSelect.appendChild(opt);
    });

    await loadSplits();
  } catch {
    catSelect.innerHTML = '<option>Erro ao carregar categorias</option>';
  }
}

async function loadSplits() {
  if (!selectedGame) return;
  const catId = document.getElementById('category-select').value;

  resetTimer();
  splits = [];
  splitTimes = [];
  pb = null;

  try {
    // Busca níveis (fases) do jogo
    const levelsRes = await fetch(`${API}/games/${selectedGame.id}/levels`);
    const { data: levels } = await levelsRes.json();

    if (levels.length > 0) {
      splits = levels.map(l => ({ id: l.id, name: l.name }));
    } else {
      // Sem níveis: usa segmentos genéricos baseados no WR da categoria
      splits = await getSegmentsFromWR(catId);
    }

    // Tenta carregar PB do WR como referência
    pb = await fetchWR(catId);

    renderSplits();
    document.getElementById('timer-section').classList.remove('hidden');
  } catch {
    splits = [{ name: 'Início' }, { name: 'Fim' }];
    renderSplits();
    document.getElementById('timer-section').classList.remove('hidden');
  }
}

async function getSegmentsFromWR(catId) {
  // Tenta pegar runs com splits da categoria para montar segmentos
  try {
    const res = await fetch(`${API}/runs?category=${catId}&orderby=times_asc&direction=asc&max=1&embed=players`);
    const { data } = await res.json();
    if (data.length && data[0].splits?.uri) {
      const splitsRes = await fetch(data[0].splits.uri);
      const splitsData = await splitsRes.json();
      if (splitsData.splits) return splitsData.splits.map(s => ({ name: s.name }));
    }
  } catch {}
  return [{ name: 'Início' }, { name: 'Meio' }, { name: 'Fim' }];
}

async function fetchWR(catId) {
  try {
    const res = await fetch(`${API}/leaderboards/${selectedGame.id}/category/${catId}?top=1`);
    const { data } = await res.json();
    const run = data?.runs?.[0]?.run;
    return run ? run.times.primary_t : null;
  } catch { return null; }
}

// ── TIMER ────────────────────────────────────────────────────────────────────

function startTimer() {
  if (running) return;
  running = true;
  startTime = performance.now() - (splitTimes.reduce((a, b) => a + b, 0) * 1000 || 0);
  timerInterval = setInterval(updateDisplay, 30);
  document.getElementById('btn-start').disabled = true;
  document.getElementById('btn-split').disabled = false;
  highlightSplit(currentSplit);
}

function updateDisplay() {
  const elapsed = (performance.now() - startTime) / 1000;
  document.getElementById('timer-display').textContent = formatTime(elapsed);
}

function doSplit() {
  if (!running || currentSplit >= splits.length) return;

  const elapsed = (performance.now() - startTime) / 1000;
  const segTime = currentSplit === 0 ? elapsed : elapsed - splitTimes.slice(0, currentSplit).reduce((a, b) => a + b, 0);
  splitTimes[currentSplit] = segTime;

  const pbSeg = pb ? pb / splits.length : null;
  const delta = pbSeg ? segTime - pbSeg : null;

  updateSplitRow(currentSplit, elapsed, delta);
  currentSplit++;

  if (currentSplit >= splits.length) {
    stopTimer();
    savePB(elapsed);
  } else {
    highlightSplit(currentSplit);
  }
}

function stopTimer() {
  clearInterval(timerInterval);
  running = false;
  document.getElementById('btn-split').disabled = true;
}

function resetTimer() {
  stopTimer();
  currentSplit = 0;
  splitTimes = [];
  startTime = null;
  document.getElementById('timer-display').textContent = '0:00.000';
  document.getElementById('btn-start').disabled = false;
  renderSplits();
}

function savePB(time) {
  if (!pb || time < pb) {
    pb = time;
    document.getElementById('pb-display').textContent = formatTime(pb);
  }
}

// ── RENDER ───────────────────────────────────────────────────────────────────

function renderSplits() {
  const tbody = document.getElementById('splits-body');
  tbody.innerHTML = '';
  splits.forEach((split, i) => {
    const tr = document.createElement('tr');
    tr.id = `split-row-${i}`;
    tr.innerHTML = `<td>${i + 1}</td><td>${split.name}</td><td class="split-time">--</td><td class="split-delta">--</td>`;
    tbody.appendChild(tr);
  });

  if (pb) document.getElementById('pb-display').textContent = formatTime(pb);
}

function highlightSplit(index) {
  document.querySelectorAll('#splits-body tr').forEach(r => r.classList.remove('active-split'));
  const row = document.getElementById(`split-row-${index}`);
  if (row) {
    row.classList.add('active-split');
    row.scrollIntoView({ block: 'nearest' });
  }
}

function updateSplitRow(index, elapsed, delta) {
  const row = document.getElementById(`split-row-${index}`);
  if (!row) return;
  row.classList.remove('active-split');
  row.classList.add('done-split');
  row.querySelector('.split-time').textContent = formatTime(elapsed);

  const deltaCell = row.querySelector('.split-delta');
  if (delta !== null) {
    const sign = delta < 0 ? '-' : '+';
    deltaCell.textContent = `${sign}${formatTime(Math.abs(delta))}`;
    deltaCell.className = `split-delta ${delta < 0 ? 'delta-neg' : 'delta-pos'}`;
  }
}

// ── UTILS ────────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Enter para buscar
document.getElementById('game-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchGame();
});

// Espaço = split / start
document.addEventListener('keydown', e => {
  if (e.target === document.getElementById('game-input')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!running) startTimer();
    else doSplit();
  }
  if (e.code === 'KeyR') resetTimer();
});
