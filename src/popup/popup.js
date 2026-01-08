// Popup script

let currentGame = 'keno';
let isPremium = false;

async function loadState() {
	try {
		const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
		updateUI(state);
	} catch (e) {
		console.error("Failed to load state:", e);
	}
}

async function loadSettings() {
	try {
		const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
		document.getElementById("loss-threshold").value = settings.lossThreshold;
		document.getElementById("max-doubles").value = settings.maxDoubles;
		document.getElementById("base-bet").value = settings.baseBet.toFixed(8);
	} catch (e) {
		console.error("Failed to load settings:", e);
	}
}

async function loadStats() {
	try {
		const data = await chrome.storage.local.get(["diceStats"]);
		const stats = data.diceStats || {
			totalRolls: 0,
			wins: 0,
			maxStreak: 0,
			totalProfit: 0,
		};
		document.getElementById("total-rolls").textContent = stats.totalRolls;
		document.getElementById("total-wins").textContent = stats.wins;
		document.getElementById("max-streak").textContent = stats.maxStreak;
		document.getElementById("profit").textContent = stats.totalProfit.toFixed(8);
	} catch (e) {
		console.error("Failed to load stats:", e);
	}
}

// Load KENO stats UI (without re-fetching recommendations)
async function loadKenoStatsOnly() {
	try {
		const data = await chrome.storage.local.get(["kenoStats"]);
		const stats = data.kenoStats || {
			totalRounds: 0,
			numberHits: new Array(40).fill(0),
			numberSinceLastHit: new Array(40).fill(0),
			matchDistribution: {},
		};

		document.getElementById("keno-total-rounds").textContent = stats.totalRounds;

		// Find coldest numbers (top 10 by sinceLastHit) - data is 0-39, display as 1-40
		const coldestList = document.getElementById("keno-coldest");
		if (stats.totalRounds > 0 && stats.numberSinceLastHit) {
			const numbered = stats.numberSinceLastHit.map((since, idx) => ({
				num: idx + 1, // Display as 1-40
				since
			}));
			numbered.sort((a, b) => b.since - a.since);
			const top10 = numbered.slice(0, 10);

			coldestList.innerHTML = top10.map(item => {
				const isVeryHot = item.since > 16 ? '' : item.since > 8 ? 'warm' : '';
				return `<span class="cold-item ${isVeryHot}">${item.num} (${item.since})</span>`;
			}).join('');
		} else {
			coldestList.innerHTML = '<span class="cold-item">-</span>';
		}

		// Match distribution
		const matchDistEl = document.getElementById("keno-match-dist");
		if (stats.matchDistribution && Object.keys(stats.matchDistribution).length > 0) {
			const entries = Object.entries(stats.matchDistribution)
				.map(([matches, count]) => ({ matches: parseInt(matches), count }))
				.sort((a, b) => a.matches - b.matches);

			matchDistEl.innerHTML = entries.map(e =>
				`<span class="match-item">${e.matches}m: <span class="count">${e.count}</span></span>`
			).join('');
		} else {
			matchDistEl.innerHTML = '<span>No data yet</span>';
		}
	} catch (e) {
		console.error("Failed to load KENO stats:", e);
	}
}

async function loadKenoStats() {
	await loadKenoStatsOnly();
	// Load AI Picks
	await loadKenoRecommendations();
}

async function loadKenoRecommendations() {
	const picksList = document.getElementById("picks-list");
	const confidenceEl = document.getElementById("picks-confidence");
	const autofillBtn = document.getElementById("autofill-picks");

	// Disable autofill button while loading
	if (autofillBtn) autofillBtn.disabled = true;

	try {
		// Show loading state
		picksList.innerHTML = '<div class="picks-loading">Loading recommendations...</div>';
		confidenceEl.textContent = 'Connecting...';

		const result = await chrome.runtime.sendMessage({ type: "GET_KENO_RECOMMENDATIONS" });
		const { recommendations, tier, error } = result;

		// Update isPremium based on tier for UI updates
		isPremium = tier === "premium";
		updatePremiumUI();

		// Handle errors
		if (error) {
			picksList.innerHTML = '<div class="picks-error">Failed to load. Try refreshing.</div>';
			confidenceEl.textContent = 'Offline';
			// Re-enable button if premium (even on error, cached data might be available)
			if (autofillBtn && isPremium) autofillBtn.disabled = false;
			return;
		}

		renderRecommendations(recommendations, tier);
		// Re-enable button after successful load (only for premium users)
		if (autofillBtn && isPremium) autofillBtn.disabled = false;
	} catch (e) {
		console.error("Failed to load recommendations:", e);
		picksList.innerHTML = '<div class="picks-error">Failed to load. Try refreshing.</div>';
		// Re-enable button on error for premium users
		if (autofillBtn && isPremium) autofillBtn.disabled = false;
	}
}

