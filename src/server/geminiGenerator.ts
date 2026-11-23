import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  RepositorySnapshot,
  TaskDifficulty,
  TaskPackage,
  ValidationReport,
  VariationAxis,
} from '../lib/types.ts';
import { validateTaskPackage } from '../lib/sandboxRunner.ts';

const MAX_RETRIES = 1;
const RETRY_DELAYS_MS = [1000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatGeminiError(err: unknown): { message: string; retryable: boolean; statusCode: number } {
  const raw = err instanceof Error ? err.message : String(err);
  let parsedCode: number | undefined;
  let parsedMessage = raw;
  let parsedStatus = '';

  try {
    const obj = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
    if (obj?.error) {
      parsedCode = obj.error.code;
      parsedMessage = obj.error.message ?? raw;
      parsedStatus = obj.error.status ?? '';
    }
  } catch {
    // Plain error string
  }

  const lower = `${parsedStatus} ${parsedMessage}`.toLowerCase();
  if (parsedCode === 503 || lower.includes('unavailable') || lower.includes('high demand')) {
    return {
      message:
        'Gemini is temporarily experiencing high demand (503). Automatic retries were attempted—please click Generate again in a few seconds.',
      retryable: true,
      statusCode: 503,
    };
  }
  if (parsedCode === 429 || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return {
      message:
        'Gemini rate limit reached (429). Wait a moment and retry, or check your quota in Settings > Secrets.',
      retryable: true,
      statusCode: 429,
    };
  }
  if (parsedCode === 400 || parsedCode === 403 || lower.includes('api_key_invalid') || lower.includes('permission_denied')) {
    return {
      message:
        'Gemini API authentication failed. Please verify your GEMINI_API_KEY in Settings > Secrets.',
      retryable: false,
      statusCode: parsedCode ?? 403,
    };
  }
  return {
    message: parsedMessage,
    retryable: parsedCode !== undefined && parsedCode >= 500,
    statusCode: parsedCode && parsedCode >= 400 && parsedCode < 600 ? parsedCode : 500,
  };
}

async function generateStructuredJson(
  ai: GoogleGenAI,
  contents: string,
  systemInstruction: string,
  preferredModel?: string,
): Promise<{ text: string; modelUsed: string }> {
  const candidateModels =
    preferredModel === 'gemini-3.1-flash-lite'
      ? (['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const)
      : (['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const);
  let lastFormatted: { message: string; retryable: boolean; statusCode: number } | null = null;

  for (const model of candidateModels) {
    const isLastModel = model === candidateModels[candidateModels.length - 1];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const config =
          model === 'gemini-4-hydrogen'
            ? {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: TASK_PACKAGE_SCHEMA,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              }
            : {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: TASK_PACKAGE_SCHEMA,
              };

        const response = await ai.models.generateContent({
          model,
          contents,
          config,
        });
        const text = (response.text ?? '').trim();
        if (!text) {
          throw new Error('Gemini API returned an empty response during task synthesis.');
        }
        return { text, modelUsed: model };
      } catch (err) {
        const formatted = formatGeminiError(err);
        lastFormatted = formatted;
        // Immediately fail over to the fallback model on 503 high demand
        if (formatted.statusCode === 503 && !isLastModel) {
          break;
        }
        if (formatted.retryable && attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAYS_MS[attempt] ?? 1000);
          continue;
        }
        if (!isLastModel && formatted.retryable) {
          break;
        }
        const wrapped = new Error(formatted.message) as Error & { statusCode?: number };
        wrapped.statusCode = formatted.statusCode;
        throw wrapped;
      }
    }
  }

  const fallback = new Error(lastFormatted?.message ?? 'Gemini generation failed') as Error & {
    statusCode?: number;
  };
  fallback.statusCode = lastFormatted?.statusCode ?? 500;
  throw fallback;
}

export interface GenerateTaskInput {
  repo: RepositorySnapshot;
  variationAxis: VariationAxis;
  difficulty: TaskDifficulty;
  customDirective?: string;
  existingTitles?: string[];
  nextId: string;
}

export interface PipelineStageLog {
  stage: string;
  status: 'completed' | 'repaired' | 'warning';
  durationMs: number;
  summary: string;
}

export interface GeneratedTaskResult {
  taskPackage: TaskPackage;
  validation: ValidationReport;
  stages: PipelineStageLog[];
  repairAttempted: boolean;
}

interface RawGeminiPackage {
  title: string;
  behavioralTags: string[];
  overview: string;
  functionalRules: string[];
  edgeCases: string[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  referenceImplementation: string;
  featureTests: string;
  mutants: Array<{
    label: string;
    faultCategory: string;
    description: string;
    mutatedCode: string;
  }>;
}

const TASK_PACKAGE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Concise realistic engineering feature title.' },
    behavioralTags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3 to 5 lowercase kebab-case behavioral tags describing rules/mechanics.',
    },
    overview: { type: Type.STRING, description: 'Clear 1-2 sentence feature problem statement.' },
    functionalRules: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '4 to 5 exact, unambiguous behavioral requirements including method signatures.',
    },
    edgeCases: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3 concrete edge cases that must be handled cleanly.',
    },
    acceptanceCriteria: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '2 to 3 measurable acceptance criteria.',
    },
    outOfScope: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '2 explicit non-goals to keep scope bounded.',
    },
    referenceImplementation: {
      type: Type.STRING,
      description:
        'Complete drop-in TypeScript replacement for the repository entry file that keeps all existing exports/behaviors intact while implementing the new feature.',
    },
    featureTests: {
      type: Type.STRING,
      description:
        'Complete TypeScript test file importing from "../src/<entryBasename>" using global test(name, fn) and assert.equal / assert.deepEqual / assert.ok / assert.throws (do NOT import node:test or node:assert). Must contain 3 to 4 focused tests.',
    },
    mutants: {
      type: Type.ARRAY,
      description:
        'Exactly 2 realistic subtly buggy full-file TypeScript implementations of the entry file that compile and pass existing regression tests, but violate specific requirements so the feature tests MUST catch them.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          faultCategory: { type: Type.STRING },
          description: { type: Type.STRING },
          mutatedCode: { type: Type.STRING },
        },
        required: ['label', 'faultCategory', 'description', 'mutatedCode'],
      },
    },
  },
  required: [
    'title',
    'behavioralTags',
    'overview',
    'functionalRules',
    'edgeCases',
    'acceptanceCriteria',
    'outOfScope',
    'referenceImplementation',
    'featureTests',
    'mutants',
  ],
};

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets to run live task generation.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildGenerationPrompt(input: GenerateTaskInput): string {
  const entrySource = input.repo.sourceFiles.find((f) => f.path === input.repo.entryFile)?.content ?? '';
  const entryImportPath = '../' + input.repo.entryFile.replace(/\.ts$/, '');
  const existingNote =
    input.existingTitles && input.existingTitles.length > 0
      ? `Avoid duplicating or merely renaming these existing tasks:\n- ${input.existingTitles.join('\n- ')}`
      : '';

  return `You are designing a realistic, self-contained coding evaluation task package for an AI coding benchmark.

Target Repository: ${input.repo.name} (${input.repo.slug}@${input.repo.versionTag}, commit ${input.repo.commitSha})
Entry File: ${input.repo.entryFile}
Required Behavioral Variation Axis: ${input.variationAxis}
Difficulty Level: ${input.difficulty}
${input.customDirective ? `Additional Focus Directive: ${input.customDirective}` : ''}
${existingNote}

--- BASE SOURCE (${input.repo.entryFile}) ---
${entrySource}

--- EXISTING REGRESSION TESTS (${input.repo.regressionTestFile.path}) ---
${input.repo.regressionTestFile.content}

CRITICAL EXECUTION RULES (our server validates your output immediately in an isolated TypeScript VM):
1. Do NOT import any external npm packages or Node built-ins (no "node:test", no "node:assert", no "fs").
2. In featureTests, import the target module ONLY from "${entryImportPath}" and use the pre-injected globals:
   - test(name: string, fn: () => void)
   - assert.equal(a, b), assert.notEqual(a, b), assert.deepEqual(a, b), assert.ok(v), assert.throws(() => ...)
3. All tests must be synchronous and deterministic (no setTimeout, no Math.random, no external I/O).
4. Reference implementation MUST preserve 100% backward compatibility with the existing regression tests above.
5. Feature tests MUST FAIL on the unmodified base source (Fail-to-Pass) and PASS on your referenceImplementation.
6. Provide exactly 2 realistic behavioral mutants in "mutants". Each mutant must be a complete compilable TypeScript file for ${input.repo.entryFile} that introduces a subtle domain logic bug (e.g. boundary/off-by-one, wrong precedence, state leakage, non-atomic mutation) that causes at least one feature test to FAIL.
7. Design meaningful behavioral rules aligned with "${input.variationAxis}" rather than superficial field renaming.`;
}

