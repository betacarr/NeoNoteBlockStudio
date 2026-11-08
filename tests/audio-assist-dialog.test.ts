import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUDIO_ASSIST_MAX_INPUT, AudioAssistDialog, AudioModelDownloadCard, audioAssistBeatPreview, cycleAudioAssistFocus, stepAudioAssistHistory } from '../src/ui/AudioAssistDialog';
import { createProject } from '../src/core/project';
import type { AudioWorkspace, AudioModelStatus } from '../src/core/audio-assist';

function projectWithAudio(stems = 6) {
  const project = createProject('测试');
  const workspace: AudioWorkspace = {
    id: 'audio-test', name: '独立测试音频', sourceAssetId: 'audio-source', duration: 8, sampleRate: 44100, frames: 352800,
    stems: Array.from({ length: stems }, (_, i) => ({ id: `stem-${i}`, role: `role-${i}`, name: `分轨${i+1}`, assetId: `stem-asset-${i}`, muted: false, solo: false, gain: 1 })),
    bpm: 120, firstBeat: .25, beats: [.25,.75,1.25], chords: [{ id:'c1',name:'C',start:0,end:4,confidence:.4 },{id:'c2',name:'G',start:4,end:8,confidence:.9}],
    model: { id:'test',version:'1' }, loop: { enabled:false,start:0,end:8 },
  };
  project.audioWorkspace = workspace;
  project.assets = [{id:'audio-source',name:'源音频.wav',mime:'audio/wav',data:'AA=='}, ...workspace.stems.map(s=>({id:s.assetId,name:s.name,mime:'audio/wav',data:'AA=='}))];
  return project;
}
const render = (project = createProject('测试')) => renderToStaticMarkup(createElement(AudioAssistDialog, {project, onApply:()=>{throw new Error('render must not apply');},onClose:()=>{}}));

