import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import type {
  RepositorySnapshot,
  TaskDifficulty,
  TaskPackage,
  ValidationReport,
  VariationAxis,
} from '../lib/types';
import { VARIATION_AXES } from '../lib/variationAnalyzer';

interface PipelineStageLog {
  stage: string;
  status: 'completed' | 'repaired' | 'warning';
  durationMs: number;
  summary: string;
}

interface GeneratedResult {
  taskPackage: TaskPackage;
  validation: ValidationReport;
  stages: PipelineStageLog[];
  repairAttempted: boolean;
}

interface PipelineGeneratorProps {
  repositories: RepositorySnapshot[];
  existingPackages: TaskPackage[];
  initialRepoId?: string;
  onPackageCreated: (pkg: TaskPackage) => void;
  onInspectPackage: (pkgId: string) => void;
  onExportPackage: (pkg: TaskPackage) => void;
}

const AXIS_DESCRIPTIONS: Record<VariationAxis, string> = {
  'Eligibility & Thresholds':
    'Conditional rule filters, allowlists/denylists, minimum spend or capacity thresholds, and value clamping.',
  'Conflict Resolution & Precedence':
    'Competing rules over shared resources requiring deterministic tie-breaking or optimal selection.',
  'Stateful Lifecycle Transitions':
    'Multi-step state machines with backoff windows, retry budgets, quarantine queues, or recovery operations.',
  'Quota & Burst Invariants':
    'Weighted resource accounting, atomic reject-without-mutation, and isolated multi-tenant overrides.',
  'Boundary & Rollback Semantics':
    'Transactional mutations, checkpoint/rollback invariants, and strict idempotent replay protection.',
};

const REPO_DIRECTIVES: Record<string, string[]> = {
  'repo-cart-core': [
    'Add buy-X-get-Y-free pricing with per-SKU redemption caps and cheapest-unit discounting',
    'Add transactional cart snapshots with rollbackToCheckpoint() restoring items and totals atomically',
  ],
  'repo-task-queue': [
    'Add job dependency DAG blocking so child jobs remain unclaimable until all parent jobs complete',
    'Add per-job-type concurrency caps alongside the global worker concurrency limit',
  ],
  'repo-rate-guard': [
    'Add penalty cooldown windows that temporarily block tenants after 3 consecutive quota rejections',
    'Add dry-run quota reservation with commit/rollback tokens for multi-step API calls',
  ],
};