function renderRecommendations(recommendations, tier = "free") {
	const picksList = document.getElementById("picks-list");
	const confidenceEl = document.getElementById("picks-confidence");

	// Store for autofill
	currentRecommendations = recommendations;

	if (!recommendations || !recommendations.topPicks || recommendations.topPicks.length === 0) {
		picksList.innerHTML = '<div class="picks-empty">Play some rounds to get recommendations</div>';
		confidenceEl.textContent = 'Confidence: -';
		return;
	}

	// Track AI picks viewed
	chrome.runtime.sendMessage({ type: "TRACK_AI_PICKS_VIEWED" }).catch(() => {});

	// Update confidence badge
	const confidenceClass = recommendations.confidence === 'high' ? 'high' :
		recommendations.confidence === 'medium' ? 'medium' : 'low';
	confidenceEl.textContent = `Confidence: ${recommendations.confidence}`;
	confidenceEl.className = `confidence-badge confidence-${confidenceClass}`;

	// Show upgrade banner for free users (top 5 hidden by server)
	const isFree = tier === "free";
	let html = isFree
		? '<div class="upgrade-banner">Upgrade to PRO to see Top 5 picks</div>'
		: '';

	// Render picks using pick.rank from server (6-10 for free, 1-10 for premium)
	html += recommendations.topPicks.map(pick => {
		const rank = pick.rank;
		const rankClass = rank <= 3 ? `rank-${rank}` : 'rank-other';

		return `
			<div class="pick-item ${rankClass}">
				<span class="pick-rank">#${rank}</span>
				<span class="pick-number">${pick.number}</span>
				<span class="pick-score">${pick.score.toFixed(1)}</span>
				${pick.reasons && pick.reasons.length > 0 ?
			`<span class="pick-reason" title="${pick.reasons.join(', ')}">${pick.reasons[0]}</span>` : ''}
			</div>
		`;
	}).join('');

	picksList.innerHTML = html;
}

let currentRecommendations = null;

function updatePremiumUI() {
	const premiumTag = document.getElementById("picks-premium-tag");
	const unlockSection = document.getElementById("picks-unlock");
	const autofillSection = document.getElementById("autofill-section");

	if (isPremium) {
		premiumTag.textContent = 'ACTIVE';
		premiumTag.classList.add('active');
		unlockSection.style.display = 'none';
		autofillSection.style.display = 'block';
	} else {
		premiumTag.textContent = 'PRO';
		premiumTag.classList.remove('active');
		unlockSection.style.display = 'block';
		autofillSection.style.display = 'none';
	}
}

async function activateLicense() {
	const keyInput = document.getElementById("license-key");
	const errorEl = document.getElementById("license-error");
	const key = keyInput.value.trim();

	if (!key) {
		errorEl.textContent = "Please enter a license key";
		errorEl.classList.remove("license-success");
		return;
	}

	try {
		const result = await chrome.runtime.sendMessage({
			type: "VALIDATE_LICENSE",
			licenseKey: key
		});

		if (result.valid) {
			errorEl.textContent = "License activated successfully!";
			errorEl.classList.add("license-success");
			isPremium = true;
			updatePremiumUI();
			await loadKenoRecommendations();
		} else {
			errorEl.textContent = result.error || "Invalid license key";
			errorEl.classList.remove("license-success");
		}
	} catch (e) {
		console.error("Failed to validate license:", e);
		errorEl.textContent = "Error validating license";
		errorEl.classList.remove("license-success");
	}
}

// Get filtered picks based on count and min score
function getFilteredPicks(maxCount, minScore) {
	if (!currentRecommendations?.topPicks) return [];
	return currentRecommendations.topPicks
		.filter(pick => pick.score >= minScore)
		.slice(0, maxCount)
		.map(pick => pick.number);
}

// Enhanced autofill with parameters
async function autofillPicks() {
	if (!isPremium || !currentRecommendations?.topPicks) {
		return;
	}

	const count = parseInt(document.getElementById("fill-count")?.value) || 10;
	const minScore = parseFloat(document.getElementById("fill-min-score")?.value) || 0;
	const numbers = getFilteredPicks(count, minScore);

	if (numbers.length === 0) {
		alert("No picks match your criteria");
		return;
	}

	try {
		const result = await chrome.runtime.sendMessage({
			type: "KENO_AUTOFILL",
			numbers: numbers
		});

		if (!result.success) {
			console.error("Autofill failed:", result.error);
		}
	} catch (e) {
		console.error("Failed to autofill:", e);
	}
}

