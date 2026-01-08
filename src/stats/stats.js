// Stats page - Charts and detailed statistics

async function loadStats() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_FULL_STATS" });
        return response;
    } catch (e) {
        console.error("Failed to load stats:", e);
        return { history: [], stats: {} };
    }
}

function updateSummary(stats) {
    document.getElementById('total-rolls').textContent = stats.totalRolls || 0;

    const winRate = stats.totalRolls > 0
        ? ((stats.wins / stats.totalRolls) * 100).toFixed(1) + '%'
        : '0%';
    document.getElementById('win-rate').textContent = winRate;

    const profitEl = document.getElementById('profit');
    const profit = stats.totalProfit || 0;
    profitEl.textContent = profit.toFixed(8);
    profitEl.className = 'stat-value ' + (profit >= 0 ? 'positive' : 'negative');

    document.getElementById('max-streak').textContent = stats.maxStreak || 0;

    // Detected settings
    const multiplier = stats.lastMultiplier || 2;
    document.getElementById('detected-multiplier').textContent = multiplier.toFixed(2) + 'x';

    const winChance = (100 / multiplier) * 0.99;
    document.getElementById('win-chance').textContent = winChance.toFixed(2) + '%';
}

function renderDistributionChart(rangeHits, totalRolls) {
    const container = document.getElementById('distribution-chart');
    container.innerHTML = '';

    const chartDiv = document.createElement('div');
    chartDiv.className = 'bar-chart';

    const maxHits = Math.max(...rangeHits, 1);
    const expected = totalRolls / 10;

    for (let i = 0; i < 10; i++) {
        const hits = rangeHits[i] || 0;
        const heightPercent = (hits / maxHits) * 100;

        const bar = document.createElement('div');
        bar.className = 'bar';

        const value = document.createElement('div');
        value.className = 'bar-value';
        value.textContent = hits;

        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        fill.style.height = heightPercent + '%';

        // Color based on deviation from expected
        const deviation = hits / expected;
        if (deviation < 0.7) {
            fill.style.background = '#dc2626'; // Cold
        } else if (deviation > 1.3) {
            fill.style.background = '#16a34a'; // Hot
        }

        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = `${i * 10}-${(i + 1) * 10}`;

        bar.appendChild(value);
        bar.appendChild(fill);
        bar.appendChild(label);
        chartDiv.appendChild(bar);
    }

    container.appendChild(chartDiv);
}

function renderColdestTable(rangeHits, rangeSinceLastHit, totalRolls) {
    const tbody = document.querySelector('#coldest-table tbody');
    tbody.innerHTML = '';

    const expected = totalRolls / 10;

    // Create array with range data and sort by "since last hit"
    const ranges = [];
    for (let i = 0; i < 10; i++) {
        ranges.push({
            range: `${i * 10}-${(i + 1) * 10}`,
            sinceHit: rangeSinceLastHit[i] || 0,
            hits: rangeHits[i] || 0,
            expected: Math.round(expected),
        });
    }

    // Sort by coldest first
    ranges.sort((a, b) => b.sinceHit - a.sinceHit);

    for (const range of ranges) {
        const tr = document.createElement('tr');

        // Mark as cold if significantly below expected
        if (range.sinceHit > 20) {
            tr.className = 'cold';
        } else if (range.sinceHit < 3 && range.hits > range.expected) {
            tr.className = 'hot';
        }

        tr.innerHTML = `
            <td>${range.range}</td>
            <td>${range.sinceHit}</td>
            <td>${range.hits}</td>
            <td>${range.expected}</td>
        `;
        tbody.appendChild(tr);
    }
}

function renderProfitChart(history) {
    const container = document.getElementById('profit-chart');
    container.innerHTML = '';

    if (history.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #666; padding-top: 80px;">No data yet</div>';
        return;
    }

    // Calculate cumulative profit
    const points = [];
    let cumulative = 0;
    for (const roll of history) {
        if (roll.won) {
            cumulative += roll.payout || roll.betAmount || 0;
        } else {
            cumulative -= roll.betAmount || 0;
        }
        points.push(cumulative);
    }

    // Only show last 200 points for performance
    const displayPoints = points.slice(-200);

    // Create SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 400 200`);
    svg.style.width = '100%';
    svg.style.height = '100%';

    const minVal = Math.min(...displayPoints, 0);
    const maxVal = Math.max(...displayPoints, 0);
    const range = maxVal - minVal || 1;
    const padding = range * 0.1;

    // Scale function
    const scaleX = (i) => (i / (displayPoints.length - 1)) * 400;
    const scaleY = (v) => 200 - ((v - minVal + padding) / (range + 2 * padding)) * 200;

    // Zero line
    const zeroY = scaleY(0);
    const zeroLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    zeroLine.setAttribute('x1', 0);
    zeroLine.setAttribute('y1', zeroY);
    zeroLine.setAttribute('x2', 400);
    zeroLine.setAttribute('y2', zeroY);
    zeroLine.setAttribute('class', 'zero-line');
    svg.appendChild(zeroLine);

    // Profit line
    const pathData = displayPoints.map((v, i) => {
        const x = scaleX(i);
        const y = scaleY(v);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.style.stroke = cumulative >= 0 ? '#00d4aa' : '#ff6b6b';
    svg.appendChild(path);

    const chartDiv = document.createElement('div');
    chartDiv.className = 'line-chart';
    chartDiv.appendChild(svg);

    container.appendChild(chartDiv);
}

async function refresh() {
    const { history, stats } = await loadStats();

    updateSummary(stats);
    renderDistributionChart(stats.rangeHits || [], stats.totalRolls || 0);
    renderColdestTable(stats.rangeHits || [], stats.rangeSinceLastHit || [], stats.totalRolls || 0);
    renderProfitChart(history);
}

async function resetStats() {
    if (confirm('Are you sure you want to reset all statistics?')) {
        await chrome.runtime.sendMessage({ type: "RESET_STATS" });
        await refresh();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await refresh();

    document.getElementById('refresh-btn').addEventListener('click', refresh);
    document.getElementById('reset-btn').addEventListener('click', resetStats);

    // Auto-refresh every 5 seconds
    setInterval(refresh, 5000);
});

// Listen for state updates
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "STATE_UPDATE") {
        refresh();
    }
});
