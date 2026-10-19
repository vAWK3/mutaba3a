import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedFilenames, validateIllustrations, MOMENTS } from './validate_illustrations.mjs';

const APPROVED_HEX = '#795DBA'.toLowerCase(); // primary, from the approved palette
const UNAPPROVED_HEX = '#FF00FF'.toLowerCase(); // not in the brand palette

test('expectedFilenames: non-paired moment expects one file', () => {
  assert.deepEqual(expectedFilenames({ name: 'onboarding', pair: false }), ['onboarding.svg']);
});

test('expectedFilenames: paired moment expects personal + firm variants', () => {
  assert.deepEqual(expectedFilenames({ name: 'milestone', pair: true }), [
    'milestone-personal.svg',
    'milestone-firm.svg',
  ]);
});

function fakeFs(files) {
  return {
    fileExists: (path) => path in files,
    readFile: (path) => files[path],
  };
}

const approvedPalette = new Set([APPROVED_HEX]);

test('validateIllustrations passes when every file exists and uses only approved colors', () => {
  const moments = [{ name: 'onboarding', pair: false }];
  const { fileExists, readFile } = fakeFs({
    '/assets/onboarding.svg': `<svg><path fill="${APPROVED_HEX}" d="M0 0"/></svg>`,
  });
  const result = validateIllustrations({ moments, assetsDir: '/assets', fileExists, readFile, approvedPalette });
  assert.equal(result.passed, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.offPalette, []);
});

test('a missing illustration is pending (not a failure) outside --strict', () => {
  const moments = [{ name: 'onboarding', pair: false }];
  const { fileExists, readFile } = fakeFs({});
  const result = validateIllustrations({
    moments,
    assetsDir: '/assets',
    strict: false,
    fileExists,
    readFile,
    approvedPalette,
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.missing, ['onboarding.svg']);
});

test('a missing illustration fails under --strict', () => {
  const moments = [{ name: 'onboarding', pair: false }];
  const { fileExists, readFile } = fakeFs({});
  const result = validateIllustrations({
    moments,
    assetsDir: '/assets',
    strict: true,
    fileExists,
    readFile,
    approvedPalette,
  });
  assert.equal(result.passed, false);
});

test('an off-palette color fails regardless of --strict', () => {
  const moments = [{ name: 'onboarding', pair: false }];
  const { fileExists, readFile } = fakeFs({
    '/assets/onboarding.svg': `<svg><path fill="${UNAPPROVED_HEX}" d="M0 0"/></svg>`,
  });
  const result = validateIllustrations({
    moments,
    assetsDir: '/assets',
    strict: false,
    fileExists,
    readFile,
    approvedPalette,
  });
  assert.equal(result.passed, false);
  assert.equal(result.offPalette.length, 1);
  assert.equal(result.offPalette[0].file, 'onboarding.svg');
  assert.deepEqual(result.offPalette[0].colors, [UNAPPROVED_HEX]);
});

test('milestone requires both personal and firm variants', () => {
  const moments = [{ name: 'milestone', pair: true }];
  const { fileExists, readFile } = fakeFs({
    '/assets/milestone-personal.svg': `<svg><path fill="${APPROVED_HEX}" d="M0 0"/></svg>`,
    // milestone-firm.svg intentionally absent
  });
  const result = validateIllustrations({
    moments,
    assetsDir: '/assets',
    strict: true,
    fileExists,
    readFile,
    approvedPalette,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.missing, ['milestone-firm.svg']);
  assert.ok(result.ok.includes('milestone-personal.svg'));
});

test('the real MOMENTS manifest matches the brief: 5 target files total', () => {
  const totalFiles = MOMENTS.flatMap(expectedFilenames).length;
  assert.equal(totalFiles, 5);
});
