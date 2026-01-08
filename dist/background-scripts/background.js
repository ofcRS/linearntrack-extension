// src/utils/dice-strategy.js
var DiceStrategy = class {
  constructor() {
    this.consecutiveLosses = 0;
    this.isTracking = true;
    this.isBetting = false;
    this.currentBetAmount = 0;
    this.doublesCount = 0;
    this.settings = {
      lossThreshold: 17,
      // Start betting after this many losses
      maxDoubles: 10,
      // Max martingale doubles before stopping
      baseBet: 1e-8,
      // Base bet amount in BTC
      // Auto-detected from page (no manual entry needed)
      target: 50,
      // Roll over/under target
      condition: "above",
      // 'above' or 'below'
      multiplier: 2
      // Payout multiplier
    };
    this.detected = {
      target: null,
      condition: null,
      multiplier: null
    };
  }
  async loadSettings() {
    const result = await chrome.storage.local.get(["diceSettings"]);
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
    return 100 / multiplier * 0.99 / 100;
  }
  // Calculate probability of losing N times in a row
  getLoseProbability() {
    return 1 - this.getWinProbability();
  }
  // Update detected values from actual roll data
  updateDetected(roll) {
    if (roll.target !== void 0)
      this.detected.target = roll.target;
    if (roll.condition)
      this.detected.condition = roll.condition;
    if (roll.multiplier)
      this.detected.multiplier = roll.multiplier;
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
      if (won) {
        this.consecutiveLosses = 0;
      } else {
        this.consecutiveLosses++;
      }
      if (this.shouldStartBetting()) {
        return {
          action: "START_BETTING",
          amount: this.settings.baseBet,
          consecutiveLosses: this.consecutiveLosses,
          probability: this.getSequenceProbability(this.consecutiveLosses)
        };
      }
      return {
        action: "CONTINUE_TRACKING",
        consecutiveLosses: this.consecutiveLosses,
        probability: this.getSequenceProbability(this.consecutiveLosses)
      };
    } else {
      if (won) {
        this.isBetting = false;
        this.consecutiveLosses = 0;
        this.doublesCount = 0;
        this.currentBetAmount = 0;
        return {
          action: "WIN",
          profit: betAmount,
          consecutiveLosses: 0
        };
      } else {
        this.doublesCount++;
        if (this.doublesCount >= this.settings.maxDoubles) {
          this.isBetting = false;
          this.consecutiveLosses = 0;
          this.doublesCount = 0;
          this.currentBetAmount = 0;
          return {
            action: "STOP_LOSS",
            doublesCount: this.doublesCount
          };
        }
        const nextBet = betAmount * 2;
        this.currentBetAmount = nextBet;
        return {
          action: "DOUBLE",
          amount: nextBet,
          doublesCount: this.doublesCount
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
      detected: this.detected
    };
  }
  // Reset state
  reset() {
    this.consecutiveLosses = 0;
    this.isBetting = false;
    this.currentBetAmount = 0;
    this.doublesCount = 0;
  }
};

// src/user-scripts/dice-autoplay.js.user.script
var dice_autoplay_js_user_default = "function initDiceAutoplay() {\n    // Only run on dice pages\n    if (!window.location.href.includes('/casino/games/dice')) {\n        console.log('[Dice Auto] Not a dice page, skipping initialization');\n        return;\n    }\n\n    let isAutoPlaying = false;\n    let pendingTimeouts = []; // Track all pending timeouts for cancellation\n    let heatmapOverlay = null;\n    let heatmapEnabled = true;\n\n    // Helper to schedule action with tracking\n    function scheduleAction(fn, delay) {\n        const timeoutId = setTimeout(() => {\n            // Remove from tracking array\n            pendingTimeouts = pendingTimeouts.filter(id => id !== timeoutId);\n            // Only execute if still auto-playing\n            if (isAutoPlaying) {\n                fn();\n            } else {\n                console.log('[Dice Auto] Action skipped - auto-play stopped');\n            }\n        }, delay);\n        pendingTimeouts.push(timeoutId);\n        return timeoutId;\n    }\n\n    // Cancel all pending actions\n    function cancelAllPendingActions() {\n        console.log('[Dice Auto] Cancelling', pendingTimeouts.length, 'pending actions');\n        pendingTimeouts.forEach(id => clearTimeout(id));\n        pendingTimeouts = [];\n    }\n\n    // Make element draggable and resizable\n    function makeDraggableResizable(element, storageKey) {\n        let isDragging = false;\n        let isResizing = false;\n        let startX, startY, startLeft, startTop, startWidth, startHeight;\n\n        // Load saved position/size\n        const saved = localStorage.getItem(storageKey);\n        if (saved) {\n            try {\n                const { left, top, scale } = JSON.parse(saved);\n                element.style.left = left + 'px';\n                element.style.top = top + 'px';\n                element.style.bottom = 'auto';\n                element.style.transform = `scale(${scale || 1})`;\n                element.dataset.scale = scale || 1;\n            } catch (e) {}\n        }\n\n        // Create resize handle\n        const resizeHandle = document.createElement('div');\n        resizeHandle.style.cssText = `\n            position: absolute;\n            bottom: 2px;\n            right: 2px;\n            width: 12px;\n            height: 12px;\n            cursor: nwse-resize;\n            background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%);\n            border-radius: 2px;\n        `;\n        element.appendChild(resizeHandle);\n\n        // Drag functionality\n        element.addEventListener('mousedown', (e) => {\n            if (e.target === resizeHandle) return;\n            isDragging = true;\n            startX = e.clientX;\n            startY = e.clientY;\n            const rect = element.getBoundingClientRect();\n            startLeft = rect.left;\n            startTop = rect.top;\n            element.style.cursor = 'grabbing';\n            e.preventDefault();\n        });\n\n        // Resize functionality\n        resizeHandle.addEventListener('mousedown', (e) => {\n            isResizing = true;\n            startX = e.clientX;\n            startY = e.clientY;\n            startWidth = element.offsetWidth;\n            startHeight = element.offsetHeight;\n            e.preventDefault();\n            e.stopPropagation();\n        });\n\n        document.addEventListener('mousemove', (e) => {\n            if (isDragging) {\n                const dx = e.clientX - startX;\n                const dy = e.clientY - startY;\n                element.style.left = (startLeft + dx) + 'px';\n                element.style.top = (startTop + dy) + 'px';\n                element.style.bottom = 'auto';\n                element.style.transform = `scale(${element.dataset.scale || 1})`;\n            } else if (isResizing) {\n                const dx = e.clientX - startX;\n                const scale = Math.max(0.5, Math.min(2, (startWidth + dx) / startWidth));\n                element.style.transform = `scale(${scale})`;\n                element.dataset.scale = scale;\n            }\n        });\n\n        document.addEventListener('mouseup', () => {\n            if (isDragging || isResizing) {\n                // Save position and scale\n                const rect = element.getBoundingClientRect();\n                const scale = parseFloat(element.dataset.scale) || 1;\n                localStorage.setItem(storageKey, JSON.stringify({\n                    left: rect.left / scale,\n                    top: rect.top / scale,\n                    scale: scale\n                }));\n            }\n            isDragging = false;\n            isResizing = false;\n            element.style.cursor = 'grab';\n        });\n\n        element.style.cursor = 'grab';\n    }\n\n    // Create heatmap overlay element\n    function createHeatmapOverlay() {\n        if (heatmapOverlay) return;\n\n        heatmapOverlay = document.createElement('div');\n        heatmapOverlay.id = 'dice-auto-heatmap';\n        heatmapOverlay.style.cssText = `\n            position: fixed;\n            bottom: 10px;\n            left: 50%;\n            transform: translateX(-50%);\n            display: flex;\n            gap: 2px;\n            padding: 8px;\n            padding-right: 16px;\n            background: rgba(0, 0, 0, 0.8);\n            border-radius: 8px;\n            z-index: 9999;\n            font-family: monospace;\n            font-size: 11px;\n            transform-origin: top left;\n            user-select: none;\n        `;\n\n        // Create 10 range boxes - using DOM methods to avoid Trusted Types CSP\n        for (let i = 0; i < 10; i++) {\n            const box = document.createElement('div');\n            box.className = 'heatmap-range';\n            box.dataset.range = i;\n            box.style.cssText = `\n                width: 36px;\n                height: 40px;\n                display: flex;\n                flex-direction: column;\n                align-items: center;\n                justify-content: center;\n                border-radius: 4px;\n                background: #333;\n                color: #fff;\n            `;\n\n            const rangeLabel = document.createElement('div');\n            rangeLabel.style.cssText = 'font-size: 9px; opacity: 0.7;';\n            rangeLabel.textContent = `${i * 10}-${(i + 1) * 10}`;\n\n            const sinceHitLabel = document.createElement('div');\n            sinceHitLabel.className = 'since-hit';\n            sinceHitLabel.style.cssText = 'font-weight: bold;';\n            sinceHitLabel.textContent = '0';\n\n            box.appendChild(rangeLabel);\n            box.appendChild(sinceHitLabel);\n            heatmapOverlay.appendChild(box);\n        }\n\n        document.body.appendChild(heatmapOverlay);\n        makeDraggableResizable(heatmapOverlay, 'dice-heatmap-position');\n        console.log('[Dice Auto] Heatmap overlay created');\n    }\n\n    // Update heatmap colors based on data\n    function updateHeatmap(rangeHits, rangeSinceLastHit, totalRolls) {\n        if (!heatmapOverlay || !heatmapEnabled) return;\n\n        const expectedHitsPerRange = totalRolls / 10;\n\n        for (let i = 0; i < 10; i++) {\n            const box = heatmapOverlay.querySelector(`[data-range=\"${i}\"]`);\n            if (!box) continue;\n\n            const sinceHit = rangeSinceLastHit[i];\n            const hits = rangeHits[i];\n\n            // Update the \"since hit\" counter\n            box.querySelector('.since-hit').textContent = sinceHit;\n\n            // Calculate color based on how \"cold\" the range is\n            // Expected: should hit every ~10 rolls on average\n            const coldness = sinceHit / 10; // >1 means colder than expected\n\n            let bgColor;\n            if (coldness > 3) {\n                // Very cold - bright red\n                bgColor = '#dc2626';\n            } else if (coldness > 2) {\n                // Cold - red\n                bgColor = '#b91c1c';\n            } else if (coldness > 1.5) {\n                // Slightly cold - orange\n                bgColor = '#d97706';\n            } else if (coldness > 1) {\n                // Normal-ish - yellow\n                bgColor = '#ca8a04';\n            } else if (coldness > 0.5) {\n                // Recent - neutral\n                bgColor = '#555';\n            } else {\n                // Just hit - green\n                bgColor = '#16a34a';\n            }\n\n            box.style.background = bgColor;\n        }\n    }\n\n    function toggleHeatmap(enabled) {\n        heatmapEnabled = enabled;\n        if (heatmapOverlay) {\n            heatmapOverlay.style.display = enabled ? 'flex' : 'none';\n        }\n    }\n\n    const processDiceResponse = async (response) => {\n        try {\n            const data = await response.json();\n\n            // Check for dice roll response\n            if (data?.diceRoll) {\n                const roll = data.diceRoll;\n                const result = roll.state?.result;\n                const target = roll.state?.target;\n                const condition = roll.state?.condition;\n                const betAmount = roll.amount;\n                // Win if result matches condition\n                const won = condition === 'above'\n                    ? result > target\n                    : result < target;\n\n                console.log('[Dice Auto] Roll:', { result, target, condition, betAmount, won });\n\n                window.postMessage({\n                    type: 'DICE_ROLL',\n                    roll: {\n                        result,\n                        target,\n                        condition,\n                        multiplier: roll.payoutMultiplier,\n                        betAmount,\n                        won,\n                        payout: roll.payout,\n                        currency: roll.currency,\n                    }\n                }, '*');\n            }\n        } catch (e) {\n            console.error('[Dice Auto] Error processing response:', e);\n        }\n    };\n\n    function replaceFetch() {\n        const originalFetch = window.fetch;\n        window.fetch = async (...args) => {\n            const response = await originalFetch(...args);\n\n            // Check if this is a dice roll request\n            const url = args[0]?.url || args[0];\n            if (typeof url === 'string' && url.includes('/_api/casino/dice/roll')) {\n                const clone = response.clone();\n                processDiceResponse(clone);\n            }\n\n            return response;\n        };\n    }\n\n    // Set bet amount in the UI\n    function setBetAmount(amount) {\n        const input = document.querySelector('input[name=\"amount\"]');\n        if (input) {\n            // Trigger React's onChange\n            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;\n            nativeInputValueSetter.call(input, amount.toFixed(8));\n            input.dispatchEvent(new Event('input', { bubbles: true }));\n            return true;\n        }\n        return false;\n    }\n\n    // Click the bet button\n    function clickBet() {\n        const betButton = document.querySelector('[data-testid=\"bet-button\"]');\n        if (betButton && !betButton.disabled) {\n            betButton.click();\n            return true;\n        }\n        return false;\n    }\n\n    // Listen for commands from content script\n    window.addEventListener('message', (event) => {\n        if (event.source !== window) return;\n\n        switch (event.data.type) {\n            case 'DICE_SET_BET':\n                const amount = event.data.amount;\n                console.log('[Dice Auto] Setting bet amount:', amount);\n                setBetAmount(amount);\n                break;\n\n            case 'DICE_CLICK_BET':\n                console.log('[Dice Auto] Clicking bet button');\n                scheduleAction(() => clickBet(), 100);\n                break;\n\n            case 'DICE_START_AUTO':\n                console.log('[Dice Auto] Starting auto-play');\n                cancelAllPendingActions(); // Clear any stale actions\n                isAutoPlaying = true;\n                // Start with a 0-bet to begin tracking\n                setBetAmount(0);\n                scheduleAction(() => {\n                    if (clickBet()) {\n                        console.log('[Dice Auto] First bet clicked');\n                    } else {\n                        console.error('[Dice Auto] Failed to click bet button');\n                    }\n                }, 500);\n                break;\n\n            case 'DICE_STOP_AUTO':\n                console.log('[Dice Auto] Stopping auto-play');\n                isAutoPlaying = false;\n                cancelAllPendingActions(); // Cancel all pending bets immediately\n                break;\n\n            case 'DICE_EXECUTE_ACTION':\n                // Check if still auto-playing before executing\n                if (!isAutoPlaying) {\n                    console.log('[Dice Auto] Ignoring action - auto-play stopped');\n                    break;\n                }\n                const action = event.data.action;\n                console.log('[Dice Auto] Executing action:', action);\n\n                if (action.action === 'START_BETTING' || action.action === 'DOUBLE') {\n                    setBetAmount(action.amount);\n                    scheduleAction(() => clickBet(), 300);\n                } else if (action.action === 'CONTINUE_TRACKING') {\n                    // Keep betting 0.00\n                    scheduleAction(() => clickBet(), 300);\n                } else if (action.action === 'WIN' || action.action === 'STOP_LOSS') {\n                    // Reset to 0.00 and continue tracking\n                    setBetAmount(0);\n                    scheduleAction(() => clickBet(), 300);\n                }\n                break;\n\n            case 'DICE_UPDATE_HEATMAP':\n                updateHeatmap(\n                    event.data.rangeHits,\n                    event.data.rangeSinceLastHit,\n                    event.data.totalRolls\n                );\n                break;\n\n            case 'DICE_TOGGLE_HEATMAP':\n                toggleHeatmap(event.data.enabled);\n                break;\n        }\n    });\n\n    replaceFetch();\n    createHeatmapOverlay();\n    console.log('[Dice Auto] Autoplay script initialized');\n}\n\n// Initialize immediately or on DOM ready\nif (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', initDiceAutoplay);\n} else {\n    initDiceAutoplay();\n}\n";

// src/user-scripts/keno-stats.js.user.script
var keno_stats_js_user_default = "function initKenoStats() {\n    // Only run on keno pages\n    if (!window.location.href.includes('/casino/games/keno')) {\n        console.log('[KENO Stats] Not a keno page, skipping initialization');\n        return;\n    }\n\n    let coldHeatmap = null;      // \"Since last hit\" heatmap\n    let deviationHeatmap = null; // All-time deviation from average\n    let heatmapEnabled = true;\n    let currentRecommendations = null;\n    let isPremium = false;\n    let badgesEnabled = true;\n\n    // Make element draggable and resizable\n    function makeDraggableResizable(element, storageKey) {\n        let isDragging = false;\n        let isResizing = false;\n        let startX, startY, startLeft, startTop, startWidth, startHeight;\n\n        // Load saved position/size\n        const saved = localStorage.getItem(storageKey);\n        if (saved) {\n            try {\n                const { left, top, scale } = JSON.parse(saved);\n                element.style.left = left + 'px';\n                element.style.top = top + 'px';\n                element.style.bottom = 'auto';\n                element.style.transform = `scale(${scale || 1})`;\n                element.dataset.scale = scale || 1;\n            } catch (e) {}\n        }\n\n        // Create resize handle\n        const resizeHandle = document.createElement('div');\n        resizeHandle.style.cssText = `\n            position: absolute;\n            bottom: 2px;\n            right: 2px;\n            width: 12px;\n            height: 12px;\n            cursor: nwse-resize;\n            background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%);\n            border-radius: 2px;\n        `;\n        element.appendChild(resizeHandle);\n\n        // Drag functionality\n        element.addEventListener('mousedown', (e) => {\n            if (e.target === resizeHandle) return;\n            isDragging = true;\n            startX = e.clientX;\n            startY = e.clientY;\n            const rect = element.getBoundingClientRect();\n            startLeft = rect.left;\n            startTop = rect.top;\n            element.style.cursor = 'grabbing';\n            e.preventDefault();\n        });\n\n        // Resize functionality\n        resizeHandle.addEventListener('mousedown', (e) => {\n            isResizing = true;\n            startX = e.clientX;\n            startY = e.clientY;\n            startWidth = element.offsetWidth;\n            startHeight = element.offsetHeight;\n            e.preventDefault();\n            e.stopPropagation();\n        });\n\n        document.addEventListener('mousemove', (e) => {\n            if (isDragging) {\n                const dx = e.clientX - startX;\n                const dy = e.clientY - startY;\n                element.style.left = (startLeft + dx) + 'px';\n                element.style.top = (startTop + dy) + 'px';\n                element.style.bottom = 'auto';\n                element.style.transform = `scale(${element.dataset.scale || 1})`;\n            } else if (isResizing) {\n                const dx = e.clientX - startX;\n                const scale = Math.max(0.5, Math.min(2, (startWidth + dx) / startWidth));\n                element.style.transform = `scale(${scale})`;\n                element.dataset.scale = scale;\n            }\n        });\n\n        document.addEventListener('mouseup', () => {\n            if (isDragging || isResizing) {\n                // Save position and scale\n                const rect = element.getBoundingClientRect();\n                const scale = parseFloat(element.dataset.scale) || 1;\n                localStorage.setItem(storageKey, JSON.stringify({\n                    left: rect.left / scale,\n                    top: rect.top / scale,\n                    scale: scale\n                }));\n            }\n            isDragging = false;\n            isResizing = false;\n            element.style.cursor = 'grab';\n        });\n\n        element.style.cursor = 'grab';\n    }\n\n    // Create a heatmap grid\n    function createHeatmapGrid(id, title, defaultBottom, defaultLeft) {\n        const container = document.createElement('div');\n        container.id = id;\n        container.style.cssText = `\n            position: fixed;\n            bottom: ${defaultBottom}px;\n            left: ${defaultLeft};\n            display: flex;\n            flex-direction: column;\n            padding: 8px;\n            padding-right: 18px;\n            padding-bottom: 14px;\n            background: rgba(0, 0, 0, 0.85);\n            border-radius: 8px;\n            z-index: 9999;\n            font-family: monospace;\n            font-size: 11px;\n            transform-origin: top left;\n            user-select: none;\n        `;\n\n        // Title\n        const titleEl = document.createElement('div');\n        titleEl.style.cssText = 'font-size: 10px; color: #888; margin-bottom: 6px; text-align: center;';\n        titleEl.textContent = title;\n        container.appendChild(titleEl);\n\n        // Grid\n        const grid = document.createElement('div');\n        grid.className = 'heatmap-grid';\n        grid.style.cssText = `\n            display: grid;\n            grid-template-columns: repeat(8, 1fr);\n            gap: 3px;\n        `;\n\n        // Create 40 number boxes (0-39)\n        for (let i = 0; i < 40; i++) {\n            const box = document.createElement('div');\n            box.className = 'keno-number';\n            box.dataset.number = i;\n            box.style.cssText = `\n                width: 32px;\n                height: 32px;\n                display: flex;\n                flex-direction: column;\n                align-items: center;\n                justify-content: center;\n                border-radius: 4px;\n                background: #333;\n                color: #fff;\n                cursor: default;\n            `;\n\n            const numLabel = document.createElement('div');\n            numLabel.style.cssText = 'font-size: 10px; font-weight: bold;';\n            numLabel.textContent = i + 1; // Display 1-40\n\n            const valueLabel = document.createElement('div');\n            valueLabel.className = 'value-label';\n            valueLabel.style.cssText = 'font-size: 8px; opacity: 0.8;';\n            valueLabel.textContent = '0';\n\n            box.appendChild(numLabel);\n            box.appendChild(valueLabel);\n            grid.appendChild(box);\n        }\n\n        container.appendChild(grid);\n        return container;\n    }\n\n    // Create both heatmaps\n    function createHeatmapOverlays() {\n        if (coldHeatmap) return;\n\n        // Cold heatmap (since last hit) - bottom center\n        coldHeatmap = createHeatmapGrid('keno-cold-heatmap', 'Rounds Since Hit', 10, '50%');\n        coldHeatmap.style.transform = 'translateX(-50%)';\n        document.body.appendChild(coldHeatmap);\n        makeDraggableResizable(coldHeatmap, 'keno-cold-heatmap-position');\n\n        // Deviation heatmap (all-time vs expected) - bottom left\n        deviationHeatmap = createHeatmapGrid('keno-deviation-heatmap', 'Deviation from Average (%)', 10, '10px');\n        document.body.appendChild(deviationHeatmap);\n        makeDraggableResizable(deviationHeatmap, 'keno-deviation-heatmap-position');\n\n        console.log('[KENO Stats] Both heatmaps created');\n    }\n\n    // Update cold heatmap (since last hit)\n    function updateColdHeatmap(numberSinceLastHit) {\n        if (!coldHeatmap || !heatmapEnabled) return;\n\n        const expectedInterval = 4; // Each number should hit every 4 rounds on average\n\n        for (let i = 0; i < 40; i++) {\n            const box = coldHeatmap.querySelector(`[data-number=\"${i}\"]`);\n            if (!box) continue;\n\n            const sinceHit = numberSinceLastHit[i];\n            box.querySelector('.value-label').textContent = sinceHit;\n\n            // Color based on coldness\n            const coldness = sinceHit / expectedInterval;\n            let bgColor;\n            if (coldness > 4) bgColor = '#dc2626';      // Very cold - bright red\n            else if (coldness > 3) bgColor = '#b91c1c'; // Cold - red\n            else if (coldness > 2) bgColor = '#d97706'; // Moderately cold - orange\n            else if (coldness > 1.5) bgColor = '#ca8a04'; // Slightly cold - yellow\n            else if (coldness > 0.5) bgColor = '#555';  // Normal - gray\n            else bgColor = '#16a34a';                    // Just hit - green\n\n            box.style.background = bgColor;\n        }\n    }\n\n    // Update deviation heatmap (all-time stats vs expected)\n    function updateDeviationHeatmap(numberHits, totalRounds) {\n        if (!deviationHeatmap || !heatmapEnabled || totalRounds < 10) return;\n\n        // Expected hits per number = totalRounds * (10/40) = totalRounds * 0.25\n        const expectedHits = totalRounds * 0.25;\n\n        for (let i = 0; i < 40; i++) {\n            const box = deviationHeatmap.querySelector(`[data-number=\"${i}\"]`);\n            if (!box) continue;\n\n            const hits = numberHits[i];\n            // Deviation as percentage: ((actual - expected) / expected) * 100\n            const deviationPercent = ((hits - expectedHits) / expectedHits) * 100;\n\n            // Show deviation with sign\n            const sign = deviationPercent >= 0 ? '+' : '';\n            box.querySelector('.value-label').textContent = `${sign}${deviationPercent.toFixed(0)}%`;\n\n            // Color: red = under average (cold), green = over average (hot)\n            let bgColor;\n            if (deviationPercent < -20) bgColor = '#dc2626';      // Way under - bright red\n            else if (deviationPercent < -10) bgColor = '#b91c1c'; // Under - red\n            else if (deviationPercent < -5) bgColor = '#d97706';  // Slightly under - orange\n            else if (deviationPercent < 5) bgColor = '#555';      // Normal range - gray\n            else if (deviationPercent < 10) bgColor = '#65a30d';  // Slightly over - light green\n            else if (deviationPercent < 20) bgColor = '#16a34a';  // Over - green\n            else bgColor = '#15803d';                              // Way over - dark green\n\n            box.style.background = bgColor;\n        }\n    }\n\n    function toggleHeatmaps(enabled) {\n        heatmapEnabled = enabled;\n        if (coldHeatmap) {\n            coldHeatmap.style.display = enabled ? 'flex' : 'none';\n        }\n        if (deviationHeatmap) {\n            deviationHeatmap.style.display = enabled ? 'flex' : 'none';\n        }\n    }\n\n    // Inject badge styles into the page\n    function injectBadgeStyles() {\n        if (document.getElementById('keno-badge-styles')) return;\n\n        const style = document.createElement('style');\n        style.id = 'keno-badge-styles';\n        style.textContent = `\n            .keno-recommendation-badge {\n                position: absolute;\n                top: 2px;\n                right: 2px;\n                width: 16px;\n                height: 16px;\n                border-radius: 50%;\n                display: flex;\n                align-items: center;\n                justify-content: center;\n                font-size: 9px;\n                font-weight: bold;\n                z-index: 10;\n                pointer-events: none;\n                box-shadow: 0 1px 3px rgba(0,0,0,0.3);\n                transition: all 0.2s ease;\n            }\n            .keno-badge-rank-1 { background: linear-gradient(135deg, #ffd700, #ffec8b); color: #000; }\n            .keno-badge-rank-2 { background: linear-gradient(135deg, #c0c0c0, #e8e8e8); color: #000; }\n            .keno-badge-rank-3 { background: linear-gradient(135deg, #cd7f32, #daa520); color: #000; }\n            .keno-badge-rank-other { background: linear-gradient(135deg, #00d4aa, #00f5c4); color: #000; }\n            /* Blur CSS removed - server now gates data instead */\n            button.tile[data-has-badge=\"true\"] {\n                position: relative !important;\n            }\n        `;\n        document.head.appendChild(style);\n    }\n\n    // Inject badges onto KENO tiles (uses pick.rank from server)\n    function injectBadges(recommendations) {\n        if (!recommendations || !recommendations.topPicks || !badgesEnabled) return;\n\n        const tiles = document.querySelectorAll('button.tile[data-testid^=\"game-tile-\"]');\n        if (tiles.length === 0) return;\n\n        // Remove existing badges first\n        document.querySelectorAll('.keno-recommendation-badge').forEach(b => b.remove());\n\n        for (const pick of recommendations.topPicks) {\n            // Use pick.rank from server (6-10 for free, 1-10 for premium)\n            const rank = pick.rank;\n            const dataIndex = pick.number - 1; // Convert 1-40 to 0-39\n\n            const tile = document.querySelector(`button.tile[data-index=\"${dataIndex}\"]`);\n            if (!tile) continue;\n\n            // Ensure tile has relative positioning\n            tile.setAttribute('data-has-badge', 'true');\n\n            // Create badge\n            const badge = document.createElement('div');\n            badge.className = 'keno-recommendation-badge';\n\n            // Set rank-specific styling based on actual rank from server\n            if (rank <= 3) {\n                badge.classList.add(`keno-badge-rank-${rank}`);\n                badge.textContent = rank.toString();\n            } else {\n                badge.classList.add('keno-badge-rank-other');\n                badge.textContent = rank <= 10 ? rank.toString() : '\u2605';\n            }\n\n            badge.title = `#${rank} pick - Score: ${pick.score}`;\n            tile.appendChild(badge);\n        }\n\n        console.log('[KENO Stats] Badges injected for', recommendations.topPicks.length, 'picks');\n    }\n\n    // Update badges when recommendations change\n    function updateBadges() {\n        if (currentRecommendations) {\n            injectBadges(currentRecommendations);\n        }\n    }\n\n    // Watch for tile re-renders (Svelte reactivity)\n    function setupBadgeObserver() {\n        const gameContainer = document.querySelector('[data-testid=\"game-keno\"]');\n        if (!gameContainer) {\n            // Retry after delay if container not found yet\n            setTimeout(setupBadgeObserver, 1000);\n            return;\n        }\n\n        const observer = new MutationObserver((mutations) => {\n            // Check if tiles were affected\n            const tilesAffected = mutations.some(m =>\n                m.target.classList?.contains('tile') ||\n                m.target.closest?.('.tile') ||\n                m.addedNodes.length > 0\n            );\n\n            if (tilesAffected && currentRecommendations) {\n                // Debounce badge re-injection\n                clearTimeout(window._badgeDebounce);\n                window._badgeDebounce = setTimeout(updateBadges, 100);\n            }\n        });\n\n        observer.observe(gameContainer, {\n            childList: true,\n            subtree: true,\n            attributes: true,\n            attributeFilter: ['class', 'data-selected', 'data-game-tile-status']\n        });\n\n        console.log('[KENO Stats] Badge observer set up');\n    }\n\n    function toggleBadges(enabled) {\n        badgesEnabled = enabled;\n        if (!enabled) {\n            document.querySelectorAll('.keno-recommendation-badge').forEach(b => b.remove());\n        } else {\n            updateBadges();\n        }\n    }\n\n    // Autofill numbers on the KENO grid\n    function autofillNumbers(numbers) {\n        console.log('[KENO Stats] Autofilling numbers:', numbers);\n\n        // First, clear any existing selections\n        const selectedTiles = document.querySelectorAll('button.tile[data-selected=\"true\"]');\n        selectedTiles.forEach(tile => {\n            tile.click();\n        });\n\n        // Wait for deselections to process, then select new numbers\n        setTimeout(() => {\n            numbers.forEach((num, idx) => {\n                setTimeout(() => {\n                    // num is 1-40, data-index is 0-39\n                    const dataIndex = num - 1;\n                    const tile = document.querySelector(`button.tile[data-index=\"${dataIndex}\"]`);\n                    if (tile && tile.getAttribute('data-selected') !== 'true') {\n                        tile.click();\n                        console.log('[KENO Stats] Selected number:', num);\n                    }\n                }, idx * 50); // Stagger clicks by 50ms\n            });\n        }, 100);\n    }\n\n    // Process KENO API response\n    const processKenoResponse = async (response) => {\n        try {\n            const data = await response.json();\n\n            // Check for KENO bet response\n            if (data?.kenoBet) {\n                const bet = data.kenoBet;\n                const drawnNumbers = bet.state?.drawnNumbers || [];\n                const selectedNumbers = bet.state?.selectedNumbers || [];\n                const risk = bet.state?.risk || 'medium';\n\n                // Calculate matches\n                const matches = selectedNumbers.filter(n => drawnNumbers.includes(n)).length;\n\n                console.log('[KENO Stats] Round:', {\n                    drawn: drawnNumbers,\n                    selected: selectedNumbers,\n                    matches,\n                    risk,\n                    payout: bet.payout,\n                    multiplier: bet.payoutMultiplier\n                });\n\n                // Send to background for stats tracking\n                window.postMessage({\n                    type: 'KENO_ROUND',\n                    round: {\n                        drawnNumbers,\n                        selectedNumbers,\n                        matches,\n                        risk,\n                        betAmount: bet.amount,\n                        payout: bet.payout,\n                        payoutMultiplier: bet.payoutMultiplier,\n                        currency: bet.currency,\n                    }\n                }, '*');\n            }\n        } catch (e) {\n            console.error('[KENO Stats] Error processing response:', e);\n        }\n    };\n\n    // Replace fetch to intercept KENO API calls\n    function replaceFetch() {\n        const originalFetch = window.fetch;\n        window.fetch = async (...args) => {\n            const response = await originalFetch(...args);\n\n            // Check if this is a KENO bet request\n            const url = args[0]?.url || args[0];\n            if (typeof url === 'string' && url.includes('/_api/casino/keno/bet')) {\n                const clone = response.clone();\n                processKenoResponse(clone);\n            }\n\n            return response;\n        };\n    }\n\n    // Listen for commands from content script\n    window.addEventListener('message', (event) => {\n        if (event.source !== window) return;\n\n        switch (event.data.type) {\n            case 'KENO_UPDATE_HEATMAP':\n                updateColdHeatmap(event.data.numberSinceLastHit);\n                updateDeviationHeatmap(event.data.numberHits, event.data.totalRounds);\n                break;\n\n            case 'KENO_TOGGLE_HEATMAP':\n                toggleHeatmaps(event.data.enabled);\n                break;\n\n            case 'KENO_UPDATE_RECOMMENDATIONS':\n                currentRecommendations = event.data.recommendations;\n                // tier is now \"premium\", \"free\", or \"offline\" - but we don't need it\n                // because server already gated the data\n                injectBadges(currentRecommendations);\n                break;\n\n            case 'KENO_PREMIUM_STATUS_CHANGED':\n                // Premium status changed, but badges will update on next round\n                // when server returns new recommendations\n                updateBadges();\n                break;\n\n            case 'KENO_TOGGLE_BADGES':\n                toggleBadges(event.data.enabled);\n                break;\n\n            case 'KENO_AUTOFILL':\n                autofillNumbers(event.data.numbers);\n                break;\n        }\n    });\n\n    replaceFetch();\n    createHeatmapOverlays();\n    injectBadgeStyles();\n    setupBadgeObserver();\n    console.log('[KENO Stats] Stats script initialized with badge support');\n}\n\n// Initialize immediately or on DOM ready\nif (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', initKenoStats);\n} else {\n    initKenoStats();\n}\n";

// src/utils/telemetry.js
var TELEMETRY_URL = "https://linearntrack.com/api/telemetry";
var DEVICE_ID_KEY = "telemetry_device_id";
var LAST_OPENED_KEY = "telemetry_last_opened";
var EXTENSION_VERSION = "1.0.0";
async function getDeviceId() {
  const result = await chrome.storage.local.get(DEVICE_ID_KEY);
  if (result[DEVICE_ID_KEY]) {
    return result[DEVICE_ID_KEY];
  }
  const deviceId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: deviceId });
  return deviceId;
}
async function track(event, data = null) {
  try {
    const deviceId = await getDeviceId();
    const response = await fetch(TELEMETRY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        event,
        data,
        version: EXTENSION_VERSION
      })
    });
    if (!response.ok) {
      console.debug(`Telemetry failed: ${response.status}`);
    }
  } catch (e) {
    console.debug("Telemetry error:", e.message);
  }
}
async function trackInstall() {
  const result = await chrome.storage.local.get("telemetry_installed");
  if (!result.telemetry_installed) {
    await track("extension_installed");
    await chrome.storage.local.set({ telemetry_installed: true });
  }
}
async function trackPopupOpened() {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const result = await chrome.storage.local.get(LAST_OPENED_KEY);
  if (result[LAST_OPENED_KEY] !== today) {
    await track("extension_opened");
    await chrome.storage.local.set({ [LAST_OPENED_KEY]: today });
  }
}
var roundCount = 0;
async function trackRound(game) {
  roundCount++;
  if (roundCount % 100 === 0) {
    await track("round_tracked", { game, count: 100 });
  }
}
async function trackProActivated() {
  await track("pro_activated");
}
async function trackAiPicksViewed() {
  await track("ai_picks_viewed");
}
async function trackAutofillUsed() {
  await track("autofill_used");
}
async function trackHeatmapOpened(game) {
  await track("heatmap_opened", { game });
}

