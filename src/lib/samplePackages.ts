import type { TaskPackage } from './types.ts';

export const SAMPLE_TASK_PACKAGES: TaskPackage[] = [
  {
    id: 'PKG-001',
    title: 'Discount Codes with Eligibility Rules & Spend Thresholds',
    repoId: 'repo-cart-core',
    repoSlug: 'cart-core',
    baseVersionTag: 'v1.4.2',
    baseCommitSha: 'a8f3d21',
    variationAxis: 'Eligibility & Thresholds',
    difficulty: 'Standard',
    createdAt: '2026-11-18T14:20:00Z',
    origin: 'Sample',
    targetFile: 'src/cart.ts',
    behavioralTags: ['promo-eligibility', 'category-exclusions', 'spend-threshold', 'discount-capping'],
    requirements: {
      overview:
        'Extend ShoppingCart to register and apply promotional discount codes with category eligibility filters, minimum eligible spend thresholds, percentage/fixed discounts, and non-stackable replacement semantics.',
      functionalRules: [
        'Add registerPromoCode(promo: PromoCode) storing case-insensitive normalized codes (trimmed, uppercased) supporting kind: "percent" (1..100) or "fixed" (positive integer cents).',
        'Support optional eligibleCategories (allowlist), excludedCategories (denylist), minEligibleSubtotalCents threshold, and maxDiscountCents cap.',
        'Add applyPromoCode(code: string) returning { applied: boolean; reason?: string; discountCents: number }. Only one promo code may be active at a time; successfully applying a new code replaces any prior active code, while a rejected code must leave the previously active code intact.',
        'Compute discountCents in getSummary() dynamically against current eligible items so subsequent addItem/updateQuantity/removeItem calls re-evaluate threshold eligibility automatically.',
        'Tax must be calculated on post-discount subtotal (subtotalCents - discountCents), and discountCents must never exceed eligible subtotal.',
      ],
      edgeCases: [
        'If eligible items drop below minEligibleSubtotalCents after quantity removal, discountCents reverts to 0 without crashing.',
        'Fixed discounts exceeding the eligible item subtotal must clamp to the eligible subtotal rather than reducing ineligible items or creating negative totals.',
        'Whitespace and lowercase promo codes (e.g. " save20 ") must match registered codes.',
      ],
      acceptanceCriteria: [
        'Existing cart pricing, tax, and quantity behaviors pass all regression tests unchanged.',
        'Percentage discounts round to nearest cent via Math.round and obey maxDiscountCents.',
        'Rejected promo applications return descriptive reasons without clearing an already active valid code.',
      ],
      outOfScope: [
        'Multi-code stacking or coupon expiration clocks',
        'Persistent coupon redemption limits across carts',
      ],
    },
    referenceImplementation: `export interface CartItem {
  sku: string;
  name: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
}

export interface PromoCode {
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  minEligibleSubtotalCents?: number;
  eligibleCategories?: string[];
  excludedCategories?: string[];
  maxDiscountCents?: number;
}

export interface PromoApplyResult {
  applied: boolean;
  reason?: string;
  discountCents: number;
}

export interface CartSummary {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  itemCount: number;
  appliedPromoCode: string | null;
}

export class ShoppingCart {
  private items: Map<string, CartItem> = new Map();
  private taxRate: number;
  private promoRegistry: Map<string, PromoCode> = new Map();
  private activePromoCode: string | null = null;

  constructor(taxRate = 0.08) {
    if (taxRate < 0 || taxRate > 0.5) {
      throw new Error('Tax rate must be between 0 and 0.5');
    }
    this.taxRate = taxRate;
  }

  registerPromoCode(promo: PromoCode): void {
    const normalized = promo.code.trim().toUpperCase();
    if (!normalized) {
      throw new Error('Promo code cannot be empty');
    }
    if (promo.kind === 'percent' && (promo.value <= 0 || promo.value > 100)) {
      throw new Error('Percent discount must be between 1 and 100');
    }
    if (promo.kind === 'fixed' && (!Number.isInteger(promo.value) || promo.value <= 0)) {
      throw new Error('Fixed discount must be a positive integer in cents');
    }
    this.promoRegistry.set(normalized, {
      ...promo,
      code: normalized,
      eligibleCategories: promo.eligibleCategories ? [...promo.eligibleCategories] : undefined,
      excludedCategories: promo.excludedCategories ? [...promo.excludedCategories] : undefined,
    });
  }

  applyPromoCode(code: string): PromoApplyResult {
    const normalized = code.trim().toUpperCase();
    const promo = this.promoRegistry.get(normalized);
    if (!promo) {
      return { applied: false, reason: 'UNKNOWN_CODE', discountCents: this.computeActiveDiscount() };
    }
    const evaluation = this.evaluatePromo(promo);
    if (!evaluation.eligible) {
      return {
        applied: false,
        reason: evaluation.reason,
        discountCents: this.computeActiveDiscount(),
      };
    }
    this.activePromoCode = normalized;
    return {
      applied: true,
      discountCents: evaluation.discountCents,
    };
  }

  removePromoCode(): void {
    this.activePromoCode = null;
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

  private getEligibleSubtotal(promo: PromoCode): number {
    let eligible = 0;
    for (const item of this.items.values()) {
      if (promo.eligibleCategories && !promo.eligibleCategories.includes(item.category)) {
        continue;
      }
      if (promo.excludedCategories && promo.excludedCategories.includes(item.category)) {
        continue;
      }
      eligible += item.unitPriceCents * item.quantity;
    }
    return eligible;
  }

  private evaluatePromo(promo: PromoCode): { eligible: boolean; reason?: string; discountCents: number } {
    const eligibleSubtotal = this.getEligibleSubtotal(promo);
    if (eligibleSubtotal === 0) {
      return { eligible: false, reason: 'NO_ELIGIBLE_ITEMS', discountCents: 0 };
    }
    const threshold = promo.minEligibleSubtotalCents ?? 0;
    if (eligibleSubtotal < threshold) {
      return { eligible: false, reason: 'BELOW_MIN_SPEND', discountCents: 0 };
    }
    let rawDiscount =
      promo.kind === 'percent'
        ? Math.round((eligibleSubtotal * promo.value) / 100)
        : promo.value;
    if (promo.maxDiscountCents !== undefined) {
      rawDiscount = Math.min(rawDiscount, promo.maxDiscountCents);
    }
    const clamped = Math.min(rawDiscount, eligibleSubtotal);
    return { eligible: true, discountCents: clamped };
  }

  private computeActiveDiscount(): number {
    if (!this.activePromoCode) return 0;
    const promo = this.promoRegistry.get(this.activePromoCode);
    if (!promo) return 0;
    const result = this.evaluatePromo(promo);
    return result.eligible ? result.discountCents : 0;
  }

  getSummary(): CartSummary {
    const subtotalCents = this.getSubtotalCents();
    const discountCents = this.computeActiveDiscount();
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
      appliedPromoCode: discountCents > 0 ? this.activePromoCode : null,
    };
  }
}
`,
    featureTests: `import { ShoppingCart } from '../src/cart';

test('applies case-insensitive percent promo only to eligible categories with max cap and post-discount tax', () => {
  const cart = new ShoppingCart(0.1);
  cart.registerPromoCode({
    code: 'BOOKS20',
    kind: 'percent',
    value: 20,
    eligibleCategories: ['books'],
    minEligibleSubtotalCents: 4000,
    maxDiscountCents: 900,
  });

  cart.addItem({ sku: 'B1', name: 'Compilers', category: 'books', unitPriceCents: 5000, quantity: 1 });
  cart.addItem({ sku: 'G1', name: 'Gift Card', category: 'giftcards', unitPriceCents: 3000, quantity: 1 });

  const res = cart.applyPromoCode('  books20 ');
  assert.equal(res.applied, true);
  assert.equal(res.discountCents, 900);

  const summary = cart.getSummary();
  assert.equal(summary.subtotalCents, 8000);
  assert.equal(summary.discountCents, 900);
  assert.equal(summary.taxCents, 710);
  assert.equal(summary.totalCents, 7810);
});

test('enforces spend threshold against eligible items only, not excluded items', () => {
  const cart = new ShoppingCart(0);
  cart.registerPromoCode({
    code: 'SAVE10',
    kind: 'fixed',
    value: 1000,
    excludedCategories: ['giftcards'],
    minEligibleSubtotalCents: 5000,
  });

  cart.addItem({ sku: 'M1', name: 'Mug', category: 'home', unitPriceCents: 3000, quantity: 1 });
  cart.addItem({ sku: 'GC', name: 'Gift Card', category: 'giftcards', unitPriceCents: 5000, quantity: 1 });

  const rejected = cart.applyPromoCode('SAVE10');
  assert.equal(rejected.applied, false);
  assert.equal(rejected.reason, 'BELOW_MIN_SPEND');
  assert.equal(cart.getSummary().discountCents, 0);
});

test('clamps fixed discount to eligible subtotal and re-evaluates after cart mutation', () => {
  const cart = new ShoppingCart(0);
  cart.registerPromoCode({
    code: 'BIG20',
    kind: 'fixed',
    value: 2000,
    eligibleCategories: ['office'],
    minEligibleSubtotalCents: 1000,
  });

  cart.addItem({ sku: 'P1', name: 'Notebook', category: 'office', unitPriceCents: 1200, quantity: 1 });
  cart.addItem({ sku: 'H1', name: 'Lamp', category: 'home', unitPriceCents: 4000, quantity: 1 });

  const applied = cart.applyPromoCode('BIG20');
  assert.equal(applied.applied, true);
  assert.equal(applied.discountCents, 1200);
  assert.equal(cart.getSummary().totalCents, 4000);

  cart.removeItem('P1');
  assert.equal(cart.getSummary().discountCents, 0);
  assert.equal(cart.getSummary().totalCents, 4000);
});

test('failed promo application preserves previously active valid promo code', () => {
  const cart = new ShoppingCart(0);
  cart.registerPromoCode({ code: 'GOOD5', kind: 'fixed', value: 500 });
  cart.registerPromoCode({ code: 'HIGH', kind: 'fixed', value: 2500, minEligibleSubtotalCents: 10000 });

  cart.addItem({ sku: 'A1', name: 'Cable', category: 'tech', unitPriceCents: 2000, quantity: 1 });
  assert.equal(cart.applyPromoCode('GOOD5').applied, true);

  const failed = cart.applyPromoCode('HIGH');
  assert.equal(failed.applied, false);
  assert.equal(cart.getSummary().discountCents, 500);
});
`,
    mutants: [
      {
        id: 'MUT-001-A',
        label: 'Threshold checked on total subtotal instead of eligible subtotal',
        faultCategory: 'Eligibility Leakage',
        description:
          'Uses full cart subtotal (including excluded gift cards) when verifying minEligibleSubtotalCents.',
        mutatedCode: `export interface CartItem { sku: string; name: string; category: string; unitPriceCents: number; quantity: number; }
export interface PromoCode { code: string; kind: 'percent' | 'fixed'; value: number; minEligibleSubtotalCents?: number; eligibleCategories?: string[]; excludedCategories?: string[]; maxDiscountCents?: number; }
export class ShoppingCart {
  private items: Map<string, CartItem> = new Map();
  private taxRate: number;
  private promoRegistry: Map<string, PromoCode> = new Map();
  private activePromoCode: string | null = null;
  constructor(taxRate = 0.08) {
    if (taxRate < 0 || taxRate > 0.5) throw new Error('Tax rate must be between 0 and 0.5');
    this.taxRate = taxRate;
  }
  registerPromoCode(promo: PromoCode): void {
    const normalized = promo.code.trim().toUpperCase();
    this.promoRegistry.set(normalized, { ...promo, code: normalized });
  }
  applyPromoCode(code: string) {
    const normalized = code.trim().toUpperCase();
    const promo = this.promoRegistry.get(normalized);
    if (!promo) return { applied: false, reason: 'UNKNOWN_CODE', discountCents: 0 };
    const evalRes = this.evaluatePromo(promo);
    if (!evalRes.eligible) return { applied: false, reason: evalRes.reason, discountCents: this.computeActiveDiscount() };
    this.activePromoCode = normalized;
    return { applied: true, discountCents: evalRes.discountCents };
  }
  addItem(item: CartItem): void {
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) throw new Error('bad price');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('bad qty');
    const existing = this.items.get(item.sku);
    if (existing) existing.quantity += item.quantity; else this.items.set(item.sku, { ...item });
  }
  updateQuantity(sku: string, quantity: number): void {
    if (!this.items.has(sku)) throw new Error('missing');
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error('bad qty');
    if (quantity === 0) { this.items.delete(sku); return; }
    this.items.get(sku)!.quantity = quantity;
  }
  removeItem(sku: string): boolean { return this.items.delete(sku); }
  getItems(): CartItem[] { return Array.from(this.items.values()).map((i) => ({ ...i })); }
  getSubtotalCents(): number {
    let total = 0;
    for (const item of this.items.values()) total += item.unitPriceCents * item.quantity;
    return total;
  }
  private getEligibleSubtotal(promo: PromoCode): number {
    let eligible = 0;
    for (const item of this.items.values()) {
      if (promo.eligibleCategories && !promo.eligibleCategories.includes(item.category)) continue;
      if (promo.excludedCategories && promo.excludedCategories.includes(item.category)) continue;
      eligible += item.unitPriceCents * item.quantity;
    }
    return eligible;
  }
  private evaluatePromo(promo: PromoCode) {
    const eligibleSubtotal = this.getEligibleSubtotal(promo);
    const totalSubtotal = this.getSubtotalCents();
    // BUG: checks threshold against totalSubtotal instead of eligibleSubtotal
    if (totalSubtotal < (promo.minEligibleSubtotalCents ?? 0)) {
      return { eligible: false, reason: 'BELOW_MIN_SPEND', discountCents: 0 };
    }
    let raw = promo.kind === 'percent' ? Math.round((eligibleSubtotal * promo.value) / 100) : promo.value;
    if (promo.maxDiscountCents !== undefined) raw = Math.min(raw, promo.maxDiscountCents);
    return { eligible: eligibleSubtotal > 0, discountCents: Math.min(raw, eligibleSubtotal) };
  }
  private computeActiveDiscount(): number {
    if (!this.activePromoCode) return 0;
    const promo = this.promoRegistry.get(this.activePromoCode);
    if (!promo) return 0;
    const r = this.evaluatePromo(promo);
    return r.eligible ? r.discountCents : 0;
  }
  getSummary() {
    const subtotalCents = this.getSubtotalCents();
    const discountCents = this.computeActiveDiscount();
    const taxableCents = Math.max(0, subtotalCents - discountCents);
    const taxCents = Math.round(taxableCents * this.taxRate);
    const itemCount = Array.from(this.items.values()).reduce((s, i) => s + i.quantity, 0);
    return { subtotalCents, discountCents, taxCents, totalCents: taxableCents + taxCents, itemCount };
  }
}`,
      },
      {
        id: 'MUT-001-B',
        label: 'Fixed discount spills over into ineligible items',
        faultCategory: 'Clamping Defect',
        description:
          'Clamps fixed discount against full cart subtotal instead of eligible category subtotal.',
        mutatedCode: `export interface CartItem { sku: string; name: string; category: string; unitPriceCents: number; quantity: number; }
export interface PromoCode { code: string; kind: 'percent' | 'fixed'; value: number; minEligibleSubtotalCents?: number; eligibleCategories?: string[]; excludedCategories?: string[]; maxDiscountCents?: number; }
export class ShoppingCart {
  private items: Map<string, CartItem> = new Map();
  private taxRate: number;
  private promoRegistry: Map<string, PromoCode> = new Map();
  private activePromoCode: string | null = null;
  constructor(taxRate = 0.08) {
    if (taxRate < 0 || taxRate > 0.5) throw new Error('Tax rate must be between 0 and 0.5');
    this.taxRate = taxRate;
  }
  registerPromoCode(promo: PromoCode): void {
    const normalized = promo.code.trim().toUpperCase();
    this.promoRegistry.set(normalized, { ...promo, code: normalized });
  }
  applyPromoCode(code: string) {
    const normalized = code.trim().toUpperCase();
    const promo = this.promoRegistry.get(normalized);
    if (!promo) return { applied: false, reason: 'UNKNOWN_CODE', discountCents: this.computeActiveDiscount() };
    const evalRes = this.evaluatePromo(promo);
    if (!evalRes.eligible) return { applied: false, reason: evalRes.reason, discountCents: this.computeActiveDiscount() };
    this.activePromoCode = normalized;
    return { applied: true, discountCents: evalRes.discountCents };
  }
  addItem(item: CartItem): void {
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) throw new Error('bad price');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('bad qty');
    const existing = this.items.get(item.sku);
    if (existing) existing.quantity += item.quantity; else this.items.set(item.sku, { ...item });
  }
  updateQuantity(sku: string, quantity: number): void {
    if (!this.items.has(sku)) throw new Error('missing');
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error('bad qty');
    if (quantity === 0) { this.items.delete(sku); return; }
    this.items.get(sku)!.quantity = quantity;
  }
  removeItem(sku: string): boolean { return this.items.delete(sku); }
  getItems(): CartItem[] { return Array.from(this.items.values()).map((i) => ({ ...i })); }
  getSubtotalCents(): number {
    let total = 0;
    for (const item of this.items.values()) total += item.unitPriceCents * item.quantity;
    return total;
  }
  private getEligibleSubtotal(promo: PromoCode): number {
    let eligible = 0;
    for (const item of this.items.values()) {
      if (promo.eligibleCategories && !promo.eligibleCategories.includes(item.category)) continue;
      if (promo.excludedCategories && promo.excludedCategories.includes(item.category)) continue;
      eligible += item.unitPriceCents * item.quantity;
    }
    return eligible;
  }
  private evaluatePromo(promo: PromoCode) {
    const eligibleSubtotal = this.getEligibleSubtotal(promo);
    if (eligibleSubtotal < (promo.minEligibleSubtotalCents ?? 0)) {
      return { eligible: false, reason: 'BELOW_MIN_SPEND', discountCents: 0 };
    }
    let raw = promo.kind === 'percent' ? Math.round((eligibleSubtotal * promo.value) / 100) : promo.value;
    if (promo.maxDiscountCents !== undefined) raw = Math.min(raw, promo.maxDiscountCents);
    // BUG: clamps against full subtotal rather than eligibleSubtotal
    return { eligible: eligibleSubtotal > 0, discountCents: Math.min(raw, this.getSubtotalCents()) };
  }
  private computeActiveDiscount(): number {
    if (!this.activePromoCode) return 0;
    const promo = this.promoRegistry.get(this.activePromoCode);
    if (!promo) return 0;
    const r = this.evaluatePromo(promo);
    return r.eligible ? r.discountCents : 0;
  }
  getSummary() {
    const subtotalCents = this.getSubtotalCents();
    const discountCents = this.computeActiveDiscount();
    const taxableCents = Math.max(0, subtotalCents - discountCents);
    const taxCents = Math.round(taxableCents * this.taxRate);
    const itemCount = Array.from(this.items.values()).reduce((s, i) => s + i.quantity, 0);
    return { subtotalCents, discountCents, taxCents, totalCents: taxableCents + taxCents, itemCount };
  }
}`,
      },
      {
        id: 'MUT-001-C',
        label: 'Rejected promo clears previously active code',
        faultCategory: 'State Corruption',
        description:
          'Resets activePromoCode to null before validating a newly submitted code.',
        mutatedCode: `export interface CartItem { sku: string; name: string; category: string; unitPriceCents: number; quantity: number; }
export interface PromoCode { code: string; kind: 'percent' | 'fixed'; value: number; minEligibleSubtotalCents?: number; eligibleCategories?: string[]; excludedCategories?: string[]; maxDiscountCents?: number; }
export class ShoppingCart {
  private items: Map<string, CartItem> = new Map();
  private taxRate: number;
  private promoRegistry: Map<string, PromoCode> = new Map();
  private activePromoCode: string | null = null;
  constructor(taxRate = 0.08) {
    if (taxRate < 0 || taxRate > 0.5) throw new Error('Tax rate must be between 0 and 0.5');
    this.taxRate = taxRate;
  }
  registerPromoCode(promo: PromoCode): void {
    const normalized = promo.code.trim().toUpperCase();
    this.promoRegistry.set(normalized, { ...promo, code: normalized });
  }
  applyPromoCode(code: string) {
    // BUG: clears existing code before validating replacement
    this.activePromoCode = null;
    const normalized = code.trim().toUpperCase();
    const promo = this.promoRegistry.get(normalized);
    if (!promo) return { applied: false, reason: 'UNKNOWN_CODE', discountCents: 0 };
    const evalRes = this.evaluatePromo(promo);
    if (!evalRes.eligible) return { applied: false, reason: evalRes.reason, discountCents: 0 };
    this.activePromoCode = normalized;
    return { applied: true, discountCents: evalRes.discountCents };
  }
  addItem(item: CartItem): void {
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) throw new Error('bad price');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('bad qty');
    const existing = this.items.get(item.sku);
    if (existing) existing.quantity += item.quantity; else this.items.set(item.sku, { ...item });
  }
  updateQuantity(sku: string, quantity: number): void {
    if (!this.items.has(sku)) throw new Error('missing');
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error('bad qty');
    if (quantity === 0) { this.items.delete(sku); return; }
    this.items.get(sku)!.quantity = quantity;
  }
  removeItem(sku: string): boolean { return this.items.delete(sku); }
  getItems(): CartItem[] { return Array.from(this.items.values()).map((i) => ({ ...i })); }
  getSubtotalCents(): number {
    let total = 0;
    for (const item of this.items.values()) total += item.unitPriceCents * item.quantity;
    return total;
  }
  private getEligibleSubtotal(promo: PromoCode): number {
    let eligible = 0;
    for (const item of this.items.values()) {
      if (promo.eligibleCategories && !promo.eligibleCategories.includes(item.category)) continue;
      if (promo.excludedCategories && promo.excludedCategories.includes(item.category)) continue;
      eligible += item.unitPriceCents * item.quantity;
    }
    return eligible;
  }
  private evaluatePromo(promo: PromoCode) {
    const eligibleSubtotal = this.getEligibleSubtotal(promo);
    if (eligibleSubtotal === 0) return { eligible: false, reason: 'NO_ELIGIBLE_ITEMS', discountCents: 0 };
    if (eligibleSubtotal < (promo.minEligibleSubtotalCents ?? 0)) return { eligible: false, reason: 'BELOW_MIN_SPEND', discountCents: 0 };
    let raw = promo.kind === 'percent' ? Math.round((eligibleSubtotal * promo.value) / 100) : promo.value;
    if (promo.maxDiscountCents !== undefined) raw = Math.min(raw, promo.maxDiscountCents);
    return { eligible: true, discountCents: Math.min(raw, eligibleSubtotal) };
  }
  private computeActiveDiscount(): number {
    if (!this.activePromoCode) return 0;
    const promo = this.promoRegistry.get(this.activePromoCode);
    if (!promo) return 0;
    const r = this.evaluatePromo(promo);
    return r.eligible ? r.discountCents : 0;
  }
  getSummary() {
    const subtotalCents = this.getSubtotalCents();
    const discountCents = this.computeActiveDiscount();
    const taxableCents = Math.max(0, subtotalCents - discountCents);
    const taxCents = Math.round(taxableCents * this.taxRate);
    const itemCount = Array.from(this.items.values()).reduce((s, i) => s + i.quantity, 0);
    return { subtotalCents, discountCents, taxCents, totalCents: taxableCents + taxCents, itemCount };
  }
}`,
      },
    ],
  },
  {
    id: 'PKG-002',
    title: 'Multi-SKU Bundle Pricing with Optimal Conflict Resolution',
    repoId: 'repo-cart-core',
    repoSlug: 'cart-core',
    baseVersionTag: 'v1.4.2',
    baseCommitSha: 'a8f3d21',
    variationAxis: 'Conflict Resolution & Precedence',
    difficulty: 'Advanced',
    createdAt: '2026-11-18T16:05:00Z',
    origin: 'Sample',
    targetFile: 'src/cart.ts',
    behavioralTags: ['bundle-allocation', 'exclusive-unit-consumption', 'optimal-savings-search', 'deterministic-tiebreak'],
    requirements: {
      overview:
        'Add multi-SKU bundle pricing to ShoppingCart where each individual unit in the cart may participate in at most one bundle application, and overlapping bundles must resolve to maximize total customer savings.',
      functionalRules: [
        'Add registerBundle(bundle: BundleRule) where BundleRule specifies id, requiredSkus (map of sku -> required quantity), and bundleDiscountCents (savings per matched bundle instance).',
        'Each unit of an SKU in the cart can only be consumed once across all applied bundles; a single bundle may be applied multiple times if sufficient units exist.',
        'When two or more bundles compete for the same SKU units, the cart must select the combination of bundle applications that maximizes total discountCents (not naive registration-order matching).',
        'Add getAppliedBundles() returning sorted list of { bundleId: string; count: number; totalSavingsCents: number }, using lexicographical bundleId order as deterministic tie-breaker when total savings are equal.',
        'Integrate total bundle savings into getSummary().discountCents before tax computation.',
      ],
      edgeCases: [
        'Two smaller non-overlapping bundles yielding higher combined savings than one larger overlapping bundle must be chosen over a greedy single-bundle pick.',
        'If a bundle requires 2 units of SKU A and 1 of SKU B, having 3 A and 2 B allows only 1 instance of that bundle.',
        'Empty bundle rules or non-positive bundleDiscountCents must throw during registration.',
      ],
      acceptanceCriteria: [
        'All existing ShoppingCart regression tests continue passing with zero bundle rules registered.',
        'Overlapping bundle conflict scenarios always achieve the mathematical maximum savings without double-counting any SKU unit.',
      ],
      outOfScope: [
        'Combining percentage promo codes with bundle discounts in the same cart',
        'Category-wildcard bundle definitions',
      ],
    },
    referenceImplementation: `export interface CartItem {
  sku: string;
  name: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
}

export interface BundleRule {
  id: string;
  requiredSkus: Record<string, number>;
  bundleDiscountCents: number;
}

export interface AppliedBundle {
  bundleId: string;
  count: number;
  totalSavingsCents: number;
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
  private bundles: BundleRule[] = [];

  constructor(taxRate = 0.08) {
    if (taxRate < 0 || taxRate > 0.5) {
      throw new Error('Tax rate must be between 0 and 0.5');
    }
    this.taxRate = taxRate;
  }

  registerBundle(bundle: BundleRule): void {
    if (!bundle.id.trim()) {
      throw new Error('Bundle id is required');
    }
    const entries = Object.entries(bundle.requiredSkus);
    if (entries.length === 0) {
      throw new Error('Bundle must require at least one SKU');
    }
    for (const [, qty] of entries) {
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error('Bundle SKU quantities must be positive integers');
      }
    }
    if (!Number.isInteger(bundle.bundleDiscountCents) || bundle.bundleDiscountCents <= 0) {
      throw new Error('Bundle discount must be a positive integer in cents');
    }
    this.bundles = this.bundles.filter((b) => b.id !== bundle.id);
    this.bundles.push({
      id: bundle.id,
      requiredSkus: { ...bundle.requiredSkus },
      bundleDiscountCents: bundle.bundleDiscountCents,
    });
    this.bundles.sort((a, b) => a.id.localeCompare(b.id));
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
    this.items.get(sku)!.quantity = quantity;
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

  getAppliedBundles(): AppliedBundle[] {
    if (this.bundles.length === 0 || this.items.size === 0) {
      return [];
    }
    const stock: Record<string, number> = {};
    for (const item of this.items.values()) {
      stock[item.sku] = item.quantity;
    }

    const applicable = this.bundles.filter((b) =>
      Object.entries(b.requiredSkus).every(([sku, qty]) => (stock[sku] ?? 0) >= qty),
    );
    if (applicable.length === 0) {
      return [];
    }

    let bestSavings = 0;
    let bestCounts: number[] = applicable.map(() => 0);

    const search = (idx: number, currentSavings: number, counts: number[]) => {
      if (idx === applicable.length) {
        if (currentSavings > bestSavings) {
          bestSavings = currentSavings;
          bestCounts = [...counts];
        } else if (currentSavings === bestSavings && currentSavings > 0) {
          const curKey = counts
            .map((c, i) => (c > 0 ? \`\${applicable[i].id}:\${c}\` : ''))
            .filter(Boolean)
            .join(',');
          const bestKey = bestCounts
            .map((c, i) => (c > 0 ? \`\${applicable[i].id}:\${c}\` : ''))
            .filter(Boolean)
            .join(',');
          if (bestKey === '' || curKey.localeCompare(bestKey) < 0) {
            bestCounts = [...counts];
          }
        }
        return;
      }

      const rule = applicable[idx];
      let maxApps = Infinity;
      for (const [sku, qty] of Object.entries(rule.requiredSkus)) {
        maxApps = Math.min(maxApps, Math.floor((stock[sku] ?? 0) / qty));
      }

      for (let take = maxApps; take >= 0; take--) {
        for (const [sku, qty] of Object.entries(rule.requiredSkus)) {
          stock[sku] -= qty * take;
        }
        counts[idx] = take;
        search(idx + 1, currentSavings + take * rule.bundleDiscountCents, counts);
        for (const [sku, qty] of Object.entries(rule.requiredSkus)) {
          stock[sku] += qty * take;
        }
      }
      counts[idx] = 0;
    };

    search(0, 0, applicable.map(() => 0));

    const result: AppliedBundle[] = [];
    for (let i = 0; i < applicable.length; i++) {
      if (bestCounts[i] > 0) {
        result.push({
          bundleId: applicable[i].id,
          count: bestCounts[i],
          totalSavingsCents: bestCounts[i] * applicable[i].bundleDiscountCents,
        });
      }
    }
    return result;
  }

  getSummary(): CartSummary {
    const subtotalCents = this.getSubtotalCents();
    const rawDiscount = this.getAppliedBundles().reduce((sum, b) => sum + b.totalSavingsCents, 0);
    const discountCents = Math.min(rawDiscount, subtotalCents);
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
    featureTests: `import { ShoppingCart } from '../src/cart';

test('selects two smaller non-overlapping bundles over one larger conflicting bundle when total savings are higher', () => {
  const cart = new ShoppingCart(0);
  // Large bundle uses A+B+C for $10 off; smaller bundles A+B ($7) and C+D ($6) yield $13 total.
  cart.registerBundle({ id: 'BIG-ABC', requiredSkus: { A: 1, B: 1, C: 1 }, bundleDiscountCents: 1000 });
  cart.registerBundle({ id: 'PAIR-AB', requiredSkus: { A: 1, B: 1 }, bundleDiscountCents: 700 });
  cart.registerBundle({ id: 'PAIR-CD', requiredSkus: { C: 1, D: 1 }, bundleDiscountCents: 600 });

  cart.addItem({ sku: 'A', name: 'Item A', category: 'kit', unitPriceCents: 2000, quantity: 1 });
  cart.addItem({ sku: 'B', name: 'Item B', category: 'kit', unitPriceCents: 2000, quantity: 1 });
  cart.addItem({ sku: 'C', name: 'Item C', category: 'kit', unitPriceCents: 2000, quantity: 1 });
  cart.addItem({ sku: 'D', name: 'Item D', category: 'kit', unitPriceCents: 2000, quantity: 1 });

  const applied = cart.getAppliedBundles();
  assert.equal(cart.getSummary().discountCents, 1300);
  assert.equal(applied.length, 2);
  assert.equal(applied[0].bundleId, 'PAIR-AB');
  assert.equal(applied[1].bundleId, 'PAIR-CD');
});

test('prevents double-counting a single shared SKU across overlapping bundles', () => {
  const cart = new ShoppingCart(0);
  cart.registerBundle({ id: 'B1', requiredSkus: { CAMERA: 1, LENS: 1 }, bundleDiscountCents: 1500 });
  cart.registerBundle({ id: 'B2', requiredSkus: { CAMERA: 1, BAG: 1 }, bundleDiscountCents: 1200 });

  cart.addItem({ sku: 'CAMERA', name: 'Body', category: 'photo', unitPriceCents: 80000, quantity: 1 });
  cart.addItem({ sku: 'LENS', name: '50mm', category: 'photo', unitPriceCents: 20000, quantity: 1 });
  cart.addItem({ sku: 'BAG', name: 'Sling', category: 'photo', unitPriceCents: 10000, quantity: 1 });

  const applied = cart.getAppliedBundles();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].bundleId, 'B1');
  assert.equal(cart.getSummary().discountCents, 1500);
});

