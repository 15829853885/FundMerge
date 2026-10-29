'use strict';

/**
 * 预加载脚本：只向页面暴露最小可用的桌面能力，渲染进程无法直接访问 Node / 文件系统。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,

  /* 账本读写 */
  load: () => ipcRenderer.invoke('store:load'),
  save: data => ipcRenderer.invoke('store:save', data),
  info: () => ipcRenderer.invoke('store:info'),

  /* 原生文件对话框 */
  saveFile: opts => ipcRenderer.invoke('dialog:save-file', opts),
  openJSON: () => ipcRenderer.invoke('dialog:open-json'),

  /* 其它 */
  revealData: () => ipcRenderer.invoke('store:reveal'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),

  /* 公司档案文件 */
  openFilesFolder: () => ipcRenderer.invoke('app:open-files-folder'),
  openManual: () => ipcRenderer.invoke('app:open-manual'),
  openCompanyFolder: companyId => ipcRenderer.invoke('app:open-company-folder', companyId),
  setDataDir: () => ipcRenderer.invoke('app:set-data-dir'),
  files: {
    pick: () => ipcRenderer.invoke('file:pick'),
    import: payload => ipcRenderer.invoke('file:import', payload),
    stats: rels => ipcRenderer.invoke('file:stats', rels),
    rename: payload => ipcRenderer.invoke('file:rename', payload),
    open: payload => ipcRenderer.invoke('file:open', payload),
    reveal: payload => ipcRenderer.invoke('file:reveal', payload),
    remove: payload => ipcRenderer.invoke('file:remove', payload),
    read: payload => ipcRenderer.invoke('file:read', payload),
    removeCompany: companyId => ipcRenderer.invoke('file:remove-company', companyId)
  },

  /* 菜单动作（文件 → 备份 / 恢复 / 记一笔） */
  onMenu: handler => {
    ipcRenderer.on('menu:action', (_e, action) => handler(action));
  },

  /* 账套包 */
  flpack: {
    export: opts => ipcRenderer.invoke('flpack:export', opts),
    inspect: payload => ipcRenderer.invoke('flpack:inspect', payload),
    import: payload => ipcRenderer.invoke('flpack:import', payload),
    autoStatus: () => ipcRenderer.invoke('flpack:auto-status'),
    autoRun: () => ipcRenderer.invoke('flpack:auto-run'),
    openFolder: () => ipcRenderer.invoke('flpack:open-folder')
  },

  /* 云盘备份 */
  backup: {
    config: () => ipcRenderer.invoke('backup:config'),
    save: cfg => ipcRenderer.invoke('backup:save', cfg),
    run: type => ipcRenderer.invoke('backup:run', type),
    versions: () => ipcRenderer.invoke('backup:versions'),
    deleteVersion: no => ipcRenderer.invoke('backup:delete-version', no),
    downloadVersion: no => ipcRenderer.invoke('backup:download-version', no),
    verifyVersion: no => ipcRenderer.invoke('backup:verify-version', no),
    restoreVersion: no => ipcRenderer.invoke('backup:restore-version', no),
    test: cfg => ipcRenderer.invoke('backup:test', cfg),
    gdriveAuth: payload => ipcRenderer.invoke('backup:gdrive-auth', payload),
    onDone: cb => ipcRenderer.on('backup:done', (_e, entry) => cb(entry)),
    onGdriveOk: cb => ipcRenderer.on('backup:gdrive-ok', () => cb()),
    onGdriveFail: cb => ipcRenderer.on('backup:gdrive-fail', (_e, msg) => cb(msg))
  },

  /* 系统能力：显卡合成是否可用（用于自动切换「流畅模式」） */
  gpu: () => ipcRenderer.invoke('sys:gpu'),

  /* 关闭窗口时的选择：quit / background / never-ask */
  closeAction: action => ipcRenderer.invoke('app:close-action', action)
});
