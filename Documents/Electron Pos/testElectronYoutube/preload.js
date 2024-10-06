const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startWhatsApp: () => ipcRenderer.send('start-whatsapp'),
  onQR: (callback) => ipcRenderer.on('qr', callback),
  onConnected: (callback) => ipcRenderer.on('connected', callback),
  onMessage: (callback) => ipcRenderer.on('message', callback),
  onError: (callback) => ipcRenderer.on('error', callback)
});