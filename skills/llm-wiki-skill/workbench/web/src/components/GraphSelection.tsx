import { MessageSquarePlus, Plus, Send } from "lucide-react";
import type { Selection, SelectionAction } from "@llm-wiki/graph-engine";

import { graphSelectionViewModel } from "../lib/graph-selection-drawer";

interface Props {
	title: string;
	selection: Selection;
	freeText: string;
	onFreeTextChange: (value: string) => void;
	onNeighbors: () => void;
	onAsk: (action: SelectionAction | null) => void;
	onAskInNewConversation: (action: SelectionAction | null) => void;
}

export function GraphSelection({
	title,
	selection,
	freeText,
	onFreeTextChange,
	onNeighbors,
	onAsk,
	onAskInNewConversation,
}: Props) {
	const view = graphSelectionViewModel(selection);
	const canSendFreeText = freeText.trim().length > 0;
	const defaultAction = selection.actions?.[0] ?? null;
	return (
		<article className="graph-selection-drawer" data-testid="graph-selection-drawer">
			<div className="graph-selection-hint">{view.hint}</div>
			<div className="graph-selection-title" title={title}>{title}</div>
			{view.showFacts && (
				<div className="graph-selection-facts">
					{view.facts.map((fact) => (
						<Fact key={fact.label} label={fact.label} value={fact.value} />
					))}
				</div>
			)}
			<div className="graph-selection-actions">
				<button
					type="button"
					className="graph-selection-action graph-selection-action-muted"
					onClick={onNeighbors}
					disabled={!view.canExpandNeighbors}
				>
					<Plus />
					邻居
				</button>
				{selection.actions?.map((action) => (
					<button
						key={action.id}
						type="button"
						className="graph-selection-action"
						data-action-id={action.id}
						onClick={() => onAsk(action)}
					>
						<Send />
						{action.label}
					</button>
				))}
			</div>
			<textarea
				className="graph-selection-textarea"
				value={freeText}
				onChange={(event) => onFreeTextChange(event.target.value)}
				rows={3}
				placeholder="补充说明（可选）"
			/>
			<div className="graph-selection-footer">
				<button
					type="button"
					className="graph-selection-send"
					onClick={() => onAsk(null)}
					disabled={!canSendFreeText}
				>
					<Send />
					发送
				</button>
				<button
					type="button"
					className="graph-selection-secondary"
					onClick={() => onAskInNewConversation(canSendFreeText ? null : defaultAction)}
					disabled={!canSendFreeText && !defaultAction}
				>
					<MessageSquarePlus />
					新对话
				</button>
			</div>
		</article>
	);
}

function Fact({ label, value }: { label: string; value: number }) {
	return (
		<div className="graph-selection-fact">
			<strong>{value}</strong>
			<span>{label}</span>
		</div>
	);
}
