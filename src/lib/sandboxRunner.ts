import { transformSync } from 'esbuild';
import vm from 'node:vm';
import path from 'node:path';
import type {
  CandidateEvaluationReport,
  GateCheckResult,
  MutantValidationResult,
  RepositorySnapshot,
  SuiteRunResult,
  TaskPackage,
  TestCaseResult,
  ValidationReport,
} from './types.ts';

const SANDBOX_TIMEOUT_MS = 1200;

function normalizeVirtualPath(filePath: string): string {
  const cleaned = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return path.posix.normalize(cleaned);
}

function createSafeAssert() {
  const deepEqualCheck = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      return false;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, idx) => deepEqualCheck(item, b[idx]));
    }
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) =>
      deepEqualCheck((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  };

  return {
    equal(actual: unknown, expected: unknown, message?: string) {
      if (!Object.is(actual, expected)) {
        throw new Error(
          message ?? `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
        );
      }
    },
    notEqual(actual: unknown, unexpected: unknown, message?: string) {
      if (Object.is(actual, unexpected)) {
        throw new Error(message ?? `Expected value not to equal ${JSON.stringify(unexpected)}`);
      }
    },
    deepEqual(actual: unknown, expected: unknown, message?: string) {
      if (!deepEqualCheck(actual, expected)) {
        throw new Error(
          message ??
            `Deep equality failed. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
        );
      }
    },
    ok(value: unknown, message?: string) {
      if (!value) {
        throw new Error(message ?? `Expected truthy value, received ${JSON.stringify(value)}`);
      }
    },
    throws(fn: () => unknown, message?: string) {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error(message ?? 'Expected function to throw an error, but it did not throw');
      }
    },
  };
}

function compileTypeScriptToCjs(code: string, filename: string): string {
  const result = transformSync(code, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2022',
    sourcefile: filename,
  });
  return result.code;
}

