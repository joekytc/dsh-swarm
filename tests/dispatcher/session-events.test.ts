// tests/dispatcher/session-events.test.ts
import { describe, it, expect } from 'vitest';
import { replayModel, isGuardSynthesizedReply, GUARD_SYNTH_REPLAY_MODELS } from '../../src/dispatcher/session-events.js';

const msgEvent = (responseModel: string | null, live = false) => (live
  ? { type: 'assistant/message', seq: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], source: { replayState: { response: { responseModel } } } } }
  : { type: 'assistant/message', seq: 1, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], source: { replayState: { response: { responseModel } } } } } });

describe('replayModel / isGuardSynthesizedReply（2026-09-22 网关合成拒答识别）', () => {
  it('落盘形态（data.message）与 live 形态（顶层 message）均可读出 responseModel', () => {
    expect(replayModel(msgEvent('from-cache'))).toBe('from-cache');
    expect(replayModel(msgEvent('from-security-guard', true))).toBe('from-security-guard');
  });
  it('非 assistant/message / 无标记 → null', () => {
    expect(replayModel({ type: 'tool/call', data: { name: 'bash' } })).toBeNull();
    expect(replayModel(msgEvent(null))).toBeNull();
    expect(replayModel(null)).toBeNull();
  });
  it('标记集含 from-cache 与 from-security-guard（安全护栏拒答被语义缓存收录后按原标记回放）', () => {
    expect(GUARD_SYNTH_REPLAY_MODELS.has('from-cache')).toBe(true);
    expect(GUARD_SYNTH_REPLAY_MODELS.has('from-security-guard')).toBe(true);
    expect(isGuardSynthesizedReply(msgEvent('from-security-guard'))).toBe(true);
    expect(isGuardSynthesizedReply(msgEvent('from-cache', true))).toBe(true);
  });
  it('真实模型输出（无 replay 标记）不误判', () => {
    const real = { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '正常输出' }], source: { kind: 'model' } } } };
    expect(isGuardSynthesizedReply(real)).toBe(false);
  });
});
