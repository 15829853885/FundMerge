/**
 * FundMerge 账套包（.flpack）
 *
 * 容器 = 标准 ZIP（store，不压缩）+ 可选整体 AES-256-GCM 加密
 * 结构：
 *   manifest.json
 *   ledger/data.json  ledger/data.bak.json
 *   files/<公司ID>/<年-月>/...
 *   config/system.json  config/users.json  config/cloud.json(可选)
 *   logs/audit.json(可选)
 *   checksum.sha256
 *
 * 用标准 ZIP 是为了：用户能用 7-Zip/WinRAR 直接打开检查，不依赖本程序。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

/* ============================== CRC32 ============================== */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ============================== ZIP 写入（store） ============================== */

function dosTime(d) {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

function zipBuild(entries) {
  const now = new Date();
  const { date, time } = dosTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;

  entries.forEach(e => {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);          // UTF-8 文件名
    lh.writeUInt16LE(0, 8);               // store
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);

    locals.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);

    centrals.push(ch, name);
    offset += lh.length + name.length + data.length;
  });

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

function zipRead(buf) {
  /* 找 EOCD */
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是合法的账套包（找不到 ZIP 结束标记）');

  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const out = [];
  let p = cdOff;

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('账套包结构损坏（中央目录异常）');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    /* 从本地头定位数据 */
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const size = buf.readUInt32LE(p + 24);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    out.push({ name, data: buf.slice(dataStart, dataStart + size) });

    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/* ============================== 加密外壳 ============================== */

const MAGIC_PLAIN = Buffer.from('FLPK1');
const MAGIC_ENC = Buffer.from('FLPK2');

function encrypt(buf, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([MAGIC_ENC, salt, iv, tag, ct]);
}

function decrypt(buf, password) {
  if (!buf.slice(0, 5).equals(MAGIC_ENC)) throw new Error('账套包未加密，无需密码');
  const salt = buf.slice(5, 21);
  const iv = buf.slice(21, 33);
  const tag = buf.slice(33, 49);
  const ct = buf.slice(49);
  const key = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch (e) {
    throw new Error('密码错误或账套包已损坏');
  }
}

const isEncrypted = buf => buf.length > 5 && buf.slice(0, 5).equals(MAGIC_ENC);
const isPlainPack = buf => buf.length > 5 && buf.slice(0, 5).equals(MAGIC_PLAIN);

/* ============================== 打包 ============================== */

/**
 * @param {object} o { dataDir, opts:{ includeLogs, includeCloud, password, companyIds, packName } }
 */
function pack(o) {
  const dataDir = o.dataDir;
  const opts = o.opts || {};
  const dataPath = path.join(dataDir, 'data.json');
  if (!fs.existsSync(dataPath)) throw new Error('找不到账本文件 data.json');

  const db = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const entries = [];

  /* 1. 账本 */
  let ledgerRaw = JSON.stringify(db);
  const ledger = JSON.parse(ledgerRaw);

  /* 按公司导出：裁剪公司与其附件 */
  let keepIds = null;
  if (Array.isArray(opts.companyIds) && opts.companyIds.length) {
    keepIds = opts.companyIds;
    ledger.companies = ledger.companies.filter(c => keepIds.includes(c.id));
    ledger.meta.activeCompanyId = ledger.companies[0] ? ledger.companies[0].id : '';
  }

  /* 云盘凭据默认剔除 */
  if (!opts.includeCloud && ledger.meta) delete ledger.meta.backup;

  /* 日志可选 */
  if (!opts.includeLogs) delete ledger.auditLogs;

  entries.push({ name: 'ledger/data.json', data: JSON.stringify(ledger, null, 2) });

  const bakPath = path.join(dataDir, 'data.bak.json');
  if (fs.existsSync(bakPath)) entries.push({ name: 'ledger/data.bak.json', data: fs.readFileSync(bakPath) });

  /* 2. 配置 */
  const users = (ledger.users || []).map(u => ({
    id: u.id, username: u.username, displayName: u.displayName, role: u.role,
    active: u.active !== false, salt: u.salt, hash: u.hash,
    security: u.security || [], companyIds: u.companyIds || [], builtin: !!u.builtin,
    createdAt: u.createdAt || ''
  }));
  entries.push({ name: 'config/users.json', data: JSON.stringify(users, null, 2) });
  entries.push({
    name: 'config/system.json', data: JSON.stringify({
      currency: ledger.meta.currency, groupName: ledger.meta.groupName,
      parentMode: ledger.meta.parentMode || 'company',
      voucherRule: ledger.meta.voucherRule, budgetRule: ledger.meta.budgetRule,
      appVersion: o.version || ''
    }, null, 2)
  });
  if (opts.includeCloud && ledger.meta && ledger.meta.backup) {
    entries.push({ name: 'config/cloud.json', data: JSON.stringify(ledger.meta.backup, null, 2) });
  }

  /* 3. 附件 */
  const filesRoot = path.join(dataDir, 'files');
  let fileCount = 0, fileBytes = 0;
  if (fs.existsSync(filesRoot)) {
    const walk = dir => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) return walk(abs);
        if (keepIds) {
          const rel = path.relative(filesRoot, abs).split(path.sep);
          if (!keepIds.includes(rel[0])) return;
        }
        const buf = fs.readFileSync(abs);
        fileCount++; fileBytes += buf.length;
        entries.push({ name: 'files/' + path.relative(filesRoot, abs).split(path.sep).join('/'), data: buf });
      });
    };
    walk(filesRoot);
  }

  /* 4. 日志 */
  if (opts.includeLogs && Array.isArray(ledger.auditLogs)) {
    entries.push({ name: 'logs/audit.json', data: JSON.stringify(ledger.auditLogs, null, 2) });
  }

  /* 5. manifest */
  const stats = {
    companies: ledger.companies.length,
    transactions: ledger.companies.reduce((s, c) => s + (c.transactions || []).length, 0),
    accounts: ledger.companies.reduce((s, c) => s + (c.accounts || []).length, 0),
    debts: ledger.companies.reduce((s, c) => s + (c.debts || []).length, 0),
    users: users.length,
    files: fileCount,
    fileBytes
  };
  const manifest = {
    format: 'flpack',
    formatVersion: 1,
    appVersion: o.version || '',
    exportedAt: new Date().toISOString(),
    packName: opts.packName || '',
    partial: !!keepIds,
    encrypted: !!opts.password,
    includes: {
      logs: !!opts.includeLogs,
      cloud: !!opts.includeCloud,
      files: true
    },
    companyList: ledger.companies.map(c => ({ id: c.id, name: c.name, isParent: !!c.isParent })),
    stats
  };
  entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });

  /* 6. 校验和（对除 checksum 外的全部条目） */
  const lines = entries.map(e => {
    const buf = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    return crypto.createHash('sha256').update(buf).digest('hex') + '  ' + e.name;
  }).join('\n');
  entries.push({ name: 'checksum.sha256', data: lines + '\n' });

  /* 7. 组包 */
  const zip = zipBuild(entries);
  const out = opts.password
    ? encrypt(zip, opts.password)
    : Buffer.concat([MAGIC_PLAIN, zip]);

  return { buffer: out, manifest };
}

