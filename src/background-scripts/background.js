import { DiceStrategy } from "../utils/dice-strategy";
import diceAutoplayScript from "../user-scripts/dice-autoplay.js.user.script";
import kenoStatsScript from "../user-scripts/keno-stats.js.user.script";
import {
	trackInstall,
	trackPopupOpened,
	trackGameDetected,
	trackRound,
	trackProActivated,
	trackAutofillUsed,
	trackAiPicksViewed,
	trackHeatmapOpened,
	trackError,
} from "../utils/telemetry";

const strategy = new DiceStrategy();

// API configuration
const API_BASE_URL = "https://linearntrack.com/api";
const LICENSE_CACHE_DAYS = 7;
const SESSION_HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Session state (for premium KENO access)
let currentSession = null;
let heartbeatInterval = null;

// Keno autoplay state
let kenoAutoPlayEnabled = false;
let kenoAutoSettings = { minScore: 6.0 };

// =====================
// SESSION MANAGEMENT (for premium KENO)
// =====================

async function getDeviceId() {
	const data = await chrome.storage.local.get(["deviceId"]);
	if (data.deviceId) return data.deviceId;

	// Generate new device ID
	const deviceId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
	await chrome.storage.local.set({ deviceId });
	return deviceId;
}

async function startSession() {
	try {
		const data = await chrome.storage.local.get(["premiumStatus"]);
		const licenseKey = data.premiumStatus?.licenseKey;

		if (!licenseKey) {
			console.log("[Session] No license key, skipping session start");
			return { success: false, reason: "no_license" };
		}

		const deviceId = await getDeviceId();

		const response = await fetch(`${API_BASE_URL}/session/start`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: licenseKey, deviceId }),
		});

		const result = await response.json();

		if (result.success && result.sessionToken) {
			currentSession = {
				token: result.sessionToken,
				expiresAt: result.expiresAt,
				licenseExpiresAt: result.licenseExpiresAt,
			};

			// Store in local storage for persistence
			await chrome.storage.local.set({ sessionData: currentSession });

			// Start heartbeat
			startHeartbeat();

			console.log("[Session] Started successfully, expires:", result.expiresAt);
			return { success: true, session: currentSession };
		}

		console.error("[Session] Failed to start:", result.error);
		return { success: false, error: result.error, code: result.code };
	} catch (e) {
		console.error("[Session] Start error:", e);
		return { success: false, error: "Network error" };
	}
}

async function sendHeartbeat() {
	if (!currentSession?.token) return;

	try {
		const response = await fetch(`${API_BASE_URL}/session/heartbeat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${currentSession.token}`,
			},
		});

		const result = await response.json();

		if (result.success) {
			currentSession.expiresAt = result.expiresAt;
			await chrome.storage.local.set({ sessionData: currentSession });
		} else if (result.code === "SESSION_EXPIRED") {
			// Session expired, try to restart
			console.log("[Session] Expired, attempting restart...");
			stopHeartbeat();
			await startSession();
		}
	} catch (e) {
		console.error("[Session] Heartbeat error:", e);
	}
}

function startHeartbeat() {
	stopHeartbeat();
	heartbeatInterval = setInterval(sendHeartbeat, SESSION_HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = null;
	}
}

