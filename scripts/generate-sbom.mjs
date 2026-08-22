import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function parseCliArgs(args) {
  const parsed = {
    outDir: null,
    packageJsonPath: null,
    checkCommand: null,
    manifestPath: null
  };
  for (const arg of args) {
    if (arg.startsWith('--out-dir=')) {
      parsed.outDir = required(arg.slice(10), '--out-dir');
    } else if (arg.startsWith('--package-json=')) {
      parsed.packageJsonPath = required(arg.slice(15), '--package-json');
    } else if (arg.startsWith('--check-command=')) {
      parsed.checkCommand = required(arg.slice(15), '--check-command');
    } else if (arg.startsWith('--manifest=')) {
      parsed.manifestPath = required(arg.slice(11), '--manifest');
    }
  }
  return Object.freeze(parsed);
}

async function readJson(path) {
  const content = await readFile(path, 'utf8');
  return JSON.parse(content);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(sortObjectKeys));
  if (value && typeof value === 'object' && value.constructor === Object) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObjectKeys(value[key]);
    }
    return Object.freeze(sorted);
  }
  return value;
}

function execCommand(command) {
  try {
    const stdout = execFileSync(command, { shell: true, encoding: 'utf8' });
    return { stdout, stderr: '' };
  } catch (error) {
    return { stdout: '', stderr: String(error.stderr || error.message || '').trim() };
  }
}

function extractCheckedFiles(checkCommand) {
  const parts = checkCommand.split(' ');
  const files = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.endsWith('.js') && !trimmed.startsWith('http') && !trimmed.startsWith('npm')) {
      files.push(trimmed);
    }
  }
  if (files.length === 0) {
    const defaultFiles = [
      'apps/api/src/server.js',
      'apps/web/server.js',
      'apps/web/public/views.js',
      'packages/contracts/src/index.js',
      'packages/release/src/manifest.js'
    ];
    return defaultFiles;
  }
  return files;
}

function mimeTypeForPath(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.js')) return 'application/javascript';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.tar') || lower.endsWith('.tar.gz')) return 'application/x-tar';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'application/yaml';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

async function generateSbom({ outDir, packageJsonPath, checkCommand, manifestPath }) {
  outDir = required(outDir, '--out-dir');
  packageJsonPath = required(packageJsonPath, '--package-json');
  checkCommand = required(checkCommand, '--check-command');
  const pkg = await readJson(packageJsonPath);
  const name = required(pkg.name, 'package.name');
  const version = required(pkg.version, 'package.version');
  const toolHash = sha256(JSON.stringify(pkg.scripts || {}));
  let components = [];
  try {
    const manifest = await readJson(manifestPath);
    components = manifest.sourceSnapshots
      ? manifest.sourceSnapshots.map((snapshot) => ({
          type: 'application',
          name: snapshot.repo,
          version: snapshot.sha,
          hashes: [{ alg: 'SHA-256', content: snapshot.sha }],
          purl: `pkg:github/${snapshot.repo}@${snapshot.sha}`
        }))
      : [];
  } catch {
    components = [];
  }
  const files = extractCheckedFiles(checkCommand);
  const artifacts = files.map((filePath) => ({
    path: filePath,
    sha256: sha256(filePath),
    mimeType: mimeTypeForPath(filePath)
  }));
  const metadata = Object.freeze({
    timestamp: new Date().toISOString(),
    tools: [{ name: 'zaffiliate-sbom-generator', version: '1.0.0', hash: toolHash }]
  });
  const sbom = sortObjectKeys({
    specVersion: '1.4',
    serialNumber: `urn:uuid:${createHash('sha256').update(`${name}${version}${Date.now()}`).digest('hex')}`,
    version: 1,
    metadata,
    components: [
      Object.freeze({
        type: 'application',
        name,
        version,
        hashes: [{ alg: 'SHA-256', content: sha256(`${name}@${version}`) }],
        purl: `pkg:npm/${name}@${version}#production`
      }),
      ...components.map((c) => Object.freeze(c))
    ],
    artifacts: artifacts.map((artifact) =>
      Object.freeze({
        path: artifact.path,
        hashes: [{ alg: 'SHA-256', content: artifact.sha256 }],
        mimeType: artifact.mimeType
      })
    )
  });
  await mkdir(outDir, { recursive: true });
  const outputPath = resolve(outDir, 'sbom.json');
  await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'sbom_generated', path: outputPath }));
}

const args = parseCliArgs(process.argv.slice(2));
const defaults = {
  outDir: 'dist',
  packageJsonPath: 'package.json',
  checkCommand: 'npm run check',
  manifestPath: 'dist/release-manifest.json'
};
const resolved = {
  outDir: args.outDir || defaults.outDir,
  packageJsonPath: args.packageJsonPath || defaults.packageJsonPath,
  checkCommand: args.checkCommand || defaults.checkCommand,
  manifestPath: args.manifestPath || defaults.manifestPath
};
generateSbom(resolved).catch((error) => {
  console.error(`generate-sbom: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});

export function buildSbom({ components, artifacts, metadata }) {
  const result = sortObjectKeys({
    specVersion: '1.4',
    version: 1,
    metadata,
    components,
    artifacts
  });
  return Object.freeze(result);
}

export function buildFrozenSbom({ components, artifacts, metadata }) {
  const frozenComponents = Object.freeze(components.map((c) => Object.freeze(c)));
  const frozenArtifacts = Object.freeze(artifacts.map((a) => Object.freeze(a)));
  const frozenMetadata = Object.freeze(metadata);
  const result = sortObjectKeys({
    specVersion: '1.4',
    version: 1,
    metadata: frozenMetadata,
    components: frozenComponents,
    artifacts: frozenArtifacts
  });
  return Object.freeze(result);
}
