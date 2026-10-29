/**
 * FundMerge 云盘备份引擎 v2（需求21 更新版）
 *
 * 变更：
 *  - 备份对象统一为完整账套包 .flpack（不再上传散落 data.json）
 *  - 手动 / 自动备份统一进入版本池，最多 7 个，超限删最旧
 *  - 每个版本记录：编号 / 类型 / 时间 / 大小 / 云盘路径 / 校验和 / 结果
 *  - 版本索引存本地，云盘不可用时也能查看历史
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const flpack = require('./flpack');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'backup.json');
const INDEX_FILE = () => path.join(app.getPath('userData'), 'backup-index.json');

const MAX_VERSIONS = 7;

const DEFAULTS = {
  provider: 'none',            // none | webdav | gdrive
  enabled: false,
  frequency: 'daily',          // hourly | 6h | daily | weekly | custom
  customHours: 24,
  webdav: { url: '', username: '', password: '', folder: 'FundMerge' },
  gdrive: { clientId: '', clientSecret: '', refreshToken: '', folderId: '' },
  lastRun: '',
  lastResult: '',
  lastError: ''
};

/* ------------------------------ 配置 ------------------------------ */

function readConfig() {
  try {
    const box = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    const cfg = Object.assign({}, DEFAULTS, box.cfg || {});
    if (box.secret) {
      try {
        const plain = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(box.secret, 'base64'))
          : Buffer.from(box.secret, 'base64').toString('utf8');
        const s = JSON.parse(plain);
        if (s.webdavPassword) cfg.webdav.password = s.webdavPassword;
        if (s.gdriveSecret) cfg.gdrive.clientSecret = s.gdriveSecret;
        if (s.gdriveRefresh) cfg.gdrive.refreshToken = s.gdriveRefresh;
      } catch (e) { /* 忽略 */ }
    }
    return cfg;
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function writeConfig(cfg) {
  /* 与默认值合并，容忍调用方只传部分字段 */
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  cfg.webdav = Object.assign({}, DEFAULTS.webdav, cfg.webdav || {});
  cfg.gdrive = Object.assign({}, DEFAULTS.gdrive, cfg.gdrive || {});
  const dir = app.getPath('userData');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 忽略 */ }
  const secretObj = {
    webdavPassword: (cfg.webdav || {}).password || '',
    gdriveSecret: (cfg.gdrive || {}).clientSecret || '',
    gdriveRefresh: (cfg.gdrive || {}).refreshToken || ''
  };
  const plain = JSON.stringify(secretObj);
  const secret = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain).toString('base64')
    : Buffer.from(plain, 'utf8').toString('base64');
  const safeCfg = JSON.parse(JSON.stringify(cfg));
  safeCfg.webdav.password = '';
  safeCfg.gdrive.clientSecret = '';
  safeCfg.gdrive.refreshToken = '';
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify({ cfg: safeCfg, secret }, null, 2), 'utf8');
}

function publicConfig() {
  const c = readConfig();
  return Object.assign({}, c, {
    webdav: { url: c.webdav.url, username: c.webdav.username, hasPassword: !!c.webdav.password, folder: c.webdav.folder || 'FundMerge' },
    gdrive: { clientId: c.gdrive.clientId, folderId: c.gdrive.folderId, authorized: !!c.gdrive.refreshToken }
  });
}

/* ------------------------------ 版本索引 ------------------------------ */

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE(), 'utf8')); }
  catch (e) { return []; }
}

function writeIndex(list) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(INDEX_FILE(), JSON.stringify(list, null, 2), 'utf8');
  } catch (e) { /* 忽略 */ }
}

const listVersions = () => readIndex().slice().sort((a, b) => (b.at || '').localeCompare(a.at || ''));

