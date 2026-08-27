import type { WikiVaultClient } from './wiki-vault-client.js';
import type { BoardState } from '../domain/types.js';
/**
 * 机械互链登记：链上 w:kb 任务完成时调用。
 * - 清单页：追加/更新「关联文档」区块，列出链上全部已 done 的 W2/W3 页。
 * - 当前页：写回清单页链接（清单 ref 来自规格卡 kind:'kb' 附件）。
 * 幂等（containsLine / 区块就地替换）；任何 wiki 读/写失败均静默跳过，不抛错。
 */
export declare function syncKbLinks(wiki: WikiVaultClient, state: BoardState, taskId: string): Promise<void>;