async function endSession() {
	if (!currentSession?.token) return;

	try {
		await fetch(`${API_BASE_URL}/session/end`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${currentSession.token}`,
			},
		});
	} catch (e) {
		// Ignore errors on end
	}

	stopHeartbeat();
	currentSession = null;
	await chrome.storage.local.remove(["sessionData"]);
}

async function getSessionToken() {
	// Return current session if valid
	if (currentSession?.token) {
		const expiresAt = new Date(currentSession.expiresAt).getTime();
		if (Date.now() < expiresAt - 60000) {
			// Valid for at least 1 more minute
			return currentSession.token;
		}
	}

	// Try to restore from storage
	const data = await chrome.storage.local.get(["sessionData"]);
	if (data.sessionData?.token) {
		const expiresAt = new Date(data.sessionData.expiresAt).getTime();
		if (Date.now() < expiresAt - 60000) {
			currentSession = data.sessionData;
			startHeartbeat();
			return currentSession.token;
		}
	}

	// No valid session, try to start one
	const result = await startSession();
	return result.success ? currentSession?.token : null;
}

// Helper for empty recommendations
function createEmptyRecommendations(confidence = "low") {
	return {
		topPicks: [],
		lastUpdated: Date.now(),
		confidence,
		totalRounds: 0,
		stats: { longestCold: null, coldZones: [] },
	};
}

// Server-side KENO analysis (anonymous allowed, session optional for premium)
async function analyzeKenoServer(stats, history) {
	// Try to get session token (optional - server allows anonymous)
	const sessionToken = await getSessionToken().catch(() => null);

	try {
		const headers = { "Content-Type": "application/json" };
		if (sessionToken) {
			headers.Authorization = `Bearer ${sessionToken}`;
		}

		const response = await fetch(`${API_BASE_URL}/keno/analyze`, {
			method: "POST",
			headers,
			body: JSON.stringify({ stats, history }),
		});

		const result = await response.json();

		if (result.success) {
			// Server returns tier: "premium" (10 picks) or "free" (5 picks)
			return {
				success: true,
				recommendations: result.recommendations,
				tier: result.tier,
			};
		}

		return { success: false, error: result.error, code: result.code };
	} catch (e) {
		console.error("[KENO] Server analysis error:", e);
		return { success: false, error: "Network error" };
	}
}

// Initialize session on startup
chrome.runtime.onStartup.addListener(async () => {
	const data = await chrome.storage.local.get(["premiumStatus"]);
	if (data.premiumStatus?.isPremium) {
		startSession();
	}
});

// Also try to restore session when service worker wakes up
(async () => {
	const data = await chrome.storage.local.get(["premiumStatus", "sessionData"]);
	if (data.premiumStatus?.isPremium && data.sessionData?.token) {
		currentSession = data.sessionData;
		startHeartbeat();
	}
})();

// Server-side license key validation with caching
async function validateLicenseKey(key) {
	if (!key || typeof key !== "string") return { valid: false };

	const normalizedKey = key.toUpperCase().trim();

	// Check cache first
	const cached = await checkCachedLicense(normalizedKey);
	if (cached.valid && !cached.expired) {
		return { valid: true, cached: true };
	}

	// Validate with server
	try {
		const response = await fetch(`${API_BASE_URL}/validate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: normalizedKey }),
		});

		const data = await response.json();

		if (data.valid) {
			// Cache the valid result
			await cacheLicense(normalizedKey);
			return { valid: true, activatedAt: data.activatedAt };
		}

		return { valid: false };
	} catch (e) {
		console.error("[Stakes Stats] License validation error:", e);
		// If offline, use cached result even if expired
		if (cached.valid) {
			return { valid: true, cached: true, offline: true };
		}
		return { valid: false, error: "Network error" };
	}
}

async function checkCachedLicense(key) {
	const data = await chrome.storage.local.get(["licenseCache"]);
	const cache = data.licenseCache;

	if (!cache || cache.key !== key) {
		return { valid: false };
	}

	const now = Date.now();
	const cacheAge = now - cache.validatedAt;
	const maxAge = LICENSE_CACHE_DAYS * 24 * 60 * 60 * 1000;

	return {
		valid: true,
		expired: cacheAge > maxAge,
	};
}

async function cacheLicense(key) {
	await chrome.storage.local.set({
		licenseCache: {
			key,
			validatedAt: Date.now(),
		},
	});
}
let autoPlayEnabled = false;
const diceScriptId = "dice-autoplay-script";
const kenoScriptId = "keno-stats-script";

