/*
 * AI 论文助手 (Zotero Ask AI) - pure logic core
 *
 * No Zotero / DOM dependencies at load time (except renderMarkdown, which needs
 * a document). Loaded both in the chat window and in Node unit tests.
 */

var AskAICore = (function () {
	"use strict";

	const DEFAULT_SYSTEM_PROMPT = [
		"你是一位严谨、细致的学术论文阅读助手，擅长帮助研究者读懂论文。请遵守以下规则：",
		"1. 优先依据下面提供的论文内容作答；引用原文时用引号标注并注明页码，例如：“……”（第 3 页）。",
		"2. 如果论文中没有相关信息，明确说明“论文中未提及”，再视情况补充通用领域知识，并清楚区分“论文内容”与“补充知识”。",
		"3. 不要编造论文中不存在的公式、数据、实验结论或参考文献。",
		"4. 先给结论，再给依据；必要时用列表或分步骤说明；涉及公式时解释每个符号的含义。",
		"5. 保持简洁，但不要牺牲准确性。"
	].join("\n");

	const DEFAULT_QUESTION = "请结合论文全文，解释我选中的这段内容：它是什么意思、在论文中起什么作用、与上下文和论文核心论点有什么关系？如果涉及公式、实验或数据，请补充必要的背景。";

	const LANG_INSTRUCTION = {
		zh: "请用简体中文回答。",
		en: "Answer in English.",
		auto: "请使用与用户提问相同的语言回答（例如用户用中文提问就用中文回答）。"
	};

	const XHTML_NS = "http://www.w3.org/1999/xhtml";

	/* ---------------------------------------------------------------- text */

	function pageMark(n) {
		return "【第 " + n + " 页】";
	}

	/**
	 * Normalize extracted PDF text while preserving \f page separators.
	 */
	function normalizeText(text) {
		return String(text == null ? "" : text)
			.replace(/\r\n?/g, "\n")
			.replace(/\u0000/g, "")
			.replace(/[\u00ad]/g, "")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/[ \t]{3,}/g, "  ")
			.trim();
	}

	/**
	 * Split a full-text string into pages (PDFWorker separates pages with \f).
	 */
	function splitPages(text) {
		const s = String(text == null ? "" : text);
		if (!s.trim()) return [];
		const parts = s.split("\f");
		while (parts.length && !parts[parts.length - 1].trim()) parts.pop();
		return parts.map((p) => p.trim());
	}

	function splitLongText(text, maxChars) {
		if (text.length <= maxChars) return [text];
		const parts = [];
		const sentences = text.match(/[^。！？；!?;.\n]+[。！？；!?;.]?/g) || [text];
		let cur = "";
		for (const raw of sentences) {
			let s = raw;
			if (s.length > maxChars) {
				if (cur) {
					parts.push(cur);
					cur = "";
				}
				for (let i = 0; i < s.length; i += maxChars) {
					parts.push(s.slice(i, i + maxChars));
				}
				continue;
			}
			if (cur && cur.length + s.length > maxChars) {
				parts.push(cur);
				cur = "";
			}
			cur += s;
		}
		if (cur) parts.push(cur);
		return parts;
	}

	/**
	 * Split pages into overlapping-free chunks that never cross page boundaries,
	 * so every chunk can be cited by page number.
	 */
	function chunkPages(pages, options) {
		const target = Math.max(400, (options && options.targetChars) || 1500);
		const chunks = [];
		const list = pages || [];

		for (let pageIndex = 0; pageIndex < list.length; pageIndex++) {
			const pageText = String(list[pageIndex] == null ? "" : list[pageIndex]).trim();
			if (!pageText) continue;

			let buf = [];
			let len = 0;
			const flush = () => {
				if (!buf.length) return;
				const text = buf.join("\n\n").trim();
				if (text) {
					chunks.push({
						index: chunks.length,
						page: pageIndex + 1,
						text
					});
				}
				buf = [];
				len = 0;
			};

			const paras = pageText.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
			for (const para of paras.length ? paras : [pageText]) {
				for (const part of splitLongText(para, target)) {
					if (len > 0 && len + part.length > target) flush();
					buf.push(part);
					len += part.length + 2;
				}
			}
			flush();
		}

		return chunks;
	}

	/* ------------------------------------------------------------ retrieval */

	function tokenize(text) {
		const out = [];
		const s = String(text == null ? "" : text).toLowerCase();
		if (!s) return out;

		const latinRe = /[a-z0-9][a-z0-9_+\-.]{1,}/g;
		let m;
		while ((m = latinRe.exec(s))) {
			out.push(m[0].replace(/\.+$/, ""));
		}

		const cjkRe = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
		const chars = s.match(cjkRe) || [];
		for (let i = 0; i < chars.length; i++) {
			out.push(chars[i]);
			if (i + 1 < chars.length) out.push(chars[i] + chars[i + 1]);
		}
		return out;
	}

	function buildIndex(chunks) {
		const docs = [];
		const df = new Map();
		for (const chunk of chunks) {
			const tf = new Map();
			const tokens = tokenize(chunk.text);
			for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
			for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
			docs.push({
				tf,
				length: tokens.length
			});
		}
		const total = docs.reduce((sum, doc) => sum + doc.length, 0);
		return {
			chunks,
			docs,
			df,
			avgdl: docs.length ? total / docs.length : 0,
			N: docs.length
		};
	}

	/**
	 * BM25 ranking. Chinese text is indexed with single characters + bigrams,
	 * which works well without a dictionary-based tokenizer.
	 */
	function rankChunks(index, query, topK) {
		const qTokens = Array.from(new Set(tokenize(query))).filter((t) => {
			return t.length > 1 || /[\u3400-\u4dbf\u4e00-\u9fff]/.test(t);
		});
		if (!qTokens.length) return [];

		const k1 = 1.2;
		const b = 0.75;
		const scored = [];
		for (let i = 0; i < index.docs.length; i++) {
			const doc = index.docs[i];
			let score = 0;
			for (const term of qTokens) {
				const tf = doc.tf.get(term);
				if (!tf) continue;
				const df = index.df.get(term) || 0;
				const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5));
				const norm = tf + k1 * (1 - b + b * (doc.length / (index.avgdl || 1)));
				score += idf * ((tf * (k1 + 1)) / norm);
			}
			if (score > 0) scored.push({ index: i, score });
		}
		scored.sort((a, b2) => b2.score - a.score);
		return scored.slice(0, Math.max(1, topK || 20));
	}

	/**
	 * Build the paper context sent to the model.
	 *
	 * mode "full"      - the whole paper fits into the budget, send it all
	 * mode "retrieval" - paper too long, send the most relevant chunks
	 * mode "none"      - no text could be extracted
	 */
	function buildPaperContext(options) {
		const opts = options || {};
		const pages = (opts.pages || []).map((p) => (typeof p === "string" ? p : ""));
		const budget = Math.max(2000, Number(opts.budgetChars) || 100000);
		const totalChars = pages.reduce((n, p) => n + p.length, 0);
		const pageCount = pages.length;

		if (!totalChars) {
			return {
				mode: "none",
				text: "",
				usedChars: 0,
				totalChars: 0,
				pageCount: pageCount,
				chunksUsed: 0,
				chunksTotal: 0
			};
		}

		if (opts.forceMode !== "retrieval" && totalChars <= budget) {
			const text = pages
				.map((p, i) => (p ? pageMark(i + 1) + "\n" + p : ""))
				.filter(Boolean)
				.join("\n\n");
			return {
				mode: "full",
				text,
				usedChars: text.length,
				totalChars,
				pageCount,
				chunksUsed: 0,
				chunksTotal: 0
			};
		}

		const chunks = chunkPages(pages);
		const index = buildIndex(chunks);
		const query = [opts.selection, opts.query].filter(Boolean).join("\n");
		const ranked = rankChunks(index, query, 30);

		const picked = [];
		const seen = new Set();
		let used = 0;
		const push = (chunk) => {
			if (!chunk || seen.has(chunk.index)) return false;
			const cost = chunk.text.length + 16;
			if (used + cost > budget) return false;
			seen.add(chunk.index);
			picked.push(chunk);
			used += cost;
			return true;
		};

		for (const item of ranked) {
			push(index.chunks[item.index]);
			push(index.chunks[item.index - 1]);
			push(index.chunks[item.index + 1]);
			if (used > budget * 0.95) break;
		}

		if (!picked.length && index.chunks.length) {
			const first = index.chunks[0];
			picked.push({
				index: 0,
				page: first.page,
				text: first.text.slice(0, budget)
			});
		}

		picked.sort((a, b2) => a.index - b2.index);
		const text = picked.map((c) => pageMark(c.page) + "\n" + c.text).join("\n\n");
		return {
			mode: "retrieval",
			text,
			usedChars: text.length,
			totalChars,
			pageCount,
			chunksUsed: picked.length,
			chunksTotal: chunks.length
		};
	}

	function estimateTokens(chars) {
		return Math.ceil((Number(chars) || 0) / 2.5);
	}

	/* --------------------------------------------------------------- prompt */

	function buildSystemPrompt(options) {
		const opts = options || {};
		const paper = opts.paper || {};
		const context = opts.context || { mode: "none", text: "", pageCount: 0, usedChars: 0, totalChars: 0, chunksUsed: 0, chunksTotal: 0 };
		const base = String(opts.customPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT;
		const lang = LANG_INSTRUCTION[opts.language] || LANG_INSTRUCTION.auto;

		const meta = [
			paper.title ? "标题：" + paper.title : "",
			paper.creators && paper.creators.length ? "作者：" + paper.creators.join("、") : "",
			paper.year ? "年份：" + paper.year : "",
			paper.venue ? "发表：" + paper.venue : ""
		].filter(Boolean).join("\n");

		let contextBlock;
		if (context.mode === "full") {
			contextBlock = "以下是该论文的全文（共 " + context.pageCount + " 页）：\n\n" + context.text;
		}
		else if (context.mode === "retrieval") {
			contextBlock = "该论文全文共 " + context.pageCount + " 页、" + context.totalChars
				+ " 字符，超出本次上下文预算；以下是从论文中检索出的、与本次问题最相关的 "
				+ context.chunksUsed + " / " + context.chunksTotal + " 段内容（按原文顺序排列，页码为 PDF 页码）：\n\n"
				+ context.text;
		}
		else {
			contextBlock = "（未能提取到该论文的正文文本，可能因为它是扫描版 PDF 或没有附件。请只依据用户选中的内容回答，并提醒用户这一限制。）";
		}

		return [
			base,
			lang,
			"",
			"【论文信息】",
			meta || "（无元数据）",
			"",
			"【论文内容】",
			contextBlock
		].join("\n");
	}

	/**
	 * Assemble the OpenAI-style messages array for one request.
	 */
	function buildMessages(options) {
		const opts = options || {};
		const history = Array.isArray(opts.history) ? opts.history : [];
		const historyBudget = Math.max(2000, Number(opts.historyBudgetChars) || 16000);

		const messages = [{
			role: "system",
			content: buildSystemPrompt(opts)
		}];

		let used = 0;
		const kept = [];
		for (let i = history.length - 1; i >= 0; i--) {
			const msg = history[i];
			if (!msg || !msg.content) continue;
			if (used + msg.content.length > historyBudget) break;
			kept.unshift({
				role: msg.role === "assistant" ? "assistant" : "user",
				content: String(msg.content)
			});
			used += msg.content.length;
		}
		messages.push(...kept);

		let selection = String(opts.selection || "").trim();
		if (selection.length > 8000) {
			selection = selection.slice(0, 8000) + "\n……（选中内容过长，已截断）";
		}
		const question = String(opts.question || "").trim();
		const userContent = selection
			? "我选中的论文内容：\n“””\n" + selection + "\n“””\n\n我的问题：" + question
			: question;

		messages.push({
			role: "user",
			content: userContent
		});
		return messages;
	}

	/* ----------------------------------------------------------------- HTTP */

	function normalizeEndpoint(input) {
		let url = String(input == null ? "" : input).trim().replace(/\s+/g, "");
		if (!url) return "";
		if (!/^https?:\/\//i.test(url)) url = "https://" + url;
		url = url.replace(/\/+$/, "");
		if (/\/chat\/completions$/i.test(url)) return url;
		if (/\/v\d+$/i.test(url)) return url + "/chat/completions";
		return url + "/v1/chat/completions";
	}

	function parseExtraHeaders(extraHeaders) {
		if (!extraHeaders) return {};
		let parsed = extraHeaders;
		if (typeof extraHeaders === "string") {
			try {
				parsed = JSON.parse(extraHeaders);
			}
			catch (e) {
				return {};
			}
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out = {};
		for (const key of Object.keys(parsed)) {
			if (parsed[key] == null) continue;
			out[key] = String(parsed[key]);
		}
		return out;
	}

	function buildHeaders(options) {
		const opts = options || {};
		const headers = { "Content-Type": "application/json" };
		const apiKey = String(opts.apiKey || "").trim();
		if (apiKey) headers.Authorization = "Bearer " + apiKey;
		const extra = parseExtraHeaders(opts.extraHeaders);
		for (const key of Object.keys(extra)) headers[key] = extra[key];
		return headers;
	}

	function buildRequestBody(options) {
		const opts = options || {};
		const body = {
			model: String(opts.model || "").trim(),
			messages: opts.messages || [],
			stream: !!opts.stream
		};
		const temperature = Number(opts.temperature);
		if (Number.isFinite(temperature) && temperature >= 0 && temperature <= 2 && opts.temperature !== "" && opts.temperature != null) {
			body.temperature = temperature;
		}
		const maxTokens = parseInt(opts.maxTokens, 10);
		if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;

		// DeepSeek-style thinking mode (OpenAI-compatible top-level fields).
		// Only sent when explicitly enabled/disabled, so other providers are unaffected.
		const thinking = opts.thinking;
		if (thinking === "enabled" || thinking === "disabled") {
			body.thinking = { type: thinking };
		}
		const effort = opts.reasoningEffort;
		if (thinking === "enabled" && ["low", "high", "max"].includes(effort)) {
			body.reasoning_effort = effort;
		}

		// Ask the provider to include token usage in the final stream chunk.
		if (body.stream && opts.includeUsage) {
			body.stream_options = { include_usage: true };
		}

		return body;
	}

	/**
	 * Normalize a usage object from an OpenAI-compatible response.
	 * Returns null when the provider didn't include usage.
	 */
	function normalizeUsage(usage) {
		if (!usage || typeof usage !== "object") return null;
		const out = {};
		const prompt = Number(usage.prompt_tokens);
		const completion = Number(usage.completion_tokens);
		const total = Number(usage.total_tokens);
		if (Number.isFinite(prompt)) out.promptTokens = prompt;
		if (Number.isFinite(completion)) out.completionTokens = completion;
		if (Number.isFinite(total)) out.totalTokens = total;
		if (Number.isFinite(Number(usage.prompt_cache_hit_tokens))) {
			out.cacheHitTokens = Number(usage.prompt_cache_hit_tokens);
		}
		if (Number.isFinite(Number(usage.prompt_cache_miss_tokens))) {
			out.cacheMissTokens = Number(usage.prompt_cache_miss_tokens);
		}
		return Object.keys(out).length ? out : null;
	}

	/**
	 * Human-readable one-line usage summary.
	 */
	function formatUsage(usage) {
		if (!usage) return "";
		const num = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + "万" : String(n));
		const parts = [];
		if (typeof usage.promptTokens === "number") parts.push("输入 " + num(usage.promptTokens));
		if (typeof usage.completionTokens === "number") parts.push("输出 " + num(usage.completionTokens));
		if (typeof usage.cacheHitTokens === "number") {
			parts.push("缓存命中 " + num(usage.cacheHitTokens));
			if (typeof usage.cacheMissTokens === "number" && usage.cacheMissTokens > 0) {
				parts.push("未命中 " + num(usage.cacheMissTokens));
			}
		}
		return parts.length ? parts.join(" · ") + " tokens" : "";
	}

	function createSSEParser() {
		let buffer = "";
		return {
			push(chunk) {
				buffer += String(chunk == null ? "" : chunk).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
				const events = [];
				let idx;
				while ((idx = buffer.indexOf("\n\n")) !== -1) {
					const raw = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const data = raw.split("\n")
						.filter((line) => /^data:/.test(line))
						.map((line) => line.replace(/^data:\s?/, ""))
						.join("\n");
					if (data) events.push(data);
				}
				return events;
			},
			reset() {
				buffer = "";
			}
		};
	}

	function contentToText(content) {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.map((part) => {
					if (typeof part === "string") return part;
					if (part && typeof part.text === "string") return part.text;
					return "";
				})
				.join("");
		}
		return "";
	}

	function extractDelta(payload) {
		if (!payload || typeof payload !== "object") {
			return { content: "", reasoning: "", finish: null };
		}
		const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
		const delta = (choice && choice.delta) || {};
		return {
			content: contentToText(delta.content),
			reasoning: contentToText(delta.reasoning_content ?? delta.reasoning),
			finish: (choice && choice.finish_reason) || null
		};
	}

	function extractAnswer(payload) {
		const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
		const message = (choice && choice.message) || {};
		return {
			content: contentToText(message.content),
			reasoning: contentToText(message.reasoning_content ?? message.reasoning),
			finish: (choice && choice.finish_reason) || null,
			usage: (payload && payload.usage) || null
		};
	}

	function errorMessage(payload) {
		if (!payload) return "";
		if (typeof payload === "string") return payload;
		const err = payload.error || payload;
		if (typeof err === "string") return err;
		return String(err.message || err.msg || payload.message || "");
	}

	/* ------------------------------------------------------------- markdown */

	function parseInline(text) {
		const nodes = [];
		const s = String(text == null ? "" : text);
		let buf = "";
		let i = 0;

		const flush = () => {
			if (buf) {
				nodes.push({ type: "text", text: buf });
				buf = "";
			}
		};

		while (i < s.length) {
			const rest = s.slice(i);
			const ch = s[i];

			if (ch === "`") {
				const end = rest.indexOf("`", 1);
				if (end > 1) {
					flush();
					nodes.push({ type: "code", text: rest.slice(1, end) });
					i += end + 1;
					continue;
				}
			}

			if (rest.startsWith("**") || rest.startsWith("__")) {
				const mark = rest.slice(0, 2);
				const end = rest.indexOf(mark, 2);
				if (end > 2) {
					flush();
					nodes.push({ type: "strong", children: parseInline(rest.slice(2, end)) });
					i += end + 2;
					continue;
				}
			}

			if (rest.startsWith("~~")) {
				const end = rest.indexOf("~~", 2);
				if (end > 2) {
					flush();
					nodes.push({ type: "del", children: parseInline(rest.slice(2, end)) });
					i += end + 2;
					continue;
				}
			}

			if (ch === "$" && rest[1] !== "$") {
				const end = rest.indexOf("$", 1);
				if (end > 1) {
					flush();
					nodes.push({ type: "math", text: rest.slice(1, end) });
					i += end + 1;
					continue;
				}
			}

			if (ch === "[") {
				const m = rest.match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
				if (m) {
					flush();
					nodes.push({ type: "link", text: m[1], href: m[2] });
					i += m[0].length;
					continue;
				}
			}

			if (ch === "*" || ch === "_") {
				const end = rest.indexOf(ch, 1);
				if (end > 1 && !/\s/.test(rest[1]) && !/\s/.test(rest[end - 1])) {
					flush();
					nodes.push({ type: "em", children: parseInline(rest.slice(1, end)) });
					i += end + 1;
					continue;
				}
			}

			buf += ch;
			i++;
		}

		flush();
		return nodes;
	}

	function isBlockStart(line) {
		return /^\s*(#{1,6}\s|>|```|~~~|([-*+]|\d+[.)])\s)/.test(line)
			|| /^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line);
	}

	function splitTableRow(line) {
		let s = String(line).trim();
		if (s.startsWith("|")) s = s.slice(1);
		if (s.endsWith("|")) s = s.slice(0, -1);
		return s.split("|").map((cell) => cell.trim());
	}

	/**
	 * Parse a markdown subset into a small block AST.
	 * Deliberately forgiving: model output is not always valid markdown.
	 */
	function parseMarkdown(text) {
		const source = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
		const lines = source.split("\n");
		const blocks = [];
		let i = 0;

		const isBlank = (line) => /^\s*$/.test(line);

		while (i < lines.length) {
			const line = lines[i];

			if (isBlank(line)) {
				i++;
				continue;
			}

			let m = line.match(/^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
			if (m) {
				const fenceChar = m[1][0];
				const fenceLen = m[1].length;
				const lang = m[2] || "";
				const code = [];
				i++;
				const closing = new RegExp("^\\s*" + (fenceChar === "`" ? "`" : "~") + "{" + fenceLen + ",}\\s*$");
				while (i < lines.length && !closing.test(lines[i])) {
					code.push(lines[i]);
					i++;
				}
				if (i < lines.length) i++;
				blocks.push({ type: "code", lang, text: code.join("\n") });
				continue;
			}

			m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
			if (m) {
				blocks.push({ type: "heading", level: m[1].length, text: m[2] });
				i++;
				continue;
			}

			if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
				blocks.push({ type: "hr" });
				i++;
				continue;
			}

			if (/^\s*>/.test(line)) {
				const quote = [];
				while (i < lines.length && /^\s*>/.test(lines[i])) {
					quote.push(lines[i].replace(/^\s*>\s?/, ""));
					i++;
				}
				blocks.push({ type: "quote", blocks: parseMarkdown(quote.join("\n")) });
				continue;
			}

			if (line.includes("|") && i + 1 < lines.length
				&& /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
				const header = splitTableRow(line);
				i += 2;
				const rows = [];
				while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
					rows.push(splitTableRow(lines[i]));
					i++;
				}
				blocks.push({ type: "table", header, rows });
				continue;
			}

			m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
			if (m) {
				const ordered = /\d/.test(m[1]);
				const start = ordered ? parseInt(m[1], 10) : 1;
				const items = [];
				while (i < lines.length) {
					const lm = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
					if (!lm) break;
					if (/\d/.test(lm[1]) !== ordered) break;
					let content = lm[2];
					i++;
					while (i < lines.length && !isBlank(lines[i])
						&& !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
						&& /^\s+/.test(lines[i])) {
						content += "\n" + lines[i].trim();
						i++;
					}
					items.push(content);
				}
				blocks.push({ type: "list", ordered, start, items });
				continue;
			}

			const para = [];
			while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !isBlockStart(lines[i]))) {
				para.push(lines[i]);
				i++;
			}
			if (para.length) {
				blocks.push({ type: "paragraph", text: para.join("\n") });
			}
			else {
				i++;
			}
		}

		return blocks;
	}

	function el(doc, tag, className, text) {
		const node = doc.createElementNS(XHTML_NS, tag);
		if (className) node.setAttribute("class", className);
		if (text != null) node.textContent = text;
		return node;
	}

	function renderInline(nodes, doc, parent) {
		for (const node of nodes) {
			switch (node.type) {
				case "text":
					parent.appendChild(doc.createTextNode(node.text));
					break;
				case "strong": {
					const strong = el(doc, "strong");
					renderInline(node.children, doc, strong);
					parent.appendChild(strong);
					break;
				}
				case "em": {
					const em = el(doc, "em");
					renderInline(node.children, doc, em);
					parent.appendChild(em);
					break;
				}
				case "del": {
					const del = el(doc, "del");
					renderInline(node.children, doc, del);
					parent.appendChild(del);
					break;
				}
				case "code":
					parent.appendChild(el(doc, "code", "askai-inline-code", node.text));
					break;
				case "math":
					parent.appendChild(el(doc, "span", "askai-math", node.text));
					break;
				case "link": {
					const a = el(doc, "a", "askai-link", node.text);
					a.setAttribute("href", node.href);
					a.setAttribute("title", node.href);
					a.addEventListener("click", (event) => {
						event.preventDefault();
						const href = node.href;
						if (!/^https?:\/\//i.test(href)) return;
						try {
							if (typeof Zotero !== "undefined" && Zotero.launchURL) Zotero.launchURL(href);
							else window.open(href, "_blank");
						}
						catch (e) {
							// ignore
						}
					});
					parent.appendChild(a);
					break;
				}
				default:
					if (node.text) parent.appendChild(doc.createTextNode(node.text));
			}
		}
	}

	function renderBlock(block, doc) {
		switch (block.type) {
			case "heading": {
				const level = Math.min(6, Math.max(1, block.level));
				const h = el(doc, "h" + level, "askai-md-h" + level);
				renderInline(parseInline(block.text), doc, h);
				return h;
			}
			case "paragraph": {
				const p = el(doc, "p");
				renderInline(parseInline(block.text), doc, p);
				return p;
			}
			case "code": {
				const pre = el(doc, "pre", "askai-code");
				const code = el(doc, "code", null, block.text);
				if (block.lang) pre.setAttribute("data-lang", block.lang);
				pre.appendChild(code);
				return pre;
			}
			case "quote": {
				const quote = el(doc, "blockquote");
				for (const child of block.blocks) quote.appendChild(renderBlock(child, doc));
				return quote;
			}
			case "list": {
				const list = el(doc, block.ordered ? "ol" : "ul");
				if (block.ordered && block.start > 1) list.setAttribute("start", String(block.start));
				for (const item of block.items) {
					const li = el(doc, "li");
					renderInline(parseInline(item), doc, li);
					list.appendChild(li);
				}
				return list;
			}
			case "table": {
				const wrap = el(doc, "div", "askai-table-wrap");
				const table = el(doc, "table");
				const thead = el(doc, "thead");
				const headRow = el(doc, "tr");
				for (const cell of block.header) {
					const th = el(doc, "th");
					renderInline(parseInline(cell), doc, th);
					headRow.appendChild(th);
				}
				thead.appendChild(headRow);
				table.appendChild(thead);
				const tbody = el(doc, "tbody");
				for (const row of block.rows) {
					const tr = el(doc, "tr");
					for (let c = 0; c < block.header.length; c++) {
						const td = el(doc, "td");
						renderInline(parseInline(row[c] || ""), doc, td);
						tr.appendChild(td);
					}
					tbody.appendChild(tr);
				}
				table.appendChild(tbody);
				wrap.appendChild(table);
				return wrap;
			}
			case "hr":
				return el(doc, "hr");
			default:
				return el(doc, "p", null, "");
		}
	}

	function renderMarkdown(blocks, doc) {
		const frag = doc.createDocumentFragment();
		for (const block of blocks) frag.appendChild(renderBlock(block, doc));
		return frag;
	}

	function escapeHTML(text) {
		return String(text == null ? "" : text)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function inlineToHTML(nodes) {
		return nodes.map((node) => {
			switch (node.type) {
				case "text":
					return escapeHTML(node.text).replace(/\n/g, "<br/>");
				case "strong":
					return "<strong>" + inlineToHTML(node.children) + "</strong>";
				case "em":
					return "<em>" + inlineToHTML(node.children) + "</em>";
				case "del":
					return "<del>" + inlineToHTML(node.children) + "</del>";
				case "code":
					return '<code class="askai-inline-code">' + escapeHTML(node.text) + "</code>";
				case "math":
					return '<span class="askai-math">' + escapeHTML(node.text) + "</span>";
				case "link": {
					const href = /^https?:\/\//i.test(node.href) ? node.href : "#";
					return '<a class="askai-link" href="' + escapeHTML(href) + '">' + escapeHTML(node.text) + "</a>";
				}
				default:
					return escapeHTML(node.text || "");
			}
		}).join("");
	}

	/**
	 * Serialize markdown to HTML (used for "save as note").
	 */
	function markdownToHTML(blocks) {
		const out = [];
		for (const block of blocks) {
			switch (block.type) {
				case "heading":
					out.push("<h" + block.level + ">" + inlineToHTML(parseInline(block.text)) + "</h" + block.level + ">");
					break;
				case "paragraph":
					out.push("<p>" + inlineToHTML(parseInline(block.text)) + "</p>");
					break;
				case "code":
					out.push('<pre class="askai-code"><code>' + escapeHTML(block.text) + "</code></pre>");
					break;
				case "quote":
					out.push("<blockquote>" + markdownToHTML(block.blocks) + "</blockquote>");
					break;
				case "list":
					out.push("<" + (block.ordered ? "ol" : "ul") + ">"
						+ block.items.map((item) => "<li>" + inlineToHTML(parseInline(item)) + "</li>").join("")
						+ "</" + (block.ordered ? "ol" : "ul") + ">");
					break;
				case "table":
					out.push('<table><thead><tr>'
						+ block.header.map((cell) => "<th>" + inlineToHTML(parseInline(cell)) + "</th>").join("")
						+ "</tr></thead><tbody>"
						+ block.rows.map((row) => "<tr>"
							+ block.header.map((_, idx) => "<td>" + inlineToHTML(parseInline(row[idx] || "")) + "</td>").join("")
							+ "</tr>").join("")
						+ "</tbody></table>");
					break;
				case "hr":
					out.push("<hr/>");
					break;
				default:
					break;
			}
		}
		return out.join("\n");
	}

	/* ----------------------------------------------------------------- util */

	function formatChars(n) {
		const num = Number(n) || 0;
		if (num >= 10000) return (num / 10000).toFixed(1).replace(/\.0$/, "") + " 万";
		return String(num);
	}

	return {
		DEFAULT_SYSTEM_PROMPT,
		DEFAULT_QUESTION,
		pageMark,
		normalizeText,
		splitPages,
		chunkPages,
		tokenize,
		buildIndex,
		rankChunks,
		buildPaperContext,
		estimateTokens,
		buildSystemPrompt,
		buildMessages,
		normalizeEndpoint,
		buildHeaders,
		buildRequestBody,
		createSSEParser,
		contentToText,
		extractDelta,
		extractAnswer,
		normalizeUsage,
		formatUsage,
		errorMessage,
		parseInline,
		parseMarkdown,
		renderMarkdown,
		markdownToHTML,
		escapeHTML,
		formatChars
	};
})();

if (typeof module !== "undefined" && module.exports) {
	module.exports = AskAICore;
}
