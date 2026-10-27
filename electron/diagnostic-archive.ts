import { strToU8, zipSync } from 'fflate';
import type { FileDiagnostics } from './diagnostics';

export function diagnosticArchive(snapshot: Awaited<ReturnType<FileDiagnostics['snapshot']>>, metadata: Record<string, unknown>, createdAt = new Date()) {
  const software: Record<string, unknown> = {};
  for (const key of ['version', 'platform', 'arch', 'osRelease', 'electron', 'chromium', 'node']) {
    const value = metadata[key];
    if (typeof value === 'string' && /^[A-Za-z0-9.+_-]{1,80}$/.test(value)) software[key] = value;
  }
  software.packaged = metadata.packaged === true;
  const latestAudio = [...snapshot.entries].reverse().find(entry => ['audio.snapshot', 'audio.play.started', 'audio.play.request'].includes(entry.event));
  const summary = { schema: 1, createdAt: createdAt.toISOString(), software, liveSnapshotCaptured: metadata.snapshotCaptured === true,
    logs: { storageAvailable: snapshot.storageAvailable, records: snapshot.entries.length, droppedRecords: snapshot.droppedRecords, policy: snapshot.policy },
    latestPlayback: latestAudio && { time: latestAudio.time, event: latestAudio.event, ...latestAudio.fields },
    privacy: { automaticUpload: false, projectContentsIncluded: false, audioFilesIncluded: false, environmentVariablesIncluded: false, redactionApplied: true } };
  return zipSync({
    'README.txt': strToU8('NeoNBS 诊断包\n\n本文件由用户主动导出，不会自动上传。\nsummary.json：软件版本、系统架构和最近播放状态。\nlogs/events.jsonl：经过筛选和脱敏的运行记录，可用文本编辑器打开。\n不包含工程文件、音符内容、曲目、采样、环境变量或完整磁盘目录。\n路径、邮箱和常见凭据会自动隐藏；自动过滤不能保证识别所有个人信息，发送前请解压检查。\n若日志目录不可写，诊断包仍可包含本次会话的有限内存记录。\n'),
    'summary.json': strToU8(JSON.stringify(summary, null, 2)),
    'logs/events.jsonl': strToU8(snapshot.entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'),
  }, { level: 6 });
}