function nextVersionNo(list) {
  const nums = list.map(v => Number(v.no) || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

/* ------------------------------ HTTP ------------------------------ */

function request(urlStr, opts = {}, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('地址无效：' + urlStr)); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: opts.method || 'GET',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: Object.assign({ 'User-Agent': 'FundMerge/' + app.getVersion() }, opts.headers || {}),
      timeout: opts.timeout || 60000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const basicAuth = (u, p) => 'Basic ' + Buffer.from(u + ':' + p, 'utf8').toString('base64');

/* ------------------------------ WebDAV ------------------------------ */

const davBase = cfg => String(cfg.webdav.url || '').replace(/\/+$/, '');
const davFolder = cfg => (cfg.webdav.folder || 'FundMerge').replace(/^\/+|\/+$/g, '');
const davPath = (cfg, name) => davBase(cfg) + '/' + davFolder(cfg) + '/' + encodeURIComponent(name);

function requireHttps(cfg) {
  if (!/^https:\/\//i.test(cfg.webdav.url || '')) {
    throw new Error('为保护凭据与账本，WebDAV 地址必须以 https:// 开头');
  }
}

async function webdavTest(cfg) {
  if (!cfg.webdav.url) throw new Error('请先填写 WebDAV 地址');
  requireHttps(cfg);
  const auth = { Authorization: basicAuth(cfg.webdav.username, cfg.webdav.password) };

  const res = await request(davBase(cfg) + '/', {
    method: 'PROPFIND',
    headers: Object.assign({ Depth: '0', 'Content-Type': 'application/xml' }, auth),
    timeout: 15000
  }, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>');

  if (res.status === 401) throw new Error('认证失败（401），请检查用户名与应用密码');
  if (res.status === 404) throw new Error('目录不存在（404）');
  if (res.status < 200 || res.status >= 300) throw new Error('连接失败，HTTP ' + res.status);

  /* MKCOL 失败不致命：目录已存在会返回 405，这里只保证不阻塞 */
  await request(davBase(cfg) + '/' + davFolder(cfg), { method: 'MKCOL', headers: auth, timeout: 15000 })
    .catch(() => {});
  return { ok: true, status: res.status, folder: davFolder(cfg) };
}

async function webdavPut(cfg, name, buf) {
  requireHttps(cfg);
  const res = await request(davPath(cfg, name), {
    method: 'PUT',
    headers: {
      Authorization: basicAuth(cfg.webdav.username, cfg.webdav.password),
      'Content-Type': 'application/octet-stream',
      'Content-Length': buf.length
    },
    timeout: 300000
  }, buf);
  if (res.status >= 200 && res.status < 300) return { ok: true };
  if (res.status === 401) throw new Error('认证失败（401）');
  if (res.status === 507) throw new Error('云盘空间不足（507），请清理后重试');
  if (res.status === 409) throw new Error('目标目录不存在（409）');
  throw new Error('上传失败，HTTP ' + res.status);
}

async function webdavGet(cfg, name) {
  requireHttps(cfg);
  const res = await request(davPath(cfg, name), {
    method: 'GET',
    headers: { Authorization: basicAuth(cfg.webdav.username, cfg.webdav.password) },
    timeout: 300000
  });
  if (res.status === 200) return res.body;
  if (res.status === 404) throw new Error('云盘上找不到该版本（404）');
  throw new Error('下载失败，HTTP ' + res.status);
}

async function webdavDelete(cfg, name) {
  requireHttps(cfg);
  const res = await request(davPath(cfg, name), {
    method: 'DELETE',
    headers: { Authorization: basicAuth(cfg.webdav.username, cfg.webdav.password) }
  });
  if (res.status === 204 || res.status === 200 || res.status === 404) return { ok: true };
  throw new Error('删除失败，HTTP ' + res.status);
}

/* ------------------------------ Google Drive ------------------------------ */

const GOOGLE_DEVICE = 'https://oauth2.googleapis.com/device/code';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

async function gdriveDeviceStart(clientId) {
  if (!clientId) throw new Error('请先填写 OAuth 客户端 ID');
  const body = 'client_id=' + encodeURIComponent(clientId) + '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/drive.file');
  const res = await request(GOOGLE_DEVICE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error('获取设备码失败：' + res.body.toString().slice(0, 160));
  return JSON.parse(res.body.toString());
}

async function gdriveDevicePoll(cfg, deviceCode, interval, expiresIn) {
  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, (interval + 1) * 1000));
    const body = 'client_id=' + encodeURIComponent(cfg.gdrive.clientId) +
      '&client_secret=' + encodeURIComponent(cfg.gdrive.clientSecret) +
      '&device_code=' + encodeURIComponent(deviceCode) +
      '&grant_type=urn:ietf:params:oauth:grant-type:device_code';
    const res = await request(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    const j = JSON.parse(res.body.toString() || '{}');
    if (j.refresh_token) return j;
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { await new Promise(r => setTimeout(r, 3000)); continue; }
    if (j.error === 'access_denied') throw new Error('用户拒绝了授权');
    if (j.error) throw new Error('授权失败：' + (j.error_description || j.error));
  }
  throw new Error('授权超时，请重试');
}

async function gdriveAccessToken(cfg) {
  if (!cfg.gdrive.refreshToken) throw new Error('尚未授权 Google Drive');
  const body = 'client_id=' + encodeURIComponent(cfg.gdrive.clientId) +
    '&client_secret=' + encodeURIComponent(cfg.gdrive.clientSecret) +
    '&refresh_token=' + encodeURIComponent(cfg.gdrive.refreshToken) +
    '&grant_type=refresh_token';
  const res = await request(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  const j = JSON.parse(res.body.toString() || '{}');
  if (!j.access_token) throw new Error('刷新令牌失败：' + (j.error_description || j.error || res.status));
  return j.access_token;
}

async function gdriveUpload(cfg, name, buf) {
  const token = await gdriveAccessToken(cfg);
  const boundary = '----fundmerge' + crypto.randomBytes(8).toString('hex');
  const meta = { name, mimeType: 'application/octet-stream' };
  if (cfg.gdrive.folderId) meta.parents = [cfg.gdrive.folderId];
  const head = Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n', 'utf8');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  const body = Buffer.concat([head, buf, tail]);
  const res = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'multipart/related; boundary=' + boundary,
      'Content-Length': body.length
    },
    timeout: 600000
  }, body);
  if (res.status >= 200 && res.status < 300) return { ok: true, id: (JSON.parse(res.body.toString() || '{}')).id };
  throw new Error('上传失败，HTTP ' + res.status + ' ' + res.body.toString().slice(0, 120));
}

