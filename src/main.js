import { Race, DT, MIN_MARBLES, MAX_MARBLES } from './sim/race.js';
import { getCourse } from './sim/track.js';
import { RaceView, marbleCss } from './render/view.js';
import { decodeRace, shareUrl, MAX_NAME_LEN } from './share.js';
import { Music } from './audio/music.js';

const music = new Music();

const $ = (id) => document.getElementById(id);
const isSmall = () => Math.min(window.innerWidth, window.innerHeight) < 600 || window.innerWidth < 640;

const STORAGE_KEY = 'marble-race:setup';
const NAME_POOL = [
  'Bolt', 'Comet', 'Pebble', 'Rocket', 'Blitz', 'Nova', 'Ziggy', 'Marbo', 'Turbo', 'Sparky', 'Glimmer', 'Orbit',
  'Pip', 'Jinx', 'Dash', 'Fizz', 'Blaze', 'Echo', 'Pixel', 'Swirl', 'Nebula', 'Bubbles', 'Rolly', 'Quartz',
  'Saturn', 'Mochi', 'Zoom', 'Opal', 'Twister', 'Biscuit', 'Gizmo', 'Meteor', 'Jelly', 'Vortex', 'Ruby', 'Clank',
];

// --------------------------------------------------------------------------
// app state
const token = new URLSearchParams(location.search).get('race');
const viewer = token !== null; // opened from a share link → replay only

const app = {
  config: null, // {seed, names}
  race: null,
  phase: 'idle', // idle | countdown | racing | done
  speed: 1,
  follow: 0,
  leader: true,
  hintShown: false,
  acc: 0,
  countdown: 0,
  standingsOpen: !isSmall(),
  resultsTimer: 0,
  resultsShown: false,
  lastHud: 0,
  pickCallback: null,
};

let view;
try {
  view = new RaceView($('stage'), $('labels'), getCourse());
} catch (err) {
  console.error(err);
  showError('Your browser could not start WebGL, which this race needs to draw the 3D track.');
}

