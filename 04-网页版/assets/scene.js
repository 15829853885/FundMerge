/* ============================================================================
   合资金账 · 3D 氛围层（three.js）
   仅用于装饰性背景：登录页品牌区、总览主指标卡。
   数据可视化仍用 2D SVG —— 3D 透视会扭曲数字比较，影响读数。
   无 WebGL / 不支持时静默降级为 CSS 渐变背景。
   ========================================================================== */

'use strict';

(function () {
  const scenes = [];
  /* 两个来源任一命中就停：系统级 prefers-reduced-motion，以及设置页的「动效开关」。
     早期只认系统偏好，导致用户在设置里关掉动效后 3D 层还在转——开关看起来是坏的。 */
  const reduceMotion = () => {
    if (document.documentElement.getAttribute('data-motion') === 'off') return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  function createAmbient(canvas, opts) {
    const THREE = window.THREE;
    if (!THREE) return null;

    const host = canvas.parentElement;
    if (!host) return null;

    let renderer;
    try {
      /* antialias 关掉、像素比固定 1：这是纯装饰层，抗锯齿看不出差别，
         但 MSAA + 高 DPR 会让每帧的 GPU 开销翻几倍。 */
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    } catch (e) {
      return null;                       // 无 WebGL → 保持 CSS 渐变
    }
    if (!renderer || !renderer.getContext()) return null;

    const size = () => ({ w: host.clientWidth || 320, h: host.clientHeight || 180 });
    let { w, h } = size();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 100);
    cam.position.z = opts.z || 7.2;

    const group = new THREE.Group();
    if (opts.offsetX) group.position.x = opts.offsetX;
    if (opts.offsetY) group.position.y = opts.offsetY;
    scene.add(group);

    /* 深色主题：线框与粒子改用更沉静的柔和紫、降低透明度，避免在深底上过亮（专项走查） */
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const color = isDark ? (opts.darkColor || 0x818cf8) : (opts.color || 0xc7d2fe);
    const shapes = [];
    const geoPool = [
      new THREE.IcosahedronGeometry(1.45, 0),
      new THREE.IcosahedronGeometry(1.0, 0),
      new THREE.OctahedronGeometry(0.85, 0)
    ];

    const n = Math.max(1, opts.shapes || 2);
    const spread = opts.spread || 2.4;
    for (let i = 0; i < n; i++) {
      const geo = geoPool[i % geoPool.length];
      const mat = new THREE.MeshBasicMaterial({
        color, wireframe: true, transparent: true,
        /* 深色底上的线框要更亮一档才看得清：0.7 的系数是 v5.4 之前为"压噪"加的，
           实际效果是把深色主题的几何体压到接近不可见（专项走查：深色下像没开动效）。 */
        opacity: (0.18 + i * 0.07) * (isDark ? 1.15 : 1)
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((i - (n - 1) / 2) * spread, i % 2 ? 0.55 : -0.45, -i * 0.9);
      mesh.userData.spin = 0.0014 + i * 0.0007;
      mesh.userData.baseY = mesh.position.y;
      group.add(mesh);
      shapes.push(mesh);
    }

    /* 粒子场 */
    const count = opts.particles || 220;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 3.2 + Math.random() * 3.4;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.62;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({
      color: isDark ? (opts.darkDotColor || 0x6366f1) : (opts.dotColor || 0xe0e7ff),
      size: opts.dotSize || 0.042,
      /* 深色下粒子要"发光"而不是"变灰"：加色混合让重叠处自然变亮 */
      blending: isDark ? THREE.AdditiveBlending : THREE.NormalBlending,
      transparent: true, opacity: isDark ? 0.62 : 0.68, sizeAttenuation: true, depthWrite: false
    });
    const points = new THREE.Points(pGeo, pMat);
    group.add(points);

    let raf = 0, t = 0, running = true, last = 0;
    const still = reduceMotion();

    function resize() {
      const s = size();
      if (!s.w || !s.h) return;
      w = s.w; h = s.h;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      if (still) renderer.render(scene, cam);
    }

    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(host); else window.addEventListener('resize', resize);

    /* 卡片滚出视口后暂停渲染：总览首屏一屏放得下，但用户往下滚时没必要继续算 */
    let io = null;
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(es => {
        es.forEach(e => { if (e.isIntersecting) { if (!running && !still) { running = true; raf = requestAnimationFrame(frame); } } else { running = false; cancelAnimationFrame(raf); } });
      }, { threshold: 0.01 });
      io.observe(host);
    }

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (now && now - last < 41) return;     // 约 24fps，够用且更省电
      last = now || 0;
      t += 0.033;

      group.rotation.y += 0.0016;
      group.rotation.x = Math.sin(t * 0.22) * 0.10;
      shapes.forEach((m, i) => {
        m.rotation.y += m.userData.spin;
        m.rotation.x += m.userData.spin * 0.55;
        m.position.y = m.userData.baseY + Math.sin(t * 0.7 + i * 1.7) * 0.10;
      });
      points.rotation.y -= 0.0005;
      renderer.render(scene, cam);
    }

    if (still) {
      renderer.render(scene, cam);
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!still) { running = true; raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVis);

    return {
      pause() { running = false; cancelAnimationFrame(raf); },
      resume() { if (still || document.hidden || running) return; running = true; raf = requestAnimationFrame(frame); },
      resize,
      dispose() {
        running = false;
        cancelAnimationFrame(raf);
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        shapes.forEach(m => { m.material.dispose(); });
        geoPool.forEach(g => g.dispose());
        pGeo.dispose();
        pMat.dispose();
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
      }
    };
  }

  /* ==========================================================================
     全局背景层：一个 WebGL 上下文服务所有页面

     为什么不是「每页一个画布」：每次切页新建上下文要重编译着色器（实测 +20ms 主线程
     加 GPU 抖动），而上下文数量又有浏览器上限（通常 8~16 个，超出会丢弃最旧的）。
     这里固定只建 1 个，切页时只换几何体与配色，几何体池预建好，切换零编译。
     ========================================================================== */

  /* 每个页面一套「空间语汇」：几何体形状暗示该页的内容形态，配色沿用该页语义色。
     geo 名称对应 GEO_POOL 的键，n 是同时出现的个数。 */
  const VIEW_SCENE = {
    dashboard:    { geo: 'icosa',    n: 3, spread: 4.6, speed: 1.00, light: 0xc7d2fe, dark: 0x818cf8, dots: 190 },
    group:        { geo: 'icosa',    n: 5, spread: 5.6, speed: 1.05, light: 0xc7d2fe, dark: 0x818cf8, dots: 210 },
    flowboard:    { geo: 'torus',    n: 5, spread: 5.4, speed: 0.80, light: 0x99f6e4, dark: 0x2dd4bf, dots: 200 },
    'flow-detail': { geo: 'box',     n: 4, spread: 4.8, speed: 0.72, light: 0x99f6e4, dark: 0x2dd4bf, dots: 165 },
    'group-reports': { geo: 'torus', n: 4, spread: 5.0, speed: 0.72, light: 0x99f6e4, dark: 0x2dd4bf, dots: 180 },
    transactions: { geo: 'box',      n: 5, spread: 5.2, speed: 0.62, light: 0xbae6fd, dark: 0x60a5fa, dots: 170 },
    accounts:     { geo: 'cylinder', n: 4, spread: 4.8, speed: 0.78, light: 0xa7f3d0, dark: 0x34d399, dots: 160 },
    invoices:     { geo: 'plane',    n: 6, spread: 5.6, speed: 0.88, light: 0xfde68a, dark: 0xfbbf24, dots: 175 },
    debts:        { geo: 'tetra',    n: 5, spread: 4.6, speed: 0.84, light: 0xfecaca, dark: 0xf87171, dots: 150 },
    advances:     { geo: 'tetra',    n: 4, spread: 4.2, speed: 0.90, light: 0xddd6fe, dark: 0xa78bfa, dots: 140 },
    projects:     { geo: 'octa',     n: 4, spread: 4.4, speed: 0.86, light: 0xc7d2fe, dark: 0xa5b4fc, dots: 150 },
    reports:      { geo: 'torus',    n: 3, spread: 5.0, speed: 0.68, light: 0x99f6e4, dark: 0x2dd4bf, dots: 165 },
    budgets:      { geo: 'octa',     n: 4, spread: 4.4, speed: 0.94, light: 0xfbcfe8, dark: 0xf472b6, dots: 150 },
    categories:   { geo: 'dodeca',   n: 4, spread: 4.2, speed: 0.74, light: 0xe9d5ff, dark: 0xc084fc, dots: 135 },
    parties:      { geo: 'sphere',   n: 4, spread: 4.4, speed: 0.76, light: 0xbfdbfe, dark: 0x60a5fa, dots: 140 },
    vouchers:     { geo: 'box',      n: 4, spread: 4.6, speed: 0.70, light: 0xd9f99d, dark: 0xa3e635, dots: 130 },
    companies:    { geo: 'cylinder', n: 3, spread: 4.2, speed: 0.66, light: 0xcbd5e1, dark: 0x94a3b8, dots: 125 },
    users:        { geo: 'sphere',   n: 4, spread: 4.2, speed: 0.72, light: 0xbfdbfe, dark: 0x7dd3fc, dots: 130 },
    profile:      { geo: 'sphere',   n: 3, spread: 4.0, speed: 0.70, light: 0xc7d2fe, dark: 0x818cf8, dots: 120 },
    logs:         { geo: 'box',      n: 5, spread: 4.8, speed: 0.58, light: 0xe2e8f0, dark: 0x94a3b8, dots: 120 },
    backup:       { geo: 'dodeca',   n: 3, spread: 4.0, speed: 0.64, light: 0xa7f3d0, dark: 0x34d399, dots: 120 },
    settings:     { geo: 'dodeca',   n: 3, spread: 4.0, speed: 0.60, light: 0xcbd5e1, dark: 0x94a3b8, dots: 115 },
    default:      { geo: 'icosa',    n: 3, spread: 4.4, speed: 0.90, light: 0xc7d2fe, dark: 0x818cf8, dots: 150 }
  };

  /* 几何体池：模块加载时一次性建好，切换页面只换 mesh 引用，不新建 BufferGeometry */
  let GEO_POOL = null;
  function geoPool(THREE) {
    if (GEO_POOL) return GEO_POOL;
    GEO_POOL = {
      icosa:    new THREE.IcosahedronGeometry(1.5, 0),
      box:      new THREE.BoxGeometry(1.7, 1.1, 1.1),
      torus:    new THREE.TorusGeometry(1.15, 0.34, 8, 22),
      octa:     new THREE.OctahedronGeometry(1.35, 0),
      tetra:    new THREE.TetrahedronGeometry(1.5, 0),
      dodeca:   new THREE.DodecahedronGeometry(1.3, 0),
      cylinder: new THREE.CylinderGeometry(0.85, 0.85, 1.7, 12, 1, false),
      plane:    new THREE.PlaneGeometry(1.8, 1.15),
      sphere:   new THREE.SphereGeometry(1.15, 10, 8)
    };
    return GEO_POOL;
  }

  let G = null;          /* 全局层状态 */
  let viewNow = "";

  function createGlobal(canvas) {
    const THREE = window.THREE;
    if (!THREE) return null;
    let renderer;
    try {
      /* 纯装饰层：关抗锯齿、DPR 封顶 1.5（再高看不出差别，但每帧像素翻倍） */
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    } catch (e) { return null; }
    if (!renderer || !renderer.getContext()) return null;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    cam.position.set(0, 0, 12);

    const group = new THREE.Group();
    scene.add(group);

    const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

    /* 粒子场：两层。
       远层密而小、转得慢；近层疏而大、转得快——有远近才有纵深，
       单层粒子在深色主题里读起来是"屏幕上的脏点"，两层才像空间里的尘埃。
       深色下用加色混合：粒子重叠处自然变亮，等同于"发光"而不需要后处理。 */
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const pCount = coarse ? 90 : 190;

    const makeCloud = (count, size, spread, flatten) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = 5 + Math.random() * 7;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th) * spread;
        pos[i * 3 + 1] = r * Math.cos(ph) * flatten;
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) * 0.6 - 3;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({
        size, transparent: true, opacity: 0.55,
        sizeAttenuation: true, depthWrite: false, color: 0xc7d2fe,
        blending: isDark() ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      const pts = new THREE.Points(g, m);
      group.add(pts);
      return { geo: g, mat: m, pts };
    };

    const far = makeCloud(pCount, 0.05, 1.35, 0.7);
    const near = makeCloud(Math.round(pCount * 0.32), 0.085, 0.95, 0.5);
    const points = far.pts, pMat = far.mat;

    let shapes = [];
    const st = {
      renderer, scene, cam, group, points, pMat, pointsNear: near.pts, pMatNear: near.mat,
      running: false, raf: 0, t: 0, last: 0,
      mix: 1,
      mouseX: 0, mouseY: 0, tx: 0, ty: 0,
      still: reduceMotion()
    };

    function applyView(view) {
      const cfg = VIEW_SCENE[view] || VIEW_SCENE.default;
      const dark = isDark();
      const pool = geoPool(THREE);
      const geo = pool[cfg.geo] || pool.icosa;
      /* 浅色主题不用 cfg.light 的浅色，改用 cfg.dark 那一档的饱和色：
         在 #f6f7fb 底上，浅蓝线框对比度不足，用户根本看不出有 3D 层。 */
      const color = dark ? cfg.dark : cfg.dark;

      /* 旧 mesh 的材质逐个释放，几何体来自池，不释放 */
      shapes.forEach(m => { group.remove(m); m.material.dispose(); });
      shapes = [];
      const n = coarse ? Math.max(2, cfg.n - 1) : cfg.n;
      for (let i = 0; i < n; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color, wireframe: true, transparent: true,
          /* 浅色主题反而要给更高不透明度：浅底 + 浅蓝线框的对比度天然更低，
             同样的数值在深色主题上很清楚，在浅色主题上会「看不见」。
             深色主题从 .16 提到 .26：v5.4 的深色动效"几乎不动"的主因就在这里。 */
          opacity: (dark ? 0.26 : 0.32) + (i % 3) * (dark ? 0.055 : 0.07)
        });
        const m = new THREE.Mesh(geo, mat);
        const spread = cfg.spread || 4.4;
        m.position.set(
          (i - (n - 1) / 2) * (spread / Math.max(n - 1, 1)) * 1.1,
          ((i % 2) ? 1 : -1) * (0.9 + i * 0.22),
          -2.4 - (i % 3) * 1.6
        );
        m.userData.spin = (0.0011 + (i % 3) * 0.0006) * (cfg.speed || 1);
        m.userData.baseY = m.position.y;
        m.userData.phase = i * 1.7;
        m.scale.setScalar(0.92 + (i % 3) * 0.16);
        group.add(m);
        shapes.push(m);
      }
      pMat.color.setHex(dark ? cfg.dark : cfg.light);
      pMat.opacity = dark ? 0.52 : 0.62;
      st.pMatNear.color.setHex(dark ? cfg.dark : cfg.light);
      st.pMatNear.opacity = dark ? 0.34 : 0.40;
      st.mix = 0;
    }

    function frame(now) {
      if (!st.running) return;
      st.raf = requestAnimationFrame(frame);
      if (now && now - st.last < 41) return;
      st.last = now || 0;
      st.t += 0.033;

      if (st.mix < 1) st.mix = Math.min(1, st.mix + 0.045);
      const m = st.mix;

      /* 指针视差：0.16 / 0.11 的强度刚好能在余光里感觉到"场景在跟着我动"，
         再大就会和内容区的滚动打架（会晕）。 */
      st.tx += (st.mouseX * 0.16 - st.tx) * 0.06;
      st.ty += (st.mouseY * 0.11 - st.ty) * 0.06;
      group.rotation.y = st.t * 0.045 + st.tx;
      group.rotation.x = Math.sin(st.t * 0.18) * 0.05 + st.ty;

      shapes.forEach((sh, i) => {
        sh.rotation.y += sh.userData.spin;
        sh.rotation.x += sh.userData.spin * 0.5;
        sh.position.y = sh.userData.baseY + Math.sin(st.t * 0.55 + sh.userData.phase) * 0.16;
        const baseOp = (isDark() ? 0.26 : 0.32) + (i % 3) * (isDark() ? 0.055 : 0.07);
        sh.material.opacity = sh.material.opacity * 0.9 + baseOp * m * 0.1;
      });
      points.rotation.y = -st.t * 0.016;
      st.pointsNear.rotation.y = st.t * 0.026;
      st.pointsNear.rotation.x = Math.sin(st.t * 0.3) * 0.06;
      pMat.opacity = (isDark() ? 0.52 : 0.62) * m;
      st.pMatNear.opacity = (isDark() ? 0.34 : 0.40) * m;
      group.scale.setScalar(0.98 + m * 0.02);

      renderer.render(scene, cam);
    }

    function resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      if (st.still) renderer.render(scene, cam);
    }

    if (!coarse) {
      window.addEventListener('pointermove', e => {
        st.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        st.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
      }, { passive: true });
    }

    window.addEventListener('resize', resize);
    const onVis = () => {
      if (document.hidden) { st.running = false; cancelAnimationFrame(st.raf); }
      else if (!st.still) { st.running = true; st.raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVis);

    resize();
    applyView("default");
    if (st.still) renderer.render(scene, cam);
    else { st.running = true; st.raf = requestAnimationFrame(frame); }

    return {
      applyView, resize,
      pause() { st.running = false; cancelAnimationFrame(st.raf); },
      resume() { if (st.still || document.hidden || st.running) return; st.running = true; st.raf = requestAnimationFrame(frame); },
      dispose() {
        st.running = false;
        cancelAnimationFrame(st.raf);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('resize', resize);
        shapes.forEach(m => m.material.dispose());
        far.geo.dispose(); far.mat.dispose();
        near.geo.dispose(); near.mat.dispose();
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
      }
    };
  }

  /* 挂全局层：只在骨架重建后调一次，之后只 setView */
  function mountGlobal(root) {
    if (perfLow() || reduceMotion()) {
      if (G) { try { G.dispose(); } catch (e) {} G = null; viewNow = ""; }
      return;
    }
    /* 全局画布在 .main 里，不在 renderView 的 root（#view-root）子树内，
       必须从 document 里找，否则永远查不到、场景建不起来。 */
    let canvas = document.querySelector('canvas[data-scene-global]');
    if (!canvas) return;
    if (G) return;
    /* 关键：dispose() 会 forceContextLoss()，而浏览器不允许对同一个 canvas 重建 WebGL 上下文。
       如果这块 canvas 已经用过（切换主题 / 切换性能档位会 reset 再重建），必须先换一块新的，
       否则 createGlobal 拿到的是个废 canvas，表现为「切完主题 3D 层就没了」。 */
    if (canvas.dataset.used === '1') {
      const fresh = document.createElement('canvas');
      fresh.className = canvas.className;
      fresh.setAttribute('data-scene-global', '');
      fresh.setAttribute('aria-hidden', 'true');
      if (canvas.parentNode) canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
    }
    canvas.dataset.used = '1';
    G = createGlobal(canvas);
    if (G) {
      G.applyView(viewNow || "default");
      document.documentElement.setAttribute('data-scene-ready', '1');
    }
  }

  function setView(view) {
    viewNow = view || "default";
    if (!G) return;
    try { G.applyView(viewNow); } catch (e) {}
  }

  /* ------------------------------ 对外接口 ------------------------------ */

  /* 流畅模式下完全不建 WebGL 上下文 */
  const perfLow = () => document.documentElement.getAttribute('data-perf') === 'low';

  /* 画布缓存：每次 renderView 都会重建 innerHTML，如果每次都新建 WebGL 上下文，
     等于每切一次页面就重新编译一遍着色器（实测每次多 20ms 主线程 + GPU 侧抖动）。
     这里把 canvas 元素与场景一起缓存，重新渲染后直接把旧 canvas 塞回新占位符。 */
  const cache = new Map();     /* key -> { canvas, ctrl } */

  const OPTS = {
    hero: { shapes: 2, particles: 56, z: 6.4, offsetX: 2.6, offsetY: -0.15, spread: 1.9, color: 0xc7d2fe, dotColor: 0xffffff, dotSize: 0.05 },
    other: { shapes: 3, particles: 180, z: 7.2, offsetX: 1.5, spread: 1.55, color: 0xc7d2fe, dotColor: 0xe0e7ff, dotSize: 0.042 }
  };

  function pauseScenes() { cache.forEach(v => { try { v.ctrl.pause(); } catch (e) {} }); }
  function resumeScenes() { cache.forEach(v => { try { v.ctrl.resume(); } catch (e) {} }); }

  function disposeScenes() {
    cache.forEach(v => { try { v.ctrl.dispose(); } catch (e) {} });
    cache.clear();
  }

  function mountScenes(root) {
    if (!window.THREE) return;
    if (perfLow() || reduceMotion()) { disposeScenes(); return; }

    const doc = root || document;
    doc.querySelectorAll('canvas[data-scene]').forEach(ph => {
      const key = ph.dataset.scene;
      const hit = cache.get(key);

      /* 命中缓存且旧 canvas 已经脱离文档 → 直接换进来，不重建上下文 */
      if (hit && !hit.canvas.isConnected && ph.parentElement) {
        ph.parentElement.replaceChild(hit.canvas, ph);
        try { hit.ctrl.resize(); hit.ctrl.resume(); } catch (e) {}
        return;
      }
      if (hit && hit.canvas.isConnected) return;      /* 已经在位 */
      if (hit) { try { hit.ctrl.dispose(); } catch (e) {} cache.delete(key); }

      const s = createAmbient(ph, key === 'hero' ? OPTS.hero : OPTS.other);
      if (s) cache.set(key, { canvas: ph, ctrl: s });
    });

    /* 清理本轮没被复用的场景。
       hero 例外：总览是回访最频繁的页面，保留它的上下文可以避免来回切页时
       反复重建（重建要重编译着色器，肉眼就是「卡一下」）。只有显式 dispose/reset 才释放。 */
    Array.from(cache.keys()).forEach(k => {
      if (k === 'hero') return;
      const v = cache.get(k);
      if (!v.canvas.isConnected) {
        try { v.ctrl.dispose(); } catch (e) {}
        cache.delete(k);
      }
    });
  }

  window.Scene3D = {
    pauseScenes, resumeScenes,
    mount(root) { mountGlobal(root); mountScenes(root); },
    setView,
    dispose() { disposeScenes(); if (G) { try { G.dispose(); } catch (e) {} G = null; } document.documentElement.removeAttribute('data-scene-ready'); },
    pauseGlobal() { if (G) { try { G.pause(); } catch (e) {} } },
    resumeGlobal() { if (G) { try { G.resume(); } catch (e) {} } },
    available: () => !!window.THREE && !perfLow(),
    /* 供设置页切换性能模式后调用：先全部释放，下次 mount 会按新档位决定是否重建 */
    reset() { disposeScenes(); if (G) { try { G.dispose(); } catch (e) {} G = null; } document.documentElement.removeAttribute('data-scene-ready'); },
    views: Object.keys(VIEW_SCENE)
  };
})();
