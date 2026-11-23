import type { RepositorySnapshot } from './types.ts';

export const SAMPLE_REPOSITORIES: RepositorySnapshot[] = [
  {
    id: 'repo-cart-core',
    name: 'CartCore',
    slug: 'cart-core',
    versionTag: 'v1.4.2',
    commitSha: 'a8f3d21',
    stack: 'TypeScript · Pure Domain Library',
    summary:
      'Shopping-cart state and checkout pricing engine supporting line items, quantity updates, tax calculation, and immutable totals.',
    entryFile: 'src/cart.ts',
    sourceFiles: [
      {
        path: 'src/cart.ts',
        content: `export interface CartItem {
  sku: string;
  name: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
}

export interface CartSummary {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  itemCount: number;
}

export class ShoppingCart {
  private items: Map<string, CartItem> = new Map();
  private taxRate: number;

  constructor(taxRate = 0.08) {
    if (taxRate < 0 || taxRate > 0.5) {
      throw new Error('Tax rate must be between 0 and 0.5');
    }
    this.taxRate = taxRate;
  }

  addItem(item: CartItem): void {
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new Error('Unit price must be a non-negative integer in cents');
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('Quantity must be a positive integer');
    }
    const existing = this.items.get(item.sku);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      this.items.set(item.sku, { ...item });
    }
  }

  updateQuantity(sku: string, quantity: number): void {
    if (!this.items.has(sku)) {
      throw new Error(\`Item \${sku} not found in cart\`);
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error('Quantity must be a non-negative integer');
    }
    if (quantity === 0) {
      this.items.delete(sku);
      return;
    }
    const existing = this.items.get(sku)!;
    existing.quantity = quantity;
  }

  removeItem(sku: string): boolean {
    return this.items.delete(sku);
  }

  getItems(): CartItem[] {
    return Array.from(this.items.values()).map((item) => ({ ...item }));
  }

  getSubtotalCents(): number {
    let total = 0;
    for (const item of this.items.values()) {
      total += item.unitPriceCents * item.quantity;
    }
    return total;
  }

  getSummary(): CartSummary {
    const subtotalCents = this.getSubtotalCents();
    const discountCents = 0;
    const taxableCents = Math.max(0, subtotalCents - discountCents);
    const taxCents = Math.round(taxableCents * this.taxRate);
    const itemCount = Array.from(this.items.values()).reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    return {
      subtotalCents,
      discountCents,
      taxCents,
      totalCents: taxableCents + taxCents,
      itemCount,
    };
  }
}
`,
      },
    ],
    regressionTestFile: {
      path: 'tests/cart.regression.test.ts',
      content: `import { ShoppingCart } from '../src/cart';

test('calculates subtotal, tax, and total for multiple items', () => {
  const cart = new ShoppingCart(0.1);
  cart.addItem({ sku: 'BOOK-1', name: 'Algorithms', category: 'books', unitPriceCents: 2500, quantity: 2 });
  cart.addItem({ sku: 'MUG-1', name: 'Ceramic Mug', category: 'home', unitPriceCents: 1500, quantity: 1 });

  const summary = cart.getSummary();
  assert.equal(summary.subtotalCents, 6500);
  assert.equal(summary.discountCents, 0);
  assert.equal(summary.taxCents, 650);
  assert.equal(summary.totalCents, 7150);
  assert.equal(summary.itemCount, 3);
});

test('merges quantities when adding duplicate SKU and removes on zero update', () => {
  const cart = new ShoppingCart(0);
  cart.addItem({ sku: 'PEN-1', name: 'Gel Pen', category: 'office', unitPriceCents: 300, quantity: 2 });
  cart.addItem({ sku: 'PEN-1', name: 'Gel Pen', category: 'office', unitPriceCents: 300, quantity: 3 });

  assert.equal(cart.getItems()[0].quantity, 5);
  assert.equal(cart.getSubtotalCents(), 1500);

  cart.updateQuantity('PEN-1', 0);
  assert.equal(cart.getItems().length, 0);
});

test('rejects invalid unit prices, quantities, and tax rates', () => {
  assert.throws(() => new ShoppingCart(-0.05));
  const cart = new ShoppingCart(0.08);
  assert.throws(() =>
    cart.addItem({ sku: 'BAD', name: 'Bad', category: 'misc', unitPriceCents: -100, quantity: 1 }),
  );
  assert.throws(() =>
    cart.addItem({ sku: 'BAD2', name: 'Bad2', category: 'misc', unitPriceCents: 100, quantity: 0 }),
  );
});
`,
    },
  },
  {
    id: 'repo-task-queue',
    name: 'TaskQueue',
    slug: 'task-queue',
    versionTag: 'v2.1.0',
    commitSha: '7c1e904',
    stack: 'TypeScript · Priority Job Scheduler',
    summary:
      'In-memory priority job queue with deterministic FIFO tie-breaking, worker concurrency caps, and explicit completion tracking.',
    entryFile: 'src/queue.ts',
    sourceFiles: [
      {
        path: 'src/queue.ts',
        content: `export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobInput {
  id: string;
  type: string;
  priority: number;
  payload?: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  type: string;
  priority: number;
  payload: Record<string, unknown>;
  status: JobStatus;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export class PriorityTaskQueue {
  private jobs: Map<string, JobRecord> = new Map();
  private sequence = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent = 2) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrent must be an integer >= 1');
    }
    this.maxConcurrent = maxConcurrent;
  }

  enqueue(input: JobInput, now = Date.now()): JobRecord {
    if (!input.id || this.jobs.has(input.id)) {
      throw new Error(\`Duplicate or empty job id: \${input.id}\`);
    }
    const record: JobRecord = {
      id: input.id,
      type: input.type,
      priority: input.priority,
      payload: input.payload ? { ...input.payload } : {},
      status: 'queued',
      enqueuedAt: now + this.sequence * 0.0001,
    };
    this.sequence += 1;
    this.jobs.set(record.id, record);
    return { ...record };
  }

  claimNext(now = Date.now()): JobRecord | null {
    const runningCount = this.listByStatus('running').length;
    if (runningCount >= this.maxConcurrent) {
      return null;
    }
    const queued = this.listByStatus('queued');
    if (queued.length === 0) {
      return null;
    }
    queued.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enqueuedAt - b.enqueuedAt;
    });
    const next = this.jobs.get(queued[0].id)!;
    next.status = 'running';
    next.startedAt = now;
    return { ...next };
  }

  complete(jobId: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      throw new Error(\`Job \${jobId} is not currently running\`);
    }
    job.status = 'completed';
    job.completedAt = now;
    return { ...job };
  }

  fail(jobId: string, errorMessage: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      throw new Error(\`Job \${jobId} is not currently running\`);
    }
    job.status = 'failed';
    job.error = errorMessage;
    job.completedAt = now;
    return { ...job };
  }

  getJob(jobId: string): JobRecord | undefined {
    const found = this.jobs.get(jobId);
    return found ? { ...found } : undefined;
  }

  listByStatus(status: JobStatus): JobRecord[] {
    return Array.from(this.jobs.values())
      .filter((job) => job.status === status)
      .map((job) => ({ ...job }));
  }
}
`,
      },
    ],
    regressionTestFile: {
      path: 'tests/queue.regression.test.ts',
      content: `import { PriorityTaskQueue } from '../src/queue';

test('claims highest priority jobs first with FIFO tie breaking', () => {
  const queue = new PriorityTaskQueue(3);
  queue.enqueue({ id: 'j1', type: 'email', priority: 1 }, 1000);
  queue.enqueue({ id: 'j2', type: 'billing', priority: 5 }, 1000);
  queue.enqueue({ id: 'j3', type: 'alert', priority: 5 }, 1000);

  assert.equal(queue.claimNext(1005)?.id, 'j2');
  assert.equal(queue.claimNext(1006)?.id, 'j3');
  assert.equal(queue.claimNext(1007)?.id, 'j1');
});

test('enforces maxConcurrent running limit until jobs complete', () => {
  const queue = new PriorityTaskQueue(1);
  queue.enqueue({ id: 'a', type: 'sync', priority: 2 }, 1000);
  queue.enqueue({ id: 'b', type: 'sync', priority: 1 }, 1000);

  const first = queue.claimNext(1010);
  assert.equal(first?.id, 'a');
  assert.equal(queue.claimNext(1020), null);

  queue.complete('a', 1030);
  assert.equal(queue.claimNext(1040)?.id, 'b');
});

test('tracks failure state and rejects duplicate IDs', () => {
  const queue = new PriorityTaskQueue(2);
  queue.enqueue({ id: 'dup', type: 'report', priority: 1 }, 1000);
  assert.throws(() => queue.enqueue({ id: 'dup', type: 'report', priority: 1 }, 1001));

  queue.claimNext(1010);
  const failed = queue.fail('dup', 'timeout', 1020);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'timeout');
});
`,
    },
  },
  {
    id: 'repo-rate-guard',
    name: 'RateGuard',
    slug: 'rate-guard',
    versionTag: 'v0.9.5',
    commitSha: 'e4b2a19',
    stack: 'TypeScript · API Quota Limiter',
    summary:
      'Fixed-window multi-tenant API rate limiter with deterministic clock injection, remaining quota introspection, and reset windows.',
    entryFile: 'src/limiter.ts',
    sourceFiles: [
      {
        path: 'src/limiter.ts',
        content: `export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

export interface LimiterConfig {
  windowMs: number;
  maxRequests: number;
}

interface TenantWindow {
  windowStartMs: number;
  used: number;
}

export class RateLimiter {
  private config: LimiterConfig;
  private tenants: Map<string, TenantWindow> = new Map();

  constructor(config: LimiterConfig) {
    if (config.windowMs <= 0 || config.maxRequests <= 0) {
      throw new Error('windowMs and maxRequests must be positive');
    }
    this.config = { ...config };
  }

  check(tenantId: string, nowMs: number): RateLimitDecision {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }
    let state = this.tenants.get(tenantId);
    if (!state || nowMs - state.windowStartMs >= this.config.windowMs) {
      state = { windowStartMs: nowMs, used: 0 };
      this.tenants.set(tenantId, state);
    }

    const resetAtMs = state.windowStartMs + this.config.windowMs;
    if (state.used + 1 > this.config.maxRequests) {
      return {
        allowed: false,
        remaining: Math.max(0, this.config.maxRequests - state.used),
        resetAtMs,
      };
    }

    state.used += 1;
    return {
      allowed: true,
      remaining: this.config.maxRequests - state.used,
      resetAtMs,
    };
  }

  getUsage(tenantId: string, nowMs: number): { used: number; remaining: number } {
    const state = this.tenants.get(tenantId);
    if (!state || nowMs - state.windowStartMs >= this.config.windowMs) {
      return { used: 0, remaining: this.config.maxRequests };
    }
    return {
      used: state.used,
      remaining: Math.max(0, this.config.maxRequests - state.used),
    };
  }

  resetTenant(tenantId: string): void {
    this.tenants.delete(tenantId);
  }
}
`,
      },
    ],
    regressionTestFile: {
      path: 'tests/limiter.regression.test.ts',
      content: `import { RateLimiter } from '../src/limiter';

test('allows requests up to maxRequests and blocks excess within window', () => {
  const limiter = new RateLimiter({ windowMs: 10000, maxRequests: 2 });
  const r1 = limiter.check('tenant-a', 1000);
  const r2 = limiter.check('tenant-a', 2000);
  const r3 = limiter.check('tenant-a', 3000);

  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 1);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);
  assert.equal(r3.allowed, false);
  assert.equal(r3.remaining, 0);
});

test('resets quota cleanly after windowMs elapses', () => {
  const limiter = new RateLimiter({ windowMs: 5000, maxRequests: 1 });
  assert.equal(limiter.check('t1', 0).allowed, true);
  assert.equal(limiter.check('t1', 4999).allowed, false);
  assert.equal(limiter.check('t1', 5000).allowed, true);
});

test('isolates quotas across tenants and supports manual reset', () => {
  const limiter = new RateLimiter({ windowMs: 10000, maxRequests: 1 });
  assert.equal(limiter.check('alpha', 100).allowed, true);
  assert.equal(limiter.check('beta', 100).allowed, true);
  assert.equal(limiter.check('alpha', 200).allowed, false);

  limiter.resetTenant('alpha');
  assert.equal(limiter.getUsage('alpha', 250).used, 0);
  assert.equal(limiter.check('alpha', 300).allowed, true);
});
`,
    },
  },
];

export function getRepositoryById(repoId: string): RepositorySnapshot | undefined {
  return SAMPLE_REPOSITORIES.find((repo) => repo.id === repoId);
}
