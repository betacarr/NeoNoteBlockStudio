import { INSTRUMENTS } from './instruments';

export type DiagnosticLevel = 'info' | 'warning' | 'error';
export interface DiagnosticInput { level: DiagnosticLevel; event: string; fields?: Record<string, unknown> }
export interface DiagnosticEntry extends DiagnosticInput { schema: 1; time: string; session: string; sequence: number }
export interface DiagnosticExportResult { status: 'saved' | 'canceled' | 'failed'; records?: number }
export const DIAGNOSTIC_EVENTS = new Set([
  'app.started', 'app.ready', 'app.quit', 'app.warning', 'app.fatal', 'window.loaded', 'window.load_failed',
  'window.renderer_gone', 'worker.gone', 'renderer.ready', 'renderer.error', 'renderer.rejection', 'renderer.console',
  'ipc.failed', 'audio.preview.ready', 'audio.preview.failed', 'audio.context', 'audio.play.request',
  'audio.play.started', 'audio.play.stopped', 'audio.play.failed', 'audio.audition.failed', 'audio.output.signal',
  'audio.resources.ready', 'audio.resources.failed', 'audio.snapshot', 'project.opened', 'project.open.failed',
  'export.started', 'export.completed', 'export.failed', 'diagnostics.exported', 'diagnostics.export.failed',
]);
export const RENDERER_DIAGNOSTIC_EVENTS = new Set([...DIAGNOSTIC_EVENTS].filter(event =>
  /^(?:renderer\.(?:ready|error|rejection)|audio\.|project\.|export\.)/.test(event)));
const numericFields = new Set(['loadedSamples', 'expectedSamples', 'sampleRate', 'tracks', 'audibleTracks', 'mutedTracks',
  'soloTracks', 'notes', 'masterGain', 'fromTick', 'durationMs', 'bytes', 'peak', 'signalTracks', 'exitCode', 'records', 'errorCode']);
const enums: Record<string, readonly string[]> = {
  mode: ['realtime', 'native-compare'], source: ['builtin', 'local', 'project', 'mixed', 'none'],
  format: ['nbsx', 'nbs', 'mid', 'midi', 'flp', 'wav', 'unknown'],
  contextState: ['running', 'suspended', 'interrupted', 'closed', 'uninitialized', 'unknown'],
  reason: ['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction', 'unknown'],
  processType: ['Browser', 'Utility', 'GPU', 'Zygote', 'Sandbox helper', 'renderer', 'unknown'],
  origin: ['uncaughtException', 'unhandledRejection', 'unknown'],
  platform: ['win32', 'darwin', 'linux'], arch: ['x64', 'arm64', 'ia32'],
};
const operations = new Set(['file:open', 'file:save', 'flp:inspect-samples', 'minecraft:discover', 'minecraft:select-root',
  'minecraft:load', 'audio:render', 'project:autosave', 'project:recover', 'project:clear-recovery', 'renderer:ready',
  'project:dirty', 'window:close-saved', 'diagnostics:record', 'diagnostics:export', 'diagnostics:open-folder']);
