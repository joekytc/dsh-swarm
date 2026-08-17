// Minimal ambient types for js-yaml (transitive dep; ships no declarations).
// Tests parse the D22 preset compositions with the real loader dialect
// (@deepseek-ai/cordis-plugin-include entryListSchema), which needs a Schema.
declare module 'js-yaml' {
  export interface LoadOptions {
    schema?: unknown;
    [key: string]: unknown;
  }
  export interface Schema {}
  export function load(content: string, options?: LoadOptions): unknown;
  export function loadAll(content: string, iterator?: (doc: unknown) => void, options?: LoadOptions): unknown[];
  export function dump(obj: unknown, options?: unknown): string;
  export const DEFAULT_SCHEMA: Schema;
  export const CORE_SCHEMA: Schema;
  export const JSON_SCHEMA: Schema;
  export const FAILSAFE_SCHEMA: Schema;
  const _default: {
    load: typeof load;
    loadAll: typeof loadAll;
    dump: typeof dump;
    DEFAULT_SCHEMA: Schema;
    CORE_SCHEMA: Schema;
    JSON_SCHEMA: Schema;
    FAILSAFE_SCHEMA: Schema;
  };
  export default _default;
}