// Register user scripts for page injection
async function registerUserScripts() {
	try {
		await chrome.userScripts.configureWorld({ messaging: true });
		try {
			await chrome.userScripts.unregister();
		} catch (e) {
			// Ignore if nothing to unregister
		}
		await chrome.userScripts.register([
			{
				id: diceScriptId,
				matches: ["<all_urls>"],
				js: [{ code: diceAutoplayScript }],
				world: "MAIN",
			},
			{
				id: kenoScriptId,
				matches: ["<all_urls>"],
				js: [{ code: kenoStatsScript }],
				world: "MAIN",
			},
		]);
		console.log("[Stakes Stats] User scripts registered (Dice + KENO)");
	} catch (e) {
		console.error("[Stakes Stats] Failed to register user scripts:", e);
	}
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
	console.log("[Stakes Stats] Extension installed");
	await strategy.loadSettings();
	await registerUserScripts();
	await trackInstall();
});

// Initialize on browser startup
chrome.runtime.onStartup.addListener(async () => {
	console.log("[Stakes Stats] Browser started");
	await strategy.loadSettings();
	await registerUserScripts();
});

// Also register immediately in case already running
strategy.loadSettings();
registerUserScripts();

// Enable side panel on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	handleMessage(message, sender).then(sendResponse);
	return true;
});

