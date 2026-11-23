import { useState } from 'react';
import { CheckCircle2, Play, XCircle } from 'lucide-react';
import type { RepositorySnapshot, SuiteRunResult } from '../lib/types';

interface RepositoriesViewProps {
  repositories: RepositorySnapshot[];
  selectedRepoId: string;
  onSelectRepo: (repoId: string) => void;
  onGenerateForRepo: (repoId: string) => void;
}

export function RepositoriesView({
  repositories,
  selectedRepoId,
  onSelectRepo,
  onGenerateForRepo,
}: RepositoriesViewProps) {
  const activeRepo =
    repositories.find((r) => r.id === selectedRepoId) ?? repositories[0];

  const [activeFileTab, setActiveFileTab] = useState<'source' | 'regression'>('source');
  const [baselineResults, setBaselineResults] = useState<Record<string, SuiteRunResult>>({});
  const [runningRepoId, setRunningRepoId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  if (!activeRepo) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-600">
        No repositories loaded.
      </div>
    );
  }

  const activeSource =
    activeRepo.sourceFiles.find((f) => f.path === activeRepo.entryFile) ??
    activeRepo.sourceFiles[0];
  const latestRun = baselineResults[activeRepo.id];

  const handleRunBaseline = async () => {
    setRunningRepoId(activeRepo.id);
    setRunError(null);
    try {
      const resp = await fetch('/api/repos/baseline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: activeRepo.id }),
      });
      const data = (await resp.json()) as { result?: SuiteRunResult; error?: string };
      if (!resp.ok || !data.result) {
        throw new Error(data.error ?? 'Failed to run baseline tests');
      }
      setBaselineResults((prev) => ({ ...prev, [activeRepo.id]: data.result! }));
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Baseline run failed');
    } finally {
      setRunningRepoId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Target Repositories
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 max-w-3xl leading-relaxed">
          Working, version-tagged TypeScript codebases used by the pipeline to demonstrate
          cross-repository generalization beyond a single hand-prepared example.
        </p>
      </div>

      {/* Repository selector tabs */}
      <div
        role="tablist"
        aria-label="Working repositories"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit"
      >
        {repositories.map((repo) => {
          const isSelected = repo.id === activeRepo.id;
          return (
            <button
              key={repo.id}
              role="tab"
              type="button"
              aria-selected={isSelected}
              onClick={() => {
                onSelectRepo(repo.id);
                setRunError(null);
              }}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                isSelected
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {repo.name} · {repo.versionTag}
            </button>
          );
        })}
      </div>

      {/* Active repo card */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold text-slate-900">{activeRepo.name}</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono text-slate-700">
                {activeRepo.slug}@{activeRepo.versionTag}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700">Commit {activeRepo.commitSha}</span>
              <span aria-hidden="true">·</span>
              <span>{activeRepo.stack}</span>
            </div>
            <p className="text-sm text-slate-600 max-w-2xl pt-1 leading-relaxed">
              {activeRepo.summary}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleRunBaseline}
              disabled={runningRepoId === activeRepo.id}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {runningRepoId === activeRepo.id ? 'Running Suite...' : 'Run Baseline Tests'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onGenerateForRepo(activeRepo.id)}
              className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              Generate Task for Repo
            </button>
          </div>
        </div>

        {runError && (
          <div
            role="alert"
            className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800"
          >
            {runError}
          </div>
        )}

        {latestRun && (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div
              className={`px-4 py-2.5 flex items-center justify-between text-xs font-medium ${
                latestRun.passed
                  ? 'bg-emerald-50/70 text-emerald-900 border-b border-emerald-200'
                  : 'bg-red-50/70 text-red-900 border-b border-red-200'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {latestRun.passed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
                )}
                <span>
                  {latestRun.passed ? 'Baseline Regression Suite Passed' : 'Baseline Suite Failed'}
                </span>
              </span>
              <span className="font-mono tabular-nums">
                {latestRun.passedCount}/{latestRun.total} tests · {latestRun.durationMs}ms
              </span>
            </div>
            <ul className="divide-y divide-slate-100 bg-white text-xs">
              {latestRun.cases.map((tc) => (
                <li key={tc.name} className="px-4 py-2 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-slate-700">
                    {tc.passed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-700 shrink-0" aria-hidden="true" />
                    )}
                    <span>{tc.name}</span>
                  </span>
                  <span className="font-mono tabular-nums text-slate-400">{tc.durationMs}ms</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* File Viewer */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveFileTab('source')}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${
                  activeFileTab === 'source'
                    ? 'bg-white text-slate-900 border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {activeSource.path}
              </button>
              <button
                type="button"
                onClick={() => setActiveFileTab('regression')}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${
                  activeFileTab === 'regression'
                    ? 'bg-white text-slate-900 border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {activeRepo.regressionTestFile.path}
              </button>
            </div>
            <span className="text-xs font-mono text-slate-400">Read-only snapshot</span>
          </div>
          <pre className="p-4 text-xs font-mono text-slate-800 bg-white overflow-x-auto max-h-[460px] overflow-y-auto leading-relaxed">
            {activeFileTab === 'source'
              ? activeSource.content
              : activeRepo.regressionTestFile.content}
          </pre>
        </div>
      </div>
    </div>
  );
}
