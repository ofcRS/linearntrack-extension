# LinearnTrack Extension

Chrome extension for Stake.com KENO & Dice analytics.

## Install

1. Download from [linearntrack.com](https://linearntrack.com)
2. Unzip and load in Chrome via `chrome://extensions` (Developer mode)

## Build from Source

```bash
bun install
bun run build
```

The built extension will be in the `dist/` folder.

## Features

- **KENO Heatmap** - Visual overlay showing hot/cold numbers
- **Dice Probability Tracker** - Track roll distributions
- **AI-Powered Recommendations** - Server-side analysis (PRO feature)
- **Auto-play Strategy** - Martingale betting for Dice

## Architecture

The extension collects statistics locally and sends them to our API for analysis. The recommendation algorithm runs server-side - this extension only displays the results.

```
Extension (this repo) → API Server → Recommendations
     ↑                                      ↓
     └──────────────────────────────────────┘
```

## Privacy

- No personal data collected
- Statistics are anonymized
- All data stays in your browser unless using PRO features

## License

MIT
