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
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (e) {
      return null;                       // 无 WebGL → 保持 CSS 渐变
    }
    if (!renderer || !renderer.getContext()) return null;

    const size = () => ({ w: host.clientWidth || 320, h: host.clientHeight || 180 });
    let { w, h } = size();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 100);
    cam.position.z = opts.z || 7.2;

    const group = new THREE.Group();
    if (opts.offsetX) group.position.x = opts.offsetX;
    if (opts.offsetY) group.position.y = opts.offsetY;
    scene.add(group);

    const color = opts.color || 0xc7d2fe;
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
        opacity: 0.18 + i * 0.07
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
      color: opts.dotColor || 0xe0e7ff, size: opts.dotSize || 0.042,
      transparent: true, opacity: 0.68, sizeAttenuation: true, depthWrite: false
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

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (now && now - last < 32) return;     // 约 30fps，省电
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
      dispose() {
        running = false;
        cancelAnimationFrame(raf);
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

  function pauseScenes() { scenes.forEach(s => { try { s.pause(); } catch (e) {} }); }
  function resumeScenes() { scenes.forEach(s => { try { s.resume(); } catch (e) {} }); }

  function disposeScenes() {
    while (scenes.length) {
      const s = scenes.pop();
      try { s.dispose(); } catch (e) { /* 忽略 */ }
    }
  }

  function mountScenes(root) {
    if (!window.THREE) return;
    (root || document).querySelectorAll('canvas[data-scene]').forEach(canvas => {
      const kind = canvas.dataset.scene;
      const isHero = kind === 'hero';
      const s = createAmbient(canvas, isHero
        ? { shapes: 2, particles: 80, z: 6.4, offsetX: 2.6, offsetY: -0.15, spread: 1.9, color: 0xc7d2fe, dotColor: 0xffffff, dotSize: 0.05 }
        : { shapes: 3, particles: 300, z: 7.2, offsetX: 1.5, spread: 1.55, color: 0xc7d2fe, dotColor: 0xe0e7ff, dotSize: 0.042 });
      if (s) scenes.push(s);
    });
  }

  window.Scene3D = {
    pauseScenes, resumeScenes, mount: mountScenes, dispose: disposeScenes, available: () => !!window.THREE };
})();
