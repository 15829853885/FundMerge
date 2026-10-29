'use strict';

/**
 * 合资金账 — Electron 主进程
 * 数据以 JSON 文件形式保存在 %APPDATA%\FundLedger\data.json
 * 所有读写走主进程，渲染进程不直接接触文件系统。
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } = require('electron');
const backup = require('./backup');
const flpack = require('./flpack');
const path = require('path');
const fs = require('fs');

/* 固定数据目录为 ASCII 路径，避免中文路径带来的编码问题
   （测试或便携场景可用环境变量 FUNDLEDGER_DATA_DIR 指定） */
app.setPath('userData', path.join(app.getPath('appData'), 'FundLedger'));

/* 硬件加速默认开启；若上次启动在窗口出现前就崩了（多见于虚拟机/远程桌面/坏驱动），
   本次自动降级为软件渲染，避免启动即退出。 */
const GPU_FLAG = path.join(app.getPath('userData'), 'gpu-fallback.flag');
let softwareRender = false;
try {
  if (!fs.existsSync(app.getPath('userData'))) fs.mkdirSync(app.getPath('userData'), { recursive: true });
  if (fs.existsSync(GPU_FLAG)) { softwareRender = true; fs.unlinkSync(GPU_FLAG); }
  fs.writeFileSync(GPU_FLAG, String(Date.now()));
} catch (e) { /* 忽略 */ }

if (softwareRender) {
  app.disableHardwareAcceleration();
  console.warn('[合资金账] 上次启动异常，本次使用软件渲染');
}

/* 数据目录：默认放在软件目录下的 data 子文件夹（可随程序一起放进网盘同步），
   安装目录不可写时回退到「文档\资金台账」。
   也可用 data-location.txt 指定任意目录（例如网盘同步文件夹），或用环境变量覆盖。 */
const APP_DIR = app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..');
const LEGACY_DIR = path.join(app.getPath('documents'), '资金台账');

/* 数据目录切换的显式同意记录：存在此文件才允许回落到文档目录，
   避免「安装目录不可写」时静默把账本换到第二个位置。 */
const CONSENT_FILE = () => path.join(app.getPath('userData'), 'data-dir-consent.json');

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

function resolveDataDir() {
  if (process.env.FUNDLEDGER_DATA_DIR) return process.env.FUNDLEDGER_DATA_DIR;
  try {
    const cfg = path.join(APP_DIR, 'data-location.txt');
    if (fs.existsSync(cfg)) {
      const custom = fs.readFileSync(cfg, 'utf8').trim();
      if (custom && canWrite(custom)) return custom;
    }
  } catch (e) { /* 忽略 */ }
  const local = path.join(APP_DIR, 'data');
  if (canWrite(local)) return local;
  return LEGACY_DIR;
}


/* 升级中断恢复：安装器在「数据已移出、尚未移回」的间隙被强杀时，
   $TEMP 里会留下 fm-keep-data + fm-moving.flag。启动时自动搬回，避免静默新建空账本。 */
function recoverInterruptedUpgrade(dir) {
  try {
    const os = require('os');
    const flag = path.join(os.tmpdir(), 'fm-moving.flag');
    const keep = path.join(os.tmpdir(), 'fm-keep-data');
    if (!fs.existsSync(flag) || !fs.existsSync(keep)) return false;
    const target = path.join(dir, 'data');
    const hasData = fs.existsSync(path.join(target, 'data.json'));
    if (hasData) { try { fs.unlinkSync(flag); } catch (e) {} return false; }
    fs.mkdirSync(target, { recursive: true });
    const walk = (src, dst) => {
      fs.readdirSync(src, { withFileTypes: true }).forEach(e => {
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); walk(s, d); }
        else fs.copyFileSync(s, d);
      });
    };
    walk(keep, target);
    fs.unlinkSync(flag);
    console.log('[合资金账] 已从中断的升级中恢复账本 ->', target);
    return true;
  } catch (e) {
    console.error('[合资金账] 升级恢复失败', e);
    return false;
  }
}

