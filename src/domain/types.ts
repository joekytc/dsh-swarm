// src/domain/types.ts
export type Role = 'v' | 'p' | 'w' | 'd';
export type TaskMode = 'file' | 'external' | 'kb' | 'openspec' | 'mattpocock' | 'align';
export type TaskStatus = 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'done' | 'failed' | 'archived';
export type ChainStatus = 'planning' | 'executing' | 'completed' | 'aborted';
export type SpecCardStatus = 'draft' | 'approved';

export type EventKind =
  | 'chain/created' | 'chain/executing' | 'chain/completed' | 'chain/aborted' | 'chain/root-task-set'
  | 'spec-card/created' | 'spec-card/edited' | 'spec-card/approved'
  | 'task/created' | 'task/claimed' | 'task/heartbeat' | 'task/commented'
  | 'task/completed' | 'task/blocked' | 'task/unblocked' | 'task/archived'
  | 'task/failed';

export interface SpecCardSections {
  problem: string;
  solution: string;
  user_stories: string[];
  impl_decisions: string[];
  testing: string;
  out_of_scope: string;
}

export interface SpecCardAttachment {
  name: string;
  kind: 'file-prefetch' | 'external' | 'kb' | 'other';
  ref: string; // 工作区路径或链接
}

export interface Chain {
  id: string;
  title: string;
  status: ChainStatus;
  rootTaskId: string | null;
  specCardId: string | null;
  ownerSessionId: string;
  createdAt: number;
}

export interface SpecCard {
  id: string;
  chainId: string;
  status: SpecCardStatus;
  sections: SpecCardSections;
  attachments: SpecCardAttachment[];
  rawDialogueRef: string | null;
  approvedAt: number | null;
  approvedBy: string | null;
}

export interface Task {
  id: string;
  chainId: string;
  title: string;
  body: string;
  assignee: Role;
  status: TaskStatus;
  mode: TaskMode;
  priority: number;
  parents: string[];
  children: string[];
  createdBy: 'v' | 'human' | 'auto';
  attempts: number;
  heartbeats: number[];
}

export interface Handoff {
  summary: string;
  metadata: Record<string, unknown>;
  completedAt: number;
}

export interface KanbanEvent {
  seq: number;
  chainId: string;
  taskId: string | null;
  kind: EventKind;
  payload: Record<string, unknown>;
  author: string; // 'v'|'p'|'w'|'d'|'human'|'system'|agent id
  at: number;
}

export interface BoardState {
  chains: Map<string, Chain>;
  tasks: Map<string, Task>;
  specCards: Map<string, SpecCard>;
  handoffs: Map<string, Handoff>; // taskId → 完成交接
  events: KanbanEvent[];
}
