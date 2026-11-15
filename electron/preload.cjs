const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getCoordinator: () => ipcRenderer.invoke('desktop:get-coordinator'),
  onCoordinatorReady: cb => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on('desktop:coordinator-ready', handler);
    return () => ipcRenderer.removeListener('desktop:coordinator-ready', handler);
  },
  environment: {
    platform: process.platform,
    arch: process.arch,
    isElectron: true,
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    },
  },
  pickAttachmentFiles: () => ipcRenderer.invoke('desktop:pick-files'),
  captureDesktopScreen: () => ipcRenderer.invoke('desktop:capture-screen'),
  openSpotlight: () => ipcRenderer.invoke('desktop:open-spotlight'),
  openPopout: botId => ipcRenderer.invoke('desktop:open-popout', botId),
  openExternal: url => ipcRenderer.invoke('desktop:open-external', url),
  hideCurrentWindow: () => ipcRenderer.invoke('desktop:hide-current'),
});
