#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(indexPath, 'utf-8');

// Replace absolute paths with subdirectory-aware paths
html = html.replace(/src="\/_expo\//g, 'src="/MyInvestmentStatus/_expo/');

fs.writeFileSync(indexPath, html, 'utf-8');
console.log('Fixed asset paths in index.html');
