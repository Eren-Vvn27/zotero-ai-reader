/*
 * AI 论文助手 (Zotero Ask AI) - plugin logic
 *
 * Runs in the plugin sandbox (has Zotero + Services). Responsibilities:
 *   - add a "问 AI" button to the reader text-selection popup
 *   - extract the full paper text (PDFWorker, with full-text cache fallback)
 *   - manage the chat window (single instance, receives selections)
 *   - menus (Tools / item context menu)
 *   - preferences access for the window
 */

(function (global) {
	"use strict";

	const g = global || (typeof _globalThis !== "undefined" ? _globalThis : this);
	const Zotero = g.Zotero;
	const Services = g.Services;

	const PLUGIN_ID = g.pluginID || "askai@plugin.local";
	const ROOT_URI = g.rootURI || "";
	const PREFIX = "extensions.zotero.askai.";
	const WINDOW_URL = "chrome://askai/content/askai.xhtml";
	const WINDOW_NAME = "askai-window";
	const WINDOW_TYPE = "askai:window";
	const CACHE_TTL_MS = 30 * 60 * 1000;

	const DEFAULT_QUESTION = "请结合论文全文，解释我选中的这段内容：它是什么意思、在论文中起什么作用、与上下文和论文核心论点有什么关系？如果涉及公式、实验或数据，请补充必要的背景。";

	const DEFAULTS = {
		enabled: true,
		endpoint: "https://api.deepseek.com",
		apiKey: "",
		model: "deepseek-flash",
		provider: "deepseek",
		thinking: "auto",
		reasoningEffort: "high",
		panelWidth: "380",
		temperature: "0.3",
		maxTokens: "0",
		maxContextChars: "100000",
		stream: true,
		autoSend: false,
		language: "auto",
		defaultQuestion: DEFAULT_QUESTION,
		systemPrompt: "",
		extraHeaders: "",
		debug: false
	};

	const textCache = new Map();
	let winRef = null;
	let selectionHandler = null;
	let pendingPayload = null;

	/**
	 * Report a failure to Zotero's debug output and the browser console, so the
	 * user can see it in whichever console they have open.
	 */
	function debugError(where, error) {
		try {
			Zotero.logError(error);
		}
		catch (e) {
			// ignore
		}
		try {
			if (g.console && g.console.error) {
				g.console.error("[askai] " + where + " failed", error);
			}
		}
		catch (e) {
			// ignore
		}
	}

	const AskAI = {
		id: PLUGIN_ID,

		/* ------------------------------------------------------------ prefs */

		getPref(key) {
			try {
				const value = Zotero.Prefs.get(PREFIX + key);
				return value === undefined ? DEFAULTS[key] : value;
			}
			catch (e) {
				return DEFAULTS[key];
			}
		},

		setPref(key, value) {
			try {
				Zotero.Prefs.set(PREFIX + key, value);
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		getDefaultConfig() {
			return {
				enabled: DEFAULTS.enabled,
				endpoint: DEFAULTS.endpoint,
				apiKey: DEFAULTS.apiKey,
				model: DEFAULTS.model,
				provider: DEFAULTS.provider,
				thinking: DEFAULTS.thinking,
				reasoningEffort: DEFAULTS.reasoningEffort,
				temperature: parseFloat(DEFAULTS.temperature),
				maxTokens: parseInt(DEFAULTS.maxTokens, 10) || 0,
				maxContextChars: parseInt(DEFAULTS.maxContextChars, 10) || 100000,
				stream: DEFAULTS.stream,
				autoSend: DEFAULTS.autoSend,
				language: DEFAULTS.language,
				defaultQuestion: DEFAULTS.defaultQuestion,
				systemPrompt: DEFAULTS.systemPrompt,
				extraHeaders: DEFAULTS.extraHeaders,
				debug: DEFAULTS.debug
			};
		},

		getConfig() {
			const temperature = parseFloat(this.getPref("temperature"));
			const maxTokens = parseInt(this.getPref("maxTokens"), 10);
			const maxContextChars = parseInt(this.getPref("maxContextChars"), 10);
			return {
				enabled: !!this.getPref("enabled"),
				endpoint: String(this.getPref("endpoint") || "").trim(),
				apiKey: String(this.getPref("apiKey") || "").trim(),
				model: String(this.getPref("model") || "").trim(),
				provider: String(this.getPref("provider") || "custom"),
				thinking: String(this.getPref("thinking") || "auto"),
				reasoningEffort: String(this.getPref("reasoningEffort") || "high"),
				temperature: Number.isFinite(temperature) ? temperature : 0.3,
				maxTokens: Number.isFinite(maxTokens) ? maxTokens : 0,
				maxContextChars: Number.isFinite(maxContextChars) ? maxContextChars : 100000,
				stream: !!this.getPref("stream"),
				autoSend: !!this.getPref("autoSend"),
				language: String(this.getPref("language") || "auto"),
				defaultQuestion: String(this.getPref("defaultQuestion") || DEFAULT_QUESTION),
				systemPrompt: String(this.getPref("systemPrompt") || ""),
				extraHeaders: String(this.getPref("extraHeaders") || ""),
				debug: !!this.getPref("debug")
			};
		},

		saveConfig(config) {
			const cfg = config || {};
			this.setPref("endpoint", String(cfg.endpoint || "").trim());
			this.setPref("apiKey", String(cfg.apiKey || "").trim());
			this.setPref("model", String(cfg.model || "").trim());
			this.setPref("provider", String(cfg.provider || "custom"));
			this.setPref("thinking", String(cfg.thinking || "auto"));
			this.setPref("reasoningEffort", String(cfg.reasoningEffort || "high"));
			this.setPref("temperature", String(Number.isFinite(Number(cfg.temperature)) ? Number(cfg.temperature) : 0.3));
			this.setPref("maxTokens", String(Math.max(0, parseInt(cfg.maxTokens, 10) || 0)));
			this.setPref("maxContextChars", String(Math.max(4000, parseInt(cfg.maxContextChars, 10) || 100000)));
			this.setPref("stream", !!cfg.stream);
			this.setPref("autoSend", !!cfg.autoSend);
			this.setPref("language", String(cfg.language || "auto"));
			this.setPref("defaultQuestion", String(cfg.defaultQuestion || ""));
			this.setPref("systemPrompt", String(cfg.systemPrompt || ""));
			this.setPref("extraHeaders", String(cfg.extraHeaders || ""));
			this.setPref("debug", !!cfg.debug);
			return this.getConfig();
		},

		resetConfig() {
			this.setPref("endpoint", DEFAULTS.endpoint);
			this.setPref("apiKey", "");
			this.setPref("model", DEFAULTS.model);
			this.setPref("provider", DEFAULTS.provider);
			this.setPref("thinking", DEFAULTS.thinking);
			this.setPref("reasoningEffort", DEFAULTS.reasoningEffort);
			this.setPref("temperature", DEFAULTS.temperature);
			this.setPref("maxTokens", DEFAULTS.maxTokens);
			this.setPref("maxContextChars", DEFAULTS.maxContextChars);
			this.setPref("stream", DEFAULTS.stream);
			this.setPref("autoSend", DEFAULTS.autoSend);
			this.setPref("language", DEFAULTS.language);
			this.setPref("defaultQuestion", DEFAULTS.defaultQuestion);
			this.setPref("systemPrompt", DEFAULTS.systemPrompt);
			this.setPref("extraHeaders", DEFAULTS.extraHeaders);
			this.setPref("debug", DEFAULTS.debug);
			return this.getConfig();
		},

		getPanelWidth() {
			const width = parseInt(this.getPref("panelWidth"), 10);
			return Number.isFinite(width) ? Math.max(300, Math.min(720, width)) : 380;
		},

		setPanelWidth(width) {
			this.setPref("panelWidth", String(Math.max(300, Math.min(720, parseInt(width, 10) || 380))));
		},

		/* ------------------------------------------------------------ papers */

		/**
		 * Resolve metadata for the paper behind an attachment / regular item.
		 */
		async getPaperInfo(itemOrID) {
			const item = typeof itemOrID === "number" || typeof itemOrID === "string"
				? await Zotero.Items.getAsync(parseInt(itemOrID, 10))
				: itemOrID;
			if (!item) throw new Error("找不到该条目，可能已被删除。");

			let attachment = null;
			let parent = null;

			if (item.isAttachment && item.isAttachment()) {
				attachment = item;
				parent = item.parentID ? await Zotero.Items.getAsync(item.parentID) : null;
			}
			else {
				parent = item;
				try {
					const best = await item.getBestAttachment();
					attachment = best || null;
				}
				catch (e) {
					Zotero.logError(e);
				}
			}

			if (!attachment) {
				throw new Error("这篇文献没有可读取的附件。请先为它添加 PDF 附件。");
			}

			const metaItem = parent || attachment;
			const creators = (metaItem.getCreators ? metaItem.getCreators() : [])
				.map((creator) => {
					if (creator.name) return creator.name;
					return [creator.firstName, creator.lastName].filter(Boolean).join(" ");
				})
				.filter(Boolean);

			const date = metaItem.getField ? (metaItem.getField("date") || "") : "";
			const yearMatch = String(date).match(/\d{4}/);

			return {
				attachmentID: attachment.id,
				itemID: metaItem.id,
				title: (metaItem.getField && metaItem.getField("title"))
					|| (attachment.getField && attachment.getField("title"))
					|| "未命名文献",
				creators,
				year: yearMatch ? yearMatch[0] : "",
				venue: (metaItem.getField && (metaItem.getField("publicationTitle")
					|| metaItem.getField("proceedingsTitle")
					|| metaItem.getField("bookTitle")))
					|| "",
				doi: (metaItem.getField && metaItem.getField("DOI")) || "",
				libraryID: metaItem.libraryID,
				isRegularItem: !!(metaItem.isRegularItem && metaItem.isRegularItem()),
				contentType: attachment.attachmentContentType || "",
				filename: attachment.attachmentFilename || "",
				hasAttachment: true
			};
		},

		/**
		 * Extract (and cache) the full text of a paper attachment.
		 * Returns { text, totalPages, source, attachmentID }.
		 */
		async getPaperText(itemOrID, { force = false } = {}) {
			const item = typeof itemOrID === "number" || typeof itemOrID === "string"
				? await Zotero.Items.getAsync(parseInt(itemOrID, 10))
				: itemOrID;
			if (!item) throw new Error("找不到附件。");

			const cached = textCache.get(item.id);
			if (!force && cached && Date.now() - cached.time < CACHE_TTL_MS) {
				return cached.data;
			}

			let text = "";
			let totalPages = 0;
			let source = "";

			const isPDF = item.isPDFAttachment
				? item.isPDFAttachment()
				: /pdf/i.test(item.attachmentContentType || "");

			if (isPDF) {
				try {
					const result = await Zotero.PDFWorker.getFullText(item.id, null);
					text = result.text || "";
					totalPages = result.totalPages || 0;
					source = "pdf";
				}
				catch (e) {
					Zotero.logError(e);
				}
			}

			if (!text) {
				try {
					const cacheFile = Zotero.Fulltext.getItemCacheFile(item);
					if (cacheFile && cacheFile.exists()) {
						text = await Zotero.File.getContentsAsync(cacheFile.path);
						source = "fulltext-cache";
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}

			if (!text) {
				try {
					const path = await item.getFilePathAsync();
					if (path && /\.(txt|md|markdown|html?)$/i.test(path)) {
						text = await Zotero.File.getContentsAsync(path);
						if (/\.html?$/i.test(path)) text = stripHTML(text);
						source = "file";
					}
				}
				catch (e) {
					// ignore
				}
			}

			const data = {
				text: normalizeExtractedText(text),
				totalPages,
				source,
				attachmentID: item.id,
				extractedAt: Date.now()
			};
			textCache.set(item.id, { time: Date.now(), data });
			return data;
		},

		clearTextCache() {
			textCache.clear();
		},

		/* ------------------------------------------------------------ window */

		getWindow() {
			if (winRef && !winRef.closed) return winRef;
			winRef = null;
			try {
				const enumerator = Services.wm.getEnumerator(WINDOW_TYPE);
				while (enumerator.hasMoreElements()) {
					const win = enumerator.getNext();
					if (win && !win.closed) {
						winRef = win;
						return win;
					}
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
			return null;
		},

		open(payload) {
			const existing = this.getWindow();
			if (existing) {
				try {
					existing.focus();
					if (existing.AskAIApp && existing.AskAIApp.receive) {
						existing.AskAIApp.receive(payload || {});
					}
					else {
						// Window is still loading; let it consume the payload on init.
						pendingPayload = payload || {};
					}
				}
				catch (e) {
					Zotero.logError(e);
					pendingPayload = payload || {};
				}
				return existing;
			}

			const mainWindow = Zotero.getMainWindow();
			if (!mainWindow) {
				throw new Error("Zotero 主窗口不可用，请稍后重试。");
			}

			const win = mainWindow.openDialog(
				WINDOW_URL,
				WINDOW_NAME,
				"chrome,centerscreen,resizable,dialog=no,width=620,height=840",
				payload || {}
			);
			winRef = win;
			try {
				win.addEventListener("unload", () => {
					if (winRef === win) winRef = null;
				}, { once: true });
			}
			catch (e) {
				// ignore
			}
			return win;
		},

		/**
		 * Payload queued while the chat window was still loading.
		 */
		takePendingPayload() {
			const payload = pendingPayload;
			pendingPayload = null;
			return payload;
		},

		/* ------------------------------------------------------------- menus */

		/**
		 * Open the settings view inside the chat window (used by the reader panel).
		 */
		openSettings() {
			try {
				const win = this.open({ kind: "blank" });
				const tryOpen = (attempts) => {
					if (win && win.AskAIApp && typeof win.AskAIApp.openSettings === "function") {
						win.AskAIApp.openSettings();
						return;
					}
					if (attempts > 0) {
						setTimeout(() => tryOpen(attempts - 1), 200);
					}
				};
				tryOpen(15);
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		/**
		 * Open (or focus) the in-reader side panel, optionally with selected text.
		 */
		openReaderPanel(reader, selection) {
			const win = reader._iframeWindow
				|| (reader._internalReader
					&& reader._internalReader._lastView
					&& reader._internalReader._lastView._iframeWindow);
			if (!win) {
				throw new Error("reader iframe is unavailable");
			}

			// Prefer the reader UI document (the one that owns #split-view), so the
			// panel can dock beside the PDF and shrink the viewer instead of
			// covering page content. Fall back to the PDF iframe document.
			let doc = win.document;
			try {
				const parentWin = win.parent;
				if (parentWin && parentWin !== win && parentWin.document
					&& (parentWin.document.getElementById("split-view")
						|| parentWin.document.querySelector("#split-view"))) {
					doc = parentWin.document;
				}
			}
			catch (e) {
				// keep the iframe document
			}

			let panel = win.__askaiPanel;
			if (!panel || panel.doc !== doc) {
				const factory = g.AskAIPanel;
				if (!factory) {
					throw new Error("AskAIPanel is not loaded");
				}
				if (panel) {
					try {
						panel.destroy();
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
				panel = factory.create({
					doc: doc,
					reader: reader,
					api: this
				});
				win.__askaiPanel = panel;
			}

			if (selection) {
				panel.receiveSelection(selection);
			}
			else {
				panel.toggle();
			}
		},

		registerReaderPanel() {
			if (!Zotero.Reader || typeof Zotero.Reader.registerEventListener !== "function") {
				throw new Error("Zotero.Reader.registerEventListener is unavailable");
			}
			Zotero.Reader.registerEventListener("renderToolbar", (event) => {
				try {
					const doc = event.doc;
					const reader = event.reader;
					if (!doc || !reader) return;
					const button = doc.createElement("button");
					button.type = "button";
					button.className = "toolbar-button";
					button.textContent = "AI";
					button.title = "AI 论文助手（侧栏面板）";
					button.addEventListener("click", (clickEvent) => {
						clickEvent.preventDefault();
						clickEvent.stopPropagation();
						try {
							this.openReaderPanel(reader);
						}
						catch (e) {
							debugError("reader panel", e);
						}
					});
					event.append(button);
				}
				catch (e) {
					Zotero.logError(e);
				}
			}, PLUGIN_ID);
			Zotero.debug("[askai] reader toolbar button registered");
		},

		registerReaderButton() {
			if (selectionHandler) return;
			if (!Zotero.Reader || typeof Zotero.Reader.registerEventListener !== "function") {
				throw new Error("Zotero.Reader.registerEventListener is unavailable");
			}
			selectionHandler = (event) => {
				try {
					if (!this.getPref("enabled")) return;
					const params = event.params || {};
					const annotation = params.annotation || {};
					const text = String(annotation.text || "").trim();
					if (!text) return;

					const doc = event.doc;
					const reader = event.reader;
					if (!doc || !reader) return;

					const button = doc.createElement("button");
					button.type = "button";
					button.className = "askai-popup-button";
					button.textContent = "✨ 问 AI";
					button.title = "把选中的内容发给 AI（AI 已读取论文全文）";
					button.style.cssText = [
						"width:100%",
						"height:24px",
						"margin:0",
						"padding:0 8px",
						"border:1px solid var(--fill-quinary, rgba(0,0,0,.12))",
						"border-radius:6px",
						"background:var(--material-button, #ffffff)",
						"color:var(--fill-primary, #1f2328)",
						"font:inherit",
						"font-size:12px",
						"line-height:1",
						"cursor:pointer",
						"display:flex",
						"align-items:center",
						"justify-content:center",
						"gap:4px",
						"white-space:nowrap",
						"box-shadow:0 .5px 2px rgba(0,0,0,.12)"
					].join(";");

					button.addEventListener("click", (clickEvent) => {
						clickEvent.preventDefault();
						clickEvent.stopPropagation();
						const itemID = reader.itemID || (reader._item && reader._item.id);
						if (!itemID) {
							Zotero.debug("[askai] no itemID on reader");
							return;
						}
						try {
							this.openReaderPanel(reader, text);
						}
						catch (e) {
							debugError("reader panel", e);
							try {
								this.open({
									kind: "selection",
									selection: text,
									attachmentID: itemID
								});
							}
							catch (e2) {
								Zotero.logError(e2);
							}
						}
					});

					event.append(button);
				}
				catch (e) {
					Zotero.logError(e);
				}
			};

			Zotero.Reader.registerEventListener("renderTextSelectionPopup", selectionHandler, PLUGIN_ID);
			Zotero.debug("[askai] reader selection button registered");
		},

		registerMenus() {
			if (!Zotero.MenuManager || typeof Zotero.MenuManager.registerMenu !== "function") {
				throw new Error("Zotero.MenuManager.registerMenu is unavailable");
			}

			try {
				Zotero.MenuManager.registerMenu({
					menuID: "askai-tools-open",
					pluginID: PLUGIN_ID,
					target: "main/menubar/tools",
					menus: [{
						menuType: "menuitem",
						l10nID: "askai-menu-open",
						icon: "chrome://askai/content/icons/askai-16.svg",
						onCommand: () => {
							try {
								this.open({ kind: "blank" });
							}
							catch (e) {
								Zotero.logError(e);
							}
						}
					}]
				});

				Zotero.MenuManager.registerMenu({
					menuID: "askai-item-open",
					pluginID: PLUGIN_ID,
					target: "main/library/item",
					menus: [{
						menuType: "menuitem",
						l10nID: "askai-menu-read-item",
						icon: "chrome://askai/content/icons/askai-16.svg",
						onCommand: (event, context) => {
							const items = (context && context.items) || [];
							const target = items.find((item) => item && (item.isRegularItem?.() || item.isAttachment?.()));
							if (!target) return;
							try {
								this.open({
									kind: "item",
									itemID: target.id
								});
							}
							catch (e) {
								Zotero.logError(e);
							}
						}
					}]
				});
			}
			catch (e) {
				debugError("menus", e);
				throw e;
			}
		},

		unregisterMenus() {
			if (!Zotero.MenuManager || !Zotero.MenuManager.unregisterMenu) return;
			for (const id of ["askai-tools-open", "askai-item-open"]) {
				try {
					Zotero.MenuManager.unregisterMenu(id);
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
		},

		async registerPreferences() {
			if (!Zotero.PreferencePanes || typeof Zotero.PreferencePanes.register !== "function") {
				throw new Error("Zotero.PreferencePanes.register is unavailable");
			}
			const paneID = await Zotero.PreferencePanes.register({
				pluginID: PLUGIN_ID,
				src: "chrome://askai/content/preferences.xhtml",
				id: "askai-prefpane",
				label: "AI 论文助手",
				image: "chrome://askai/content/icons/icon-48.png"
			});
			Zotero.debug("[askai] preference pane registered: " + paneID);
		},

		/* ---------------------------------------------------------- lifecycle */

		async startup() {
			// Register each entry point independently so a failure in one place
			// can never hide the others. bootstrap.js has already awaited
			// Zotero.initializationPromise.
			const steps = [
				["reader selection button", () => this.registerReaderButton()],
				["reader toolbar panel", () => this.registerReaderPanel()],
				["menus", () => this.registerMenus()],
				["preferences pane", () => this.registerPreferences()],
				["toolbar button", () => {
					for (const win of Zotero.getMainWindows()) {
						this.onMainWindowLoad(win);
					}
				}]
			];
			for (const step of steps) {
				try {
					await step[1]();
					Zotero.debug("[askai] " + step[0] + " ok");
				}
				catch (e) {
					debugError(step[0], e);
				}
			}
			Zotero.debug("[askai] startup complete (" + PLUGIN_ID + ")");
		},

		onMainWindowLoad(window) {
			try {
				const doc = window.document;
				const toolbar = doc.getElementById("zotero-items-toolbar");
				if (!toolbar || doc.getElementById("askai-tb-button")) return;
				const btn = doc.createXULElement("toolbarbutton");
				btn.id = "askai-tb-button";
				btn.className = "zotero-tb-button";
				btn.setAttribute("label", "AI 助手");
				btn.setAttribute("tooltiptext", "打开 AI 论文助手：基于论文全文问答");
				btn.setAttribute("tabindex", "-1");
				btn.addEventListener("command", () => {
					try {
						this.open({ kind: "blank" });
					}
					catch (e) {
						Zotero.logError(e);
					}
				});
				toolbar.appendChild(btn);
				Zotero.debug("[askai] toolbar button added");
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		onMainWindowUnload(window) {
			try {
				const btn = window.document.getElementById("askai-tb-button");
				if (btn) btn.remove();
			}
			catch (e) {
				// ignore
			}
		},

		async shutdown() {
			try {
				if (selectionHandler && Zotero.Reader && Zotero.Reader.unregisterEventListener) {
					Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", selectionHandler);
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
			selectionHandler = null;

			this.unregisterMenus();

			try {
				const win = this.getWindow();
				if (win) win.close();
			}
			catch (e) {
				Zotero.logError(e);
			}
			winRef = null;
			textCache.clear();

			try {
				for (const win of Zotero.getMainWindows()) {
					const btn = win.document.getElementById("askai-tb-button");
					if (btn) btn.remove();
				}
			}
			catch (e) {
				Zotero.logError(e);
			}

			try {
				delete Zotero.AskAI;
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
	};

	/* ------------------------------------------------------------- helpers */

	function normalizeExtractedText(text) {
		return String(text == null ? "" : text)
			.replace(/\r\n?/g, "\n")
			.replace(/\u0000/g, "")
			.replace(/\u00ad/g, "")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}

	function stripHTML(html) {
		return String(html || "")
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/[ \t]{2,}/g, " ")
			.trim();
	}

	AskAI.PLUGIN_ID = PLUGIN_ID;
	AskAI.ROOT_URI = ROOT_URI;
	AskAI.DEFAULT_QUESTION = DEFAULT_QUESTION;

	g.AskAI = AskAI;
	Zotero.AskAI = AskAI;
})(typeof _globalThis !== "undefined" ? _globalThis : this);