// --------------------------------------------------------------------------
// helpers
function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function fmtClock(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const dot = (i) => `<span class="dot" style="background:${marbleCss(i)}"></span>`;

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

function showError(msg) {
  $('error-msg').textContent = msg;
  $('error').hidden = false;
  $('setup').hidden = true;
  $('pick').hidden = true;
}

function show(id, on = true) {
  $(id).hidden = !on;
}

function randomSeed() {
  const words = ['red', 'blue', 'fast', 'lucky', 'wild', 'swift', 'shiny', 'tiny', 'giant', 'happy', 'cosmic', 'golden'];
  const nouns = ['marble', 'comet', 'rocket', 'tiger', 'storm', 'pebble', 'river', 'wizard', 'dragon', 'falcon'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return `${pick(words)}-${pick(nouns)}-${Math.floor(Math.random() * 900 + 100)}`;
}

function randomNames(n) {
  const pool = NAME_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Array.from({ length: n }, (_, i) => pool[i % pool.length] + (i >= pool.length ? ' ' + (Math.floor(i / pool.length) + 1) : ''));
}

// --------------------------------------------------------------------------
// race lifecycle
function loadRace(config) {
  app.config = config;
  app.race = new Race(config);
  app.acc = 0;
  app.resultsShown = false;
  app.resultsTimer = 0;
  view.setRace(app.race);
  view.onLabelClick = (i) => followMarble(i);
  view.overview();
  buildStandings();
  show('btn-results', false);
  updateHud(true);
}

function startCountdown() {
  music.unlock(); // always called from a click/tap, so audio is allowed
  music.stop(0.3);
  app.phase = 'countdown';
  app.countdown = 3;
  show('hud', true);
  $('mode-badge').textContent = viewer ? 'REPLAY' : app.replaying ? 'REPLAY' : 'LIVE';
  $('mode-badge').classList.toggle('replay', viewer || !!app.replaying);
  show('countdown', true);
  setCountdownText('3');
}

function setCountdownText(t) {
  const el = $('countdown');
  if (el.textContent === t) return;
  el.textContent = t;
  if (app.phase === 'countdown' || t === 'GO!') music.beep(t === 'GO!');
  el.classList.remove('pop');
  void el.offsetWidth; // restart animation
  el.classList.add('pop');
}

function beginRace() {
  app.phase = 'racing';
  view.rig.setMode('follow');
  music.start();
  if (!app.hintShown) {
    app.hintShown = true;
    setTimeout(() => toast(isSmall() ? 'Swipe to turn the camera · pinch to zoom' : 'Drag to turn the camera · scroll to zoom'), 1200);
  }
  setCountdownText('GO!');
  setTimeout(() => {
    if (app.phase !== 'countdown') show('countdown', false);
  }, 700);
}

function replay() {
  closeResults();
  app.replaying = true;
  loadRace(app.config);
  startCountdown();
}

function newRace() {
  music.stop(0.3);
  closeResults();
  show('hud', false);
  show('countdown', false);
  app.phase = 'idle';
  app.replaying = false;
  setup.seed.value = randomSeed();
  setup.refreshPreview(true);
  show('setup', true);
}

// --------------------------------------------------------------------------
// following
function followMarble(i) {
  if (!app.race) return;
  app.follow = i;
  app.leader = false;
  updateHud(true);
}
function setLeaderMode(on) {
  app.leader = on;
  updateHud(true);
}
function cycleFollow(dir) {
  const order = app.race.standings();
  const at = order.indexOf(app.follow);
  const next = order[(at + dir + order.length) % order.length];
  followMarble(next);
}
function currentLeader() {
  const order = app.race.standings();
  for (const i of order) if (app.race.finishStep[i] < 0) return i;
  return app.follow; // everyone finished: stay put
}

// --------------------------------------------------------------------------
// HUD
let standingRows = [];
function buildStandings() {
  const list = $('standings');
  list.innerHTML = '';
  standingRows = app.race.names.map((name, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="pos"></span>${dot(i)}<span class="nm">${escapeHtml(name)}</span><span class="gap"></span>`;
    li.addEventListener('click', () => {
      followMarble(i);
      if (isSmall()) toggleStandings(false);
    });
    list.appendChild(li);
    return li;
  });
}

function toggleStandings(on = !app.standingsOpen) {
  app.standingsOpen = on;
  $('btn-standings').setAttribute('aria-expanded', String(on));
  $('btn-standings').classList.toggle('on', on);
  updateHud(true);
}

function updateHud(force = false) {
  const race = app.race;
  if (!race) return;
  const now = performance.now();
  const t = race.complete ? race.completeStep * DT : race.time;
  $('clock').textContent = fmtClock(app.phase === 'countdown' ? 0 : t);
  if (!force && now - app.lastHud < 250) return;
  app.lastHud = now;

  const order = race.standings();
  const place = new Map(order.map((i, k) => [i, k + 1]));
  const f = app.follow;
  $('cam-name').innerHTML = `${dot(f)}<span class="txt">${escapeHtml(race.names[f])}</span><span class="place">P${place.get(f)}/${race.n}</span>`;
  $('cam-leader').classList.toggle('on', app.leader);
  $('cam-reset').hidden = !view.rig.adjusted;
  $('btn-speed').textContent = app.speed + '×';

  const list = $('standings');
  list.hidden = !app.standingsOpen;
  if (!app.standingsOpen) return;
  const total = race.course.finishS;
  const start = race.course.S[race.course.spawn.j0];
  order.forEach((i, k) => {
    const li = standingRows[i];
    li.querySelector('.pos').textContent = k + 1;
    const done = race.finishStep[i] >= 0;
    li.classList.toggle('done', done);
    li.classList.toggle('focus', i === f);
    const pct = Math.max(0, Math.min(99, Math.floor(((race.progress[i] - start) / (total - start)) * 100)));
    li.querySelector('.gap').textContent = done ? fmtTime(race.finishStep[i] * DT) : race.complete ? 'DNF' : pct + '%';
    if (list.children[k] !== li) list.insertBefore(li, list.children[k] || null);
  });
}

function showResults() {
  const res = app.race.results();
  const podium = $('podium');
  const medals = ['🥇', '🥈', '🥉'];
  podium.innerHTML = res
    .slice(0, 3)
    .map(
      (r, k) => `<div class="step p${k + 1}"><div class="medal">${medals[k]}</div>
        <div class="nm">${dot(r.index)}<span>${escapeHtml(r.name)}</span></div>
        <div class="tm">${r.dnf ? 'DNF' : fmtTime(r.time)}</div></div>`
    )
    .join('');
  const win = res[0].time;
  $('results-list').innerHTML = res
    .map(
      (r) => `<li><span class="pos">${r.place}.</span>${dot(r.index)}<span class="nm">${escapeHtml(r.name)}</span>
        <span>${r.dnf ? 'DNF' : fmtTime(r.time)}</span><span class="gap">${r.place === 1 || r.dnf ? '' : '+' + (r.time - win).toFixed(2)}</span></li>`
    )
    .join('');
  $('res-replay').textContent = viewer ? 'Watch again' : 'Watch replay';
  show('res-new', !viewer);
  show('results', true);
  show('btn-results', true);
  music.stop(0.3);
  scheduleRedirect();
  app.resultsShown = true;
}

// end of race: go to the video 6 s after the results appear, unless the user
// picks another action (replay / new race / back to track) first
const END_URL = 'https://www.youtube.com/watch?v=flXwv-FxFbs';
const REDIRECT_DELAY = 6000;
let redirectTimer = 0;
function scheduleRedirect() {
  clearTimeout(redirectTimer);
  redirectTimer = setTimeout(() => location.assign(END_URL), REDIRECT_DELAY);
}
function closeResults() {
  clearTimeout(redirectTimer);
  show('results', false);
}

// --------------------------------------------------------------------------
// share
function openShare() {
  const url = shareUrl(app.config);
  $('share-url').value = url;
  show('share-native', typeof navigator.share === 'function');
  show('share', true);
}
async function copyShare() {
  const input = $('share-url');
  try {
    await navigator.clipboard.writeText(input.value);
    toast('Link copied');
  } catch {
    input.focus();
    input.select();
    try {
      document.execCommand('copy');
      toast('Link copied');
    } catch {
      toast('Select the link and copy it');
    }
  }
}

// --------------------------------------------------------------------------
// camera picker (viewer start + tapping the followed name)
function openPicker(onPick, title) {
  const list = $('pick-list');
  list.innerHTML = '';
  const add = (html, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (cls || '');
    b.innerHTML = html;
    b.addEventListener('click', () => {
      show('pick', false);
      fn();
    });
    list.appendChild(b);
  };
  add('🏆 <span>Follow the race leader</span>', 'leader', () => onPick(-1));
  app.race.names.forEach((name, i) => add(`${dot(i)}<span>${escapeHtml(name)}</span>`, '', () => onPick(i)));
  document.querySelector('#pick h2').textContent = title;
  show('pick', true);
}
const applyPick = (i) => (i < 0 ? setLeaderMode(true) : followMarble(i));

// --------------------------------------------------------------------------
// setup form (race creator)
const setup = {
  seed: $('seed'),
  count: $('count'),
  names: [],
  previewTimer: 0,

  init() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {}
    const names = Array.isArray(saved?.names) && saved.names.length >= MIN_MARBLES ? saved.names.slice(0, MAX_MARBLES) : randomNames(8);
    this.names = names.map((n) => String(n).slice(0, MAX_NAME_LEN));
    this.seed.value = randomSeed();
    this.count.min = MIN_MARBLES;
    this.count.max = MAX_MARBLES;
    this.count.value = this.names.length;
    this.renderNames();

    $('seed-random').addEventListener('click', () => {
      this.seed.value = randomSeed();
      this.refreshPreview();
    });
    this.seed.addEventListener('input', () => this.refreshPreview());
    $('count-dec').addEventListener('click', () => this.setCount(this.names.length - 1));
    $('count-inc').addEventListener('click', () => this.setCount(this.names.length + 1));
    this.count.addEventListener('change', () => this.setCount(parseInt(this.count.value, 10) || MIN_MARBLES));
    $('names-random').addEventListener('click', () => {
      this.names = randomNames(this.names.length);
      this.renderNames();
      this.refreshPreview(true);
    });
    $('start').addEventListener('click', () => this.start());
  },

  setCount(n) {
    n = Math.max(MIN_MARBLES, Math.min(MAX_MARBLES, n));
    const extra = randomNames(MAX_MARBLES).filter((x) => !this.names.includes(x));
    while (this.names.length < n) this.names.push(extra.shift() || 'Marble ' + (this.names.length + 1));
    this.names.length = n;
    this.count.value = n;
    this.renderNames();
    this.refreshPreview(true);
  },

  renderNames() {
    const box = $('names');
    box.innerHTML = '';
    this.names.forEach((name, i) => {
      const label = document.createElement('label');
      label.innerHTML = dot(i);
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = MAX_NAME_LEN;
      input.value = name;
      input.placeholder = 'Marble ' + (i + 1);
      input.setAttribute('aria-label', 'Name of marble ' + (i + 1));
      input.addEventListener('input', () => {
        this.names[i] = input.value;
        const lbl = view?.labels[i];
        if (lbl) lbl.lastChild.textContent = this.cleanName(i);
      });
      label.appendChild(input);
      box.appendChild(label);
    });
  },

  cleanName(i) {
    return (this.names[i] || '').trim().slice(0, MAX_NAME_LEN) || 'Marble ' + (i + 1);
  },

  config() {
    return {
      seed: this.seed.value.trim() || 'marbles',
      names: this.names.map((_, i) => this.cleanName(i)),
    };
  },

  refreshPreview(now = false) {
    clearTimeout(this.previewTimer);
    const go = () => {
      if (app.phase !== 'idle') return;
      loadRace(this.config());
    };
    if (now) go();
    else this.previewTimer = setTimeout(go, 200);
  },

  start() {
    const config = this.config();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ names: config.names }));
    } catch {}
    show('setup', false);
    app.replaying = false;
    app.follow = 0;
    app.leader = true;
    loadRace(config);
    startCountdown();
  },
};

// --------------------------------------------------------------------------
// wiring
function wire() {
  $('btn-speed').addEventListener('click', () => {
    app.speed = app.speed === 1 ? 2 : app.speed === 2 ? 4 : 1;
    updateHud(true);
  });
  $('btn-share').addEventListener('click', openShare);
  const syncMute = (muted) => {
    const b = $('btn-mute');
    b.textContent = muted ? '🔇' : '🔊';
    b.title = (muted ? 'Unmute' : 'Mute') + ' music (M)';
    b.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
    b.setAttribute('aria-pressed', String(muted));
    b.classList.toggle('muted', muted);
  };
  music.onChange = syncMute;
  syncMute(music.muted);
  $('btn-mute').addEventListener('click', () => {
    music.unlock();
    music.toggleMute();
  });
  $('btn-standings').addEventListener('click', () => toggleStandings());
  $('btn-results').addEventListener('click', showResults);
  $('cam-prev').addEventListener('click', () => cycleFollow(-1));
  $('cam-next').addEventListener('click', () => cycleFollow(1));
  $('cam-leader').addEventListener('click', () => setLeaderMode(!app.leader));
  $('cam-name').addEventListener('click', () => openPicker(applyPick, 'Follow which marble?'));
  $('cam-reset').addEventListener('click', () => view.rig.resetView());
  view.rig.onUserChange = () => {
    const hide = !view.rig.adjusted;
    if ($('cam-reset').hidden !== hide) $('cam-reset').hidden = hide;
  };
  $('res-replay').addEventListener('click', replay);
  $('res-share').addEventListener('click', openShare);
  $('res-new').addEventListener('click', newRace);
  $('res-close').addEventListener('click', closeResults);
  $('share-copy').addEventListener('click', copyShare);
  $('share-url').addEventListener('focus', (e) => e.target.select());
  $('share-close').addEventListener('click', () => show('share', false));
  $('share-native').addEventListener('click', () => {
    navigator.share({ title: 'Marble Race', text: 'Watch my marble race!', url: $('share-url').value }).catch(() => {});
  });
  for (const id of ['share', 'pick', 'results']) {
    $(id).addEventListener('click', (e) => {
      // click on the dimmed backdrop closes (except the viewer's first pick)
      if (e.target.id !== id || (id === 'pick' && app.phase === 'idle')) return;
      if (id === 'results') closeResults();
      else show(id, false);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || !app.race || app.phase === 'idle') return;
    if (e.key === 'ArrowRight') cycleFollow(1);
    else if (e.key === 'ArrowLeft') cycleFollow(-1);
    else if (e.key === 'l' || e.key === 'L') setLeaderMode(!app.leader);
    else if (e.key === 'r' || e.key === 'R') view.rig.resetView();
    else if (e.key === 'm' || e.key === 'M') music.toggleMute();
    else if (e.key === 'Escape') {
      show('share', false);
      closeResults();
    }
  });
}

// --------------------------------------------------------------------------
// main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const race = app.race;
  if (race && view) {
    if (app.phase === 'countdown') {
      app.countdown -= dt;
      if (app.countdown <= 0) beginRace();
      else setCountdownText(String(Math.ceil(app.countdown)));
    }
    if (app.phase === 'racing' || app.phase === 'done') {
      app.acc += dt * app.speed;
      const maxSteps = Math.ceil((0.1 * app.speed) / DT);
      let steps = 0;
      while (app.acc >= DT && steps < maxSteps) {
        race.step();
        app.acc -= DT;
        steps++;
      }
      if (steps >= maxSteps) app.acc = 0; // device can't keep up: slow down rather than spiral
      if (app.phase === 'racing' && race.complete) {
        app.phase = 'done';
        music.stop(2);
        app.resultsTimer = 2.5;
      }
      if (app.phase === 'done' && !app.resultsShown) {
        app.resultsTimer -= dt;
        if (app.resultsTimer <= 0) showResults();
      }
    }
    if (app.leader && app.phase !== 'idle') {
      const l = currentLeader();
      if (l !== app.follow) {
        app.follow = l;
        updateHud(true);
      }
    }
    view.focus = app.follow;
    view.render(app.phase === 'racing' || app.phase === 'done' ? app.acc / DT : 1, dt);
    if (app.phase !== 'idle') updateHud();
  }
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------------------
// boot
if (view) {
  wire();
  if (viewer) {
    document.title = 'Marble Race — replay';
    $('btn-share').hidden = false;
    let config;
    try {
      config = decodeRace(token);
    } catch (err) {
      showError(err.message);
    }
    if (config) {
      loadRace(config);
      app.phase = 'idle';
      openPicker((i) => {
        applyPick(i);
        startCountdown();
      }, 'Who are you cheering for?');
    }
  } else {
    setup.init();
    setup.refreshPreview(true);
    show('setup', true);
  }
  requestAnimationFrame(frame);
}