async function gdriveGet(cfg, fileId) {
  const token = await gdriveAccessToken(cfg);
  const res = await request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, timeout: 600000
  });
  if (res.status === 200) return res.body;
  throw new Error('下载失败，HTTP ' + res.status);
}

async function gdriveDelete(cfg, fileId) {
  const token = await gdriveAccessToken(cfg);
  const res = await request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?supportsAllDrives=true', {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
  });
  if (res.status === 204 || res.status === 200 || res.status === 404) return { ok: true };
  throw new Error('删除失败，HTTP ' + res.status);
}

/* ------------------------------ 备份执行 ------------------------------ */

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function runBackup(dataDir, type, opts = {}) {
  const cfg = readConfig();
  if (cfg.provider === 'none') throw new Error('尚未选择云盘');

  const list = readIndex();
  const no = nextVersionNo(list);
  const tag = type === 'manual' ? '手动' : '自动';
  const group = (opts.groupName || '集团').replace(/[\\/:*?"<>|]/g, '');
  const name = `账套_${group}_${tag}_${stamp()}.flpack`;

  const r = flpack.pack({
    dataDir,
    opts: { includeLogs: true, includeCloud: false, version: app.getVersion(), packName: group }
  });
  const sha = crypto.createHash('sha256').update(r.buffer).digest('hex');

  let cloudPath = '', cloudId = '';
  if (cfg.provider === 'webdav') {
    await webdavPut(cfg, name, r.buffer);
    cloudPath = davFolder(cfg) + '/' + name;
  } else if (cfg.provider === 'gdrive') {
    const up = await gdriveUpload(cfg, name, r.buffer);
    cloudId = up.id;
    cloudPath = 'gdrive:' + up.id;
  } else {
    throw new Error('不支持的云盘类型');
  }

  const ver = {
    no, name, type, at: new Date().toISOString(),
    size: r.buffer.length, sha256: sha, cloudPath, cloudId,
    result: 'ok', error: '',
    stats: r.manifest.stats
  };

  let next = [ver].concat(list);
  const removed = [];
  if (next.length > MAX_VERSIONS) {
    const sorted = next.slice().sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    const drop = sorted.slice(0, next.length - MAX_VERSIONS);
    next = next.filter(v => !drop.includes(v));
    for (const d of drop) {
      try {
        if (cfg.provider === 'webdav') await webdavDelete(cfg, d.name);
        else if (cfg.provider === 'gdrive' && d.cloudId) await gdriveDelete(cfg, d.cloudId);
        removed.push(d.no);
      } catch (e) {
        next.push(Object.assign({}, d, { error: '删除失败：' + e.message }));
      }
    }
  }
  writeIndex(next);

  const c2 = readConfig();
  c2.lastRun = ver.at;
  c2.lastResult = 'ok';
  c2.lastError = '';
  writeConfig(c2);

  return { version: ver, removed, total: next.length };
}

function recordFail(err) {
  const cfg = readConfig();
  const entry = { at: new Date().toISOString(), result: 'fail', error: String(err && err.message || err) };
  cfg.lastRun = entry.at;
  cfg.lastResult = 'fail';
  cfg.lastError = entry.error;
  writeConfig(cfg);
  return entry;
}

/* ------------------------------ 下载 / 删除 ------------------------------ */

async function downloadVersion(versionNo) {
  const cfg = readConfig();
  const list = readIndex();
  const v = list.find(x => Number(x.no) === Number(versionNo));
  if (!v) throw new Error('找不到版本 #' + versionNo);
  if (cfg.provider === 'webdav') return { buffer: await webdavGet(cfg, v.name), version: v };
  if (cfg.provider === 'gdrive') return { buffer: await gdriveGet(cfg, v.cloudId), version: v };
  throw new Error('尚未选择云盘');
}

async function deleteVersion(versionNo) {
  const cfg = readConfig();
  const list = readIndex();
  const v = list.find(x => Number(x.no) === Number(versionNo));
  if (!v) throw new Error('找不到版本 #' + versionNo);
  if (cfg.provider === 'webdav') await webdavDelete(cfg, v.name);
  else if (cfg.provider === 'gdrive' && v.cloudId) await gdriveDelete(cfg, v.cloudId);
  writeIndex(list.filter(x => Number(x.no) !== Number(versionNo)));
  return { ok: true, removed: v.no };
}

/* ------------------------------ 调度 ------------------------------ */

let timer = null;

function intervalMs(cfg) {
  switch (cfg.frequency) {
    case 'hourly': return 3600000;
    case '6h': return 6 * 3600000;
    case 'daily': return 86400000;
    case 'weekly': return 7 * 86400000;
    case 'custom': return Math.max(1, Number(cfg.customHours) || 24) * 3600000;
    default: return 86400000;
  }
}

function startScheduler(dataDir, onResult, groupName) {
  stopScheduler();
  timer = setInterval(async () => {
    const cfg = readConfig();
    if (!cfg.enabled || cfg.provider === 'none') return;
    const last = cfg.lastRun ? new Date(cfg.lastRun).getTime() : 0;
    if (Date.now() - last < intervalMs(cfg) - 5000) return;
    try {
      const r = await runBackup(dataDir, 'auto', { groupName });
      if (onResult) onResult({ ok: true, version: r.version });
    } catch (e) {
      const entry = recordFail(e);
      if (onResult) onResult({ ok: false, error: entry.error });
    }
  }, 60000);
  if (timer.unref) timer.unref();
}

function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
  readConfig, writeConfig, publicConfig,
  readIndex, writeIndex, listVersions,
  runBackup, recordFail, downloadVersion, deleteVersion,
  webdavTest, webdavPut, webdavGet, webdavDelete,
  gdriveDeviceStart, gdriveDevicePoll,
  startScheduler, stopScheduler, intervalMs, MAX_VERSIONS
};
