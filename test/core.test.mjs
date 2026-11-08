import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "..", "chrome", "content", "scripts", "core.js"), "utf8");

// Evaluate core.js in this realm so arrays/objects share prototypes with the
// test assertions (vm contexts create cross-realm prototypes).
const core = (() => {
	const mod = { exports: {} };
	// eslint-disable-next-line no-new-func
	const factory = new Function("module", "exports", source + "\n;return module.exports;");
	return factory(mod, mod.exports);
})();


test("normalizeText keeps page separators and collapses blank lines", () => {
	const out = core.normalizeText("a\r\n\r\n\r\n\r\nb\f c  \n");
	assert.ok(out.includes("\f"), "form feed must be preserved");
	assert.ok(!out.includes("\r"));
	assert.ok(!/\n{3,}/.test(out));
});

test("splitPages splits on form feed and drops the trailing empty page", () => {
	const pages = core.splitPages("Page one.\fPage two.\f");
	assert.equal(pages.length, 2);
	assert.equal(pages[0], "Page one.");
	assert.equal(pages[1], "Page two.");
	assert.deepEqual(core.splitPages("   "), []);
});

test("chunkPages never crosses page boundaries and respects the target size", () => {
	const pages = ["alpha ".repeat(400), "beta ".repeat(400)];
	const chunks = core.chunkPages(pages, { targetChars: 600 });
	assert.ok(chunks.length >= 2);
	assert.deepEqual([...new Set(chunks.map((c) => c.page))].sort(), [1, 2]);
	for (const chunk of chunks) {
		assert.ok(chunk.text.length <= 700, `chunk too big: ${chunk.text.length}`);
	}
});

test("chunkPages keeps page numbers stable even with empty pages", () => {
	const chunks = core.chunkPages(["first page text", "", "third page text"], { targetChars: 800 });
	assert.deepEqual(chunks.map((c) => c.page), [1, 3]);
});

test("tokenize emits latin words and CJK bigrams", () => {
	const tokens = core.tokenize("Transformer 模型 attention");
	assert.ok(tokens.includes("transformer"));
	assert.ok(tokens.includes("attention"));
	assert.ok(tokens.includes("模"));
	assert.ok(tokens.includes("模型"));
});

test("rankChunks ranks the semantically relevant chunk first", () => {
	const chunks = [
		"O".repeat(0) + "introduction about datasets and benchmarks ".repeat(10),
		"the attention mechanism computes attention weights for each token ".repeat(10),
		"conclusion and future work ".repeat(10)
	].map((text, index) => ({ index, page: index + 1, text }));
	const index2 = core.buildIndex(chunks);
	const ranked = core.rankChunks(index2, "how does the attention mechanism work", 3);
	assert.ok(ranked.length > 0);
	assert.equal(ranked[0].index, 1);
});

test("buildPaperContext sends the full text when it fits the budget", () => {
	const pages = ["A".repeat(1000), "B".repeat(1000)];
	const ctx = core.buildPaperContext({ pages, budgetChars: 5000 });
	assert.equal(ctx.mode, "full");
	assert.equal(ctx.pageCount, 2);
	assert.ok(ctx.text.includes("【第 1 页】"));
	assert.ok(ctx.text.includes("【第 2 页】"));
	assert.ok(ctx.usedChars > 2000);
});

test("buildPaperContext switches to retrieval for long papers and keeps the hit page", () => {
	const pages = Array.from({ length: 40 }, (_, i) => {
		return i === 17
			? "the attention mechanism computes attention weights. ".repeat(30)
			: "unrelated background discussion of other topics. ".repeat(15);
	});
	const ctx = core.buildPaperContext({ pages, budgetChars: 4000, query: "attention mechanism" });
	assert.equal(ctx.mode, "retrieval");
	assert.ok(ctx.text.includes("【第 18 页】"), "the relevant page must be included");
	assert.ok(ctx.usedChars <= 4000 + 400, "must respect the budget");
	assert.ok(ctx.chunksUsed > 0 && ctx.chunksUsed < ctx.chunksTotal);
});

test("buildPaperContext returns mode none when there is no text", () => {
	const ctx = core.buildPaperContext({ pages: ["", ""], budgetChars: 5000 });
	assert.equal(ctx.mode, "none");
	assert.equal(ctx.totalChars, 0);
});

