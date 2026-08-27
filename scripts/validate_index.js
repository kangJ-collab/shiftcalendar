const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const indexPath = path.join(projectRoot, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const serviceWorker = fs.readFileSync(
  path.join(projectRoot, 'service-worker.js'),
  'utf8'
);
const failures = [];

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]);

const styleSources = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)]
  .map(match => match[1]);
const css = styleSources
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

inlineScripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    failures.push(`inline script ${index + 1}: ${error.message}`);
  }
});

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) {
  failures.push(`duplicate DOM ids: ${duplicateIds.join(', ')}`);
}

const requiredVisualStyles = ['default', 'factory', 'classic'];
const visualStyleButtons = [
  ...html.matchAll(
    /<button\b[^>]*\bdata-visual-style\s*=\s*(["'])([^"']+)\1[^>]*>/gi
  )
].map(match => match[2]);
const visualStyleButtonCounts = visualStyleButtons.reduce((counts, style) => {
  counts[style] = (counts[style] || 0) + 1;
  return counts;
}, {});
const missingVisualStyles = requiredVisualStyles.filter(
  style => visualStyleButtonCounts[style] !== 1
);
const unexpectedVisualStyles = Object.keys(visualStyleButtonCounts).filter(
  style => !requiredVisualStyles.includes(style)
);

if (
  visualStyleButtons.length !== requiredVisualStyles.length ||
  missingVisualStyles.length ||
  unexpectedVisualStyles.length
) {
  failures.push(
    'visual style buttons must contain exactly one each of: ' +
    requiredVisualStyles.join(', ')
  );
}

if (!/html\s*\[\s*data-visual-style\s*=\s*(["'])classic\1\s*\]/i.test(css)) {
  failures.push('classic visual style CSS is missing');
}

const prepaintScript = inlineScripts[0] || '';
if (
  !prepaintScript.includes('document.documentElement.dataset.visualStyle') ||
  !/["']classic["']/.test(prepaintScript)
) {
  failures.push('initial visual style normalization must allow classic');
}

const mainScript = inlineScripts.find(source =>
  source.includes('function normalizeVisualStyle_')
) || '';
const normalizationStart = mainScript.indexOf("const VISUAL_STYLE_KEY");
const normalizationEnd = mainScript.indexOf(
  'function applyVisualStyle_',
  normalizationStart
);
const normalizationContext =
  normalizationStart >= 0 && normalizationEnd > normalizationStart
    ? mainScript.slice(normalizationStart, normalizationEnd)
    : '';

if (
  !normalizationContext.includes('function normalizeVisualStyle_') ||
  !/["']classic["']/.test(normalizationContext)
) {
  failures.push('main visual style normalization must allow classic');
}

const legacyVisualStyleBranches = [
  /visualStyle\s*===\s*(["'])factory\1\s*\?\s*(["'])factory\2\s*:\s*(["'])default\3/,
  /return\s+value\s*===\s*(["'])factory\1\s*\?\s*(["'])factory\2\s*:\s*(["'])default\3/
];

if (legacyVisualStyleBranches.some(pattern => pattern.test(html))) {
  failures.push('legacy two-way visual style normalization is still present');
}

const requiredThemes = [
  'ivory',
  'warm-ivory',
  'mist',
  'cream',
  'leaf',
  'sky',
  'violet',
  'apricot',
  'rose'
];

requiredThemes.forEach(theme => {
  if (!html.includes(`key:'${theme}'`) || !html.includes(`data-theme="${theme}"`)) {
    failures.push(`missing pastel theme: ${theme}`);
  }
});

if (!html.includes("'./data/holidays.json'") || !html.includes("'./data/insurance.json'")) {
  failures.push('relative data URLs are missing');
}

if (html.includes('kangj-collab.github.io/shiftcalendar/data/')) {
  failures.push('production GitHub Pages data URL is still embedded');
}

if (!serviceWorker.includes("const CACHE_VERSION = 'shiftcalendar-pwa-v37'")) {
  failures.push('operating service worker cache version must be v37');
}

if (
  html.includes('STORAGE_NAMESPACE') ||
  html.includes('storagePrefix') ||
  !html.includes('function isShiftCalendarStorageKey_') ||
  !html.includes('SHIFT_CALENDAR_STORAGE_PREFIXES')
) {
  failures.push('operating local storage ownership guard is missing');
}

if (html.includes('localStorage' + '.clear(')) {
  failures.push('the app must not clear the complete origin storage');
}

if (!html.includes("DEVICE_BACKUP_DB='shiftcalendar-device-backup'")) {
  failures.push('operating IndexedDB namespace is missing');
}

[
  'shiftcalendarGasConfig',
  'shiftcalendarCloudBackupConfig',
  'annualLeaveSettings',
  'shiftTeamPatternConfig',
  'salarySettings',
  'teamHistory'
].forEach(key => {
  if (!html.includes(`'${key}'`)) {
    failures.push(`existing storage key is missing from the operating source: ${key}`);
  }
});

[
  'function calculateHoursForDate_',
  'function attendanceReportHtml_',
  'function attendanceSummaryHtml_',
  'function bindAttendanceReport_'
].forEach(marker => {
  if (!html.includes(marker)) {
    failures.push(`attendance report marker is missing: ${marker}`);
  }
});

const changeMonthDefinitions = html.match(/function\s+changeMonth\s*\(/g) || [];
if (changeMonthDefinitions.length !== 1) {
  failures.push(`changeMonth must have exactly one definition, found ${changeMonthDefinitions.length}`);
}

if (!html.includes('isRestorableShiftCalendarStorageKey_')) {
  failures.push('backup restore ownership guard is missing');
}

if (
  html.includes('data-visual-style="factory"] .cell::before') ||
  html.includes('data-visual-style="factory"] .cell.today::after') ||
  html.includes('inset 3px 0 0 var(--shift-bg')
) {
  failures.push('factory skin must not use decorative dots or accent lines');
}

const classicDecorationFailures = [];
const cssRulePattern = /([^{}]+)\{([^{}]*)\}/g;
let cssRuleMatch;

while ((cssRuleMatch = cssRulePattern.exec(css)) !== null) {
  const selector = cssRuleMatch[1];
  const declarations = cssRuleMatch[2];

  if (!/\[\s*data-visual-style\s*=\s*(["'])classic\1\s*\]/i.test(selector)) {
    continue;
  }

  if (/\.cell\s*::before\b/i.test(selector)) {
    classicDecorationFailures.push('.cell::before');
  }

  if (/\.cell\.today\s*::after\b/i.test(selector)) {
    classicDecorationFailures.push('.cell.today::after');
  }

  if (/\binset\s+3(?:\.0+)?px\s+0(?:px)?\s+0(?:px)?\b/i.test(declarations)) {
    classicDecorationFailures.push('inset 3px 0 0');
  }

  if (
    /(?:^|;)\s*border-(?:left|inline-start)(?:-(?:color|style|width))?\s*:/im
      .test(declarations)
  ) {
    classicDecorationFailures.push('border-left');
  }
}

if (classicDecorationFailures.length) {
  failures.push(
    'classic skin must not use decorative dots or accent lines: ' +
    [...new Set(classicDecorationFailures)].join(', ')
  );
}

if (/id="cloudAutoBackupEnabled"[^>]*\schecked(?:\s|>)/.test(html)) {
  failures.push('cloud automatic backup must be opt-in');
}

function runForeignStorageRestoreTest() {
  const vm = require('node:vm');
  const storage = new Map([
    ['themePreference', JSON.stringify('dark')],
    ['memo-2026-01-01', JSON.stringify('old memo')],
    ['fth.config', JSON.stringify({keep: true})],
    ['foreign-key', 'keep me'],
    ['shiftcalendarGasConfig', JSON.stringify({url: 'keep-gas'})],
    ['shiftcalendarCloudBackupConfig', JSON.stringify({credential: 'keep-cloud'})]
  ]);
  const localStorage = {
    get length() {
      return storage.size;
    },
    key(index) {
      return [...storage.keys()][index] ?? null;
    },
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    }
  };
  const storageStart = html.indexOf('const SHIFT_CALENDAR_STORAGE_KEYS=');
  const storageEnd = html.indexOf('const HTML_ESCAPE_MAP_=', storageStart);
  const restoreStart = html.indexOf('function restoreLocalBackupData_');
  const restoreEnd = html.indexOf('async function restoreFromCloudBackup_', restoreStart);

  if (
    storageStart < 0 ||
    storageEnd <= storageStart ||
    restoreStart < 0 ||
    restoreEnd <= restoreStart
  ) {
    throw new Error('could not isolate storage restore code');
  }

  const harness = [
    "const GAS_CONFIG_KEY='shiftcalendarGasConfig';",
    "const CLOUD_BACKUP_CONFIG_KEY='shiftcalendarCloudBackupConfig';",
    html.slice(storageStart, storageEnd),
    html.slice(restoreStart, restoreEnd),
    'globalThis.runRestore=restoreLocalBackupData_;'
  ].join('\n');

  const context = {globalThis: {}, localStorage, window: {}};
  vm.runInNewContext(harness, context);
  context.globalThis.runRestore({
    schemaVersion: 1,
    localStorage: {
      themePreference: JSON.stringify('light'),
      'memo-2026-01-01': JSON.stringify('new memo'),
      'foreign-key': 'must not be imported',
      'fth.config': JSON.stringify({overwrite: true}),
      shiftcalendarGasConfig: JSON.stringify({overwrite: true}),
      shiftcalendarCloudBackupConfig: JSON.stringify({overwrite: true})
    }
  });

  const expected = new Map([
    ['themePreference', JSON.stringify('light')],
    ['memo-2026-01-01', JSON.stringify('new memo')],
    ['fth.config', JSON.stringify({keep: true})],
    ['foreign-key', 'keep me'],
    ['shiftcalendarGasConfig', JSON.stringify({url: 'keep-gas'})],
    ['shiftcalendarCloudBackupConfig', JSON.stringify({credential: 'keep-cloud'})]
  ]);

  for (const [key, value] of expected) {
    if (localStorage.getItem(key) !== value) {
      throw new Error(`restore changed or failed to import storage key: ${key}`);
    }
  }
}

try {
  runForeignStorageRestoreTest();
} catch (error) {
  failures.push(`foreign storage restore test failed: ${error.message}`);
}

if (failures.length) {
  console.error(failures.map(message => `FAIL: ${message}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `OK: ${inlineScripts.length} inline scripts parsed, ${ids.length} DOM ids are unique, ` +
    `${requiredThemes.length} pastel themes are present.`
  );
}
