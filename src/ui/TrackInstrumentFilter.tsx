import { filterTracks, trackInstrumentOptions } from '../core/track-filter';
import type { Instrument, Track } from '../core/types';

export interface TrackInstrumentFilterProps {
  tracks: readonly Track[];
  instruments: readonly Instrument[];
  value: string;
  onChange: (value: string) => void;
  context: '编曲区' | '混音器';
}

export function TrackInstrumentFilter({ tracks, instruments, value, onChange, context }: TrackInstrumentFilterProps) {
  const options = trackInstrumentOptions(tracks, instruments, value), visible = filterTracks(tracks, value).length;
  return <div className="track-instrument-filter">
    <select aria-label={`${context}乐器筛选`} value={value}
      title="按轨道默认乐器筛选，仅影响显示；单音符音色不参与筛选。"
      onChange={event => onChange(event.currentTarget.value)}>
      <option value="">全部乐器（{tracks.length}）</option>
      {options.map(option => <option key={option.id} value={option.id}>{option.name}（{option.count}）</option>)}
    </select>
    <span>显示 {visible} / {tracks.length} 轨</span>
    <button type="button" aria-label={`清除${context}乐器筛选`} disabled={!value} onClick={() => { if (value) onChange(''); }}>清除</button>
  </div>;
}
