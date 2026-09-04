import { Download } from "lucide-react";

import { Button } from "../ui/button";
import { getArtifactFileUrl, type ArtifactManifest } from "../../lib/api";

interface Props {
	manifest: ArtifactManifest;
}

const KIND_META: Record<ArtifactManifest["kind"], { icon: string; label: string }> = {
	pdf: { icon: "📄", label: "PDF 文档" },
	docx: { icon: "📝", label: "Word 文档" },
	pptx: { icon: "📊", label: "PPT 演示文稿" },
	xlsx: { icon: "📋", label: "Excel 表格" },
	html: { icon: "🌐", label: "HTML 页面" },
};

export function DownloadOnlyRenderer({ manifest }: Props) {
	const primaryUrl = getArtifactFileUrl(manifest.id, manifest.primaryFile);
	const meta = KIND_META[manifest.kind];

	return (
		<div className="space-y-4">
			<div className="rounded-md border border-input bg-muted/30 p-5 text-center">
				<div className="text-5xl">{meta.icon}</div>
				<div className="mt-3 text-base font-medium">{meta.label}</div>
				<div className="mt-1 break-all text-sm text-muted-foreground">{manifest.primaryFile}</div>
				<div className="mt-4 grid gap-2 text-left text-xs text-muted-foreground">
					<div>大小：{formatBytes(manifest.metadata.sizeBytes)}</div>
					<div>生成工具：{manifest.metadata.sourceSkill}</div>
					<div>创建时间：{formatTime(manifest.metadata.createdAt)}</div>
					<div>来源对话：{manifest.metadata.sourceConversationId.slice(0, 12)}</div>
				</div>
				<div className="mt-5 flex flex-col gap-2">
					<Button onClick={() => downloadFile(primaryUrl, manifest.primaryFile)}>
						<Download className="size-4" />
						下载 {manifest.primaryFile}
					</Button>
				</div>
			</div>

			{manifest.files.length > 1 && (
				<div className="rounded-md border border-input">
					<div className="border-b border-input px-3 py-2 text-sm font-medium">附属文件</div>
					<div className="divide-y divide-input">
						{manifest.files
							.filter((file) => file.name !== manifest.primaryFile)
							.map((file) => (
								<div key={file.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
									<div className="min-w-0">
										<div className="truncate">{file.name}</div>
										<div className="text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</div>
									</div>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => downloadFile(getArtifactFileUrl(manifest.id, file.name), file.name)}
										aria-label={`下载 ${file.name}`}
									>
										<Download className="size-4" />
									</Button>
								</div>
							))}
					</div>
				</div>
			)}
		</div>
	);
}

function downloadFile(url: string, filename: string) {
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} bytes`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}
