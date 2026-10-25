import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Inspect the actual index or the commit being pushed, never just working files.
export function auditPublication(root, ref) {
  const issues = [];
  const git = (args, input) => execFileSync('git', args, { cwd: root, input, windowsHide: true, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  const fail = (file, rule, line) => issues.push({ file, rule, ...(line ? { line } : {}) });
  const top = git(['rev-parse', '--show-toplevel']).toString().trim();
  if (path.resolve(top).toLowerCase() !== path.resolve(root).toLowerCase()) throw new Error('Run from the publication repository root.');
  if (ref && !/^[0-9a-f]{40,64}$/i.test(ref)) throw new Error('--ref requires a full Git object ID.');
  const entries = git(ref ? ['ls-tree', '-r', '-z', ref] : ['ls-files', '--stage', '-z']).toString().split('\0').filter(Boolean).map(record => {
    const [head, name] = record.split('\t');
    const fields = head.split(' ');
    return { mode: fields[0], oid: fields[ref ? 2 : 1], name, stage: ref ? '0' : fields[2] };
  });
  if (!entries.length) throw new Error('No staged or committed publication files found.');
  const allowed = /^(?:src\/|electron\/|scripts\/|tests\/|docs\/|third_party\/|\.github\/|\.githooks\/|\.gitattributes$|\.gitignore$|[A-Z][A-Z_]*(?:\.md)?$|package(?:-lock)?\.json$|tsconfig\.json$|vite\.config\.ts$|index\.html$)/;
  const excluded = /(?:^|\/)(?:\.git|\.local|\.research|\.codex|\.agents|node_modules|dist|dist-electron|release|coverage|test-results|secrets|logs)(?:\/|$)|^docs\/evidence\/|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:id_rsa|id_ed25519|credentials[^/]*)(?:$|\.)/i;
  const media = /\.(?:nbsx|nbs|mid|midi|flp|wav|ogg|mp3|mp4|pcm|png|jpe?g|webp|gif|jar|class|dll|so|dylib|exe|msi|zip|7z|pem|key|p12|pfx|jks|keystore)$/i;
  for (const entry of entries) {
    if (!allowed.test(entry.name) || excluded.test(entry.name) || media.test(entry.name)) fail(entry.name, 'excluded-publication-file');
    if (entry.stage !== '0' || !['100644', '100755'].includes(entry.mode)) fail(entry.name, 'non-regular-or-unmerged-file');
  }
  const blobs = git(['cat-file', '--batch'], entries.map(entry => entry.oid).join('\n') + '\n');
  const files = new Map();
  let offset = 0;
  const rules = [
    ['private-key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['service-token', /\b(?:xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/],
    ['personal-profile-path', /(?:[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\s"'<>\\/]+|\/(?:Users|home)\/[A-Za-z0-9_.-]+)\b/i],
    ['local-development-path', /[A-Za-z]:[\\/]+AI[\\/]+[^\s"'<>]+/i],
    ['private-contact', /\b[A-Z0-9._%+-]+@(?:qq|163|126)\.com\b/i],
  ];
  for (const entry of entries) {
    const end = blobs.indexOf(10, offset);
    const header = blobs.subarray(offset, end).toString().split(' ');
    if (header[1] !== 'blob') throw new Error('Publication contains an unsupported Git object.');
    const length = Number(header[2]);
    const bytes = blobs.subarray(end + 1, end + 1 + length);
    offset = end + 1 + length + 1;
    if (bytes.includes(0)) { fail(entry.name, 'binary-file'); continue; }
    const content = bytes.toString('utf8');
    files.set(entry.name, content);
    content.split(/\r?\n/).forEach((line, index) => {
      for (const [rule, pattern] of rules) if (pattern.test(line)) fail(entry.name, rule, index + 1);
    });
  }
  const metadata = JSON.parse(files.get('package.json') ?? '{}');
  const lock = JSON.parse(files.get('package-lock.json') ?? '{}');
  if (!metadata.version || metadata.name !== lock.name || metadata.version !== lock.version || metadata.version !== lock.packages?.['']?.version || metadata.name !== lock.packages?.['']?.name || metadata.license !== lock.packages?.['']?.license) fail('package-lock.json', 'package-metadata-mismatch');
  for (const required of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'VERSIONING.md']) if (!files.has(required)) fail(required, 'missing-publication-notice');
  const noreply = /^(?:\d+\+)?[a-z\d][a-z\d-]{0,38}@users\.noreply\.github\.com$/i;
  let history = ref;
  if (!history) { try { history = git(['rev-parse', '--verify', 'HEAD']).toString().trim(); } catch { /* first clean commit has no HEAD */ } }
  let commits = 0;
  if (history) {
    const identities = git(['log', '--format=%H%x09%ae%x09%ce', history]).toString().trim().split('\n').filter(Boolean);
    commits = identities.length;
    identities.forEach((record, index) => { const [, author, committer] = record.trim().split('\t'); if (!noreply.test(author) || !noreply.test(committer)) fail(`history/commit-${index + 1}`, 'non-noreply-git-identity'); });
    if (git(['cat-file', '-t', history]).toString().trim() === 'tag') {
      const tag = git(['cat-file', '-p', history]).toString();
      const email = tag.match(/^tagger .* <([^<>]+)> /m)?.[1];
      if (!email || !noreply.test(email)) fail('history/tag', 'non-noreply-git-identity');
    }
  }
  return { files: entries.length, commits, version: metadata.version, issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--ref')) throw new Error('Usage: node scripts/check-publication.mjs [--ref FULL_OBJECT_ID]');
    const result = auditPublication(process.cwd(), args[1]);
    // Never print matching secrets, contact details, paths, Git identities or source lines.
    for (const issue of result.issues) console.error(`${issue.file}${issue.line ? ':' + issue.line : ''}: ${issue.rule}`);
    console.log(`Publication audit: ${result.files} files, ${result.commits} commits, v${result.version}, ${result.issues.length} issues.`);
    process.exitCode = result.issues.length ? 1 : 0;
  } catch { console.error('Publication audit could not inspect this repository. Check the repository root, index and arguments.'); process.exitCode = 1; }
}
