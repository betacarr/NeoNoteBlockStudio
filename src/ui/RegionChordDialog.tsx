import { useState } from 'react';
import type { ChordRange } from '../core/chord-track';
import { Modal } from './Modal';

export function RegionChordDialog({ title = '编辑片段和弦', name, chords, format, onApply, onClose }: {
  title?: string;
  name: string;
  chords: readonly ChordRange[];
  format: (position: number) => string;
  onApply: (labels: string[]) => void;
  onClose: () => void;
}) {
  const [labels, setLabels] = useState(() => chords.map(chord => chord.name));
  return <Modal title={title} onClose={onClose}>
    <div className="modal-body">
      <p>{name}</p>
      <div className="region-chord-editor">
        {chords.map((chord, index) => <label key={chord.start}>
          <span>{format(chord.start)} – {format(chord.end)}</span>
          <input aria-label={`和弦 ${index + 1}`} value={labels[index]} maxLength={128}
            onChange={event => setLabels(labels.map((label, at) => at === index ? event.target.value : label))}/>
        </label>)}
      </div>
      <div className="button-row end">
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={labels.some(label => !label.trim())} onClick={() => onApply(labels.map(label => label.trim()))}>应用</button>
      </div>
    </div>
  </Modal>;
}