test('applies multiple instances of a bundle proportionally to bottleneck SKU quantity', () => {
  const cart = new ShoppingCart(0.1);
  cart.registerBundle({ id: 'MULTI', requiredSkus: { X: 2, Y: 1 }, bundleDiscountCents: 500 });

  cart.addItem({ sku: 'X', name: 'Bolt', category: 'hw', unitPriceCents: 400, quantity: 5 });
  cart.addItem({ sku: 'Y', name: 'Nut', category: 'hw', unitPriceCents: 200, quantity: 3 });

  const applied = cart.getAppliedBundles();
  assert.equal(applied[0].count, 2);
  assert.equal(applied[0].totalSavingsCents, 1000);
  assert.equal(cart.getSummary().taxCents, 160);
});

test('rejects invalid empty or non-positive bundle rules', () => {
  const cart = new ShoppingCart(0);
  assert.throws(() => cart.registerBundle({ id: 'EMPTY', requiredSkus: {}, bundleDiscountCents: 500 }));
  assert.throws(() => cart.registerBundle({ id: 'NEG', requiredSkus: { A: 1 }, bundleDiscountCents: 0 }));
});
`,
    mutants: [
      {
        id: 'MUT-002-A',
        label: 'Greedy single-pass by largest individual bundle discount',
        faultCategory: 'Suboptimal Conflict Resolution',
        description:
          'Picks the highest single-bundle discount greedily instead of searching combinations, losing savings on split bundles.',
        mutatedCode: `export interface CartItem { sku: string; name: string; category: string; unitPriceCents: number; quantity: number; }
