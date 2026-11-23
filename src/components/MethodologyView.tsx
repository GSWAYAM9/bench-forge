export function MethodologyView() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Pipeline Architecture & Limitations
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
          Engineering rationale, validation invariants, resource discipline, and an explicit
          statement of what this Coding Task Factory guarantees — and what sits outside its
          current scope.
        </p>
      </div>

      {/* Section 1: 5-Gate Validation */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          01. Five-Gate Automated Validation Protocol
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Generating a coding prompt is easy; proving that the prompt is solvable, non-trivial,
          backward-compatible, and rigorously tested requires execution evidence across five
          independent gates:
        </p>
        <ol className="space-y-3 text-sm text-slate-700 leading-relaxed">
          <li>
            <span className="font-semibold text-slate-900">Baseline Repository Healthy:</span>{' '}
            Confirms the pinned starting commit passes 100% of its existing regression tests before
            any task is derived from it.
          </li>
          <li>
            <span className="font-semibold text-slate-900">Fail-to-Pass Verification:</span>{' '}
            Executes the newly synthesized feature tests against the unmodified base repository.
            At least one test must fail, guaranteeing the task is not vacuously satisfied.
          </li>
          <li>
            <span className="font-semibold text-slate-900">Reference Solvability:</span> Applies
            the generated reference patch and runs all feature tests, proving the specification is
            implementable and internally consistent.
          </li>
          <li>
            <span className="font-semibold text-slate-900">Regression Protection:</span> Executes
            the original repository regression suite against the reference patch to ensure the new
            feature does not break existing API contracts.
          </li>
          <li>
            <span className="font-semibold text-slate-900">Fault-Detection Strength (Mutation Killing):</span>{' '}
            Injects realistic, compilable domain bugs (off-by-one thresholds, greedy sub-optimality,
            non-atomic quota deductions, linear backoff) that still pass existing regression tests.
            Every mutant must fail the feature test suite to prove the tests catch subtle errors.
          </li>
        </ol>
      </section>

      {/* Section 2: Meaningful Variation */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          02. Behavioral Variation Over Cosmetic Perturbation
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Instead of multiplying task count by swapping variable names or copy, the pipeline
          parameterizes generation across five orthogonal behavioral axes:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 text-xs">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-1">
            <div className="font-semibold text-slate-900">Eligibility &amp; Thresholds</div>
            <p className="text-slate-600 leading-relaxed">
              Allowlist/denylist filtering, post-exclusion spend thresholds, and clamped discount
              caps (demonstrated in PKG-001).
            </p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-1">
            <div className="font-semibold text-slate-900">Conflict Resolution &amp; Precedence</div>
            <p className="text-slate-600 leading-relaxed">
              Exclusive unit consumption and combinatorial optimization over overlapping rules with
              deterministic tie-breaking (PKG-002 on the same CartCore repo).
            </p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-1">
            <div className="font-semibold text-slate-900">Stateful Lifecycle Transitions</div>
            <p className="text-slate-600 leading-relaxed">
              Geometric backoff scheduling, dead-letter quarantine, idempotency deduplication, and
              manual requeue flows (PKG-003 on TaskQueue).
            </p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-1">
            <div className="font-semibold text-slate-900">Quota &amp; Burst Invariants</div>
            <p className="text-slate-600 leading-relaxed">
              Weighted request accounting, burst reserve spillovers, atomic rejection without
              partial mutation, and tenant overrides (PKG-004 on RateGuard).
            </p>
          </div>
        </div>
      </section>

      {/* Section 3: Sandbox & Resource Engineering */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          03. Execution Safety &amp; Resource Discipline
        </h2>
        <ul className="space-y-2.5 list-disc list-inside text-sm text-slate-700 leading-relaxed">
          <li>
            TypeScript modules are transpiled in-memory via <span className="font-mono text-xs">esbuild</span>{' '}
            and executed inside an isolated Node <span className="font-mono text-xs">vm.Context</span>{' '}
            with zero shell spawning and zero disk writes.
          </li>
          <li>
            Virtual module resolution blocks all host built-ins (<span className="font-mono text-xs">fs</span>,{' '}
            <span className="font-mono text-xs">child_process</span>, network modules) and enforces a
            strict <span className="font-mono text-xs">1200ms</span> timeout per test case to defeat
            infinite loops.
          </li>
          <li>
            Gemini synthesis uses structured JSON schemas and caps automated sandbox-guided repair
            at 1 retry pass so token usage remains predictable and bounded.
          </li>
        </ul>
      </section>

      {/* Section 4: Honest Statement of Limitations */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          04. Honest Statement of Limitations
        </h2>
        <ul className="space-y-2.5 list-disc list-inside text-sm text-slate-700 leading-relaxed">
          <li>
            <span className="font-medium text-slate-900">Single-process TypeScript scope:</span>{' '}
            The in-memory VM sandbox targets deterministic, pure-logic TypeScript modules. Multi-service
            architectures, native binaries, database migrations, or asynchronous network I/O require
            containerized runners (e.g., ephemeral Docker/Firecracker sandboxes).
          </li>
          <li>
            <span className="font-medium text-slate-900">Model-generated mutant quality:</span>{' '}
            When synthesizing brand-new tasks live via Gemini, the model authors both tests and
            mutants. While Gate 5 verifies that generated mutants are killed, human or cross-model
            review remains valuable for auditing specification ambiguity and hidden test leakage.
          </li>
          <li>
            <span className="font-medium text-slate-900">Deterministic clock assumption:</span>{' '}
            Time-sensitive tasks (backoff, rate-limit windows) rely on injected clock parameters
            (<span className="font-mono text-xs">nowMs</span>) to guarantee millisecond-fast,
            flake-free verification.
          </li>
        </ul>
      </section>
    </div>
  );
}
