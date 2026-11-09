/*
 * AI 论文助手 (Zotero Ask AI) - chat window logic
 *
 * Builds the whole UI with DOM nodes (XHTML namespace) so it renders reliably
 * inside a chrome XUL window, and talks to:
 *   - Zotero.AskAI  (plugin scope): prefs, paper metadata, full-text extraction
 *   - AskAICore     (core.js): context building, prompts, SSE, markdown
 */

"use strict";

const HTML_NS = "http://www.w3.org/1999/xhtml";

const ICONS = {
	spark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.7 4.9L18.6 9.6l-4.9 1.7L12 16.2l-1.7-4.9L5.4 9.6l4.9-1.7z"/><path d="M18.4 15.2l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8z"/></svg>',
	sparkBig: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2 5.9 5.9 2-5.9 2-2 5.9-2-5.9-5.9-2 5.9-2z"/><path d="M19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>',
	gear: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.5.7 1 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg>',
	plus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
	close: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
	send: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
	stop: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5"/></svg>',
	copy: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
	note: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><path d="M8 13h8M8 17h6"/></svg>',
	retry: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/></svg>',
	context: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/></svg>'
};

const PRESETS = {
	deepseek: { label: "DeepSeek（推荐）", endpoint: "https://api.deepseek.com", model: "deepseek-flash" },
	openai: { label: "OpenAI", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" },
	dashscope: { label: "阿里云百炼（通义千问）", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
	moonshot: { label: "Moonshot（Kimi）", endpoint: "https://api.moonshot.cn/v1", model: "moonshot-v1-32k" },
	zhipu: { label: "智谱 GLM", endpoint: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus" },
	siliconflow: { label: "硅基流动 SiliconFlow", endpoint: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
	ollama: { label: "Ollama（本地，无需 Key）", endpoint: "http://localhost:11434", model: "qwen2.5:7b" },
	custom: { label: "自定义 / 其他 OpenAI 兼容服务", endpoint: "", model: "" }
};

const QUICK_PROMPTS = [
	"用三句话总结这篇论文在做什么",
	"这篇论文的创新点是什么？",
	"论文的方法部分是怎么做的？",
	"这篇论文有什么局限性？"
];

// 选中内容时的常用问题（显示在输入框上方，点一下填进输入框）
const SELECTION_PROMPTS = [
	{ label: "解释这段", prompt: () => (AskAICore && AskAICore.DEFAULT_QUESTION) || "请结合论文全文解释我选中的这段内容。" },
	{ label: "起什么作用", prompt: "这段内容在论文中起什么作用？请结合上下文说明。" },
	{ label: "翻译成中文", prompt: "请把选中的内容翻译成中文，保留专业术语，并解释关键术语。" },
	{ label: "一句话概括", prompt: "请用一句话概括选中的内容。" },
	{ label: "有什么问题", prompt: "这段内容或论证有什么潜在问题、局限或可质疑之处？" }
];

// 针对整篇论文的常用问题
const PAPER_PROMPTS = [
	{ label: "总结论文", prompt: "用三句话总结这篇论文在做什么。" },
	{ label: "创新点", prompt: "这篇论文的创新点是什么？" },
	{ label: "方法", prompt: "论文的方法部分是怎么做的？" },
	{ label: "局限", prompt: "这篇论文有什么局限性？" }
];

/* -------------------------------------------------------------- DOM utils */

function h(tag, attrs, children) {
	const node = document.createElementNS(HTML_NS, tag);
	if (attrs) {
		for (const key of Object.keys(attrs)) {
			const value = attrs[key];
			if (value === undefined || value === null || value === false) continue;
			if (key === "class") node.className = value;
			else if (key === "text") node.textContent = value;
			else if (key === "dataset") Object.assign(node.dataset, value);
			else if (key === "checked" || key === "disabled" || key === "selected") {
				if (value) node.setAttribute(key, "");
				node[key] = !!value;
			}
			else if (typeof value === "function" && key.startsWith("on")) {
				node.addEventListener(key.slice(2).toLowerCase(), value);
			}
			else node.setAttribute(key, String(value));
		}
	}
	appendChildren(node, children);
	return node;
}

function appendChildren(node, children) {
	if (children === undefined || children === null) return;
	if (Array.isArray(children)) {
		for (const child of children) appendChildren(node, child);
		return;
	}
	if (typeof children === "string" || typeof children === "number") {
		node.appendChild(document.createTextNode(String(children)));
		return;
	}
	node.appendChild(children);
}

/**
 * Insert an inline SVG icon. Parsing through DOMParser keeps the SVG namespace
 * correct inside a chrome XUL document, where innerHTML would treat the markup
 * as plain XHTML.
 */
function setIcon(element, markup) {
	try {
		const source = /^<svg[^>]*\sxmlns=/.test(markup)
			? markup
			: markup.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
		const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
		const root = parsed && parsed.documentElement;
		if (root && root.localName === "svg") {
			element.replaceChildren(document.importNode(root, true));
			return;
		}
	}
	catch (e) {
		// fall through
	}
	element.textContent = "";
}

function iconButton(id, icon, title, onClick) {
	const button = h("button", { type: "button", id, class: "askai-icon-btn", title });
	setIcon(button, icon);
	button.addEventListener("click", onClick);
	return button;
}

function textInput(type, placeholder, attrs) {
	return h("input", Object.assign({
		type,
		class: "askai-input-ctl",
		placeholder: placeholder || ""
	}, attrs || {}));
}

function textArea(rows, placeholder) {
	return h("textarea", { class: "askai-input-ctl askai-textarea", rows: String(rows || 3), placeholder: placeholder || "" });
}

function selectEl(options, value) {
	const select = h("select", { class: "askai-input-ctl" });
	for (const option of options) {
		select.appendChild(h("option", { value: option.value, text: option.label }));
	}
	if (value) select.value = value;
	return select;
}

function truncate(text, len) {
	const s = String(text || "").replace(/\s+/g, " ").trim();
	return s.length > len ? s.slice(0, len) + "…" : s;
}

/* ------------------------------------------------------------------- app */

var AskAIApp = {
	els: {},
	state: {
		paper: null,
		text: "",
		pages: [],
		totalPages: 0,
		history: [],
		turns: [],
		sessions: new Map(),
		streaming: false,
		controller: null,
		pendingSelection: "",
		pendingAsk: null,
		settingsOpen: false,
		ready: false
	},
	_toastTimer: null,

	/* ------------------------------------------------------------- startup */

	init() {
		try {
			this.buildUI();
			this.bindEvents();
			this.fillForm(this.getConfig());
			this.updateHint();
			this.renderEmpty();
			this.setEmptyVisible(true);
			this.updateQuickBar();
			this.state.ready = true;

			const payload = this.consumePayload();
			if (payload) this.receive(payload);
			else this.focusInput();
		}
		catch (e) {
			this.showFatal(e);
		}
	},

	/* -------------------------------------------------------------- config */

	consumePayload() {
		let payload = (window.arguments && window.arguments[0]) || null;
		try {
			if (window.Zotero && Zotero.AskAI && typeof Zotero.AskAI.takePendingPayload === "function") {
				const queued = Zotero.AskAI.takePendingPayload();
				if (!payload) payload = queued;
			}
		}
		catch (e) {
			// ignore
		}
		return payload;
	},

	getConfig() {
		try {
			if (window.Zotero && Zotero.AskAI) return Zotero.AskAI.getConfig();
		}
		catch (e) {
			// fall through
		}
		return {
			endpoint: "",
			apiKey: "",
			model: "",
			provider: "custom",
			temperature: 0.3,
			maxTokens: 0,
			maxContextChars: 100000,
			stream: true,
			autoSend: false,
			thinking: "auto",
			reasoningEffort: "high",
			language: "auto",
			defaultQuestion: AskAICore.DEFAULT_QUESTION,
			systemPrompt: "",
			extraHeaders: "",
			debug: false
		};
	},

	isConfigured(cfg) {
		return !!(cfg && cfg.endpoint && cfg.model);
	},

	/* ----------------------------------------------------------------- UI */

	buildUI() {
		const root = document.getElementById("askai-root");
		root.replaceChildren();
		const els = this.els = {};

		/* header */
		const logo = h("span", { class: "askai-logo" });
		setIcon(logo, ICONS.spark);

		const header = h("header", { class: "askai-header" }, [
			h("div", { class: "askai-brand" }, [
				logo,
				h("div", { class: "askai-brand-text" }, [
					h("div", { class: "askai-brand-title" }, [
						h("span", { text: "AI 论文助手" }),
						h("span", { class: "askai-brand-mark", text: "Sonny Boy", title: "Sonny Boy" })
					]),
					els.brandSub = h("div", { class: "askai-brand-sub", text: "选中论文内容，一键基于全文提问" })
				])
			]),
			h("div", { class: "askai-header-actions" }, [
				iconButton("askai-btn-new", ICONS.plus, "新对话", () => this.newConversation()),
				iconButton("askai-btn-settings", ICONS.gear, "设置", () => this.openSettings())
			])
		]);

		/* paper bar */
		els.paperBar = h("section", { class: "askai-paper hidden", id: "askai-paper" }, [
			h("div", { class: "askai-paper-main" }, [
				els.paperTitle = h("div", { class: "askai-paper-title", id: "askai-paper-title", text: "未打开论文" }),
				els.paperMeta = h("div", { class: "askai-paper-meta", id: "askai-paper-meta", text: "" })
			]),
			h("div", { class: "askai-chips" }, [
				els.chipText = h("span", { class: "askai-chip", title: "AI 可读取的论文文本量", text: "—" }),
				els.chipRefresh = h("button", { type: "button", class: "askai-chip askai-chip-btn", title: "重新提取论文全文", text: "刷新" })
			])
		]);

		/* message log */
		els.log = h("main", { class: "askai-log", id: "askai-log" });

		/* composer */
		els.attachLabel = h("span", { class: "askai-attach-label", text: "已附带选中内容" });
		els.attach = h("div", { class: "askai-attach hidden", id: "askai-attach" }, [
			els.attachLabel,
			h("button", { type: "button", class: "askai-link-btn", text: "移除", onClick: () => this.clearSelection() })
		]);

		els.input = h("textarea", {
			class: "askai-input",
			id: "askai-input",
			rows: "1",
			placeholder: "针对这篇论文提问…（Enter 发送，Shift+Enter 换行）"
		});

		els.send = h("button", { type: "button", class: "askai-send", id: "askai-send", title: "发送" });
		setIcon(els.send, ICONS.send);

		els.quickModel = h("select", { class: "askai-hint-select", id: "askai-hint-model", title: "模型（随时可切换）" });
		els.quickThinking = h("select", { class: "askai-hint-select", id: "askai-hint-thinking", title: "思考模式（DeepSeek 等支持）" });
		els.quickEffort = h("select", { class: "askai-hint-select", id: "askai-hint-effort", title: "思考强度" });
		els.hintContext = h("span", { class: "askai-hint", text: "上下文：自动" });

		const composer = h("footer", { class: "askai-composer" }, [
			els.attach,
			els.quickBar = h("div", { class: "askai-quickbar hidden", id: "askai-quickbar" }),
			h("div", { class: "askai-composer-row" }, [els.input, els.send]),
			h("div", { class: "askai-composer-hint" }, [
				els.quickModel,
				h("span", { class: "askai-hint-sep", text: "·" }),
				els.quickThinking,
				h("span", { class: "askai-hint-sep", text: "·" }),
				els.quickEffort,
				h("span", { class: "askai-hint-sep", text: "·" }),
				els.hintContext
			])
		]);

		/* settings */
		const settings = this.buildSettings();

		/* context viewer */
		els.contextPre = h("pre", { class: "askai-context-pre" });
		els.contextTitle = h("div", { class: "askai-panel-title", text: "发送给 AI 的论文上下文" });
		els.contextOverlay = h("div", { class: "askai-overlay hidden", id: "askai-context" }, [
			h("div", { class: "askai-panel askai-panel-wide" }, [
				h("div", { class: "askai-panel-head" }, [
					els.contextTitle,
					iconButton("askai-context-close", ICONS.close, "关闭", () => this.closeContextViewer())
				]),
				h("div", { class: "askai-panel-body" }, [els.contextPre]),
				h("div", { class: "askai-panel-foot" }, [
					h("button", { type: "button", class: "askai-btn", text: "复制全部", onClick: () => this.copyText(els.contextPre.textContent) }),
					h("div", { class: "askai-spacer" }),
					h("button", { type: "button", class: "askai-btn askai-btn-primary", text: "关闭", onClick: () => this.closeContextViewer() })
				])
			])
		]);

		/* toast */
		els.toast = h("div", { class: "askai-toast hidden", id: "askai-toast" });

		root.append(header, els.paperBar, els.log, composer, settings, els.contextOverlay, els.toast);
	},

	buildSettings() {
		const els = this.els;

		const providerOptions = Object.keys(PRESETS).map((key) => ({
			value: key,
			label: PRESETS[key].label
		}));
		els.provider = selectEl(providerOptions, "deepseek");
		els.provider.id = "askai-set-provider";

		els.endpoint = textInput("text", "https://api.deepseek.com", { id: "askai-set-endpoint" });
		els.apiKey = textInput("password", "sk-…", { id: "askai-set-apikey" });
		els.model = textInput("text", "deepseek-flash", { id: "askai-set-model" });
		els.thinking = selectEl([
			{ value: "auto", label: "跟随服务商默认" },
			{ value: "enabled", label: "开启（先推理再回答）" },
			{ value: "disabled", label: "关闭（直接回答，更快更省）" }
		], "auto");
		els.thinking.id = "askai-set-thinking";
		els.reasoningEffort = selectEl([
			{ value: "low", label: "低" },
			{ value: "high", label: "高（默认）" },
			{ value: "max", label: "最高" }
		], "high");
		els.reasoningEffort.id = "askai-set-effort";
		els.temperature = textInput("number", "0.3", { id: "askai-set-temperature", step: "0.1", min: "0", max: "2" });
		els.maxTokens = textInput("number", "0", { id: "askai-set-maxtokens", min: "0", step: "100" });
		els.maxContextChars = textInput("number", "100000", { id: "askai-set-maxcontext", min: "4000", step: "1000" });
		els.language = selectEl([
			{ value: "auto", label: "跟随提问语言" },
			{ value: "zh", label: "简体中文" },
			{ value: "en", label: "English" }
		], "auto");
		els.language.id = "askai-set-language";
		els.stream = h("input", { type: "checkbox", class: "askai-checkbox", id: "askai-set-stream" });
		els.autoSend = h("input", { type: "checkbox", class: "askai-checkbox", id: "askai-set-autosend" });
		els.debug = h("input", { type: "checkbox", class: "askai-checkbox", id: "askai-set-debug" });
		els.defaultQuestion = textArea(3, "选中文字后自动发送的问题");
		els.defaultQuestion.id = "askai-set-default-question";
		els.systemPrompt = textArea(4, "留空使用内置的学术阅读提示词");
		els.systemPrompt.id = "askai-set-system-prompt";
		els.extraHeaders = textArea(2, '{"x-api-key": "..."}');
		els.extraHeaders.id = "askai-set-extra-headers";

		const keyToggle = h("button", {
			type: "button",
			class: "askai-inline-btn",
			text: "显示",
			onClick: () => {
				const showing = els.apiKey.type === "text";
				els.apiKey.type = showing ? "password" : "text";
				keyToggle.textContent = showing ? "显示" : "隐藏";
			}
		});

		els.settingsBanner = h("div", { class: "askai-banner hidden" });
		els.testStatus = h("span", { class: "askai-test-status" });

		const body = h("div", { class: "askai-panel-body" }, [
			els.settingsBanner,
			h("div", { class: "askai-section-title", text: "模型服务" }),
			this.field("服务商预设", els.provider, "选择后会自动填入接口地址与常用模型，可再手动修改"),
			this.field("接口地址", els.endpoint, "OpenAI 兼容接口；可填 base URL，也可填完整的 …/chat/completions 地址"),
			this.field("API Key", h("div", { class: "askai-input-row" }, [els.apiKey, keyToggle]), "只保存在本机 Zotero 配置中；本地 Ollama 等无需鉴权的服务可留空"),
			this.field("模型名称", els.model, "例如 deepseek-flash、deepseek-v4-pro、gpt-4o-mini、qwen-plus"),
			this.field("思考模式", els.thinking, "仅对 DeepSeek 等支持 thinking 的接口生效；关闭可减少等待与 token 消耗"),
			this.field("思考强度", els.reasoningEffort, "开启思考时生效；越高越深入，但更慢、更贵"),
			h("div", { class: "askai-field-row" }, [
				this.field("温度（0–2）", els.temperature, "越大越发散，读论文建议 0.2–0.5"),
				this.field("最大回复 tokens", els.maxTokens, "0 表示由服务端决定")
			]),

			h("div", { class: "askai-section-title", text: "论文上下文" }),
			this.field("最大上下文字符数", els.maxContextChars, "论文总字数不超过该值时发送全文；超过时自动改为检索最相关段落"),

			h("div", { class: "askai-section-title", text: "交互行为" }),
			this.checkRow(els.stream, "流式输出", "边生成边显示；若接口不支持可关闭"),
			this.checkRow(els.autoSend, "选中后自动提问", "点「问 AI」后立即用下方默认问题提问；关闭则只填入输入框"),
			this.field("回答语言", els.language),
			this.field("选中内容后的默认问题", els.defaultQuestion),
			this.field("系统提示词（高级）", els.systemPrompt, "留空使用内置提示词；用于自定义回答风格或领域约束"),
			this.field("额外请求头（JSON，高级）", els.extraHeaders, '用于 Azure 等需要自定义鉴权的服务，例如 {"api-key": "..."}'),
			this.checkRow(els.debug, "调试日志", "在 Zotero 调试输出中打印上下文长度等信息"),

			h("p", { class: "askai-note", text: "说明：全文由 Zotero 内置 PDF 解析器提取；扫描版 PDF 可能没有文本层。API Key 仅保存在本机，并只会发送到你填写的接口地址。" })
		]);

		els.settingsOverlay = h("div", { class: "askai-overlay hidden", id: "askai-settings" }, [
			h("div", { class: "askai-panel" }, [
				h("div", { class: "askai-panel-head" }, [
					h("div", { class: "askai-panel-title", text: "设置" }),
					iconButton("askai-settings-close", ICONS.close, "关闭", () => this.closeSettings())
				]),
				body,
				h("div", { class: "askai-panel-foot" }, [
					h("button", { type: "button", class: "askai-btn askai-btn-ghost", text: "恢复默认", onClick: () => this.resetSettings() }),
					els.testStatus,
					h("div", { class: "askai-spacer" }),
					h("button", { type: "button", class: "askai-btn", text: "测试连接", onClick: () => this.testConnection() }),
					h("button", { type: "button", class: "askai-btn askai-btn-primary", text: "保存", onClick: () => this.saveSettings(true) })
				])
			])
		]);

		return els.settingsOverlay;
	},

	field(label, control, hint) {
		return h("label", { class: "askai-field" }, [
			h("span", { class: "askai-field-label", text: label }),
			control,
			hint ? h("span", { class: "askai-field-hint", text: hint }) : null
		]);
	},

	checkRow(input, label, hint) {
		return h("label", { class: "askai-check-row" }, [
			input,
			h("span", { class: "askai-check-text" }, [
				h("span", { class: "askai-check-label", text: label }),
				hint ? h("span", { class: "askai-check-hint", text: hint }) : null
			])
		]);
	},

	bindEvents() {
		const els = this.els;

		els.input.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
				event.preventDefault();
				this.onSendClick();
			}
		});
		els.input.addEventListener("input", () => this.autoGrow());

		els.send.addEventListener("click", () => this.onSendClick());
		els.quickModel.addEventListener("change", () => this.saveQuickConfig({ model: els.quickModel.value }));
		els.quickThinking.addEventListener("change", () => this.saveQuickConfig({ thinking: els.quickThinking.value }));
		els.quickEffort.addEventListener("change", () => this.saveQuickConfig({ reasoningEffort: els.quickEffort.value }));
		els.chipRefresh.addEventListener("click", () => this.refreshText());

		els.provider.addEventListener("change", () => {
			const preset = PRESETS[els.provider.value];
			if (!preset) return;
			if (preset.endpoint) els.endpoint.value = preset.endpoint;
			if (preset.model) els.model.value = preset.model;
		});

		window.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				if (!els.contextOverlay.classList.contains("hidden")) this.closeContextViewer();
				else if (!els.settingsOverlay.classList.contains("hidden")) this.closeSettings();
			}
		});

		window.addEventListener("unload", () => this.onUnload());
	},

	/* ------------------------------------------------------------- payload */

	async receive(payload) {
		if (!payload) return;
		try {
			if (payload.kind === "blank") {
				this.closeSettings();
				this.focusInput();
				return;
			}

			const target = payload.attachmentID || payload.itemID;
			if (!target) {
				this.toast("没有找到要打开的论文", "error");
				return;
			}

			await this.openPaper(target);
			if (!this.state.paper) return;

			if (payload.kind === "selection" && payload.selection) {
				this.state.pendingSelection = String(payload.selection);
				this.updateAttachBar();

				const cfg = this.getConfig();
				const question = cfg.defaultQuestion || AskAICore.DEFAULT_QUESTION;
				if (!this.isConfigured(cfg)) {
					this.state.pendingAsk = { question, selection: payload.selection };
					this.openSettings({ banner: "首次使用：请填写 API Key 并确认接口地址（已预填 DeepSeek）。保存后会自动发送刚才选中的内容。" });
					return;
				}
				if (cfg.autoSend) {
					await this.ask(question, payload.selection);
				}
				else {
					// 默认留空：用户点上方快捷问题，或自己输入
					this.els.input.value = "";
					this.autoGrow();
					this.focusInput();
				}
			}
			else {
				this.focusInput();
			}
		}
		catch (e) {
			Zotero.logError(e);
			this.appendNotice(e.message || String(e), "error");
			this.setChip("读取失败");
		}
	},

	async openPaper(idOrItem) {
		this.setChip("正在读取全文…");
		try {
			const info = await Zotero.AskAI.getPaperInfo(idOrItem);
			if (this.state.paper && this.state.paper.attachmentID === info.attachmentID) {
				this.renderPaper();
				return;
			}

			this.saveSession();
			this.state.paper = info;
			this.state.text = "";
			this.state.pages = [];
			this.state.totalPages = 0;
			this.state.history = [];
			this.state.turns = [];
			this.state.pendingSelection = "";
			for (const node of Array.from(this.els.log.querySelectorAll(".askai-msg, .askai-notice"))) node.remove();

			this.renderPaper();
			this.updateAttachBar();
			this.renderEmpty();
			this.setEmptyVisible(true);
			this.setSendEnabled(false);

			const doc = await Zotero.AskAI.getPaperText(info.attachmentID);
			this.state.text = doc.text || "";
			this.state.totalPages = doc.totalPages || 0;
			this.state.pages = AskAICore.splitPages(this.state.text);
			this.renderChips();
			this.renderEmpty();
			this.restoreSession(info.attachmentID);

			if (!this.state.text) {
				this.appendNotice("未能提取到论文全文（可能是扫描版 PDF 或没有文本层）。AI 只能基于你选中的文字回答。", "warn");
			}
			else if (this.state.totalPages && this.state.totalPages > this.state.pages.length) {
				// partial extraction (encrypted / limited by PDF), keep going
			}
		}
		catch (e) {
			Zotero.logError(e);
			this.setChip("读取失败");
			this.appendNotice(e.message || String(e), "error");
			this.state.paper = null;
			this.renderPaper();
		}
		finally {
			this.setSendEnabled(true);
			this.updateHint();
			this.updateQuickBar();
			this.focusInput();
		}
	},

	renderPaper() {
		const paper = this.state.paper;
		const bar = this.els.paperTitle.closest("#askai-paper");
		if (!paper) {
			bar.classList.add("hidden");
			this.els.brandSub.textContent = "选中论文内容，一键基于全文提问";
			return;
		}
		bar.classList.remove("hidden");
		this.els.paperTitle.textContent = paper.title || "未命名文献";
		const meta = [
			paper.creators && paper.creators.length ? paper.creators.slice(0, 4).join("、") + (paper.creators.length > 4 ? " 等" : "") : "",
			paper.year,
			paper.venue
		].filter(Boolean).join(" · ");
		this.els.paperMeta.textContent = meta;
		this.els.brandSub.textContent = "已读取论文，可直接提问";
		this.renderChips();
	},

	renderChips() {
		const paper = this.state.paper;
		if (!paper) {
			this.els.chipText.textContent = "—";
			return;
		}
		const chars = this.state.text ? this.state.text.length : 0;
		const pages = this.state.totalPages || this.state.pages.length || 0;
		const tokens = AskAICore.estimateTokens(chars);
		this.els.chipText.textContent = chars
			? `${pages || "?"} 页 · ${AskAICore.formatChars(chars)} 字符 · 约 ${AskAICore.formatChars(tokens)} tokens`
			: "未提取到文本";
		this.els.chipText.title = "这是 AI 可读取的论文正文长度（约合 token 数，按 2.5 字符/token 估算）";
	},

	setChip(text) {
		this.els.chipText.textContent = text;
	},

	async refreshText() {
		if (!this.state.paper) return;
		this.setChip("正在重新读取全文…");
		try {
			const doc = await Zotero.AskAI.getPaperText(this.state.paper.attachmentID, { force: true });
			this.state.text = doc.text || "";
			this.state.totalPages = doc.totalPages || 0;
			this.state.pages = AskAICore.splitPages(this.state.text);
			this.renderChips();
			this.toast("已重新读取全文", "ok");
		}
		catch (e) {
			Zotero.logError(e);
			this.toast("重新读取失败：" + (e.message || e), "error");
			this.renderChips();
		}
	},

	/* --------------------------------------------------------------- empty */

	setEmptyVisible(visible) {
		const empty = this.els.log.querySelector("#askai-empty");
		if (!empty) return;
		empty.classList.toggle("hidden", !visible);
	},

	renderEmpty() {
		const log = this.els.log;
		let empty = log.querySelector("#askai-empty");
		if (!empty) {
			empty = h("div", { class: "askai-empty", id: "askai-empty" });
			log.insertBefore(empty, log.firstChild);
		}
		empty.replaceChildren();

		const icon = h("div", { class: "askai-empty-icon" });
		setIcon(icon, ICONS.sparkBig);

		if (!this.state.paper) {
			empty.append(
				icon,
				h("h2", { class: "askai-empty-title", text: "让 AI 读懂整篇论文" }),
				h("p", { class: "askai-empty-text", text: "在 PDF 阅读器中选中文字，点击「✨ 问 AI」；或在条目列表右键选择「用 AI 阅读这篇论文」。" }),
				h("div", { class: "askai-empty-actions" }, [
					h("button", { type: "button", class: "askai-btn askai-btn-primary", text: "打开当前选中的条目", onClick: () => this.openSelectedItem() }),
					h("button", { type: "button", class: "askai-btn", text: "配置 AI 服务", onClick: () => this.openSettings() })
				])
			);
			return;
		}

		const chars = this.state.text ? this.state.text.length : 0;
		const pages = this.state.totalPages || this.state.pages.length || 0;
		empty.append(
			icon,
			h("h2", { class: "askai-empty-title", text: this.state.paper.title }),
			h("p", { class: "askai-empty-text", text: chars
				? `已读取 ${pages || "?"} 页、${AskAICore.formatChars(chars)} 字符的论文正文。可以直接提问，或回到 PDF 选中一段话。`
				: "没有提取到论文正文，请确认这是一份带文本层的 PDF。" }),
			h("div", { class: "askai-quick" }, QUICK_PROMPTS.map((prompt) => h("button", {
				type: "button",
				class: "askai-quick-btn",
				text: prompt,
				onClick: () => this.quickAsk(prompt)
			})))
		);
	},

	openSelectedItem() {
		try {
			const pane = Zotero.getActiveZoteroPane ? Zotero.getActiveZoteroPane() : null;
			const items = (pane && pane.getSelectedItems ? pane.getSelectedItems() : []) || [];
			const target = items.find((item) => item && (item.isRegularItem?.() || item.isAttachment?.()));
			if (!target) {
				this.toast("请先在 Zotero 中选中一篇文献", "warn");
				return;
			}
			this.openPaper(target.id);
		}
		catch (e) {
			Zotero.logError(e);
			this.toast("无法读取当前选中条目", "error");
		}
	},

	/* ----------------------------------------------------------- messaging */

	onSendClick() {
		if (this.state.streaming) {
			this.stopStreaming();
			return;
		}
		this.send();
	},

	async send() {
		const typed = this.els.input.value.trim();
		const selection = this.state.pendingSelection || "";
		if (!typed && !selection) return;
		const question = typed || this.getConfig().defaultQuestion || AskAICore.DEFAULT_QUESTION;
		await this.ask(question, selection);
	},

	async quickAsk(prompt) {
		await this.ask(prompt, this.state.pendingSelection || "");
	},

	async ask(question, selection) {
		question = String(question || "").trim();
		selection = String(selection || "").trim();
		if (!question && !selection) return;
		if (!this.state.paper) {
			this.toast("请先打开一篇论文", "warn");
			return;
		}
		if (this.state.streaming) {
			this.toast("正在回答中，请稍候或先停止");
			return;
		}

		const cfg = this.getConfig();
		if (!this.isConfigured(cfg)) {
			this.state.pendingAsk = { question, selection };
			this.openSettings({ banner: "请先完成 API 配置，保存后会自动发送这条问题。" });
			return;
		}

		if (!question) question = cfg.defaultQuestion || AskAICore.DEFAULT_QUESTION;

		const turn = this.createTurn(question, selection, cfg);

		this.state.pendingSelection = "";
		this.updateAttachBar();
		this.els.input.value = "";
		this.autoGrow();

		this.appendUserTurn(turn);
		this.appendAssistantTurn(turn);
		this.state.turns.push(turn);
		this.setEmptyVisible(false);
		this.scrollToBottom(true);

		await this.runTurn(turn);
	},

	createTurn(question, selection, cfg) {
		const pages = this.state.pages && this.state.pages.length
			? this.state.pages
			: AskAICore.splitPages(this.state.text || "");
		this.state.pages = pages;

		const context = AskAICore.buildPaperContext({
			pages,
			budgetChars: cfg.maxContextChars,
			query: question,
			selection
		});

		const historyMessage = {
			role: "user",
			content: selection
				? '我选中的论文内容：\n"""\n' + selection + '\n"""\n\n' + question
				: question
		};

		const messages = AskAICore.buildMessages({
			paper: this.state.paper,
			context,
			selection,
			question,
			history: this.state.history.slice(),
			language: cfg.language,
			customPrompt: cfg.systemPrompt
		});

		return {
			question,
			selection,
			cfg,
			context,
			messages,
			historyMessage,
			historyPushed: false,
			text: "",
			reasoning: "",
			error: null,
			completed: false,
			el: {},
			_raf: null
		};
	},

	appendUserTurn(turn) {
		const wrap = h("div", { class: "askai-msg askai-msg-user" });
		const bubble = h("div", { class: "askai-bubble askai-bubble-user" });
		if (turn.selection) bubble.appendChild(this.buildQuote(turn.selection));
		bubble.appendChild(h("div", { class: "askai-q", text: turn.question }));
		wrap.appendChild(bubble);
		this.els.log.appendChild(wrap);
		turn.el.userWrap = wrap;
	},

	buildQuote(selection) {
		const details = h("details", { class: "askai-quote" });
		const summary = h("summary", { class: "askai-quote-summary" }, [
			h("span", { class: "askai-quote-tag", text: "选中内容" }),
			h("span", { class: "askai-quote-preview", text: truncate(selection, 48) })
		]);
		details.appendChild(summary);
		details.appendChild(h("blockquote", { class: "askai-quote-body", text: selection }));
		if (selection.length < 220) details.open = true;
		return details;
	},

	appendAssistantTurn(turn) {
		const wrap = h("div", { class: "askai-msg askai-msg-ai" });
		const bubble = h("div", { class: "askai-bubble askai-bubble-ai" });

		const chip = h("button", { type: "button", class: "askai-ctx hidden" });
		chip.addEventListener("click", () => this.openContextViewer(turn.context));

		const reasoning = h("details", { class: "askai-reasoning hidden" }, [
			h("summary", { class: "askai-reasoning-summary", text: "思考过程" })
		]);
		const reasoningBody = h("pre", { class: "askai-reasoning-body" });
		reasoning.appendChild(reasoningBody);

		const content = h("div", { class: "askai-md" });
		const typing = h("div", { class: "askai-typing" }, [
			h("span"), h("span"), h("span")
		]);
		content.appendChild(typing);

		const actions = h("div", { class: "askai-actions hidden" });
		const usage = h("div", { class: "askai-usage hidden" });
		bubble.append(chip, reasoning, content, usage, actions);
		wrap.appendChild(bubble);
		this.els.log.appendChild(wrap);

		Object.assign(turn.el, {
			aiWrap: wrap,
			bubble,
			chip,
			reasoning,
			reasoningBody,
			content,
			usage,
			actions,
			typing
		});
	},

	async runTurn(turn) {
		this.state.streaming = true;
		this.setSendState("stop");
		this.els.log.classList.add("is-busy");
		turn.el.aiWrap.classList.add("is-streaming");

		if (!turn.historyPushed) {
			this.state.history.push(turn.historyMessage);
			turn.historyPushed = true;
		}

		try {
			const result = await this.requestModel(turn);
			turn.text = result.content || "";
			turn.reasoning = result.reasoning || "";
			turn.usage = result.usage || null;
			turn.completed = true;
			this.renderTurnContent(turn);
			this.finishTurn(turn);
		}
		catch (e) {
			if (e && e.name === "AbortError") {
				turn.aborted = true;
				turn.completed = true;
				this.renderTurnContent(turn);
				this.finishTurn(turn, { aborted: true });
			}
			else {
				Zotero.logError(e);
				if (turn.historyPushed) {
					const idx = this.state.history.lastIndexOf(turn.historyMessage);
					if (idx !== -1) this.state.history.splice(idx, 1);
					turn.historyPushed = false;
				}
				turn.error = e;
				this.renderTurnError(turn, e);
				this.scrollToBottom();
			}
		}
		finally {
			this.state.streaming = false;
			this.state.controller = null;
			this.setSendState("send");
			this.els.log.classList.remove("is-busy");
			turn.el.aiWrap.classList.remove("is-streaming");
		}
	},

	async requestModel(turn) {
		const cfg = turn.cfg;
		const url = AskAICore.normalizeEndpoint(cfg.endpoint);
		if (!url) throw this.makeError("接口地址为空，请在设置中填写。");

		const headers = AskAICore.buildHeaders({
			apiKey: cfg.apiKey,
			extraHeaders: cfg.extraHeaders
		});
		const body = AskAICore.buildRequestBody({
			model: cfg.model,
			messages: turn.messages,
			temperature: cfg.temperature,
			maxTokens: cfg.maxTokens,
			stream: cfg.stream,
			thinking: cfg.thinking,
			reasoningEffort: cfg.reasoningEffort,
			includeUsage: true
		});

		if (cfg.debug) {
			Zotero.debug(`[askai] request url=${url} chars=${JSON.stringify(turn.messages).length} context=${turn.context.mode}/${turn.context.usedChars}`);
		}

		const controller = new AbortController();
		this.state.controller = controller;

		let response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: controller.signal
			});
		}
		catch (e) {
			if (e && e.name === "AbortError") throw e;
			Zotero.debug("[askai] fetch failed, retrying via Zotero.HTTP: " + e);
			const payload = await this.requestViaZotero(url, Object.assign({}, body, { stream: false }), headers);
			return this.parseNonStream(payload);
		}

		// Some OpenAI-compatible providers reject `stream_options`; retry once
		// without it so usage reporting can't break the request.
		if (!response.ok && response.status === 400 && cfg.stream) {
			let text = "";
			try {
				text = await response.text();
			}
			catch (e) {
				// ignore
			}
			if (/stream_options/i.test(text)) {
				Zotero.debug("[askai] provider rejected stream_options, retrying without usage");
				const retryBody = AskAICore.buildRequestBody({
					model: cfg.model,
					messages: turn.messages,
					temperature: cfg.temperature,
					maxTokens: cfg.maxTokens,
					stream: cfg.stream,
					thinking: cfg.thinking,
					reasoningEffort: cfg.reasoningEffort,
					includeUsage: false
				});
				response = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(retryBody),
					signal: controller.signal
				});
			}
			else {
				throw this.httpError(400, text);
			}
		}

		if (!response.ok) {
			let text = "";
			try {
				text = await response.text();
			}
			catch (e) {
				// ignore
			}
			throw this.httpError(response.status, text);
		}

		if (!cfg.stream) {
			const payload = await response.json();
			return this.parseNonStream(payload);
		}

		return this.consumeStream(response, turn);
	},

	async requestViaZotero(url, body, headers) {
		try {
			const xhr = await Zotero.HTTP.request("POST", url, {
				body: JSON.stringify(body),
				headers,
				responseType: "json",
				timeout: 180000,
				successCodes: [200]
			});
			return xhr.response;
		}
		catch (e) {
			const status = e && e.xmlHttpRequest && e.xmlHttpRequest.status;
			if (status) throw this.httpError(status, (e.xmlHttpRequest && e.xmlHttpRequest.responseText) || e.message || "");
			throw this.makeError("网络请求失败：" + (e.message || e), "请检查接口地址、网络或代理设置；本地服务请确认已启动。");
		}
	},

	parseNonStream(payload) {
		if (payload && payload.error) {
			throw this.makeError("接口返回错误：" + AskAICore.errorMessage(payload), "请检查模型名称、API Key 与账户额度。");
		}
		const answer = AskAICore.extractAnswer(payload);
		const content = answer.content || answer.reasoning || "";
		if (!content) {
			throw this.makeError("接口没有返回内容。", "可能是模型名称不正确、账户额度不足或请求参数被拒绝。");
		}
		return { content, reasoning: answer.reasoning || "", usage: AskAICore.normalizeUsage(payload && payload.usage) };
	},

	async consumeStream(response, turn) {
		if (!response.body || typeof response.body.getReader !== "function") {
			const text = await response.text();
			return this.parseStreamText(text);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder("utf-8");
		const parser = AskAICore.createSSEParser();
		let content = "";
		let reasoning = "";
		let gotFirst = false;

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			for (const data of parser.push(chunk)) {
				if (data === "[DONE]") continue;
				let json;
				try {
					json = JSON.parse(data);
				}
				catch (e) {
					continue;
				}
				if (json.error) {
					throw this.makeError("接口返回错误：" + AskAICore.errorMessage(json), "请检查模型名称、API Key 与账户额度。");
				}
				if (json.usage) {
					turn.usage = AskAICore.normalizeUsage(json.usage);
				}
				const delta = AskAICore.extractDelta(json);
				if (delta.reasoning) {
					reasoning += delta.reasoning;
					turn.reasoning = reasoning;
					this.updateReasoning(turn);
				}
				if (delta.content) {
					content += delta.content;
					turn.text = content;
					if (!gotFirst) {
						gotFirst = true;
						this.hideTyping(turn);
					}
					this.scheduleRender(turn);
				}
			}
		}

		this.hideTyping(turn);
		if (!content.trim() && reasoning.trim()) {
			content = reasoning;
		}
		return { content, reasoning, usage: turn.usage || null };
	},

	parseStreamText(text) {
		const trimmed = String(text || "").trim();
		if (!trimmed) throw this.makeError("接口返回为空。");

		if (/^data:/.test(trimmed)) {
			let content = "";
			let reasoning = "";
			for (const line of trimmed.split("\n")) {
				const match = line.match(/^data:\s?(.*)$/);
				if (!match || match[1] === "[DONE]") continue;
				let json;
				try {
					json = JSON.parse(match[1]);
				}
				catch (e) {
					continue;
				}
				const delta = AskAICore.extractDelta(json);
				content += delta.content;
				reasoning += delta.reasoning;
			}
			if (!content && !reasoning) throw this.makeError("无法解析流式响应。", "可尝试在设置中关闭「流式输出」。");
			return { content: content || reasoning, reasoning };
		}

		let json;
		try {
			json = JSON.parse(trimmed);
		}
		catch (e) {
			throw this.makeError("无法解析接口响应：" + truncate(trimmed, 200));
		}
		return this.parseNonStream(json);
	},

	/* ------------------------------------------------------------ rendering */

	updateReasoning(turn) {
		if (!turn.reasoning) return;
		turn.el.reasoning.classList.remove("hidden");
		turn.el.reasoningBody.textContent = turn.reasoning;
	},

	hideTyping(turn) {
		if (turn.el.typing && turn.el.typing.parentNode) turn.el.typing.remove();
	},

	scheduleRender(turn) {
		if (turn._raf) return;
		turn._raf = requestAnimationFrame(() => {
			turn._raf = null;
			this.renderTurnContent(turn);
			this.scrollToBottom();
		});
	},

	renderTurnContent(turn) {
		if (!turn.el.content) return;
		const content = turn.el.content;
		this.hideTyping(turn);

		if (turn.text) {
			content.replaceChildren(AskAICore.renderMarkdown(AskAICore.parseMarkdown(turn.text), document));
		}
		else if (!turn.error) {
			content.replaceChildren(h("span", { class: "askai-muted", text: "（没有返回内容）" }));
		}

		if (turn.reasoning) this.updateReasoning(turn);
	},

	finishTurn(turn, opts) {
		this.renderTurnContent(turn);
		if (turn.aborted && !turn.text) {
			turn.el.content.replaceChildren(h("span", { class: "askai-muted", text: "已停止生成。" }));
		}
		if (turn.text && !turn.assistantPushed) {
			turn.assistantPushed = true;
			turn.assistantHistoryMessage = { role: "assistant", content: turn.text };
			this.state.history.push(turn.assistantHistoryMessage);
		}
		if (turn.text) {
			turn.el.actions.classList.remove("hidden");
			this.ensureActions(turn);
		}
		this.renderUsage(turn);
		if (turn.context) {
			turn.el.chip.textContent = this.contextLabel(turn.context);
			turn.el.chip.classList.remove("hidden");
			turn.el.chip.title = "点此查看本次发送给 AI 的论文上下文";
		}
		this.setSendState("send");
		this.scrollToBottom();
		this.saveSession();
		if (opts && opts.aborted) this.toast("已停止生成");
	},

	renderUsage(turn) {
		if (!turn.el.usage) return;
		const text = AskAICore.formatUsage(turn.usage);
		if (!text) return;
		turn.el.usage.textContent = "用量：" + text;
		turn.el.usage.classList.remove("hidden");
	},

	contextLabel(ctx) {
		if (!ctx) return "上下文";
		if (ctx.mode === "full") {
			return `全文 ${AskAICore.formatChars(ctx.usedChars)} 字符 · ${ctx.pageCount} 页`;
		}
		if (ctx.mode === "retrieval") {
			return `检索 ${ctx.chunksUsed}/${ctx.chunksTotal} 段 · ${AskAICore.formatChars(ctx.usedChars)} 字符`;
		}
		return "无全文";
	},

	ensureActions(turn) {
		if (turn.el.actions.dataset.built) return;
		turn.el.actions.dataset.built = "1";
		const btn = (icon, label, fn) => {
			const b = h("button", { type: "button", class: "askai-action" });
			const iconEl = h("span", { class: "askai-action-icon" });
			setIcon(iconEl, icon);
			b.append(iconEl, h("span", { text: label }));
			b.addEventListener("click", fn);
			return b;
		};
		turn.el.actions.append(
			btn(ICONS.copy, "复制", () => this.copyText(turn.text)),
			btn(ICONS.note, "存为笔记", () => this.saveNote(turn)),
			btn(ICONS.context, "上下文", () => this.openContextViewer(turn.context)),
			btn(ICONS.retry, "重试", () => this.retryTurn(turn))
		);
	},

	async retryTurn(turn) {
		if (this.state.streaming) return;
		if (turn.assistantPushed) {
			const index = this.state.history.indexOf(turn.assistantHistoryMessage);
			if (index !== -1) this.state.history.splice(index, 1);
			turn.assistantPushed = false;
			turn.assistantHistoryMessage = null;
		}
		turn.text = "";
		turn.reasoning = "";
		turn.error = null;
		turn.aborted = false;
		turn.completed = false;
		turn.el.actions.classList.add("hidden");
		turn.el.actions.dataset.built = "";
		turn.el.actions.replaceChildren();
		turn.el.reasoning.classList.add("hidden");
		turn.el.reasoningBody.textContent = "";
		turn.el.chip.classList.add("hidden");
		const typing = h("div", { class: "askai-typing" }, [h("span"), h("span"), h("span")]);
		turn.el.typing = typing;
		turn.el.content.replaceChildren(typing);
		await this.runTurn(turn);
	},

	renderTurnError(turn, error) {
		const content = turn.el.content;
		this.hideTyping(turn);
		content.replaceChildren(h("div", { class: "askai-error" }, [
			h("div", { class: "askai-error-title", text: "请求失败" }),
			h("div", { class: "askai-error-msg", text: error.message || String(error) }),
			error.hint ? h("div", { class: "askai-error-hint", text: "建议：" + error.hint }) : null,
			h("div", { class: "askai-error-actions" }, [
				h("button", { type: "button", class: "askai-btn askai-btn-sm", text: "重试", onClick: () => this.retryTurn(turn) }),
				h("button", { type: "button", class: "askai-btn askai-btn-sm", text: "打开设置", onClick: () => this.openSettings() })
			])
		]));
		turn.el.actions.classList.add("hidden");
	},

	scrollToBottom(force) {
		const log = this.els.log;
		const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
		if (force || nearBottom) log.scrollTop = log.scrollHeight;
	},

	appendNotice(text, kind) {
		const notice = h("div", { class: "askai-notice" + (kind ? " is-" + kind : ""), text });
		this.els.log.insertBefore(notice, this.els.log.querySelector("#askai-empty") || null);
	},

	/* ------------------------------------------------------------- sessions */

	saveSession() {
		if (!this.state.paper) return;
		const turns = this.state.turns.map((turn) => ({
			question: turn.question,
			selection: turn.selection,
			text: turn.text,
			reasoning: turn.reasoning,
			usage: turn.usage,
			context: turn.context,
			completed: turn.completed,
			error: turn.error ? { message: turn.error.message, hint: turn.error.hint } : null
		}));
		this.state.sessions.set(this.state.paper.attachmentID, {
			turns,
			history: this.state.history.slice()
		});
	},

	restoreSession(attachmentID) {
		const session = this.state.sessions.get(attachmentID);
		if (!session) return;
		this.state.history = (session.history || []).slice();
		for (const saved of session.turns || []) {
			const turn = Object.assign({}, saved, { el: {}, _raf: null });
			turn.error = saved.error ? Object.assign(new Error(saved.error.message), { hint: saved.error.hint }) : null;
			this.appendUserTurn(turn);
			this.appendAssistantTurn(turn);
			this.hideTyping(turn);
			this.renderTurnContent(turn);
			if (turn.text) {
				turn.el.actions.classList.remove("hidden");
				this.ensureActions(turn);
			}
			this.renderUsage(turn);
			if (turn.error) this.renderTurnError(turn, turn.error);
			if (turn.context) {
				turn.el.chip.textContent = this.contextLabel(turn.context);
				turn.el.chip.classList.remove("hidden");
			}
			this.state.turns.push(turn);
		}
		this.setEmptyVisible(this.state.turns.length === 0);
	},

	newConversation() {
		if (!this.state.paper) return;
		this.state.history = [];
		this.state.turns = [];
		this.state.pendingSelection = "";
		for (const node of Array.from(this.els.log.querySelectorAll(".askai-msg, .askai-notice"))) node.remove();
		this.state.sessions.delete(this.state.paper.attachmentID);
		this.updateAttachBar();
		this.renderEmpty();
		this.setEmptyVisible(true);
		this.focusInput();
	},

	/* ---------------------------------------------------------------- notes */

	async saveNote(turn) {
		try {
			const paper = this.state.paper;
			if (!paper) return;
			if (!turn.text) {
				this.toast("没有可保存的内容", "warn");
				return;
			}

			const answerHTML = AskAICore.markdownToHTML(AskAICore.parseMarkdown(turn.text));
			const parts = [];
			parts.push(`<h1>AI 问答：${AskAICore.escapeHTML(paper.title)}</h1>`);
			const meta = [paper.creators && paper.creators.join("、"), paper.year, paper.venue].filter(Boolean).join(" · ");
			if (meta) parts.push(`<p><em>${AskAICore.escapeHTML(meta)}</em></p>`);
			if (turn.selection) parts.push(`<blockquote>${AskAICore.escapeHTML(turn.selection).replace(/\n/g, "<br/>")}</blockquote>`);
			parts.push(`<p><strong>问题：</strong>${AskAICore.escapeHTML(turn.question)}</p>`);
			parts.push(answerHTML || "<p>（无内容）</p>");
			parts.push(`<p><small>由 AI 论文助手生成 · ${new Date().toLocaleString()}</small></p>`);

			const note = new Zotero.Item("note");
			note.libraryID = paper.libraryID;
			const parent = Zotero.Items.get(paper.itemID);
			if (parent && parent.isRegularItem && parent.isRegularItem()) note.parentID = parent.id;
			note.setNote(parts.join("\n"));
			await note.saveTx();

			this.toast("已保存为 Zotero 笔记", "ok");
			try {
				const pane = Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane();
				if (pane && pane.selectItem) pane.selectItem(note.id);
			}
			catch (e) {
				// ignore
			}
		}
		catch (e) {
			Zotero.logError(e);
			this.toast("保存笔记失败：" + (e.message || e), "error");
		}
	},

	copyText(text) {
		try {
			Zotero.Utilities.Internal.copyTextToClipboard(String(text || ""));
			this.toast("已复制", "ok");
		}
		catch (e) {
			Zotero.logError(e);
			this.toast("复制失败", "error");
		}
	},

	/* -------------------------------------------------------------- settings */

	fillForm(cfg) {
		const els = this.els;
		els.provider.value = PRESETS[cfg.provider] ? cfg.provider : "custom";
		els.endpoint.value = cfg.endpoint || "";
		els.apiKey.value = cfg.apiKey || "";
		els.model.value = cfg.model || "";
		els.thinking.value = cfg.thinking || "auto";
		els.reasoningEffort.value = cfg.reasoningEffort || "high";
		els.temperature.value = String(cfg.temperature ?? 0.3);
		els.maxTokens.value = String(cfg.maxTokens ?? 0);
		els.maxContextChars.value = String(cfg.maxContextChars ?? 100000);
		els.stream.checked = !!cfg.stream;
		els.autoSend.checked = !!cfg.autoSend;
		els.language.value = cfg.language || "auto";
		els.defaultQuestion.value = cfg.defaultQuestion || "";
		els.systemPrompt.value = cfg.systemPrompt || "";
		els.extraHeaders.value = cfg.extraHeaders || "";
		els.debug.checked = !!cfg.debug;
	},

	readForm() {
		const els = this.els;
		return {
			provider: els.provider.value,
			endpoint: els.endpoint.value.trim(),
			apiKey: els.apiKey.value.trim(),
			model: els.model.value.trim(),
			thinking: els.thinking.value,
			reasoningEffort: els.reasoningEffort.value,
			temperature: parseFloat(els.temperature.value),
			maxTokens: parseInt(els.maxTokens.value, 10) || 0,
			maxContextChars: parseInt(els.maxContextChars.value, 10) || 100000,
			stream: !!els.stream.checked,
			autoSend: !!els.autoSend.checked,
			language: els.language.value,
			defaultQuestion: els.defaultQuestion.value.trim(),
			systemPrompt: els.systemPrompt.value.trim(),
			extraHeaders: els.extraHeaders.value.trim(),
			debug: !!els.debug.checked
		};
	},

	openSettings(options) {
		const opts = options || {};
		this.fillForm(this.getConfig());
		if (opts.banner) {
			this.els.settingsBanner.textContent = opts.banner;
			this.els.settingsBanner.classList.remove("hidden");
		}
		else {
			this.els.settingsBanner.classList.add("hidden");
		}
		this.els.settingsOverlay.classList.remove("hidden");
		this.els.testStatus.textContent = "";
		this.els.endpoint.focus();
	},

	closeSettings() {
		this.els.settingsOverlay.classList.add("hidden");
		this.state.settingsOpen = false;
		this.focusInput();
	},

	saveSettings(closeAfter) {
		const cfg = this.readForm();
		if (!cfg.endpoint) {
			this.toast("请填写接口地址", "error");
			this.els.endpoint.focus();
			return;
		}
		if (!cfg.model) {
			this.toast("请填写模型名称", "error");
			this.els.model.focus();
			return;
		}
		try {
			const saved = Zotero.AskAI.saveConfig(cfg);
			this.fillForm(saved);
			this.updateHint();
			this.toast("设置已保存", "ok");
			if (closeAfter) this.closeSettings();
			if (this.state.pendingAsk) {
				const pending = this.state.pendingAsk;
				this.state.pendingAsk = null;
				this.ask(pending.question, pending.selection);
			}
		}
		catch (e) {
			Zotero.logError(e);
			this.toast("保存失败：" + (e.message || e), "error");
		}
	},

	resetSettings() {
		try {
			if (!window.confirm("恢复默认设置？API Key 也会被清空。")) return;
			this.fillForm(Zotero.AskAI.resetConfig());
			this.updateHint();
			this.toast("已恢复默认设置", "ok");
		}
		catch (e) {
			Zotero.logError(e);
		}
	},

	async testConnection() {
		const cfg = this.readForm();
		if (!cfg.endpoint || !cfg.model) {
			this.setTestStatus("请先填写接口地址和模型", "error");
			return;
		}
		this.setTestStatus("正在连接…", "");
		const started = Date.now();
		try {
			const url = AskAICore.normalizeEndpoint(cfg.endpoint);
			const headers = AskAICore.buildHeaders({ apiKey: cfg.apiKey, extraHeaders: cfg.extraHeaders });
			const body = {
				model: cfg.model,
				messages: [{ role: "user", content: "ping" }],
				stream: false,
				max_tokens: 8
			};
			let response;
			try {
				response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
			}
			catch (e) {
				const payload = await this.requestViaZotero(url, body, headers);
				const answer = (AskAICore.extractAnswer(payload).content || "").trim();
				this.setTestStatus(`连接成功（${Date.now() - started} ms）` + (answer ? ` · 回复：${truncate(answer, 30)}` : ""), "ok");
				return;
			}
			const text = await response.text();
			if (!response.ok) throw this.httpError(response.status, text);
			let json = null;
			try {
				json = JSON.parse(text);
			}
			catch (e) {
				// ignore
			}
			const answer = json ? (AskAICore.extractAnswer(json).content || "").trim() : "";
			this.setTestStatus(`连接成功（${Date.now() - started} ms）` + (answer ? ` · 回复：${truncate(answer, 30)}` : ""), "ok");
		}
		catch (e) {
			this.setTestStatus("连接失败：" + (e.message || e), "error");
		}
	},

	setTestStatus(text, kind) {
		const el = this.els.testStatus;
		el.textContent = text;
		el.className = "askai-test-status" + (kind ? " is-" + kind : "");
	},

	/* ------------------------------------------------------------- context */

	openContextViewer(context) {
		if (!context) {
			this.toast("还没有可查看的上下文", "warn");
			return;
		}
		const modeLabel = context.mode === "full"
			? "全文"
			: context.mode === "retrieval" ? "相关片段（检索模式）" : "无正文";
		const header = [
			`模式：${modeLabel}`,
			`页数：${context.pageCount || 0}`,
			`本次发送：${context.usedChars || 0} 字符（约 ${AskAICore.estimateTokens(context.usedChars)} tokens）`,
			context.mode === "retrieval" ? `片段：${context.chunksUsed}/${context.chunksTotal}` : null,
			`论文总字数：${context.totalChars || 0}`
		].filter(Boolean).join("\n");
		this.els.contextPre.textContent = header + "\n\n" + (context.text || "（空）");
		this.els.contextOverlay.classList.remove("hidden");
	},

	closeContextViewer() {
		this.els.contextOverlay.classList.add("hidden");
		this.focusInput();
	},

	/* ---------------------------------------------------------------- misc */

	updateAttachBar() {
		const selection = this.state.pendingSelection;
		if (!selection) {
			this.els.attach.classList.add("hidden");
			this.updateQuickBar();
			return;
		}
		this.els.attachLabel.textContent = "已附带选中内容：" + truncate(selection, 36);
		this.els.attach.classList.remove("hidden");
		this.updateQuickBar();
	},

	updateQuickBar() {
		const bar = this.els.quickBar;
		if (!bar) return;
		bar.replaceChildren();
		if (!this.state.paper) {
			bar.classList.add("hidden");
			return;
		}
		const prompts = this.state.pendingSelection ? SELECTION_PROMPTS : PAPER_PROMPTS;
		for (const item of prompts) {
			const prompt = typeof item.prompt === "function" ? item.prompt() : item.prompt;
			const chip = h("button", { type: "button", class: "askai-quickchip", text: item.label });
			chip.title = prompt;
			chip.addEventListener("click", () => {
				this.els.input.value = prompt;
				this.autoGrow();
				this.focusInput();
			});
			bar.appendChild(chip);
		}
		bar.classList.remove("hidden");
	},

	clearSelection() {
		this.state.pendingSelection = "";
		this.updateAttachBar();
		this.focusInput();
	},

	updateHint() {
		this.syncComposerControls();
	},

	syncComposerControls(cfg) {
		const els = this.els;
		if (!els.quickModel) return;
		cfg = cfg || this.getConfig();

		const models = ["deepseek-flash", "deepseek-v4-pro"];
		for (const key of Object.keys(PRESETS)) {
			const model = PRESETS[key].model;
			if (model && !models.includes(model)) models.push(model);
		}
		if (cfg.model && !models.includes(cfg.model)) models.unshift(cfg.model);
		els.quickModel.replaceChildren(...models.map((model) => h("option", { value: model, text: model })));
		els.quickModel.value = cfg.model || models[0];

		els.quickThinking.replaceChildren(
			h("option", { value: "auto", text: "思考:默认" }),
			h("option", { value: "enabled", text: "思考:开" }),
			h("option", { value: "disabled", text: "思考:关" })
		);
		els.quickThinking.value = cfg.thinking || "auto";

		els.quickEffort.replaceChildren(
			h("option", { value: "low", text: "强度:低" }),
			h("option", { value: "high", text: "强度:高" }),
			h("option", { value: "max", text: "强度:最高" })
		);
		els.quickEffort.value = cfg.reasoningEffort || "high";

		els.hintContext.textContent = this.state.paper
			? `上下文上限 ${AskAICore.formatChars(cfg.maxContextChars)}字符`
			: "上下文：自动";
	},

	saveQuickConfig(patch) {
		try {
			const cfg = Object.assign(this.getConfig(), patch);
			Zotero.AskAI.saveConfig(cfg);
			this.syncComposerControls(cfg);
			const label = patch.model
				? `模型：${patch.model}`
				: patch.thinking
					? `思考模式：${patch.thinking === "auto" ? "默认" : patch.thinking === "enabled" ? "开" : "关"}`
					: `思考强度：${patch.reasoningEffort}`;
			this.toast("已更新 " + label, "ok");
		}
		catch (e) {
			Zotero.logError(e);
			this.toast("更新设置失败", "error");
		}
	},

	setSendEnabled(enabled) {
		this.els.send.disabled = !enabled;
		this.els.send.classList.toggle("is-disabled", !enabled);
	},

	setSendState(state) {
		if (state === "stop") {
			setIcon(this.els.send, ICONS.stop);
			this.els.send.title = "停止生成";
			this.els.send.classList.add("is-stop");
			this.els.input.disabled = true;
		}
		else {
			setIcon(this.els.send, ICONS.send);
			this.els.send.title = "发送";
			this.els.send.classList.remove("is-stop");
			this.els.input.disabled = false;
		}
	},

	stopStreaming() {
		try {
			if (this.state.controller) {
				this.state.controller.abort();
				this.toast("正在停止…");
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
	},

	onUnload() {
		try {
			if (this.state.controller) this.state.controller.abort();
		}
		catch (e) {
			// ignore
		}
		this.saveSession();
	},

	focusInput() {
		try {
			this.els.input.focus();
		}
		catch (e) {
			// ignore
		}
	},

	autoGrow() {
		const el = this.els.input;
		el.style.height = "auto";
		el.style.height = Math.min(180, Math.max(44, el.scrollHeight)) + "px";
	},

	toast(message, kind) {
		const el = this.els.toast;
		if (!el) return;
		el.textContent = String(message || "");
		el.className = "askai-toast" + (kind ? " is-" + kind : "");
		clearTimeout(this._toastTimer);
		this._toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
	},

	makeError(message, hint) {
		const error = new Error(message);
		if (hint) error.hint = hint;
		return error;
	},

	httpError(status, bodyText) {
		let detail = "";
		try {
			const json = JSON.parse(bodyText);
			detail = AskAICore.errorMessage(json) || "";
		}
		catch (e) {
			detail = String(bodyText || "").slice(0, 400);
		}
		const hints = {
			400: "请求格式有误，请检查模型名称与参数",
			401: "API Key 无效或未填写",
			403: "没有访问权限（Key 权限、IP 白名单或账户额度）",
			404: "接口地址可能不正确，应指向 …/v1/chat/completions",
			413: "上下文过长，请调低「最大上下文字符数」",
			429: "请求太频繁或额度不足，请稍后再试",
			500: "服务端错误，请稍后再试",
			502: "网关错误，请稍后再试",
			503: "服务暂时不可用，请稍后再试"
		};
		return this.makeError(
			"HTTP " + status + (detail ? "：" + detail : ""),
			hints[status] || "请检查网络、接口地址、模型名称与 API Key"
		);
	},

	showFatal(error) {
		try {
			Zotero.logError(error);
		}
		catch (e) {
			// ignore
		}
		const root = document.getElementById("askai-root");
		const box = h("div", { class: "askai-fatal" }, [
			h("h2", { text: "窗口加载失败" }),
			h("pre", { text: (error && (error.stack || error.message)) || String(error) }),
			h("p", { text: "请尝试在 Zotero 中禁用并重新启用插件，或在调试输出中查看详细信息。" })
		]);
		root.replaceChildren(box);
	}
};

window.AskAIApp = AskAIApp;