async function handleMessage(message, sender) {
	switch (message.type) {
		case "DICE_ROLL":
			return await handleDiceRoll(message.roll, sender.tab?.id);

		case "KENO_ROUND":
			return await handleKenoRound(message.round, sender.tab?.id);

		case "GET_STATE":
			return {
				...strategy.getState(),
				autoPlayEnabled,
			};

		case "UPDATE_SETTINGS":
			await strategy.saveSettings(message.settings);
			return { success: true, settings: strategy.settings };

		case "GET_SETTINGS":
			return strategy.settings;

		case "START_AUTO": {
			autoPlayEnabled = true;
			strategy.reset();
			await strategy.loadSettings();
			// Find and notify Stake tab
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { type: "AUTO_STARTED" });
			}
			return { success: true, autoPlayEnabled };
		}

		case "STOP_AUTO": {
			autoPlayEnabled = false;
			// Notify page to stop
			const stopTabs = await chrome.tabs.query({ active: true, currentWindow: true });
			if (stopTabs[0]?.id) {
				chrome.tabs.sendMessage(stopTabs[0].id, { type: "AUTO_STOPPED" });
			}
			return { success: true, autoPlayEnabled };
		}

		case "RESET":
			strategy.reset();
			return { success: true };

		case "RESET_STATS":
			await chrome.storage.local.set({
				diceHistory: [],
				diceStats: {
					totalRolls: 0,
					wins: 0,
					losses: 0,
					totalProfit: 0,
					maxStreak: 0,
					rangeHits: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					rangeSinceLastHit: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					lastMultiplier: 2,
					lastTarget: 50,
					lastCondition: 'above',
				}
			});
			return { success: true };

		case "GET_FULL_STATS": {
			const fullData = await chrome.storage.local.get(["diceHistory", "diceStats"]);
			return {
				history: fullData.diceHistory || [],
				stats: fullData.diceStats || {},
			};
		}

		case "GET_KENO_STATS": {
			const kenoData = await chrome.storage.local.get(["kenoHistory", "kenoStats"]);
			return {
				history: kenoData.kenoHistory || [],
				stats: kenoData.kenoStats || {},
			};
		}

		case "RESET_KENO_STATS":
			await chrome.storage.local.set({
				kenoHistory: [],
				kenoStats: {
					totalRounds: 0,
					numberHits: new Array(40).fill(0),
					numberSinceLastHit: new Array(40).fill(0),
					matchDistribution: {},
					recommendations: null,
				}
			});
			return { success: true };

		case "GET_KENO_RECOMMENDATIONS": {
			const kenoData = await chrome.storage.local.get(["kenoStats", "kenoHistory"]);
			const stats = kenoData.kenoStats || {};
			const history = kenoData.kenoHistory || [];

			// Call server for ALL users (server gates data by session)
			if (stats.totalRounds > 0) {
				const serverResult = await analyzeKenoServer(stats, history);
				if (serverResult.success) {
					// Cache recommendations locally
					stats.recommendations = serverResult.recommendations;
					await chrome.storage.local.set({ kenoStats: stats });
					return {
						recommendations: serverResult.recommendations,
						tier: serverResult.tier, // "premium" or "free"
					};
				}
				// Fall back to cached if server fails
				if (stats.recommendations) {
					return { recommendations: stats.recommendations, tier: "offline" };
				}
			}

			// No data yet
			return {
				recommendations: createEmptyRecommendations(),
				tier: "free",
			};
		}

		case "GET_PREMIUM_STATUS": {
			const premiumData = await chrome.storage.local.get(["premiumStatus"]);
			return {
				isPremium: premiumData.premiumStatus?.isPremium || false,
				activatedAt: premiumData.premiumStatus?.activatedAt || null,
			};
		}

		case "SET_PREMIUM_STATUS": {
			const newStatus = {
				isPremium: message.isPremium,
				activatedAt: message.isPremium ? Date.now() : null,
				licenseKey: message.licenseKey || null,
			};
			await chrome.storage.local.set({ premiumStatus: newStatus });

			// Start or end session based on premium status
			if (message.isPremium) {
				await startSession();
			} else {
				await endSession();
			}

			// Broadcast to all tabs
			const tabs = await chrome.tabs.query({});
			for (const tab of tabs) {
				chrome.tabs.sendMessage(tab.id, {
					type: "PREMIUM_STATUS_CHANGED",
					isPremium: newStatus.isPremium,
				}).catch(() => {});
			}

			return { success: true, ...newStatus };
		}

		case "VALIDATE_LICENSE": {
			const key = message.licenseKey;
			const result = await validateLicenseKey(key);

			if (result.valid) {
				// Track PRO activation
				trackProActivated();

				// Activate premium
				const newStatus = {
					isPremium: true,
					activatedAt: result.activatedAt || Date.now(),
					licenseKey: key.toUpperCase(),
				};
				await chrome.storage.local.set({ premiumStatus: newStatus });

				// Broadcast to all tabs
				const tabs = await chrome.tabs.query({});
				for (const tab of tabs) {
					chrome.tabs.sendMessage(tab.id, {
						type: "PREMIUM_STATUS_CHANGED",
						isPremium: true,
					}).catch(() => {});
				}

				return { success: true, valid: true, ...newStatus };
			}

			return { success: false, valid: false, error: result.error || "Invalid license key" };
		}

		case "KENO_AUTOFILL": {
			// Check premium status first
			const premiumData = await chrome.storage.local.get(["premiumStatus"]);
			const isPremium = premiumData.premiumStatus?.isPremium || false;

			if (!isPremium) {
				return { success: false, error: "Premium required for autofill" };
			}

			// Forward to content script
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, {
					type: "KENO_AUTOFILL",
					numbers: message.numbers,
				}).catch(() => {});
				// Track autofill usage
				trackAutofillUsed();
				return { success: true };
			}

			return { success: false, error: "No active tab found" };
		}

		// Telemetry events from popup
		case "TRACK_POPUP_OPENED":
			trackPopupOpened();
			return { success: true };

		case "TRACK_AI_PICKS_VIEWED":
			trackAiPicksViewed();
			return { success: true };

		case "TRACK_HEATMAP_OPENED":
			trackHeatmapOpened(message.game || "unknown");
			return { success: true };

		case "START_KENO_AUTO": {
			kenoAutoPlayEnabled = true;
			kenoAutoSettings = message.settings || { minScore: 6.0 };
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, {
					type: "KENO_START_AUTO",
					settings: kenoAutoSettings,
				}).catch(() => {});
			}
			// Broadcast state update
			chrome.runtime.sendMessage({
				type: "KENO_AUTO_STATE_UPDATE",
				isAutoPlaying: true,
			}).catch(() => {});
			return { success: true };
		}

		case "STOP_KENO_AUTO": {
			kenoAutoPlayEnabled = false;
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, {
					type: "KENO_STOP_AUTO",
				}).catch(() => {});
			}
			// Broadcast state update
			chrome.runtime.sendMessage({
				type: "KENO_AUTO_STATE_UPDATE",
				isAutoPlaying: false,
			}).catch(() => {});
			return { success: true };
		}

		case "GET_KENO_AUTO_STATE":
			return { isAutoPlaying: kenoAutoPlayEnabled, settings: kenoAutoSettings };

		default:
			return { error: "Unknown message type" };
	}
}

