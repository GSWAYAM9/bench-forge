import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_REPOSITORIES, getRepositoryById } from './src/lib/repositories.ts';
import { SAMPLE_TASK_PACKAGES } from './src/lib/samplePackages.ts';
import {
  evaluateCandidateCode,
  runRepoBaselineTests,
  validateTaskPackage,
} from './src/lib/sandboxRunner.ts';
import { VARIATION_AXES } from './src/lib/variationAnalyzer.ts';
import { generateAndValidateTaskPackage } from './src/server/geminiGenerator.ts';
import type { TaskDifficulty, TaskPackage, VariationAxis } from './src/lib/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

let cachedValidatedSamples: TaskPackage[] | null = null;

function getValidatedSamplePackages(): TaskPackage[] {
  if (cachedValidatedSamples) {
    return cachedValidatedSamples;
  }
  cachedValidatedSamples = SAMPLE_TASK_PACKAGES.map((pkg) => {
    const repo = getRepositoryById(pkg.repoId);
    if (!repo) return pkg;
    const report = validateTaskPackage(pkg, repo);
    return {
      ...pkg,
      lastValidation: report,
    };
  });
  return cachedValidatedSamples;
}

function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 0 && key !== 'MY_GEMINI_API_KEY');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/bootstrap', (_req, res) => {
    try {
      const packages = getValidatedSamplePackages();
      res.json({
        repositories: SAMPLE_REPOSITORIES,
        packages,
        geminiConfigured: isGeminiConfigured(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to initialize task factory state',
      });
    }
  });

  app.post('/api/repos/baseline', (req, res) => {
    try {
      const { repoId, overrideSource } = req.body as {
        repoId?: string;
        overrideSource?: string;
      };
      if (!repoId || typeof repoId !== 'string') {
        res.status(400).json({ error: 'repoId is required' });
        return;
      }
      const repo = getRepositoryById(repoId);
      if (!repo) {
        res.status(404).json({ error: `Repository "${repoId}" not found` });
        return;
      }
      const result = runRepoBaselineTests(
        repo,
        typeof overrideSource === 'string' ? overrideSource : undefined,
      );
      res.json({ result });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to execute baseline tests',
      });
    }
  });

  app.post('/api/pipeline/validate', (req, res) => {
    try {
      const { taskPackage } = req.body as { taskPackage?: TaskPackage };
      if (!taskPackage || typeof taskPackage !== 'object' || !taskPackage.repoId) {
        res.status(400).json({ error: 'Valid taskPackage payload with repoId is required' });
        return;
      }
      const repo = getRepositoryById(taskPackage.repoId);
      if (!repo) {
        res.status(404).json({ error: `Repository "${taskPackage.repoId}" not found` });
        return;
      }
      const report = validateTaskPackage(taskPackage, repo);
      res.json({ report });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Validation run failed',
      });
    }
  });

  app.post('/api/pipeline/evaluate-candidate', (req, res) => {
    try {
      const { taskPackage, candidateCode } = req.body as {
        taskPackage?: TaskPackage;
        candidateCode?: string;
      };
      if (!taskPackage || typeof candidateCode !== 'string' || !candidateCode.trim()) {
        res.status(400).json({ error: 'taskPackage and non-empty candidateCode are required' });
        return;
      }
      const repo = getRepositoryById(taskPackage.repoId);
      if (!repo) {
        res.status(404).json({ error: `Repository "${taskPackage.repoId}" not found` });
        return;
      }
      const report = evaluateCandidateCode(taskPackage, repo, candidateCode);
      res.json({ report });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Candidate evaluation failed',
      });
    }
  });

  app.post('/api/pipeline/generate', async (req, res) => {
    try {
      const { repoId, variationAxis, difficulty, customDirective, existingTitles, nextId } =
        req.body as {
          repoId?: string;
          variationAxis?: VariationAxis;
          difficulty?: TaskDifficulty;
          customDirective?: string;
          existingTitles?: string[];
          nextId?: string;
        };

      if (!repoId || typeof repoId !== 'string') {
        res.status(400).json({ error: 'repoId is required' });
        return;
      }
      const repo = getRepositoryById(repoId);
      if (!repo) {
        res.status(404).json({ error: `Repository "${repoId}" not found` });
        return;
      }

      const safeAxis: VariationAxis =
        variationAxis && VARIATION_AXES.includes(variationAxis)
          ? variationAxis
          : 'Eligibility & Thresholds';
      const safeDifficulty: TaskDifficulty =
        difficulty === 'Standard' || difficulty === 'Advanced' || difficulty === 'Expert'
          ? difficulty
          : 'Standard';

      const result = await generateAndValidateTaskPackage({
        repo,
        variationAxis: safeAxis,
        difficulty: safeDifficulty,
        customDirective:
          typeof customDirective === 'string' ? customDirective.trim().slice(0, 400) : undefined,
        existingTitles: Array.isArray(existingTitles)
          ? existingTitles.filter((t): t is string => typeof t === 'string').slice(0, 20)
          : [],
        nextId:
          typeof nextId === 'string' && /^PKG-\d{3,4}$/.test(nextId)
            ? nextId
            : `PKG-${String(Date.now()).slice(-3)}`,
      });

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Task generation failed';
      const customStatus = (err as { statusCode?: number }).statusCode;
      const status =
        typeof customStatus === 'number' && customStatus >= 400 && customStatus < 600
          ? customStatus
          : message.includes('GEMINI_API_KEY')
            ? 400
            : 500;
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BenchForge server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
