import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Play,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type {
  CandidateEvaluationReport,
  RepositorySnapshot,
  SuiteRunResult,
  TaskPackage,
  ValidationReport,
} from '../lib/types';
import { computeLineDiff } from '../lib/variationAnalyzer';

interface PackageInspectorProps {
  pkg: TaskPackage;
  repo: RepositorySnapshot;
  onBack: () => void;
  onValidationUpdated: (pkgId: string, report: ValidationReport) => void;
  onExportPackage: (pkg: TaskPackage) => void;
}

type InspectorTab = 'requirements' | 'validation' | 'code' | 'sandbox';

function SuiteDetailsList({ suite }: { suite: SuiteRunResult }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-medium text-slate-700">{suite.suiteName}</span>
        <span className="font-mono tabular-nums">
          {suite.passedCount}/{suite.total} passed · {suite.durationMs}ms
        </span>
      </div>
      {suite.compileError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs font-mono text-red-800 whitespace-pre-wrap">
          {suite.compileError}
        </div>
      )}
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md bg-white">
        {suite.cases.map((tc) => (
          <li key={tc.name} className="px-3.5 py-2.5 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                {tc.passed ? (
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-emerald-700 mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle
                    className="h-3.5 w-3.5 text-red-700 mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="text-slate-800 break-words">{tc.name}</span>
              </div>
              <span className="font-mono tabular-nums text-slate-500 shrink-0">
                {tc.durationMs}ms
              </span>
            </div>
            {tc.error && (
              <div className="mt-1.5 ml-5.5 font-mono text-[11px] text-red-700 bg-red-50/70 px-2.5 py-1.5 rounded">
                {tc.error}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PackageInspector({
  pkg,
  repo,
  onBack,
  onValidationUpdated,
  onExportPackage,
}: PackageInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('requirements');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Candidate Evaluator state
  const baseCode = useMemo(
    () => repo.sourceFiles.find((f) => f.path === pkg.targetFile)?.content ?? '',
    [repo, pkg.targetFile],
  );
  const [candidateCode, setCandidateCode] = useState<string>(pkg.referenceImplementation);
  const [candidatePresetLabel, setCandidatePresetLabel] = useState<string>('Reference Implementation');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidateReport, setCandidateReport] = useState<CandidateEvaluationReport | null>(null);

  const diffLines = useMemo(
    () => computeLineDiff(baseCode, pkg.referenceImplementation),
    [baseCode, pkg.referenceImplementation],
  );
  const addedCount = diffLines.filter((d) => d.type === 'added').length;
  const removedCount = diffLines.filter((d) => d.type === 'removed').length;

  const handleRunValidation = async () => {
    setIsValidating(true);
    setValidationError(null);
    try {
      const resp = await fetch('/api/pipeline/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskPackage: pkg }),
      });
      const data = (await resp.json()) as { report?: ValidationReport; error?: string };
      if (!resp.ok || !data.report) {
        throw new Error(data.error ?? 'Validation request failed');
      }
      onValidationUpdated(pkg.id, data.report);
      setActiveTab('validation');
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleRunCandidate = async () => {
    if (!candidateCode.trim()) {
      setCandidateError('Candidate implementation cannot be empty.');
      return;
    }
    setIsEvaluating(true);
    setCandidateError(null);
    try {
      const resp = await fetch('/api/pipeline/evaluate-candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskPackage: pkg, candidateCode }),
      });
      const data = (await resp.json()) as { report?: CandidateEvaluationReport; error?: string };
      if (!resp.ok || !data.report) {
        throw new Error(data.error ?? 'Candidate evaluation failed');
      }
      setCandidateReport(data.report);
    } catch (err) {
      setCandidateError(err instanceof Error ? err.message : 'Candidate evaluation failed');
    } finally {
      setIsEvaluating(false);
    }
  };

  const report = pkg.lastValidation;

  return (
    <div className="space-y-6">
      {/* Top Summary Header */}
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Task Packages</span>
        </button>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {pkg.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono text-slate-700">{pkg.id}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700">
                {pkg.repoSlug}@{pkg.baseVersionTag} ({pkg.baseCommitSha})
              </span>
              <span aria-hidden="true">·</span>
              <span>{pkg.variationAxis}</span>
              <span aria-hidden="true">·</span>
              <span>{pkg.difficulty}</span>
              {report && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-medium font-mono tabular-nums ${
                      report.overallPassed ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {report.gatesPassed}/{report.totalGates} Gates Verified ({report.totalDurationMs}ms)
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onExportPackage(pkg)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              onClick={handleRunValidation}
              disabled={isValidating}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'sandbox'
                  ? 'text-slate-700 bg-white border border-slate-300 hover:bg-slate-50'
                  : 'text-white bg-blue-700 hover:bg-blue-800'
              }`}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isValidating ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isValidating ? 'Running 5 Gates...' : 'Run 5-Gate Validation'}</span>
            </button>
          </div>
        </div>

        {validationError && (
          <div
            role="alert"
            className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800"
          >
            {validationError}
          </div>
        )}
      </div>

      {/* Inspector Tabs */}
      <div
        role="tablist"
        aria-label="Task package sections"
        className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto"
      >
        {(
          [
            { id: 'requirements', label: 'Requirements & Spec' },
            { id: 'validation', label: 'Validation Evidence & Mutants' },
            { id: 'code', label: `Reference Diff (+${addedCount} / -${removedCount}) & Tests` },
            { id: 'sandbox', label: 'Candidate Evaluator' },
          ] as Array<{ id: InspectorTab; label: string }>
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: Requirements */}
      {activeTab === 'requirements' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Problem Statement</h2>
                <p className="mt-2 text-sm text-slate-700 leading-relaxed">
                  {pkg.requirements.overview}
                </p>
              </div>

              <div className="pt-5 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Functional Rules & Contracts
                </h3>
                <ol className="mt-3 space-y-2.5 list-decimal list-inside text-sm text-slate-700 leading-relaxed">
                  {pkg.requirements.functionalRules.map((rule, idx) => (
                    <li key={idx}>{rule}</li>
                  ))}
                </ol>
              </div>

              <div className="pt-5 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Required Edge Cases
                </h3>
                <ul className="mt-3 space-y-2 list-disc list-inside text-sm text-slate-700 leading-relaxed">
                  {pkg.requirements.edgeCases.map((edge, idx) => (
                    <li key={idx}>{edge}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">Package Provenance</h3>
              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Repository</dt>
                  <dd className="font-mono text-slate-900">{pkg.repoSlug}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Pinned Version</dt>
                  <dd className="font-mono text-slate-900">{pkg.baseVersionTag}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Base Commit</dt>
                  <dd className="font-mono text-slate-900">{pkg.baseCommitSha}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Target Module</dt>
                  <dd className="font-mono text-slate-900">{pkg.targetFile}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Variation Axis</dt>
                  <dd className="text-slate-900 text-right">{pkg.variationAxis}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Behavioral Tags</dt>
                  <dd className="font-mono text-slate-700 text-right">
                    {pkg.behavioralTags.join(', ')}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Acceptance Criteria</h3>
                <ul className="mt-2.5 space-y-2 list-disc list-inside text-xs text-slate-700 leading-relaxed">
                  {pkg.requirements.acceptanceCriteria.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">Explicitly Out of Scope</h3>
                <ul className="mt-2.5 space-y-1.5 list-disc list-inside text-xs text-slate-600 leading-relaxed">
                  {pkg.requirements.outOfScope.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Validation Evidence & Mutants */}
      {activeTab === 'validation' && (
        <div className="space-y-6">
          {!report ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center space-y-3">
              <p className="text-sm font-medium text-slate-900">
                No validation run recorded yet for {pkg.id}.
              </p>
              <button
                type="button"
                onClick={handleRunValidation}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800"
              >
                Run 5-Gate Validation Now
              </button>
            </div>
          ) : (
            <>
              {/* 5-Gate Table */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Five-Gate Automated Verification Protocol
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    Executed in {report.totalDurationMs}ms
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                        <th className="py-2.5 px-4 font-medium">Gate</th>
                        <th className="py-2.5 px-4 font-medium">Verification Condition</th>
                        <th className="py-2.5 px-4 font-medium">Observed Result</th>
                        <th className="py-2.5 px-4 font-medium text-right">Duration</th>
                        <th className="py-2.5 px-4 font-medium text-right">Verdict</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {report.gates.map((gate, idx) => (
                        <tr key={gate.id}>
                          <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                            0{idx + 1}. {gate.label}
                          </td>
                          <td className="py-3 px-4 text-slate-600">{gate.expected}</td>
                          <td className="py-3 px-4 font-mono text-slate-700">{gate.detail}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                            {gate.durationMs}ms
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 font-medium ${
                                gate.passed ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {gate.passed ? (
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>{gate.passed ? 'Pass' : 'Fail'}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Fault-Injection Mutants Evidence */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Fault-Injection Mutant Matrix
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Proves feature tests catch subtle behavioral bugs, not merely missing exports.
                    </p>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-600">
                    {report.mutantResults.filter((m) => m.killed).length}/
                    {report.mutantResults.length} mutants killed
                  </span>
                </div>
                <div className="divide-y divide-slate-200">
                  {report.mutantResults.map((mutant) => (
                    <div
                      key={mutant.mutantId}
                      className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-4"
                    >
                      <div className="space-y-1 max-w-2xl">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-medium text-slate-900">
                            {mutant.mutantId}
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span className="font-medium text-slate-700">
                            {mutant.faultCategory}
                          </span>
                        </div>
                        <div className="text-sm font-medium text-slate-900">{mutant.label}</div>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {mutant.description}
                        </p>
                        {mutant.failedTests.length > 0 && (
                          <div className="pt-1 text-xs text-slate-600">
                            <span className="font-medium text-slate-700">Caught by: </span>
                            <span className="font-mono">{mutant.failedTests.join('; ')}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            const matched = pkg.mutants.find((m) => m.id === mutant.mutantId);
                            if (matched) {
                              setCandidateCode(matched.mutatedCode);
                              setCandidatePresetLabel(`${matched.id}: ${matched.label}`);
                              setCandidateReport(null);
                              setActiveTab('sandbox');
                            }
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          Inspect in Sandbox
                        </button>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium font-mono whitespace-nowrap ${
                            mutant.killed ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {mutant.killed ? (
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span>{mutant.killed ? 'Killed' : 'Survived'}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Raw Per-Test Execution Logs */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SuiteDetailsList suite={report.referenceFeatureSuite} />
                <SuiteDetailsList suite={report.referenceRegressionSuite} />
              </div>
              <SuiteDetailsList suite={report.failToPassSuite} />
            </>
          )}
        </div>
      )}

      {/* TAB 3: Reference Diff & Tests */}
      {activeTab === 'code' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-xs font-mono text-slate-800">
                {pkg.targetFile} (Base {pkg.baseCommitSha} → Reference Solution)
              </div>
              <div className="text-xs font-mono tabular-nums space-x-2">
                <span className="text-emerald-700">+{addedCount}</span>
                <span className="text-red-700">-{removedCount}</span>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[460px] overflow-y-auto bg-slate-950 text-slate-100 text-xs font-mono leading-5">
              {diffLines.map((line, idx) => (
                <div
                  key={idx}
                  className={`flex px-3 whitespace-pre ${
                    line.type === 'added'
                      ? 'bg-emerald-950/70 text-emerald-200'
                      : line.type === 'removed'
                        ? 'bg-red-950/70 text-red-200'
                        : 'text-slate-300'
                  }`}
                >
                  <span className="w-9 shrink-0 select-none text-right pr-3 text-slate-500 tabular-nums">
                    {line.lineNumberOld ?? ''}
                  </span>
                  <span className="w-9 shrink-0 select-none text-right pr-3 text-slate-500 tabular-nums">
                    {line.lineNumberNew ?? ''}
                  </span>
                  <span className="w-4 shrink-0 select-none">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 text-xs font-mono text-slate-800">
                tests/feature.test.ts (New Feature Tests)
              </div>
              <pre className="p-4 text-xs font-mono text-slate-800 bg-slate-50 overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
                {pkg.featureTests}
              </pre>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 text-xs font-mono text-slate-800">
                {repo.regressionTestFile.path} (Existing Regression Guard)
              </div>
              <pre className="p-4 text-xs font-mono text-slate-800 bg-slate-50 overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
                {repo.regressionTestFile.content}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Interactive Candidate Evaluator */}
      {activeTab === 'sandbox' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Interactive Candidate Solution Evaluator
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Load the base repo, reference solution, or a broken mutant — or edit the
                  TypeScript code below — to verify how this task evaluates an AI candidate.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRunCandidate}
                disabled={isEvaluating}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isEvaluating ? 'Evaluating...' : 'Run Evaluation Suite'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-medium text-slate-500">Load preset:</span>
              <button
                type="button"
                onClick={() => {
                  setCandidateCode(baseCode);
                  setCandidatePresetLabel('Unmodified Base Repo');
                  setCandidateReport(null);
                }}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                Unmodified Base
              </button>
              <button
                type="button"
                onClick={() => {
                  setCandidateCode(pkg.referenceImplementation);
                  setCandidatePresetLabel('Reference Implementation');
                  setCandidateReport(null);
                }}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                Reference Solution
              </button>
              {pkg.mutants.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setCandidateCode(m.mutatedCode);
                    setCandidatePresetLabel(`${m.id}: ${m.label}`);
                    setCandidateReport(null);
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                >
                  {m.id} ({m.faultCategory})
                </button>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="candidate-code-editor"
                  className="text-xs font-mono text-slate-700"
                >
                  {pkg.targetFile} · Loaded: {candidatePresetLabel}
                </label>
              </div>
              <textarea
                id="candidate-code-editor"
                value={candidateCode}
                onChange={(e) => setCandidateCode(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full p-3.5 font-mono text-xs bg-slate-950 text-slate-100 border border-slate-300 rounded-md focus:outline-none focus:border-blue-600 leading-relaxed"
              />
            </div>

            {candidateError && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800"
              >
                {candidateError}
              </div>
            )}
          </div>

          {candidateReport && (
            <div className="space-y-4">
              <div
                className={`p-4 border rounded-lg flex items-center justify-between ${
                  candidateReport.overallPassed
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-red-50/70 border-red-200 text-red-900'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {candidateReport.overallPassed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-700" aria-hidden="true" />
                  )}
                  <span>
                    {candidateReport.overallPassed
                      ? 'Candidate Passed All Feature & Regression Checks'
                      : 'Candidate Failed Evaluation Suite'}
                  </span>
                </div>
                <span className="text-xs font-mono tabular-nums">
                  {candidateReport.totalDurationMs}ms
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SuiteDetailsList suite={candidateReport.featureSuite} />
                <SuiteDetailsList suite={candidateReport.regressionSuite} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
