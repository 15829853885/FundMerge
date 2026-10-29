/* ============================================================================
   合资金账 · 3D 氛围层（three.js）
   仅用于装饰性背景：登录页品牌区、总览主指标卡。
   数据可视化仍用 2D SVG —— 3D 透视会扭曲数字比较，影响读数。
   无 WebGL / 不支持时静默降级为 CSS 渐变背景。
   ========================================================================== */

'use strict';

(function () {
  const scenes = [];
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
        opacity: (0.18 + i * 0.07) * (isDark ? 0.7 : 1)
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
      transparent: true, opacity: isDark ? 0.45 : 0.68, sizeAttenuation: true, depthWrite: false
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
    pauseScenes, resumeScenes, mount: mountScenes, dispose: disposeScenes,
    available: () => !!window.THREE && !perfLow(),
    /* 供设置页切换性能模式后调用：先全部释放，下次 mount 会按新档位决定是否重建 */
    reset() { disposeScenes(); }
  };
})();
