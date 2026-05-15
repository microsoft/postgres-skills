#!/usr/bin/env node
/**
 * Build script: copies skill folders into packages/ for distribution.
 * 
 * Usage: node scripts/build-packages.js
 * 
 * Source of truth: postgresql/ and azure-postgresql/ at repo root.
 * Build artifacts: packages/postgresql-skills/postgresql/ and
 *                  packages/azure-postgresql-skills/azure-postgresql/
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PACKAGES = [
  {
    name: 'postgresql-skills',
    skillDir: 'postgresql',
  },
  {
    name: 'azure-postgresql-skills',
    skillDir: 'azure-postgresql',
  },
];

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
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

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
}

console.log('Building packages...\n');

for (const pkg of PACKAGES) {
  const src = path.join(ROOT, pkg.skillDir);
  const dest = path.join(ROOT, 'packages', pkg.name, pkg.skillDir);

  if (!fs.existsSync(src)) {
    console.error(`ERROR: Source directory not found: ${src}`);
    process.exit(1);
  }

  // Clean previous build artifact
  cleanDir(dest);

  // Copy skills into package
  copyDirSync(src, dest);

  const fileCount = countFiles(dest);
  console.log(`  ${pkg.name}/${pkg.skillDir}/ — ${fileCount} files copied`);
}

console.log('\nBuild complete.');

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}
