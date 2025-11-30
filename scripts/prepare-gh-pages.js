#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const projectName = 'MyInvestmentStatus';
const dist = path.join(__dirname, '..', 'dist');
const src = path.join(dist, '_expo');
const destUnderscored = path.join(dist, projectName, '_expo');
const destStatic = path.join(dist, projectName, 'expo-static');
const destStaticRoot = path.join(dist, 'expo-static');

const srcAssets = path.join(dist, 'assets');
const destAssets = path.join(dist, projectName, 'assets');

// Copy original `_expo` (if present) into both a non-underscored folder
// `expo-static` and keep the underscored copy as well.
copyDirSync(src, destUnderscored);
copyDirSync(src, destStatic);
copyDirSync(src, destStaticRoot);
// Also copy assets into the project subfolder so /MyInvestmentStatus/assets/... exists
copyDirSync(srcAssets, destAssets);
copyDirSync(srcAssets, path.join(dist, 'MyInvestmentStatus', 'assets'));
console.log(`Copied ${src} -> ${destUnderscored}, ${destStatic}, ${destStaticRoot}`);

// Ensure Jekyll is disabled on GitHub Pages so directories starting with
// underscores (like `_expo`) are served. Create an empty .nojekyll at the
// root of `dist` and inside the repo subfolder.
try {
  const nojekyllRoot = path.join(dist, '.nojekyll');
  fs.writeFileSync(nojekyllRoot, '');
  const nojekyllSub = path.join(dist, projectName, '.nojekyll');
  fs.mkdirSync(path.join(dist, projectName), { recursive: true });
  fs.writeFileSync(nojekyllSub, '');
  console.log('Created .nojekyll in dist and dist/MyInvestmentStatus');
} catch (err) {
  console.warn('Could not create .nojekyll:', err.message);
}