const DATA_DIR = resolveDataDir();
recoverInterruptedUpgrade(DATA_DIR);
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'data.bak.json');
const WINDOW_FILE = path.join(app.getPath('userData'), 'window.json');

/* 旧版本把数据放在「文档\资金台账」，首次升级时自动搬过来 */
function migrateLegacy() {
  try {
    if (path.resolve(LEGACY_DIR) === path.resolve(DATA_DIR)) return;
    if (fs.existsSync(DATA_FILE)) return;
    if (!fs.existsSync(path.join(LEGACY_DIR, 'data.json'))) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(path.join(LEGACY_DIR, 'data.json'), DATA_FILE);
    const legacyFiles = path.join(LEGACY_DIR, 'files');
    if (fs.existsSync(legacyFiles)) {
      fs.cpSync(legacyFiles, path.join(DATA_DIR, 'files'), { recursive: true });
    }
    console.log('[合资金账] 已迁移旧数据到', DATA_DIR);
  } catch (e) {
    console.error('[合资金账] 旧数据迁移失败', e);
  }
}

migrateLegacy();

let mainWindow = null;
let tray = null;
let forceQuit = false;
let closeAskEnabled = true;   // 渲染层可关闭（记住「不再询问」）

/* ------------------------------- 文件读写 ------------------------------- */

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (e) {
    return null;
  }
}

/* 原子写入：先写临时文件再替换，避免断电/崩溃导致账本损坏 */
function writeAtomic(file, content) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function loadData() {
  const main = readJSON(DATA_FILE);
  if (main) {
    try { lastWrittenRaw = fs.readFileSync(DATA_FILE, 'utf8'); } catch (e) { lastWrittenRaw = null; }
    return main;
  }
  const bak = readJSON(BACKUP_FILE);
  if (bak) return bak;
  return null;
}

/* 上次写入的内容，用来判断文件是否被外部（网盘同步/另一台设备）改动 */
let lastWrittenRaw = null;

function saveData(data) {
  ensureDir();

  /* 外部改动检测：磁盘内容与我们上次写入的不一致 → 保留一份冲突副本，再覆盖 */
  let conflict = false, conflictCopy = '';
  try {
    if (lastWrittenRaw !== null && fs.existsSync(DATA_FILE)) {
      const current = fs.readFileSync(DATA_FILE, 'utf8');
      if (current !== lastWrittenRaw) {
        conflict = true;
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        conflictCopy = path.join(DATA_DIR, 'data.conflict-' + stamp + '.json');
        writeAtomic(conflictCopy, current);
      }
    }
  } catch (e) { /* 忽略 */ }

  // 保留上一版作为兜底
  try {
    if (fs.existsSync(DATA_FILE)) {
      const prev = fs.readFileSync(DATA_FILE, 'utf8');
      if (prev.trim()) writeAtomic(BACKUP_FILE, prev);
    }
  } catch (e) { /* 备份失败不影响主流程 */ }

  const content = JSON.stringify(data, null, 2);
  writeAtomic(DATA_FILE, content);
  lastWrittenRaw = content;
  return { ok: true, path: DATA_FILE, conflict, conflictCopy };
}

/* ------------------------------- 窗口状态 ------------------------------- */

function loadWindowState() {
  const s = readJSON(WINDOW_FILE);
  const def = { width: 1380, height: 900 };
  if (!s || !s.width || !s.height) return def;
  return {
    width: Math.max(1080, Math.min(s.width, 2600)),
    height: Math.max(720, Math.min(s.height, 1600)),
    x: Number.isInteger(s.x) ? s.x : undefined,
    y: Number.isInteger(s.y) ? s.y : undefined,
    maximized: !!s.maximized
  };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    writeAtomic(WINDOW_FILE, JSON.stringify({
      x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized()
    }));
  } catch (e) { /* 忽略 */ }
}

