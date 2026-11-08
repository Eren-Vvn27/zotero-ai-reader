/*
 * AI 论文助手 - reader side panel
 *
 * A self-contained chat panel injected into the Zotero PDF reader document
 * (fixed to the right side, no separate window). Runs in the plugin sandbox,
 * reuses AskAICore for context building / prompts / SSE / markdown.
 */

var AskAIPanel = (function () {
	"use strict";

	const PANEL_CSS = `
.askai-reader-panel { position: fixed; top: 0; right: 0; width: 380px; max-width: 92vw; height: 100%; z-index: 2147483000; display: flex; flex-direction: column; background: #ffffff; color: #1f2328; border-left: 1px solid rgba(0,0,0,0.14); box-shadow: -10px 0 28px rgba(0,0,0,0.14); font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; line-height: 1.55; }
.askai-reader-panel[hidden] { display: none; }
@media (prefers-color-scheme: dark) { .askai-reader-panel { background: #1e1f22; color: #e7e7e8; border-left-color: rgba(255,255,255,0.12); } }
.askai-reader-panel * { box-sizing: border-box; }
.askai-panel-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(127,127,127,0.2); flex: 0 0 auto; }
.askai-panel-title { font-weight: 600; white-space: nowrap; }
.askai-panel-sub { flex: 1; font-size: 11px; opacity: 0.65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.askai-panel-close { border: none; background: transparent; font-size: 16px; line-height: 1; cursor: pointer; color: inherit; opacity: 0.6; }
.askai-panel-close:hover { opacity: 1; }
.askai-panel-log { flex: 1 1 auto; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.askai-msg { display: flex; }
.askai-msg-user { justify-content: flex-end; }
.askai-bubble { max-width: 100%; border-radius: 10px; padding: 8px 10px; }
.askai-bubble-user { background: #4072e5; color: #ffffff; max-width: 88%; }
.askai-bubble-ai { background: rgba(127,127,127,0.1); width: 100%; }
@media (prefers-color-scheme: dark) { .askai-bubble-ai { background: rgba(255,255,255,0.07); } }
.askai-md { overflow-wrap: anywhere; }
.askai-md p { margin: 0 0 6px; white-space: pre-wrap; }
.askai-md ul, .askai-md ol { margin: 0 0 6px; padding-inline-start: 20px; }
.askai-md li { margin: 1px 0; }
.askai-md pre { margin: 6px 0; padding: 8px; border-radius: 6px; background: rgba(127,127,127,0.12); overflow-x: auto; font-size: 11px; }
.askai-md code { font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
.askai-md table { border-collapse: collapse; margin: 6px 0; font-size: 11px; }
.askai-md th, .askai-md td { border: 1px solid rgba(127,127,127,0.3); padding: 3px 6px; }
.askai-ctx { display: inline-block; margin-bottom: 5px; padding: 0 6px; border-radius: 99px; border: 1px solid rgba(127,127,127,0.3); font-size: 10px; opacity: 0.8; }
.askai-usage { padding-top: 4px; font-size: 10px; opacity: 0.6; }
.askai-panel-quick { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 12px 8px; flex: 0 0 auto; }
.askai-quickchip { padding: 2px 8px; border-radius: 99px; border: 1px solid rgba(127,127,127,0.3); background: transparent; color: inherit; font-size: 11px; cursor: pointer; }
.askai-quickchip:hover { border-color: #4072e5; color: #4072e5; }
.askai-panel-controls { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 12px 8px; flex: 0 0 auto; }
.askai-panel-select { padding: 1px 4px; border: 1px solid rgba(127,127,127,0.3); border-radius: 6px; background: transparent; color: inherit; font-size: 11px; max-width: 160px; cursor: pointer; }
.askai-panel-select:focus { outline: none; border-color: #4072e5; }
.askai-panel-resizer { position: absolute; top: 0; bottom: 0; inset-inline-start: -4px; width: 8px; cursor: col-resize; z-index: 2; }
.askai-panel-resizer:hover { background: rgba(64,114,229,0.25); }
.askai-panel-composer { display: flex; gap: 6px; padding: 8px 12px 10px; border-top: 1px solid rgba(127,127,127,0.2); flex: 0 0 auto; align-items: flex-end; }
.askai-panel-input { flex: 1 1 auto; min-height: 34px; max-height: 120px; resize: vertical; padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(127,127,127,0.3); background: transparent; color: inherit; font: inherit; font-size: 12px; }
.askai-panel-input:focus { outline: none; border-color: #4072e5; }
.askai-panel-send { width: 34px; height: 34px; border-radius: 8px; border: none; background: #4072e5; color: #ffffff; font-size: 14px; cursor: pointer; flex: 0 0 auto; }
.askai-panel-send[disabled] { opacity: 0.5; cursor: default; }
.askai-panel-typing { opacity: 0.6; font-size: 11px; }
.askai-panel-error { color: #d13438; font-size: 11px; white-space: pre-wrap; }
.askai-panel-notice { font-size: 11px; opacity: 0.65; }
.askai-panel-selection { font-size: 10px; opacity: 0.85; margin-bottom: 3px; }
.askai-panel-usage { font-size: 10px; opacity: 0.6; padding: 0 12px 6px; flex: 0 0 auto; }
`;

	const SELECTION_PROMPTS = [
		{ label: "解释这段", prompt: "请结合论文全文，解释我选中的这段内容：它是什么意思、在论文中起什么作用、与上下文和论文核心论点有什么关系？" },
		{ label: "起什么作用", prompt: "这段内容在论文中起什么作用？请结合上下文说明。" },
		{ label: "翻译成中文", prompt: "请把选中的内容翻译成中文，保留专业术语，并解释关键术语。" },
		{ label: "一句话概括", prompt: "请用一句话概括选中的内容。" },
		{ label: "有什么问题", prompt: "这段内容或论证有什么潜在问题、局限或可质疑之处？" }
	];

	const PAPER_PROMPTS = [
		{ label: "总结论文", prompt: "用三句话总结这篇论文在做什么。" },
		{ label: "创新点", prompt: "这篇论文的创新点是什么？" },
		{ label: "方法", prompt: "论文的方法部分是怎么做的？" },
		{ label: "局限", prompt: "这篇论文有什么局限性？" }
	];

	function create(options) {
		const doc = options.doc;
		const api = options.api;
		const reader = options.reader;
		const core = (typeof AskAICore !== "undefined") ? AskAICore : (typeof window !== "undefined" ? window.AskAICore : null);
		if (!core) throw new Error("AskAICore is not loaded");

		const state = {
			paper: null,
			text: "",
			pages: [],
			history: [],
			streaming: false,
			pendingSelection: ""
		};

		if (!doc.getElementById("askai-panel-style")) {
			const style = doc.createElement("style");
			style.id = "askai-panel-style";
			style.textContent = PANEL_CSS;
			(doc.head || doc.documentElement).appendChild(style);
		}

		const root = doc.createElement("div");
		root.className = "askai-reader-panel";
		root.id = "askai-reader-panel";
		root.hidden = true;

		const head = doc.createElement("div");
		head.className = "askai-panel-head";
		const title = doc.createElement("span");
		title.className = "askai-panel-title";
		title.textContent = "AI 论文助手";
		const sub = doc.createElement("span");
		sub.className = "askai-panel-sub";
		const settingsBtn = doc.createElement("button");
		settingsBtn.className = "askai-panel-close";
		settingsBtn.textContent = "⚙";
		settingsBtn.title = "设置";
		settingsBtn.addEventListener("click", () => {
			try {
				if (typeof api.openSettings === "function") {
					api.openSettings();
				}
			}
			catch (e) {
				// ignore
			}
		});
		const closeBtn = doc.createElement("button");
		closeBtn.className = "askai-panel-close";
		closeBtn.textContent = "×";
		closeBtn.title = "关闭";
		closeBtn.addEventListener("click", () => hide());
		head.append(title, sub, settingsBtn, closeBtn);

		const log = doc.createElement("div");
		log.className = "askai-panel-log";

		const quick = doc.createElement("div");
		quick.className = "askai-panel-quick";

		const usageLine = doc.createElement("div");
		usageLine.className = "askai-panel-usage";

		const composer = doc.createElement("div");
		composer.className = "askai-panel-composer";
		const input = doc.createElement("textarea");
		input.className = "askai-panel-input";
		input.rows = 1;
		input.placeholder = "针对这篇论文提问…（Enter 发送，Shift+Enter 换行）";
		const sendBtn = doc.createElement("button");
		sendBtn.className = "askai-panel-send";
		sendBtn.textContent = "↑";
		sendBtn.title = "发送";
		composer.append(input, sendBtn);

		const controls = doc.createElement("div");
		controls.className = "askai-panel-controls";
		const modelSelect = doc.createElement("select");
		modelSelect.className = "askai-panel-select";
		modelSelect.title = "模型";
		const thinkingSelect = doc.createElement("select");
		thinkingSelect.className = "askai-panel-select";
		thinkingSelect.title = "思考模式";
		const effortSelect = doc.createElement("select");
		effortSelect.className = "askai-panel-select";
		effortSelect.title = "思考强度";
		controls.append(modelSelect, thinkingSelect, effortSelect);

		root.append(head, log, quick, controls, usageLine, composer);
		doc.body.appendChild(root);

		// Shrink the reader split view so the panel docks beside the PDF instead of
		// covering page content. Only available when we are mounted on the reader UI
		// document (which owns #split-view).
		const splitView = doc.getElementById("split-view") || doc.querySelector("#split-view");

		function setSplitOffset(offset) {
			if (!splitView) return;
			if (offset) {
				splitView.style.setProperty("inset-inline-end", offset + "px");
			}
			else {
				splitView.style.removeProperty("inset-inline-end");
			}
			try {
				const view = doc.defaultView;
				if (view) view.dispatchEvent(new Event("resize"));
			}
			catch (e) {
				// ignore
			}
		}

		const resizer = doc.createElement("div");
		resizer.className = "askai-panel-resizer";
		resizer.title = "拖动调整宽度";
		root.appendChild(resizer);

		let panelWidth = 380;
		try {
			if (typeof api.getPanelWidth === "function") {
				panelWidth = api.getPanelWidth();
			}
		}
		catch (e) {
			// ignore
		}

		function applyWidth(width) {
			panelWidth = Math.max(300, Math.min(720, Math.round(width) || 380));
			root.style.width = panelWidth + "px";
			setSplitOffset(panelWidth);
			return panelWidth;
		}

		let dragging = false;
		let dragStartX = 0;
		let dragStartWidth = 0;

		resizer.addEventListener("pointerdown", (event) => {
			dragging = true;
			dragStartX = event.clientX;
			dragStartWidth = panelWidth;
			try {
				resizer.setPointerCapture(event.pointerId);
			}
			catch (e) {
				// ignore
			}
			event.preventDefault();
		});

		doc.addEventListener("pointermove", (event) => {
			if (!dragging) return;
			applyWidth(dragStartWidth + (dragStartX - event.clientX));
		});

		doc.addEventListener("pointerup", () => {
			if (!dragging) return;
			dragging = false;
			try {
				if (typeof api.setPanelWidth === "function") {
					api.setPanelWidth(panelWidth);
				}
			}
			catch (e) {
				// ignore
			}
		});

		const el = (tag, cls, text) => {
			const node = doc.createElement(tag);
			if (cls) node.className = cls;
			if (text != null) node.textContent = text;
			return node;
		};

		function show() {
			root.hidden = false;
			applyWidth(panelWidth);
			renderControls();
			ensurePaper();
			input.focus();
		}

		function hide() {
			root.hidden = true;
			setSplitOffset(0);
		}

		function toggle() {
			if (root.hidden) {
				show();
			}
			else {
				hide();
			}
		}

		async function ensurePaper(force) {
			try {
				const attachmentID = reader.itemID || (reader._item && reader._item.id);
				if (!attachmentID) return;
				if (!force && state.paper && state.paper.attachmentID === attachmentID && state.text) return;

				sub.textContent = "读取全文…";
				const info = await api.getPaperInfo(attachmentID);
				const paperText = await api.getPaperText(info.attachmentID);
				state.paper = info;
				state.text = paperText.text || "";
				state.pages = core.splitPages(state.text);
				state.history = [];
				log.replaceChildren();
				usageLine.textContent = "";
				sub.textContent = info.title || "";
				renderQuick();
				if (!state.text) {
					log.appendChild(el("div", "askai-panel-notice", "未能提取到全文（可能是扫描版），仍可基于选中内容回答。"));
				}
			}
			catch (e) {
				sub.textContent = "读取失败";
				log.appendChild(el("div", "askai-panel-error", String(e && (e.message || e))));
			}
		}

		function renderQuick() {
			quick.replaceChildren();
			const prompts = state.pendingSelection ? SELECTION_PROMPTS : PAPER_PROMPTS;
			for (const item of prompts) {
				const button = el("button", "askai-quickchip", item.label);
				button.addEventListener("click", () => {
					input.value = item.prompt;
					input.focus();
				});
				quick.appendChild(button);
			}
		}

		const MODEL_OPTIONS = ["deepseek-flash", "deepseek-v4-pro"];

		function option(value, label) {
			const node = doc.createElement("option");
			node.value = value;
			node.textContent = label;
			return node;
		}

		function renderControls() {
			let cfg;
			try {
				cfg = api.getConfig();
			}
			catch (e) {
				return;
			}
			const models = MODEL_OPTIONS.slice();
			if (cfg.model && models.indexOf(cfg.model) === -1) {
				models.unshift(cfg.model);
			}
			modelSelect.replaceChildren(...models.map((model) => option(model, model)));
			modelSelect.value = cfg.model;
			thinkingSelect.replaceChildren(
				option("auto", "思考:默认"),
				option("enabled", "思考:开"),
				option("disabled", "思考:关")
			);
			thinkingSelect.value = cfg.thinking || "auto";
			effortSelect.replaceChildren(
				option("low", "强度:低"),
				option("high", "强度:高"),
				option("max", "强度:最高")
			);
			effortSelect.value = cfg.reasoningEffort || "high";
		}

		function savePatch(patch) {
			try {
				api.saveConfig(Object.assign(api.getConfig(), patch));
			}
			catch (e) {
				// ignore
			}
			renderControls();
		}

		modelSelect.addEventListener("change", () => savePatch({ model: modelSelect.value }));
		thinkingSelect.addEventListener("change", () => savePatch({ thinking: thinkingSelect.value }));
		effortSelect.addEventListener("change", () => savePatch({ reasoningEffort: effortSelect.value }));
		renderControls();

		function appendUser(question, selection) {
			const wrap = el("div", "askai-msg askai-msg-user");
			const bubble = el("div", "askai-bubble askai-bubble-user");
			if (selection) {
				bubble.appendChild(el("div", "askai-panel-selection", "选中内容：" + selection.slice(0, 60)));
			}
			bubble.appendChild(el("div", null, question));
			wrap.appendChild(bubble);
			log.appendChild(wrap);
		}

		function appendAssistant() {
			const wrap = el("div", "askai-msg");
			const bubble = el("div", "askai-bubble askai-bubble-ai");
			const chip = el("span", "askai-ctx", "");
			const content = el("div", "askai-md");
			content.appendChild(el("div", "askai-panel-typing", "生成中…"));
			const usage = el("div", "askai-usage", "");
			bubble.append(chip, content, usage);
			wrap.appendChild(bubble);
			log.appendChild(wrap);
			return { wrap, chip, content, usage };
		}

		function contextLabel(context) {
			if (!context) return "";
			if (context.mode === "full") {
				return "全文 " + core.formatChars(context.usedChars) + " 字符 · " + context.pageCount + " 页";
			}
			if (context.mode === "retrieval") {
				return "检索 " + context.chunksUsed + "/" + context.chunksTotal + " 段";
			}
			return "无全文";
		}

		async function send(question, selection) {
			if (state.streaming) return;
			if (!state.paper) {
				await ensurePaper();
				if (!state.paper) return;
			}

			const cfg = api.getConfig();
			const url = core.normalizeEndpoint(cfg.endpoint);
			if (!url) {
				log.appendChild(el("div", "askai-panel-error", "请先在设置里填写接口地址。"));
				return;
			}

			const context = core.buildPaperContext({
				pages: state.pages,
				budgetChars: cfg.maxContextChars,
				query: question,
				selection: selection
			});
			const messages = core.buildMessages({
				paper: state.paper,
				context,
				selection: selection,
				question: question,
				history: state.history.slice(),
				language: cfg.language,
				customPrompt: cfg.systemPrompt
			});

			appendUser(question, selection);
			const turn = appendAssistant();
			turn.chip.textContent = contextLabel(context);
			state.history.push({
				role: "user",
				content: selection ? "选中内容：" + selection + "\n\n" + question : question
			});
			state.streaming = true;
			sendBtn.disabled = true;

			try {
				const headers = core.buildHeaders({ apiKey: cfg.apiKey, extraHeaders: cfg.extraHeaders });
				const body = core.buildRequestBody({
					model: cfg.model,
					messages: messages,
					temperature: cfg.temperature,
					maxTokens: cfg.maxTokens,
					stream: cfg.stream,
					thinking: cfg.thinking,
					reasoningEffort: cfg.reasoningEffort,
					includeUsage: true
				});

				const response = await fetch(url, {
					method: "POST",
					headers: headers,
					body: JSON.stringify(body)
				});
				if (!response.ok) {
					const text = await response.text();
					throw new Error("HTTP " + response.status + "：" + text.slice(0, 300));
				}

				let content = "";
				let usage = null;

				if (!cfg.stream) {
					const json = await response.json();
					const answer = core.extractAnswer(json);
					content = answer.content || answer.reasoning || "";
					usage = core.normalizeUsage(json.usage);
				}
				else {
					const streamReader = response.body.getReader();
					const decoder = new TextDecoder("utf-8");
					const parser = core.createSSEParser();
					while (true) {
						const step = await streamReader.read();
						if (step.done) break;
						for (const data of parser.push(decoder.decode(step.value, { stream: true }))) {
							if (data === "[DONE]") continue;
							let json;
							try {
								json = JSON.parse(data);
							}
							catch (e) {
								continue;
							}
							if (json.error) throw new Error(core.errorMessage(json));
							if (json.usage) usage = core.normalizeUsage(json.usage);
							const delta = core.extractDelta(json);
							if (delta.content) {
								content += delta.content;
								turn.content.replaceChildren(core.renderMarkdown(core.parseMarkdown(content), doc));
								log.scrollTop = log.scrollHeight;
							}
						}
					}
				}

				turn.content.replaceChildren(core.renderMarkdown(core.parseMarkdown(content), doc));
				const usageText = core.formatUsage(usage);
				if (usageText) {
					turn.usage.textContent = "用量：" + usageText;
					usageLine.textContent = "本次：" + usageText;
				}
				state.history.push({ role: "assistant", content: content });
			}
			catch (e) {
				turn.content.replaceChildren(el("div", "askai-panel-error", String(e && (e.message || e))));
			}
			finally {
				state.streaming = false;
				sendBtn.disabled = false;
				log.scrollTop = log.scrollHeight;
			}
		}

		const onSend = () => {
			const question = input.value.trim();
			if (!question) return;
			const selection = state.pendingSelection;
			input.value = "";
			state.pendingSelection = "";
			renderQuick();
			send(question, selection);
		};

		sendBtn.addEventListener("click", onSend);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				onSend();
			}
		});

		return {
			doc: doc,
			show: show,
			hide: hide,
			toggle: toggle,
			isOpen: () => !root.hidden,
			receiveSelection(selection) {
				state.pendingSelection = String(selection || "");
				renderQuick();
				show();
				input.focus();
			},
			destroy() {
				hide();
				root.remove();
			}
		};
	}

	return { create: create };
})();