function buildRepairPrompt(
  input: GenerateTaskInput,
  previous: RawGeminiPackage,
  report: ValidationReport,
): string {
  const failedGates = report.gates
    .filter((g) => !g.passed)
    .map((g) => `- ${g.label}: ${g.detail}`)
    .join('\n');

  const testErrors = [
    ...report.referenceFeatureSuite.cases
      .filter((c) => !c.passed)
      .map((c) => `Reference Feature Failure [${c.name}]: ${c.error}`),
    ...report.referenceRegressionSuite.cases
      .filter((c) => !c.passed)
      .map((c) => `Reference Regression Failure [${c.name}]: ${c.error}`),
    ...(report.referenceFeatureSuite.compileError
      ? [`Reference Feature Compile Error: ${report.referenceFeatureSuite.compileError}`]
      : []),
    ...report.mutantResults
      .filter((m) => !m.killed)
      .map((m) => `Surviving Mutant [${m.label}]: feature tests failed to catch this bug!`),
  ].join('\n');

  return `Your generated task package failed automated sandbox validation. Fix ONLY what is needed so all 5 validation gates pass cleanly.

Failed Gates:
${failedGates}

Exact Sandbox Diagnostics:
${testErrors || 'Check Fail-to-Pass and Mutant Killing gates.'}

Previous Package JSON:
${JSON.stringify(previous)}

Remember:
- No imports from node:test or node:assert; use globals test(...) and assert.*.
- Reference implementation must pass all feature tests AND all existing regression tests on ${input.repo.entryFile}.
- Feature tests must FAIL on the unmodified base repo and KILL both mutants.`;
}

