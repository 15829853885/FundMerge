/* ============================================================================
   合资金账 · 交互反馈层（v5.5）

   解决三件事：
   1. 深色主题下「点了有反应但看不出来」——卡片追光、按钮磁吸、指针光斑都改成
      色彩混合（screen / soft-light），深色底上表现为"发光"，不再依赖黑色投影。
   2. 鼠标在页面里移动时的反馈强度——卡片按指针位置实时打光 + 微倾斜（≤1.2deg），
      按钮朝指针方向做 2px 以内的磁吸位移，指针位置有一团跟随光斑。
   3. 粒子动效——底层环境粒子（漂浮 + 指针聚散 + 近邻连线）与点击迸发粒子。

   三层 DOM（都挂在 body，pointer-events: none）：
     .fx-field   底层 2D 画布：环境粒子与连线，透过内容区空白处可见
     .fx-aura    顶层光斑：跟随指针的柔和径向光，靠混合模式融入主题
     .fx-burst   顶层 2D 画布：点击迸发，只在有粒子存活时清屏，空闲不产生绘制

   降级矩阵（任一命中即整体停用，且不创建任何绘制循环）：
     data-fx="off"（设置页开关） / data-perf="low"（流畅优先） /
     data-motion="off"（关闭页面动效） / 系统 prefers-reduced-motion /
     触屏或粗指针（没有 hover，跟随效果只会变成粘滞的残留状态）
   ========================================================================== */

'use strict';

