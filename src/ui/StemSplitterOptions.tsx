import { Fragment, useState } from 'react';
import { CaretUpDown, DotsThreeCircle, Guitar, MicrophoneStage, PianoKeys, Waveform } from '@phosphor-icons/react';
import { DRUM_ROLES, selectedStemSources, type DrumRole, type StemRole, type StemSourceRole } from '../core/audio-assist';
import { omittedStemSources, STEM_SPLITTER_PRESETS, type StemSplitterPreset, type StemSplitterSettings } from '../core/stem-splitter-presets';

function DrumKitIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="16.5" r="5" /><path d="M3 5v15m18-15v15M1 6h4m14 0h4M1 20h4m14 0h4M7 9h4v3m2 0V9h4m-5 12.5V23" />
    <path d="M6 8.5h5m2 0h5" />
  </svg>;
}

function BassIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 14 9-10 2 1-9 11m7-12 1-2 3 1-2 2M7 13c-1.8-1.4-3.2.3-2.3 1.8-2.6 1-3.2 3.3-1.4 5.1 2 2 5 1.4 5.9-1.5 1.6.8 3.2-.8 1.8-2.5M5.5 18l2-2" />
  </svg>;
}

const stems = [
  { role: 'vocals', name: '声乐', icon: MicrophoneStage },
  { role: 'drums', name: '鼓', icon: DrumKitIcon },
  { role: 'bass', name: '贝斯', icon: BassIcon },
  { role: 'guitar', name: '吉他', icon: Guitar },
  { role: 'piano', name: '钢琴', icon: PianoKeys },
  { role: 'other', name: '其他', icon: Waveform },
] as const;
const drumNames: Record<DrumRole, string> = {
  kick: '底鼓', snare: '小军鼓', 'hi-hat': '踏钹', toms: '嗵嗵鼓', 'other-drums': '鼓其他（含铙钹残余）',
};
const sourceName = (role: StemSourceRole) => stems.find(stem => stem.role === role)?.name ?? drumNames[role as DrumRole];
function matchingPreset(settings: StemSplitterSettings) {
  const selected = selectedStemSources(settings);
  return Object.entries(STEM_SPLITTER_PRESETS).find(([, { settings: option }]) => {
    const roles = selectedStemSources(option);
    return option.drumPieces === settings.drumPieces && option.includeSubmix === settings.includeSubmix
      && roles.length === selected.length && roles.every(role => selected.includes(role))
      && option.submix.length === settings.submix.length && option.submix.every(role => settings.submix.includes(role));
  })?.[0] ?? 'custom';
}

