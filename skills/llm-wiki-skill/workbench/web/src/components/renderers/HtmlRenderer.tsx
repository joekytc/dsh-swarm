import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { getArtifactFileUrl, type ArtifactManifest } from "../../lib/api";

interface Props {
	manifest: ArtifactManifest;
}

export function HtmlRenderer({ manifest }: Props) {
	const [html, setHtml] = useState("");
	const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
	const fileUrl = getArtifactFileUrl(manifest.id, manifest.primaryFile);

	useEffect(() => {
		let cancelled = false;
		const loadingTimer = window.setTimeout(() => {
			if (!cancelled) setStatus("loading");
		}, 0);
		fetch(fileUrl)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.text();
			})
			.then((content) => {
				if (cancelled) return;
				setHtml(content);
				setStatus("loaded");
			})
			.catch(() => {
				if (!cancelled) setStatus("error");
			});
		return () => {
			cancelled = true;
			window.clearTimeout(loadingTimer);
		};
	}, [fileUrl]);

	if (!manifest.primaryFile.endsWith(".html") && !manifest.primaryFile.endsWith(".htm")) {
		return <HtmlFallback manifest={manifest} reason="主文件不是 HTML 文件" />;
	}

	if (status === "loading") {
		return (
			<div className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted-foreground">
				<Loader2 className="mr-2 size-4 animate-spin" />
				加载 HTML...
			</div>
		);
	}

	if (status === "error") {
		return <HtmlFallback manifest={manifest} reason="HTML 加载失败" />;
	}

	return (
		<div className="h-[calc(100vh-7.5rem)] min-h-[420px] overflow-hidden rounded-md border border-input bg-white">
			<iframe
				sandbox="allow-scripts"
				srcDoc={html}
				className="h-full w-full border-0 bg-white"
				loading="lazy"
				title={manifest.metadata.title}
			/>
		</div>
	);
}

function HtmlFallback({ manifest, reason }: { manifest: ArtifactManifest; reason: string }) {
	return (
		<div className="rounded-md border border-input bg-muted/30 p-4 text-sm">
			<div className="font-medium">{reason}</div>
			<div className="mt-2 text-xs text-muted-foreground">
				建议 HTML 产物使用自包含文件，图片使用 data URI 内嵌。
			</div>
			<Button
				className="mt-4"
				variant="outline"
				onClick={() => {
					const link = document.createElement("a");
					link.href = getArtifactFileUrl(manifest.id, manifest.primaryFile);
					link.download = manifest.primaryFile;
					link.click();
				}}
			>
				<Download className="size-4" />
				下载原文件
			</Button>
		</div>
	);
}
