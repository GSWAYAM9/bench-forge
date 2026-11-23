import type { TaskPackage, VariationAxis, VariationMetrics } from './types.ts';

export const VARIATION_AXES: VariationAxis[] = [
  'Eligibility & Thresholds',
  'Conflict Resolution & Precedence',
  'Stateful Lifecycle Transitions',
  'Quota & Burst Invariants',
  'Boundary & Rollback Semantics',
];

function tokenizeBehavior(pkg: TaskPackage): Set<string> {
  const tokens = new Set<string>();
  for (const tag of pkg.behavioralTags) {
    tokens.add(tag.toLowerCase());
  }
  tokens.add(`axis:${pkg.variationAxis.toLowerCase()}`);

  const ruleText = [
    pkg.requirements.overview,
    ...pkg.requirements.functionalRules,
    ...pkg.requirements.edgeCases,
  ]
    .join(' ')
    .toLowerCase();

  const keywords = [
    'threshold',
    'category',
    'clamp',
    'bundle',
    'overlap',
    'maximize',
    'tie-break',
    'backoff',
    'exponential',
    'dead_letter',
    'idempotency',
    'burst',
    'atomic',
    'override',
    'rollback',
    'snapshot',
    'window',
    'quota',
    'precedence',
    'dedup',
  ];

  for (const kw of keywords) {
    if (ruleText.includes(kw)) {
      tokens.add(`kw:${kw}`);
    }
  }
  return tokens;
}

export function computeBehavioralDistance(a: TaskPackage, b: TaskPackage): number {
  const setA = tokenizeBehavior(a);
  const setB = tokenizeBehavior(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  const jaccardDistance = 1 - intersection / union;
  return Math.round(jaccardDistance * 100) / 100;
}

export function analyzeVariation(packages: TaskPackage[]): VariationMetrics {
  const axisDistribution: Record<VariationAxis, number> = {
    'Eligibility & Thresholds': 0,
    'Conflict Resolution & Precedence': 0,
    'Stateful Lifecycle Transitions': 0,
    'Quota & Burst Invariants': 0,
    'Boundary & Rollback Semantics': 0,
  };

  const repoSet = new Set<string>();
  const axisSet = new Set<VariationAxis>();

  for (const pkg of packages) {
    repoSet.add(pkg.repoId);
    axisSet.add(pkg.variationAxis);
    axisDistribution[pkg.variationAxis] = (axisDistribution[pkg.variationAxis] ?? 0) + 1;
  }

  const pairwiseSimilarity: VariationMetrics['pairwiseSimilarity'] = [];
  for (let i = 0; i < packages.length; i++) {
    for (let j = i + 1; j < packages.length; j++) {
      const left = packages[i];
      const right = packages[j];
      pairwiseSimilarity.push({
        leftId: left.id,
        rightId: right.id,
        sameRepo: left.repoId === right.repoId,
        axisDiffers: left.variationAxis !== right.variationAxis,
        behavioralDistance: computeBehavioralDistance(left, right),
      });
    }
  }

  const avgDistance =
    pairwiseSimilarity.length > 0
      ? Math.round(
          (pairwiseSimilarity.reduce((sum, p) => sum + p.behavioralDistance, 0) /
            pairwiseSimilarity.length) *
            100,
        ) / 100
      : 0;

  return {
    totalPackages: packages.length,
    uniqueRepos: repoSet.size,
    uniqueAxes: axisSet.size,
    axisDistribution,
    averageBehavioralDistance: avgDistance,
    pairwiseSimilarity,
  };
}

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  lineNumberOld?: number;
  lineNumberNew?: number;
  text: string;
}

export function computeLineDiff(oldCode: string, newCode: string): DiffLine[] {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // LCS table for clean deterministic line diff
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      diff.push({
        type: 'context',
        lineNumberOld: i + 1,
        lineNumberNew: j + 1,
        text: oldLines[i],
      });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({
        type: 'removed',
        lineNumberOld: i + 1,
        text: oldLines[i],
      });
      i += 1;
    } else {
      diff.push({
        type: 'added',
        lineNumberNew: j + 1,
        text: newLines[j],
      });
      j += 1;
    }
  }
  while (i < m) {
    diff.push({ type: 'removed', lineNumberOld: i + 1, text: oldLines[i] });
    i += 1;
  }
  while (j < n) {
    diff.push({ type: 'added', lineNumberNew: j + 1, text: newLines[j] });
    j += 1;
  }
  return diff;
}