describe('audio assistant transaction UI', () => {
  it('keeps CPU as default and never requires an optional GPU package', () => {
    const html=renderToStaticMarkup(createElement(AudioAssistDialog,{project:createProject(),mode:'split',onApply:()=>{},onClose:()=>{}}));
    expect(html).toContain('默认使用 CPU');expect(html).toContain('CPU 线程数');expect(html).toContain('CPU 内存模式');
    expect(html).toContain('不会自动下载 GPU 运行包');expect(html).toMatch(/aria-label="尝试 GPU 加速"[^>]*disabled=""/);
    expect(html).not.toMatch(/aria-label="尝试 GPU 加速"[^>]*checked=""/);
  });
  it('retains the 64 MiB limit only for browser/legacy byte transfers', () => expect(AUDIO_ASSIST_MAX_INPUT).toBe(64 * 1024 * 1024));
  it('bounds long-song preview work while covering the last beat without truncating the data', () => {
    const beats = Array.from({length: 5000},(_,i)=>i*.5), preview = audioAssistBeatPreview(beats);
    expect(preview).toHaveLength(300); expect(preview[0]).toEqual({i:0,beat:0}); expect(preview.at(-1)).toEqual({i:4999,beat:2499.5});
    expect(beats).toHaveLength(5000); expect(audioAssistBeatPreview([.25])).toEqual([{i:0,beat:.25}]); expect(audioAssistBeatPreview([])).toEqual([]);
    const project = projectWithAudio(); project.audioWorkspace!.duration=2500; project.audioWorkspace!.frames=2500*44100; project.audioWorkspace!.beats=beats;
    const html = render(project); expect(html).toContain('拍点序号'); expect(html).toContain('max="5000"'); expect(html).toContain('完整 5000 拍');
  });
  it('explains paired external audio storage and provides an explicit hash-checked relink entry', () => {
    const project = projectWithAudio(1); project.assets[0].audioFile={file:'audio/test.wav',sha256:'a'.repeat(64),bytes:1000,sampleRate:44100,frames:352800,channels:2}; delete project.assets[0].data;
    const html = render(project); expect(html).toContain('定位缺失音频…'); expect(html).toContain('需定位的音频资源'); expect(html).toContain('校验值完全相同'); expect(html).toContain('工程文件名.assets'); expect(html).toContain('旧版嵌入音频仍可打开');
  });
  it('captures the edited workspace for redo before the current ref changes', () => {
    const before = projectWithAudio().audioWorkspace!, edited = structuredClone(before);
    edited.chords[0].name = 'Cmaj7-test'; edited.bpm = 123;
    let current = edited;
    const undo = stepAudioAssistHistory(current, [before], [], false)!;
    current = undo.current;
    expect(current.chords[0].name).toBe('C');
    // Simulates React applying queued history setters after current was changed.
    expect(undo.future[0]).toBe(edited);
    const redo = stepAudioAssistHistory(current, undo.past, undo.future, true)!;
    expect(redo.current.chords[0].name).toBe('Cmaj7-test'); expect(redo.current.bpm).toBe(123);
    expect(redo.past[0]).toBe(before); expect(redo.future).toEqual([]);
  });
  it('wraps Tab and Shift+Tab within visible controls, skipping hidden controls', () => {
    let focused: unknown;
    const make = (hidden = false) => ({ closest: () => hidden ? {} : null, getClientRects: () => hidden ? [] : [{}], focus() { focused = this; } });
    const first = make(), middle = make(), last = make(), hidden = make(true);
    const document = { activeElement: last as unknown };
    const section = { querySelectorAll: () => [first,middle,last,hidden], ownerDocument: document, contains: (v: unknown) => [first,middle,last,hidden].includes(v as typeof first), focus() { focused = this; } } as unknown as HTMLElement;
    expect(cycleAudioAssistFocus(section,false)).toBe(true); expect(focused).toBe(first);
    document.activeElement = first; expect(cycleAudioAssistFocus(section,true)).toBe(true); expect(focused).toBe(last);
    document.activeElement = middle; expect(cycleAudioAssistFocus(section,false)).toBe(false);
    document.activeElement = section; expect(cycleAudioAssistFocus(section,false)).toBe(true); expect(focused).toBe(first);
  });
  it('keeps focus on the dialog if all controls are disabled or hidden', () => {
    let focused = false;
    const section = { querySelectorAll: () => [],ownerDocument:{activeElement:null},focus:()=>{focused=true;} } as unknown as HTMLElement;
    expect(cycleAudioAssistFocus(section,false)).toBe(true); expect(focused).toBe(true);
  });
  it('starts with an honest local analysis empty state, no automatic tempo mutation', () => {
    const html = render();
    expect(html).toContain('尚未选择音频');
    expect(html).toContain('和弦与速度分析不需要分轨模型');
    expect(html).toMatch(/disabled=""[^>]*>应用分析/);
    expect(html).not.toContain('自动转 MIDI');
  });
  it.each([1, 2, 6, 8])('renders every stem rather than assuming four or six (%i)', count => {
    const project = projectWithAudio(count), before = structuredClone(project), html = render(project);
    expect(html.match(/data-stem-role=/g)).toHaveLength(count);
    expect(html).toContain(`分轨${count}静音`);
    expect(html).toContain(`分轨${count}独奏`);
    expect(html).toContain(`导出分轨${count}WAV`);
    expect(project).toEqual(before);
  });
  it('offers chord editing, shared boundaries and uncertain candidate markers', () => {
    const html = render(projectWithAudio());
    expect(html).toContain('和弦1名称');
    expect(html).toContain('和弦1终点秒');
    expect(html).toContain('和弦2起点秒');
    expect(html).toContain('合并和弦1与下一段');
    expect(html).toContain('待确认');
  });
  it('keeps project tempo opt-in and explains fixed-tempo and export boundaries', () => {
    const html = render(projectWithAudio());
    expect(html).toContain('应用时将工程改为此固定 BPM');
    expect(html).toContain('暂不生成复杂速度图');
    expect(html).toContain('MIDI / NBS 导出仍为音符轨道');
    expect(html).toContain('首拍秒');
    expect(html).toContain('拍点秒');
    expect(html).toContain('循环起点秒');
    expect(html).toContain('循环终点秒');
  });
});