function hydrateTaskPackage(
  raw: RawGeminiPackage,
  input: GenerateTaskInput,
): TaskPackage {
  return {
    id: input.nextId,
    title: raw.title.trim(),
    repoId: input.repo.id,
    repoSlug: input.repo.slug,
    baseVersionTag: input.repo.versionTag,
    baseCommitSha: input.repo.commitSha,
    variationAxis: input.variationAxis,
    difficulty: input.difficulty,
    createdAt: new Date().toISOString(),
    origin: 'Gemini Pipeline',
    targetFile: input.repo.entryFile,
    behavioralTags: raw.behavioralTags.slice(0, 5),
    requirements: {
      overview: raw.overview,
      functionalRules: raw.functionalRules,
      edgeCases: raw.edgeCases,
      acceptanceCriteria: raw.acceptanceCriteria,
      outOfScope: raw.outOfScope,
    },
    referenceImplementation: raw.referenceImplementation,
    featureTests: raw.featureTests,
    mutants: raw.mutants.slice(0, 3).map((m, idx) => ({
      id: `MUT-${input.nextId.replace('PKG-', '')}-${String.fromCharCode(65 + idx)}`,
      label: m.label,
      faultCategory: m.faultCategory,
      description: m.description,
      mutatedCode: m.mutatedCode,
    })),
  };
}

