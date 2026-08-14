import { describe, it, expect } from 'vitest';
import { name } from '../src/index.js';

describe('plugin entry', () => {
  it('exports a plugin name', () => {
    expect(name).toBe('dsh-kanban');
  });
});
