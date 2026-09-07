import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildHoverPreview, firstUsefulParagraph, previewSummary } from "../src/render";

describe("hover preview helpers", () => {
  it("extracts the first useful paragraph after frontmatter and headings", () => {
    const paragraph = firstUsefulParagraph(`---
title: Demo
---
# Demo

第一段说明 [[wiki/entities/A.md|节点A]] 和 [链接](https://example.com)。

第二段不应该出现。`);

    assert.equal(paragraph, "第一段说明 节点A 和 链接。");
  });

  it("uses explicit summary before content", () => {
    assert.equal(
      previewSummary({
        summary: "显式摘要优先。",
        content: "# 标题\n\n正文不应该出现。"
      }),
      "显式摘要优先。"
    );
  });

  it("handles wikilinks, code fences, empty content, and truncation", () => {
    assert.equal(
      previewSummary({
        content: "```js\nconsole.log('skip')\n```\n\n## 标题\n\n包含 [[Target|标签]] 和 `代码`。"
      }),
      "包含 标签 和 代码。"
    );

    assert.equal(previewSummary({ content: "" }), "");

    const long = previewSummary({ content: `# 标题\n\n${"长".repeat(180)}` });
    assert.equal(long.length <= 143, true);
    assert.equal(long.endsWith("..."), true);
  });

  it("builds a title and type even when content is empty", () => {
    assert.deepEqual(
      buildHoverPreview({ id: "a", label: "节点A", type: "topic", content: "" }),
      {
        id: "a",
        title: "节点A",
        typeLabel: "主题",
        summary: ""
      }
    );
  });
});