describe('explicit local model download disclosure', () => {
  const model: AudioModelStatus = {id:'mvsep-mega-53',name:'MVSEP Mega 53 Stem BS-RoFormer',sizeBytes:1270000000,license:'MIT',licenseUrl:'https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/245',sourceUrl:'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/tag/v1.0.21',state:'missing',progress:0,downloadedBytes:0,totalBytes:1270000000,message:'首次使用前请确认下载'};
  const card = (patch: Partial<AudioModelStatus> = {}) => renderToStaticMarkup(createElement(AudioModelDownloadCard,{model:{...model,...patch},pending:false,onConfirm:()=>{throw new Error('render must not download');},onCancel:()=>{},onDismiss:()=>{},onRefresh:()=>{}}));
  it('discloses exact model, size, MIT grant and official source before confirmation', () => {
    const html=card(); expect(html).toContain(model.name); expect(html).toContain('1.27 GB'); expect(html).toContain('MIT 许可'); expect(html).toContain(model.sourceUrl); expect(html).toContain(model.licenseUrl); expect(html).toContain('确认下载模型'); expect(html).toContain('音频不会上传'); expect(html).toContain('权重不随应用打包');
    expect(html).toContain('五类预测'); expect(html).toContain('尚未验证能否满足六声部'); expect(html).toContain('不是原生六轨');
  });
  it('disables confirmation for an explicitly blocked model status', () => {
    const html=card({state:'blocked',message:'官方配置访问被拒：restricted URL'}); expect(html).toContain('restricted URL'); expect(html).toMatch(/disabled=""[^>]*>确认下载模型/); expect(html).not.toContain('<progress');
  });
  it('shows genuine progress and cancel only during download, retry after errors', () => {
    expect(card({state:'downloading',progress:.4})).toContain('取消模型下载'); expect(card({state:'downloading',progress:.4})).toContain('value="0.4"'); expect(card({state:'error',message:'连接中断'})).toContain('重试下载模型');
  });
  it('distinguishes verified cached resources from validated offline inference', () => {
    const html=card({state:'ready',progress:1}); expect(html).toContain('资源已校验，可离线复用；声部效果需试听确认'); expect(html).not.toContain('确认下载模型'); expect(html).not.toContain('可离线运行');
  });
});

// Region context must render a concrete target, rather than an unrelated import window.
it('shows the selected audio region range and six stem choices',()=>{
 const p=createProject();const html=renderToStaticMarkup(createElement(AudioAssistDialog,{project:p,selectedSource:{assetId:'source',name:'Selected # & clip',offsetSeconds:2,durationSeconds:8,mode:'split'},onApply:()=>{},onClose:()=>{}}));
 expect(html).toContain('大分轨拆分器');expect(html).toContain('要添加的分轨');expect(html).toContain('8.00');expect(html).toMatch(/>应用<\/button>/);
});

it('separates stem presets, kit pieces and submix settings from chord analysis',()=>{
 const split=renderToStaticMarkup(createElement(AudioAssistDialog,{project:projectWithAudio(),mode:'split',onApply:()=>{},onClose:()=>{}}));
 expect(split).toContain('分轨预置');expect(split).toContain('分离所有大分轨');expect(split).not.toContain('分析BPM');expect(split).not.toContain('和弦1名称');expect(split).not.toContain('启用六轨分离');expect(split).toContain('单个鼓件');expect(split).toContain('子混音');
 const chords=render();expect(chords).not.toContain('要添加的分轨');expect(chords).not.toContain('分轨预置');expect(chords).not.toContain('模型资源…');expect(chords).not.toContain('尝试 GPU 加速');
});