/* ============================== 解包与校验 ============================== */

function unpack(buf, password) {
  let body = buf;
  if (isEncrypted(buf)) {
    if (!password) { const e = new Error('该账套包已加密，请输入密码'); e.needPassword = true; throw e; }
    body = decrypt(buf, password);
  } else if (isPlainPack(buf)) {
    body = buf.slice(5);
  }
  /* 兼容裸 zip */
  const entries = zipRead(body);
  const map = {};
  entries.forEach(e => { map[e.name] = e.data; });

  if (!map['manifest.json']) throw new Error('账套包不完整：缺少 manifest.json');
  const manifest = JSON.parse(map['manifest.json'].toString('utf8'));

  if (!map['ledger/data.json']) throw new Error('账套包不完整：缺少账本数据');
  const data = JSON.parse(map['ledger/data.json'].toString('utf8'));

  /* 校验和比对 */
  let checksumOk = false;
  if (map['checksum.sha256']) {
    const expect = map['checksum.sha256'].toString('utf8').trim().split('\n').filter(Boolean);
    checksumOk = expect.every(line => {
      const [hash, name] = line.split(/\s{2}/);
      if (!map[name]) return false;
      return crypto.createHash('sha256').update(map[name]).digest('hex') === hash;
    });
  }

  const files = {};
  entries.forEach(e => {
    if (e.name.startsWith('files/')) files[e.name.slice(6)] = e.data;
  });

  let logs = null, cloud = null;
  try { if (map['logs/audit.json']) logs = JSON.parse(map['logs/audit.json'].toString('utf8')); } catch (e) {}
  try { if (map['config/cloud.json']) cloud = JSON.parse(map['config/cloud.json'].toString('utf8')); } catch (e) {}

  return { manifest, data, files, checksumOk, logs, cloud, entries: entries.map(e => e.name) };
}