export interface BundleRule { id: string; requiredSkus: Record<string, number>; bundleDiscountCents: number; }
export class ShoppingCart {
  private items: Map<string, CartItem> = new Map();
  private taxRate: number;
  private bundles: BundleRule[] = [];
  constructor(taxRate = 0.08) {
    if (taxRate < 0 || taxRate > 0.5) throw new Error('Tax rate must be between 0 and 0.5');
    this.taxRate = taxRate;
  }
  registerBundle(bundle: BundleRule): void {
    if (!bundle.id.trim() || Object.keys(bundle.requiredSkus).length === 0 || bundle.bundleDiscountCents <= 0) throw new Error('invalid');
    this.bundles.push({ ...bundle, requiredSkus: { ...bundle.requiredSkus } });
  }
  addItem(item: CartItem): void {
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) throw new Error('bad price');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('bad qty');
    const existing = this.items.get(item.sku);
    if (existing) existing.quantity += item.quantity; else this.items.set(item.sku, { ...item });
  }
  updateQuantity(sku: string, quantity: number): void {
    if (!this.items.has(sku)) throw new Error('missing');
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error('bad qty');
    if (quantity === 0) { this.items.delete(sku); return; }
    this.items.get(sku)!.quantity = quantity;
  }
  removeItem(sku: string): boolean { return this.items.delete(sku); }
  getItems(): CartItem[] { return Array.from(this.items.values()).map((i) => ({ ...i })); }
  getSubtotalCents(): number {
    let total = 0;
    for (const item of this.items.values()) total += item.unitPriceCents * item.quantity;
    return total;
  }
  getAppliedBundles() {
    const stock: Record<string, number> = {};
    for (const item of this.items.values()) stock[item.sku] = item.quantity;
    // BUG: greedy pick by single-bundle discount misses optimal pair combination
    const sorted = [...this.bundles].sort((a, b) => b.bundleDiscountCents - a.bundleDiscountCents);
    const out: Array<{ bundleId: string; count: number; totalSavingsCents: number }> = [];
    for (const rule of sorted) {
      let maxApps = Infinity;
      for (const [sku, qty] of Object.entries(rule.requiredSkus)) {
        maxApps = Math.min(maxApps, Math.floor((stock[sku] ?? 0) / qty));
      }
      if (maxApps > 0 && Number.isFinite(maxApps)) {
        for (const [sku, qty] of Object.entries(rule.requiredSkus)) stock[sku] -= qty * maxApps;
        out.push({ bundleId: rule.id, count: maxApps, totalSavingsCents: maxApps * rule.bundleDiscountCents });
      }
    }
    return out;
  }
  getSummary() {
    const subtotalCents = this.getSubtotalCents();
    const discountCents = Math.min(this.getAppliedBundles().reduce((s, b) => s + b.totalSavingsCents, 0), subtotalCents);
    const taxableCents = Math.max(0, subtotalCents - discountCents);
    const taxCents = Math.round(taxableCents * this.taxRate);
    const itemCount = Array.from(this.items.values()).reduce((s, i) => s + i.quantity, 0);
    return { subtotalCents, discountCents, taxCents, totalCents: taxableCents + taxCents, itemCount };
  }
}`,
      },
      {
        id: 'MUT-002-B',
        label: 'Double-counts shared SKU units across bundles',
        faultCategory: 'Exclusive Unit Violation',
        description:
          'Evaluates each registered bundle independently against original cart stock without deducting consumed SKU units.',
        mutatedCode: `export interface CartItem { sku: string; name: string; category: string; unitPriceCents: number; quantity: number; }
