// tests/dispatcher/session-events.test.ts
import { describe, it, expect } from 'vitest';
import { replayModel, isGuardSynthesizedReply, GUARD_SYNTH_REPLAY_MODELS, turnEndOf, lastTurnEnd } from '../../src/dispatcher/session-events.js';

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

describe('turnEndOf / lastTurnEnd（环境中止与协议违规区分的 turn 读取）', () => {
  it('落盘形态：turn/end error 读出 kind/code/message', () => {
    const ev = { type: 'turn/end', seq: 13, time: 1, data: { turn: 1, reason: { kind: 'error', error: { message: 'pi-ai provider "jz" has no configured model "x"', code: 'UNKNOWN_MODEL' } } } };
    expect(turnEndOf(ev)).toEqual({ turn: 1, kind: 'error', code: 'UNKNOWN_MODEL', message: 'pi-ai provider "jz" has no configured model "x"' });
  });
  it('落盘形态：turn/end completed 无 error 字段 → code/message 为 null', () => {
    const ev = { type: 'turn/end', seq: 20, time: 2, data: { turn: 3, reason: { kind: 'completed' } } };
    expect(turnEndOf(ev)).toEqual({ turn: 3, kind: 'completed', code: null, message: null });
  });
  it('live 顶层展开形态（type/turn/reason 在顶层）兼容读取', () => {
    const ev = { type: 'turn/end', seq: 5, turn: 2, reason: { kind: 'error', error: { code: 'QUOTA', message: '429 quota exceeded' } } };
    expect(turnEndOf(ev)).toEqual({ turn: 2, kind: 'error', code: 'QUOTA', message: '429 quota exceeded' });
  });
  it('非 turn/end / reason 缺失 / kind 不可读 → null', () => {
    expect(turnEndOf({ type: 'tool/call', data: { name: 'bash' } })).toBeNull();
    expect(turnEndOf({ type: 'turn/end', data: {} })).toBeNull();
    expect(turnEndOf(null)).toBeNull();
  });
  it('lastTurnEnd：只看 seq > fromSeq 的增量，取 seq 最大一轮', () => {
    const events = [
      { type: 'turn/end', seq: 10, data: { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN_MODEL', message: 'old' } } } },
      { type: 'turn/end', seq: 11, data: { turn: 2, reason: { kind: 'completed' } } },
      { type: 'turn/end', seq: 12, data: { turn: 3, reason: { kind: 'error', error: { code: 'QUOTA', message: '429' } } } },
    ];
    expect(lastTurnEnd(events, 0)).toEqual({ turn: 3, kind: 'error', code: 'QUOTA', message: '429' });
    expect(lastTurnEnd(events, 11)).toEqual({ turn: 3, kind: 'error', code: 'QUOTA', message: '429' });
    expect(lastTurnEnd(events, 12)).toBeNull();
  });
  it('lastTurnEnd：无 turn 事件（测试桩）→ null', () => {
    expect(lastTurnEnd([{ type: 'assistant', seq: 1 }, { type: 'tool/call', seq: 2, data: { name: 'bash' } }], 0)).toBeNull();
    expect(lastTurnEnd([], 0)).toBeNull();
  });
});
