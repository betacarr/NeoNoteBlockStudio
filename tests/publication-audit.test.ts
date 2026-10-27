import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-publication.mjs', import.meta.url));
const folders: string[] = [];
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const write = (root: string, name: string, value: string) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), value); };
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'publication-audit-')); folders.push(root);
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', '1+test@users.noreply.github.com');
  const metadata = { name: 'test', version: '0.1.0', license: 'SEE LICENSE IN LICENSE' };
  write(root, 'package.json', JSON.stringify(metadata));
  write(root, 'package-lock.json', JSON.stringify({ ...metadata, packages: { '': metadata } }));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'VERSIONING.md']) write(root, name, 'Fixture');
  git(root, 'add', '.'); return root;
}
function audit(root: string, ref?: string) {
  try { return { status: 0, output: execFileSync(process.execPath, [script, ...(ref ? ['--ref', ref] : [])], { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }; }
  catch (error) { const result = error as { status: number; stdout: string; stderr: string }; return { status: result.status, output: `${result.stdout}${result.stderr}` }; }
}
function identityCommit(root: string, author: string, committer: string) {
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'Identity fixture'], {
    cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: committer },
  });
}
afterEach(() => { for (const root of folders.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('publication gate inspects the data that Git will publish', () => {
  it('accepts a clean index before the first commit, then a noreply commit', () => {
    const root = fixture(); expect(audit(root).status).toBe(0);
    git(root, 'commit', '-m', 'Clean'); expect(audit(root, git(root, 'rev-parse', 'HEAD')).status).toBe(0);
  });
  it('accepts the exact public GitHub service committer with a user noreply author', () => {
    const root = fixture(); identityCommit(root, '1+test@users.noreply.github.com', 'noreply@github.com');
    expect(audit(root, git(root, 'rev-parse', 'HEAD')).status).toBe(0);
  });
  it.each(['noreply@github.com.example.invalid', 'noreply@github.example', 'noreply+release@github.com', 'no-reply@github.com', 'person@example.invalid'])('rejects the non-service committer %s without printing it', committer => {
    const root = fixture(); identityCommit(root, '1+test@users.noreply.github.com', committer);
    const result = audit(root); expect(result.status).toBe(1);
    expect(result.output).toContain('non-noreply-git-identity'); expect(result.output).not.toContain(committer);
  });
  it('still rejects a personal author when the committer is the official service', () => {
    const root = fixture(); identityCommit(root, 'person@example.invalid', 'noreply@github.com');
    const result = audit(root); expect(result.status).toBe(1);
    expect(result.output).toContain('non-noreply-git-identity'); expect(result.output).not.toContain('person@example.invalid');
  });
  it('does not extend the service-committer exception to authors', () => {
    const root = fixture(); identityCommit(root, 'noreply@github.com', '1+test@users.noreply.github.com');
    expect(audit(root).output).toContain('non-noreply-git-identity');
  });
  it('does not extend the service-committer exception to annotated taggers', () => {
    const root = fixture(); git(root, 'commit', '-m', 'Clean'); git(root, 'config', 'user.email', 'noreply@github.com');
    git(root, 'tag', '-a', 'v0.1.0', '-m', 'Tag');
    expect(audit(root, git(root, 'rev-parse', 'v0.1.0')).output).toContain('non-noreply-git-identity');
  });
  it('finds a staged token even when it was removed from the working file, without printing it', () => {
    const root = fixture(), token = ['ghp', '_', 'a'.repeat(36)].join('');
    write(root, 'src/token.ts', token); git(root, 'add', '.'); write(root, 'src/token.ts', 'removed');
    const result = audit(root); expect(result.status).toBe(1); expect(result.output).toContain('github-token'); expect(result.output).not.toContain(token);
  });
  it('rejects media and raw research even when forced into the index', () => {
    const root = fixture(); write(root, 'docs/evidence/private.json', '{}'); write(root, 'src/game.ogg', 'OggS'); git(root, 'add', '.');
    const result = audit(root); expect(result.status).toBe(1); expect(result.output).toContain('excluded-publication-file');
  });
  it('rejects inconsistent version metadata', () => {
    const root = fixture(); write(root, 'package.json', JSON.stringify({ name: 'test', version: '0.2.0' })); git(root, 'add', '.');
    expect(audit(root).output).toContain('package-metadata-mismatch');
  });
  it('detects private commit identities even if the current index is clean', () => {
    const root = fixture(); git(root, 'config', 'user.email', ['private', 'example.com'].join('@')); git(root, 'commit', '-m', 'Private identity');
    const result = audit(root); expect(result.status).toBe(1); expect(result.output).toContain('non-noreply-git-identity'); expect(result.output).not.toContain('private@example.com');
  });
  it('checks the requested commit instead of unrelated current working changes', () => {
    const root = fixture(); git(root, 'commit', '-m', 'Clean'); const ref = git(root, 'rev-parse', 'HEAD');
    write(root, 'src/problem.ts', ['C:', 'Users', 'FixtureUser', 'private.txt'].join('/')); git(root, 'add', '.');
    expect(audit(root).status).toBe(1); expect(audit(root, ref).status).toBe(0);
  });
  it('rejects a private annotated-tag identity', () => {
    const root = fixture(); git(root, 'commit', '-m', 'Clean'); git(root, 'config', 'user.email', ['tag', 'example.com'].join('@')); git(root, 'tag', '-a', 'v0.1.0', '-m', 'Tag');
    expect(audit(root, git(root, 'rev-parse', 'v0.1.0')).output).toContain('non-noreply-git-identity');
  });
});
