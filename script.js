// =========================================
// MEMEBATTLE — script.js
// Source 1: meme-api.com (clean curated memes)
// Source 2: Reddit strict (i.redd.it only, no galleries)
// Source 3: imgflip (classic meme templates)
// ELO: localStorage
// =========================================

const K = 32;
const MEME_API_URL = 'https://meme-api.com/gimme/dankmemes/20';

let memePool   = [];
let eloStore   = {};
let currentA   = null;
let currentB   = null;
let isFetching = false;

// ---- LOCALSTORAGE ----
function loadEloStore() {
  try {
    const s = localStorage.getItem('memebattle_elo');
    if (s) eloStore = JSON.parse(s);
  } catch(e) { eloStore = {}; }
}

function saveEloStore() {
  try { localStorage.setItem('memebattle_elo', JSON.stringify(eloStore)); }
  catch(e) {}
}

function getElo(meme) {
  if (!eloStore[meme.url]) eloStore[meme.url] = { name: meme.name, elo: 1200 };
  return eloStore[meme.url].elo;
}

function setElo(meme, val) {
  if (!eloStore[meme.url]) eloStore[meme.url] = { name: meme.name, elo: val };
  else eloStore[meme.url].elo = val;
}

// ---- SOURCE 1: meme-api.com (best quality) ----
async function fetchFromMemeApi() {
  // Rotate between funny subreddits for variety
  const subs = ['dankmemes', 'memes', 'me_irl', 'AdviceAnimals', 'comedyheaven'];
  const sub  = subs[Math.floor(Math.random() * subs.length)];
  const res  = await fetch(`https://meme-api.com/gimme/${sub}/20`);
  if (!res.ok) throw new Error(`meme-api error ${res.status}`);
  const data = await res.json();

  return (data.memes || [])
    .filter(m =>
      !m.nsfw &&
      !m.spoiler &&
      m.url &&
      /\.(jpg|jpeg|png|gif|webp)$/i.test(m.url)
    )
    .map(m => ({ url: m.url, name: m.title }));
}

