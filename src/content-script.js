// Content script - bridges page and background

// Forward messages from page to background
window.addEventListener("message", async (event) => {
	if (event.source !== window) return;

	// Forward Dice rolls
	if (event.data.type === "DICE_ROLL") {
		console.log("[Stakes Stats] Forwarding dice roll to background:", event.data.roll);
		try {
			await chrome.runtime.sendMessage({
				type: "DICE_ROLL",
				roll: event.data.roll,
			});
		} catch (e) {
			console.error("[Stakes Stats] Failed to send dice message:", e);
		}
	}

	// Forward KENO rounds
	if (event.data.type === "KENO_ROUND") {
		console.log("[Stakes Stats] Forwarding KENO round to background:", event.data.round);
		try {
			await chrome.runtime.sendMessage({
				type: "KENO_ROUND",
				round: event.data.round,
			});
		} catch (e) {
			console.error("[Stakes Stats] Failed to send KENO message:", e);
		}
	}
});

// Forward actions from background to page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === "EXECUTE_ACTION") {
		console.log("[Dice Auto] Executing action:", message.action);
		window.postMessage({
			type: "DICE_EXECUTE_ACTION",
			action: message.action,
		}, "*");
		sendResponse({ success: true });
	} else if (message.type === "AUTO_STARTED") {
		window.postMessage({ type: "DICE_START_AUTO" }, "*");
		sendResponse({ success: true });
	} else if (message.type === "AUTO_STOPPED") {
		window.postMessage({ type: "DICE_STOP_AUTO" }, "*");
		sendResponse({ success: true });
	} else if (message.type === "UPDATE_HEATMAP") {
		window.postMessage({
			type: "DICE_UPDATE_HEATMAP",
			rangeHits: message.rangeHits,
			rangeSinceLastHit: message.rangeSinceLastHit,
			totalRolls: message.totalRolls,
		}, "*");
		sendResponse({ success: true });
	} else if (message.type === "TOGGLE_HEATMAP") {
		window.postMessage({
			type: "DICE_TOGGLE_HEATMAP",
			enabled: message.enabled,
		}, "*");
		sendResponse({ success: true });
	}
	// KENO heatmap messages
	else if (message.type === "UPDATE_KENO_HEATMAP") {
		window.postMessage({
			type: "KENO_UPDATE_HEATMAP",
			numberHits: message.numberHits,
			numberSinceLastHit: message.numberSinceLastHit,
			totalRounds: message.totalRounds,
		}, "*");
		sendResponse({ success: true });
	} else if (message.type === "TOGGLE_KENO_HEATMAP") {
		window.postMessage({
			type: "KENO_TOGGLE_HEATMAP",
			enabled: message.enabled,
		}, "*");
		sendResponse({ success: true });
	}
	// KENO recommendations messages
	else if (message.type === "UPDATE_KENO_RECOMMENDATIONS") {
		window.postMessage({
			type: "KENO_UPDATE_RECOMMENDATIONS",
			recommendations: message.recommendations,
			tier: message.tier, // "premium", "free", or "offline"
		}, "*");
		sendResponse({ success: true });
	} else if (message.type === "PREMIUM_STATUS_CHANGED") {
		window.postMessage({
			type: "KENO_PREMIUM_STATUS_CHANGED",
			isPremium: message.isPremium,
		}, "*");
		sendResponse({ success: true });
	} else if (message.type === "TOGGLE_KENO_BADGES") {
		window.postMessage({
			type: "KENO_TOGGLE_BADGES",
			enabled: message.enabled,
		}, "*");
		sendResponse({ success: true });
	} else if (message.type === "KENO_AUTOFILL") {
		console.log("[KENO Autofill] Content script received:", message.numbers);
		window.postMessage({
			type: "KENO_AUTOFILL",
			numbers: message.numbers,
		}, "*");
		console.log("[KENO Autofill] Posted to page window");
		sendResponse({ success: true });
	}
	// KENO autoplay messages
	else if (message.type === "KENO_START_AUTO") {
		window.postMessage({
			type: "KENO_START_AUTO",
			settings: message.settings,
		}, "*");
		sendResponse({ success: true });
	} else if (message.type === "KENO_STOP_AUTO") {
		window.postMessage({
			type: "KENO_STOP_AUTO",
		}, "*");
		sendResponse({ success: true });
	}
	return true;
});

console.log("[Stakes Stats] Content script loaded");
