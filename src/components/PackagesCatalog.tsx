import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Search,
  XCircle,
} from 'lucide-react';
import type { RepositorySnapshot, TaskPackage } from '../lib/types';
import { analyzeVariation, VARIATION_AXES } from '../lib/variationAnalyzer';

interface PackagesCatalogProps {
  packages: TaskPackage[];
  repositories: RepositorySnapshot[];
  onSelectPackage: (pkgId: string) => void;
  onOpenGenerator: () => void;
  onExportPackage: (pkg: TaskPackage) => void;
}

export function PackagesCatalog({
  packages,
  repositories,
  onSelectPackage,
  onOpenGenerator,
  onExportPackage,
}: PackagesCatalogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [repoFilter, setRepoFilter] = useState<string>('all');

  const variation = useMemo(() => analyzeVariation(packages), [packages]);

  const filteredPackages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return packages.filter((pkg) => {
      if (repoFilter !== 'all' && pkg.repoId !== repoFilter) return false;
      if (!q) return true;
      return (
        pkg.id.toLowerCase().includes(q) ||
        pkg.title.toLowerCase().includes(q) ||
        pkg.repoSlug.toLowerCase().includes(q) ||
        pkg.variationAxis.toLowerCase().includes(q) ||
        pkg.behavioralTags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [packages, repoFilter, searchQuery]);

  const verifiedCount = packages.filter((p) => p.lastValidation?.overallPassed).length;
  const totalMutants = packages.reduce(
    (sum, p) => sum + (p.lastValidation?.mutantResults.length ?? p.mutants.length),
    0,
  );
  const killedMutants = packages.reduce(
    (sum, p) =>
      sum + (p.lastValidation?.mutantResults.filter((m) => m.killed).length ?? 0),
    0,
  );

  return (
    <div className="space-y-8">
      {/* Header & Metrics Strip */}
      <section className="space-y-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Task Packages
          </h1>
          <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
            Self-contained feature-development evaluation tasks generated from version-tagged
            repositories. Every package includes unambiguous requirements, a runnable reference
            solution, feature and regression suites, and fault-injection mutants verified in an
            isolated TypeScript sandbox.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Verified Packages</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
                {verifiedCount}/{packages.length}
              </span>
              <span className="text-xs text-slate-500">5/5 gates</span>
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Target Repositories</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
                {variation.uniqueRepos}
              </span>
              <span className="text-xs text-slate-500">pinned snapshots</span>
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Mutants Killed</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
                {killedMutants}/{totalMutants}
              </span>
              <span className="text-xs text-slate-500">faults caught</span>
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs font-medium text-slate-500">Behavioral Axes</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
                {variation.uniqueAxes}/{VARIATION_AXES.length}
              </span>
              <span className="text-xs text-slate-500">
                {Math.round(variation.averageBehavioralDistance * 100)}% avg distance
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Filter & Search Bar + Task Packages Table */}
      <section className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Filter packages by repository"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit"
          >
            <button
              type="button"
              onClick={() => setRepoFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                repoFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Repos ({packages.length})
            </button>
            {repositories.map((repo) => {
              const count = packages.filter((p) => p.repoId === repo.id).length;
              return (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => setRepoFilter(repo.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    repoFilter === repo.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {repo.name} ({count})
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-72">
            <label htmlFor="package-search" className="sr-only">
              Search task packages
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="package-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by title, repo, or axis..."
              className="w-full h-9 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {filteredPackages.length === 0 ? (
            <div className="py-12 px-6 text-center space-y-3">
              <p className="text-sm font-medium text-slate-900">
                No task packages match your current filter.
              </p>
              <p className="text-xs text-slate-500">
                Clear your search criteria or synthesize a new package for this repository.
              </p>
              <div className="pt-1 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setRepoFilter('all');
                  }}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Reset Filters
                </button>
                <button
                  type="button"
                  onClick={onOpenGenerator}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 whitespace-nowrap shrink-0"
                >
                  Generate New Package
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4 font-medium">Task Package</th>
                    <th className="py-3 px-4 font-medium">Repository Snapshot</th>
                    <th className="py-3 px-4 font-medium">Variation Axis</th>
                    <th className="py-3 px-4 font-medium text-right">Validation</th>
                    <th className="py-3 px-4 font-medium text-right">Mutants</th>
                    <th className="py-3 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredPackages.map((pkg) => {
                    const report = pkg.lastValidation;
                    const killed = report?.mutantResults.filter((m) => m.killed).length ?? 0;
                    const totalM = report?.mutantResults.length ?? pkg.mutants.length;

                    return (
                      <tr
                        key={pkg.id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="py-3.5 px-4 max-w-md">
                          <button
                            type="button"
                            onClick={() => onSelectPackage(pkg.id)}
                            className="text-left group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                          >
                            <div className="font-medium text-slate-900 group-hover:text-blue-700 transition-colors">
                              {pkg.title}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono tabular-nums">{pkg.id}</span>
                              <span aria-hidden="true">·</span>
                              <span>{pkg.difficulty}</span>
                              <span aria-hidden="true">·</span>
                              <span>{pkg.origin}</span>
                            </div>
                          </button>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-mono text-xs text-slate-800">
                            {pkg.repoSlug}@{pkg.baseVersionTag}
                          </div>
                          <div className="font-mono text-xs text-slate-500 tabular-nums">
                            {pkg.baseCommitSha} · {pkg.targetFile}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="text-xs font-medium text-slate-800">
                            {pkg.variationAxis}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 truncate max-w-[220px]">
                            {pkg.behavioralTags.join(' · ')}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {report ? (
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-medium font-mono tabular-nums ${
                                report.overallPassed ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {report.overallPassed ? (
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>
                                {report.gatesPassed}/{report.totalGates} pass
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">Unverified</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                          {killed}/{totalM} killed
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => onExportPackage(pkg)}
                              aria-label={`Export ${pkg.id} JSON`}
                              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
                              title="Download package JSON"
                            >
                              <Download className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onSelectPackage(pkg.id)}
                              aria-label={`Inspect ${pkg.id} ${pkg.title}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
                            >
                              <span>Inspect</span>
                              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Behavioral Variation Evidence */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Behavioral Variation Audit
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Deterministic differentiation across task rules, state transitions, and repository
            surfaces — verifying variation in behavior rather than superficial renaming.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">
              Coverage by Variation Axis
            </h3>
            <div className="space-y-3">
              {VARIATION_AXES.map((axis) => {
                const count = variation.axisDistribution[axis] ?? 0;
                const pct =
                  packages.length > 0 ? Math.round((count / packages.length) * 100) : 0;
                return (
                  <div key={axis} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{axis}</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {count} {count === 1 ? 'task' : 'tasks'} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-700 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">
              Pairwise Behavioral Distance
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-2 font-medium">Task Pair</th>
                    <th className="pb-2 font-medium">Scope</th>
                    <th className="pb-2 font-medium text-right">Jaccard Distance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {variation.pairwiseSimilarity.slice(0, 6).map((pair) => (
                    <tr key={`${pair.leftId}-${pair.rightId}`}>
                      <td className="py-2 font-mono text-slate-800 tabular-nums">
                        {pair.leftId} vs {pair.rightId}
                      </td>
                      <td className="py-2 text-slate-600">
                        {pair.sameRepo ? 'Same repo · Different axis' : 'Cross-repository'}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums font-medium text-slate-900">
                        {Math.round(pair.behavioralDistance * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