export function StemSplitterOptions({ settings, disabled, canSplitDrums, onChange }: {
  settings: StemSplitterSettings;
  disabled: boolean;
  canSplitDrums: boolean;
  onChange: (settings: StemSplitterSettings) => void;
}) {
  const [showSubmix, setShowSubmix] = useState(false);
  const selected = selectedStemSources(settings), omitted = omittedStemSources(settings);
  const kit = DRUM_ROLES.filter(role => selected.includes(role));
  function choose(patch: Partial<StemSplitterSettings>) {
    const next = { ...settings, ...patch };
    const members = omittedStemSources(next).filter(role => settings.submix.includes(role)
      || !omitted.includes(role) && !DRUM_ROLES.includes(role as DrumRole));
    onChange({ ...next, submix: members, includeSubmix: settings.includeSubmix && members.length >= 2 });
  }
  function chooseSource(role: StemSourceRole, checked: boolean) {
    if (DRUM_ROLES.includes(role as DrumRole)) {
      choose({ drumRoles: checked ? [...kit, role as DrumRole] : kit.filter(item => item !== role) });
    } else choose({ stems: checked ? [...settings.stems, role as StemRole] : settings.stems.filter(item => item !== role) });
  }
  function toggleKit(enabled: boolean) {
    if (enabled) choose({ drumPieces: true, drumRoles: settings.stems.includes('drums') ? [...DRUM_ROLES] : [] });
    else {
      const stems: StemRole[] = settings.stems.filter(role => role !== 'drums');
      if (kit.length) stems.push('drums');
      choose({ drumPieces: false, drumRoles: undefined, stems });
    }
  }
  return <section className="aa-split-options" aria-label="分轨设置">
    <label className="aa-preset">预置<span className="aa-preset-control">
      <select aria-label="分轨预置" disabled={disabled} value={matchingPreset(settings)} onChange={event => {
        const next = STEM_SPLITTER_PRESETS[event.target.value as StemSplitterPreset];
        if (next) onChange(next.settings);
        setShowSubmix(false);
      }}>{Object.entries(STEM_SPLITTER_PRESETS).map(([key, option]) => <option key={key} value={key} disabled={key === 'drumPieces' && !canSplitDrums}>{option.label}</option>)}<option value="custom" disabled>无</option></select>
      <span className="aa-preset-chevron" aria-hidden="true"><CaretUpDown size={12} weight="bold" /></span>
    </span></label>
    <div className="aa-stem-choice" role="group" aria-label="要添加的分轨">
      {stems.map(({ role, name, icon: Icon }) => <div key={role} data-role={role}>
        <div className="aa-stem-option">
          <label className="aa-stem-label"><span className="aa-stem-icon" aria-hidden="true"><Icon size={25}/></span>{role === 'drums' && settings.drumPieces ? `${name} (${kit.length})` : name}
            {(role !== 'drums' || !settings.drumPieces) && <input aria-label={name} type="checkbox" checked={selected.includes(role)}
              disabled={disabled} onChange={event => chooseSource(role, event.target.checked)}/>}</label>
          {role === 'drums' && <label className="aa-drum-pieces">单个鼓件
            <input type="checkbox" role="switch" checked={settings.drumPieces} disabled={disabled || !canSplitDrums}
              onChange={event => toggleKit(event.target.checked)}/></label>}
        </div>
        {role === 'drums' && settings.drumPieces && <div className="aa-kit-choices" role="group" aria-label="鼓件">
          {DRUM_ROLES.map(role => <Fragment key={role}>
            {role === 'other-drums' && <label className="aa-unavailable-kit" title="当前模型将铙钹保留在鼓其他残余中">铙钹（独立提取暂不可用）<input type="checkbox" disabled checked={false} readOnly/></label>}
            <label>{drumNames[role]}<input type="checkbox" checked={kit.includes(role)}
              disabled={disabled} onChange={event => chooseSource(role, event.target.checked)}/></label>
          </Fragment>)}
        </div>}
      </div>)}
    </div>
    <div className="aa-submix">
      <small className="aa-submix-description">从取消选择的大分轨创建一个额外的子混音。</small>
      <div className="aa-submix-row"><label className="aa-submix-label">
        <span className="aa-stem-icon" aria-hidden="true"><Waveform size={21} /></span>子混音
        <input type="checkbox" checked={settings.includeSubmix} disabled={disabled || settings.submix.length < 2}
          onChange={event => onChange({ ...settings, includeSubmix: event.target.checked })}/>
      </label>
        <button type="button" disabled={disabled || omitted.length < 2} aria-expanded={showSubmix && omitted.length >= 2}
          onClick={() => setShowSubmix(!showSubmix)} aria-label="选择子混音声部"><DotsThreeCircle size={18} aria-hidden="true" /></button>
      </div>
      {settings.includeSubmix && settings.submix.length >= 2 && <small className="aa-submix-summary">{settings.submix.map(sourceName).join('、')}</small>}
      {showSubmix && omitted.length >= 2 && <div className="aa-submix-roles" role="group" aria-label="子混音声部">
        {omitted.map(role => <label key={role}>
          <input type="checkbox" checked={settings.submix.includes(role)} disabled={disabled}
            onChange={event => {
              const submix = event.target.checked ? [...settings.submix, role] : settings.submix.filter(item => item !== role);
              onChange({ ...settings, submix, includeSubmix: settings.includeSubmix && submix.length >= 2 });
            }}/>{sourceName(role)}
        </label>)}
        <button type="button" onClick={() => setShowSubmix(false)}>完成</button>
      </div>}
    </div>
  </section>;
}
