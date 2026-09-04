/**
 * 极简 SSE parser，从 fetch 返回的 ReadableStream 里解析出 {event, data} 序列。
 *
 * 为什么不用 EventSource：EventSource 只支持 GET，我们的 /api/prompt 是 POST。
 * 业界主流做法是 fetch + ReadableStream，自己解析 SSE 格式（spec 简单）。
 *
 * SSE 行格式（spec: https://html.spec.whatwg.org/multipage/server-sent-events.html）：
 *   event: <name>
 *   data: <payload>
 *   <空行>
 * 多行 data 会被合并（用换行连接）。
 */

export interface SSEMessage {
	event: string;
	data: string;
}

export async function* parseSSE(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEMessage, void, undefined> {
	const reader = stream.getReader();
	const decoder = new TextDecoder("utf-8");
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				// flush 剩余 buffer（理论上 server 用空行结尾，不会有残余）
				if (buffer.trim()) {
					const msg = parseBlock(buffer);
					if (msg) yield msg;
				}
				return;
			}
			buffer += decoder.decode(value, { stream: true });

			// 按 "\n\n" 切分消息块
			while (true) {
				const idx = buffer.indexOf("\n\n");
				if (idx === -1) break;
				const block = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const msg = parseBlock(block);
				if (msg) yield msg;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function parseBlock(block: string): SSEMessage | null {
	let event = "message";
	const dataLines: string[] = [];

	for (const rawLine of block.split("\n")) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (!line || line.startsWith(":")) continue; // 注释或空行
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const field = line.slice(0, colonIdx);
		// SSE spec：":" 后若有一个空格，去掉它
		const value = line.slice(colonIdx + 1).replace(/^ /, "");
		if (field === "event") event = value;
		else if (field === "data") dataLines.push(value);
	}

	if (dataLines.length === 0) return null;
	return { event, data: dataLines.join("\n") };
}
