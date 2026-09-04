import { HtmlRenderer } from "./renderers/HtmlRenderer";
import { DownloadOnlyRenderer } from "./renderers/DownloadOnlyRenderer";
import type { ArtifactManifest } from "../lib/api";

interface Props {
	manifest: ArtifactManifest;
}

export function ArtifactView({ manifest }: Props) {
	if (manifest.renderer === "iframe") {
		return <HtmlRenderer manifest={manifest} />;
	}

	return <DownloadOnlyRenderer manifest={manifest} />;
}
