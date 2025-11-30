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

// Copy expo-router assets into a safe folder (no "node_modules" in the name)
const expoRouterSrc = path.join(srcAssets, 'node_modules', 'expo-router', 'assets');
const expoRouterDest = path.join(dist, projectName, 'assets', 'expo-router-assets');
copyDirSync(expoRouterSrc, expoRouterDest);

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

// Create a SPA-friendly 404 page so GitHub Pages will load the app for any path.
try {
  const repoBase = '/' + projectName;
  const fallback = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Redirecting…</title>
    <script>
      (function() {
        var repoBase = '${repoBase}';
        var indexPath = repoBase + '/index.html';
        fetch(indexPath).then(function(r){ return r.text(); }).then(function(html){
          document.open();
          document.write(html);
          document.close();
          history.replaceState({}, '', location.pathname + location.search + location.hash);
        }).catch(function(){ location.href = repoBase + '/'; });
      })();
    </script>
  </head>
  <body></body>
</html>`;

  const fallbackRoot = path.join(dist, '404.html');
  const fallbackSub = path.join(dist, projectName, '404.html');
  fs.writeFileSync(fallbackRoot, fallback);
  fs.writeFileSync(fallbackSub, fallback);
  console.log('Created SPA 404 fallback in dist and dist/' + projectName);
} catch (err) {
  console.warn('Could not create 404 fallback:', err.message);
}
