export type IntegrationFieldType = 'text' | 'secret' | 'select' | 'boolean' | 'number';
export interface IntegrationField {
  name: string;
  label: string;
  type: IntegrationFieldType;
  help?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}
export interface IntegrationDef {
  key: string;
  title: string;
  description: string;
  /** active = used by the platform today. planned = can be stored ahead of the phase that uses it. */
  status: 'active' | 'planned';
  testable: boolean;
  fields: IntegrationField[];
  /** Environment variable names that supply a value when nothing is stored (so existing deployments keep working). */
  env?: Record<string, string>;
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: 'email', title: 'Email (Resend)', status: 'active', testable: true,
    description: 'Sends registration, reminder, result, certificate and expiry emails.',
    env: { api_key: 'RESEND_API_KEY', from_address: 'MAIL_FROM' },
    fields: [
      { name: 'api_key', label: 'API key', type: 'secret', required: true, help: 'From the Resend dashboard. Starts with re_' },
      { name: 'from_address', label: 'Sender', type: 'text', required: true, help: 'For example: HAAB Training <training@yourdomain.com>. The domain must be verified with the provider.' },
    ],
  },
  {
    key: 'malware_scan', title: 'Malware scanning (ClamAV)', status: 'active', testable: true,
    description: 'Scans uploaded documents before they are stored.',
    env: { host: 'CLAMAV_HOST', port: 'CLAMAV_PORT' },
    fields: [
      { name: 'host', label: 'ClamAV host', type: 'text', required: true }, { name: 'port', label: 'Port', type: 'number', help: 'Default 3310' },
    ],
  },
  {
    key: 'sms', title: 'SMS provider', status: 'planned', testable: false,
    description: 'SMS reminders (SRS phase 2). Credentials can be stored now.',
    fields: [
      { name: 'provider', label: 'Provider', type: 'select', options: [{ value: 'hubtel', label: 'Hubtel' }, { value: 'twilio', label: 'Twilio' }, { value: 'other', label: 'Other' }] },
      { name: 'client_id', label: 'Client ID / Account SID', type: 'text' }, { name: 'client_secret', label: 'Client secret / Auth token', type: 'secret' },
      { name: 'sender_id', label: 'Sender ID', type: 'text' },
    ],
  },
  {
    key: 'whatsapp', title: 'WhatsApp Business', status: 'planned', testable: false,
    description: 'WhatsApp notifications (SRS phase 3).',
    fields: [
      { name: 'phone_number_id', label: 'Phone number ID', type: 'text' }, { name: 'access_token', label: 'Access token', type: 'secret' },
    ],
  },
  {
    key: 'payment_gateway', title: 'Payment gateway', status: 'planned', testable: false,
    description: 'Online payments (Paystack, Hubtel or Flutterwave). Payments are recorded manually until this is built.',
    fields: [
      { name: 'provider', label: 'Provider', type: 'select', options: [{ value: 'paystack', label: 'Paystack' }, { value: 'hubtel', label: 'Hubtel' }, { value: 'flutterwave', label: 'Flutterwave' }] },
      { name: 'public_key', label: 'Public key', type: 'text' }, { name: 'secret_key', label: 'Secret key', type: 'secret' },
      { name: 'webhook_secret', label: 'Webhook signing secret', type: 'secret' },
    ],
  },
  {
    key: 'captcha', title: 'Captcha (Cloudflare Turnstile)', status: 'planned', testable: false,
    description: 'Bot protection on sign-in.',
    fields: [{ name: 'site_key', label: 'Site key', type: 'text' }, { name: 'secret_key', label: 'Secret key', type: 'secret' }],
  },
  {
    key: 'video_conferencing', title: 'Video conferencing (Zoom / Teams)', status: 'planned', testable: false,
    description: 'Online sessions (SRS phase 3).',
    fields: [
      { name: 'provider', label: 'Provider', type: 'select', options: [{ value: 'zoom', label: 'Zoom' }, { value: 'teams', label: 'Microsoft Teams' }] },
      { name: 'client_id', label: 'Client ID', type: 'text' }, { name: 'client_secret', label: 'Client secret', type: 'secret' }, { name: 'tenant_id', label: 'Tenant / Account ID', type: 'text' },
    ],
  },
  {
    key: 'sso', title: 'Single sign-on (Microsoft 365 / Google)', status: 'planned', testable: false,
    description: 'Corporate sign-in (SRS future integration).',
    fields: [
      { name: 'provider', label: 'Provider', type: 'select', options: [{ value: 'microsoft', label: 'Microsoft 365' }, { value: 'google', label: 'Google Workspace' }] },
      { name: 'client_id', label: 'Client ID', type: 'text' }, { name: 'client_secret', label: 'Client secret', type: 'secret' }, { name: 'tenant_id', label: 'Tenant ID', type: 'text' },
    ],
  },
  {
    key: 'ai_assistant', title: 'AI training assistant', status: 'planned', testable: false,
    description: 'Course Q&A and analytics (SRS phase 3).',
    fields: [{ name: 'api_key', label: 'API key', type: 'secret' }, { name: 'model', label: 'Model', type: 'text' }],
  },
];

export const INTEGRATION_BY_KEY = new Map(INTEGRATIONS.map((i) => [i.key, i]));