/* ============================== 落地导入 ============================== */

function applyImport(dataDir, pack, opts = {}) {
  /* 可选：把包里的日志 / 云盘配置合并回账本 */
  if (pack.data && pack.data.meta) {
    if (opts.restoreLogs && Array.isArray(pack.logs) && pack.logs.length) {
      pack.data.auditLogs = pack.logs;
    }
    if (opts.restoreCloud && pack.cloud && typeof pack.cloud === 'object') {
      pack.data.meta.backup = pack.cloud;
    }
  }
  /* 作为新账套导入：保留原账本，把新数据追加成一套（公司 id 去重后缀） */
  if (opts.mode === 'new' && fs.existsSync(path.join(dataDir, 'data.json'))) {
    try {
      const cur = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8'));
      const suffix = '_imp' + Date.now().toString(36);
      (pack.data.companies || []).forEach(c => {
        c.id = c.id + suffix;
        c.name = c.name + '（导入）';
        (c.accounts || []).forEach(a => { a.id = a.id + suffix; });
        (c.categories || []).forEach(x => { x.id = x.id + suffix; });
        (c.transactions || []).forEach(t => { t.id = t.id + suffix; });
        (c.debts || []).forEach(x => { x.id = x.id + suffix; });
        (c.projects || []).forEach(x => { x.id = x.id + suffix; });
        (c.parties || []).forEach(x => { x.id = x.id + suffix; });
        (c.advances || []).forEach(x => { x.id = x.id + suffix; });
        (c.invoices || []).forEach(x => { x.id = x.id + suffix; });
      });
      pack.data.companies = (cur.companies || []).concat(pack.data.companies || []);
      pack.data.users = cur.users || [];
      pack.data.auditLogs = (cur.auditLogs || []).concat(pack.data.auditLogs || []);
      pack.data.meta = Object.assign({}, cur.meta, { activeCompanyId: (pack.data.companies[0] || {}).id || '' });
    } catch (e) { /* 忽略，退化为覆盖 */ }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = dataDir;

  /* 1. 先给当前账套做临时备份（失败可回滚） */
  const rollbackDir = path.join(root, '.rollback-' + stamp);
  let hasOld = false;
  if (fs.existsSync(path.join(root, 'data.json'))) {
    fs.mkdirSync(rollbackDir, { recursive: true });
    fs.copyFileSync(path.join(root, 'data.json'), path.join(rollbackDir, 'data.json'));
    if (fs.existsSync(path.join(root, 'data.bak.json'))) {
      fs.copyFileSync(path.join(root, 'data.bak.json'), path.join(rollbackDir, 'data.bak.json'));
    }
    hasOld = true;
  }

  try {
    /* 2. 写账本 */
    fs.mkdirSync(root, { recursive: true });
    const tmp = path.join(root, 'data.json.importing');
    fs.writeFileSync(tmp, JSON.stringify(pack.data, null, 2), 'utf8');
    fs.renameSync(tmp, path.join(root, 'data.json'));

    /* 3. 写附件（覆盖同名） */
    const filesRoot = path.join(root, 'files');
    Object.keys(pack.files).forEach(rel => {
      const abs = path.join(filesRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, pack.files[rel]);
    });

    /* 4. 清理回滚目录 */
    try { fs.rmSync(rollbackDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

    return { ok: true, companies: (pack.data.companies || []).length, files: Object.keys(pack.files).length };
  } catch (e) {
    /* 回滚 */
    try {
      if (hasOld) {
        fs.copyFileSync(path.join(rollbackDir, 'data.json'), path.join(root, 'data.json'));
        if (fs.existsSync(path.join(rollbackDir, 'data.bak.json'))) {
          fs.copyFileSync(path.join(rollbackDir, 'data.bak.json'), path.join(root, 'data.bak.json'));
        }
      }
      fs.rmSync(rollbackDir, { recursive: true, force: true });
    } catch (e2) { /* 忽略 */ }
    throw new Error('导入失败，已回滚到导入前状态：' + e.message);
  }
}

module.exports = { pack, unpack, applyImport, isEncrypted, isPlainPack, zipBuild, zipRead };