/* ------------------------------- 创建窗口 ------------------------------- */

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: '合资金账 FundMerge',
    backgroundColor: '#f4f6fa',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,   /* 隐藏「文件/编辑/视图/帮助」菜单栏；快捷键（Ctrl+N/S/O、缩放）仍然有效，按 Alt 可临时唤出 */
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  /* 双保险：部分 Windows 环境下 autoHideMenuBar 会在首次显示时闪一下菜单栏，
     显式再隐藏一次，保证首帧就没有那条 25px 的横条 */
  if (mainWindow.setMenuBarVisibility) mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    /* 窗口成功显示 → 本次渲染正常，清掉崩溃标记 */
    try { fs.unlinkSync(GPU_FLAG); } catch (e) { /* 忽略 */ }
    if (state.maximized) mainWindow.maximize();
    mainWindow.show();
  });

  /* 外部链接交给系统浏览器，禁止应用内跳转 */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  let allowExit = false;
  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
    allowExit = true;
  });
  mainWindow.on('close', e => {
    if (forceQuit) return;
    if (!closeAskEnabled) {
      e.preventDefault();
      ensureTray();
      mainWindow.hide();
      return;
    }
    e.preventDefault();
    /* 先让窗口回到前台并等一帧，避免关闭动画与弹窗同时进行造成卡顿 */
    try { mainWindow.show(); mainWindow.focus(); } catch (err) { /* 忽略 */ }
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('menu:action', 'confirm-close');
      }
    }, 80);
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  /* 阻止拖拽文件到窗口导致页面跳走 */
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
}

/* ------------------------------- 应用菜单 ------------------------------- */

