import { describe, it, expect } from 'vitest';
import { validatePrefetchManifest } from '../../src/domain/prefetch-manifest.js';

const validManifest = {
  repo: { localPath: '/ws/repo', remoteUrl: 'http://x/r.git', branch: 'main', dirtyFiles: ['a.ts'] },
  files: [
    { path: 'README.md', expected: 'exists' },
    { path: 'src/old.ts', expected: 'absent' },
    { path: 'src/config.ts', expected: 'content-hash', note: 'abc123' },
  ],
};

describe('validatePrefetchManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validatePrefetchManifest(validManifest)).toEqual([]);
  });
  it('rejects non-object', () => {
    expect(validatePrefetchManifest('x')).not.toEqual([]);
    expect(validatePrefetchManifest(null)).not.toEqual([]);
  });
  it('requires repo.localPath non-empty string', () => {
    expect(validatePrefetchManifest({ ...validManifest, repo: { ...validManifest.repo, localPath: '  ' } }).some((e) => e.includes('manifest.repo.localPath required'))).toBe(true);
  });
  it('requires repo.dirtyFiles array', () => {
    expect(validatePrefetchManifest({ ...validManifest, repo: { ...validManifest.repo, dirtyFiles: 'x' } })).toContain('manifest.repo.dirtyFiles must be an array');
  });
  it('requires files array with path and expected enum', () => {
    expect(validatePrefetchManifest({ ...validManifest, files: [] })).toEqual([]);
    expect(validatePrefetchManifest({ ...validManifest, files: [{ path: 'x', expected: 'bogus' }] }).some((e) => e.includes('manifest.files[].expected'))).toBe(true);
    expect(validatePrefetchManifest({ ...validManifest, files: [{ path: '  ', expected: 'exists' }] }).some((e) => e.includes('manifest.files[].path'))).toBe(true);
  });
  it('requires note for content-hash', () => {
    expect(validatePrefetchManifest({ ...validManifest, files: [{ path: 'x', expected: 'content-hash' }] }).some((e) => e.includes('manifest.files[].note'))).toBe(true);
  });
});
