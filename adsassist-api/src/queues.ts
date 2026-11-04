export const QUEUES = {
  adsSync: 'ads-sync',
  tracking: 'tracking',
  conversions: 'conversions',
  /** Phase 2 background work: audiences, webhooks, alerts, digests, lead forms, competitors. */
  automation: 'automation',
} as const;

export type AutomationJob =
  | { name: 'audience-sync'; data: { audienceId: string } }
  | { name: 'webhook-deliver'; data: { deliveryId: string } }
  | { name: 'leadform-import'; data: { subscriptionId: string } }
  | { name: 'competitor-refresh'; data: { watchId: string } }
  | { name: 'tick-alerts' | 'tick-audiences' | 'tick-digests' | 'tick-leadforms' | 'tick-competitors'; data: Record<string, never> };

export interface AdsSyncJob {
  adAccountId: string;
  trigger: 'schedule' | 'manual' | 'initial';
  days: number;
}

export interface IdentifyJob {
  workspaceId: string;
  deviceKey: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  consent?: boolean | null;
  country?: string;
  /** Present for form submits: create/merge a lead once the contact is known. */
  lead?: {
    fields: Record<string, string>;
    touch: {
      gclid: string | null;
      fbclid: string | null;
      fbp: string | null;
      landingPage: string | null;
      utm: Record<string, string | undefined>;
    };
    ip: string;
    userAgent: string;
  };
}

export interface PixelConversionJob {
  workspaceId: string;
  deviceKey: string;
  value: number | null;
}

export interface ConversionJob {
  pushId: string;
}

export const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 7 * 86_400 },
};
