import { CONFIG, MAP_CONFIG } from './config.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function seededRandom(seed = 12345) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function transform(pose, local) {
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  return { x: pose.x + local.x * c - local.y * s, y: pose.y + local.x * s + local.y * c };
}
function pointInRect(p, r, padding = 0) { return p.x >= r[0] - padding && p.x <= r[0] + r[2] + padding && p.y >= r[1] - padding && p.y <= r[1] + r[3] + padding; }
export function frameAt(sheet, animation, seconds) {
  const a = sheet.animations[animation];
  const total = a.frames.reduce((n, id) => n + sheet.frames[id].duration_ms, 0);
  let t = seconds * 1000;
  if (a.loop && total) t %= total;
  for (const id of a.frames) { const f = sheet.frames[id]; if (t < f.duration_ms) return { ...f, id }; t -= f.duration_ms; }
  const id = a.frames.at(-1); return { ...sheet.frames[id], id };
}

export class Room {
  constructor(config = CONFIG, map = MAP_CONFIG) {
    this.config = config; this.map = map; this.nodes = []; this.adjacency = new Map();
    const cell = config.navigation_cell_px, [x, y, w, h] = map.bounds;
    const grid = new Map();
    for (let gy = 0; y + gy * cell < y + h; gy++) for (let gx = 0; x + gx * cell < x + w; gx++) {
      const p = { x: x + gx * cell, y: y + gy * cell, gx, gy, id: this.nodes.length };
      if (this.circleFree(p, config.npc_navigation_radius)) { this.nodes.push(p); grid.set(`${gx},${gy}`, p); }
    }
    for (const p of this.nodes) {
      const edges = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const q = grid.get(`${p.gx + dx},${p.gy + dy}`);
        if (q && this.lineFree(p, q, config.npc_navigation_radius)) edges.push(q.id);
      }
      this.adjacency.set(p.id, edges);
    }
    const spawn = { x: map.cat_spawn[0], y: map.cat_spawn[1] };
    const start = this.nearest(spawn); this.connected = new Set(start ? [start.id] : []); const queue = start ? [start.id] : [];
    for (let i = 0; i < queue.length; i++) for (const id of this.adjacency.get(queue[i]) ?? []) if (!this.connected.has(id)) { this.connected.add(id); queue.push(id); }
    this.reachable = this.nodes.filter(p => this.connected.has(p.id));
    if (!this.reachable.length) throw new Error('이동 가능한 바닥이 없습니다. MAP_CONFIG를 확인해 주세요.');
    this.stainReachability = new Map();
  }
  pointFree(p, radius = 0) {
    const [x, y, w, h] = this.map.bounds;
    return p.x >= x + radius && p.x <= x + w - radius && p.y >= y + radius && p.y <= y + h - radius && !this.map.obstacles.some(o => pointInRect(p, o.rect, radius));
  }
  circleFree(p, radius) {
    const [x, y, w, h] = this.map.bounds;
    if (p.x - radius < x || p.x + radius > x + w || p.y - radius < y || p.y + radius > y + h) return false;
    return !this.map.obstacles.some(({ rect: r }) => Math.hypot(p.x - clamp(p.x, r[0], r[0] + r[2]), p.y - clamp(p.y, r[1], r[1] + r[3])) < radius);
  }
  lineFree(a, b, radius = 0) {
    const n = Math.max(1, Math.ceil(distance(a, b) / 2));
    for (let i = 0; i <= n; i++) if (!this.circleFree({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }, radius)) return false;
    return true;
  }
  mopBoxFree(pose, local) {
    const center = transform(pose, local), c = this.config;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => transform({ ...center, angle: pose.angle }, { x: x * c.mop_half_width, y: y * c.mop_half_depth }));
    const [bx, by, bw, bh] = this.map.bounds;
    if (corners.some(p => p.x < bx + .5 || p.y < by + .5 || p.x > bx + bw - .5 || p.y > by + bh - .5)) return false;
    const axes = [[1, 0], [0, 1], [Math.cos(pose.angle), Math.sin(pose.angle)], [-Math.sin(pose.angle), Math.cos(pose.angle)]];
    for (const { rect: r } of this.map.obstacles) {
      const other = [{ x: r[0], y: r[1] }, { x: r[0] + r[2], y: r[1] }, { x: r[0] + r[2], y: r[1] + r[3] }, { x: r[0], y: r[1] + r[3] }];
      const separated = axes.some(([x, y]) => {
        const a = corners.map(p => p.x * x + p.y * y), b = other.map(p => p.x * x + p.y * y);
        return Math.max(...a) < Math.min(...b) - .5 || Math.max(...b) < Math.min(...a) - .5;
      });
      if (!separated) return false;
    }
    return this.lineFree(pose, center, 2);
  }
  catFree(pose, local = { x: 0, y: -23.095 }) { return this.circleFree(pose, this.config.cat_body_radius) && this.mopBoxFree(pose, local); }
  nearest(p, connectedOnly = false) {
    let best, d = Infinity;
    for (const q of connectedOnly ? this.reachable : this.nodes) { const ds = distance(p, q); if (ds < d) { best = q; d = ds; } }
    return best;
  }
  path(from, to) {
    const r = this.config.npc_navigation_radius;
    if (this.lineFree(from, to, r)) return [to];
    const start = this.nearest(from, true), end = this.nearest(to, true);
    if (!start || !end) return [];
    const prev = new Map([[start.id, null]]), queue = [start.id];
    for (let i = 0; i < queue.length && !prev.has(end.id); i++) for (const id of this.adjacency.get(queue[i])) if (!prev.has(id)) { prev.set(id, queue[i]); queue.push(id); }
    if (!prev.has(end.id)) return [];
    const out = [to]; let id = end.id;
    while (id !== null) { out.unshift(this.nodes[id]); id = prev.get(id); }
    // Retain only waypoints that are needed, with swept collision clearance.
    const compact = []; let p = from;
    while (out.length) { let i = out.length - 1; while (i > 0 && !this.lineFree(p, out[i], r)) i--; p = out[i]; compact.push(p); out.splice(0, i + 1); }
    return compact;
  }
  stainReachable(p) {
    if (!this.circleFree(p, 9)) return false;
    const key = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    if (this.stainReachability.has(key)) return this.stainReachability.get(key);
    let ok = false;
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const offset = transform({ x: 0, y: 0, angle }, { x: 0, y: -23.095 });
      const body = { x: p.x - offset.x, y: p.y - offset.y, angle };
      const near = this.nearest(body, true);
      if (this.catFree(body) && near && distance(body, near) < 48 && this.lineFree(body, near, this.config.cat_body_radius)) { ok = true; break; }
    }
    if (this.stainReachability.size > 2000) this.stainReachability.clear();
    this.stainReachability.set(key, ok); return ok;
  }
}

