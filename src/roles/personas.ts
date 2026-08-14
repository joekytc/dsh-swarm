import type { Role } from '../domain/types.js';

/** 角色 persona preset 常量（T8 先注册文本；T21 落盘 personas/*.md 供 dsh-persona preset 引用）。 */
export const PERSONA_TEXT: Record<Role, string> = {
  v: 'dsh-kanban/persona-v',
  p: 'dsh-kanban/persona-p',
  w: 'dsh-kanban/persona-w',
  d: 'dsh-kanban/persona-d',
};

export function personaPresetId(role: Role): string {
  return PERSONA_TEXT[role];
}
