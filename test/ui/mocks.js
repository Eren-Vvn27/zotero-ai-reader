/* Mocks for running the real AskAI UI code in a plain browser. */

(function () {
	const PAGE = (title, body) => `【${title}】\n${body}\n\n` + "This section discusses the experimental setup, the datasets used, and the metrics reported in the paper. ".repeat(12);

	const MOCK_PAGES = [
		PAGE("摘要", "本文提出了一种新的方法，用于解决论文阅读中的理解问题。我们在大规模数据上验证了该方法。"),
		PAGE("引言", "阅读理解是研究者的核心工作之一。现有工具主要提供检索，而不能帮助读者建立整体理解。"),
		PAGE("方法", "本方法的核心假设是：论文的论证结构可以从章节与段落中恢复。基于这一假设，我们构建了一个两阶段的阅读助手。"),
		PAGE("实验", "我们在 120 篇论文上进行了实验，涵盖计算机科学与生物医学领域，评价指标包括答案准确率与引用一致性。"),
		PAGE("结果", "实验结果表明，本方法在答案准确率上优于基线 8.4 个百分点，并且能够给出可核查的页码引用。"),
		PAGE("结论", "本文展示了结合全文上下文进行问答的价值，并讨论了扫描版 PDF 等局限性。")
	];

	const MOCK_TEXT = MOCK_PAGES.join("\f");

	const DEFAULT_CONFIG = {
		enabled: true,
		endpoint: "http://127.0.0.1:8765",
		apiKey: "test-key",
		model: "mock-model",
		provider: "custom",
		temperature: 0.3,
		maxTokens: 0,
		maxContextChars: 100000,
		stream: true,
		autoSend: false,
		thinking: "auto",
		reasoningEffort: "high",
		language: "auto",
		defaultQuestion: "请结合论文全文，解释我选中的这段内容。",
		systemPrompt: "",
		extraHeaders: "",
		debug: true
	};

	const ANSWER_PARTS = [
		"根据论文全文，",
		"这段内容描述的是",
		"方法部分的核心假设。",
		"\n\n**要点**：\n",
		"- 假设 A：论证结构可恢复\n",
		"- 假设 B：段落边界可靠\n\n",
		"| 项目 | 值 |\n",
		"| --- | --- |\n",
		"| 页码 | 3 |\n"
	];

	const state = window.__mock = {
		config: Object.assign({}, DEFAULT_CONFIG),
		notes: [],
		clipboard: "",
		requests: [],
		fetchMode: "ok",
		errors: [],
		text: MOCK_TEXT
	};

	window.addEventListener("error", (event) => {
		state.errors.push(String(event.message || event.error));
	});
	window.addEventListener("unhandledrejection", (event) => {
		const reason = event.reason;
		state.errors.push("unhandledrejection: " + String(reason && (reason.stack || reason.message) || reason));
	});

	window.confirm = () => true;

	window.Zotero = {
		debug() {},
		logError(error) {
			console.error("[Zotero.logError]", error);
		},
		AskAI: {
			PLUGIN_ID: "askai@plugin.local",
			getConfig() {
				return Object.assign({}, state.config);
			},
			saveConfig(cfg) {
				state.config = Object.assign({}, cfg);
				return this.getConfig();
			},
			resetConfig() {
				state.config = Object.assign({}, DEFAULT_CONFIG);
				return this.getConfig();
			},
			async getPaperInfo() {
				return {
					attachmentID: 42,
					itemID: 7,
					title: "Reading Papers with Full-Text Context",
					creators: ["Ada Lovelace", "Alan Turing"],
					year: "2024",
					venue: "Journal of Testing",
					doi: "10.0000/test",
					libraryID: 1,
					isRegularItem: true,
					contentType: "application/pdf",
					filename: "test.pdf",
					hasAttachment: true
				};
			},
			async getPaperText() {
				return {
					text: state.text,
					totalPages: 6,
					source: "pdf",
					attachmentID: 42,
					extractedAt: Date.now()
				};
			},
			open() {}
		},
		Prefs: {
			get() {},
			set() {}
		},
		Utilities: {
			Internal: {
				copyTextToClipboard(text) {
					state.clipboard = String(text);
				}
			}
		},
		Items: {
			get(id) {
				return {
					id,
					isRegularItem: () => true,
					getNotes: () => state.notes.map((_, index) => index)
				};
			}
		},
		Item: class MockItem {
			constructor(type) {
				this.type = type;
				this.libraryID = 1;
				this.parentID = null;
				this.noteHTML = "";
				this.id = 1000 + state.notes.length;
			}

			setNote(html) {
				this.noteHTML = html;
			}

			async saveTx() {
				state.notes.push(this);
			}
		},
		getActiveZoteroPane() {
			return null;
		},
		launchURL() {},
		HTTP: {
			async request() {
				throw new Error("Zotero.HTTP stub not available in the browser harness");
			}
		}
	};

	window.fetch = async function (url, init) {
		const body = JSON.parse((init && init.body) || "{}");
		const messages = body.messages || [];
		state.requests.push({
			url,
			model: body.model,
			stream: !!body.stream,
			messageCount: messages.length,
			system: (messages[0] && messages[0].content) || "",
			user: (messages[messages.length - 1] && messages[messages.length - 1].content) || ""
		});

		if (state.fetchMode === "error") {
			return {
				ok: false,
				status: 401,
				text: async () => JSON.stringify({ error: { message: "Invalid API key provided" } }),
				json: async () => ({})
			};
		}

		if (!body.stream) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ choices: [{ message: { content: "非流式测试回答" } }] }),
				text: async () => ""
			};
		}

		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				let i = 0;
				const push = () => {
					if (i < ANSWER_PARTS.length) {
						const chunk = {
							choices: [{ index: 0, delta: { content: ANSWER_PARTS[i] }, finish_reason: null }]
						};
						controller.enqueue(encoder.encode("data: " + JSON.stringify(chunk) + "\n\n"));
						i++;
						setTimeout(push, 25);
					}
					else {
						controller.enqueue(encoder.encode("data: " + JSON.stringify({
							choices: [],
							usage: {
								prompt_tokens: 31000,
								completion_tokens: 800,
								total_tokens: 31800,
								prompt_cache_hit_tokens: 29000,
								prompt_cache_miss_tokens: 2000
							}
						}) + "\n\n"));
						controller.enqueue(encoder.encode("data: [DONE]\n\n"));
						controller.close();
					}
				};
				setTimeout(push, 25);
			}
		});

		return {
			ok: true,
			status: 200,
			body: stream,
			text: async () => "",
			json: async () => ({})
		};
	};
})();