function buildMenu() {
  const send = action => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', action);
  };

  const template = [
    {
      label: '文件',
      submenu: [
        { label: '记一笔', accelerator: 'CmdOrCtrl+N', click: () => send('new-tx') },
        { type: 'separator' },
        { label: '备份数据（JSON）…', accelerator: 'CmdOrCtrl+S', click: () => send('export-json') },
        { label: '从备份恢复…', accelerator: 'CmdOrCtrl+O', click: () => send('import-json') },
        { type: 'separator' },
        { label: '打开数据文件夹', click: () => { ensureDir(); shell.openPath(DATA_DIR); } },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { label: '开发者工具', role: 'toggleDevTools' }])
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用手册', click: () => { const p = path.join(APP_DIR, '操作手册.html'); if (fs.existsSync(p)) shell.openPath(p); } },
        { type: 'separator' },
        {
          label: '关于合资金账',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: '合资金账 ' + app.getVersion(),
              detail:
                '公司现金与银行账户资金流水管理\n\n' +
                '数据文件：\n' + DATA_FILE + '\n\n' +
                '所有数据仅保存在本机，不联网、不上传。',
              buttons: ['确定'],
              noLink: true
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------- IPC 接口 ------------------------------- */

ipcMain.handle('store:load', () => loadData());

ipcMain.handle('store:save', (_e, data) => {
  try {
    if (!data || typeof data !== 'object') return { ok: false, error: '数据格式不正确' };
    return saveData(data);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('store:info', () => ({
  dataFile: DATA_FILE,
  dataDir: DATA_DIR,
  filesDir: FILES_DIR,
  version: app.getVersion(),
  electron: process.versions.electron,
  packaged: app.isPackaged
}));

ipcMain.handle('store:reveal', () => {
  ensureDir();
  if (fs.existsSync(DATA_FILE)) shell.showItemInFolder(DATA_FILE);
  else shell.openPath(DATA_DIR);
  return { ok: true };
});

ipcMain.handle('dialog:save-file', async (_e, opts) => {
  try {
    const { defaultName = '导出.csv', content = '', filters } = opts || {};
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: filters || [{ name: '所有文件', extensions: ['*'] }],
      buttonLabel: '保存'
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, content, 'utf8');
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:open-json', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      properties: ['openFile'],
      filters: [{ name: '备份文件', extensions: ['json'] }],
      buttonLabel: '打开'
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    const file = res.filePaths[0];
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    return { ok: true, data, path: file };
  } catch (err) {
    return { ok: false, error: '文件无法解析：' + err.message };
  }
});

ipcMain.handle('app:open-data-folder', () => {
  ensureDir();
  shell.openPath(DATA_DIR);
  return { ok: true };
});

/* 显卡合成状态：渲染层据此自动决定是否进入「流畅模式」。
   软件合成（虚拟机 / 远程桌面 / 坏驱动）下，CSS 动画与滤镜会明显掉帧。 */
ipcMain.handle('sys:gpu', () => {
  try {
    const st = app.getGPUFeatureStatus() || {};
    const compositing = String(st.gpu_compositing || '');
    return {
      ok: true,
      compositing,
      hardware: compositing.indexOf('disabled') !== -1 ? false : true,
      rasterization: String(st.rasterization || ''),
      webgl: String(st.webgl || ''),
      softwareRender
    };
  } catch (e) {
    return { ok: false, hardware: true, error: String(e && e.message || e) };
  }
});

ipcMain.handle('app:open-manual', async () => {
  const candidates = [
    path.join(APP_DIR, '操作手册.html'),
    path.join(__dirname, '..', 'assets', 'manual.html')
  ];
  const p = candidates.find(x => { try { return fs.existsSync(x); } catch (e) { return false; } });
  if (!p) return { ok: false, error: '手册文件不存在' };
  const err = await shell.openPath(p);
  return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('app:open-files-folder', () => {
  const dir = path.join(DATA_DIR, 'files');
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { ok: true };
});

/* ------------------------------ 公司档案文件 ------------------------------ */

const FILES_DIR = path.join(DATA_DIR, 'files');
const safeSeg = v => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '');
const safeExt = v => String(v || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
const safeName = v => String(v || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
const pad2 = n => String(n).padStart(2, '0');

/* 相对路径 → 绝对路径，并阻止越权访问数据目录之外的文件 */
function absOf(rel) {
  const root = path.resolve(DATA_DIR);
  const abs = path.resolve(root, String(rel || ''));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

const toRel = abs => path.relative(DATA_DIR, abs).split(path.sep).join('/');

ipcMain.handle('file:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择要归档的资料',
    buttonLabel: '选择',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '文档与图片', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return { ok: true, canceled: true, files: [] };
  const files = res.filePaths.map(p => {
    let size = 0, mtime = '';
    try { const st = fs.statSync(p); size = st.size; mtime = st.mtime.toISOString(); } catch (e) { /* 忽略 */ }
    return { path: p, name: path.basename(p), size, mtime };
  });
  return { ok: true, files };
});

/* 导入：按 公司/年-月/时间戳_名称.ext 归档，返回相对路径 */
ipcMain.handle('file:import', async (_e, payload) => {
  try {
    const co = safeSeg(payload.companyId);
    if (!co) return { ok: false, error: '参数不正确' };
    const now = new Date();
    const ym = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    const ts = '' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate())
      + '-' + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
    const ext = safeExt(payload.ext);
    const base = ts + '_' + (safeName(payload.name) || safeSeg(payload.id) || 'file');
    const relDir = path.posix.join('files', co, ym);
    const absDir = path.join(DATA_DIR, relDir);
    fs.mkdirSync(absDir, { recursive: true });

    let fileName = base + (ext ? '.' + ext : '');
    let abs = path.join(absDir, fileName);
    let i = 1;
    while (fs.existsSync(abs)) {
      fileName = base + '_' + (i++) + (ext ? '.' + ext : '');
      abs = path.join(absDir, fileName);
    }
    fs.copyFileSync(payload.srcPath, abs);
    const st = fs.statSync(abs);
    return { ok: true, size: st.size, mtime: st.mtime.toISOString(), relPath: toRel(abs) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:stats', (_e, rels) => {
  return (Array.isArray(rels) ? rels : []).map(rel => {
    const abs = absOf(rel);
    if (!abs || !fs.existsSync(abs)) return { relPath: rel, exists: false };
    try {
      const st = fs.statSync(abs);
      return { relPath: rel, exists: true, size: st.size, mtime: st.mtime.toISOString() };
    } catch (e) {
      return { relPath: rel, exists: false };
    }
  });
});

ipcMain.handle('file:rename', (_e, payload) => {
  try {
    const abs = absOf(payload.relPath);
    if (!abs || !fs.existsSync(abs)) return { ok: false, error: '文件不存在' };
    const dir = path.dirname(abs);
    const ext = path.extname(abs);
    const m = path.basename(abs).match(/^(\d{8}-\d{6})_/);
    const prefix = m ? m[1] + '_' : '';
    const target = path.join(dir, prefix + (safeName(payload.name) || 'file') + ext);
    if (path.resolve(target) === path.resolve(abs)) return { ok: true, relPath: payload.relPath };
    if (fs.existsSync(target)) return { ok: false, error: '同目录下已有同名文件' };
    fs.renameSync(abs, target);
    return { ok: true, relPath: toRel(target) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:open', async (_e, payload) => {
  const abs = absOf(payload.relPath);
  if (!abs || !fs.existsSync(abs)) return { ok: false, error: '文件不存在或已被移动' };
  const err = await shell.openPath(abs);
  return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('file:reveal', async (_e, payload) => {
  const abs = absOf(payload.relPath);
  if (!abs || !fs.existsSync(abs)) return { ok: false, error: '文件不存在' };
  shell.showItemInFolder(abs);
  return { ok: true };
});

ipcMain.handle('file:remove', async (_e, payload) => {
  try {
    const abs = absOf(payload.relPath);
    if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:read', async (_e, payload) => {
  try {
    const abs = absOf(payload.relPath);
    if (!abs || !fs.existsSync(abs)) return { ok: false, error: '文件不存在' };
    const buf = fs.readFileSync(abs);
    if (buf.length > 12 * 1024 * 1024) return { ok: false, error: '文件超过 12MB，请直接打开查看' };
    const mime = {
      pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp'
    }[safeExt(payload.ext || path.extname(abs)).toLowerCase()] || 'application/octet-stream';
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:remove-company', async (_e, companyId) => {
  try {
    const co = safeSeg(companyId);
    if (!co) return { ok: false, error: '参数不正确' };
    const dir = path.join(FILES_DIR, co);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app:open-company-folder', (_e, companyId) => {
  const co = safeSeg(companyId);
  if (!co) return { ok: false, error: '参数不正确' };
  const dir = path.join(FILES_DIR, co);
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { ok: true };
});

/* 切换数据目录（用于指向网盘同步文件夹） */
ipcMain.handle('app:set-data-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择数据目录（可指向网盘同步文件夹）',
    buttonLabel: '使用此文件夹',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const target = res.filePaths[0];
  try {
    if (!canWrite(target)) return { ok: false, error: '该文件夹不可写' };
    const nextFile = path.join(target, 'data.json');
    if (!fs.existsSync(nextFile) && fs.existsSync(DATA_FILE)) {
      fs.copyFileSync(DATA_FILE, nextFile);
      if (fs.existsSync(FILES_DIR)) fs.cpSync(FILES_DIR, path.join(target, 'files'), { recursive: true });
    }
    fs.writeFileSync(path.join(APP_DIR, 'data-location.txt'), target, 'utf8');
    return { ok: true, dir: target };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ------------------------------ 关闭与后台 ------------------------------ */

function trayIcon() {
  const candidates = [
    path.join(APP_DIR, 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.png')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return nativeImage.createFromPath(p); } catch (e) { /* 忽略 */ }
  }
  return nativeImage.createEmpty();
}

function ensureTray() {
  if (tray) return tray;
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('合资金账 FundMerge（后台运行中）');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主界面', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: '退出合资金账', click: () => { forceQuit = true; app.quit(); } }
    ]));
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    });
  } catch (e) {
    console.error('[合资金账] 托盘创建失败', e);
  }
  return tray;
}

ipcMain.handle('app:close-action', (_e, action) => {
  if (action === 'quit') {
    forceQuit = true;
    app.quit();
    return { ok: true };
  }
  if (action === 'background') {
    ensureTray();
    if (mainWindow) mainWindow.hide();
    return { ok: true };
  }
  if (action === 'never-ask') {
    closeAskEnabled = false;
    ensureTray();
    if (mainWindow) mainWindow.hide();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('app:close-ask-enabled', () => closeAskEnabled);


/* ------------------------------ 账套包 ------------------------------ */

const AUTO_DIR = () => path.join(app.getPath('userData'), 'autobackup');
const AUTO_INTERVAL_DAYS = 3;
const AUTO_KEEP = 3;

function autoBackup() {
  try {
    const dir = AUTO_DIR();
    fs.mkdirSync(dir, { recursive: true });
    const packs = fs.readdirSync(dir).filter(f => f.endsWith('.flpack')).sort();
    const newest = packs.length ? fs.statSync(path.join(dir, packs[packs.length - 1])).mtimeMs : 0;
    const ageDays = (Date.now() - newest) / 86400000;
    if (newest && ageDays < AUTO_INTERVAL_DAYS) {
      return { created: false, reason: '距上次备份 ' + ageDays.toFixed(1) + ' 天，未到 3 天' };
    }
    const r = flpack.pack({ dataDir: DATA_DIR, opts: { includeLogs: false, includeCloud: false, version: app.getVersion() } });
    const name = 'auto-' + new Date().toISOString().replace(/[:.]/g, '-') + '.flpack';
    fs.writeFileSync(path.join(dir, name), r.buffer);
    /* 只保留最新 3 份 */
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.flpack')).sort();
    all.slice(0, Math.max(0, all.length - AUTO_KEEP)).forEach(f => {
      try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* 忽略 */ }
    });
    console.log('[合资金账] 自动账套备份完成', name, r.buffer.length, 'bytes');
    return { created: true, name, size: r.buffer.length };
  } catch (e) {
    console.error('[合资金账] 自动账套备份失败', e);
    return { created: false, error: String(e.message || e) };
  }
}

ipcMain.handle('flpack:export', async (_e, opts) => {
  try {
    const r = flpack.pack({ dataDir: DATA_DIR, opts: opts || {} });
    if (opts && opts.companyIds && !opts.companyIds.length) delete opts.companyIds;
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const res = await dialog.showSaveDialog(win, {
      title: '导出账套',
      defaultPath: (opts && opts.fileName) || ('账套_' + new Date().toISOString().slice(0, 10) + '.flpack'),
      filters: [{ name: '账套包', extensions: ['flpack'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, r.buffer);
    return { ok: true, path: res.filePath, size: r.buffer.length, manifest: r.manifest };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('flpack:inspect', async (_e, payload) => {
  try {
    let filePath = payload && payload.path;
    if (!filePath) {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const res = await dialog.showOpenDialog(win, {
        title: '选择账套包',
        properties: ['openFile'],
        filters: [{ name: '账套包', extensions: ['flpack', 'zip'] }]
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
      filePath = res.filePaths[0];
    }
    const buf = fs.readFileSync(filePath);
    const enc = flpack.isEncrypted(buf);
    if (enc) {
      if (!payload || !payload.password) return { ok: true, needPassword: true, path: filePath };
    }
    const r = flpack.unpack(buf, payload && payload.password);
    return { ok: true, path: filePath, needPassword: false, manifest: r.manifest, checksumOk: r.checksumOk, size: buf.length };
  } catch (e) {
    return { ok: false, error: String(e.message || e), needPassword: !!e.needPassword };
  }
});

ipcMain.handle('flpack:import', async (_e, payload) => {
  try {
    const buf = fs.readFileSync(payload.path);
    const r = flpack.unpack(buf, payload.password);
    if (!r.checksumOk) return { ok: false, error: '账套包校验和不一致，文件可能已损坏' };
    const out = flpack.applyImport(DATA_DIR, r, {
      mode: payload.mode === 'new' ? 'new' : 'overwrite',
      restoreLogs: !!payload.restoreLogs,
      restoreCloud: !!payload.restoreCloud
    });
    return { ok: true, companies: out.companies, files: out.files, manifest: r.manifest };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('flpack:auto-status', () => {
  try {
    const dir = AUTO_DIR();
    if (!fs.existsSync(dir)) return { count: 0, newest: '', files: [] };
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.flpack')).sort().reverse();
    return {
      count: files.length,
      newest: files[0] || '',
      newestAt: files[0] ? fs.statSync(path.join(dir, files[0])).mtime.toISOString() : '',
      files: files.map(f => ({ name: f, size: fs.statSync(path.join(dir, f)).size }))
    };
  } catch (e) { return { count: 0, files: [], error: String(e.message || e) }; }
});

ipcMain.handle('flpack:auto-run', () => autoBackup());
ipcMain.handle('flpack:open-folder', () => {
  try { fs.mkdirSync(AUTO_DIR(), { recursive: true }); shell.openPath(AUTO_DIR()); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

/* ------------------------------ 云盘备份 ------------------------------ */

ipcMain.handle('backup:config', () => backup.publicConfig());

ipcMain.handle('backup:save', (_e, cfg) => {
  backup.writeConfig(cfg);
  backup.startScheduler(DATA_DIR, entry => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup:done', entry);
  });
  return backup.publicConfig();
});

ipcMain.handle('backup:run', async (_e, type) => {
  try {
    const groupName = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8')).meta.groupName || '集团'; }
      catch (err) { return '集团'; }
    })();
    const r = await backup.runBackup(DATA_DIR, type === 'auto' ? 'auto' : 'manual', { groupName });
    return { ok: true, version: r.version, removed: r.removed, total: r.total };
  } catch (e) {
    backup.recordFail(e);
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('backup:versions', () => backup.listVersions());

ipcMain.handle('backup:delete-version', async (_e, no) => {
  try { return { ok: true, ...(await backup.deleteVersion(no)) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('backup:download-version', async (_e, no) => {
  try {
    const r = await backup.downloadVersion(no);
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const res = await dialog.showSaveDialog(win, {
      title: '下载账套包',
      defaultPath: r.version.name,
      filters: [{ name: '账套包', extensions: ['flpack'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, r.buffer);
    return { ok: true, path: res.filePath, size: r.buffer.length, version: r.version };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('backup:verify-version', async (_e, no) => {
  try {
    const r = await backup.downloadVersion(no);
    const crypto2 = require('crypto');
    const sha = crypto2.createHash('sha256').update(r.buffer).digest('hex');
    const ok = sha === r.version.sha256;
    let manifest = null, checksumOk = null;
    try { const u = flpack.unpack(r.buffer); manifest = u.manifest; checksumOk = u.checksumOk; } catch (e) { /* 忽略 */ }
    return { ok, sha, expect: r.version.sha256, manifest, checksumOk };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('backup:restore-version', async (_e, no) => {
  try {
    const r = await backup.downloadVersion(no);
    const u = flpack.unpack(r.buffer);
    if (!u.checksumOk) return { ok: false, error: '该版本校验和不一致，已阻止恢复' };
    const out = flpack.applyImport(DATA_DIR, u, {});
    return { ok: true, companies: out.companies, files: out.files, manifest: u.manifest, version: r.version };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('backup:test', async (_e, cfg) => {
  try { await backup.webdavTest(cfg); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('backup:gdrive-auth', async (_e, payload) => {
  try {
    const cfg = backup.readConfig();
    cfg.gdrive.clientId = payload.clientId || '';
    cfg.gdrive.clientSecret = payload.clientSecret || '';
    cfg.gdrive.folderId = payload.folderId || '';
    backup.writeConfig(cfg);
    const dev = await backup.gdriveDeviceStart(cfg.gdrive.clientId);
    backup.gdriveDevicePoll(cfg, dev.device_code, dev.interval, dev.expires_in)
      .then(t => {
        const c = backup.readConfig();
        c.gdrive.refreshToken = t.refresh_token || '';
        backup.writeConfig(c);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup:gdrive-ok', {});
      })
      .catch(e => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup:gdrive-fail', String(e.message || e));
      });
    return { ok: true, userCode: dev.user_code, url: dev.verification_url, expiresIn: dev.expires_in };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

/* ------------------------------- 生命周期 ------------------------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.fundledger.desktop');
    ensureDir();
    buildMenu();
  setTimeout(() => { try { autoBackup(); } catch (e) { console.error(e); } }, 15000);
  try {
    const groupName = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8')).meta.groupName || '集团'; }
      catch (err) { return '集团'; }
    })();
    backup.startScheduler(DATA_DIR, entry => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup:done', entry);
    }, groupName);
  } catch (e) { console.error(e); }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
