import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applicationProfile } from '../electron/app-profile';

describe('application rename profile continuity', () => {
  it('preserves explicit profile isolation ahead of testing and installed data', () => {
    expect(applicationProfile('isolated', 'test-profile', 'old-profile', true)).toBe(path.resolve('isolated'));
  });
  it('preserves the development test profile ahead of installed data', () => {
    expect(applicationProfile('', 'test-profile', 'old-profile', true)).toBe(path.resolve('test-profile'));
  });
  it('reuses existing recovery/preferences without copying or deleting files', () => {
    expect(applicationProfile('', undefined, 'old-profile', true)).toBe('old-profile');
  });
  it('leaves a new installation on the normal new-name default', () => {
    expect(applicationProfile('', undefined, 'old-profile', false)).toBeUndefined();
  });
});
