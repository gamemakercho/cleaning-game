import { CONFIG, MAP_CONFIG } from './config.js';
import { Game, frameAt, transform, clamp } from './engine.js';
import { SPRITE_DATA } from './sprite-data.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d', { alpha: false });
const layer = $('modal-layer'), modal = $('modal'), specialButton = $('special');
const images = {}; let game, loaded = false, lastTime = null, shownPhase = '', hudTime = 0;
const sheets = { walk: SPRITE_DATA['librarian-walk'], run: SPRITE_DATA['librarian-run'], actions: SPRITE_DATA['librarian-actions'], cat: SPRITE_DATA['cat-cleaning-actions'], effects: SPRITE_DATA['paint-cleaning-effects'] };
const debug = CONFIG.debug || new URLSearchParams(location.search).has('debug');
let debugLabel;
if (debug) { debugLabel = document.createElement('div'); debugLabel.className = 'debug-label'; document.querySelector('.interface').append(debugLabel); }

function validateSheet(sheet) {
  if (!sheet?.frames || !sheet?.animations || !sheet.image) throw new Error('애니메이션 데이터가 올바르지 않습니다.');
  for (const [id, f] of Object.entries(sheet.frames)) {
    const [x, y, w, h] = f.rect;
    if (![x, y, w, h, ...f.anchor_in_rect, f.duration_ms].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > sheet.size[0] || y + h > sheet.size[1]) throw new Error(`프레임 ${id}의 영역을 확인해 주세요.`);
  }
  for (const a of Object.values(sheet.animations)) if (!a.frames.length || a.frames.some(id => !sheet.frames[id])) throw new Error('누락된 애니메이션 프레임이 있습니다.');
  if (sheet === sheets.cat && Object.values(sheet.frames).some(f => !f.mop_center_in_rect?.every(Number.isFinite))) throw new Error('걸레판 좌표가 없습니다.');
}
async function preload() {
  loaded = false; modal.innerHTML = '<p class="modal-kicker">작은 도서관에 오신 걸 환영해요</p><h2 id="modal-title">청소 도구 준비 중…</h2><p id="loading-progress">0 / 6</p>';
  try {
    Object.values(sheets).forEach(validateSheet); let count = 0;
    const files = ['library-background', ...Object.keys(SPRITE_DATA)];
    await Promise.all(files.map(name => new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => {
        const size = name === 'library-background' ? [MAP_CONFIG.background.width, MAP_CONFIG.background.height] : SPRITE_DATA[name].size;
        if (img.naturalWidth !== size[0] || img.naturalHeight !== size[1]) { reject(new Error(`${name}.png의 크기가 다릅니다.`)); return; }
        images[name] = img; count++; const progress = $('loading-progress'); if (progress) progress.textContent = `${count} / ${files.length}`; resolve();
      };
      img.onerror = () => reject(new Error(`${name}.png를 불러오지 못했어요.`)); img.src = new URL(`./assets/${name}.png`, import.meta.url).href;
    })));
    game = new Game(sheets, { onComplete: result => { document.dispatchEvent(new CustomEvent('gamecomplete', { detail: result })); if (typeof window.onGameComplete === 'function') { try { window.onGameComplete(result); } catch (error) { console.error('onGameComplete callback:', error); } } } });
    loaded = true; shownPhase = ''; updateInterface();
    // Read-only diagnostics are useful to hosts and browser QA; mutation is confined to ?debug.
    window.cleaningGame = { snapshot: () => game.snapshot(), config: CONFIG, map: MAP_CONFIG };
    if (debug) window.cleaningGame.debug = { game, sheets, step: seconds => game.advance(seconds) };
  } catch (error) {
    modal.innerHTML = '<p class="modal-kicker">도구를 다시 준비할게요</p><h2 id="modal-title">불러오기 실패</h2><p id="error-message"></p><button class="primary" id="retry-load">다시 불러오기</button>';
    $('error-message').textContent = `${error.message} assets 폴더를 함께 올렸는지 확인해 주세요.`; $('retry-load').onclick = preload;
  }
}
function portrait(sheetName, animation, classes = '') {
  const sheet = SPRITE_DATA[sheetName], f = frameAt(sheet, animation, 0), [x, y, w, h] = f.rect;
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(images[sheetName], x, y, w, h, 0, 0, w, h);
  return `<img class="${classes}" src="${c.toDataURL()}" alt="${sheetName.startsWith('cat') ? '걸레를 든 작은 고양이' : '말썽꾸러기 사서'}">`;
}
function startGame() { game.start(); shownPhase = ''; lastTime = null; updateInterface(); }
function updateInterface() {
  if (!game) return;
  const phase = game.phase;
  $('time').innerHTML = `${Math.ceil(Math.max(0, CONFIG.game_duration_s - game.elapsed))}<span>초</span>`;
  $('cleaned').textContent = game.cleaned; $('ratio').textContent = game.generated ? `${(game.cleaned / game.generated * 100).toFixed(1)}%` : '—';
  document.querySelector('.hud').classList.toggle('urgent', phase === 'playing' && game.finalNotified);
  $('charge-value').textContent = `${game.charge} / ${CONFIG.special_charge_max}`;
  $('charge-fill').style.width = `${game.charge / CONFIG.special_charge_max * 100}%`; $('charge-meter').setAttribute('aria-valuenow', game.charge);
  const ready = phase === 'playing' && game.charge >= CONFIG.special_charge_max && game.specialRemaining <= 0;
  specialButton.disabled = !ready; specialButton.classList.toggle('ready', ready);
  specialButton.querySelector('small').textContent = game.specialRemaining > 0 ? `${game.specialRemaining.toFixed(1)}초 · 청소 중!` : ready ? '지금 눌러 주세요!' : '게이지를 채워 주세요';
  $('charge-hint').textContent = game.specialRemaining > 0 ? '와다다 중에도 드래그할 수 있어요' : ready ? '준비 완료! 넓게 한 번에 쓱쓱' : '자국 10개를 닦으면 준비 완료!';
  $('pause').disabled = !['playing', 'countdown'].includes(phase);
  $('notice').textContent = game.notice; $('notice').classList.toggle('visible', phase === 'playing' && game.noticeRemaining > 0);
  $('countdown').hidden = phase !== 'countdown'; $('countdown').textContent = Math.ceil(game.countdown);
  if (debugLabel) debugLabel.textContent = `${game.cat.animation} · NPC ${game.npc.state}\n생성 ${game.generated} = 청소 ${game.cleaned} + 잔여 ${game.remaining}\n${game.elapsed.toFixed(2)}s · mop ${game.cat.frame.id}`;
  if (shownPhase === phase) return; shownPhase = phase;
  layer.hidden = !['start', 'paused', 'result'].includes(phase);
  if (phase === 'start') {
    modal.innerHTML = `<p class="modal-kicker">영혼이 바뀐 두 친구의 청소 대작전</p><h2 id="modal-title">우당탕!<br><em>물감 청소</em></h2><div class="hero-art">${portrait('librarian-walk', 'walk_down')}<span>↔</span>${portrait('cat-cleaning-actions', 'ordinary_push', 'cat-portrait')}</div><p>말썽꾸러기 사서가 물감을 묻히고 다녀요!<br>화면을 누르고 드래그해서 걸레를 밀어 주세요.<br>게이지가 차면 ‘와다다 청소!’로 넓게 닦아요!</p><button id="start" class="primary">청소 시작하기 <span>→</span></button><p class="tip">45초 안에 70% 이상 닦으면 클리어!<br>손을 떼면 고양이가 멈춰요.</p>`;
    $('start').onclick = startGame;
  } else if (phase === 'paused') {
    modal.innerHTML = `<p class="modal-kicker">고양이도 잠깐 숨을 고르는 중</p><h2 id="modal-title">잠시 쉬어요</h2><div class="hero-art">${portrait('cat-cleaning-actions', 'idle_sigh', 'cat-portrait')}</div><p>돌아오셨군요!<br>준비되면 이어서 청소해요.</p><button class="primary" id="resume">계속하기</button><button class="secondary" id="restart">처음부터 다시</button>`;
    $('resume').onclick = () => { game.resume(); lastTime = null; updateInterface(); }; $('restart').onclick = startGame;
  } else if (phase === 'result') {
    const r = game.result, noPaint = !r.generated;
    const reaction = noPaint ? '자국이 생기지 않았어요. 다시 도전해 주세요.' : r.grade === 'A' ? '반짝반짝! 사서 고양이가 뿌듯해해요.' : r.grade === 'B' ? '휴, 다행이다냥! 깔끔한 자료실 완성.' : '조금만 더! 다음엔 와다다로 한 번에 쓱쓱.';
    modal.innerHTML = `<p class="modal-kicker">${r.cleared ? '청소 대작전 성공!' : '오늘의 청소 기록'}</p><h2 id="modal-title">${r.cleared ? '깨끗해졌다냥!' : noPaint ? '다시 준비해요' : '수고했다냥!'}</h2><div class="grade-badge ${r.grade.toLowerCase()}">${noPaint ? '—' : r.grade}</div><div class="result-grid"><div><span>닦은 자국</span><b>${r.cleaned}</b></div><div><span>남은 자국</span><b>${r.remaining}</b></div><div><span>청소율</span><b>${noPaint ? '—' : `${(r.ratio * 100).toFixed(1)}%`}</b></div></div><p>${reaction}</p><button class="primary" id="restart">다시 도전하기</button>${r.cleared ? '<button class="secondary" id="next">다음 단계</button>' : ''}<p class="tip">총 ${r.generated}개 · A 90% 이상 / B 70% 이상</p>`;
    $('restart').onclick = startGame;
    if ($('next')) $('next').onclick = () => {
      if (CONFIG.next_step_url) { try { const url = new URL(CONFIG.next_step_url, location.href); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); location.assign(url.href); } catch { modal.querySelector('.tip').textContent = '다음 단계 주소를 확인해 주세요.'; } }
      else modal.querySelector('.tip').textContent = '다음 단계는 준비 중이에요. 다시 도전해 보세요!';
    };
  }
}
function drawFrame(sheetName, frame, x, y, scale, angle = 0, alpha = 1, flip = false) {
  const [sx, sy, sw, sh] = frame.rect, [ax, ay] = frame.anchor_in_rect;
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(flip ? -scale : scale, scale); ctx.globalAlpha = alpha;
  ctx.drawImage(images[sheetName], sx, sy, sw, sh, -ax, -ay, sw, sh); ctx.restore();
}
function clipFloor() {
  const [x, y, w, h] = MAP_CONFIG.bounds; ctx.beginPath(); ctx.rect(x, y, w, h);
  for (const { rect: r } of MAP_CONFIG.obstacles) ctx.rect(...r); ctx.clip('evenodd');
}
function shadow(p, width, height) { ctx.fillStyle = '#62481c2a'; ctx.beginPath(); ctx.ellipse(p.x, p.y, width, height, 0, 0, Math.PI * 2); ctx.fill(); }
function render() {
  ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#f5dfb6'; ctx.fillRect(0, 0, 360, 640);
  if (!images['library-background']) return;
  const factor = Math.min(360 / 941, 640 / 1672), bw = 941 * factor, bh = 1672 * factor;
  ctx.drawImage(images['library-background'], (360 - bw) / 2, (640 - bh) / 2, bw, bh);
  if (!game) return;
  for (const s of game.stains) {
    const erasing = s.state === 'erasing', t = game.elapsed - s.erasedAt;
    if (erasing) {
      if (s.kind === 'foot') drawFrame('paint-cleaning-effects', frameAt(sheets.effects, 'erase_footprint', t), s.x, s.y, CONFIG.footprint_length_px / 242, s.angle, 1 - t / CONFIG.erase_duration_s);
      else drawFrame('paint-cleaning-effects', frameAt(sheets.effects, 'wide_clean_effect', t), s.x, s.y, .09, s.angle, 1 - t / CONFIG.erase_duration_s);
    } else {
      const f = frameAt(sheets.effects, s.variant, s.kind === 'splash' ? 1 : 0);
      drawFrame('paint-cleaning-effects', f, s.x, s.y, s.kind === 'foot' ? CONFIG.footprint_length_px / 242 : .085, s.angle, .9, s.variant === 'footprint_green_right');
    }
  }
  const n = game.npc, cat = game.cat;
  const drawNpc = () => {
    shadow(n, 12, 4);
    const special = ['shake', 'stretch'].includes(n.state), running = n.state === 'run';
    const sheetName = special ? 'librarian-actions' : running ? 'librarian-run' : 'librarian-walk';
    const sheet = special ? sheets.actions : running ? sheets.run : sheets.walk;
    const animation = special ? n.action : `${running ? 'run' : 'walk'}_${n.direction}`;
    const time = special ? n.stateTime : n.state === 'prepare' || n.speed === 0 ? 0 : n.animTime;
    drawFrame(sheetName, frameAt(sheet, animation, time), n.x, n.y, CONFIG.librarian_scale);
    if (n.state === 'prepare') { ctx.fillStyle = '#fff9e9'; ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', n.x, n.y - 58); }
  };
  const drawCat = () => { shadow(cat, 10, 4); drawFrame('cat-cleaning-actions', cat.frame, cat.x, cat.y, CONFIG.cat_scale, cat.angle); };
  if (cat.y < n.y) { drawCat(); drawNpc(); } else { drawNpc(); drawCat(); }
  for (const effect of game.effects) drawFrame('paint-cleaning-effects', frameAt(sheets.effects, effect.animation, game.elapsed - effect.born), effect.x, effect.y, .10, 0, .5);
  if (game.specialRemaining > 0) {
    ctx.save(); clipFloor();
    // Draw the same fan used by cleaning; ray clipping stops the display at furniture.
    ctx.translate(cat.x, cat.y); ctx.rotate(cat.angle);
    ctx.fillStyle = '#7dedeb33'; ctx.strokeStyle = '#deffff8c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -5);
    const radius = 23.095 + CONFIG.mop_half_width * CONFIG.special_range_multiplier;
    for (let i = 0; i <= 36; i++) {
      const a = -1.2 + 2.4 * i / 36; let r = Math.min(radius, CONFIG.mop_half_width * CONFIG.special_range_multiplier / Math.max(.001, Math.abs(Math.sin(a))));
      const local = { x: Math.sin(a) * r, y: -Math.cos(a) * r };
      const target = transform(cat, local);
      while (r > 5 && !game.room.lineFree(cat, target, 2)) { r -= 2; const p = transform(cat, { x: Math.sin(a) * r, y: -Math.cos(a) * r }); target.x = p.x; target.y = p.y; }
      ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.save(); clipFloor();
    const mop = game.mopPose(); drawFrame('paint-cleaning-effects', frameAt(sheets.effects, 'wide_clean_effect', game.specialElapsed % .32), mop.x, mop.y, .18, cat.angle, .25); ctx.restore();
  }
  if (game.input.pointer !== null && game.phase === 'playing') {
    const { origin, current } = game.input, dx = current.x - origin.x, dy = current.y - origin.y, len = Math.hypot(dx, dy), r = Math.min(27, len);
    ctx.strokeStyle = '#fff9e9aa'; ctx.fillStyle = '#244b3f26'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(origin.x, origin.y, 28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff8e9b3'; ctx.beginPath(); ctx.arc(origin.x + (len ? dx / len * r : 0), origin.y + (len ? dy / len * r : 0), 10, 0, Math.PI * 2); ctx.fill();
  }
  if (debug) {
    ctx.save(); ctx.strokeStyle = '#ff3357'; ctx.lineWidth = 1; ctx.strokeRect(...MAP_CONFIG.bounds); for (const o of MAP_CONFIG.obstacles) ctx.strokeRect(...o.rect);
    ctx.fillStyle = '#ff3055'; ctx.fillRect(cat.x - 2, cat.y - 2, 4, 4);
    const mop = game.mopPose(); ctx.translate(mop.x, mop.y); ctx.rotate(cat.angle); ctx.strokeStyle = '#1d8cd9'; ctx.strokeRect(-CONFIG.mop_half_width, -CONFIG.mop_half_depth, CONFIG.mop_half_width * 2, CONFIG.mop_half_depth * 2); ctx.restore();
  }
}
function logicalPoint(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 360, y: (e.clientY - r.top) / r.height * 640 }; }
canvas.addEventListener('pointerdown', e => { if (game?.press(e.pointerId, logicalPoint(e))) { canvas.setPointerCapture(e.pointerId); e.preventDefault(); } });
canvas.addEventListener('pointermove', e => { if (game && game.input.pointer === e.pointerId) { game.drag(e.pointerId, logicalPoint(e)); e.preventDefault(); } });
const release = e => { if (game?.input.pointer === e.pointerId) { game.release(e.pointerId); if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } };
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
specialButton.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (game?.activateSpecial()) updateInterface(); });
specialButton.addEventListener('click', e => { if (e.detail === 0 && game?.activateSpecial()) updateInterface(); });
$('pause').onclick = () => { game.pause(); lastTime = null; updateInterface(); };
const pauseWhenAway = () => { if (game) { game.pause(); lastTime = null; updateInterface(); } };
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseWhenAway(); }); window.addEventListener('blur', pauseWhenAway);
window.addEventListener('keydown', e => { if (e.code === 'Escape') { pauseWhenAway(); } if (e.code === 'Space' && game?.phase === 'playing' && e.target === document.body) { e.preventDefault(); game.activateSpecial(); updateInterface(); } });
function loop(time) {
  const dt = lastTime === null ? 0 : Math.max(0, (time - lastTime) / 1000); lastTime = time;
  // A suspended renderer is paused instead of simulating a hidden interval all at once.
  if (loaded && dt > 1) pauseWhenAway(); else if (loaded && dt) game.advance(dt);
  render(); hudTime += dt; if (loaded && (hudTime > .05 || shownPhase !== game.phase)) { updateInterface(); hudTime = 0; }
  requestAnimationFrame(loop);
}
preload(); requestAnimationFrame(loop);
