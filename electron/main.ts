import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, utilityProcess } from 'electron';
import { readFile, writeFile, mkdir, readdir, stat, rename, copyFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { release as osRelease } from 'node:os';
import { unzipSync } from 'fflate';
import type { JavaDecoder, NativeRenderRequest, SampleLibrary } from '../src/core/types';
import { libraryAllowed, nativeArtifacts, nativeFileMatches, releaseByClientHash, type JavaRelease } from '../src/core/releases';
import { loadNoteBlockSoundAssets, soundAssetLayout } from '../src/core/sound-assets';
import { audioImplementation, clientEmbeddedLegacyCodec } from '../src/audio/implementations';
import { inspectFlpSamples } from './flp-samples';
import { applicationProfile } from './app-profile';
import { applicationMenu } from './menu';
import { APP_NAME } from '../src/core/app-identity';

protocol.registerSchemesAsPrivileged([{ scheme: 'nbsx', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const appRoot = path.resolve(__dirname, '..');
const requestedUserData = app.commandLine.getSwitchValue('user-data-dir');
const legacyUserData = path.join(app.getPath('appData'), 'EX NoteBlock Studio');
const selectedUserData = applicationProfile(requestedUserData, !app.isPackaged ? process.env.NBSX_TEST_USER_DATA : undefined, legacyUserData, existsSync(legacyUserData));
if (selectedUserData) app.setPath('userData', selectedUserData);
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const permittedFiles = new Set<string>(), permittedRoots = new Set<string>(), permittedLibraries = new Set<string>();
const permittedDecoders = new Set<string>();
const executeFile = promisify(execFile);
let window: BrowserWindow | undefined;
let rendererReady = false, flushingOpenFiles = false;
const pendingOpenFiles: string[] = [];
const pendingMenuCommands: string[] = [];
let dirtyProject = false, closeDialogOpen = false;
type MinecraftLocation = { root: string; versions: string[]; indexes: string[] };
let discovered: MinecraftLocation[] | undefined;
let discoveryInFlight: Promise<MinecraftLocation[]> | undefined;
const locationKey = (root: string) => process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
const exists = async (filename: string) => { try { await stat(filename); return true; } catch { return false; } };
const childNames = async (root: string, directories = true): Promise<string[]> => { try { return (await readdir(root, { withFileTypes: true })).filter(e => directories ? e.isDirectory() : e.isFile()).map(e => e.name); } catch { return []; } };
const safeName = (name: string) => path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160) || '未命名.nbsx';
function projectIdFromContainer(bytes: Uint8Array): string | undefined {
  const files = unzipSync(bytes, { filter: entry => entry.name === 'project.json' && entry.originalSize <= 64 * 1024 * 1024 });
  if (!files['project.json']) return undefined;
  const id = JSON.parse(new TextDecoder().decode(files['project.json'])).id;
  return typeof id === 'string' ? id : undefined;
}

function queueOpenFile(filename: string) {
  if (!filename.startsWith('-') && /\.(?:nbsx|nbs|mid|midi|flp)$/i.test(filename)) {
    pendingOpenFiles.push(path.resolve(filename));
    if (app.isReady()) showWindow();
    void flushOpenFiles();
  }
}
function showWindow() {
  if (!window) createWindow();
  if (window!.isMinimized()) window!.restore();
  window!.show(); window!.focus();
}
const sendMenuCommand = (command: string) => () => {
  if (!window || !rendererReady) {
    pendingMenuCommands.push(command);
    if (app.isReady()) showWindow();
  } else window.webContents.send('menu', command);
};

function requestProjectClose(quit: boolean) {
  if (!window || closeDialogOpen) return;
  const target = window;
  closeDialogOpen = true;
  void dialog.showMessageBox(target, { type: 'question', title: '保存工程', message: '工程有未保存的修改。', detail: quit ? '退出前可以保存为 NBSX 工程。' : '关闭窗口前可以保存为 NBSX 工程。', buttons: [quit ? '保存并退出' : '保存并关闭', '取消', quit ? '不保存退出' : '不保存关闭'], defaultId: 0, cancelId: 1 }).then(result => {
    if (target.isDestroyed()) return;
    if (result.response === 2) { dirtyProject = false; if (quit) app.quit(); else target.destroy(); }
    else if (result.response === 0) target.webContents.send('menu', quit ? 'save-quit' : 'save-close');
  }).catch(error => { dialog.showErrorBox('无法关闭工程', String(error)); }).finally(() => { closeDialogOpen = false; });
}
async function flushOpenFiles() {
  if (!rendererReady || !window || flushingOpenFiles) return;
  flushingOpenFiles = true;
  try {
    while (rendererReady && window && pendingOpenFiles.length) {
      const filename = pendingOpenFiles.shift()!;
      try {
        const details = await stat(filename); if (!details.isFile() || details.size > 256 * 1024 * 1024) throw new Error('文件类型或大小不支持。');
        const bytes = new Uint8Array(await readFile(filename)); permittedFiles.add(filename);
        window.webContents.send('file:open-request', { path: filename, name: path.basename(filename), bytes });
      } catch (error) { dialog.showErrorBox('无法打开工程', `${filename}\n${String(error)}`); }
    }
  } finally { flushingOpenFiles = false; }
}
if (primaryInstance) {
  for (const argument of process.argv.slice(app.isPackaged ? 1 : 2)) queueOpenFile(argument);
  app.on('second-instance', (_event, argv) => { for (const argument of argv) queueOpenFile(argument); if (app.isReady()) showWindow(); });
  app.on('open-file', (event, filename) => { event.preventDefault(); queueOpenFile(filename); });
  app.on('before-quit', event => { if (dirtyProject && window) { event.preventDefault(); requestProjectClose(true); } });
}

async function atomicWrite(filename: string, bytes: Uint8Array) {
  const temporary = `${filename}.nbsx-write-${randomUUID()}`;
  try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, filename); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
function handle(channel: string, callback: (...args: any[]) => Promise<unknown>) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的桌面请求来源。');
    return callback(...args);
  });
}
function checkBytes(bytes: unknown, limit = 256 * 1024 * 1024): asserts bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > limit) throw new Error('文件数据无效或过大。');
}
async function discoverMinecraft() {
  if (discoveryInFlight) return discoveryInFlight;
  if (discovered) return discovered;
  discoveryInFlight = scanMinecraft();
  try { return await discoveryInFlight; } finally { discoveryInFlight = undefined; }
}
async function scanMinecraft() {
  const roots = new Set<string>();
  const defaults = process.platform === 'win32' ? [path.join(app.getPath('appData'), '.minecraft')] : [path.join(app.getPath('home'), 'Library/Application Support/minecraft'), path.join(app.getPath('home'), '.minecraft')];
  for (const root of defaults) if (await exists(root)) roots.add(root);
  const candidates: string[] = [];
  if (process.platform === 'win32') for (const drive of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
    for (const name of await childNames(`${drive}:\\`)) if (/minecraft|for_mc|mcstudio|prism|multimc|hmcl|pcl|^games$|^游戏$/i.test(name)) candidates.push(path.join(`${drive}:\\`, name));
  }
  let visited = 0;
  async function visit(root: string, depth: number): Promise<void> {
    if (++visited > 4000) return;
    if (path.basename(root) === '.minecraft' || await exists(path.join(root, 'assets', 'indexes')) && await exists(path.join(root, 'versions'))) { roots.add(root); return; }
    if (!depth) return;
    const names = await childNames(root);
    for (const name of names) if (!['node_modules', '.git', 'assets', 'libraries', 'logs', 'mods', 'saves', 'screenshots', 'shaderpacks', 'resourcepacks'].includes(name)) await visit(path.join(root, name), depth - 1);
  }
  for (const candidate of candidates) await visit(candidate, 3);
  const found: MinecraftLocation[] = [];
  for (const root of roots) {
    const versions = await childNames(path.join(root, 'versions'));
    const indexes = (await childNames(path.join(root, 'assets', 'indexes'), false)).filter(n => n.endsWith('.json'));
    if (!indexes.length) continue;
    permittedRoots.add(path.resolve(root)); found.push({ root, versions, indexes });
  }
  // A manually selected location may arrive while the initial scan is pending.
  discovered = [...new Map([...found, ...(discovered ?? [])].map(entry => [locationKey(entry.root), entry])).values()];
  return discovered;
}
async function nativeForVersion(root: string, release: JavaRelease, component: 'openal' | 'stb' = 'openal'): Promise<string | undefined> {
  for (const artifact of nativeArtifacts(release, component, process.platform, process.arch, osRelease())) {
    if (artifact.path.includes('..')) throw new Error('音频库清单路径无效。');
    const archivePath = path.join(root, 'libraries', ...artifact.path.split('/'));
    if (!await exists(archivePath)) continue;
    const bytes = await readFile(archivePath);
    if (createHash('sha1').update(bytes).digest('hex') !== artifact.sha1) throw new Error(`本机音频库与 ${release.id} 官方校验值不同：${path.basename(archivePath)}`);
    const extracted = unzipSync(bytes, { filter: e => nativeFileMatches(e.name, component, process.platform) && !/(?:x86|arm32)\//i.test(e.name) });
    const entries = Object.entries(extracted).sort(([a], [b]) => process.arch === 'x64' ? Number(/64/.test(b)) - Number(/64/.test(a)) : 0);
    const entry = entries[0]; if (!entry) continue;
    const hash = createHash('sha256').update(entry[1]).digest('hex');
    const destination = path.join(app.getPath('userData'), 'native-cache', hash, path.basename(entry[0]));
    await mkdir(path.dirname(destination), { recursive: true });
    if (!await exists(destination) || createHash('sha256').update(await readFile(destination)).digest('hex') !== hash) await atomicWrite(destination, entry[1]);
    permittedLibraries.add(destination); return destination;
  }
  return undefined;
}
async function resolveClient(root: string, instance: string): Promise<{ release: JavaRelease; hash: string; filename: string }> {
  const seen = new Set<string>(); let version = instance;
  for (let depth = 0; depth < 8; depth++) {
    if (path.basename(version) !== version || version === '.' || version === '..' || seen.has(version)) break;
    seen.add(version);
    const folder = path.join(root, 'versions', version), filename = path.join(folder, `${version}.jar`);
    if (await exists(filename)) {
      const hash = createHash('sha1').update(await readFile(filename)).digest('hex'), release = releaseByClientHash(hash);
      if (release) return { release, hash, filename };
    }
    try { const metadata = JSON.parse(await readFile(path.join(folder, `${version}.json`), 'utf8')); if (typeof metadata.inheritsFrom !== 'string') break; version = metadata.inheritsFrom; }
    catch { break; }
  }
  throw new Error('此实例未找到与正式 / 历史公开版本校验值匹配的客户端。快照与修改版客户端暂不进入原版兼容配置。');
}
async function javaDecoderForVersion(root: string, release: JavaRelease, kind: JavaDecoder['kind'], clientFile: string): Promise<JavaDecoder | undefined> {
  const libraries = release.audioLibraries.filter(l => libraryAllowed(l, process.platform, process.arch, osRelease()) && (kind === 'jorbis' ? /^org\.jcraft:jorbis:/.test(l.name) : /^com\.paulscode:(?:codecjorbis|soundsystem):/.test(l.name)));
  const embedded = kind === 'legacy-jorbis' && clientEmbeddedLegacyCodec(release);
  if (!libraries.length && !embedded) return undefined;
  const helper = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'java') : path.join(__dirname, 'java');
  const classpath = [helper];
  if (embedded) {
    if (createHash('sha1').update(await readFile(clientFile)).digest('hex') !== release.clientSha1) throw new Error('客户端内嵌 JOrbis 解码器校验失败。');
    classpath.push(clientFile);
  }
  for (const library of libraries) {
    const artifact = library.downloads?.artifact; if (!artifact || artifact.path.includes('..')) return undefined;
    const filename = path.join(root, 'libraries', ...artifact.path.split('/')); if (!await exists(filename)) return undefined;
    if (createHash('sha1').update(await readFile(filename)).digest('hex') !== artifact.sha1) throw new Error(`JOrbis 依赖校验失败：${library.name}`);
    classpath.push(filename);
  }
  const executableName = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', executableName) : '', 'java'];
  for (const executable of candidates.filter(Boolean)) {
    try { await executeFile(executable, ['-version'], { windowsHide: true, timeout: 10000 }); const decoder = { executable, classpath, kind }; permittedDecoders.add(JSON.stringify(decoder)); return decoder; }
    catch { /* try next installed runtime */ }
  }
  return undefined;
}
async function loadMinecraft(root: string, index: string, version: string): Promise<SampleLibrary> {
  root = path.resolve(root);
  if (!permittedRoots.has(root) || path.basename(index) !== index || path.basename(version) !== version) throw new Error('请选择已发现的 Minecraft 资源目录。');
  const client = await resolveClient(root, version);
  if (client.release.assetIndex && index !== `${client.release.assetIndex}.json`) throw new Error(`${client.release.id} 对应资源索引 ${client.release.assetIndex}.json，请选择匹配的索引。`);
  const indexBytes = await readFile(path.join(root, 'assets', 'indexes', index)), resourceIndexSha1 = createHash('sha1').update(indexBytes).digest('hex');
  const indexData = JSON.parse(indexBytes.toString('utf8'));
  const readObject = async (value: { hash: string }) => {
    if (!/^[a-f0-9]{40}$/.test(value.hash)) throw new Error('资源对象校验值无效。');
    const filename = path.join(root, 'assets', 'objects', value.hash.slice(0, 2), value.hash);
    const bytes = await readFile(filename);
    if (createHash('sha1').update(bytes).digest('hex') !== value.hash) throw new Error(`资源校验失败：${value.hash}`);
    return bytes;
  };
  const { soundEvents, samples } = await loadNoteBlockSoundAssets(indexData, soundAssetLayout(client.hash, indexData), readObject);
  const warnings = client.release.assetIndexSha1 && resourceIndexSha1 !== client.release.assetIndexSha1 ? ['本机资源索引与当前官方索引不同，已记录实际采样校验值，需进一步对照。'] : [];
  const { decoderKind, attenuationModel } = audioImplementation(client.release);
  if (decoderKind === 'unknown') warnings.push('此版本的声音代码尚未完成核对，暂不启用原版解码路径；可明确选择 Web Audio 近似试听。');
  const javaDecoder = decoderKind === 'jorbis' || decoderKind === 'legacy-jorbis' ? await javaDecoderForVersion(root, client.release, decoderKind, client.filename) : undefined;
  if ((decoderKind === 'jorbis' || decoderKind === 'legacy-jorbis') && !javaDecoder) warnings.push('该版本需要本机 Java 运行时及匹配的 JOrbis 依赖。原版解码器尚不可用。');
  const nativeLibrary = await nativeForVersion(root, client.release);
  const nativeDecoder = decoderKind === 'stb' ? await nativeForVersion(root, client.release, 'stb') : undefined;
  if (!nativeLibrary) warnings.push(nativeArtifacts(client.release, 'openal', process.platform, process.arch, osRelease()).length
    ? '此实例缺少原始声音库。请补齐客户端资源，或在设置中选择 Web Audio 快速近似试听。'
    : '此客户端未提供匹配当前应用架构的原生声音库。可使用匹配的应用版本，或选择 Web Audio 快速近似试听。');
  if (decoderKind === 'stb' && !nativeDecoder) warnings.push('此实例没有可用的原版声音解码库。请补齐匹配的客户端资源。');
  return { root, version: client.release.id, instanceVersion: version, assetIndex: index, clientSha1: client.hash, resourceIndexSha1, warnings, decoderKind, soundEvents, javaDecoder, attenuationModel,
    profileId: `java-${client.release.id}`, samples, nativeLibrary, nativeDecoder };
}
function setupHandlers() {
  handle('renderer:ready', async () => {
    rendererReady = true; await flushOpenFiles();
    for (const command of pendingMenuCommands.splice(0)) window?.webContents.send('menu', command);
  });
  handle('project:dirty', async (dirty: boolean) => { if (typeof dirty !== 'boolean') throw new Error('无效工程状态。'); dirtyProject = dirty; });
  handle('window:close-saved', async (quit = false) => {
    if (typeof quit !== 'boolean' || dirtyProject) throw new Error('工程仍有未保存的修改，或关闭请求无效。');
    if (quit) app.quit(); else window?.destroy();
  });
  handle('file:open', async (kind: string) => {
    const extensions = kind === 'project' ? ['nbsx', 'mid', 'midi', 'nbs', 'flp'] : ['wav', 'ogg', 'mp3', 'flac'];
    const result = await dialog.showOpenDialog(window!, { title: kind === 'project' ? '打开工程或导入 MIDI / NBS / FLP' : '选择声音文件', properties: ['openFile'], filters: [{ name: '支持的文件', extensions }] });
    if (result.canceled) return null;
    const filename = result.filePaths[0], details = await stat(filename);
    if (details.size > 256 * 1024 * 1024) throw new Error('文件大于 256 MB。');
    permittedFiles.add(filename); return { path: filename, name: path.basename(filename), bytes: new Uint8Array(await readFile(filename)) };
  });
  handle('flp:inspect-samples', async (sourcePath: string, samples: { id: number; path: string }[]) => {
    if (typeof sourcePath !== 'string' || !permittedFiles.has(sourcePath)) throw new Error('请先打开此 FLP 工程。');
    return inspectFlpSamples(sourcePath, samples);
  });
  handle('file:save', async ({ name, bytes, path: target }: { name: string; bytes: Uint8Array; path?: string }) => {
    checkBytes(bytes);
    if (target && !permittedFiles.has(target)) throw new Error('保存位置尚未通过文件对话框选择。');
    if (!target) {
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!['nbsx', 'nbs', 'mid', 'wav', 'json'].includes(ext)) throw new Error('不支持的文件类型。');
      const result = await dialog.showSaveDialog(window!, { defaultPath: safeName(name), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (result.canceled || !result.filePath) return null; target = result.filePath; permittedFiles.add(target);
    }
    if (target.endsWith('.nbsx') && await exists(target)) {
      const backupRoot = path.join(app.getPath('userData'), 'backups'); await mkdir(backupRoot, { recursive: true });
      await copyFile(target, path.join(backupRoot, `${Date.now()}-${safeName(path.basename(target))}`));
      const backups = (await childNames(backupRoot, false)).sort().reverse();
      for (const old of backups.slice(30)) await unlink(path.join(backupRoot, old));
    }
    await atomicWrite(target, bytes); return target;
  });
  handle('minecraft:discover', discoverMinecraft);
  handle('minecraft:select-root', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '选择 Minecraft 目录（包含 assets、libraries、versions）', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const root = path.resolve(result.filePaths[0]), versions = await childNames(path.join(root, 'versions'));
    const indexes = (await childNames(path.join(root, 'assets', 'indexes'), false)).filter(n => n.endsWith('.json'));
    if (!versions.length || !indexes.length) throw new Error('该目录没有客户端版本和资源索引，请选择完整的 Minecraft 目录。');
    permittedRoots.add(root); const entry = { root, versions, indexes };
    discovered ??= []; if (!discovered.some(r => locationKey(r.root) === locationKey(root))) discovered.push(entry); return entry;
  });
  handle('minecraft:load', async ({ root, index, version }) => loadMinecraft(String(root), String(index), String(version)));
  handle('project:autosave', async (bytes: Uint8Array) => { checkBytes(bytes); await atomicWrite(path.join(app.getPath('userData'), 'recovery.nbsx'), bytes); });
  handle('project:recover', async () => {
    const filename = path.join(app.getPath('userData'), 'recovery.nbsx');
    if (!await exists(filename)) return null;
    const bytes = new Uint8Array(await readFile(filename)); let projectId: string | undefined;
    try { projectId = projectIdFromContainer(bytes); } catch { /* damaged recovery remains available for explicit discard */ }
    return { name: '恢复的工程.nbsx', bytes, projectId };
  });
  handle('project:clear-recovery', async (projectId?: string) => {
    const filename = path.join(app.getPath('userData'), 'recovery.nbsx');
    if (!await exists(filename)) return;
    if (projectId !== undefined) {
      if (typeof projectId !== 'string' || projectId.length > 200) throw new Error('工程标识无效。');
      if (projectIdFromContainer(new Uint8Array(await readFile(filename))) !== projectId) return;
    }
    await unlink(filename);
  });
  handle('audio:render', async (request: NativeRenderRequest) => {
    const vector = (value: unknown, length: number) => Array.isArray(value) && value.length === length && value.every(n => typeof n === 'number' && Number.isFinite(n));
    if (request.listener && (!vector(request.listener.position, 3) || !vector(request.listener.orientation, 6) || !Number.isFinite(request.listener.gain ?? 1))) throw new Error('听音视角参数无效。');
    if (request.broadcast && (!vector(request.broadcast.listenerPosition, 3) || !Number.isFinite(request.broadcast.range) || request.broadcast.range <= 0)) throw new Error('声音发送距离参数无效。');
    if (request.outputLimiter !== undefined && typeof request.outputLimiter !== 'boolean') throw new Error('输出限幅设置无效。');
    if (request.hrtf !== undefined && !['device-default', 'enable-only-reset', 'explicit-reset', 'context-attributes', 'first-profile'].includes(request.hrtf) || request.hrtf === 'device-default' && request.directional) throw new Error('方向音频设置无效。');
    if (!permittedLibraries.has(request.nativeLibrary) || (request.nativeDecoder && !permittedLibraries.has(request.nativeDecoder)) || (request.javaDecoder && !permittedDecoders.has(JSON.stringify(request.javaDecoder))) || !Number.isFinite(request.duration) || request.duration <= 0 || request.duration > 1800 || ![22050, 44100, 48000, 96000].includes(request.sampleRate) || request.events.length > 2000000) throw new Error('原生音频渲染请求无效或过大。');
    if (request.events.some(event => event.frame !== undefined && (!Number.isSafeInteger(event.frame) || event.frame < 0) || event.tick !== undefined && (!Number.isFinite(event.tick) || event.tick < 0))) throw new Error('音符起音帧参数无效。');
    return new Promise((resolve, reject) => {
      const worker = utilityProcess.fork(path.join(__dirname, 'audio-worker.cjs'), [], { stdio: 'pipe' });
      let settled = false;
      worker.on('message', (message: any) => { if (settled) return; settled = true; worker.kill(); message.error ? reject(new Error(message.error)) : resolve(message.result); });
      worker.on('exit', code => { if (!settled) { settled = true; reject(new Error(`原生渲染进程退出（${code}）。`)); } });
      worker.postMessage(request);
    });
  });
}
function createWindow() {
  dirtyProject = false; rendererReady = false;
  window = new BrowserWindow({ width: 1600, height: 1000, minWidth: 1050, minHeight: 720, backgroundColor: '#232426', title: APP_NAME, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', () => { rendererReady = false; window = undefined; });
  window.on('close', event => {
    if (!dirtyProject) return;
    event.preventDefault();
    requestProjectClose(false);
  });
  window.webContents.on('will-navigate', (event, url) => { if (url !== window!.webContents.getURL()) event.preventDefault(); });
  window.once('ready-to-show', () => window?.show());
  const devUrl = !app.isPackaged && process.env.NBSX_DEV_URL;
  if (devUrl && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(devUrl)) void window.loadURL(devUrl);
  else void window.loadURL('nbsx://app/index.html');
}
if (primaryInstance) app.whenReady().then(() => {
  protocol.handle('nbsx', request => {
    const url = new URL(request.url); const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.resolve(appRoot, 'dist', relative || 'index.html');
    if (url.hostname !== 'app' || !target.startsWith(path.join(appRoot, 'dist') + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'midi' || permission === 'midiSysex'));
  setupHandlers();
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu(process.platform, sendMenuCommand)));
  createWindow();
  app.on('activate', () => showWindow());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
