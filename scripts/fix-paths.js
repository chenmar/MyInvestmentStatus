#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(indexPath, 'utf-8');

// Replace `_expo` asset paths with `expo-static` to avoid Jekyll ignoring
// underscore-leading directories on GitHub Pages.
html = html.replace(/src="\/_expo\//g, 'src="/MyInvestmentStatus/expo-static/');
html = html.replace(/src="\.\/\_expo\//g, 'src="./expo-static/');

fs.writeFileSync(indexPath, html, 'utf-8');
console.log('Fixed asset paths in index.html');
