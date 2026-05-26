/**
 * SMS provider abstraction.
 *
 * Each provider implements the same interface; the runtime picks the
 * first one that has its secrets set. To swap providers, set the new
 * provider's secrets and (optionally) unset the old one's — no code
 * change required.
 *
 * To add a provider:
 *   1. Add its config keys to the Env interface in index.ts
 *   2. Add a `SmsProvider` object below
 *   3. Append it to SMS_PROVIDERS (order = priority — first configured wins)
 */

import type { Env } from "./index";

export interface SmsRequest {
  body: string;
}

export interface SmsSendResult {
  ok: boolean;
  error?: string;
}

export interface SmsProvider {
  name: string;
  isConfigured(env: Env): boolean;
  recipient(env: Env): string;       // recipient phone number, E.164
  send(env: Env, req: SmsRequest): Promise<SmsSendResult>;
}

// ─── sms.to ──────────────────────────────────────────────────────────────────
// Simple Bearer-token REST API. Single secret + JSON body.
// Docs: https://sms.to/docs

export const smsToProvider: SmsProvider = {
  name: "sms.to",
  isConfigured(env) {
    return Boolean(env.SMSTO_API_KEY && env.SMSTO_TO);
  },
  recipient(env) {
    return env.SMSTO_TO!;
  },
  async send(env, req) {
    const resp = await fetch("https://api.sms.to/sms/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.SMSTO_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: env.SMSTO_TO,
        message: req.body,
      }),
    });
    if (!resp.ok) {
      return { ok: false, error: `sms.to ${resp.status}: ${await resp.text()}` };
    }
    return { ok: true };
  },
};

// ─── Twilio ──────────────────────────────────────────────────────────────────
// Account SID + Auth Token + sending number. Basic-auth form-encoded POST.
// Docs: https://www.twilio.com/docs/sms/api

export const twilioProvider: SmsProvider = {
  name: "twilio",
  isConfigured(env) {
    return Boolean(
      env.TWILIO_ACCOUNT_SID &&
        env.TWILIO_AUTH_TOKEN &&
        env.TWILIO_FROM &&
        env.TWILIO_TO,
    );
  },
  recipient(env) {
    return env.TWILIO_TO!;
  },
  async send(env, req) {
    const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const form = new URLSearchParams({
      From: env.TWILIO_FROM!,
      To: env.TWILIO_TO!,
      Body: req.body,
    });
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    if (!resp.ok) {
      return { ok: false, error: `twilio ${resp.status}: ${await resp.text()}` };
    }
    return { ok: true };
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────
// Order = priority. First configured provider wins. To switch providers,
// just configure the new one's secrets — no need to unset the old one.
// To unset: `wrangler-deploy secret delete <key>`.

export const SMS_PROVIDERS: SmsProvider[] = [smsToProvider, twilioProvider];

export function pickSmsProvider(env: Env): SmsProvider | null {
  for (const provider of SMS_PROVIDERS) {
    if (provider.isConfigured(env)) return provider;
  }
  return null;
}
