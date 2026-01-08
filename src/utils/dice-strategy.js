// Dice auto-play strategy with martingale betting

export class DiceStrategy {
	constructor() {
		this.consecutiveLosses = 0;
		this.isTracking = true;
		this.isBetting = false;
		this.currentBetAmount = 0;
		this.doublesCount = 0;

		// Configurable settings (loaded from storage)
		this.settings = {
			lossThreshold: 17,      // Start betting after this many losses
			maxDoubles: 10,         // Max martingale doubles before stopping
			baseBet: 0.00000001,    // Base bet amount in BTC
			// Auto-detected from page (no manual entry needed)
			target: 50,             // Roll over/under target
			condition: 'above',     // 'above' or 'below'
			multiplier: 2,          // Payout multiplier
		};

		// Current detected values from actual rolls
		this.detected = {
			target: null,
			condition: null,
			multiplier: null,
		};
	}

	async loadSettings() {
		const result = await chrome.storage.local.get(['diceSettings']);
		if (result.diceSettings) {
			this.settings = { ...this.settings, ...result.diceSettings };
		}
		return this.settings;
	}

	async saveSettings(settings) {
		this.settings = { ...this.settings, ...settings };
		await chrome.storage.local.set({ diceSettings: this.settings });
	}

	// Calculate win probability from multiplier
	// Stake formula: winChance = (100 / multiplier) * 0.99 (1% house edge)
	getWinProbability() {
		const multiplier = this.detected.multiplier || this.settings.multiplier || 2;
		return (100 / multiplier) * 0.99 / 100;
	}

	// Calculate probability of losing N times in a row
	getLoseProbability() {
		return 1 - this.getWinProbability();
	}

	// Update detected values from actual roll data
	updateDetected(roll) {
		if (roll.target !== undefined) this.detected.target = roll.target;
		if (roll.condition) this.detected.condition = roll.condition;
		if (roll.multiplier) this.detected.multiplier = roll.multiplier;
	}

	getSequenceProbability(losses) {
		const loseProbability = this.getLoseProbability();
		return Math.pow(loseProbability, losses);
	}

	// Check if we should start betting based on current losses
	shouldStartBetting() {
		return this.consecutiveLosses >= this.settings.lossThreshold && !this.isBetting;
	}

	// Process a dice roll result
	processRoll(result, won, betAmount) {
		const wasTracking = betAmount === 0;

		if (wasTracking) {
			// Tracking phase (0.00 bets)
			if (won) {
				this.consecutiveLosses = 0;
			} else {
				this.consecutiveLosses++;
			}

			// Check if we should start betting
			if (this.shouldStartBetting()) {
				return {
					action: 'START_BETTING',
					amount: this.settings.baseBet,
					consecutiveLosses: this.consecutiveLosses,
					probability: this.getSequenceProbability(this.consecutiveLosses),
				};
			}

			return {
				action: 'CONTINUE_TRACKING',
				consecutiveLosses: this.consecutiveLosses,
				probability: this.getSequenceProbability(this.consecutiveLosses),
			};
		} else {
			// Betting phase
			if (won) {
				// Won! Reset everything
				this.isBetting = false;
				this.consecutiveLosses = 0;
				this.doublesCount = 0;
				this.currentBetAmount = 0;

				return {
					action: 'WIN',
					profit: betAmount,
					consecutiveLosses: 0,
				};
			} else {
				// Lost, apply martingale
				this.doublesCount++;

				if (this.doublesCount >= this.settings.maxDoubles) {
					// Stop loss reached
					this.isBetting = false;
					this.consecutiveLosses = 0;
					this.doublesCount = 0;
					this.currentBetAmount = 0;

					return {
						action: 'STOP_LOSS',
						doublesCount: this.doublesCount,
					};
				}

				// Double the bet
				const nextBet = betAmount * 2;
				this.currentBetAmount = nextBet;

				return {
					action: 'DOUBLE',
					amount: nextBet,
					doublesCount: this.doublesCount,
				};
			}
		}
	}

	// Get current state
	getState() {
		return {
			consecutiveLosses: this.consecutiveLosses,
			isBetting: this.isBetting,
			currentBetAmount: this.currentBetAmount,
			doublesCount: this.doublesCount,
			probability: this.getSequenceProbability(this.consecutiveLosses),
			winProbability: this.getWinProbability(),
			settings: this.settings,
			detected: this.detected,
		};
	}

	// Reset state
	reset() {
		this.consecutiveLosses = 0;
		this.isBetting = false;
		this.currentBetAmount = 0;
		this.doublesCount = 0;
	}
}