async function handleDiceRoll(roll, tabId) {
	// Track round (batched - only sends every 100 rounds)
	trackRound("dice");

	// Always store stats, even if autoplay is off
	const stats = await storeRollStats(roll, { consecutiveLosses: 0, action: 'MANUAL' });

	// Send heatmap update to the page
	if (tabId) {
		chrome.tabs.sendMessage(tabId, {
			type: "UPDATE_HEATMAP",
			rangeHits: stats.rangeHits,
			rangeSinceLastHit: stats.rangeSinceLastHit,
			totalRolls: stats.totalRolls,
		}).catch(() => {});
	}

	// Update detected values from roll
	strategy.updateDetected(roll);

	if (!autoPlayEnabled) {
		// Broadcast state update even when disabled (for stats display)
		chrome.runtime.sendMessage({
			type: "STATE_UPDATE",
			state: { ...strategy.getState(), autoPlayEnabled: false },
			stats: stats,
		}).catch(() => {});
		return { action: "DISABLED" };
	}

	const result = strategy.processRoll(roll.result, roll.won, roll.betAmount);

	console.log("[Dice Auto] Roll processed:", result);

	// Update stored stats with action
	const updatedStats = await storeRollStats(roll, result);

	// Send action to content script to execute
	if (tabId && autoPlayEnabled) {
		// Small delay before next action
		setTimeout(() => {
			chrome.tabs.sendMessage(tabId, {
				type: "EXECUTE_ACTION",
				action: result,
			});
		}, 500);
	}

	// Broadcast state update
	chrome.runtime.sendMessage({
		type: "STATE_UPDATE",
		state: strategy.getState(),
		lastAction: result,
		stats: updatedStats,
	}).catch(() => {});

	return result;
}

async function storeRollStats(roll, result) {
	const data = await chrome.storage.local.get(["diceHistory", "diceStats"]);
	const history = data.diceHistory || [];
	const stats = data.diceStats || {
		totalRolls: 0,
		wins: 0,
		losses: 0,
		totalProfit: 0,
		maxStreak: 0,
		// Range tracking (10 ranges: 0-10, 10-20, ..., 90-100)
		rangeHits: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		rangeSinceLastHit: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		// Current detected settings
		lastMultiplier: 2,
		lastTarget: 50,
		lastCondition: 'above',
	};

	// Ensure arrays exist (for migration from old data)
	if (!stats.rangeHits) stats.rangeHits = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	if (!stats.rangeSinceLastHit) stats.rangeSinceLastHit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

	// Calculate which range the result falls into (0-9)
	const rangeIndex = Math.min(9, Math.floor(roll.result / 10));

	// Update range tracking
	stats.rangeHits[rangeIndex]++;
	// Increment all "since last hit" counters, then reset the one that hit
	for (let i = 0; i < 10; i++) {
		stats.rangeSinceLastHit[i]++;
	}
	stats.rangeSinceLastHit[rangeIndex] = 0;

	// Store roll in history with full data
	history.push({
		timestamp: Date.now(),
		result: roll.result,
		target: roll.target,
		condition: roll.condition,
		multiplier: roll.multiplier || 2,
		won: roll.won,
		betAmount: roll.betAmount,
		payout: roll.payout,
		action: result.action,
	});

	// Keep only last 1000 rolls
	if (history.length > 1000) {
		history.shift();
	}

	stats.totalRolls++;
	if (roll.won) {
		stats.wins++;
		stats.totalProfit += roll.payout || roll.betAmount;
	} else {
		stats.losses++;
		stats.totalProfit -= roll.betAmount;
	}

	if (result.consecutiveLosses > stats.maxStreak) {
		stats.maxStreak = result.consecutiveLosses;
	}

	// Update last detected settings
	if (roll.multiplier) stats.lastMultiplier = roll.multiplier;
	if (roll.target) stats.lastTarget = roll.target;
	if (roll.condition) stats.lastCondition = roll.condition;

	await chrome.storage.local.set({ diceHistory: history, diceStats: stats });

	// Return stats for potential heatmap update
	return stats;
}