export class Game {
  constructor(sheets, options = {}) {
    this.sheets = sheets; this.config = { ...CONFIG, ...options.config }; this.map = options.map ?? MAP_CONFIG;
    this.random = options.random ?? Math.random; this.onComplete = options.onComplete ?? (() => {});
    this.room = new Room(this.config, this.map); this.reset();
  }
  range(a) { return a[0] + this.random() * (a[1] - a[0]); }
  reset() {
    this.phase = 'start'; this.elapsed = 0; this.countdown = this.config.countdown_s;
    this.generated = 0; this.cleaned = 0; this.remaining = 0; this.charge = 0;
    this.stains = []; this.effects = []; this.nextId = 1; this.specialRemaining = 0; this.specialElapsed = 0;
    this.input = { pointer: null, origin: null, current: null, x: 0, y: 0 }; this.completeEmitted = false;
    this.cat = { x: this.map.cat_spawn[0], y: this.map.cat_spawn[1], angle: 0, speed: 0, idle: 0, animTime: 0, animation: 'ordinary_push', frame: frameAt(this.sheets.cat, 'ordinary_push', 0) };
    this.npc = { x: this.map.npc_spawn[0], y: this.map.npc_spawn[1], angle: Math.PI, direction: 'down', state: 'walk', stateTime: 0, animTime: 0, path: [], stepDistance: 0, foot: 0, shakeSpawned: false, blocked: 0, speed: 0,
      nextRun: this.config.npc_initial_grace_s + this.range(this.config.npc_run_cooldown_s), nextShake: this.range(this.config.npc_shake_cooldown_s), nextStretch: this.range(this.config.npc_stretch_cooldown_s), nextTurn: this.config.npc_initial_grace_s + this.range(this.config.npc_turn_interval_s) };
    this.stats = { walk: 0, run: 0, prepare: 0, shake: 0, stretch: 0, turns: 0, specialUses: 0, ordinaryCleaned: 0, specialCleaned: 0 };
    this.result = null; this.notice = ''; this.noticeRemaining = 0; this.finalNotified = false;
    this.chooseDestination();
  }
  start() { this.reset(); this.phase = 'countdown'; }
  pause() { if (this.phase === 'playing' || this.phase === 'countdown') { this.resumePhase = this.phase; this.phase = 'paused'; this.release(); this.cat.speed = 0; } }
  resume() { if (this.phase === 'paused') { this.phase = this.resumePhase; this.release(); } }
  press(pointer, p) {
    if (this.phase !== 'playing' || this.input.pointer !== null) return false;
    this.input = { pointer, origin: { ...p }, current: { ...p }, x: 0, y: 0 }; this.cat.idle = 0;
    return true;
  }
  drag(pointer, p) {
    if (pointer !== this.input.pointer || this.phase !== 'playing') return;
    this.input.current = { ...p }; const dx = p.x - this.input.origin.x, dy = p.y - this.input.origin.y;
    const len = Math.hypot(dx, dy), c = this.config;
    const power = clamp((len - c.joystick_deadzone_px) / (c.joystick_max_drag_px - c.joystick_deadzone_px), 0, 1);
    this.input.x = len ? dx / len * power : 0; this.input.y = len ? dy / len * power : 0;
  }
  release(pointer = this.input.pointer) {
    if (pointer !== this.input.pointer) return;
    this.input = { pointer: null, origin: null, current: null, x: 0, y: 0 }; this.cat.speed = 0;
  }
  activateSpecial() {
    const c = this.config;
    if (this.phase !== 'playing' || this.specialRemaining > 0 || this.charge < c.special_charge_max) return false;
    this.charge -= c.special_charge_max; this.specialRemaining = c.special_duration_s; this.specialElapsed = 0;
    this.stats.specialUses++; this.showNotice('와다다! 넓게 쓸어 주세요 ✦', 1.2); return true;
  }
  showNotice(text, seconds = 1.5) { this.notice = text; this.noticeRemaining = seconds; }
  chooseDestination(flee = false) {
    const n = this.npc, points = this.room.reachable;
    let target;
    for (let i = 0; i < 16; i++) {
      const p = points[Math.floor(this.random() * points.length)];
      if (distance(n, p) < 55 || distance(n, p) > 190) continue;
      if (flee && distance(p, this.cat) < distance(n, this.cat) + 25) continue;
      target = p; break;
    }
    target ??= points[Math.floor(this.random() * points.length)];
    n.path = this.room.path(n, target); n.blocked = 0;
  }
  setNpcState(state) { this.npc.state = state; this.npc.stateTime = 0; this.npc.animTime = 0; this.stats[state] = (this.stats[state] ?? 0) + 1; }
  addStain(p, kind = 'foot', variant = 'footprint_orange_left', angle = 0) {
    if (this.phase !== 'playing' || this.elapsed >= this.config.game_duration_s - this.config.final_cleanup_s || this.remaining >= this.config.max_active_stains || !this.room.stainReachable(p)) return null;
    const stain = { id: this.nextId++, x: p.x, y: p.y, kind, variant, angle, state: 'dirty', erasedAt: 0 };
    this.stains.push(stain); this.generated++; this.remaining++; return stain;
  }
  cleanStain(stain, special = false) {
    if (stain.state !== 'dirty') return false;
    stain.state = 'erasing'; stain.erasedAt = this.elapsed; this.cleaned++; this.remaining--;
    this.stats[special ? 'specialCleaned' : 'ordinaryCleaned']++;
    this.charge = Math.min(this.config.special_charge_max, this.charge + (special ? this.config.special_charge_per_special_stain : this.config.special_charge_per_normal_stain));
    return true;
  }
  localMop(frame = this.cat.frame) { return { x: (frame.mop_center_in_rect[0] - frame.anchor_in_rect[0]) * this.config.cat_scale, y: (frame.mop_center_in_rect[1] - frame.anchor_in_rect[1]) * this.config.cat_scale }; }
  mopPose(pose = this.cat, frame = this.cat.frame) { return { ...transform(pose, this.localMop(frame)), angle: pose.angle }; }
  cleanAt(pose, local, special) {
    const mop = transform(pose, local), c = this.config;
    const ca = Math.cos(pose.angle), sa = Math.sin(pose.angle);
    for (const stain of this.stains) {
      if (stain.state !== 'dirty') continue;
      const dx = stain.x - mop.x, dy = stain.y - mop.y;
      const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
      let hit;
      if (special) {
        const sx = stain.x - pose.x, sy = stain.y - pose.y;
        const x = sx * ca + sy * sa, y = -sx * sa + sy * ca;
        const radius = 23.095 + c.mop_half_width * c.special_range_multiplier;
        hit = Math.hypot(x, y) <= radius && Math.abs(x) <= c.mop_half_width * c.special_range_multiplier && y <= -5 && Math.abs(Math.atan2(x, -y)) <= 1.2;
        if (hit && !this.room.lineFree(pose, stain, 2)) hit = false;
      } else {
        // Only the board can clean. A small radius accounts for paint extending past its center.
        hit = Math.hypot(Math.max(0, Math.abs(lx) - c.mop_half_width), Math.max(0, Math.abs(ly) - c.mop_half_depth)) <= 5;
        if (hit && !this.room.lineFree(mop, stain, 1)) hit = false;
      }
      if (hit) this.cleanStain(stain, special);
    }
  }
  sweepCat(old, oldLocal, special) {
    const cat = this.cat, local = this.localMop();
    const n = Math.max(1, Math.ceil(distance(old, cat) / 2), Math.ceil(Math.abs(angleDelta(old.angle, cat.angle)) / .045), Math.ceil(Math.hypot(oldLocal.x - local.x, oldLocal.y - local.y) / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n, pose = { x: old.x + (cat.x - old.x) * t, y: old.y + (cat.y - old.y) * t, angle: old.angle + angleDelta(old.angle, cat.angle) * t };
      const m = { x: oldLocal.x + (local.x - oldLocal.x) * t, y: oldLocal.y + (local.y - oldLocal.y) * t };
      if (this.room.catFree(pose, m)) this.cleanAt(pose, m, special);
    }
  }
  updateCat(dt, special) {
    const cat = this.cat, c = this.config, old = { ...cat }, oldLocal = this.localMop();
    const power = Math.hypot(this.input.x, this.input.y), moving = power > 0;
    if (moving) {
      cat.idle = 0;
      const desired = Math.atan2(this.input.x, -this.input.y), turn = clamp(angleDelta(cat.angle, desired), -c.cat_turn_speed * dt, c.cat_turn_speed * dt);
      const candidate = { ...cat, angle: cat.angle + turn };
      if (this.room.catFree(candidate, oldLocal)) cat.angle = candidate.angle;
      const dx = this.input.x * c.cat_max_speed_px_s * dt, dy = this.input.y * c.cat_max_speed_px_s * dt;
      const both = { ...cat, x: cat.x + dx, y: cat.y + dy };
      if (this.room.catFree(both, oldLocal)) { cat.x = both.x; cat.y = both.y; }
      else {
        const x = { ...cat, x: cat.x + dx }; if (this.room.catFree(x, oldLocal)) cat.x = x.x;
        const y = { ...cat, y: cat.y + dy }; if (this.room.catFree(y, oldLocal)) cat.y = y.y;
      }
    } else if (this.input.pointer === null) cat.idle += dt;
    else cat.idle = 0;
    cat.speed = distance(old, cat) / dt;
    let animation = 'ordinary_push', time = 0;
    if (special) { animation = 'wadada_clean'; time = this.specialElapsed; }
    else if (moving) { cat.animTime += dt * cat.speed / c.cat_max_speed_px_s; time = cat.animTime; }
    else if (cat.idle >= c.cat_idle_start_s) {
      const rest = (cat.idle - c.cat_idle_start_s) % c.cat_idle_repeat_s;
      if (rest < 1.2) { animation = 'idle_sigh'; time = rest; }
      else if (rest < 2.4) { animation = 'wipe_sweat'; time = rest - 1.2; }
    }
    if (animation !== cat.animation && animation === 'ordinary_push') { cat.animTime = 0; time = 0; }
    const frame = frameAt(this.sheets.cat, animation, time), m = this.localMop(frame);
    // Never let an animation frame swing the physical mop through a shelf.
    let transitionFree = true;
    const steps = Math.max(1, Math.ceil(Math.hypot(oldLocal.x - m.x, oldLocal.y - m.y) / 2));
    for (let i = 1; i <= steps; i++) if (!this.room.catFree(cat, { x: oldLocal.x + (m.x - oldLocal.x) * i / steps, y: oldLocal.y + (m.y - oldLocal.y) * i / steps })) { transitionFree = false; break; }
    if (transitionFree) { cat.frame = frame; cat.animation = animation; }
    this.sweepCat(old, oldLocal, special);
  }
  updateNpc(dt) {
    const n = this.npc, c = this.config; n.stateTime += dt; n.animTime += dt; n.speed = 0;
    if (n.state === 'shake') {
      if (!n.shakeSpawned && n.stateTime >= c.npc_shake_spawn_at_s) {
        n.shakeSpawned = true;
        const [minCount, maxCount] = c.npc_shake_stain_count;
        const count = minCount + Math.floor(this.random() * (maxCount - minCount + 1));
        let spawned = 0;
        for (let attempt = 0; attempt < count * 12 && spawned < count; attempt++) {
          if (this.elapsed >= c.game_duration_s - c.final_cleanup_s || this.remaining >= c.max_active_stains) break;
          const a = this.random() * Math.PI * 2, r = 16 + this.random() * (c.npc_shake_radius_px - 16);
          const p = { x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r };
          if (this.room.lineFree(n, p, 3)) {
            const stain = this.addStain(p, 'splash', 'paint_splash', a);
            if (stain) { spawned++; this.effects.push({ x: p.x, y: p.y, born: this.elapsed, animation: 'paint_splash' }); }
          }
        }
      }
      if (n.stateTime >= c.npc_shake_duration_s) { n.nextShake = this.elapsed + this.range(c.npc_shake_cooldown_s); this.setNpcState('walk'); }
      return;
    }
    if (n.state === 'stretch') { if (n.stateTime >= c.npc_stretch_duration_s) { n.nextStretch = this.elapsed + this.range(c.npc_stretch_cooldown_s); this.setNpcState('walk'); } return; }
    if (n.state === 'prepare') {
      if (n.stateTime >= c.npc_run_prepare_s) { this.setNpcState('run'); n.runDuration = this.range(c.npc_run_duration_s); this.chooseDestination(true); }
      return;
    }
    if (n.state === 'run' && n.stateTime >= n.runDuration) { n.nextRun = this.elapsed + this.range(c.npc_run_cooldown_s); this.setNpcState('walk'); }
    if (n.state === 'walk' && this.elapsed >= c.npc_initial_grace_s) {
      if (this.elapsed >= n.nextShake) { n.shakeSpawned = false; n.action = n.direction === 'up' ? 'shake_up' : 'shake_down'; this.setNpcState('shake'); return; }
      if (this.elapsed >= n.nextStretch) {
        const preferred = n.direction === 'left' ? 'stretch_left' : 'stretch_right';
        const choices = [preferred, preferred === 'stretch_left' ? 'stretch_right' : 'stretch_left'];
        // Stretches extend sideways farther than the feet. Check their floor footprint.
        const action = choices.find(a => this.sheets.actions.animations[a].frames.every(id => {
          const f = this.sheets.actions.frames[id], left = -f.anchor_in_rect[0] * c.librarian_scale, right = (f.rect[2] - f.anchor_in_rect[0]) * c.librarian_scale;
          return this.room.lineFree({ x: n.x + left, y: n.y - 7 }, { x: n.x + right, y: n.y - 7 }, 3);
        }));
        if (action) { n.action = action; this.setNpcState('stretch'); return; }
        n.nextStretch = this.elapsed + .5;
      }
      if (this.elapsed >= n.nextRun) {
        // Proximity makes fleeing more likely; random choices occur only at a scheduled decision.
        if (this.random() < (distance(n, this.cat) < 85 ? .95 : .7)) { this.setNpcState('prepare'); return; }
        n.nextRun = this.elapsed + .75;
      }
    }
    if (this.elapsed >= n.nextTurn && this.elapsed >= c.npc_initial_grace_s) { this.chooseDestination(n.state === 'run'); n.nextTurn = this.elapsed + this.range(c.npc_turn_interval_s); this.stats.turns++; }
    while (n.path.length && distance(n, n.path[0]) < 2) n.path.shift();
    if (!n.path.length) this.chooseDestination(n.state === 'run');
    const target = n.path[0]; if (!target) return;
    const d = distance(n, target); if (d < .001) return;
    const speed = c.cat_max_speed_px_s * (n.state === 'run' ? c.librarian_run_speed_ratio : c.librarian_walk_speed_ratio);
    const step = Math.min(speed * dt, d), dx = (target.x - n.x) / d, dy = (target.y - n.y) / d;
    const next = { x: n.x + dx * step, y: n.y + dy * step };
    if (!this.room.circleFree(next, c.npc_radius)) { n.blocked += dt; if (n.blocked > .12) this.chooseDestination(); return; }
    n.x = next.x; n.y = next.y; n.speed = step / dt; n.angle = Math.atan2(dx, -dy);
    n.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    n.stepDistance += step;
    while (n.stepDistance >= c.footstep_distance_px) {
      n.stepDistance -= c.footstep_distance_px;
      const side = n.foot % 2 === 0 ? -1 : 1;
      const p = { x: n.x - dx * 10 - dy * side * 5, y: n.y - dy * 10 + dx * side * 5 };
      if (this.addStain(p, 'foot', side < 0 ? 'footprint_orange_left' : 'footprint_green_right', n.angle)) n.foot++;
    }
  }
  advance(delta) {
    if (!Number.isFinite(delta) || delta <= 0 || !['countdown', 'playing'].includes(this.phase)) return;
    if (this.phase === 'countdown') {
      const used = Math.min(this.countdown, delta); this.countdown -= used; delta -= used;
      if (this.countdown <= .000001) { this.countdown = 0; this.phase = 'playing'; this.showNotice('사서의 발자국을 따라 닦아 주세요', 2); }
      else return;
    }
    while (delta > .000001 && this.phase === 'playing') {
      const boundary = this.config.game_duration_s - this.config.final_cleanup_s;
      const dt = Math.min(delta, this.config.simulation_step_s, this.config.game_duration_s - this.elapsed);
      const special = this.specialRemaining > .000001;
      this.elapsed = Math.min(this.config.game_duration_s, this.elapsed + dt);
      if (!this.finalNotified && this.elapsed >= boundary) { this.finalNotified = true; this.showNotice('마지막 5초! 남은 물감만 닦아요', 5); }
      this.updateNpc(dt); this.updateCat(dt, special);
      if (special) { this.specialElapsed += dt; this.specialRemaining = this.specialRemaining - dt <= .000001 ? 0 : this.specialRemaining - dt; }
      this.noticeRemaining = Math.max(0, this.noticeRemaining - dt);
      this.stains = this.stains.filter(s => s.state === 'dirty' || this.elapsed - s.erasedAt < this.config.erase_duration_s);
      this.effects = this.effects.filter(e => this.elapsed - e.born < .4);
      delta -= dt;
      if (this.elapsed >= this.config.game_duration_s - .000001) { this.elapsed = this.config.game_duration_s; this.finish(); }
    }
  }
  finish() {
    if (this.completeEmitted) return;
    this.phase = 'result'; this.release(); this.cat.speed = 0; this.npc.speed = 0; this.specialRemaining = 0;
    const ratio = this.generated ? this.cleaned / this.generated : 0;
    const grade = ratio >= this.config.grade_a_ratio ? 'A' : ratio >= this.config.grade_b_ratio ? 'B' : 'C';
    this.result = { grade, cleaned: this.cleaned, generated: this.generated, remaining: this.remaining, ratio, cleared: this.generated > 0 && ratio >= this.config.clear_ratio };
    this.completeEmitted = true; this.onComplete({ ...this.result });
  }
  snapshot() {
    return { phase: this.phase, elapsed: this.elapsed, generated: this.generated, cleaned: this.cleaned, remaining: this.remaining, ratio: this.generated ? this.cleaned / this.generated : null, charge: this.charge, specialRemaining: this.specialRemaining, cat: { ...this.cat }, npc: { ...this.npc }, stats: { ...this.stats }, result: this.result };
  }
}
