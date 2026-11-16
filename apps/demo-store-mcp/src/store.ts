/** Simulated store. Pure and dependency-free. Money is integer cents. Nothing leaves the process. */

export interface DemoOrder {
  id: string;
  customerName: string;
  status: string;
  currency: string;
  totalCents: number;
}

export interface DemoRefund {
  id: string;
  orderId: string;
  amountCents: number;
  currency: string;
  reason: string;
  status: 'simulated';
  createdAt: string;
}

export interface DemoEmail {
  id: number;
  orderId: string;
  subject: string;
  body: string;
  status: 'simulated_not_sent';
  createdAt: string;
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export const SEED_ORDERS: readonly DemoOrder[] = [
  {
    id: 'ORD-1042',
    customerName: 'Ada Ficticia',
    status: 'paid',
    currency: 'USD',
    totalCents: 14999,
  },
  {
    id: 'ORD-1043',
    customerName: 'Berto Ejemplo',
    status: 'paid',
    currency: 'USD',
    totalCents: 4500,
  },
  {
    id: 'ORD-1044',
    customerName: 'Carla Demo',
    status: 'shipped',
    currency: 'USD',
    totalCents: 82000,
  },
];

const MAX_BODY = 2000;

export class DemoStore {
  private orders = new Map<string, DemoOrder>();
  private refunds: DemoRefund[] = [];
  private emails: DemoEmail[] = [];
  private nextEmailId = 1;
  private nextRefundId = 1;

  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
    this.reset();
  }

  /** Restores the repeatable seed and clears refunds and emails. */
  reset(): void {
    this.orders = new Map(SEED_ORDERS.map((o) => [o.id, { ...o }]));
    this.refunds = [];
    this.emails = [];
    this.nextEmailId = 1;
    this.nextRefundId = 1;
  }

  getOrder(orderId: string): StoreResult<DemoOrder> {
    const o = this.orders.get(orderId);
    if (!o) return { ok: false, code: 'order_not_found', message: 'La orden no existe.' };
    return { ok: true, value: { ...o } };
  }

  issueRefund(
    orderId: string,
    amountCents: number,
    currency: string,
    reason: string,
  ): StoreResult<DemoRefund> {
    const o = this.orders.get(orderId);
    if (!o) return { ok: false, code: 'order_not_found', message: 'La orden no existe.' };
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return {
        ok: false,
        code: 'invalid_amount',
        message: 'El monto debe ser un entero positivo en centavos.',
      };
    }
    if (currency !== o.currency) {
      return {
        ok: false,
        code: 'currency_mismatch',
        message: 'La moneda no coincide con la orden.',
      };
    }
    const refunded = this.refunds
      .filter((r) => r.orderId === orderId)
      .reduce((a, r) => a + r.amountCents, 0);
    if (refunded + amountCents > o.totalCents) {
      return {
        ok: false,
        code: 'exceeds_total',
        message: 'El reembolso supera el total de la orden.',
      };
    }
    const refund: DemoRefund = {
      id: `REF-${String(this.nextRefundId++).padStart(4, '0')}`,
      orderId,
      amountCents,
      currency,
      reason: reason.slice(0, 200),
      status: 'simulated',
      createdAt: this.now().toISOString(),
    };
    this.refunds.push(refund);
    return { ok: true, value: { ...refund } };
  }

  sendCustomerEmail(orderId: string, subject: string, body: string): StoreResult<DemoEmail> {
    if (!this.orders.has(orderId)) {
      return { ok: false, code: 'order_not_found', message: 'La orden no existe.' };
    }
    const email: DemoEmail = {
      id: this.nextEmailId++,
      orderId,
      subject: subject.slice(0, 200),
      body: body.slice(0, MAX_BODY),
      status: 'simulated_not_sent',
      createdAt: this.now().toISOString(),
    };
    this.emails.push(email);
    return { ok: true, value: { ...email } };
  }

  listRefunds(): DemoRefund[] {
    return this.refunds.map((r) => ({ ...r }));
  }

  listEmails(): DemoEmail[] {
    return this.emails.map((e) => ({ ...e }));
  }
}
