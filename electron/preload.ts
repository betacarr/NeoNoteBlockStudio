import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../src/core/types';

const api: DesktopAPI = {
  platform: process.platform,
  openFile: kind => ipcRenderer.invoke('file:open', kind),
  inspectFlpSamples: (sourcePath, samples) => ipcRenderer.invoke('flp:inspect-samples', sourcePath, samples),
  saveFile: (name, bytes, path) => ipcRenderer.invoke('file:save', { name, bytes, path }),
  discoverMinecraft: () => ipcRenderer.invoke('minecraft:discover'),
  selectMinecraftRoot: () => ipcRenderer.invoke('minecraft:select-root'),
  loadMinecraft: (root, index, version) => ipcRenderer.invoke('minecraft:load', { root, index, version }),
  autosave: project => ipcRenderer.invoke('project:autosave', project),
  recover: () => ipcRenderer.invoke('project:recover'),
  clearRecovery: projectId => ipcRenderer.invoke('project:clear-recovery', projectId),
  rendererReady: () => ipcRenderer.invoke('renderer:ready'),
  onOpenFile(callback) { const listener = (_event: Electron.IpcRendererEvent, file: { name: string; path: string; bytes: Uint8Array }) => callback(file); ipcRenderer.on('file:open-request', listener); return () => ipcRenderer.removeListener('file:open-request', listener); },
  renderNative: request => ipcRenderer.invoke('audio:render', request),
  notifyDirty: dirty => ipcRenderer.invoke('project:dirty', dirty),
  closeAfterSave: () => ipcRenderer.invoke('window:close-saved'),
  onMenu(callback) { const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command); ipcRenderer.on('menu', listener); return () => ipcRenderer.removeListener('menu', listener); },
};
contextBridge.exposeInMainWorld('desktop', api);
