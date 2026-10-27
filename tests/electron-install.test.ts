import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { installElectron } from '../scripts/install-electron.mjs';

describe('Electron extraction target guard', () => {
  it('rejects an arbitrary directory before reading, downloading or deleting runtime files', async () => {
    await expect(installElectron({ destination: path.resolve('.local/unrelated-project') })).rejects.toThrow('owned');
  });
  it('does not replace the development runtime with a different platform or architecture', async () => {
    const platform = process.platform === 'win32' ? 'darwin' : 'win32';
    await expect(installElectron({ platform, arch: 'x64' })).rejects.toThrow('matching development runtime');
  });
});
