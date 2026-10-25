import { describe, expect, it, vi } from 'vitest';
import { createNumberInputHarness as fixture } from './helpers/commit-number-harness';

describe('CommitNumberInput actual callbacks (unit scope)', () => {
  it('keeps temporary blank/sign/decimal drafts local until a commit', () => {
    const test = fixture();
    for (const text of ['', '-', '-.', '-2.5']) {
      test.change(text); expect(test.render().props.value).toBe(text);
      expect(test.render().props['aria-invalid']).toBeUndefined(); expect(test.onCommit).not.toHaveBeenCalled();
    }
    expect(test.onPendingChange.mock.calls).toEqual([[true]]);
  });

  it.each(['blur', 'Enter'])('commits a valid fine value once on %s, ignoring native stepMismatch', mode => {
    const test = fixture({ min: 0 }); test.input.validity.stepMismatch = true;
    test.change('1.23456789');
    if (mode === 'blur') test.blur();
    else { const event = test.key('Enter'); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce(); }
    // Parent value is deliberately not echoed: re-entered/delayed blur must still
    // not commit the same draft twice before a React parent render arrives.
    test.blurEvent();
    expect(test.onCommit.mock.calls).toEqual([[1.23456789]]); expect(test.input.blur).toHaveBeenCalledOnce();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]); expect(test.render().props['aria-invalid']).toBeUndefined();
  });

  it('Escape cancels the local edit and blurs without committing through the blur callback', () => {
    const test = fixture(); test.change('2.5');
    const event = test.key('Escape');
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(test.render().props.value).toBe('1'); expect(test.document.activeElement).toBeNull();
    expect(test.onCommit).not.toHaveBeenCalled(); expect(test.input.blur).toHaveBeenCalledOnce(); expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });

  it.each([
    { text: '', props: {} }, { text: '1e999', props: {} },
    { text: '-1', props: { min: 0 } }, { text: '11', props: { max: 10 } }, { text: '1.5', props: { integer: true } },
  ])('retains invalid Enter draft $text and restores the source value on blur', ({ text, props }) => {
    const test = fixture(props); test.change(text); test.key('Enter');
    expect(test.onCommit).not.toHaveBeenCalled(); expect(test.render().props.value).toBe(text); expect(test.render().props['aria-invalid']).toBe(true);
    expect(test.document.activeElement).toBe(test.input); expect(test.input.blur).not.toHaveBeenCalled();
    test.blur();
    expect(test.render().props.value).toBe('1'); expect(test.render().props['aria-invalid']).toBeUndefined(); expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('does not roundtrip untouched precise values or equivalent number strings through onCommit', () => {
    const precise = fixture({ value: .12345678901234568, min: 0 });
    expect(precise.render().props.value).toBe(String(.12345678901234568)); precise.blur();
    expect(precise.onCommit).not.toHaveBeenCalled(); expect(precise.onPendingChange).not.toHaveBeenCalled();
    const equivalent = fixture({ value: 1.5 }); equivalent.change('001.5000'); equivalent.key('Enter');
    expect(equivalent.render().props.value).toBe('1.5'); expect(equivalent.onCommit).not.toHaveBeenCalled(); expect(equivalent.onPendingChange).not.toHaveBeenCalled();
  });

  it('keeps an unchanged legacy zero duration valid even when it is below the current minimum', () => {
    const test = fixture({ value: 0, min: 1 }); test.blur();
    expect(test.render().props.value).toBe('0'); expect(test.render().props['aria-invalid']).toBeUndefined();
    expect(test.onCommit).not.toHaveBeenCalled(); expect(test.onPendingChange).not.toHaveBeenCalled();
  });

  it.each([{ value: 4 }, { contextKey: 'note-b' }, { disabled: true }])('invalidates a draft when its external owner changes: %j', change => {
    const test = fixture(); test.change('2.5'); const stale = test.render();
    test.update(change, false);
    stale.props.onBlur({ currentTarget: test.input });
    expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe(String(change.value ?? 1)); expect(test.render().props['aria-invalid']).toBeUndefined();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
    if (change.disabled) { expect(test.flush()).toBe(true); expect(test.document.activeElement).toBeNull(); }
  });

  it('retains the draft when callback identities change and commits to the latest callback', () => {
    const test = fixture(); test.change('2.5'); const nextCommit = vi.fn(), nextPending = vi.fn();
    test.update({ onCommit: nextCommit, onPendingChange: nextPending });
    expect(test.render().props.value).toBe('2.5'); expect(test.onPendingChange.mock.calls).toEqual([[true]]);
    test.key('Enter');
    expect(nextCommit.mock.calls).toEqual([[2.5]]); expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]); expect(nextPending).not.toHaveBeenCalled();
  });

  it('clears pending when a changed draft becomes numerically equal to the original again', () => {
    const test = fixture(); test.change('2'); test.change('01.00');
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
    test.key('Enter'); expect(test.onCommit).not.toHaveBeenCalled();
  });

  it('flush returns true without an active owned input', () => {
    const test = fixture(); test.document.activeElement = null; expect(test.flush()).toBe(true);
    test.document.activeElement = {}; expect(test.flush()).toBe(true);
    expect(test.onCommit).not.toHaveBeenCalled(); expect(test.input.blur).not.toHaveBeenCalled();
  });

  it('flush commits and blurs an owned valid draft once through the module registry', () => {
    const test = fixture(); test.change('2.5');
    expect(test.flush()).toBe(true); expect(test.flush()).toBe(true);
    expect(test.onCommit.mock.calls).toEqual([[2.5]]); expect(test.input.blur).toHaveBeenCalledOnce(); expect(test.document.activeElement).toBeNull();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('flush rejects an invalid draft without changing the draft or focus', () => {
    const test = fixture(); test.change('');
    expect(test.flush()).toBe(false); expect(test.render().props.value).toBe(''); expect(test.render().props['aria-invalid']).toBe(true);
    expect(test.document.activeElement).toBe(test.input); expect(test.input.blur).not.toHaveBeenCalled(); expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.onPendingChange.mock.calls).toEqual([[true]]);
  });

  it.each(['Enter', 'flush'])('retains the original draft, pending state and focus when the model rejects %s', mode => {
    const test = fixture(); test.onCommit.mockReturnValue(false); test.change('002.5000');
    if (mode === 'Enter') test.key('Enter');
    else expect(test.flush()).toBe(false);
    expect(test.onCommit.mock.calls).toEqual([[2.5]]);
    expect(test.render().props.value).toBe('002.5000'); expect(test.render().props['aria-invalid']).toBe(true);
    expect(test.document.activeElement).toBe(test.input); expect(test.input.blur).not.toHaveBeenCalled();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('keeps the model-rejected draft and pending notification after ordinary blur', () => {
    const test = fixture(); test.onCommit.mockReturnValue(false); test.change('002.5000'); test.blur();
    expect(test.onCommit.mock.calls).toEqual([[2.5]]); expect(test.render().props.value).toBe('002.5000');
    expect(test.render().props['aria-invalid']).toBe(true); expect(test.document.activeElement).toBeNull();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false], [true]]);
    // Flush only owns the active field; App separately guards all pending fields.
    expect(test.flush()).toBe(true); expect(test.onCommit).toHaveBeenCalledOnce();
  });

  it('retains rejection after leaving for another field, then accepts a corrected value on later blur', () => {
    const test = fixture(); test.onCommit.mockReturnValue(false); test.change('002.5000'); test.key('Enter'); test.blur();
    test.document.activeElement = { otherField: true };
    expect(test.flush()).toBe(true); expect(test.render().props.value).toBe('002.5000'); expect(test.render().props['aria-invalid']).toBe(true);
    expect(test.onPendingChange.mock.calls.at(-1)).toEqual([true]); expect(test.onCommit.mock.calls).toEqual([[2.5], [2.5]]);
    test.onCommit.mockReturnValue(true); test.input.focus(); test.change('3.25'); test.blur();
    expect(test.onCommit.mock.calls).toEqual([[2.5], [2.5], [3.25]]); expect(test.render().props.value).toBe('3.25');
    expect(test.render().props['aria-invalid']).toBeUndefined(); expect(test.onPendingChange.mock.calls.at(-1)).toEqual([false]);
  });

  it('keeps parse-invalid blur reset after replacing a model-rejected draft with invalid text', () => {
    const test = fixture(); test.onCommit.mockReturnValue(false); test.change('2.5'); test.key('Enter'); test.change(''); test.blur();
    expect(test.onCommit.mock.calls).toEqual([[2.5]]); expect(test.render().props.value).toBe('1');
    expect(test.render().props['aria-invalid']).toBeUndefined(); expect(test.onPendingChange.mock.calls.at(-1)).toEqual([false]);
  });

  it('allows a rejected draft to be corrected and explicitly accepted on retry', () => {
    const test = fixture(); test.onCommit.mockReturnValueOnce(false).mockReturnValueOnce(true);
    test.change('2.5'); test.key('Enter'); test.change('3.25');
    expect(test.render().props['aria-invalid']).toBeUndefined(); expect(test.flush()).toBe(true);
    expect(test.onCommit.mock.calls).toEqual([[2.5], [3.25]]); expect(test.render().props.value).toBe('3.25');
    expect(test.input.blur).toHaveBeenCalledOnce(); expect(test.document.activeElement).toBeNull();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it('lets Escape cancel a rejected draft without submitting it again', () => {
    const test = fixture(); test.onCommit.mockReturnValue(false); test.change('2.5'); test.key('Enter'); test.key('Escape');
    expect(test.onCommit).toHaveBeenCalledOnce(); expect(test.render().props.value).toBe('1');
    expect(test.render().props['aria-invalid']).toBeUndefined(); expect(test.document.activeElement).toBeNull();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it('does not resubmit or blur during a reentrant flush and blur callback before rejection returns', () => {
    const test = fixture();
    test.onCommit.mockImplementation(() => {
      expect(test.flush()).toBe(false);
      test.render().props.onBlur({ currentTarget: test.input });
      return false;
    });
    test.change('002.5000'); expect(test.flush()).toBe(false);
    expect(test.onCommit).toHaveBeenCalledOnce(); expect(test.render().props.value).toBe('002.5000');
    expect(test.render().props['aria-invalid']).toBe(true); expect(test.document.activeElement).toBe(test.input);
    expect(test.input.blur).not.toHaveBeenCalled(); expect(test.onPendingChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  it.each([{ value: 4 }, { contextKey: 'note-b' }, { disabled: true }])('does not revive rejected text or pending for a synchronously replaced owner: %j', change => {
    const test = fixture(), nextPending = vi.fn();
    test.onCommit.mockImplementation(() => { test.update({ ...change, onPendingChange: nextPending }); return false; });
    test.change('2.5'); expect(test.flush()).toBe(false);
    expect(test.onCommit).toHaveBeenCalledOnce(); expect(test.render().props.value).toBe(String(change.value ?? 1));
    expect(test.render().props['aria-invalid']).toBeUndefined(); expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
    expect(nextPending).not.toHaveBeenCalled(); expect(test.input.blur).not.toHaveBeenCalled();
  });

  it('unmount clears pending and unregisters the active input without committing', () => {
    const test = fixture(); test.change('2.5'); test.unmount();
    expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]); expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.flush()).toBe(true); expect(test.input.blur).not.toHaveBeenCalled();
  });
});
