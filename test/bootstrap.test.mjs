/*
 * Regression test: Zotero creates the bootstrap sandbox WITHOUT a `console`
 * global. Referencing `console` in bootstrap.js used to throw a
 * ReferenceError and abort startup, leaving the plugin with no UI at all.
 *
 * This test runs bootstrap.js in a sandbox that mimics Zotero's and asserts
 * that startup survives without `console`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../bootstrap.js", import.meta.url), "utf8");

function makeEnv(options = {}) {
	const calls = [];
	const env = {
		Zotero: {
			initializationPromise: Promise.resolve(),
			debug: (msg) => calls.push(["debug", msg]),
			logError: (e) => calls.push(["logError", String(e)]),
			getMainWindows: () => [],
			AskAI: options.askai
		},
		Services: {
			io: {
				newURI: (spec) => ({ spec })
			},
			scriptloader: {
				loadSubScriptWithOptions: (url, loadOptions) => {
					calls.push(["loadSubScript", url, loadOptions]);
					if (options.onLoadPlugin) options.onLoadPlugin(env);
				}
			},
			console: {
				logStringMessage: (msg) => calls.push(["console", msg])
			},
			wm: {
				getEnumerator: () => ({ hasMoreElements: () => false, getNext: () => null })
			}
		},
		IOUtils: {
			writeUTF8: async () => {}
		},
		PathUtils: {
			tempDir: "/tmp",
			join: (a, b) => a + "/" + b
		},
		ChromeUtils: {},
		Components: {
			classes: {
				"@mozilla.org/addons/addon-manager-startup;1": {
					getService: () => ({
						registerChrome: () => ({ destruct() {} })
					})
				}
			},
			interfaces: { amIAddonManagerStartup: {} }
		}
	};
	// Deliberately no `console` here: this is exactly Zotero's sandbox shape.
	return { env, calls };
}

async function boot(env) {
	const context = vm.createContext(env);
	vm.runInContext(source, context, { filename: "bootstrap.js" });
	return context;
}

test("startup does not throw when console is undefined", async () => {
	const { env, calls } = makeEnv();
	const ctx = await boot(env);

	await ctx.startup(
		{ id: "askai@plugin.local", version: "0.1.4", rootURI: "file:///plugin/" },
		1
	);

	assert.ok(
		calls.some((c) => c[0] === "loadSubScript"),
		"plugin.js should be loaded"
	);
	assert.ok(
		calls.some((c) => c[0] === "debug" && /startup/.test(c[1])),
		"startup should be logged"
	);
	assert.ok(
		calls.some((c) => c[0] === "debug" && /Zotero\.AskAI missing/.test(c[1])),
		"should reach the AskAI-missing guard instead of throwing"
	);
});

test("startup calls AskAI.startup when plugin.js registers it", async () => {
	const askaiCalls = [];
	const askai = {
		startup: async () => askaiCalls.push("startup"),
		shutdown: async () => askaiCalls.push("shutdown")
	};
	const { env } = makeEnv({
		onLoadPlugin: (sandboxEnv) => {
			sandboxEnv.Zotero.AskAI = askai;
		}
	});
	const ctx = await boot(env);

	await ctx.startup(
		{ id: "askai@plugin.local", version: "0.1.4", rootURI: "file:///plugin/" },
		1
	);

	assert.deepEqual(askaiCalls, ["startup"]);
});

test("chrome registration failure is logged but startup continues", async () => {
	const { env, calls } = makeEnv();
	env.Components.classes["@mozilla.org/addons/addon-manager-startup;1"] = {
		getService: () => ({
			registerChrome: () => {
				throw new Error("registerChrome boom");
			}
		})
	};
	const ctx = await boot(env);

	await ctx.startup(
		{ id: "askai@plugin.local", version: "0.1.4", rootURI: "file:///plugin/" },
		1
	);

	assert.ok(
		calls.some((c) => c[0] === "debug" && /chrome registration FAILED/.test(c[1])),
		"failure should be logged"
	);
	assert.ok(
		calls.some((c) => c[0] === "loadSubScript"),
		"plugin.js should still be attempted"
	);
});
