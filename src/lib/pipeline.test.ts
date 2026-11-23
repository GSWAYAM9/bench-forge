import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_REPOSITORIES, getRepositoryById } from './repositories';
import { SAMPLE_TASK_PACKAGES } from './samplePackages';
import {
  evaluateCandidateCode,
  runRepoBaselineTests,
  runTestSuiteInSandbox,
  validateTaskPackage,
} from './sandboxRunner';
import { analyzeVariation, computeLineDiff } from './variationAnalyzer';

test('all 3 sample repositories pass their baseline regression test suites', () => {
  for (const repo of SAMPLE_REPOSITORIES) {
    const result = runRepoBaselineTests(repo);
    assert.equal(
      result.passed,
      true,
      `Expected baseline suite for ${repo.slug} to pass, got error: ${result.compileError ?? JSON.stringify(result.cases)}`,
    );
    assert.ok(result.total >= 3, `Expected at least 3 regression tests in ${repo.slug}`);
  }
});

test('all 4 sample task packages pass all 5 validation gates including 100% mutant killing', () => {
  for (const pkg of SAMPLE_TASK_PACKAGES) {
    const repo = getRepositoryById(pkg.repoId);
    assert.ok(repo, `Repository ${pkg.repoId} should exist for ${pkg.id}`);

    const report = validateTaskPackage(pkg, repo);
    assert.equal(
      report.overallPassed,
      true,
      `Expected ${pkg.id} to pass all 5 gates. Gate summary: ${JSON.stringify(report.gates)}`,
    );
    assert.equal(report.gatesPassed, 5);
    assert.equal(report.totalGates, 5);
    assert.ok(report.mutantResults.length >= 2, `Expected >=2 mutants for ${pkg.id}`);
    for (const mutant of report.mutantResults) {
      assert.equal(mutant.killed, true, `Expected mutant ${mutant.mutantId} to be killed`);
    }
  }
});

test('candidate evaluation distinguishes working reference from buggy mutant', () => {
  const pkg = SAMPLE_TASK_PACKAGES[0];
  const repo = getRepositoryById(pkg.repoId)!;

  const refEval = evaluateCandidateCode(pkg, repo, pkg.referenceImplementation);
  assert.equal(refEval.overallPassed, true);

  const mutantEval = evaluateCandidateCode(pkg, repo, pkg.mutants[0].mutatedCode);
  assert.equal(mutantEval.overallPassed, false);
  assert.equal(mutantEval.featureSuite.passed, false);
  assert.equal(mutantEval.regressionSuite.passed, true);
});

test('sandbox blocks unauthorized host module imports and terminates infinite loops', () => {
  const blockedImport = runTestSuiteInSandbox(
    'Host Access Test',
    { 'src/mod.ts': 'import fs from "node:fs"; export const x = fs;' },
    'tests/t.test.ts',
    'import { x } from "../src/mod"; test("blocked", () => { assert.ok(x); });',
  );
  assert.equal(blockedImport.passed, false);
  assert.ok(
    (blockedImport.compileError ?? '').includes('blocked in isolated sandbox'),
    `Expected sandbox block message, got: ${blockedImport.compileError}`,
  );

  const infiniteLoop = runTestSuiteInSandbox(
    'Timeout Guard Test',
    { 'src/loop.ts': 'export function spin() { while (true) {} }' },
    'tests/loop.test.ts',
    'import { spin } from "../src/loop"; test("spins", () => { spin(); });',
  );
  assert.equal(infiniteLoop.passed, false);
  assert.equal(infiniteLoop.cases[0]?.passed, false);
});

test('variation analyzer verifies cross-repo and intra-repo behavioral differentiation', () => {
  const metrics = analyzeVariation(SAMPLE_TASK_PACKAGES);
  assert.equal(metrics.totalPackages, 4);
  assert.equal(metrics.uniqueRepos, 3);
  assert.equal(metrics.uniqueAxes, 4);
  assert.ok(
    metrics.averageBehavioralDistance >= 0.7,
    `Expected high behavioral distance across diverse packages, got ${metrics.averageBehavioralDistance}`,
  );

  // Confirm the two CartCore tasks have distinct behavioral axes and high distance
  const cartPair = metrics.pairwiseSimilarity.find(
    (p) => p.leftId === 'PKG-001' && p.rightId === 'PKG-002',
  );
  assert.ok(cartPair);
  assert.equal(cartPair.sameRepo, true);
  assert.equal(cartPair.axisDiffers, true);
  assert.ok(cartPair.behavioralDistance >= 0.7);
});

test('computeLineDiff accurately marks added and removed lines', () => {
  const diff = computeLineDiff('const a = 1;\nconst b = 2;', 'const a = 1;\nconst b = 3;\nconst c = 4;');
  assert.equal(diff.filter((d) => d.type === 'context').length, 1);
  assert.equal(diff.filter((d) => d.type === 'removed').length, 1);
  assert.equal(diff.filter((d) => d.type === 'added').length, 2);
});