// KENO handlers
async function handleKenoRound(round, tabId) {
	// Track round (batched - only sends every 100 rounds)
	trackRound("keno");

	// Store KENO stats
	const stats = await storeKenoStats(round);

	// Get history for analyzer
	const data = await chrome.storage.local.get(["kenoHistory"]);
	const history = data.kenoHistory || [];

	// Call server for ALL users (server gates data by session)
	let recommendations = createEmptyRecommendations();
	let tier = "free";

	if (stats.totalRounds > 0) {
		const serverResult = await analyzeKenoServer(stats, history);
		if (serverResult.success) {
			recommendations = serverResult.recommendations;
			tier = serverResult.tier;
			stats.recommendations = recommendations;
			await chrome.storage.local.set({ kenoStats: stats });
		} else if (stats.recommendations) {
			// Use cached recommendations if server fails
			recommendations = stats.recommendations;
			tier = "offline";
		}
	}

	// Send heatmap update to the page (works for all users)
	if (tabId) {
		chrome.tabs.sendMessage(tabId, {
			type: "UPDATE_KENO_HEATMAP",
			numberHits: stats.numberHits,
			numberSinceLastHit: stats.numberSinceLastHit,
			totalRounds: stats.totalRounds,
		}).catch(() => {});

		// Send recommendations update for tile badges (all users get server-gated data)
		chrome.tabs.sendMessage(tabId, {
			type: "UPDATE_KENO_RECOMMENDATIONS",
			recommendations: recommendations,
			tier: tier,
		}).catch(() => {});
	}

	// Broadcast state update for popup
	chrome.runtime.sendMessage({
		type: "KENO_STATE_UPDATE",
		stats: stats,
		recommendations: recommendations,
		tier: tier,
	}).catch(() => {});

	return { success: true, stats, recommendations, tier };
}

async function storeKenoStats(round) {
	const data = await chrome.storage.local.get(["kenoHistory", "kenoStats"]);
	const history = data.kenoHistory || [];
	const stats = data.kenoStats || {
		totalRounds: 0,
		numberHits: new Array(40).fill(0),
		numberSinceLastHit: new Array(40).fill(0),
		matchDistribution: {},
	};

	// Ensure arrays exist (for migration)
	if (!stats.numberHits || stats.numberHits.length !== 40) {
		stats.numberHits = new Array(40).fill(0);
	}
	if (!stats.numberSinceLastHit || stats.numberSinceLastHit.length !== 40) {
		stats.numberSinceLastHit = new Array(40).fill(0);
	}
	if (!stats.matchDistribution) stats.matchDistribution = {};

	// Increment all "since last hit" counters
	for (let i = 0; i < 40; i++) {
		stats.numberSinceLastHit[i]++;
	}

	// Update stats for each drawn number (already 0-39 indexed)
	for (const num of round.drawnNumbers) {
		if (num >= 0 && num < 40) {
			stats.numberHits[num]++;
			stats.numberSinceLastHit[num] = 0; // Reset since it was drawn
		}
	}

	// Track match distribution
	const matches = round.matches;
	stats.matchDistribution[matches] = (stats.matchDistribution[matches] || 0) + 1;

	// Store round in history
	history.push({
		timestamp: Date.now(),
		drawnNumbers: round.drawnNumbers,
		selectedNumbers: round.selectedNumbers,
		matches: round.matches,
		risk: round.risk,
		betAmount: round.betAmount,
		payout: round.payout,
		payoutMultiplier: round.payoutMultiplier,
	});

	// Keep only last 1000 rounds
	if (history.length > 1000) {
		history.shift();
	}

	stats.totalRounds++;

	await chrome.storage.local.set({ kenoHistory: history, kenoStats: stats });

	return stats;
}
