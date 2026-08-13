import { describe, it, expect } from 'vitest';
import {
  PrismaClient,
  User,
  Client,
  InvoiceTemplate,
  FeatureFlag,
  UptimeCheck,
  Prisma,
} from '@prisma/client';

describe('M0 Prisma Schema & Client Type Validation', () => {
  it('should export all required M0 model types', () => {
    // Verify type shapes at runtime/type-level
    const user: Partial<User> = {
      id: 'usr_1',
      email: 'test@example.com',
      locale: 'en',
    };
    expect(user.locale).toBe('en');

    const template: Partial<InvoiceTemplate> = {
      id: 'tmpl_1',
      name: 'Monthly Retainer',
      client: 'Acme Corp',
      items: [{ description: 'Dev service', amount: 5000 }],
      subtotal: 5000,
      tax: 500,
      total: 5500,
      currency: 'USD',
      notes: 'Standard retainer template',
      userId: 'usr_1',
      clientId: 'cli_1',
    };
    expect(template.name).toBe('Monthly Retainer');
    expect(template.userId).toBe('usr_1');

    const flag: Partial<FeatureFlag> = {
      id: 'flag_1',
      key: 'bayesian_ab_overlay',
      name: 'Bayesian A/B Overlay',
      description: 'Enable Bayesian A/B statistical overlay',
      enabled: true,
      targetTenants: ['tenant_1', 'tenant_2'],
    };
    expect(flag.key).toBe('bayesian_ab_overlay');
    expect(flag.enabled).toBe(true);

    const uptime: Partial<UptimeCheck> = {
      id: 'up_1',
      url: 'https://api.invosmart.com/health',
      name: 'API Health',
      statusCode: 200,
      latencyMs: 145.5,
      status: 'UP',
      error: null,
    };
    expect(uptime.statusCode).toBe(200);
    expect(uptime.status).toBe('UP');
  });

  it('should support Prisma Input types for M0 models', () => {
    const templateInput: Prisma.InvoiceTemplateCreateInput = {
      name: 'Quarterly Audit',
      client: 'Beta LLC',
      items: JSON.stringify([{ item: 'Audit', price: 1000 }]),
      subtotal: 1000,
      tax: 100,
      total: 1100,
      currency: 'IDR',
      notes: 'Quarterly audit invoice',
      user: {
        connect: { id: 'usr_123' },
      },
    };
    expect(templateInput.name).toBe('Quarterly Audit');

    const flagInput: Prisma.FeatureFlagCreateInput = {
      key: 'new_dashboard',
      name: 'New Dashboard UI',
      enabled: false,
    };
    expect(flagInput.key).toBe('new_dashboard');

    const uptimeInput: Prisma.UptimeCheckCreateInput = {
      url: 'http://localhost:3000/api/health',
      statusCode: 500,
      latencyMs: 2050,
      status: 'DOWN',
      error: 'Internal Server Error',
    };
    expect(uptimeInput.status).toBe('DOWN');
  });

  it('should expose delegate methods on PrismaClient instance', () => {
    const prisma = new PrismaClient();
    expect(prisma.invoiceTemplate).toBeDefined();
    expect(prisma.featureFlag).toBeDefined();
    expect(prisma.uptimeCheck).toBeDefined();
    expect(prisma.client).toBeDefined();
    expect(typeof prisma.user).toBe('object');
    expect(typeof prisma.invoice).toBe('object');
  });
});