export function PipelineGenerator({
  repositories,
  existingPackages,
  initialRepoId,
  onPackageCreated,
  onInspectPackage,
  onExportPackage,
}: PipelineGeneratorProps) {
  const [selectedRepoId, setSelectedRepoId] = useState<string>(
    initialRepoId || repositories[0]?.id || '',
  );
  const [variationAxis, setVariationAxis] = useState<VariationAxis>(
    'Boundary & Rollback Semantics',
  );
  const [difficulty, setDifficulty] = useState<TaskDifficulty>('Advanced');
  const [customDirective, setCustomDirective] = useState('');

  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedResult | null>(null);

  const selectedRepo = repositories.find((r) => r.id === selectedRepoId) ?? repositories[0];
  const repoDirectives = REPO_DIRECTIVES[selectedRepo?.id ?? ''] ?? REPO_DIRECTIVES['repo-cart-core'];

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;

    setIsRunning(true);
    setErrorMessage(null);
    setResult(null);

    const nextNum = existingPackages.length + 1;
    const nextId = `PKG-${String(nextNum).padStart(3, '0')}`;

    try {
      const resp = await fetch('/api/pipeline/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId: selectedRepo.id,
          variationAxis,
          difficulty,
          customDirective: customDirective.trim() || undefined,
          existingTitles: existingPackages.map((p) => p.title),
          nextId,
        }),
      });
      const data = (await resp.json()) as GeneratedResult & { error?: string };
      if (!resp.ok || !data.taskPackage) {
        throw new Error(data.error ?? 'Pipeline synthesis failed');
      }
      setResult(data);
      onPackageCreated(data.taskPackage);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Pipeline execution failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Pipeline Generator
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-3xl leading-relaxed">
          Synthesize a new coding evaluation task package from any pinned repository snapshot using
          Gemini (<span className="font-mono text-xs">gemini-4-hydrogen</span>), immediately
          validate it across all 5 sandbox gates, and execute an automated repair pass if needed.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Configuration Form */}
        <form
          onSubmit={handleGenerate}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="repo-select" className="block text-sm font-medium text-slate-900">
              Target Repository Snapshot
            </label>
            <select
              id="repo-select"
              value={selectedRepoId}
              onChange={(e) => {
                setSelectedRepoId(e.target.value);
                setCustomDirective('');
              }}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-blue-600"
            >
              {repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name} ({repo.slug}@{repo.versionTag} · {repo.commitSha})
                </option>
              ))}
            </select>
            {selectedRepo && (
              <p className="text-xs text-slate-500">
                Entry module: <span className="font-mono">{selectedRepo.entryFile}</span> —{' '}
                {selectedRepo.summary}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="axis-select" className="block text-sm font-medium text-slate-900">
              Behavioral Variation Axis
            </label>
            <select
              id="axis-select"
              value={variationAxis}
              onChange={(e) => setVariationAxis(e.target.value as VariationAxis)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-blue-600"
            >
              {VARIATION_AXES.map((axis) => (
                <option key={axis} value={axis}>
                  {axis}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">{AXIS_DESCRIPTIONS[variationAxis]}</p>
          </div>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-slate-900">Task Complexity</span>
            <div
              role="group"
              aria-label="Task complexity"
              className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg"
            >
              {(['Standard', 'Advanced', 'Expert'] as TaskDifficulty[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setDifficulty(level)}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    difficulty === level
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="custom-directive"
              className="block text-sm font-medium text-slate-900"
            >
              Optional Feature Directive
            </label>
            <textarea
              id="custom-directive"
              rows={2}
              value={customDirective}
              onChange={(e) => setCustomDirective(e.target.value)}
              placeholder="Leave blank for automatic non-duplicate feature synthesis, or describe a specific behavioral constraint..."
              className="w-full p-2.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
            <div className="space-y-1 pt-0.5">
              <span className="text-xs text-slate-500">
                Suggested directives for {selectedRepo?.name}:
              </span>
              <div className="flex flex-col gap-1">
                {repoDirectives.map((dir, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCustomDirective(dir)}
                    className="text-left text-xs text-blue-700 hover:text-blue-900 hover:underline"
                  >
                    {dir}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              Automatically avoids {existingPackages.length} existing package titles.
            </p>
            <button
              type="submit"
              disabled={isRunning}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isRunning ? 'Generating & Validating...' : 'Generate & Validate Package'}</span>
            </button>
          </div>
        </form>

        {/* Pipeline Execution Trace & Output */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Pipeline Execution Stages</h2>
            <ol className="space-y-3 text-xs">
              <li className="flex items-start gap-2.5">
                <span className="font-mono text-slate-400">01.</span>
                <div>
                  <div className="font-medium text-slate-900">Repository Analysis</div>
                  <p className="text-slate-500">
                    Extracts exported symbols, signatures, and existing regression checks from
                    pinned commit.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="font-mono text-slate-400">02.</span>
                <div>
                  <div className="font-medium text-slate-900">
                    Structured Feature & Mutant Synthesis
                  </div>
                  <p className="text-slate-500">
                    Generates unambiguous spec, reference code, feature tests, and 2 behavioral
                    mutants via JSON schema.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="font-mono text-slate-400">03.</span>
                <div>
                  <div className="font-medium text-slate-900">5-Gate Isolated Verification</div>
                  <p className="text-slate-500">
                    Runs Baseline, Fail-to-Pass, Reference Feature, Regression Guard, and Mutation
                    Killing inside Node VM.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="font-mono text-slate-400">04.</span>
                <div>
                  <div className="font-medium text-slate-900">Sandbox-Guided Repair (If Needed)</div>
                  <p className="text-slate-500">
                    Feeds exact failing test diagnostics back to Gemini once if any gate fails.
                  </p>
                </div>
              </li>
            </ol>
          </div>

          {isRunning && (
            <div
              role="status"
              className="bg-white border border-slate-200 rounded-lg p-5 flex items-center gap-3 text-sm text-slate-700"
            >
              <Loader2 className="h-4 w-4 animate-spin text-blue-700 shrink-0" aria-hidden="true" />
              <span>
                Synthesizing task package and running 5-gate sandbox verification...
              </span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1.5 text-xs text-red-900"
            >
              <div className="flex items-center gap-1.5 font-semibold">
                <XCircle className="h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
                <span>Pipeline Error</span>
              </div>
              <p className="leading-relaxed">{errorMessage}</p>
            </div>
          )}

          {result && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-mono text-slate-500">
                    {result.taskPackage.id} · {result.taskPackage.repoSlug}@
                    {result.taskPackage.baseVersionTag}
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 mt-0.5">
                    {result.taskPackage.title}
                  </h3>
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-mono font-medium shrink-0 ${
                    result.validation.overallPassed ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {result.validation.overallPassed ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {result.validation.gatesPassed}/{result.validation.totalGates} Gates
                  </span>
                </span>
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                {result.stages.map((st, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-2 text-xs">
                    <div>
                      <span className="font-medium text-slate-800">{st.stage}</span>
                      <p className="text-slate-500">{st.summary}</p>
                    </div>
                    <span className="font-mono tabular-nums text-slate-400 shrink-0">
                      {st.durationMs}ms
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onInspectPackage(result.taskPackage.id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 whitespace-nowrap"
                >
                  <span>Inspect Full Evidence</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onExportPackage(result.taskPackage)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Export JSON</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