export interface BundleRule { id: string; requiredSkus: Record<string, number>; bundleDiscountCents: number; }
export class ShoppingCart {
  private items: Map<string, CartItem> = new Map();
  private taxRate: number;
  private bundles: BundleRule[] = [];
  constructor(taxRate = 0.08) {
    if (taxRate < 0 || taxRate > 0.5) throw new Error('Tax rate must be between 0 and 0.5');
    this.taxRate = taxRate;
  }
  registerBundle(bundle: BundleRule): void {
    if (!bundle.id.trim() || Object.keys(bundle.requiredSkus).length === 0 || bundle.bundleDiscountCents <= 0) throw new Error('invalid');
    this.bundles.push({ ...bundle, requiredSkus: { ...bundle.requiredSkus } });
  }
  addItem(item: CartItem): void {
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) throw new Error('bad price');
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('bad qty');
    const existing = this.items.get(item.sku);
    if (existing) existing.quantity += item.quantity; else this.items.set(item.sku, { ...item });
  }
  updateQuantity(sku: string, quantity: number): void {
    if (!this.items.has(sku)) throw new Error('missing');
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error('bad qty');
    if (quantity === 0) { this.items.delete(sku); return; }
    this.items.get(sku)!.quantity = quantity;
  }
  removeItem(sku: string): boolean { return this.items.delete(sku); }
  getItems(): CartItem[] { return Array.from(this.items.values()).map((i) => ({ ...i })); }
  getSubtotalCents(): number {
    let total = 0;
    for (const item of this.items.values()) total += item.unitPriceCents * item.quantity;
    return total;
  }
  getAppliedBundles() {
    const out: Array<{ bundleId: string; count: number; totalSavingsCents: number }> = [];
    for (const rule of this.bundles) {
      let maxApps = Infinity;
      for (const [sku, qty] of Object.entries(rule.requiredSkus)) {
        const have = this.items.get(sku)?.quantity ?? 0;
        maxApps = Math.min(maxApps, Math.floor(have / qty));
      }
      // BUG: never deducts units from stock, so overlapping bundles reuse the same CAMERA unit
      if (maxApps > 0 && Number.isFinite(maxApps)) {
        out.push({ bundleId: rule.id, count: maxApps, totalSavingsCents: maxApps * rule.bundleDiscountCents });
      }
    }
    return out;
  }
  getSummary() {
    const subtotalCents = this.getSubtotalCents();
    const discountCents = Math.min(this.getAppliedBundles().reduce((s, b) => s + b.totalSavingsCents, 0), subtotalCents);
    const taxableCents = Math.max(0, subtotalCents - discountCents);
    const taxCents = Math.round(taxableCents * this.taxRate);
    const itemCount = Array.from(this.items.values()).reduce((s, i) => s + i.quantity, 0);
    return { subtotalCents, discountCents, taxCents, totalCents: taxableCents + taxCents, itemCount };
  }
}`,
      },
    ],
  },
  {
    id: 'PKG-003',
    title: 'Dead-Letter Quarantine with Exponential Backoff & Idempotency',
    repoId: 'repo-task-queue',
    repoSlug: 'task-queue',
    baseVersionTag: 'v2.1.0',
    baseCommitSha: '7c1e904',
    variationAxis: 'Stateful Lifecycle Transitions',
    difficulty: 'Advanced',
    createdAt: '2026-11-19T09:15:00Z',
    origin: 'Sample',
    targetFile: 'src/queue.ts',
    behavioralTags: ['exponential-backoff', 'dead-letter-queue', 'idempotency-dedup', 'deferred-claim'],
    requirements: {
      overview:
        'Extend PriorityTaskQueue with retryable failure handling using exponential backoff scheduling, automatic dead-letter quarantine once maxAttempts is exhausted, and idempotency-key deduplication on enqueue.',
      functionalRules: [
        'Extend JobInput with optional maxAttempts (default 1, preserving existing immediate-fail behavior), baseBackoffMs (default 1000), and idempotencyKey.',
        'If enqueue() receives an idempotencyKey matching an existing non-dead-lettered job, return that existing job record instead of creating a duplicate or throwing.',
        'When fail(jobId, errorMessage, now) is called on a running job whose attempts < maxAttempts, transition status back to "queued" and set nextEligibleAt = now + baseBackoffMs * 2^(attempts - 1).',
        'claimNext(now) must skip queued jobs whose nextEligibleAt > now so backed-off jobs cannot run early.',
        'When a job fails on its final attempt (attempts >= maxAttempts) and maxAttempts > 1, transition status to "dead_letter" (when maxAttempts === 1, keep existing "failed" status for backwards compatibility). Add getDeadLetterJobs() and requeueDeadLetter(jobId, now).',
      ],
      edgeCases: [
        'A job with maxAttempts=3 fails at t=1000 (attempt 1 -> nextEligibleAt=2000), fails at t=2000 (attempt 2 -> nextEligibleAt=4000), and moves to dead_letter on attempt 3.',
        'requeueDeadLetter(jobId, now) resets attempts to 0, clears error, sets status to "queued", and makes the job immediately eligible at now.',
        'Calling claimNext(now) while high-priority job is in backoff must still claim a lower-priority ready job.',
      ],
      acceptanceCriteria: [
        'All existing PriorityTaskQueue regression tests pass unchanged (default maxAttempts=1 still enters "failed").',
        'Backoff timing follows exact geometric progression baseBackoffMs * 2^(attempts - 1).',
        'Dead-lettered jobs are excluded from claimNext until explicitly requeued.',
      ],
      outOfScope: [
        'Random jitter in backoff delays',
        'Distributed lock heartbeats or external storage persistence',
      ],
    },
    referenceImplementation: `export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dead_letter';