export async function generateAndValidateTaskPackage(
  input: GenerateTaskInput,
): Promise<GeneratedTaskResult> {
  const stages: PipelineStageLog[] = [];
  const ai = getGeminiClient();

  // Stage 1: Repository Analysis
  const t0 = performance.now();
  const entryFile = input.repo.sourceFiles.find((f) => f.path === input.repo.entryFile);
  if (!entryFile) {
    throw new Error(`Entry file ${input.repo.entryFile} missing from repository ${input.repo.slug}`);
  }
  const exportedCount = (entryFile.content.match(/export\s+(class|interface|type|function|const)/g) ?? []).length;
  stages.push({
    stage: 'Repository Snapshot Analysis',
    status: 'completed',
    durationMs: Math.round((performance.now() - t0) * 10) / 10,
    summary: `Indexed ${input.repo.slug}@${input.repo.versionTag} (${input.repo.commitSha}) · ${exportedCount} exported symbols`,
  });

  // Stage 2: Gemini Task Synthesis
  const t1 = performance.now();
  const synthesis = await generateStructuredJson(
    ai,
    buildGenerationPrompt(input),
    'You are a principal software evaluation engineer building deterministic, self-contained TypeScript coding benchmark tasks. Output strictly valid JSON matching the schema.',
  );

  let parsed: RawGeminiPackage;
  try {
    parsed = JSON.parse(synthesis.text) as RawGeminiPackage;
  } catch {
    throw new Error('Failed to parse structured JSON task package from Gemini output.');
  }

  stages.push({
    stage: 'Gemini Feature & Test Synthesis',
    status: 'completed',
    durationMs: Math.round((performance.now() - t1) * 10) / 10,
    summary: `Synthesized "${parsed.title}" via ${synthesis.modelUsed} with ${parsed.mutants.length} fault-injection mutants`,
  });

  // Stage 3: 5-Gate Sandbox Validation
  const t2 = performance.now();
  let pkg = hydrateTaskPackage(parsed, input);
  let validation = validateTaskPackage(pkg, input.repo);
  stages.push({
    stage: '5-Gate Sandbox Validation',
    status: validation.overallPassed ? 'completed' : 'warning',
    durationMs: Math.round((performance.now() - t2) * 10) / 10,
    summary: `${validation.gatesPassed}/${validation.totalGates} gates passed on initial pass`,
  });

  // Stage 4: Optional Single Automatic Repair Pass if any gate failed
  let repairAttempted = false;
  if (!validation.overallPassed) {
    repairAttempted = true;
    const t3 = performance.now();
    try {
      const repair = await generateStructuredJson(
        ai,
        buildRepairPrompt(input, parsed, validation),
        'You are repairing a TypeScript coding benchmark task package based on real sandbox test failures. Return strictly valid JSON matching the schema.',
        synthesis.modelUsed,
      );
      const repairedParsed = JSON.parse(repair.text) as RawGeminiPackage;
      pkg = hydrateTaskPackage(repairedParsed, input);
      validation = validateTaskPackage(pkg, input.repo);
      stages.push({
        stage: 'Sandbox-Guided Repair Pass',
        status: validation.overallPassed ? 'repaired' : 'warning',
        durationMs: Math.round((performance.now() - t3) * 10) / 10,
        summary: `${validation.gatesPassed}/${validation.totalGates} gates passed after automated repair (${repair.modelUsed})`,
      });
    } catch {
      stages.push({
        stage: 'Sandbox-Guided Repair Pass',
        status: 'warning',
        durationMs: Math.round((performance.now() - t3) * 10) / 10,
        summary: 'Repair pass did not complete; kept initial diagnostic report',
      });
    }
  }

  pkg.lastValidation = validation;

  return {
    taskPackage: pkg,
    validation,
    stages,
    repairAttempted,
  };
}
