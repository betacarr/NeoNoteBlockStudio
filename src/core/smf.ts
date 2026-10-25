import { parseMidi, type MidiData } from 'midi-file';

// Check the binary envelope and event boundaries before the dependency creates
// objects. In particular, truncated data must not become a partial arrangement.
export function readStandardMidi(bytes: Uint8Array): { data: MidiData; extraChunks: number } {
  if (bytes.length > 64 * 1024 * 1024) throw new Error('MIDI 文件过大。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 14 || tag(0) !== 'MThd') throw new Error('不是有效的标准 MIDI 文件。');
  const headerSize = view.getUint32(4), format = view.getUint16(8), tracks = view.getUint16(10), division = view.getUint16(12);
  if (headerSize < 6 || headerSize + 8 > bytes.length) throw new Error('MIDI 头部不完整。');
  if (division & 0x8000) throw new Error('此 MIDI 使用 SMPTE 时间制，请先在 DAW 中转换为拍节时间制。');
  if (!division) throw new Error('MIDI 时间分辨率不能为零。');
  if (format === 2) throw new Error('MIDI 格式 2 含多个独立乐段，请先转换为格式 0 或 1 后导入。');
  if (format > 1 || !tracks || tracks > 10000 || (format === 0 && tracks !== 1)) throw new Error('MIDI 格式或轨道数量无效。');
  const chunks: Uint8Array[] = [bytes.subarray(0, headerSize + 8)];
  let cursor = headerSize + 8, trackCount = 0, eventCount = 0, extraChunks = 0;
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) throw new Error('MIDI 数据块头部不完整。');
    const size = view.getUint32(cursor + 4), end = cursor + 8 + size;
    if (end > bytes.length) throw new Error('MIDI 数据块在文件结束前被截断。');
    if (tag(cursor) !== 'MTrk') { extraChunks++; cursor = end; continue; }
    if (++trackCount > tracks) throw new Error('MIDI 实际轨道数量超过文件头声明。');
    chunks.push(bytes.subarray(cursor, end));
    let at = cursor + 8, running = 0;
    const read = () => { if (at >= end) throw new Error('MIDI 事件在文件结束前被截断。'); return bytes[at++]; };
    const vlq = () => {
      let value = 0;
      for (let i = 0; i < 4; i++) { const byte = read(); value = value * 128 + (byte & 127); if (byte < 128) return value; }
      throw new Error('MIDI 可变长度整数超过四字节。');
    };
    while (at < end) {
      if (++eventCount > 2000000) throw new Error('MIDI 事件超过 200 万个，请拆分文件后导入。');
      vlq(); let status = read(), first: number | undefined;
      if (status < 128) { if (!running) throw new Error('MIDI 缺少运行状态。'); first = status; status = running; }
      if (status === 0xff || status === 0xf0 || status === 0xf7) {
        if (status === 0xff) read();
        const length = vlq(); if (at + length > end) throw new Error('MIDI 消息数据被截断。'); at += length;
      } else {
        if (status < 0x80 || status >= 0xf0) throw new Error('MIDI 含不支持的事件状态。');
        running = status;
        const parameters = status >> 4 === 0xc || status >> 4 === 0xd ? 1 : 2;
        for (let i = first === undefined ? 0 : 1; i < parameters; i++) if (read() > 127) throw new Error('MIDI 通道数据字节无效。');
      }
    }
    cursor = end;
  }
  if (trackCount !== tracks) throw new Error('MIDI 轨道缺失，无法完整导入。');
  let input = bytes;
  if (extraChunks) { input = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let at = 0; for (const chunk of chunks) { input.set(chunk, at); at += chunk.length; } }
  try { return { data: parseMidi(input), extraChunks }; }
  catch (error) { throw new Error(`MIDI 事件无法读取：${error instanceof Error ? error.message : String(error)}`); }
}
