import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'release', 
  'out', '.vscode', '.idea', 'coverage', '.gemini'
]);

const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', 
  '.ttf', '.eot', '.mp4', '.webm', '.icns', '.zip', '.tar', 
  '.gz', '.pdf', '.lock'
]);

const IGNORE_FILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'
]);

const TARGET_DIR = process.cwd();

function processDirectory(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        processDirectory(fullPath);
      }
    } else if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue;
      
      const ext = path.extname(entry.name).toLowerCase();
      if (!IGNORE_EXTENSIONS.has(ext) && fullPath !== __filename) {
        processFile(fullPath);
      }
    }
  }
}

function processFile(filePath) {
  try {
    const originalContent = fs.readFileSync(filePath, 'utf8');
    
    let newContent = originalContent
      .replace(/ClawX/g, 'ShortClaw')
      .replace(/clawx/g, 'shortclaw')
      .replace(/CLAWX/g, 'SHORTCLAW')
      .replace(/Clawx/g, 'Shortclaw');

    if (newContent !== originalContent) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log(`Modified: ${filePath.replace(TARGET_DIR, '')}`);
    }

    const dirName = path.dirname(filePath);
    const fileName = path.basename(filePath);
    
    let newFileName = fileName
      .replace(/ClawX/g, 'ShortClaw')
      .replace(/clawx/g, 'shortclaw')
      .replace(/CLAWX/g, 'SHORTCLAW')
      .replace(/Clawx/g, 'Shortclaw');
      
    if (newFileName !== fileName) {
      const newFilePath = path.join(dirName, newFileName);
      fs.renameSync(filePath, newFilePath);
      console.log(`Renamed: ${filePath.replace(TARGET_DIR, '')} -> ${newFilePath.replace(TARGET_DIR, '')}`);
    }
  } catch (err) {
    if (err.message.includes('ENOENT') || err.message.includes('EISDIR')) return;
    console.error(`Error processing file ${filePath.replace(TARGET_DIR, '')}:`, err.message);
  }
}

console.log('Starting string replacement and file renaming...');
processDirectory(TARGET_DIR);
console.log('Finished.');