export function runTestSuiteInSandbox(
  suiteName: string,
  virtualFiles: Record<string, string>,
  testFilePath: string,
  testCode: string,
): SuiteRunResult {
  const startAll = performance.now();
  const normalizedFiles = new Map<string, string>();
  for (const [filePath, content] of Object.entries(virtualFiles)) {
    normalizedFiles.set(normalizeVirtualPath(filePath), content);
  }

  const compiledCache = new Map<string, string>();
  try {
    for (const [filePath, content] of normalizedFiles.entries()) {
      compiledCache.set(filePath, compileTypeScriptToCjs(content, filePath));
    }
  } catch (err) {
    return {
      suiteName,
      passed: false,
      total: 0,
      passedCount: 0,
      failedCount: 1,
      durationMs: Math.round((performance.now() - startAll) * 10) / 10,
      compileError: err instanceof Error ? err.message : String(err),
      cases: [],
    };
  }

  let compiledTest: string;
  try {
    compiledTest = compileTypeScriptToCjs(testCode, testFilePath);
  } catch (err) {
    return {
      suiteName,
      passed: false,
      total: 0,
      passedCount: 0,
      failedCount: 1,
      durationMs: Math.round((performance.now() - startAll) * 10) / 10,
      compileError: `Test compilation error: ${err instanceof Error ? err.message : String(err)}`,
      cases: [],
    };
  }

  const moduleExportsCache = new Map<string, unknown>();
  const registeredTests: Array<{ name: string; fn: () => void }> = [];
  const safeAssert = createSafeAssert();

  const sandboxGlobals: Record<string, unknown> = {
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    WeakMap,
    WeakSet,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Infinity,
    NaN,
    undefined,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
    assert: safeAssert,
    test: (name: string, fn: () => void) => {
      registeredTests.push({ name, fn });
    },
  };

  const context = vm.createContext(sandboxGlobals, {
    codeGeneration: { strings: false, wasm: false },
  });

  const resolveVirtualModule = (fromFile: string, request: string): string => {
    if (!request.startsWith('.')) {
      throw new Error(`Module "${request}" is blocked in isolated sandbox`);
    }
    const baseDir = path.posix.dirname(normalizeVirtualPath(fromFile));
    const joined = normalizeVirtualPath(path.posix.join(baseDir, request));
    const candidates = [joined, `${joined}.ts`, `${joined}.js`, `${joined}/index.ts`];
    for (const candidate of candidates) {
      if (compiledCache.has(candidate)) {
        return candidate;
      }
    }
    throw new Error(`Virtual module "${request}" not found from "${fromFile}"`);
  };

  const loadVirtualModule = (filePath: string): unknown => {
    const normalized = normalizeVirtualPath(filePath);
    if (moduleExportsCache.has(normalized)) {
      return moduleExportsCache.get(normalized);
    }
    const code = compiledCache.get(normalized);
    if (code === undefined) {
      throw new Error(`Virtual file "${normalized}" not found`);
    }
    const mod = { exports: {} as Record<string, unknown> };
    moduleExportsCache.set(normalized, mod.exports);

    const localRequire = (req: string) => {
      const target = resolveVirtualModule(normalized, req);
      return loadVirtualModule(target);
    };

    const wrapped = `(function(exports, require, module) {\n${code}\n})`;
    const script = new vm.Script(wrapped, { filename: normalized });
    const runner = script.runInContext(context, { timeout: SANDBOX_TIMEOUT_MS }) as (
      e: unknown,
      r: (req: string) => unknown,
      m: { exports: unknown },
    ) => void;
    runner(mod.exports, localRequire, mod);
    moduleExportsCache.set(normalized, mod.exports);
    return mod.exports;
  };

  // Register test cases
  try {
    const normalizedTestPath = normalizeVirtualPath(testFilePath);
    const mod = { exports: {} as Record<string, unknown> };
    const localRequire = (req: string) => {
      const target = resolveVirtualModule(normalizedTestPath, req);
      return loadVirtualModule(target);
    };
    const wrappedTest = `(function(exports, require, module) {\n${compiledTest}\n})`;
    const script = new vm.Script(wrappedTest, { filename: normalizedTestPath });
    const runner = script.runInContext(context, { timeout: SANDBOX_TIMEOUT_MS }) as (
      e: unknown,
      r: (req: string) => unknown,
      m: { exports: unknown },
    ) => void;
    runner(mod.exports, localRequire, mod);
  } catch (err) {
    return {
      suiteName,
      passed: false,
      total: 1,
      passedCount: 0,
      failedCount: 1,
      durationMs: Math.round((performance.now() - startAll) * 10) / 10,
      compileError: err instanceof Error ? err.message : String(err),
      cases: [
        {
          name: 'Suite initialization',
          passed: false,
          durationMs: Math.round((performance.now() - startAll) * 10) / 10,
          error: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  if (registeredTests.length === 0) {
    return {
      suiteName,
      passed: false,
      total: 0,
      passedCount: 0,
      failedCount: 1,
      durationMs: Math.round((performance.now() - startAll) * 10) / 10,
      compileError: 'No test(...) cases were registered by the test suite',
      cases: [],
    };
  }

  const cases: TestCaseResult[] = [];
  for (const tc of registeredTests) {
    const tcStart = performance.now();
    try {
      const invokeScript = new vm.Script('__runCase()', { filename: `${testFilePath}#${tc.name}` });
      context.__runCase = tc.fn;
      invokeScript.runInContext(context, { timeout: SANDBOX_TIMEOUT_MS });
      cases.push({
        name: tc.name,
        passed: true,
        durationMs: Math.round((performance.now() - tcStart) * 10) / 10,
      });
    } catch (err) {
      cases.push({
        name: tc.name,
        passed: false,
        durationMs: Math.round((performance.now() - tcStart) * 10) / 10,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passedCount = cases.filter((c) => c.passed).length;
  const failedCount = cases.length - passedCount;
  return {
    suiteName,
    passed: failedCount === 0 && cases.length > 0,
    total: cases.length,
    passedCount,
    failedCount,
    durationMs: Math.round((performance.now() - startAll) * 10) / 10,
    cases,
  };
}

function buildVirtualFileMap(
  repo: RepositorySnapshot,
  overridePath?: string,
  overrideContent?: string,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of repo.sourceFiles) {
    files[file.path] = file.content;
  }
  if (overridePath && overrideContent !== undefined) {
    files[overridePath] = overrideContent;
  }
  return files;
}

export function runRepoBaselineTests(
  repo: RepositorySnapshot,
  overrideSource?: string,
): SuiteRunResult {
  const files = buildVirtualFileMap(repo, repo.entryFile, overrideSource);
  return runTestSuiteInSandbox(
    `${repo.slug} Baseline Regression Suite`,
    files,
    repo.regressionTestFile.path,
    repo.regressionTestFile.content,
  );
}

export function validateTaskPackage(
  pkg: TaskPackage,
  repo: RepositorySnapshot,
): ValidationReport {
  const startTotal = performance.now();

  const baseFiles = buildVirtualFileMap(repo);
  const referenceFiles = buildVirtualFileMap(repo, pkg.targetFile, pkg.referenceImplementation);

  // Gate 1: Base Repo + Existing Regression Tests -> MUST PASS
  const baselineRegressionSuite = runTestSuiteInSandbox(
    'Baseline Regression Suite',
    baseFiles,
    repo.regressionTestFile.path,
    repo.regressionTestFile.content,
  );

  // Gate 2: Base Repo + New Feature Tests -> MUST FAIL (Fail-to-Pass)
  const failToPassSuite = runTestSuiteInSandbox(
    'Fail-to-Pass Check (Feature Tests on Base Repo)',
    baseFiles,
    'tests/feature.test.ts',
    pkg.featureTests,
  );
  const failToPassPassed = !failToPassSuite.passed;

  // Gate 3: Reference Implementation + New Feature Tests -> MUST PASS
  const referenceFeatureSuite = runTestSuiteInSandbox(
    'Reference Feature Test Suite',
    referenceFiles,
    'tests/feature.test.ts',
    pkg.featureTests,
  );

  // Gate 4: Reference Implementation + Existing Regression Tests -> MUST PASS
  const referenceRegressionSuite = runTestSuiteInSandbox(
    'Reference Regression Guard Suite',
    referenceFiles,
    repo.regressionTestFile.path,
    repo.regressionTestFile.content,
  );

  // Gate 5: Fault-Injection Mutants + New Feature Tests -> ALL MUTANTS MUST BE KILLED (FAIL)
  const mutantResults: MutantValidationResult[] = pkg.mutants.map((mutant) => {
    const mutantFiles = buildVirtualFileMap(repo, pkg.targetFile, mutant.mutatedCode);
    const run = runTestSuiteInSandbox(
      `Mutant ${mutant.id}`,
      mutantFiles,
      'tests/feature.test.ts',
      pkg.featureTests,
    );
    const killed = !run.passed;
    return {
      mutantId: mutant.id,
      label: mutant.label,
      faultCategory: mutant.faultCategory,
      description: mutant.description,
      killed,
      failedTests: run.cases.filter((c) => !c.passed).map((c) => c.name),
      durationMs: run.durationMs,
      compileError: run.compileError,
    };
  });

  const killedCount = mutantResults.filter((m) => m.killed).length;
  const mutationGatePassed = mutantResults.length > 0 && killedCount === mutantResults.length;
  const mutationDuration =
    Math.round(mutantResults.reduce((sum, m) => sum + m.durationMs, 0) * 10) / 10;

  const gates: GateCheckResult[] = [
    {
      id: 'baseline_regression',
      label: 'Baseline Repository Healthy',
      expected: 'Existing regression suite passes on base snapshot',
      passed: baselineRegressionSuite.passed,
      detail: `${baselineRegressionSuite.passedCount}/${baselineRegressionSuite.total} regression tests passed`,
      durationMs: baselineRegressionSuite.durationMs,
    },
    {
      id: 'fail_to_pass',
      label: 'Fail-to-Pass Verification',
      expected: 'New feature tests fail against unmodified base snapshot',
      passed: failToPassPassed,
      detail: failToPassPassed
        ? `Confirmed missing feature (${failToPassSuite.failedCount}/${Math.max(1, failToPassSuite.total)} failed on base)`
        : 'Feature tests unexpectedly passed on unmodified base repo',
      durationMs: failToPassSuite.durationMs,
    },
    {
      id: 'reference_feature',
      label: 'Reference Solvability',
      expected: 'Reference implementation passes all feature tests',
      passed: referenceFeatureSuite.passed,
      detail: `${referenceFeatureSuite.passedCount}/${referenceFeatureSuite.total} feature tests passed`,
      durationMs: referenceFeatureSuite.durationMs,
    },
    {
      id: 'reference_regression',
      label: 'Regression Protection',
      expected: 'Reference implementation preserves all existing behaviors',
      passed: referenceRegressionSuite.passed,
      detail: `${referenceRegressionSuite.passedCount}/${referenceRegressionSuite.total} regression tests passed`,
      durationMs: referenceRegressionSuite.durationMs,
    },
    {
      id: 'mutation_killing',
      label: 'Fault-Detection Strength',
      expected: 'Feature tests catch every injected behavioral mutant',
      passed: mutationGatePassed,
      detail:
        mutantResults.length > 0
          ? `${killedCount}/${mutantResults.length} behavioral mutants killed`
          : 'No mutants supplied',
      durationMs: mutationDuration,
    },
  ];

  const gatesPassed = gates.filter((g) => g.passed).length;

  return {
    packageId: pkg.id,
    validatedAt: new Date().toISOString(),
    overallPassed: gatesPassed === gates.length,
    gatesPassed,
    totalGates: gates.length,
    totalDurationMs: Math.round((performance.now() - startTotal) * 10) / 10,
    gates,
    baselineRegressionSuite,
    failToPassSuite,
    referenceFeatureSuite,
    referenceRegressionSuite,
    mutantResults,
  };
}

export function evaluateCandidateCode(
  pkg: TaskPackage,
  repo: RepositorySnapshot,
  candidateCode: string,
): CandidateEvaluationReport {
  const start = performance.now();
  const candidateFiles = buildVirtualFileMap(repo, pkg.targetFile, candidateCode);

  const featureSuite = runTestSuiteInSandbox(
    'Feature Requirements Suite',
    candidateFiles,
    'tests/feature.test.ts',
    pkg.featureTests,
  );
  const regressionSuite = runTestSuiteInSandbox(
    'Existing Regression Suite',
    candidateFiles,
    repo.regressionTestFile.path,
    repo.regressionTestFile.content,
  );

  return {
    evaluatedAt: new Date().toISOString(),
    overallPassed: featureSuite.passed && regressionSuite.passed,
    featureSuite,
    regressionSuite,
    totalDurationMs: Math.round((performance.now() - start) * 10) / 10,
  };
}