// ---- SOURCE 2: Reddit direct (strict — only i.redd.it images) ----
async function fetchFromReddit() {
  const subs = ['memes', 'dankmemes', 'me_irl', 'AdviceAnimals'];
  const sub  = subs[Math.floor(Math.random() * subs.length)];
  const res  = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=50&raw_json=1`);
  if (!res.ok) throw new Error('Reddit error');
  const data = await res.json();

  return (data?.data?.children || [])
    .map(p => p.data)
    .filter(p =>
      !p.over_18 &&
      !p.spoiler &&
      !p.is_gallery &&              // exclude multi-image albums
      p.post_hint === 'image' &&    // must be a direct image post
      p.url &&
      p.url.startsWith('https://i.redd.it/') && // only Reddit-hosted images
      /\.(jpg|jpeg|png|gif|webp)$/i.test(p.url)
    )
    .map(p => ({ url: p.url, name: p.title }));
}

// ---- SOURCE 3: imgflip (fallback classics) ----
async function fetchFromImgflip() {
  const res  = await fetch('https://api.imgflip.com/get_memes');
  if (!res.ok) throw new Error('imgflip error');
  const data = await res.json();
  return (data?.data?.memes || []).map(m => ({ url: m.url, name: m.name }));
}

// ---- MAIN FETCH: try sources in order ----
async function fetchMoreMemes() {
  if (isFetching) return;
  isFetching = true;

  try {
    // Try meme-api first (best quality)
    const fresh = await fetchFromMemeApi();
    if (fresh.length > 0) {
      memePool.push(...fresh);
      isFetching = false;
      return;
    }
    throw new Error('meme-api returned empty');
  } catch(e) {
    console.warn('meme-api failed, trying Reddit...', e.message);
  }

  try {
    // Try Reddit strict
    const fresh = await fetchFromReddit();
    if (fresh.length > 0) {
      memePool.push(...fresh);
      isFetching = false;
      return;
    }
    throw new Error('Reddit returned empty');
  } catch(e) {
    console.warn('Reddit failed, trying imgflip...', e.message);
  }

  try {
    // Last resort: imgflip
    const fresh = await fetchFromImgflip();
    memePool.push(...fresh);
  } catch(e) {
    console.error('All sources failed:', e.message);
    showToast('Could not load memes. Check your internet.');
  } finally {
    isFetching = false;
  }
}

async function getNextMeme() {
  if (memePool.length < 5) await fetchMoreMemes();
  return memePool.shift() || null;
}

// ---- LOAD BATTLE ----
async function loadNextBattle() {
  setCardLoading('A');
  setCardLoading('B');

  const [memeA, memeB] = await Promise.all([getNextMeme(), getNextMeme()]);

  if (!memeA || !memeB) {
    showToast('Still loading memes...');
    setTimeout(loadNextBattle, 2500);
    return;
  }

  currentA = memeA;
  currentB = memeB;

  ['cardA','cardB'].forEach(id => {
    const c = document.getElementById(id);
    c.classList.remove('winner','loser');
    c.style.pointerEvents = 'auto';
  });

  setMemeCard('A', currentA);
  setMemeCard('B', currentB);

  if (memePool.length < 8) fetchMoreMemes();
}

function setCardLoading(side) {
  document.getElementById(`img${side}`).style.opacity = '0';
  document.getElementById(`score${side}`).textContent = 'Loading...';
}

function setMemeCard(side, meme) {
  const img   = document.getElementById(`img${side}`);
  const score = document.getElementById(`score${side}`);
  img.style.opacity = '0';

  const tmp = new Image();
  tmp.onload = () => {
    img.src = meme.url;
    img.style.transition = 'opacity 0.3s ease';
    img.style.opacity = '1';
  };
  tmp.onerror = () => {
    console.warn('Image load failed, skipping:', meme.url);
    loadNextBattle();
  };
  tmp.src = meme.url;
  score.textContent = `ELO: ${getElo(meme)}`;
}

// ---- ELO ----
function expectedScore(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }

function updateElo(winner, loser) {
  const nW = Math.round(getElo(winner) + K * (1 - expectedScore(getElo(winner), getElo(loser))));
  const nL = Math.round(getElo(loser)  + K * (0 - expectedScore(getElo(loser),  getElo(winner))));
  setElo(winner, nW);
  setElo(loser,  nL);
  saveEloStore();
  return nW;
}

// ---- VOTE ----
function vote(side) {
  if (!currentA || !currentB) return;

  const cardA = document.getElementById('cardA');
  const cardB = document.getElementById('cardB');
  cardA.style.pointerEvents = 'none';
  cardB.style.pointerEvents = 'none';

  const winner     = side === 'A' ? currentA : currentB;
  const loser      = side === 'A' ? currentB : currentA;
  const winnerCard = side === 'A' ? cardA    : cardB;
  const loserCard  = side === 'A' ? cardB    : cardA;

  const newElo = updateElo(winner, loser);
  winnerCard.classList.add('winner');
  loserCard.classList.add('loser');

  document.getElementById('scoreA').textContent = `ELO: ${getElo(currentA)}`;
  document.getElementById('scoreB').textContent = `ELO: ${getElo(currentB)}`;

  renderLeaderboard();
  updateTicker();
  showToast(`${winner.name.slice(0,28)} wins! 🔥 (${newElo} ELO)`);
  setTimeout(loadNextBattle, 1500);
}

// ---- LEADERBOARD ----
function renderLeaderboard() {
  const container = document.getElementById('leaderboard');
  const entries = Object.entries(eloStore)
    .map(([url, d]) => ({ url, ...d }))
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 5);

  if (!entries.length) {
    container.innerHTML = '<p class="loading-text">Vote on some memes to build the leaderboard!</p>';
    return;
  }

  const medals = ['🥇','🥈','🥉','4','5'];
  container.innerHTML = entries.map((m, i) => `
    <div class="lb-item">
      <div class="lb-rank">${medals[i]}</div>
      <img class="lb-thumb" src="${m.url}" alt="${m.name}"
           onerror="this.src='https://placehold.co/54x54/1a1a1a/666?text=?'"/>
      <div class="lb-info">
        <div class="lb-name">${m.name.slice(0,40)}${m.name.length>40?'…':''}</div>
      </div>
      <div class="lb-elo">${m.elo}</div>
    </div>`).join('');
}

// ---- TICKER ----
function updateTicker() {
  const entries = Object.entries(eloStore)
    .map(([url, d]) => ({ url, ...d }))
    .sort((a,b) => b.elo - a.elo)
    .slice(0,8);

  document.getElementById('ticker').textContent = entries.length
    ? `⚔️  ${entries.map((m,i)=>`#${i+1} ${m.name.slice(0,22)} (${m.elo})`).join('  ·  ')}  ⚔️`
    : '⚔️ MEMEBATTLE — Vote to build the rankings!';
}

// ---- UPLOAD ----
document.getElementById('fileInput').addEventListener('change', function() {
  const file = this.files[0];
  document.getElementById('fileName').textContent = file ? file.name : 'No file chosen';
  document.getElementById('submitBtn').disabled = !file || file.size > 5*1024*1024;
  if (file && file.size > 5*1024*1024) showToast('File too large! Max 5MB.');
});

function uploadMeme() {
  const file = document.getElementById('fileInput').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const name = file.name.replace(/\.[^/.]+$/,'');
    const url  = e.target.result;
    eloStore[url] = { name, elo: 1200 };
    saveEloStore();
    memePool.unshift({ url, name });
    renderLeaderboard(); updateTicker();
    showToast('Your meme entered the arena! 🎉');
    document.getElementById('fileInput').value = '';
    document.getElementById('fileName').textContent = 'No file chosen';
    document.getElementById('submitBtn').disabled = true;
  };
  reader.readAsDataURL(file);
}

// ---- TOAST ----
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---- INIT ----
async function init() {
  loadEloStore();
  renderLeaderboard();
  updateTicker();
  await fetchMoreMemes();
  loadNextBattle();
}

init();