test("normalizeEndpoint handles base URLs, versioned URLs and full endpoints", () => {
	const cases = {
		"https://api.deepseek.com": "https://api.deepseek.com/v1/chat/completions",
		"https://api.deepseek.com/": "https://api.deepseek.com/v1/chat/completions",
		"api.openai.com/v1": "https://api.openai.com/v1/chat/completions",
		"https://dashscope.aliyuncs.com/compatible-mode/v1/": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
		"https://open.bigmodel.cn/api/paas/v4": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
		"http://localhost:11434": "http://localhost:11434/v1/chat/completions",
		"https://example.com/v1/chat/completions": "https://example.com/v1/chat/completions",
		"": ""
	};
	for (const [input, expected] of Object.entries(cases)) {
		assert.equal(core.normalizeEndpoint(input), expected, input);
	}
});

test("buildHeaders merges extra JSON headers and ignores invalid JSON", () => {
	const headers = core.buildHeaders({
		apiKey: "sk-test",
		extraHeaders: JSON.stringify({ "api-key": "azure-key", "X-Trace": 1 })
	});
	assert.equal(headers.Authorization, "Bearer sk-test");
	assert.equal(headers["api-key"], "azure-key");
	assert.equal(headers["X-Trace"], "1");
	assert.equal(headers["Content-Type"], "application/json");

	const fallback = core.buildHeaders({ apiKey: "", extraHeaders: "{not json" });
	assert.equal(fallback.Authorization, undefined);
	assert.equal(fallback["Content-Type"], "application/json");
});

test("buildRequestBody omits out-of-range temperature and adds max_tokens only when set", () => {
	const body = core.buildRequestBody({
		model: "m",
		messages: [],
		stream: true,
		temperature: 9,
		maxTokens: 0
	});
	assert.equal(body.temperature, undefined);
	assert.equal(body.max_tokens, undefined);
	assert.equal(body.stream, true);

	const body2 = core.buildRequestBody({ model: "m", messages: [], temperature: "0.2", maxTokens: "256" });
	assert.equal(body2.temperature, 0.2);
	assert.equal(body2.max_tokens, 256);
});

test("SSE parser handles events split across network chunks", () => {
	const parser = core.createSSEParser();
	assert.deepEqual(parser.push('data: {"a":1}\n\ndata: {"b"'), ['{"a":1}']);
	assert.deepEqual(parser.push(':2}\n\n'), ['{"b":2}']);
	assert.deepEqual(parser.push("data: [DONE]\n\n"), ["[DONE]"]);
	assert.deepEqual(parser.push(": keep-alive\n\n"), []);
});

test("extractDelta supports string and array content plus reasoning", () => {
	const plain = core.extractDelta({ choices: [{ delta: { content: "hi" }, finish_reason: null }] });
	assert.equal(plain.content, "hi");

	const rich = core.extractDelta({
		choices: [{ delta: { content: [{ type: "text", text: "a" }, { text: "b" }], reasoning_content: "think" } }]
	});
	assert.equal(rich.content, "ab");
	assert.equal(rich.reasoning, "think");
});

test("extractAnswer reads non-streaming responses", () => {
	const answer = core.extractAnswer({
		choices: [{ message: { content: "answer", reasoning_content: "r" }, finish_reason: "stop" }],
		usage: { total_tokens: 12 }
	});
	assert.equal(answer.content, "answer");
	assert.equal(answer.reasoning, "r");
	assert.equal(answer.finish, "stop");
});

test("parseMarkdown handles headings, lists, fences, quotes and tables", () => {
	const blocks = core.parseMarkdown([
		"# Title",
		"",
		"Some **bold** text with `code`.",
		"",
		"- one",
		"- two",
		"",
		"1. first",
		"2. second",
		"",
		"```python",
		"print(1)",
		"```",
		"",
		"> quoted line",
		"",
		"| a | b |",
		"| --- | --- |",
		"| 1 | 2 |"
	].join("\n"));

	const types = blocks.map((b) => b.type);
	assert.deepEqual(types, ["heading", "paragraph", "list", "list", "code", "quote", "table"]);
	assert.equal(blocks[0].level, 1);
	assert.equal(blocks[2].ordered, false);
	assert.equal(blocks[2].items.length, 2);
	assert.equal(blocks[3].ordered, true);
	assert.equal(blocks[4].lang, "python");
	assert.deepEqual(blocks[6].header, ["a", "b"]);
	assert.deepEqual(blocks[6].rows, [["1", "2"]]);
});

