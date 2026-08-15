import type { BoardConnectionState } from './board-store.js';

/** T28：连接状态提示；ready 不占空间。 */
export function ConnectionBanner(props: { connection: BoardConnectionState; lastSuccessAt: number | null; onRetry?: () => void }) {
  if (props.connection === 'ready') return null;
  const label = props.connection === 'loading' ? '正在加载' : props.connection === 'reconnecting' ? '正在重连' : '连接错误';
  return (
    <div className={`dsh-kb-banner dsh-kb-banner--${props.connection}`} role="status">
      {label}
      {props.connection === 'error' && props.lastSuccessAt ? ` · 最后成功 ${new Date(props.lastSuccessAt).toLocaleTimeString()}` : ''}
      {props.connection === 'error' && (
        <button type="button" className="dsh-kb-banner__retry" onClick={props.onRetry}>重试</button>
      )}
    </div>
  );
}
