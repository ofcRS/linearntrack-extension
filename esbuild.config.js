import { build, context } from "esbuild";
import { cpSync, mkdirSync } from "fs";

const config = {
	entryPoints: [
		"src/background-scripts/background.js",
		"src/content-script.js",
	],
	bundle: true,
	outdir: "dist",
	platform: "browser",
	format: "esm",
	sourcemap: true,
	minify: false,
	loader: {
		".js.user.script": "text",
	},
};

// Copy static files to dist
const copyStaticFiles = () => {
	// Copy manifest
	cpSync("manifest.json", "dist/manifest.json");

	// Copy popup folder
	mkdirSync("dist/popup", { recursive: true });
	cpSync("src/popup", "dist/popup", { recursive: true });

	// Copy icons if they exist
	try {
		mkdirSync("dist/icons", { recursive: true });
		cpSync("icons", "dist/icons", { recursive: true });
	} catch {}
};

const run = async () => {
	if (process.env.WATCH) {
		const ctx = await context(config);
		await ctx.watch({});
		copyStaticFiles();
	} else {
		await build(config);
		copyStaticFiles();
	}
};

run();
