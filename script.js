// =========================================
// MEMEBATTLE — script.js
// ELO: Firebase Firestore (shared, live, global)
// Memes: meme-api.com → Reddit → imgflip
// =========================================

import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc,
         onSnapshot, collection,
         query, orderBy, limit }                  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ---- FIREBASE CONFIG ----
const firebaseConfig = {
  apiKey:            "AIzaSyD3FvhhmqEfHUQyEBWLTBHE5cxps-9xsq8",
  authDomain:        "memebattle-4eb0b.firebaseapp.com",
  projectId:         "memebattle-4eb0b",
  storageBucket:     "memebattle-4eb0b.firebasestorage.app",
  messagingSenderId: "118859306572",
  appId:             "1:118859306572:web:95a71d09702c5c934c46e9"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ---- CONFIG ----
const K = 32;

// ---- STATE ----
let memePool   = [];
let currentA   = null;
let currentB   = null;
let isFetching = false;

// ---- FIRESTORE HELPERS ----
// Each meme stored as: memes/{urlHash} = { name, elo, url, votes }
// We use a simple hash of the URL as the document ID

function hashUrl(url) {
  // Simple hash — turns URL into a safe Firestore document ID
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

async function getEloFromDB(meme) {
  try {
    const ref  = doc(db, 'memes', hashUrl(meme.url));
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data().elo;
    // First time seeing this meme — create it
    await setDoc(ref, { url: meme.url, name: meme.name, elo: 1200, votes: 0 });
    return 1200;
  } catch(e) {
    console.warn('Firestore read failed, using 1200:', e);
    return 1200;
  }
}

async function updateEloInDB(winner, loser) {
  const eW = expectedScore(winner.elo, loser.elo);
  const eL = expectedScore(loser.elo,  winner.elo);

  const newWinnerElo = Math.round(winner.elo + K * (1 - eW));
  const newLoserElo  = Math.round(loser.elo  + K * (0 - eL));

  try {
    // Update winner
    await setDoc(doc(db, 'memes', hashUrl(winner.url)), {
      url: winner.url, name: winner.name,
      elo: newWinnerElo,
      votes: (winner.votes || 0) + 1
    });
    // Update loser
    await setDoc(doc(db, 'memes', hashUrl(loser.url)), {
      url: loser.url, name: loser.name,
      elo: newLoserElo,
      votes: (loser.votes || 0) + 1
    });
  } catch(e) {
    console.error('Firestore write failed:', e);
  }

  return { newWinnerElo, newLoserElo };
}

// ---- LIVE LEADERBOARD (updates for ALL users in real time) ----
function startLiveLeaderboard() {
  const q = query(
    collection(db, 'memes'),
    orderBy('elo', 'desc'),
    limit(5)
  );

  // onSnapshot fires every time Firestore data changes
  onSnapshot(q, (snapshot) => {
    const entries = snapshot.docs.map(d => d.data());
    renderLeaderboard(entries);
    updateTicker(entries);
  }, (err) => {
    console.warn('Leaderboard snapshot failed:', err);
  });
}

// ---- ELO MATH ----
function expectedScore(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }

// ---- MEME SOURCES ----
async function fetchFromMemeApi() {
  const subs = ['dankmemes','memes','me_irl','AdviceAnimals','comedyheaven'];
  const sub  = subs[Math.floor(Math.random() * subs.length)];
  const res  = await fetch(`https://meme-api.com/gimme/${sub}/20`);
  if (!res.ok) throw new Error('meme-api failed');
  const data = await res.json();
  return (data.memes || [])
    .filter(m => !m.nsfw && !m.spoiler && m.url && /\.(jpg|jpeg|png|gif|webp)$/i.test(m.url))
    .map(m => ({ url: m.url, name: m.title }));
}

async function fetchFromReddit() {
  const subs = ['memes','dankmemes','me_irl','AdviceAnimals'];
  const sub  = subs[Math.floor(Math.random() * subs.length)];
  const res  = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=50&raw_json=1`);
  if (!res.ok) throw new Error('Reddit failed');
  const data = await res.json();
  return (data?.data?.children || [])
    .map(p => p.data)
    .filter(p =>
      !p.over_18 && !p.spoiler && !p.is_gallery &&
      p.post_hint === 'image' &&
      p.url?.startsWith('https://i.redd.it/') &&
      /\.(jpg|jpeg|png|gif|webp)$/i.test(p.url)
    )
    .map(p => ({ url: p.url, name: p.title }));
}

async function fetchFromImgflip() {
  const res  = await fetch('https://api.imgflip.com/get_memes');
  if (!res.ok) throw new Error('imgflip failed');
  const data = await res.json();
  return (data?.data?.memes || []).map(m => ({ url: m.url, name: m.name }));
}

async function fetchMoreMemes() {
  if (isFetching) return;
  isFetching = true;
  try {
    const fresh = await fetchFromMemeApi();
    if (fresh.length > 0) { memePool.push(...fresh); return; }
    throw new Error('empty');
  } catch(e) { console.warn('meme-api failed, trying Reddit...'); }
  try {
    const fresh = await fetchFromReddit();
    if (fresh.length > 0) { memePool.push(...fresh); return; }
    throw new Error('empty');
  } catch(e) { console.warn('Reddit failed, trying imgflip...'); }
  try {
    const fresh = await fetchFromImgflip();
    memePool.push(...fresh);
  } catch(e) {
    showToast('Could not load memes. Check your internet.');
  } finally {
    isFetching = false;
  }
}

async function getNextMeme() {
  if (memePool.length < 5) await fetchMoreMemes();
  const meme = memePool.shift();
  if (!meme) return null;
  // Fetch its current ELO from Firestore
  meme.elo   = await getEloFromDB(meme);
  meme.votes = 0;
  return meme;
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
  tmp.onerror = () => { console.warn('Image failed:', meme.url); loadNextBattle(); };
  tmp.src = meme.url;
  score.textContent = `ELO: ${meme.elo}`;
}

// ---- VOTE ----
async function vote(side) {
  if (!currentA || !currentB) return;

  const cardA = document.getElementById('cardA');
  const cardB = document.getElementById('cardB');
  cardA.style.pointerEvents = 'none';
  cardB.style.pointerEvents = 'none';

  const winner     = side === 'A' ? currentA : currentB;
  const loser      = side === 'A' ? currentB : currentA;
  const winnerCard = side === 'A' ? cardA    : cardB;
  const loserCard  = side === 'A' ? cardB    : cardA;

  winnerCard.classList.add('winner');
  loserCard.classList.add('loser');

  // Write to Firestore — updates leaderboard for ALL users
  const { newWinnerElo } = await updateEloInDB(winner, loser);

  document.getElementById('scoreA').textContent = `ELO: ${side === 'A' ? newWinnerElo : loser.elo}`;
  document.getElementById('scoreB').textContent = `ELO: ${side === 'B' ? newWinnerElo : loser.elo}`;

  showToast(`${winner.name.slice(0,28)} wins! 🔥 (${newWinnerElo} ELO)`);
  setTimeout(loadNextBattle, 1500);
}

// ---- LEADERBOARD (rendered from Firestore live data) ----
function renderLeaderboard(entries) {
  const container = document.getElementById('leaderboard');

  if (!entries || entries.length === 0) {
    container.innerHTML = '<p class="loading-text">> vote on some memes to build the leaderboard_</p>';
    return;
  }

  const medals = ['🥇','🥈','🥉','4','5'];
  container.innerHTML = entries.map((m, i) => `
    <div class="lb-item">
      <div class="lb-rank">${medals[i] || i+1}</div>
      <img class="lb-thumb" src="${m.url}" alt="${m.name}"
           onerror="this.src='https://placehold.co/54x54/0e0e1a/555577?text=?'"/>
      <div class="lb-info">
        <div class="lb-name">${m.name.slice(0,40)}${m.name.length>40?'…':''}</div>
        <div class="lb-votes">${m.votes || 0} votes</div>
      </div>
      <div class="lb-elo">${m.elo}</div>
    </div>`).join('');
}

// ---- TICKER ----
function updateTicker(entries) {
  if (!entries || entries.length === 0) {
    document.getElementById('ticker').textContent = '>_ MEMEBATTLE — vote to initialize the global rankings_';
    return;
  }
  const text = entries.map((m,i) => `#${i+1} ${m.name.slice(0,22)} (${m.elo})`).join('  ·  ');
  document.getElementById('ticker').textContent = `>_  ${text}  <`;
}

// ---- UPLOAD ----
document.getElementById('fileInput').addEventListener('change', function() {
  const file = this.files[0];
  document.getElementById('fileName').textContent = file ? file.name : 'no file selected_';
  document.getElementById('submitBtn').disabled = !file || file.size > 5*1024*1024;
  if (file && file.size > 5*1024*1024) showToast('File too large! Max 5MB.');
});

async function uploadMeme() {
  const file = document.getElementById('fileInput').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const name = file.name.replace(/\.[^/.]+$/,'');
    const url  = e.target.result;
    // Add to Firestore
    await setDoc(doc(db, 'memes', hashUrl(url)), { url, name, elo: 1200, votes: 0 });
    memePool.unshift({ url, name, elo: 1200, votes: 0 });
    showToast('Your meme entered the arena! 🎉');
    document.getElementById('fileInput').value = '';
    document.getElementById('fileName').textContent = 'no file selected_';
    document.getElementById('submitBtn').disabled = true;
  };
  reader.readAsDataURL(file);
}

// expose to HTML onclick
window.vote       = vote;
window.uploadMeme = uploadMeme;
window.loadNextBattle = loadNextBattle;

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
  startLiveLeaderboard(); // starts listening to Firestore in real time
  await fetchMoreMemes();
  loadNextBattle();
}

init();