export interface JobInput {
  id: string;
  type: string;
  priority: number;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  baseBackoffMs?: number;
  idempotencyKey?: string;
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
  attempts: number;
  maxAttempts: number;
  baseBackoffMs: number;
  nextEligibleAt: number;
  idempotencyKey?: string;
}

export class PriorityTaskQueue {
  private jobs: Map<string, JobRecord> = new Map();
  private idempotencyIndex: Map<string, string> = new Map();
  private sequence = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent = 2) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrent must be an integer >= 1');
    }
    this.maxConcurrent = maxConcurrent;
  }

  enqueue(input: JobInput, now = Date.now()): JobRecord {
    if (input.idempotencyKey) {
      const existingId = this.idempotencyIndex.get(input.idempotencyKey);
      if (existingId) {
        const existingJob = this.jobs.get(existingId);
        if (existingJob && existingJob.status !== 'dead_letter') {
          return { ...existingJob };
        }
      }
    }

    if (!input.id || this.jobs.has(input.id)) {
      throw new Error(\`Duplicate or empty job id: \${input.id}\`);
    }

    const maxAttempts = input.maxAttempts ?? 1;
    const baseBackoffMs = input.baseBackoffMs ?? 1000;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('maxAttempts must be an integer >= 1');
    }
    if (baseBackoffMs < 0) {
      throw new Error('baseBackoffMs must be non-negative');
    }

    const record: JobRecord = {
      id: input.id,
      type: input.type,
      priority: input.priority,
      payload: input.payload ? { ...input.payload } : {},
      status: 'queued',
      enqueuedAt: now + this.sequence * 0.0001,
      attempts: 0,
      maxAttempts,
      baseBackoffMs,
      nextEligibleAt: now,
      idempotencyKey: input.idempotencyKey,
    };
    this.sequence += 1;
    this.jobs.set(record.id, record);
    if (input.idempotencyKey) {
      this.idempotencyIndex.set(input.idempotencyKey, record.id);
    }
    return { ...record };
  }

  claimNext(now = Date.now()): JobRecord | null {
    const runningCount = this.listByStatus('running').length;
    if (runningCount >= this.maxConcurrent) {
      return null;
    }
    const eligible = Array.from(this.jobs.values()).filter(
      (job) => job.status === 'queued' && job.nextEligibleAt <= now,
    );
    if (eligible.length === 0) {
      return null;
    }
    eligible.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enqueuedAt - b.enqueuedAt;
    });
    const next = this.jobs.get(eligible[0].id)!;
    next.status = 'running';
    next.startedAt = now;
    next.attempts += 1;
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
    job.error = errorMessage;

    if (job.attempts < job.maxAttempts) {
      const delayMs = job.baseBackoffMs * Math.pow(2, job.attempts - 1);
      job.status = 'queued';
      job.nextEligibleAt = now + delayMs;
      return { ...job };
    }

    job.status = job.maxAttempts > 1 ? 'dead_letter' : 'failed';
    job.completedAt = now;
    return { ...job };
  }

  getDeadLetterJobs(): JobRecord[] {
    return this.listByStatus('dead_letter');
  }

  requeueDeadLetter(jobId: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'dead_letter') {
      throw new Error(\`Job \${jobId} is not in dead_letter state\`);
    }
    job.status = 'queued';
    job.attempts = 0;
    job.error = undefined;
    job.completedAt = undefined;
    job.nextEligibleAt = now;
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
    featureTests: `import { PriorityTaskQueue } from '../src/queue';

test('applies exponential backoff delays and quarantines into dead_letter after maxAttempts', () => {
  const queue = new PriorityTaskQueue(2);
  queue.enqueue({ id: 'pay-1', type: 'charge', priority: 10, maxAttempts: 3, baseBackoffMs: 500 }, 1000);

  // Attempt 1
  const a1 = queue.claimNext(1000);
  assert.equal(a1?.attempts, 1);
  const f1 = queue.fail('pay-1', 'gateway 503', 1000);
  assert.equal(f1.status, 'queued');
  assert.equal(f1.nextEligibleAt, 1500);
  assert.equal(queue.claimNext(1499), null);

  // Attempt 2
  const a2 = queue.claimNext(1500);
  assert.equal(a2?.attempts, 2);
  const f2 = queue.fail('pay-1', 'gateway 503', 1500);
  assert.equal(f2.status, 'queued');
  assert.equal(f2.nextEligibleAt, 2500); // 1500 + 500 * 2^1
  assert.equal(queue.claimNext(2499), null);

  // Attempt 3 -> dead_letter
  const a3 = queue.claimNext(2500);
  assert.equal(a3?.attempts, 3);
  const f3 = queue.fail('pay-1', 'permanent decline', 2500);
  assert.equal(f3.status, 'dead_letter');
  assert.equal(queue.getDeadLetterJobs().length, 1);
  assert.equal(queue.claimNext(99999), null);
});

test('skips backed-off high-priority job so lower-priority ready job can execute', () => {
  const queue = new PriorityTaskQueue(2);
  queue.enqueue({ id: 'hi', type: 'sync', priority: 10, maxAttempts: 2, baseBackoffMs: 1000 }, 100);
  queue.enqueue({ id: 'lo', type: 'digest', priority: 1 }, 100);

  queue.claimNext(100); // claims 'hi'
  queue.fail('hi', 'transient', 100); // eligible at 1100

  const next = queue.claimNext(200);
  assert.equal(next?.id, 'lo');
});

test('deduplicates active jobs sharing an idempotencyKey and allows requeue from dead_letter', () => {
  const queue = new PriorityTaskQueue(1);
  const j1 = queue.enqueue({ id: 'ord-1', type: 'order', priority: 5, maxAttempts: 2, baseBackoffMs: 100, idempotencyKey: 'key-42' }, 0);
  const dup = queue.enqueue({ id: 'ord-2', type: 'order', priority: 5, idempotencyKey: 'key-42' }, 10);

  assert.equal(dup.id, j1.id);
  assert.equal(queue.listByStatus('queued').length, 1);

  // Exhaust attempts to dead_letter
  queue.claimNext(10);
  queue.fail('ord-1', 'err1', 10);
  queue.claimNext(110);
  queue.fail('ord-1', 'err2', 110);
  assert.equal(queue.getJob('ord-1')?.status, 'dead_letter');

  const requeued = queue.requeueDeadLetter('ord-1', 500);
  assert.equal(requeued.status, 'queued');
  assert.equal(requeued.attempts, 0);
  assert.equal(queue.claimNext(500)?.id, 'ord-1');
});
`,
    mutants: [
      {
        id: 'MUT-003-A',
        label: 'Uses linear backoff instead of exponential backoff',
        faultCategory: 'Timing Formula Defect',
        description:
          'Computes delay as baseBackoffMs * attempts rather than baseBackoffMs * 2^(attempts - 1), causing early claim on retry 2+.',
        mutatedCode: `export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dead_letter';
export interface JobInput { id: string; type: string; priority: number; payload?: Record<string, unknown>; maxAttempts?: number; baseBackoffMs?: number; idempotencyKey?: string; }
export interface JobRecord { id: string; type: string; priority: number; payload: Record<string, unknown>; status: JobStatus; enqueuedAt: number; startedAt?: number; completedAt?: number; error?: string; attempts: number; maxAttempts: number; baseBackoffMs: number; nextEligibleAt: number; idempotencyKey?: string; }
export class PriorityTaskQueue {
  private jobs: Map<string, JobRecord> = new Map();
  private idempotencyIndex: Map<string, string> = new Map();
  private sequence = 0;
  private maxConcurrent: number;
  constructor(maxConcurrent = 2) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error('bad maxConcurrent');
    this.maxConcurrent = maxConcurrent;
  }
  enqueue(input: JobInput, now = Date.now()): JobRecord {
    if (input.idempotencyKey && this.idempotencyIndex.has(input.idempotencyKey)) {
      const existing = this.jobs.get(this.idempotencyIndex.get(input.idempotencyKey)!);
      if (existing && existing.status !== 'dead_letter') return { ...existing };
    }
    if (!input.id || this.jobs.has(input.id)) throw new Error('dup');
    const record: JobRecord = {
      id: input.id, type: input.type, priority: input.priority, payload: input.payload ? { ...input.payload } : {},
      status: 'queued', enqueuedAt: now + this.sequence * 0.0001, attempts: 0,
      maxAttempts: input.maxAttempts ?? 1, baseBackoffMs: input.baseBackoffMs ?? 1000,
      nextEligibleAt: now, idempotencyKey: input.idempotencyKey,
    };
    this.sequence += 1;
    this.jobs.set(record.id, record);
    if (input.idempotencyKey) this.idempotencyIndex.set(input.idempotencyKey, record.id);
    return { ...record };
  }
  claimNext(now = Date.now()): JobRecord | null {
    if (this.listByStatus('running').length >= this.maxConcurrent) return null;
    const eligible = Array.from(this.jobs.values()).filter((j) => j.status === 'queued' && j.nextEligibleAt <= now);
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.enqueuedAt - b.enqueuedAt));
    const next = this.jobs.get(eligible[0].id)!;
    next.status = 'running'; next.startedAt = now; next.attempts += 1;
    return { ...next };
  }
  complete(jobId: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') throw new Error('not running');
    job.status = 'completed'; job.completedAt = now;
    return { ...job };
  }
  fail(jobId: string, errorMessage: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') throw new Error('not running');
    job.error = errorMessage;
    if (job.attempts < job.maxAttempts) {
      // BUG: flat baseBackoffMs instead of exponential 2^(attempts-1)
      job.status = 'queued';
      job.nextEligibleAt = now + job.baseBackoffMs;
      return { ...job };
    }
    job.status = job.maxAttempts > 1 ? 'dead_letter' : 'failed';
    job.completedAt = now;
    return { ...job };
  }
  getDeadLetterJobs(): JobRecord[] { return this.listByStatus('dead_letter'); }
  requeueDeadLetter(jobId: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'dead_letter') throw new Error('not dlq');
    job.status = 'queued'; job.attempts = 0; job.error = undefined; job.nextEligibleAt = now;
    return { ...job };
  }
  getJob(jobId: string) { const j = this.jobs.get(jobId); return j ? { ...j } : undefined; }
  listByStatus(status: JobStatus) { return Array.from(this.jobs.values()).filter((j) => j.status === status).map((j) => ({ ...j })); }
}`,
      },
      {
        id: 'MUT-003-B',
        label: 'claimNext ignores nextEligibleAt backoff barrier',
        faultCategory: 'Invariant Bypass',
        description:
          'Claims queued jobs immediately regardless of their scheduled nextEligibleAt timestamp.',
        mutatedCode: `export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dead_letter';