// Start Keno autoplay
async function startKenoAuto() {
	if (!isPremium) return;

	const minScore = parseFloat(document.getElementById("keno-auto-min-score")?.value) || 6.0;

	try {
		await chrome.runtime.sendMessage({
			type: "START_KENO_AUTO",
			settings: { minScore }
		});
		updateKenoAutoUI(true);
	} catch (e) {
		console.error("Failed to start Keno auto:", e);
	}
}

// Stop Keno autoplay
async function stopKenoAuto() {
	try {
		await chrome.runtime.sendMessage({ type: "STOP_KENO_AUTO" });
		updateKenoAutoUI(false);
	} catch (e) {
		console.error("Failed to stop Keno auto:", e);
	}
}

// Update Keno autoplay UI state
function updateKenoAutoUI(isAutoPlaying) {
	const statusEl = document.getElementById("keno-auto-status");
	const modeEl = document.getElementById("keno-mode");
	const startBtn = document.getElementById("keno-start-auto");
	const stopBtn = document.getElementById("keno-stop-auto");

	if (isAutoPlaying) {
		if (statusEl) {
			statusEl.textContent = "ON";
			statusEl.className = "status-on";
		}
		if (modeEl) modeEl.textContent = "Auto";
		if (startBtn) startBtn.disabled = true;
		if (stopBtn) stopBtn.disabled = false;
	} else {
		if (statusEl) {
			statusEl.textContent = "OFF";
			statusEl.className = "status-off";
		}
		if (modeEl) modeEl.textContent = "Manual";
		if (startBtn) startBtn.disabled = false;
		if (stopBtn) stopBtn.disabled = true;
	}
}

function updateUI(state) {
	const statusEl = document.getElementById("auto-status");
	const startBtn = document.getElementById("start-btn");
	const stopBtn = document.getElementById("stop-btn");
	const phaseEl = document.getElementById("phase");
	const detectedEl = document.getElementById("detected-info");

	if (state.autoPlayEnabled) {
		statusEl.textContent = "ON";
		statusEl.className = "status-on";
		startBtn.disabled = true;
		stopBtn.disabled = false;
	} else {
		statusEl.textContent = "OFF";
		statusEl.className = "status-off";
		startBtn.disabled = false;
		stopBtn.disabled = true;
	}

	// Update phase
	if (state.isBetting) {
		phaseEl.textContent = "Betting";
		phaseEl.className = "phase-betting";
	} else {
		phaseEl.textContent = "Tracking";
		phaseEl.className = "phase-tracking";
	}

	// Update detected info
	if (state.detected && state.detected.multiplier) {
		const mult = state.detected.multiplier;
		const winChance = (100 / mult) * 0.99;
		detectedEl.textContent = `${mult.toFixed(2)}x (${winChance.toFixed(1)}%)`;
	} else {
		detectedEl.textContent = "-";
	}

	document.getElementById("losses").textContent = state.consecutiveLosses || 0;
	document.getElementById("doubles").textContent = state.doublesCount || 0;

	const prob = state.probability || 1;
	document.getElementById("probability").textContent = (prob * 100).toFixed(4) + "%";
}