test("markdownToHTML escapes model output (no HTML injection)", () => {
	const blocks = core.parseMarkdown('Hello <script>alert("x")</script> & <img src=x onerror=1>');
	const html = core.markdownToHTML(blocks);
	assert.ok(!html.includes("<script>"));
	assert.ok(!html.includes("<img"));
	assert.ok(html.includes("&lt;script&gt;"));
	assert.ok(html.includes("&amp;"));
});

test("buildMessages puts the paper context in the system prompt and caps history", () => {
	const pages = ["page text ".repeat(100)];
	const context = core.buildPaperContext({ pages, budgetChars: 100000 });
	const messages = core.buildMessages({
		paper: { title: "My Paper", creators: ["Ada Lovelace"], year: "1843" },
		context,
		selection: "selected quote",
		question: "what does it mean?",
		history: [
			{ role: "user", content: "old question".repeat(2000) },
			{ role: "assistant", content: "old answer" }
		],
		historyBudgetChars: 500,
		language: "zh"
	});

	assert.equal(messages[0].role, "system");
	assert.ok(messages[0].content.includes("My Paper"));
	assert.ok(messages[0].content.includes("【第 1 页】"));
	assert.equal(messages[messages.length - 1].role, "user");
	assert.ok(messages[messages.length - 1].content.includes("selected quote"));
	assert.ok(messages[messages.length - 1].content.includes("what does it mean?"));
	// Only the short assistant message fits the history budget.
	const historyMessages = messages.slice(1, -1);
	assert.equal(historyMessages.length, 1);
	assert.equal(historyMessages[0].role, "assistant");
});

test("buildMessages truncates oversized selections", () => {
	const context = core.buildPaperContext({ pages: ["x"], budgetChars: 100000 });
	const messages = core.buildMessages({
		paper: {},
		context,
		selection: "s".repeat(9000),
		question: "q"
	});
	assert.ok(messages[messages.length - 1].content.length < 9000);
	assert.ok(messages[messages.length - 1].content.includes("已截断"));
});

test("estimateTokens and formatChars produce display values", () => {
	assert.equal(core.estimateTokens(0), 0);
	assert.equal(core.estimateTokens(250), 100);
	assert.equal(core.formatChars(82341), "8.2 万");
	assert.equal(core.formatChars(1234), "1234");
});

test("buildRequestBody adds thinking / reasoning_effort only when enabled", () => {
	const auto = core.buildRequestBody({ model: "m", messages: [], thinking: "auto" });
	assert.equal(auto.thinking, undefined);
	assert.equal(auto.reasoning_effort, undefined);

	const disabled = core.buildRequestBody({ model: "m", messages: [], thinking: "disabled" });
	assert.deepEqual(disabled.thinking, { type: "disabled" });
	assert.equal(disabled.reasoning_effort, undefined);

	const enabled = core.buildRequestBody({
		model: "m",
		messages: [],
		thinking: "enabled",
		reasoningEffort: "max"
	});
	assert.deepEqual(enabled.thinking, { type: "enabled" });
	assert.equal(enabled.reasoning_effort, "max");

	const badEffort = core.buildRequestBody({
		model: "m",
		messages: [],
		thinking: "enabled",
		reasoningEffort: "ultra"
	});
	assert.equal(badEffort.reasoning_effort, undefined);
});

test("buildRequestBody requests usage only for streaming requests", () => {
	const streaming = core.buildRequestBody({ model: "m", messages: [], stream: true, includeUsage: true });
	assert.deepEqual(streaming.stream_options, { include_usage: true });

	const nonStreaming = core.buildRequestBody({ model: "m", messages: [], stream: false, includeUsage: true });
	assert.equal(nonStreaming.stream_options, undefined);
});

test("normalizeUsage / formatUsage summarize input, output and cache hits", () => {
	const usage = core.normalizeUsage({
		prompt_tokens: 31000,
		completion_tokens: 800,
		total_tokens: 31800,
		prompt_cache_hit_tokens: 29000,
		prompt_cache_miss_tokens: 2000
	});
	assert.equal(usage.promptTokens, 31000);
	assert.equal(usage.completionTokens, 800);
	assert.equal(usage.cacheHitTokens, 29000);

	const text = core.formatUsage(usage);
	assert.ok(text.includes("输入 3.1万"), text);
	assert.ok(text.includes("缓存命中 2.9万"), text);
	assert.ok(text.includes("输出 800"), text);

	assert.equal(core.normalizeUsage(null), null);
	assert.equal(core.formatUsage(null), "");
});