export interface JobInput { id: string; type: string; priority: number; payload?: Record<string, unknown>; maxAttempts?: number; baseBackoffMs?: number; idempotencyKey?: string; }
export interface JobRecord { id: string; type: string; priority: number; payload: Record<string, unknown>; status: JobStatus; enqueuedAt: number; startedAt?: number; completedAt?: number; error?: string; attempts: number; maxAttempts: number; baseBackoffMs: number; nextEligibleAt: number; idempotencyKey?: string; }
export class PriorityTaskQueue {
  private jobs: Map<string, JobRecord> = new Map();
  private idempotencyIndex: Map<string, string> = new Map();
  private sequence = 0;
  private maxConcurrent: number;
  constructor(maxConcurrent = 2) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error('bad maxConcurrent');
    this.maxConcurrent = maxConcurrent;
  }
  enqueue(input: JobInput, now = Date.now()): JobRecord {
    if (input.idempotencyKey && this.idempotencyIndex.has(input.idempotencyKey)) {
      const existing = this.jobs.get(this.idempotencyIndex.get(input.idempotencyKey)!);
      if (existing && existing.status !== 'dead_letter') return { ...existing };
    }
    if (!input.id || this.jobs.has(input.id)) throw new Error('dup');
    const record: JobRecord = {
      id: input.id, type: input.type, priority: input.priority, payload: input.payload ? { ...input.payload } : {},
      status: 'queued', enqueuedAt: now + this.sequence * 0.0001, attempts: 0,
      maxAttempts: input.maxAttempts ?? 1, baseBackoffMs: input.baseBackoffMs ?? 1000,
      nextEligibleAt: now, idempotencyKey: input.idempotencyKey,
    };
    this.sequence += 1;
    this.jobs.set(record.id, record);
    if (input.idempotencyKey) this.idempotencyIndex.set(input.idempotencyKey, record.id);
    return { ...record };
  }
  claimNext(now = Date.now()): JobRecord | null {
    if (this.listByStatus('running').length >= this.maxConcurrent) return null;
    // BUG: forgets nextEligibleAt <= now filter
    const eligible = Array.from(this.jobs.values()).filter((j) => j.status === 'queued');
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.enqueuedAt - b.enqueuedAt));
    const next = this.jobs.get(eligible[0].id)!;
    next.status = 'running'; next.startedAt = now; next.attempts += 1;
    return { ...next };
  }
  complete(jobId: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') throw new Error('not running');
    job.status = 'completed'; job.completedAt = now;
    return { ...job };
  }
  fail(jobId: string, errorMessage: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') throw new Error('not running');
    job.error = errorMessage;
    if (job.attempts < job.maxAttempts) {
      job.status = 'queued';
      job.nextEligibleAt = now + job.baseBackoffMs * Math.pow(2, job.attempts - 1);
      return { ...job };
    }
    job.status = job.maxAttempts > 1 ? 'dead_letter' : 'failed';
    job.completedAt = now;
    return { ...job };
  }
  getDeadLetterJobs(): JobRecord[] { return this.listByStatus('dead_letter'); }
  requeueDeadLetter(jobId: string, now = Date.now()): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'dead_letter') throw new Error('not dlq');
    job.status = 'queued'; job.attempts = 0; job.error = undefined; job.nextEligibleAt = now;
    return { ...job };
  }
  getJob(jobId: string) { const j = this.jobs.get(jobId); return j ? { ...j } : undefined; }
  listByStatus(status: JobStatus) { return Array.from(this.jobs.values()).filter((j) => j.status === status).map((j) => ({ ...j })); }
}`,
      },
    ],
  },
  {
    id: 'PKG-004',
    title: 'Weighted Cost Limits & Burst Reserve Allowance',
    repoId: 'repo-rate-guard',
    repoSlug: 'rate-guard',
    baseVersionTag: 'v0.9.5',
    baseCommitSha: 'e4b2a19',
    variationAxis: 'Quota & Burst Invariants',
    difficulty: 'Standard',
    createdAt: '2026-11-19T13:45:00Z',
    origin: 'Sample',
    targetFile: 'src/limiter.ts',
    behavioralTags: ['weighted-cost', 'burst-reserve', 'atomic-rejection', 'tenant-override'],
    requirements: {
      overview:
        'Enhance RateLimiter with weighted endpoint request costs, per-tenant burst reserve pools that absorb temporary traffic spikes without violating atomic rejection semantics, and tier overrides.',
      functionalRules: [
        'Extend LimiterConfig with optional burstReserve (default 0) and support setTenantOverride(tenantId, override: { maxRequests: number; burstReserve?: number }).',
        'Extend check(tenantId, nowMs, cost = 1) so heavy endpoints can consume multiple quota units atomically. Non-integer or <= 0 cost must throw.',
        'Consume from base maxRequests first; only draw from burstReserve when remaining base quota is insufficient for the request cost.',
        'Atomic rejection: if combined remaining base + burstReserve is less than cost, reject the request without deducting any base or burst units.',
        'Return burstRemaining and usedBurst in RateLimitDecision while keeping existing allowed, remaining (base remaining), and resetAtMs fields backward compatible.',
      ],
      edgeCases: [
        'A request costing 4 units when base remaining is 2 and burst remaining is 3 must succeed, leaving base remaining=0 and burstRemaining=1.',
        'A request costing 5 units when base remaining is 2 and burst remaining is 2 must fail atomically, leaving base remaining=2 and burstRemaining=2 untouched.',
        'Window rollover resets both base usage and burst usage cleanly.',
      ],
      acceptanceCriteria: [
        'All existing RateLimiter regression tests pass with default cost=1 and burstReserve=0.',
        'Tenant overrides isolate custom limits without altering global defaults for other tenants.',
      ],
      outOfScope: [
        'Distributed Redis token synchronization',
        'Sliding sub-window interpolation',
      ],
    },
    referenceImplementation: `export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  burstRemaining: number;
  usedBurst: number;
}

