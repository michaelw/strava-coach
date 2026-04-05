const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_REPO_CONFIG_PATH = path.join(ROOT, 'evals', 'config.yaml');
const DEFAULT_RETRY_POLICY = Object.freeze({
  error_passes: 2,
  flaky_passes: 1,
  flaky_tag: 'flaky',
});
const DEFAULT_BASELINE_CONFIG = Object.freeze({
  version: '',
  url: '',
});

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function readRepoConfig(configPath = DEFAULT_REPO_CONFIG_PATH) {
  return readYaml(configPath);
}

function normalizeRetryNumber(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeString(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function readRetryPolicy(configPath = DEFAULT_REPO_CONFIG_PATH) {
  const repoConfig = readRepoConfig(configPath);
  const configured = repoConfig?.retries || {};
  const flakyTag = typeof configured.flaky_tag === 'string' && configured.flaky_tag.trim()
    ? configured.flaky_tag.trim()
    : DEFAULT_RETRY_POLICY.flaky_tag;

  return {
    error_passes: normalizeRetryNumber(
      configured.error_passes,
      DEFAULT_RETRY_POLICY.error_passes,
    ),
    flaky_passes: normalizeRetryNumber(
      configured.flaky_passes,
      DEFAULT_RETRY_POLICY.flaky_passes,
    ),
    flaky_tag: flakyTag,
  };
}

function readBaselineConfig(configPath = DEFAULT_REPO_CONFIG_PATH) {
  const repoConfig = readRepoConfig(configPath);
  const configured = repoConfig?.baseline || {};

  return {
    version: normalizeString(configured.version, DEFAULT_BASELINE_CONFIG.version),
    url: normalizeString(configured.url, DEFAULT_BASELINE_CONFIG.url),
  };
}

function parsePromptfooFileRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('file://')) {
    return null;
  }

  const raw = ref.slice('file://'.length);
  const lastSlash = raw.lastIndexOf('/');
  const exportSeparator = raw.indexOf(':', lastSlash + 1);
  if (exportSeparator === -1) {
    return {
      filePath: raw,
      suffix: '',
    };
  }

  return {
    filePath: raw.slice(0, exportSeparator),
    suffix: raw.slice(exportSeparator),
  };
}

function toPromptfooFileRef(filePath, suffix = '') {
  return `file://${filePath}${suffix}`;
}

function absolutizePromptfooFileRef(ref, baseDir) {
  const parsed = parsePromptfooFileRef(ref);
  if (!parsed) {
    return ref;
  }

  return toPromptfooFileRef(path.resolve(baseDir, parsed.filePath), parsed.suffix);
}

function expandPromptfooTestEntry(entry, baseDir) {
  const parsed = parsePromptfooFileRef(entry);
  if (!parsed) {
    return [entry];
  }

  if (!parsed.filePath.includes('*')) {
    return [path.resolve(baseDir, parsed.filePath)];
  }

  if (parsed.suffix) {
    throw new Error(`Unsupported Promptfoo test glob with export suffix: ${entry}`);
  }

  const recursiveYamlGlob = '/**/*.yaml';
  if (!parsed.filePath.endsWith(recursiveYamlGlob)) {
    throw new Error(`Unsupported Promptfoo test glob: ${entry}`);
  }

  const rootDir = path.resolve(baseDir, parsed.filePath.slice(0, -recursiveYamlGlob.length));
  return listFilesRecursive(rootDir).filter((filePath) => filePath.endsWith('.yaml'));
}

function normalizeRepeat(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function expandCompareConfig(configPath) {
  const config = readYaml(configPath);
  const baseDir = path.dirname(configPath);
  const tests = Array.isArray(config.tests) ? config.tests : [];
  const expandedTests = [];

  for (const entry of tests) {
    const resolvedFiles = expandPromptfooTestEntry(entry, baseDir);
    for (const filePath of resolvedFiles) {
      if (typeof filePath !== 'string' || !filePath.endsWith('.yaml')) {
        expandedTests.push(filePath);
        continue;
      }

      const testCase = readYaml(filePath) || {};
      const repeat = normalizeRepeat(testCase.repeat);
      const promptfooFileRef = toPromptfooFileRef(filePath);
      for (let index = 0; index < repeat; index += 1) {
        expandedTests.push(promptfooFileRef);
      }
    }
  }

  return {
    ...config,
    prompts: Array.isArray(config.prompts)
      ? config.prompts.map((prompt) => absolutizePromptfooFileRef(prompt, baseDir))
      : config.prompts,
    tests: expandedTests,
  };
}

function writeExpandedCompareConfig(configPath, outputPath) {
  const expandedConfig = expandCompareConfig(configPath);
  fs.writeFileSync(outputPath, yaml.dump(expandedConfig, {
    lineWidth: -1,
    noRefs: true,
  }), 'utf8');
  return outputPath;
}

module.exports = {
  DEFAULT_BASELINE_CONFIG,
  DEFAULT_REPO_CONFIG_PATH,
  DEFAULT_RETRY_POLICY,
  expandCompareConfig,
  expandPromptfooTestEntry,
  parsePromptfooFileRef,
  readBaselineConfig,
  readRepoConfig,
  readRetryPolicy,
  readYaml,
  toPromptfooFileRef,
  writeExpandedCompareConfig,
};