const builtinIds = new Set(INSTRUMENTS.map(item => item.id));
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Applied before disk writes and again when reading a diagnostic archive. */
export function createDiagnosticRedactor(privateValues: readonly string[] = []) {
  const terms = [...new Set(privateValues.filter(value => value.length >= 3).flatMap(value => [value, value.replaceAll('\\', '/'), value.replaceAll('\\', '\\\\')]))]
    .sort((a, b) => b.length - a.length).map(value => new RegExp(escapePattern(value), 'gi'));
  return (value: string): string => {
    let text = value.slice(0, 8192);
    text = text
      .replace(/(?:https?|file|nbsx):\/\/[^\s"'<>)]*/gi, '[地址]')
      .replace(/[A-Za-z]:[\\/][^\r\n"'<>|)]+/g, '[路径]')
      .replace(/\\\\[^\r\n"'<>|)]+/g, '[路径]')
      .replace(/(^|[\s("'=])\/(?!\/)[^\r\n"'<>|)]+/gm, '$1[路径]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱]')
      .replace(/\b(?:github_pat_[A-Za-z0-9_]{15,}|gh[pousr]_[A-Za-z0-9]{15,}|sk-(?:proj-)?[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, '[凭据]')
      .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [凭据]')
      .replace(/\b(?:password|passwd|token|api[_-]?key|secret|authorization)\s*[:=][^\r\n]*/gi, '[凭据]')
      .replace(/[^\r\n"'<>|/\\]*\.(?:nbsx|nbs|mid|midi|flp|wav|ogg|mp3|flac|pcm|jar|zip)\b/gi, '[文件]')
      .replace(/\b[A-Za-z0-9+/=_-]{100,}\b/g, '[数据]')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    for (const term of terms) text = text.replace(term, '[私密信息]');
    return text;
  };
}

export function diagnosticError(error: unknown, redact = createDiagnosticRedactor()): Record<string, string> {
  try {
    const item = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown } : { message: String(error) };
    const name = typeof item.name === 'string' && /^(?:Error|TypeError|SyntaxError|RangeError|ReferenceError|URIError|EvalError|AggregateError|DOMException|NotAllowedError|NotSupportedError|AbortError|TimeoutError)$/.test(item.name) ? item.name : 'Error';
    const clean = (text: string) => redact(text).replace(/(["'`])[^\r\n]*?\1/g, '[内容]').slice(0, 600);
    let message = typeof item.message === 'string' ? clean(item.message) : '未提供错误说明';
    if (/缺少.*采样/.test(message)) message = '缺少采样（自定义名称已隐藏）';
    const result: Record<string, string> = { name, message };
    if (typeof item.code === 'string' && /^(?:ERR_[A-Z0-9_]{1,64}|E[A-Z0-9_]{1,32})$/.test(item.code)) result.code = item.code;
    if (typeof item.stack === 'string') result.stack = item.stack.slice(0, 8192).split('\n').filter(line => /^\s*at\s|^[\w.$]+@/.test(line)).slice(0, 8).map(line => clean(line).slice(0, 240)).join('\n');
    return result;
  } catch { return { name: 'Error', message: '错误说明无法读取' }; }
}

export function normalizeDiagnostic(input: unknown, redact = createDiagnosticRedactor()): DiagnosticInput | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as DiagnosticInput;
  if (!['info', 'warning', 'error'].includes(value.level) || !DIAGNOSTIC_EVENTS.has(value.event)) return;
  const fields: Record<string, unknown> = {};
  if (value.fields && typeof value.fields === 'object' && !Array.isArray(value.fields) && Object.keys(value.fields).length <= 32) {
    for (const [key, item] of Object.entries(value.fields)) {
      if (numericFields.has(key) && typeof item === 'number' && Number.isFinite(item)) fields[key] = Math.max(-1e9, Math.min(1e9, item));
      else if (Object.hasOwn(enums, key) && typeof item === 'string' && enums[key].includes(item)) fields[key] = item;
      else if (key === 'profileId' && typeof item === 'string' && /^java-[0-9][0-9a-z.+-]{0,40}$/i.test(item)) fields[key] = item;
      else if (key === 'bankId' && typeof item === 'string' && /^opennbs-noteblock-preview-v\d+$/.test(item)) fields[key] = item;
      else if (key === 'version' && typeof item === 'string' && /^\d+(?:\.[\dA-Za-z-]+){1,4}$/.test(item)) fields[key] = item;
      else if ((key === 'packaged' || key === 'playing') && typeof item === 'boolean') fields[key] = item;
      else if (key === 'operation' && typeof item === 'string' && operations.has(item)) fields[key] = item;
      else if (key === 'missingBuiltins' && Array.isArray(item)) fields[key] = [...new Set(item.filter(id => typeof id === 'string' && builtinIds.has(id)))].slice(0, 20);
      else if (key === 'error') fields[key] = diagnosticError(item, redact);
    }
  }
  return { level: value.level, event: value.event, fields };
}
