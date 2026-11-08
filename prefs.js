/* Default preferences for AI 论文助手.
 * Every key lives under extensions.zotero.askai.*
 * This file is loaded by Zotero as the plugin's default preference branch.
 */

// Master switch for the reader selection button
pref("extensions.zotero.askai.enabled", true);

// OpenAI-compatible chat completion endpoint. May be a base URL
// (https://api.deepseek.com) or a full .../chat/completions URL.
pref("extensions.zotero.askai.endpoint", "https://api.deepseek.com");
pref("extensions.zotero.askai.apiKey", "");
pref("extensions.zotero.askai.model", "deepseek-flash");
pref("extensions.zotero.askai.provider", "deepseek");

// Reader side panel width in px
pref("extensions.zotero.askai.panelWidth", "380");

// DeepSeek thinking mode: auto (provider default) / enabled / disabled
pref("extensions.zotero.askai.thinking", "auto");
// Thinking effort when enabled: low / high / max
pref("extensions.zotero.askai.reasoningEffort", "high");

// Sampling
pref("extensions.zotero.askai.temperature", "0.3");
// 0 = let the provider decide. Kept as strings so the XUL preferences pane
// can bind <textbox> controls directly to these prefs.
pref("extensions.zotero.askai.maxTokens", "0");

// How many characters of paper text may be sent per request.
// Papers under this size are sent in full; larger ones switch to retrieval.
pref("extensions.zotero.askai.maxContextChars", "100000");

// Behaviour
pref("extensions.zotero.askai.stream", true);
pref("extensions.zotero.askai.autoSend", false);
pref("extensions.zotero.askai.language", "auto");
pref("extensions.zotero.askai.defaultQuestion", "请结合论文全文，解释我选中的这段内容：它是什么意思、在论文中起什么作用、与上下文和论文核心论点有什么关系？如果涉及公式、实验或数据，请补充必要的背景。");
pref("extensions.zotero.askai.systemPrompt", "");
pref("extensions.zotero.askai.extraHeaders", "");
pref("extensions.zotero.askai.debug", false);
