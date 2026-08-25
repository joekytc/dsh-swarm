// src/domain/prefetch-manifest.ts
export interface PrefetchFileEntry {
  path: string;
  expected: 'exists' | 'absent' | 'content-hash';
  note?: string;
}

export interface PrefetchManifest {
  repo: { localPath: string; remoteUrl?: string; branch?: string; dirtyFiles: string[] };
  files: PrefetchFileEntry[];
}

const EXPECTED_VALUES = new Set(['exists', 'absent', 'content-hash']);

/** 需求澄清清单 manifest schema 校验（planning-checklist 复用本 schema）：返回错误列表（空数组 = 合法）。 */
export function validatePrefetchManifest(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['manifest must be an object'];
  const m = raw as Record<string, unknown>;
  const repo = m['repo'];
  if (typeof repo !== 'object' || repo === null) {
    errors.push('manifest.repo required');
  } else {
    const r = repo as Record<string, unknown>;
    if (typeof r['localPath'] !== 'string' || r['localPath'].trim().length === 0) {
      errors.push(`manifest.repo.localPath required (got: ${JSON.stringify(r['localPath'])})`);
    }
    if (!Array.isArray(r['dirtyFiles'])) errors.push('manifest.repo.dirtyFiles must be an array');
  }
  if (!Array.isArray(m['files'])) {
    errors.push('manifest.files must be an array');
  } else {
    for (const f of m['files']) {
      if (typeof f !== 'object' || f === null) { errors.push('manifest.files entry must be an object'); continue; }
      const e = f as Record<string, unknown>;
      if (typeof e['path'] !== 'string' || e['path'].trim().length === 0) {
        errors.push(`manifest.files[].path (got: ${JSON.stringify(e['path'])})`);
      }
      if (typeof e['expected'] !== 'string' || !EXPECTED_VALUES.has(e['expected'])) {
        errors.push(`manifest.files[].expected (got: ${JSON.stringify(e['expected'])})`);
      }
      if (e['expected'] === 'content-hash' && (typeof e['note'] !== 'string' || e['note'].trim().length === 0)) {
        errors.push(`manifest.files[].note required for content-hash (got: ${JSON.stringify(e['note'])})`);
      }
    }
  }
  return errors;
}
