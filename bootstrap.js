/*
 * AI 论文助手 (Zotero Ask AI) - bootstrap entry point
 *
 * IMPORTANT: Zotero creates the bootstrap sandbox with a limited global set
 * (Zotero, Services, IOUtils, PathUtils, ChromeUtils, Components, ...) but
 * WITHOUT `console`. Referencing `console` directly here throws a
 * ReferenceError and aborts the whole startup, so every console access below
 * goes through safeConsole.
 *
 * Startup progress is written to %TEMP%\askai-boot.log so a failed start can
 * be diagnosed without opening any console.
 */

var chromeHandle;
var bootHistory = "";
var safeConsole = (typeof console !== "undefined" && console) ? console : null;

function bootLog(msg) {
	var line = new Date().toISOString() + " " + msg + "\n";
	bootHistory += line;
	try {
		Zotero.debug("[askai] " + msg);
	}
	catch (e) {
		// ignore
	}
	try {
		if (Services && Services.console) Services.console.logStringMessage("[askai] " + msg);
	}
	catch (e) {
		// ignore
	}
	if (safeConsole) {
		try {
			safeConsole.log("[askai] " + msg);
		}
		catch (e) {
			// ignore
		}
	}
	try {
		IOUtils.writeUTF8(PathUtils.join(PathUtils.tempDir, "askai-boot.log"), bootHistory);
	}
	catch (e) {
		// ignore
	}
}

async function flushBootLog() {
	try {
		await IOUtils.writeUTF8(PathUtils.join(PathUtils.tempDir, "askai-boot.log"), bootHistory);
	}
	catch (e) {
		// ignore
	}
}

var log = bootLog;

function install(data, reason) {
	log("install");
}

async function startup({ id, version, rootURI }, reason) {
	log("startup " + id + "@" + version + " reason=" + reason + " rootURI=" + rootURI);

	try {
		if (Zotero.initializationPromise) await Zotero.initializationPromise;
	}
	catch (e) {
		log("initializationPromise rejected: " + (e && (e.stack || e)));
	}

	// Register chrome://askai/content/ -> <plugin>/chrome/content/
	try {
		if (typeof Components === "undefined") {
			throw new Error("Components is not available in the bootstrap sandbox");
		}
		var aomStartup = Components.classes[
			"@mozilla.org/addons/addon-manager-startup;1"
		].getService(Components.interfaces.amIAddonManagerStartup);
		var manifestURI = Services.io.newURI(rootURI + "manifest.json");
		chromeHandle = aomStartup.registerChrome(manifestURI, [
			["content", "askai", rootURI + "chrome/content/"]
		]);
		log("chrome registered");
	}
	catch (e) {
		log("chrome registration FAILED: " + (e && (e.stack || e)));
	}

	// Replacing a running instance (update / re-enable) must not leak listeners.
	if (Zotero.AskAI) {
		try {
			await Zotero.AskAI.shutdown();
		}
		catch (e) {
			log("previous instance shutdown failed: " + (e && (e.stack || e)));
		}
	}

	var ctx = {
		Zotero,
		Services,
		ChromeUtils,
		rootURI,
		pluginID: id,
		pluginVersion: version
	};
	if (safeConsole) ctx.console = safeConsole;
	ctx._globalThis = ctx;

	try {
		for (const name of ["core.js", "panel.js", "plugin.js"]) {
			Services.scriptloader.loadSubScriptWithOptions(
				rootURI + "chrome/content/scripts/" + name,
				{ target: ctx, ignoreCache: true }
			);
		}
		log("scripts loaded; typeof Zotero.AskAI = " + typeof Zotero.AskAI);
	}
	catch (e) {
		log("plugin.js load FAILED: " + (e && (e.stack || e)));
		await flushBootLog();
		throw e;
	}

	if (!Zotero.AskAI) {
		log("Zotero.AskAI missing after load - aborting");
		await flushBootLog();
		return;
	}

	try {
		await Zotero.AskAI.startup({ id, version, rootURI });
		log("AskAI.startup returned");
	}
	catch (e) {
		log("AskAI.startup FAILED: " + (e && (e.stack || e)));
	}

	await flushBootLog();
}

function onMainWindowLoad({ window }, reason) {
	try {
		Zotero.AskAI?.onMainWindowLoad(window);
	}
	catch (e) {
		Zotero.logError(e);
	}
}

function onMainWindowUnload({ window }, reason) {
	try {
		Zotero.AskAI?.onMainWindowUnload(window);
	}
	catch (e) {
		Zotero.logError(e);
	}
}

async function shutdown({ id, version, rootURI }, reason) {
	log("shutdown");
	try {
		await Zotero.AskAI?.shutdown();
	}
	catch (e) {
		Zotero.logError(e);
	}
	if (chromeHandle) {
		try {
			chromeHandle.destruct();
		}
		catch (e) {
			Zotero.logError(e);
		}
		chromeHandle = null;
	}
}

function uninstall(data, reason) {
	log("uninstall");
}
