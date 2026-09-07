import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_HTML_INSIGHTS_HTML || "";
assert.notEqual(html, "", "GRAPH_HTML_INSIGHTS_HTML must point at generated HTML");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");

  await page.keyboard.down("Shift");
  await page.locator(".node[data-id='A']").click();
  await page.locator(".node[data-id='B']").click();
  await page.keyboard.up("Shift");
  await page.waitForSelector(".graph-selection-panel[data-state='open']");
  const panel = page.locator(".graph-selection-panel");
  await panel.getByText("Shift+点击 增删节点").waitFor();
  await panel.getByText("节点A").waitFor();
  await panel.getByText("节点B").waitFor();
  assert.ok(await panel.locator(".graph-selection-fact").count() >= 4, "Shift selection should show structural facts");
  assert.equal(await panel.getByText("提问选区").count(), 0, "offline selection panel must not show ask actions");

  await page.keyboard.press("Escape");
  await page.waitForSelector(".graph-selection-panel[data-state='closed']");

  await page.getByRole("button", { name: "筛选" }).click();
  await page.waitForSelector('.graph-toolbar-panel[data-state="filters"] .community-legend-row');
  await page.locator(".community-legend-row").first().click();
  await page.waitForSelector(".graph-selection-panel[data-state='open']");
  await panel.getByText(/社区选区/).waitFor();
  await panel.getByText("内部关联").waitFor();
  assert.equal(await panel.locator("button", { hasText: "提问选区" }).count(), 0, "offline community selection must not show ask actions");
} finally {
  await browser.close();
}