(function () {
  const html = document.documentElement;
  const mqFine = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const prefOn    = () => html.getAttribute('data-fx') !== 'off';
  const perfLow   = () => html.getAttribute('data-perf') === 'low';
  const motionOff = () => html.getAttribute('data-motion') === 'off';
  const sysReduce = () => !!(mqReduce && mqReduce.matches);
  const fine      = () => !!(mqFine && mqFine.matches);
  const enabled   = () => prefOn() && !perfLow() && !motionOff() && !sysReduce() && fine();

  /* ------------------------------- DOM 层 ------------------------------- */

  let field = null, burst = null, aura = null, fctx = null, bctx = null;
  let W = 0, H = 0, dpr = 1;

  function ensureLayers() {
    if (aura) return;
    aura = document.createElement('div');
    aura.className = 'fx-aura';
    aura.setAttribute('aria-hidden', 'true');

    field = document.createElement('canvas');
    field.className = 'fx-field';
    field.setAttribute('aria-hidden', 'true');

    burst = document.createElement('canvas');
    burst.className = 'fx-burst';
    burst.setAttribute('aria-hidden', 'true');

    document.body.appendChild(field);
    document.body.appendChild(burst);
    document.body.appendChild(aura);
    fctx = field.getContext('2d');
    bctx = burst.getContext('2d');
  }

  /* 调色板从 CSS 变量读：深色/浅色/蓝/绿四套主题各自定义，JS 不写死颜色。
     每帧读 getComputedStyle 太贵，改在主题切换与启动时各读一次。 */
  let COL = { dot: '129,140,248', link: '129,140,248', b1: '99,102,241', b2: '248,113,113', b3: '52,211,153', ring: '99,102,241' };
  const cssVar = n => getComputedStyle(html).getPropertyValue(n).trim();

  function readPalette() {
    const dot = cssVar('--fx-dot'), link = cssVar('--fx-link');
    const b1 = cssVar('--fx-burst-1'), b2 = cssVar('--fx-burst-2'), b3 = cssVar('--fx-burst-3');
    const ring = cssVar('--fx-ring');
    COL = {
      dot: dot || COL.dot, link: link || COL.link,
      b1: b1 || COL.b1, b2: b2 || COL.b2, b3: b3 || COL.b3,
      ring: ring || COL.ring
    };
  }

  function resize() {
    if (!field) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    [field, burst].forEach(c => {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    });
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* 缩窗后把越界粒子拉回来，否则它们会在画布外飘很久 */
    particles.forEach(p => {
      if (p.x > W) p.x = Math.random() * W;
      if (p.y > H) p.y = Math.random() * H;
    });
  }

  /* ------------------------------ 环境粒子 ------------------------------ */

  const particles = [];
  const bursts = [];
  /* 点击水波纹：画在顶层 canvas 上，不插 DOM、不影响布局。
     商务界面里"点下去有回应"比"点下去有粒子"更重要，所以波纹是主反馈、粒子是辅料。 */
  const rings = [];
  let mx = -9999, my = -9999, hasPointer = false;

  function spawnParticles() {
    particles.length = 0;
    /* 密度按视口面积给，1080p 约 64 个；小屏少一些，避免满屏噪点 */
    const n = Math.round(Math.min(78, Math.max(34, (W * H) / 26000)));
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 11,
        vy: (Math.random() - 0.5) * 11,
        r: 0.9 + Math.random() * 1.5,
        a: 0.32 + Math.random() * 0.42,
        ph: Math.random() * Math.PI * 2
      });
    }
  }

  function stepParticles(dt, t) {
    /* 连线半径与吸引半径：1024px 屏按比例缩放，避免大屏上"什么都没有" */
    const R = Math.max(120, Math.min(200, W * 0.14));
    const R2 = R * R;
    const LINK = 92;

    for (const p of particles) {
      /* 缓慢自漂移 + 轻微呼吸摆动，避免看起来像静止的噪点 */
      p.x += (p.vx + Math.sin(t * 0.6 + p.ph) * 3) * dt;
      p.y += (p.vy + Math.cos(t * 0.5 + p.ph) * 3) * dt;

      if (hasPointer) {
        const dx = mx - p.x, dy = my - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1;
          if (d > 34) {
            /* 吸引：粒子朝指针"聚"过来 */
            const f = (1 - d / R) * 34 * dt;
            p.x += (dx / d) * f;
            p.y += (dy / d) * f;
          } else {
            /* 太近则轻推，防止全部堆成一个点 */
            const f = (34 - d) * 0.9 * dt;
            p.x -= (dx / d) * f;
            p.y -= (dy / d) * f;
          }
        }
      }

      if (p.x < -24) p.x = W + 24;
      if (p.x > W + 24) p.x = -24;
      if (p.y < -24) p.y = H + 24;
      if (p.y > H + 24) p.y = -24;
    }
  }

  function drawParticles() {
    fctx.clearRect(0, 0, W, H);

    /* 近邻连线：只在 92px 内连，超过就是一团乱麻 */
    const LINK = 92, L2 = LINK * LINK;
    fctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > L2) continue;
        const al = (1 - d2 / L2) * 0.22;
        fctx.strokeStyle = `rgba(${COL.link},${al.toFixed(3)})`;
        fctx.beginPath();
        fctx.moveTo(a.x, a.y);
        fctx.lineTo(b.x, b.y);
        fctx.stroke();
      }
    }

    for (const p of particles) {
      /* 指针附近的粒子更亮：让"聚过来"这件事被看见 */
      let boost = 0;
      if (hasPointer) {
        const d = Math.hypot(p.x - mx, p.y - my);
        boost = Math.max(0, 1 - d / 200) * 0.5;
      }
      fctx.fillStyle = `rgba(${COL.dot},${Math.min(1, p.a + boost).toFixed(3)})`;
      fctx.beginPath();
      fctx.arc(p.x, p.y, p.r + boost * 1.4, 0, Math.PI * 2);
      fctx.fill();
    }
  }

  /* ------------------------------ 点击迸发 ------------------------------ */

  /* 波纹半径跟目标元素的尺寸走：按钮上是"贴着控件扩散的一圈"，
     不是固定 58px 的魔法阵。大块区域（卡片/表格行）才给到 90px 上限。 */
  function emitRing(x, y, el) {
    let r1 = 46;
    if (el && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      const half = Math.sqrt((r.width / 2) ** 2 + (r.height / 2) ** 2);
      r1 = Math.max(24, Math.min(88, half * 0.86 + 6));
    }
    if (rings.length > 6) rings.shift();
    rings.push({ x, y, t: 0, dur: 0.42, r0: 6, r1 });
  }

  function emit(x, y) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const sp = 70 + Math.random() * 190;
      bursts.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 30,
        r: 1.2 + Math.random() * 2.1,
        life: 0.55 + Math.random() * 0.4,
        max: 0.95,
        c: i % 3 === 0 ? COL.b2 : i % 3 === 1 ? COL.b3 : COL.b1
      });
    }
  }

  function stepBursts(dt) {
    if (!bursts.length) return;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.life -= dt;
      if (b.life <= 0) { bursts.splice(i, 1); continue; }
      b.vx *= 0.94;
      b.vy = b.vy * 0.94 + 220 * dt;      /* 轻微重力，落感更自然 */
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
  }

  function stepRings(dt) {
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t >= rings[i].dur) rings.splice(i, 1);
    }
  }

  /* 顶层画布统一入口：先清屏，再画迸发粒子与水波纹 */
  function drawFx() {
    bctx.clearRect(0, 0, W, H);

    for (const b of bursts) {
      const a = Math.max(0, Math.min(1, b.life / b.max)) * 0.9;
      bctx.fillStyle = `rgba(${b.c},${a.toFixed(3)})`;
      bctx.beginPath();
      bctx.arc(b.x, b.y, b.r * (0.6 + a * 0.7), 0, Math.PI * 2);
      bctx.fill();
    }

    for (const g of rings) {
      const p = g.t / g.dur;
      const e = 1 - Math.pow(1 - p, 3);           /* ease-out：先快后慢，像真的扩散开 */
      const r = g.r0 + (g.r1 - g.r0) * e;
      bctx.strokeStyle = `rgba(${COL.ring},${Math.max(0, (1 - p) * 0.5).toFixed(3)})`;
      bctx.lineWidth = 2.2 * (1 - p) + 0.5;
      bctx.beginPath();
      bctx.arc(g.x, g.y, r, 0, Math.PI * 2);
      bctx.stroke();
    }
  }

  /* ------------------------------ 指针跟随 ------------------------------ */

  let ax = -9999, ay = -9999;     /* 光斑位置（带惯性，避免"黏在指针上"的僵硬感） */
  let cardEl = null, btnEl = null;

  function clearCard() {
    if (!cardEl) return;
    cardEl.classList.remove('is-fx-hover');
    cardEl.style.removeProperty('--fx-mx');
    cardEl.style.removeProperty('--fx-my');
    cardEl.style.removeProperty('--fx-rx');
    cardEl.style.removeProperty('--fx-ry');
    cardEl = null;
  }

  function clearBtn() {
    if (!btnEl) return;
    btnEl.style.removeProperty('--fx-tx');
    btnEl.style.removeProperty('--fx-ty');
    btnEl = null;
  }

  function clearAll() {
    clearCard(); clearBtn();
    hasPointer = false;
    mx = my = -9999;
  }

  let pending = false, lastEv = null;
  function onMove(e) {
    if (!running || !enabled()) return;
    lastEv = e;
    if (pending) return;
    pending = true;
    requestAnimationFrame(applyPointer);
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function applyPointer() {
    pending = false;
    const e = lastEv;
    if (!e) return;
    mx = e.clientX; my = e.clientY;
    hasPointer = true;
    if (!aura) return;
    if (ax < -1000) { ax = mx; ay = my; }      /* 首次出现不要从 (-9999,-9999) 飞过来 */

    const t = e.target;
    const card = t && t.closest ? t.closest('.card, .stat, .co-card, .plan-card') : null;
    if (card !== cardEl) { clearCard(); cardEl = card; }

    if (card) {
      const r = card.getBoundingClientRect();
      const x = mx - r.left, y = my - r.top;
      const nx = x / Math.max(r.width, 1) - 0.5;
      const ny = y / Math.max(r.height, 1) - 0.5;
      card.style.setProperty('--fx-mx', x.toFixed(1) + 'px');
      card.style.setProperty('--fx-my', y.toFixed(1) + 'px');
      /* 倾斜上限 ±1.2deg：与 CSS 里的固定基础角相加后仍在 2deg 以内（M1 铁律） */
      card.style.setProperty('--fx-rx', clamp(-ny * 2.4, -1.2, 1.2).toFixed(2) + 'deg');
      card.style.setProperty('--fx-ry', clamp(nx * 2.6, -1.2, 1.2).toFixed(2) + 'deg');
      card.classList.add('is-fx-hover');
    }

    const btn = t && t.closest ? t.closest('.btn, .icon-btn') : null;
    if (btn !== btnEl) { clearBtn(); btnEl = btn; }
    if (btn && !btn.disabled) {
      const r = btn.getBoundingClientRect();
      const dx = mx - (r.left + r.width / 2);
      const dy = my - (r.top + r.height / 2);
      btn.style.setProperty('--fx-tx', clamp(dx * 0.10, -2.2, 2.2).toFixed(2) + 'px');
      btn.style.setProperty('--fx-ty', clamp(dy * 0.12, -2, 2).toFixed(2) + 'px');
    }
  }

  /* ------------------------------- 主循环 ------------------------------- */

  let raf = 0, running = false, lastT = 0, tSec = 0;

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000);
    lastT = now;
    tSec += dt;

    /* 光斑惯性跟随：0.16 的缓动让它"追"着指针，而不是钉在上面 */
    ax += (mx - ax) * 0.18;
    ay += (my - ay) * 0.18;
    if (hasPointer) {
      aura.style.setProperty('--fx-x', ax.toFixed(1) + 'px');
      aura.style.setProperty('--fx-y', ay.toFixed(1) + 'px');
      aura.classList.add('is-on');
    } else {
      aura.classList.remove('is-on');
    }

    stepParticles(dt, tSec);
    drawParticles();
    stepBursts(dt);
    stepRings(dt);
    drawFx();
  }

  function start() {
    ensureLayers();
    if (running) return;
    if (!enabled()) { stop(); return; }
    readPalette();
    resize();
    if (!particles.length) spawnParticles();
    running = true;
    lastT = 0;
    raf = requestAnimationFrame(frame);
    aura.classList.add('is-live');
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    clearAll();
    bursts.length = 0;
    rings.length = 0;
    if (bctx) bctx.clearRect(0, 0, W, H);
    if (fctx) fctx.clearRect(0, 0, W, H);
    if (aura) aura.classList.remove('is-on', 'is-live');
  }

  /* -------------------------------- 事件 -------------------------------- */

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', e => {
    if (!running || !enabled() || e.button !== 0) return;
    const t = e.target;
    const hit = t && t.closest
      ? t.closest('button, a, input, select, textarea, [data-action], .nav-item, .seg-btn, .switch')
      : null;
    if (!hit) return;
    emitRing(e.clientX, e.clientY, hit);
    /* 按钮/输入框上只给一圈波纹：小控件再撒粒子会显得吵，也不"商务"；
       卡片、表格行这类大目标才补少量粒子，提示"这一块被点到了"。 */
    const small = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(hit.tagName);
    if (!small) emit(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('pointerout', e => {
    if (!e.relatedTarget) clearAll();
  }, { passive: true });
  window.addEventListener('scroll', () => { clearCard(); clearBtn(); }, { passive: true });
  window.addEventListener('resize', () => { if (running) resize(); }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (running) { lastT = 0; raf = requestAnimationFrame(frame); }
  });

  if (mqFine && mqFine.addEventListener) {
    mqFine.addEventListener('change', () => { if (enabled()) start(); else stop(); });
  }

  /* 主题切换后重新取色：不重取的话，从深色切到浅色，粒子还是深色主题那套亮紫 */
  if (window.MutationObserver) {
    new MutationObserver(() => {
      if (!running) return;
      readPalette();
    }).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  }

  window.FX = {
    start,
    stop,
    refreshPrefs() { if (enabled()) start(); else stop(); },
    /* 供调试与验收：当前是否在跑、粒子数 */
    state: () => ({ running, particles: particles.length, bursts: bursts.length, rings: rings.length, enabled: enabled() })
  };

  /* 样式表与 body 就绪后自启（脚本在 body 末尾，通常已就绪） */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