function switchGame(game) {
	currentGame = game;

	// Clear stale recommendations when switching to keno
	if (game === 'keno') {
		currentRecommendations = null;
	}

	// Update tab buttons
	document.querySelectorAll('.game-tab').forEach(tab => {
		tab.classList.toggle('active', tab.dataset.game === game);
	});

	// Update panels
	document.querySelectorAll('.game-panel').forEach(panel => {
		panel.classList.toggle('active', panel.id === `${game}-panel`);
	});

	// Load game-specific data
	if (game === 'keno') {
		loadKenoStats();
	} else {
		loadStats();
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	// Track popup opened (daily unique)
	chrome.runtime.sendMessage({ type: "TRACK_POPUP_OPENED" }).catch(() => {});

	await loadState();
	await loadSettings();
	await loadKenoStats();

	// Game tab switching
	document.querySelectorAll('.game-tab').forEach(tab => {
		tab.addEventListener('click', () => {
			switchGame(tab.dataset.game);
		});
	});

	// Start button
	document.getElementById("start-btn").addEventListener("click", async () => {
		await chrome.runtime.sendMessage({ type: "START_AUTO" });
		await loadState();
	});

	// Stop button
	document.getElementById("stop-btn").addEventListener("click", async () => {
		await chrome.runtime.sendMessage({ type: "STOP_AUTO" });
		await loadState();
	});

	// Save settings
	document.getElementById("save-settings").addEventListener("click", async () => {
		const settings = {
			lossThreshold: parseInt(document.getElementById("loss-threshold").value),
			maxDoubles: parseInt(document.getElementById("max-doubles").value),
			baseBet: parseFloat(document.getElementById("base-bet").value),
		};

		await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings });
		alert("Settings saved!");
	});

	// Reset dice stats
	document.getElementById("reset-stats").addEventListener("click", async () => {
		await chrome.runtime.sendMessage({ type: "RESET_STATS" });
		await loadStats();
	});

	// Reset KENO stats
	document.getElementById("reset-keno-stats").addEventListener("click", async () => {
		await chrome.runtime.sendMessage({ type: "RESET_KENO_STATS" });
		await loadKenoStats();
	});

	// Open charts
	document.getElementById("open-charts").addEventListener("click", () => {
		chrome.tabs.create({ url: chrome.runtime.getURL("src/stats/stats.html") });
	});

	// Dice heatmap toggle
	document.getElementById("heatmap-toggle").addEventListener("change", async (e) => {
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs[0]?.id) {
			chrome.tabs.sendMessage(tabs[0].id, {
				type: "TOGGLE_HEATMAP",
				enabled: e.target.checked,
			});
		}
		// Track heatmap opened
		if (e.target.checked) {
			chrome.runtime.sendMessage({ type: "TRACK_HEATMAP_OPENED", game: "dice" }).catch(() => {});
		}
	});

	// KENO heatmap toggle
	document.getElementById("keno-heatmap-toggle").addEventListener("change", async (e) => {
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs[0]?.id) {
			chrome.tabs.sendMessage(tabs[0].id, {
				type: "TOGGLE_KENO_HEATMAP",
				enabled: e.target.checked,
			});
		}
		// Track heatmap opened
		if (e.target.checked) {
			chrome.runtime.sendMessage({ type: "TRACK_HEATMAP_OPENED", game: "keno" }).catch(() => {});
		}
	});

	// KENO badges toggle
	document.getElementById("keno-badges-toggle").addEventListener("change", async (e) => {
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs[0]?.id) {
			chrome.tabs.sendMessage(tabs[0].id, {
				type: "TOGGLE_KENO_BADGES",
				enabled: e.target.checked,
			});
		}
	});

	// Get PRO button - opens payment page
	document.getElementById("get-pro").addEventListener("click", () => {
		chrome.tabs.create({ url: "https://linearntrack.com" });
	});

	// License key activation
	document.getElementById("activate-license").addEventListener("click", () => {
		activateLicense();
	});

	// License key input - allow Enter to activate
	document.getElementById("license-key").addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			activateLicense();
		}
	});

	// Auto-format license key as user types (LT-XXXX-XXXX-XXXX)
	document.getElementById("license-key").addEventListener("input", (e) => {
		let value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
		// Auto-add dashes after LT and after each 4-char group
		if (value.startsWith('LT') && value.length > 2 && value[2] !== '-') {
			value = 'LT-' + value.slice(2);
		}
		// Format as LT-XXXX-XXXX-XXXX
		const parts = value.replace(/^LT-?/, '').replace(/-/g, '');
		if (parts.length > 0) {
			let formatted = 'LT-';
			for (let i = 0; i < parts.length && i < 12; i++) {
				if (i > 0 && i % 4 === 0) formatted += '-';
				formatted += parts[i];
			}
			value = formatted;
		}
		e.target.value = value;
	});

	// Autofill picks button
	document.getElementById("autofill-picks").addEventListener("click", () => {
		autofillPicks();
	});

	// Keno autoplay start button
	document.getElementById("keno-start-auto").addEventListener("click", () => {
		startKenoAuto();
	});

	// Keno autoplay stop button
	document.getElementById("keno-stop-auto").addEventListener("click", () => {
		stopKenoAuto();
	});
});

// Listen for state updates
chrome.runtime.onMessage.addListener((message) => {
	if (message.type === "STATE_UPDATE") {
		updateUI(message.state);
		if (currentGame === 'dice') {
			loadStats();
		}
	}
	if (message.type === "KENO_STATE_UPDATE") {
		if (currentGame === 'keno') {
			// Update recommendations first (if available) since they're the most current
			if (message.recommendations) {
				isPremium = message.tier === "premium";
				updatePremiumUI();
				renderRecommendations(message.recommendations, message.tier || "free");
			}
			// Then load stats (but skip re-fetching recommendations since we just got them)
			loadKenoStatsOnly();
		}
	}
	if (message.type === "KENO_AUTO_STATE_UPDATE") {
		updateKenoAutoUI(message.isAutoPlaying);
	}
});
