import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_DENSITY_PREVIEW_HTML || "";
assert.notEqual(html, "", "GRAPH_DENSITY_PREVIEW_HTML must point at generated HTML");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");

  const root = page.locator("[data-llm-wiki-graph-root='true']");
  const totalNodes = await page.locator(".node").count();
  const fullCards = await page.locator(".node:not(.is-compact):not(.is-point):not(.is-overview)").count();
  assert.ok(totalNodes >= 120, `dense fixture should render many nodes, got ${totalNodes}`);
  assert.ok(fullCards < totalNodes / 2, "dense fixture should not render every node as a full card");

  const compact = page.locator(".node.is-compact").first();
  await compact.waitFor();
  await compact.hover();
  await assertPreviewOpen(page, "compact node should open hover preview");

  await page.mouse.move(20, 20);
  await waitForPreviewState(page, "closed");

  await page.waitForSelector(".node.is-point");
  const point = page.locator(".node.is-point").first();
  await point.evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }));
  });
  await assertPreviewOpen(page, "point node should open hover preview");
} finally {
  await browser.close();
}

async function assertPreviewOpen(page, message) {
  await page.waitForSelector(".graph-hover-preview[data-state='open']");
  const preview = page.locator(".graph-hover-preview");
  await preview.locator(".graph-hover-preview-title").waitFor();
  await preview.locator(".graph-hover-preview-type").waitFor();
  assert.equal(await preview.locator(".graph-hover-preview-summary").count(), 1, message);
}

async function waitForPreviewState(page, state) {
  await page.waitForFunction((state) => {
    return document.querySelector(".graph-hover-preview")?.dataset.state === state;
  }, state);
}