export interface LimiterConfig {
  windowMs: number;
  maxRequests: number;
  burstReserve?: number;
}

export interface TenantOverride {
  maxRequests: number;
  burstReserve?: number;
}

interface TenantWindow {
  windowStartMs: number;
  usedBase: number;
  usedBurst: number;
}

export class RateLimiter {
  private config: { windowMs: number; maxRequests: number; burstReserve: number };
  private tenants: Map<string, TenantWindow> = new Map();
  private overrides: Map<string, { maxRequests: number; burstReserve: number }> = new Map();

  constructor(config: LimiterConfig) {
    if (config.windowMs <= 0 || config.maxRequests <= 0) {
      throw new Error('windowMs and maxRequests must be positive');
    }
    const burst = config.burstReserve ?? 0;
    if (!Number.isInteger(burst) || burst < 0) {
      throw new Error('burstReserve must be a non-negative integer');
    }
    this.config = {
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      burstReserve: burst,
    };
  }

  setTenantOverride(tenantId: string, override: TenantOverride): void {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }
    if (override.maxRequests <= 0 || (override.burstReserve ?? 0) < 0) {
      throw new Error('Invalid tenant override limits');
    }
    this.overrides.set(tenantId, {
      maxRequests: override.maxRequests,
      burstReserve: override.burstReserve ?? this.config.burstReserve,
    });
  }

  private getEffectiveLimits(tenantId: string): { maxRequests: number; burstReserve: number } {
    return (
      this.overrides.get(tenantId) ?? {
        maxRequests: this.config.maxRequests,
        burstReserve: this.config.burstReserve,
      }
    );
  }

  check(tenantId: string, nowMs: number, cost = 1): RateLimitDecision {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }
    if (!Number.isInteger(cost) || cost <= 0) {
      throw new Error('cost must be a positive integer');
    }

    const limits = this.getEffectiveLimits(tenantId);
    let state = this.tenants.get(tenantId);
    if (!state || nowMs - state.windowStartMs >= this.config.windowMs) {
      state = { windowStartMs: nowMs, usedBase: 0, usedBurst: 0 };
      this.tenants.set(tenantId, state);
    }

    const resetAtMs = state.windowStartMs + this.config.windowMs;
    const baseRemaining = Math.max(0, limits.maxRequests - state.usedBase);
    const burstRemaining = Math.max(0, limits.burstReserve - state.usedBurst);

    if (cost > baseRemaining + burstRemaining) {
      return {
        allowed: false,
        remaining: baseRemaining,
        resetAtMs,
        burstRemaining,
        usedBurst: 0,
      };
    }

    const fromBase = Math.min(cost, baseRemaining);
    const fromBurst = cost - fromBase;
    state.usedBase += fromBase;
    state.usedBurst += fromBurst;

    return {
      allowed: true,
      remaining: Math.max(0, limits.maxRequests - state.usedBase),
      resetAtMs,
      burstRemaining: Math.max(0, limits.burstReserve - state.usedBurst),
      usedBurst: fromBurst,
    };
  }

  getUsage(tenantId: string, nowMs: number): { used: number; remaining: number; burstUsed: number; burstRemaining: number } {
    const limits = this.getEffectiveLimits(tenantId);
    const state = this.tenants.get(tenantId);
    if (!state || nowMs - state.windowStartMs >= this.config.windowMs) {
      return {
        used: 0,
        remaining: limits.maxRequests,
        burstUsed: 0,
        burstRemaining: limits.burstReserve,
      };
    }
    return {
      used: state.usedBase,
      remaining: Math.max(0, limits.maxRequests - state.usedBase),
      burstUsed: state.usedBurst,
      burstRemaining: Math.max(0, limits.burstReserve - state.usedBurst),
    };
  }

  resetTenant(tenantId: string): void {
    this.tenants.delete(tenantId);
  }
}
`,
    featureTests: `import { RateLimiter } from '../src/limiter';

