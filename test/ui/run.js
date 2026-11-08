/* Runs the real AskAI UI against mocks and records assertions for headless runs. */

(async function main() {
	const state = window.__mock;
	const results = [];
	const startedAt = Date.now();

	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	async function waitFor(fn, timeout, label) {
		const deadline = Date.now() + (timeout || 10000);
		while (Date.now() < deadline) {
			try {
				if (fn()) return true;
			}
			catch (e) {
				// keep polling
			}
			await wait(40);
		}
		throw new Error("timeout: " + (label || "condition"));
	}

	function check(name, ok, detail) {
		results.push({ name, ok: !!ok, detail: detail === undefined ? "" : String(detail) });
	}

	function text(selector) {
		const el = document.querySelector(selector);
		return el ? el.textContent : "";
	}

	function finish() {
		const failed = results.filter((r) => !r.ok);
		const report = {
			passed: results.length - failed.length,
			total: results.length,
			durationMs: Date.now() - startedAt,
			failed: failed.map((r) => ({ name: r.name, detail: r.detail })),
			results,
			jsErrors: state.errors
		};

		const pre = document.createElement("pre");
		pre.id = "__results";
		pre.textContent = results.map((r) => (r.ok ? "PASS " : "FAIL ") + r.name + (r.detail ? " :: " + r.detail : "")).join("\n");
		document.body.appendChild(pre);

		const json = document.createElement("script");
		json.type = "application/json";
		json.id = "__json";
		json.textContent = JSON.stringify(report);
		document.body.appendChild(json);

		document.body.dataset.done = "1";
		document.body.dataset.results = encodeURIComponent(JSON.stringify(report));
		document.title = (failed.length ? "FAIL " : "PASS ") + report.passed + "/" + report.total;
		window.__report = report;
	}

	try {
		window.__mock.config.defaultQuestion = window.AskAICore.DEFAULT_QUESTION;

		AskAIApp.init();
		check("init: shell rendered", !!document.querySelector(".askai-header") && !!document.querySelector(".askai-composer"));
		check("init: empty state visible", !document.querySelector("#askai-empty").classList.contains("hidden"));
		check("init: root uses flex layout", getComputedStyle(document.getElementById("askai-root")).display === "flex");
		const logo = document.querySelector(".askai-logo svg");
		check("init: svg icon uses the SVG namespace", !!logo && logo.namespaceURI === "http://www.w3.org/2000/svg", logo ? logo.namespaceURI : "no svg element");

		await AskAIApp.receive({
			kind: "selection",
			selection: "This paragraph describes the core assumption of the proposed method.",
			attachmentID: 42
		});

		// autoSend defaults to false: leave the input blank and show quick prompts.
		check("selection: input left blank", AskAIApp.els.input.value === "", AskAIApp.els.input.value.slice(0, 40));
		check("selection: quick bar visible", !document.getElementById("askai-quickbar").classList.contains("hidden"));
		check("selection: selection quick chips", document.querySelectorAll(".askai-quickchip").length >= 5,
			document.querySelectorAll(".askai-quickchip").length);
		document.querySelector(".askai-quickchip").click();
		check("quick chip: fills default question", AskAIApp.els.input.value.indexOf("请结合论文全文") === 0,
			AskAIApp.els.input.value.slice(0, 20));
		AskAIApp.onSendClick();

		await waitFor(() => AskAIApp.state.turns.length === 1 && AskAIApp.state.turns[0].completed, 15000, "first answer");

		const turn = AskAIApp.state.turns[0];
		check("paper: title rendered", text("#askai-paper-title").includes("Reading Papers"), text("#askai-paper-title"));
		check("paper: chip shows pages/chars", /页/.test(text(".askai-chip")) && /字符/.test(text(".askai-chip")), text(".askai-chip"));
		check("user: selection quoted", text(".askai-bubble-user").includes("core assumption"), text(".askai-bubble-user").slice(0, 80));
		check("user: question shown", text(".askai-bubble-user").includes("请结合论文全文"), text(".askai-bubble-user").slice(-40));
		check("assistant: answer text", text(".askai-md").includes("核心假设"), text(".askai-md").slice(0, 80));
		check("assistant: markdown bold", !!document.querySelector(".askai-md strong"));
		check("assistant: markdown list", document.querySelectorAll(".askai-md li").length >= 2, document.querySelectorAll(".askai-md li").length);
		check("assistant: markdown table", !!document.querySelector(".askai-md table"));
		check("assistant: context chip", /全文/.test(text(".askai-ctx")), text(".askai-ctx"));
		check("assistant: actions visible", document.querySelectorAll(".askai-actions:not(.hidden) .askai-action").length === 4, document.querySelectorAll(".askai-actions .askai-action").length);
		check("watermark: header WN mark", !!document.querySelector(".askai-header .askai-brand-mark"));
		check("usage: displayed with cache hit", (document.querySelector(".askai-usage") || {}).textContent.indexOf("缓存命中") !== -1,
			(document.querySelector(".askai-usage") || {}).textContent);

		check("request: full text in system prompt", state.requests[0].system.includes("【第 1 页】") && state.requests[0].system.includes("【第 6 页】"));
		check("request: paper title in system prompt", state.requests[0].system.includes("Reading Papers with Full-Text Context"));
		check("request: streaming enabled", state.requests[0].stream === true);
		check("request: user message has selection", state.requests[0].user.includes("core assumption"));

		AskAIApp.openContextViewer(turn.context);
		await wait(80);
		check("context viewer: opens", !document.getElementById("askai-context").classList.contains("hidden"));
		check("context viewer: header", text(".askai-context-pre").startsWith("模式：全文"), text(".askai-context-pre").slice(0, 30));
		check("context viewer: includes page marks", text(".askai-context-pre").includes("【第 3 页】"));
		AskAIApp.closeContextViewer();

		AskAIApp.openSettings();
		await wait(80);
		check("settings: opens", !document.getElementById("askai-settings").classList.contains("hidden"));
		check("settings: endpoint prefilled", document.getElementById("askai-set-endpoint").value === state.config.endpoint, document.getElementById("askai-set-endpoint").value);
		check("settings: model prefilled", document.getElementById("askai-set-model").value === state.config.model);
		AskAIApp.els.endpoint.value = "https://example.test/v1";
		AskAIApp.saveSettings(true);
		await wait(50);
		check("settings: save persists", state.config.endpoint === "https://example.test/v1", state.config.endpoint);
		check("settings: closes after save", document.getElementById("askai-settings").classList.contains("hidden"));
		state.config.endpoint = "http://127.0.0.1:8765";

		// Composer quick controls: model / thinking / effort can be changed inline.
		check("composer: model selector exists", !!document.getElementById("askai-hint-model"));
		check("composer: thinking selector exists", !!document.getElementById("askai-hint-thinking"));
		check("composer: effort selector exists", !!document.getElementById("askai-hint-effort"));
		const thinkingSelect = document.getElementById("askai-hint-thinking");
		thinkingSelect.value = "disabled";
		thinkingSelect.dispatchEvent(new Event("change"));
		check("composer: thinking change persists", state.config.thinking === "disabled", state.config.thinking);
		const modelSelect = document.getElementById("askai-hint-model");
		modelSelect.value = "deepseek-v4-pro";
		modelSelect.dispatchEvent(new Event("change"));
		check("composer: model change persists", state.config.model === "deepseek-v4-pro", state.config.model);
		const effortSelect = document.getElementById("askai-hint-effort");
		effortSelect.value = "max";
		effortSelect.dispatchEvent(new Event("change"));
		check("composer: effort change persists", state.config.reasoningEffort === "max", state.config.reasoningEffort);
		state.config.model = "mock-model";
		state.config.thinking = "auto";
		state.config.reasoningEffort = "high";

		await AskAIApp.saveNote(turn);
		await wait(100);
		check("note: saved", state.notes.length === 1, state.notes.length);
		check("note: contains title heading", state.notes[0] && state.notes[0].noteHTML.includes("<h1>"));
		check("note: contains formatted answer", state.notes[0] && state.notes[0].noteHTML.includes("<strong>要点</strong>"));
		check("note: renders as child of paper", state.notes[0] && state.notes[0].parentID === 7, state.notes[0] && state.notes[0].parentID);

		await AskAIApp.ask("请用一句话总结方法部分", "");
		await waitFor(() => AskAIApp.state.turns.length === 2 && AskAIApp.state.turns[1].completed, 15000, "second answer");
		check("follow-up: second turn rendered", document.querySelectorAll(".askai-msg").length === 4, document.querySelectorAll(".askai-msg").length);
		check("follow-up: history grows to 4", AskAIApp.state.history.length === 4, AskAIApp.state.history.length);
		check("follow-up: history included in request", state.requests[1].messageCount === 4, state.requests[1].messageCount);

		state.config.maxContextChars = 1500;
		AskAIApp.newConversation();
		await AskAIApp.ask("核心假设是什么？", "");
		await waitFor(() => AskAIApp.state.turns.length === 1 && AskAIApp.state.turns[0].completed, 15000, "retrieval answer");
		const retrievalTurn = AskAIApp.state.turns[0];
		check("retrieval: mode used", retrievalTurn.context && retrievalTurn.context.mode === "retrieval", retrievalTurn.context && retrievalTurn.context.mode);
		check("retrieval: chunk count limited", retrievalTurn.context.chunksUsed > 0 && retrievalTurn.context.chunksUsed < retrievalTurn.context.chunksTotal);
		check("retrieval: chip label", /检索/.test(text(".askai-ctx")), text(".askai-ctx"));
		AskAIApp.openContextViewer(retrievalTurn.context);
		await wait(60);
		check("retrieval: context viewer label", text(".askai-context-pre").startsWith("模式：相关片段"), text(".askai-context-pre").slice(0, 30));
		AskAIApp.closeContextViewer();
		state.config.maxContextChars = 100000;

		state.fetchMode = "error";
		AskAIApp.newConversation();
		await AskAIApp.ask("触发一次错误", "");
		await waitFor(() => document.querySelector(".askai-error"), 8000, "error card");
		const errorTurn = AskAIApp.state.turns[0];
		check("error: captured", !!errorTurn.error && /401/.test(errorTurn.error.message), errorTurn.error && errorTurn.error.message);
		check("error: hint shown", text(".askai-error-hint").includes("API Key"), text(".askai-error-hint"));
		check("error: failed user message not kept in history", AskAIApp.state.history.length === 0, AskAIApp.state.history.length);
		state.fetchMode = "ok";

		AskAIApp.newConversation();
		await AskAIApp.ask("这篇论文的创新点是什么？", "");
		await waitFor(() => AskAIApp.state.turns.length === 1 && AskAIApp.state.turns[0].completed, 15000, "final visual answer");
		await wait(150);

		const finalView = new URLSearchParams(location.search).get("final");
		if (finalView === "settings") {
			AskAIApp.openSettings();
			await wait(120);
		}
		else if (finalView === "context") {
			AskAIApp.openContextViewer(AskAIApp.state.turns[0].context);
			await wait(120);
		}

		check("no uncaught JS errors", state.errors.length === 0, state.errors.join(" | "));

		// Reader side panel (injected into an arbitrary document)
		check("panel: factory loaded", typeof AskAIPanel !== "undefined");
		const panel = AskAIPanel.create({
			doc: document,
			reader: { itemID: 42, _item: { id: 42 } },
			api: window.Zotero.AskAI
		});
		check("panel: root appended", !!document.querySelector("#askai-reader-panel"));
		panel.show();
		await wait(200);
		check("panel: sub after show", (document.querySelector(".askai-panel-sub") || {}).textContent,
			(document.querySelector(".askai-panel-sub") || {}).textContent);
		await waitFor(() => {
			const sub = document.querySelector(".askai-panel-sub");
			return sub && sub.textContent.indexOf("Reading Papers") !== -1;
		}, 8000, "panel paper");
		check("panel: rendered", !!document.querySelector("#askai-reader-panel"));
		check("panel: paper title", (document.querySelector(".askai-panel-sub") || {}).textContent.indexOf("Reading Papers") !== -1,
			(document.querySelector(".askai-panel-sub") || {}).textContent);
		panel.receiveSelection("selected text for panel");
		check("panel: selection quick chips", document.querySelectorAll(".askai-panel-quick .askai-quickchip").length >= 5,
			document.querySelectorAll(".askai-panel-quick .askai-quickchip").length);
		check("panel: settings + close buttons", document.querySelectorAll(".askai-panel-head .askai-panel-close").length === 2, document.querySelectorAll(".askai-panel-head .askai-panel-close").length); check("panel: resizer exists", !!document.querySelector(".askai-panel-resizer"));
check("panel: default width", document.getElementById("askai-reader-panel").style.width === "380px", document.getElementById("askai-reader-panel").style.width);
const panelResizer = document.querySelector(".askai-panel-resizer");
panelResizer.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, bubbles: true }));
document.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, bubbles: true }));
document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
check("panel: width resized", parseInt(document.getElementById("askai-reader-panel").style.width, 10) > 380, document.getElementById("askai-reader-panel").style.width);
check("panel: controls present", document.querySelectorAll(".askai-panel-select").length === 3,
			document.querySelectorAll(".askai-panel-select").length);
		const panelModel = document.querySelectorAll(".askai-panel-select")[0];
		panelModel.value = "deepseek-v4-pro";
		panelModel.dispatchEvent(new Event("change"));
		check("panel: model change persists", state.config.model === "deepseek-v4-pro", state.config.model);
		state.config.model = "mock-model";
		const panelInput = document.querySelector(".askai-panel-input");
		panelInput.value = "这篇论文讲了什么？";
		document.querySelector(".askai-panel-send").click();
		await waitFor(() => {
			const usageEl = document.querySelector(".askai-panel-usage");
			return usageEl && usageEl.textContent.indexOf("本次") !== -1;
		}, 15000, "panel usage");
		check("panel: answer rendered", (document.querySelector("#askai-reader-panel .askai-md") || {}).textContent.indexOf("核心假设") !== -1);
		check("panel: cfg stream", state.config.stream, state.config.stream); const lastReq = state.requests[state.requests.length - 1]; check("panel: last request stream", lastReq && lastReq.stream, lastReq && lastReq.stream); check("panel: usage line", (document.querySelector(".askai-panel-usage") || {}).textContent, (document.querySelector(".askai-panel-usage") || {}).textContent); check("panel: usage shown", ((document.querySelector("#askai-reader-panel .askai-usage") || {}).textContent || "").indexOf("缓存命中") !== -1,
			(document.querySelector("#askai-reader-panel .askai-usage") || {}).textContent);
		panel.destroy();
		check("panel: destroyed", !document.querySelector("#askai-reader-panel"));
	}
	catch (e) {
		check("harness completed", false, e && (e.stack || e.message || e));
	}

	finish();
})();
