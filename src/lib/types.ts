export type VariationAxis =
  | 'Eligibility & Thresholds'
  | 'Conflict Resolution & Precedence'
  | 'Stateful Lifecycle Transitions'
  | 'Quota & Burst Invariants'
  | 'Boundary & Rollback Semantics';

export type TaskDifficulty = 'Standard' | 'Advanced' | 'Expert';

export interface RepoFile {
  path: string;
  content: string;
}

export interface RepositorySnapshot {
  id: string;
  name: string;
  slug: string;
  versionTag: string;
  commitSha: string;
  stack: string;
  summary: string;
  entryFile: string;
  sourceFiles: RepoFile[];
  regressionTestFile: RepoFile;
}

export interface FaultMutant {
  id: string;
  label: string;
  faultCategory: string;
  description: string;
  mutatedCode: string;
}

export interface TaskRequirements {
  overview: string;
  functionalRules: string[];
  edgeCases: string[];
  acceptanceCriteria: string[];
  outOfScope: string[];
}

export interface TaskPackage {
  id: string;
  title: string;
  repoId: string;
  repoSlug: string;
  baseVersionTag: string;
  baseCommitSha: string;
  variationAxis: VariationAxis;
  difficulty: TaskDifficulty;
  createdAt: string;
  origin: 'Sample' | 'Gemini Pipeline';
  targetFile: string;
  behavioralTags: string[];
  requirements: TaskRequirements;
  referenceImplementation: string;
  featureTests: string;
  mutants: FaultMutant[];
  lastValidation?: ValidationReport;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface SuiteRunResult {
  suiteName: string;
  passed: boolean;
  total: number;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  compileError?: string;
  cases: TestCaseResult[];
}

export interface GateCheckResult {
  id: 'baseline_regression' | 'fail_to_pass' | 'reference_feature' | 'reference_regression' | 'mutation_killing';
  label: string;
  expected: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

export interface MutantValidationResult {
  mutantId: string;
  label: string;
  faultCategory: string;
  description: string;
  killed: boolean;
  failedTests: string[];
  durationMs: number;
  compileError?: string;
}

export interface ValidationReport {
  packageId: string;
  validatedAt: string;
  overallPassed: boolean;
  gatesPassed: number;
  totalGates: number;
  totalDurationMs: number;
  gates: GateCheckResult[];
  baselineRegressionSuite: SuiteRunResult;
  failToPassSuite: SuiteRunResult;
  referenceFeatureSuite: SuiteRunResult;
  referenceRegressionSuite: SuiteRunResult;
  mutantResults: MutantValidationResult[];
}

export interface CandidateEvaluationReport {
  evaluatedAt: string;
  overallPassed: boolean;
  featureSuite: SuiteRunResult;
  regressionSuite: SuiteRunResult;
  totalDurationMs: number;
}

export interface VariationMetrics {
  totalPackages: number;
  uniqueRepos: number;
  uniqueAxes: number;
  axisDistribution: Record<VariationAxis, number>;
  averageBehavioralDistance: number;
  pairwiseSimilarity: Array<{
    leftId: string;
    rightId: string;
    sameRepo: boolean;
    axisDiffers: boolean;
    behavioralDistance: number;
  }>;
}