test('spills weighted cost from base quota into burstReserve accurately', () => {
  const limiter = new RateLimiter({ windowMs: 10000, maxRequests: 5, burstReserve: 4 });
  const r1 = limiter.check('acme', 1000, 3);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);
  assert.equal(r1.burstRemaining, 4);
  assert.equal(r1.usedBurst, 0);

  // Cost 4 consumes 2 from base and 2 from burst
  const r2 = limiter.check('acme', 1200, 4);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);
  assert.equal(r2.burstRemaining, 2);
  assert.equal(r2.usedBurst, 2);
});

test('enforces atomic rejection without deducting quota when cost exceeds base + burst', () => {
  const limiter = new RateLimiter({ windowMs: 10000, maxRequests: 2, burstReserve: 2 });
  const denied = limiter.check('acme', 1000, 5);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 2);
  assert.equal(denied.burstRemaining, 2);

  // Subsequent smaller request must still succeed using intact quota
  const ok = limiter.check('acme', 1050, 4);
  assert.equal(ok.allowed, true);
  assert.equal(ok.remaining, 0);
  assert.equal(ok.burstRemaining, 0);
});

test('supports isolated tenant overrides and resets burst pool on window rollover', () => {
  const limiter = new RateLimiter({ windowMs: 5000, maxRequests: 2, burstReserve: 0 });
  limiter.setTenantOverride('enterprise', { maxRequests: 6, burstReserve: 3 });

  const e1 = limiter.check('enterprise', 0, 8);
  assert.equal(e1.allowed, true);
  assert.equal(e1.burstRemaining, 1);

  // Free tenant remains bounded by default config
  assert.equal(limiter.check('free', 0, 3).allowed, false);

  // After window rollover burst is replenished
  const e2 = limiter.check('enterprise', 5000, 9);
  assert.equal(e2.allowed, true);
  assert.equal(e2.burstRemaining, 0);
});

test('rejects invalid non-positive or fractional request costs', () => {
  const limiter = new RateLimiter({ windowMs: 5000, maxRequests: 5 });
  assert.throws(() => limiter.check('t1', 0, 0));
  assert.throws(() => limiter.check('t1', 0, -2));
  assert.throws(() => limiter.check('t1', 0, 1.5));
});
`,
    mutants: [
      {
        id: 'MUT-004-A',
        label: 'Partial deduction on rejected request breaks atomicity',
        faultCategory: 'Atomicity Violation',
        description:
          'Drains remaining base quota even when a heavy request cannot be satisfied by base + burst.',
        mutatedCode: `export class RateLimiter {
  private config: { windowMs: number; maxRequests: number; burstReserve: number };
  private tenants: Map<string, { windowStartMs: number; usedBase: number; usedBurst: number }> = new Map();
  private overrides: Map<string, { maxRequests: number; burstReserve: number }> = new Map();
  constructor(config: { windowMs: number; maxRequests: number; burstReserve?: number }) {
    if (config.windowMs <= 0 || config.maxRequests <= 0) throw new Error('invalid');
    this.config = { windowMs: config.windowMs, maxRequests: config.maxRequests, burstReserve: config.burstReserve ?? 0 };
  }
  setTenantOverride(tenantId: string, override: { maxRequests: number; burstReserve?: number }) {
    this.overrides.set(tenantId, { maxRequests: override.maxRequests, burstReserve: override.burstReserve ?? this.config.burstReserve });
  }
  check(tenantId: string, nowMs: number, cost = 1) {
    if (!Number.isInteger(cost) || cost <= 0) throw new Error('bad cost');
    const limits = this.overrides.get(tenantId) ?? this.config;
    let state = this.tenants.get(tenantId);
    if (!state || nowMs - state.windowStartMs >= this.config.windowMs) {
      state = { windowStartMs: nowMs, usedBase: 0, usedBurst: 0 };
      this.tenants.set(tenantId, state);
    }
    const baseRem = Math.max(0, limits.maxRequests - state.usedBase);
    const burstRem = Math.max(0, limits.burstReserve - state.usedBurst);
    const fromBase = Math.min(cost, baseRem);
    // BUG: mutates usedBase BEFORE checking if burst covers remainder
    state.usedBase += fromBase;
    const neededBurst = cost - fromBase;
    if (neededBurst > burstRem) {
      return { allowed: false, remaining: Math.max(0, limits.maxRequests - state.usedBase), resetAtMs: state.windowStartMs + this.config.windowMs, burstRemaining: burstRem, usedBurst: 0 };
    }
    state.usedBurst += neededBurst;
    return { allowed: true, remaining: Math.max(0, limits.maxRequests - state.usedBase), resetAtMs: state.windowStartMs + this.config.windowMs, burstRemaining: burstRem - neededBurst, usedBurst: neededBurst };
  }
  getUsage(tenantId: string, nowMs: number) {
    const limits = this.overrides.get(tenantId) ?? this.config;
    const state = this.tenants.get(tenantId);
    if (!state || nowMs - state.windowStartMs >= this.config.windowMs) return { used: 0, remaining: limits.maxRequests };
    return { used: state.usedBase, remaining: Math.max(0, limits.maxRequests - state.usedBase) };
  }
  resetTenant(tenantId: string) { this.tenants.delete(tenantId); }
}`,
      },
      {
        id: 'MUT-004-B',
        label: 'Burst pool never resets across window boundaries',
        faultCategory: 'Lifecycle Reset Bug',
        description:
          'Resets base usage on window rollover while preserving exhausted usedBurst counter permanently.',
        mutatedCode: `export class RateLimiter {
  private config: { windowMs: number; maxRequests: number; burstReserve: number };
  private tenants: Map<string, { windowStartMs: number; usedBase: number; usedBurst: number }> = new Map();
  private overrides: Map<string, { maxRequests: number; burstReserve: number }> = new Map();
  constructor(config: { windowMs: number; maxRequests: number; burstReserve?: number }) {
    if (config.windowMs <= 0 || config.maxRequests <= 0) throw new Error('invalid');
    this.config = { windowMs: config.windowMs, maxRequests: config.maxRequests, burstReserve: config.burstReserve ?? 0 };
  }
  setTenantOverride(tenantId: string, override: { maxRequests: number; burstReserve?: number }) {
    this.overrides.set(tenantId, { maxRequests: override.maxRequests, burstReserve: override.burstReserve ?? this.config.burstReserve });
  }
  check(tenantId: string, nowMs: number, cost = 1) {
    if (!Number.isInteger(cost) || cost <= 0) throw new Error('bad cost');
    const limits = this.overrides.get(tenantId) ?? this.config;
    let state = this.tenants.get(tenantId);
    if (!state) {
      state = { windowStartMs: nowMs, usedBase: 0, usedBurst: 0 };
      this.tenants.set(tenantId, state);
    } else if (nowMs - state.windowStartMs >= this.config.windowMs) {
      // BUG: resets usedBase but forgets to reset usedBurst
      state.windowStartMs = nowMs;
      state.usedBase = 0;
    }
    const baseRem = Math.max(0, limits.maxRequests - state.usedBase);
    const burstRem = Math.max(0, limits.burstReserve - state.usedBurst);
    if (cost > baseRem + burstRem) {
      return { allowed: false, remaining: baseRem, resetAtMs: state.windowStartMs + this.config.windowMs, burstRemaining: burstRem, usedBurst: 0 };
    }
    const fromBase = Math.min(cost, baseRem);
    const fromBurst = cost - fromBase;
    state.usedBase += fromBase;
    state.usedBurst += fromBurst;
    return { allowed: true, remaining: Math.max(0, limits.maxRequests - state.usedBase), resetAtMs: state.windowStartMs + this.config.windowMs, burstRemaining: burstRem - fromBurst, usedBurst: fromBurst };
  }
  getUsage(tenantId: string, nowMs: number) {
    const limits = this.overrides.get(tenantId) ?? this.config;
    const state = this.tenants.get(tenantId);
    if (!state || nowMs - state.windowStartMs >= this.config.windowMs) return { used: 0, remaining: limits.maxRequests };
    return { used: state.usedBase, remaining: Math.max(0, limits.maxRequests - state.usedBase) };
  }
  resetTenant(tenantId: string) { this.tenants.delete(tenantId); }
}`,
      },
    ],
  },
];
