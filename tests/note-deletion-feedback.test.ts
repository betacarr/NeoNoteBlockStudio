import { describe, expect, it } from 'vitest';
import { newNote } from '../src/core/project';
import { NoteDeletionFeedback, NOTE_DELETION_DURATION, NOTE_DELETION_LIMIT, deletionFeedbackCandidates } from '../src/ui/note-deletion-feedback';

const candidate = (id='deleted') => ({note:{...newNote(240,60,120),id},color:'#89baaa'});
describe('bounded visual note deletion feedback', () => {
  it('retains a selected late visible note when hundreds of earlier notes fill the viewport', () => {
    const notes=Array.from({length:1000},(_,index)=>candidate(String(index)).note);
    const selected=new Set(['999']);
    const candidates=deletionFeedbackCandidates(notes,selected,'#123456');
    expect(candidates).toHaveLength(NOTE_DELETION_LIMIT);
    expect(candidates[0]).toMatchObject({note:{id:'999'},color:'#e3f5eb'});
    expect(new Set(candidates.map(item=>item.note.id)).size).toBe(NOTE_DELETION_LIMIT);
    const remaining=new Set(notes.slice(0,-1).map(note=>note.id));
    const queue=new NoteDeletionFeedback(); queue.enqueue(candidates.filter(item=>!remaining.has(item.note.id)),0,false);
    expect(queue.frame(1).map(item=>item.note.id)).toEqual(['999']);
  });
  it('fades and shrinks over 160ms without mutating source notes', () => {
    const queue=new NoteDeletionFeedback(), note=candidate(), before=structuredClone(note);
    queue.enqueue([note],100,false);
    const start=queue.frame(100)[0], middle=queue.frame(180)[0];
    expect(start).toMatchObject({progress:0,opacity:1,scale:1});
    expect(middle.progress).toBe(.5); expect(middle.opacity).toBeLessThan(start.opacity); expect(middle.scale).toBeLessThan(start.scale);
    expect(queue.frame(100+NOTE_DELETION_DURATION)).toEqual([]); expect(queue.size).toBe(0); expect(note).toEqual(before);
  });
  it('deduplicates commit feedback while an erase preview is still active', () => {
    const queue=new NoteDeletionFeedback(), note=candidate(); queue.enqueue([note],0,false); queue.enqueue([note],80,false);
    expect(queue.frame(80)).toHaveLength(1); expect(queue.frame(80)[0].startedAt).toBe(0);
    expect(queue.frame(160)).toEqual([]);
  });
  it('restoring the same ID cancels immediately and redo can replay it', () => {
    const queue=new NoteDeletionFeedback(), note=candidate(); queue.enqueue([note],0,false); queue.restore(new Set([note.note.id]));
    expect(queue.size).toBe(0); queue.enqueue([note],40,false); expect(queue.frame(40)[0].progress).toBe(0);
  });
  it('cancel removes only the current erase gesture ghosts', () => {
    const queue=new NoteDeletionFeedback(); queue.enqueue([candidate('committed'),candidate('preview')],0,false);
    queue.remove(new Set(['preview'])); expect(queue.frame(20).map(ghost=>ghost.note.id)).toEqual(['committed']);
  });
  it('caps bulk deletion feedback and retains the newest visible candidates', () => {
    const queue=new NoteDeletionFeedback(); queue.enqueue(Array.from({length:10000},(_,i)=>candidate(String(i))),0,false);
    expect(queue.size).toBe(NOTE_DELETION_LIMIT); expect(queue.frame(1)).toHaveLength(NOTE_DELETION_LIMIT);
    expect(queue.frame(1).at(-1)?.note.id).toBe('9999'); expect(queue.frame(1)[0].note.id).toBe(String(10000-NOTE_DELETION_LIMIT));
  });
  it('reduced motion has no ghost or continuing animation work', () => {
    const queue=new NoteDeletionFeedback(); queue.enqueue([candidate()],0,true); expect(queue.size).toBe(0);
    queue.enqueue([candidate()],0,false); queue.enqueue([],40,true); expect(queue.frame(40)).toEqual([]);
  });
  it('context or unmount cleanup drops every ghost', () => {
    const queue=new NoteDeletionFeedback(); queue.enqueue([candidate('a'),candidate('b')],0,false); queue.clear(); expect(queue.size).toBe(0); expect(queue.frame(1)).toEqual([]);
  });
});