// src/background-scripts/background.js
var strategy = new DiceStrategy();
var API_BASE_URL = "https://linearntrack.com/api";
var LICENSE_CACHE_DAYS = 7;
var SESSION_HEARTBEAT_INTERVAL = 5 * 60 * 1e3;
var currentSession = null;
var heartbeatInterval = null;
async function getDeviceId2() {
  const data = await chrome.storage.local.get(["deviceId"]);
  if (data.deviceId)
    return data.deviceId;
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
    const deviceId = await getDeviceId2();
    const response = await fetch(`${API_BASE_URL}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: licenseKey, deviceId })
    });
    const result = await response.json();
    if (result.success && result.sessionToken) {
      currentSession = {
        token: result.sessionToken,
        expiresAt: result.expiresAt,
        licenseExpiresAt: result.licenseExpiresAt
      };
      await chrome.storage.local.set({ sessionData: currentSession });
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
  if (!currentSession?.token)
    return;
  try {
    const response = await fetch(`${API_BASE_URL}/session/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentSession.token}`
      }
    });
    const result = await response.json();
    if (result.success) {
      currentSession.expiresAt = result.expiresAt;
      await chrome.storage.local.set({ sessionData: currentSession });
    } else if (result.code === "SESSION_EXPIRED") {
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
  if (!currentSession?.token)
    return;
  try {
    await fetch(`${API_BASE_URL}/session/end`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentSession.token}`
      }
    });
  } catch (e) {
  }
  stopHeartbeat();
  currentSession = null;
  await chrome.storage.local.remove(["sessionData"]);
}
async function getSessionToken() {
  if (currentSession?.token) {
    const expiresAt = new Date(currentSession.expiresAt).getTime();
    if (Date.now() < expiresAt - 6e4) {
      return currentSession.token;
    }
  }
  const data = await chrome.storage.local.get(["sessionData"]);
  if (data.sessionData?.token) {
    const expiresAt = new Date(data.sessionData.expiresAt).getTime();
    if (Date.now() < expiresAt - 6e4) {
      currentSession = data.sessionData;
      startHeartbeat();
      return currentSession.token;
    }
  }
  const result = await startSession();
  return result.success ? currentSession?.token : null;
}
function createEmptyRecommendations(confidence = "low") {
  return {
    topPicks: [],
    lastUpdated: Date.now(),
    confidence,
    totalRounds: 0,
    stats: { longestCold: null, coldZones: [] }
  };
}
async function analyzeKenoServer(stats, history) {
  const sessionToken = await getSessionToken().catch(() => null);
  try {
    const headers = { "Content-Type": "application/json" };
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }
    const response = await fetch(`${API_BASE_URL}/keno/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify({ stats, history })
    });
    const result = await response.json();
    if (result.success) {
      return {
        success: true,
        recommendations: result.recommendations,
        tier: result.tier
      };
    }
    return { success: false, error: result.error, code: result.code };
  } catch (e) {
    console.error("[KENO] Server analysis error:", e);
    return { success: false, error: "Network error" };
  }
}
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get(["premiumStatus"]);
  if (data.premiumStatus?.isPremium) {
    startSession();
  }
});
(async () => {
  const data = await chrome.storage.local.get(["premiumStatus", "sessionData"]);
  if (data.premiumStatus?.isPremium && data.sessionData?.token) {
    currentSession = data.sessionData;
    startHeartbeat();
  }
})();
async function validateLicenseKey(key) {
  if (!key || typeof key !== "string")
    return { valid: false };
  const normalizedKey = key.toUpperCase().trim();
  const cached = await checkCachedLicense(normalizedKey);
  if (cached.valid && !cached.expired) {
    return { valid: true, cached: true };
  }
  try {
    const response = await fetch(`${API_BASE_URL}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: normalizedKey })
    });
    const data = await response.json();
    if (data.valid) {
      await cacheLicense(normalizedKey);
      return { valid: true, activatedAt: data.activatedAt };
    }
    return { valid: false };
  } catch (e) {
    console.error("[Stakes Stats] License validation error:", e);
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
  const maxAge = LICENSE_CACHE_DAYS * 24 * 60 * 60 * 1e3;
  return {
    valid: true,
    expired: cacheAge > maxAge
  };
}
async function cacheLicense(key) {
  await chrome.storage.local.set({
    licenseCache: {
      key,
      validatedAt: Date.now()
    }
  });
}
var autoPlayEnabled = false;
var diceScriptId = "dice-autoplay-script";
var kenoScriptId = "keno-stats-script";
async function registerUserScripts() {
  try {
    await chrome.userScripts.configureWorld({ messaging: true });
    try {
      await chrome.userScripts.unregister();
    } catch (e) {
    }
    await chrome.userScripts.register([
      {
        id: diceScriptId,
        matches: ["<all_urls>"],
        js: [{ code: dice_autoplay_js_user_default }],
        world: "MAIN"
      },
      {
        id: kenoScriptId,
        matches: ["<all_urls>"],
        js: [{ code: keno_stats_js_user_default }],
        world: "MAIN"
      }
    ]);
    console.log("[Stakes Stats] User scripts registered (Dice + KENO)");
  } catch (e) {
    console.error("[Stakes Stats] Failed to register user scripts:", e);
  }
}
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[Stakes Stats] Extension installed");
  await strategy.loadSettings();
  await registerUserScripts();
  await trackInstall();
});
chrome.runtime.onStartup.addListener(async () => {
  console.log("[Stakes Stats] Browser started");
  await strategy.loadSettings();
  await registerUserScripts();
});
strategy.loadSettings();
registerUserScripts();
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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
        autoPlayEnabled
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
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "AUTO_STARTED" });
      }
      return { success: true, autoPlayEnabled };
    }
    case "STOP_AUTO": {
      autoPlayEnabled = false;
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
          lastCondition: "above"
        }
      });
      return { success: true };
    case "GET_FULL_STATS": {
      const fullData = await chrome.storage.local.get(["diceHistory", "diceStats"]);
      return {
        history: fullData.diceHistory || [],
        stats: fullData.diceStats || {}
      };
    }
    case "GET_KENO_STATS": {
      const kenoData = await chrome.storage.local.get(["kenoHistory", "kenoStats"]);
      return {
        history: kenoData.kenoHistory || [],
        stats: kenoData.kenoStats || {}
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
          recommendations: null
        }
      });
      return { success: true };
    case "GET_KENO_RECOMMENDATIONS": {
      const kenoData = await chrome.storage.local.get(["kenoStats", "kenoHistory"]);
      const stats = kenoData.kenoStats || {};
      const history = kenoData.kenoHistory || [];
      if (stats.totalRounds > 0) {
        const serverResult = await analyzeKenoServer(stats, history);
        if (serverResult.success) {
          stats.recommendations = serverResult.recommendations;
          await chrome.storage.local.set({ kenoStats: stats });
          return {
            recommendations: serverResult.recommendations,
            tier: serverResult.tier
            // "premium" or "free"
          };
        }
        if (stats.recommendations) {
          return { recommendations: stats.recommendations, tier: "offline" };
        }
      }
      return {
        recommendations: createEmptyRecommendations(),
        tier: "free"
      };
    }
    case "GET_PREMIUM_STATUS": {
      const premiumData = await chrome.storage.local.get(["premiumStatus"]);
      return {
        isPremium: premiumData.premiumStatus?.isPremium || false,
        activatedAt: premiumData.premiumStatus?.activatedAt || null
      };
    }
    case "SET_PREMIUM_STATUS": {
      const newStatus = {
        isPremium: message.isPremium,
        activatedAt: message.isPremium ? Date.now() : null,
        licenseKey: message.licenseKey || null
      };
      await chrome.storage.local.set({ premiumStatus: newStatus });
      if (message.isPremium) {
        await startSession();
      } else {
        await endSession();
      }
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, {
          type: "PREMIUM_STATUS_CHANGED",
          isPremium: newStatus.isPremium
        }).catch(() => {
        });
      }
      return { success: true, ...newStatus };
    }
    case "VALIDATE_LICENSE": {
      const key = message.licenseKey;
      const result = await validateLicenseKey(key);
      if (result.valid) {
        trackProActivated();
        const newStatus = {
          isPremium: true,
          activatedAt: result.activatedAt || Date.now(),
          licenseKey: key.toUpperCase()
        };
        await chrome.storage.local.set({ premiumStatus: newStatus });
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, {
            type: "PREMIUM_STATUS_CHANGED",
            isPremium: true
          }).catch(() => {
          });
        }
        return { success: true, valid: true, ...newStatus };
      }
      return { success: false, valid: false, error: result.error || "Invalid license key" };
    }
    case "KENO_AUTOFILL": {
      const premiumData = await chrome.storage.local.get(["premiumStatus"]);
      const isPremium = premiumData.premiumStatus?.isPremium || false;
      if (!isPremium) {
        return { success: false, error: "Premium required for autofill" };
      }
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "KENO_AUTOFILL",
          numbers: message.numbers
        }).catch(() => {
        });
        trackAutofillUsed();
        return { success: true };
      }
      return { success: false, error: "No active tab found" };
    }
    case "TRACK_POPUP_OPENED":
      trackPopupOpened();
      return { success: true };
    case "TRACK_AI_PICKS_VIEWED":
      trackAiPicksViewed();
      return { success: true };
    case "TRACK_HEATMAP_OPENED":
      trackHeatmapOpened(message.game || "unknown");
      return { success: true };
    default:
      return { error: "Unknown message type" };
  }
}
async function handleDiceRoll(roll, tabId) {
  trackRound("dice");
  const stats = await storeRollStats(roll, { consecutiveLosses: 0, action: "MANUAL" });
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: "UPDATE_HEATMAP",
      rangeHits: stats.rangeHits,
      rangeSinceLastHit: stats.rangeSinceLastHit,
      totalRolls: stats.totalRolls
    }).catch(() => {
    });
  }
  strategy.updateDetected(roll);
  if (!autoPlayEnabled) {
    chrome.runtime.sendMessage({
      type: "STATE_UPDATE",
      state: { ...strategy.getState(), autoPlayEnabled: false },
      stats
    }).catch(() => {
    });
    return { action: "DISABLED" };
  }
  const result = strategy.processRoll(roll.result, roll.won, roll.betAmount);
  console.log("[Dice Auto] Roll processed:", result);
  const updatedStats = await storeRollStats(roll, result);
  if (tabId && autoPlayEnabled) {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        type: "EXECUTE_ACTION",
        action: result
      });
    }, 500);
  }
  chrome.runtime.sendMessage({
    type: "STATE_UPDATE",
    state: strategy.getState(),
    lastAction: result,
    stats: updatedStats
  }).catch(() => {
  });
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
    lastCondition: "above"
  };
  if (!stats.rangeHits)
    stats.rangeHits = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (!stats.rangeSinceLastHit)
    stats.rangeSinceLastHit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const rangeIndex = Math.min(9, Math.floor(roll.result / 10));
  stats.rangeHits[rangeIndex]++;
  for (let i = 0; i < 10; i++) {
    stats.rangeSinceLastHit[i]++;
  }
  stats.rangeSinceLastHit[rangeIndex] = 0;
  history.push({
    timestamp: Date.now(),
    result: roll.result,
    target: roll.target,
    condition: roll.condition,
    multiplier: roll.multiplier || 2,
    won: roll.won,
    betAmount: roll.betAmount,
    payout: roll.payout,
    action: result.action
  });
  if (history.length > 1e3) {
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
  if (roll.multiplier)
    stats.lastMultiplier = roll.multiplier;
  if (roll.target)
    stats.lastTarget = roll.target;
  if (roll.condition)
    stats.lastCondition = roll.condition;
  await chrome.storage.local.set({ diceHistory: history, diceStats: stats });
  return stats;
}
async function handleKenoRound(round, tabId) {
  trackRound("keno");
  const stats = await storeKenoStats(round);
  const data = await chrome.storage.local.get(["kenoHistory"]);
  const history = data.kenoHistory || [];
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
      recommendations = stats.recommendations;
      tier = "offline";
    }
  }
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: "UPDATE_KENO_HEATMAP",
      numberHits: stats.numberHits,
      numberSinceLastHit: stats.numberSinceLastHit,
      totalRounds: stats.totalRounds
    }).catch(() => {
    });
    chrome.tabs.sendMessage(tabId, {
      type: "UPDATE_KENO_RECOMMENDATIONS",
      recommendations,
      tier
    }).catch(() => {
    });
  }
  chrome.runtime.sendMessage({
    type: "KENO_STATE_UPDATE",
    stats,
    recommendations,
    tier
  }).catch(() => {
  });
  return { success: true, stats, recommendations, tier };
}
async function storeKenoStats(round) {
  const data = await chrome.storage.local.get(["kenoHistory", "kenoStats"]);
  const history = data.kenoHistory || [];
  const stats = data.kenoStats || {
    totalRounds: 0,
    numberHits: new Array(40).fill(0),
    numberSinceLastHit: new Array(40).fill(0),
    matchDistribution: {}
  };
  if (!stats.numberHits || stats.numberHits.length !== 40) {
    stats.numberHits = new Array(40).fill(0);
  }
  if (!stats.numberSinceLastHit || stats.numberSinceLastHit.length !== 40) {
    stats.numberSinceLastHit = new Array(40).fill(0);
  }
  if (!stats.matchDistribution)
    stats.matchDistribution = {};
  for (let i = 0; i < 40; i++) {
    stats.numberSinceLastHit[i]++;
  }
  for (const num of round.drawnNumbers) {
    if (num >= 0 && num < 40) {
      stats.numberHits[num]++;
      stats.numberSinceLastHit[num] = 0;
    }
  }
  const matches = round.matches;
  stats.matchDistribution[matches] = (stats.matchDistribution[matches] || 0) + 1;
  history.push({
    timestamp: Date.now(),
    drawnNumbers: round.drawnNumbers,
    selectedNumbers: round.selectedNumbers,
    matches: round.matches,
    risk: round.risk,
    betAmount: round.betAmount,
    payout: round.payout,
    payoutMultiplier: round.payoutMultiplier
  });
  if (history.length > 1e3) {
    history.shift();
  }
  stats.totalRounds++;
  await chrome.storage.local.set({ kenoHistory: history, kenoStats: stats });
  return stats;
}
//# sourceMappingURL=background.js.map
