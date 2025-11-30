#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

function rewriteFile(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	// Only process text files
	if (!['.html', '.js', '.css', '.json'].includes(ext)) return;
	let content = fs.readFileSync(filePath, 'utf8');

	// Replace `_expo` asset paths with `expo-static` (published folder)
	content = content.replace(/src="\/_expo\//g, 'src="/MyInvestmentStatus/expo-static/');
	content = content.replace(/src="\.\/\_expo\//g, 'src="./expo-static/');

  // Map absolute asset paths to repository subpath so GitHub Pages serves them
  content = content.replace(/"\/assets\//g, '"/MyInvestmentStatus/assets/');
  content = content.replace(/'\/assets\//g, "'/MyInvestmentStatus/assets/");

  // Replace node_modules/expo-router asset references with a safe folder name
  content = content.replace(/\/MyInvestmentStatus\/assets\/node_modules\/expo-router\/assets\//g, '/MyInvestmentStatus/assets/expo-router-assets/');
  content = content.replace(/\/assets\/node_modules\/expo-router\/assets\//g, '/MyInvestmentStatus/assets/expo-router-assets/');
  content = content.replace(/\.\/assets\/node_modules\/expo-router\/assets\//g, './assets/expo-router-assets/');

  // Also handle any bare /assets/ occurrences
  content = content.replace(/(?<!:)\/assets\//g, '/MyInvestmentStatus/assets/');
	fs.writeFileSync(filePath, content, 'utf8');
}

function walkAndRewrite(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walkAndRewrite(full);
		else rewriteFile(full);
	}
}

walkAndRewrite(distDir);
console.log('Rewrote asset paths in dist files');
