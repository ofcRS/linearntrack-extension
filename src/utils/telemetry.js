const API_BASE_URL = "https://linearntrack.com/api";

async function getDeviceId() {
	const data = await chrome.storage.local.get(["deviceId"]);
	if (data.deviceId) return data.deviceId;
	const deviceId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
	await chrome.storage.local.set({ deviceId });
	return deviceId;
}

async function sendTelemetry(event, data = null) {
	try {
		const deviceId = await getDeviceId();
		await fetch(`${API_BASE_URL}/telemetry`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				deviceId,
				event,
				data,
				version: chrome.runtime.getManifest().version,
			}),
		});
	} catch (e) {
		// Silent fail - telemetry shouldn't break the extension
	}
}

export function trackInstall() {
	sendTelemetry("extension_installed");
}

export function trackPopupOpened() {
	sendTelemetry("extension_opened");
}

export function trackGameDetected(game) {
	sendTelemetry("game_detected", { game });
}

export function trackRound(game) {
	sendTelemetry("round_tracked", { game });
}

export function trackProActivated() {
	sendTelemetry("pro_activated");
}

export function trackAutofillUsed() {
	sendTelemetry("autofill_used");
}

export function trackAiPicksViewed() {
	sendTelemetry("ai_picks_viewed");
}

export function trackHeatmapOpened(game) {
	sendTelemetry("heatmap_opened", { game });
}

export function trackError(error) {
	sendTelemetry("error", { message: error?.message || String(error) });
}
