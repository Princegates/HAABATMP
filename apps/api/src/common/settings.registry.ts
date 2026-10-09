import { z, ZodTypeAny } from 'zod';
import { Role } from './permissions';

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'email' | 'tags' | 'methods';
export interface Field {
  name: string;
  label: string;
  type: FieldType;
  help?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}
export interface PageDef {
  key: string;
  title: string;
  description: string;
  /** active = enforced by the platform. planned = shown disabled so nobody configures something that does nothing. */
  status: 'active' | 'planned';
  readOnly?: boolean;
  writeRoles: Role[];
  schema: ZodTypeAny;
  defaults: Record<string, any>;
  fields: Field[];
}

const text = (max = 300) => z.string().trim().max(max);
const SUPER: Role[] = ['super_admin'];

/**
 * Menu order follows the reference "System Setting" group: one page per concern.
 * Secrets (API keys, passwords) never live here. They are environment variables on the host.
 */
export const SETTINGS_PAGES: PageDef[] = [
  {
    key: 'organization', title: 'General Setting', status: 'active', writeRoles: SUPER,
    description: 'Organisation details used on certificates, invoices, receipts and emails.',
    schema: z.object({ name: text(200).min(2), address: text(500), email: z.union([z.string().email(), z.literal('')]), phone: text(50), website: text(200), registration_number: text(100) }),
    defaults: { name: 'HAAB Aviation Consultancy Services Ltd.', address: '', email: '', phone: '', website: '', registration_number: '' },
    fields: [
      { name: 'name', label: 'Legal name', type: 'text' }, { name: 'registration_number', label: 'Registration number', type: 'text' },
      { name: 'address', label: 'Address', type: 'textarea' }, { name: 'email', label: 'Contact email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'text' }, { name: 'website', label: 'Website', type: 'text' },
    ],
  },
  {
    key: 'security', title: 'Security Setting', status: 'active', writeRoles: SUPER,
    description: 'Two-step sign-in with an authenticator app. Off by default. Anyone can still turn it on for their own account from My profile.',
    schema: z.object({ mfa_required_roles: z.array(z.enum(['super_admin', 'training_admin', 'instructor', 'trainee', 'org_admin', 'finance_officer', 'auditor'])).max(7) }),
    defaults: { mfa_required_roles: [] },
    fields: [{ name: 'mfa_required_roles', label: 'Roles that must use two-step sign-in', type: 'tags',
      help: 'Leave empty to make it optional for everyone. Otherwise list roles, for example super_admin, finance_officer. Those people are asked to set it up at their next sign-in.' }],
  },
  {
    key: 'registration', title: 'Trainee Registration', status: 'active', writeRoles: SUPER,
    description: 'Lets trainees request an account from the sign-in page. Off by default. Nobody gets in until a HAAB administrator approves the request; approval sends the invitation email.',
    schema: z.object({ enabled: z.boolean(), notice: text(500) }),
    defaults: { enabled: false, notice: '' },
    fields: [
      { name: 'enabled', label: 'Allow trainees to request an account', type: 'boolean' },
      { name: 'notice', label: 'Message shown on the request form', type: 'textarea', help: 'Optional. For example: use your work email address.' },
    ],
  },
  {
    key: 'trainee_access', title: 'Trainee Access', status: 'active', writeRoles: SUPER,
    description: 'What trainees can see when they sign in.',
    schema: z.object({ show_finance: z.boolean() }),
    defaults: { show_finance: true },
    fields: [{ name: 'show_finance', label: 'Show Finance (invoices and receipts) to trainees', type: 'boolean',
      help: 'Turn this off if trainees never pay HAAB directly, for example when their employer is billed. They then see no invoices, and the platform refuses requests for them.' }],
  },
  {
    key: 'period', title: 'Training Period', status: 'active', writeRoles: SUPER,
    description: 'When the reporting year starts. Dashboards and reports default to the current period.',
    schema: z.object({ start_month: z.number().int().min(1).max(12) }),
    defaults: { start_month: 1 },
    fields: [{ name: 'start_month', label: 'Reporting year starts in month', type: 'number', min: 1, max: 12, help: '1 = January' }],
  },
  {
    key: 'training', title: 'Training Rules', status: 'active', writeRoles: SUPER,
    description: 'Defaults for new courses and the rules that protect the integrity of results.',
    schema: z.object({
      default_pass_mark: z.number().int().min(0).max(100), default_min_attendance_pct: z.number().int().min(0).max(100),
      certificate_expiring_soon_days: z.number().int().min(1).max(365), enforce_maker_checker: z.boolean(),
    }),
    defaults: { default_pass_mark: 70, default_min_attendance_pct: 80, certificate_expiring_soon_days: 60, enforce_maker_checker: true },
    fields: [
      { name: 'default_pass_mark', label: 'Default pass mark (%)', type: 'number', min: 0, max: 100 },
      { name: 'default_min_attendance_pct', label: 'Default minimum attendance (%)', type: 'number', min: 0, max: 100 },
      { name: 'certificate_expiring_soon_days', label: 'Mark certificates "expiring soon" within (days)', type: 'number', min: 1, max: 365 },
      { name: 'enforce_maker_checker', label: 'Marker cannot finalise the results they marked', type: 'boolean', help: 'Two-person control. Recommended on.' },
    ],
  },
  {
    key: 'notifications', title: 'Notification Setting', status: 'active', writeRoles: SUPER,
    description: 'Which events notify people, and when expiry reminders go out.',
    schema: z.object({
      email_enabled: z.boolean(), expiry_reminder_days: z.array(z.number().int().min(1).max(365)).max(6),
      notify_registration: z.boolean(), notify_results: z.boolean(), notify_certificates: z.boolean(), notify_session_reminders: z.boolean(),
    }),
    defaults: { email_enabled: true, expiry_reminder_days: [90, 60, 30], notify_registration: true, notify_results: true, notify_certificates: true, notify_session_reminders: true },
    fields: [
      { name: 'email_enabled', label: 'Send email notifications', type: 'boolean' },
      { name: 'notify_registration', label: 'Registration and enrolment', type: 'boolean' },
      { name: 'notify_session_reminders', label: 'Training reminders', type: 'boolean' },
      { name: 'notify_results', label: 'Examination results', type: 'boolean' },
      { name: 'notify_certificates', label: 'Certificates issued or revoked', type: 'boolean' },
      { name: 'expiry_reminder_days', label: 'Certificate expiry reminders (days before)', type: 'tags', help: 'For example 90, 60, 30' },
    ],
  },
  {
    key: 'whatsapp', title: 'WhatsApp Messaging', status: 'planned', writeRoles: SUPER,
    description: 'Planned (SRS phase 3). Not available yet.',
    schema: z.object({ enabled: z.literal(false) }), defaults: { enabled: false }, fields: [],
  },
  {
    key: 'sms', title: 'SMS Setting', status: 'planned', writeRoles: SUPER,
    description: 'Planned (SRS phase 2). Not available yet.',
    schema: z.object({ enabled: z.literal(false) }), defaults: { enabled: false }, fields: [],
  },
  {
    key: 'email', title: 'Email Setting', status: 'active', writeRoles: SUPER,
    description: 'How outgoing email appears. The provider key is an environment variable on the host, never stored here.',
    schema: z.object({ from_name: text(100).min(2), reply_to: z.union([z.string().email(), z.literal('')]), signature: text(1000) }),
    defaults: { from_name: 'HAAB Aviation Consultancy Services', reply_to: '', signature: '' },
    fields: [
      { name: 'from_name', label: 'Sender name', type: 'text' }, { name: 'reply_to', label: 'Reply-to address', type: 'email' },
      { name: 'signature', label: 'Signature added to every email', type: 'textarea' },
    ],
  },
  {
    key: 'payment_methods', title: 'Payment Methods', status: 'active', writeRoles: ['super_admin', 'finance_officer'],
    description: 'Ways payments can be recorded, and the instructions printed on invoices.',
    schema: z.object({
      methods: z.array(z.object({ key: z.enum(['cash', 'bank_transfer', 'mobile_money', 'card', 'cheque', 'other']), label: text(60).min(2), enabled: z.boolean(), instructions: text(1000) })).min(1).max(6),
    }),
    defaults: {
      methods: [
        { key: 'bank_transfer', label: 'Bank transfer', enabled: true, instructions: '' },
        { key: 'mobile_money', label: 'Mobile money', enabled: true, instructions: '' },
        { key: 'cheque', label: 'Cheque', enabled: true, instructions: '' },
        { key: 'cash', label: 'Cash', enabled: true, instructions: '' },
        { key: 'card', label: 'Card', enabled: false, instructions: '' },
        { key: 'other', label: 'Other', enabled: true, instructions: '' },
      ],
    },
    fields: [{ name: 'methods', label: 'Payment methods', type: 'methods' }],
  },
  {
    key: 'finance', title: 'Currency', status: 'active', writeRoles: ['super_admin', 'finance_officer'],
    description: 'Currency, tax and invoicing rules.',
    schema: z.object({ currency: z.string().length(3).toUpperCase(), tax_rate: z.number().min(0).max(100), require_payment_before_confirmation: z.boolean(), invoice_due_days: z.number().int().min(0).max(180) }),
    defaults: { currency: 'GHS', tax_rate: 0, require_payment_before_confirmation: false, invoice_due_days: 14 },
    fields: [
      { name: 'currency', label: 'Currency code', type: 'text', help: 'For example GHS or USD' },
      { name: 'tax_rate', label: 'Tax rate (%)', type: 'number', min: 0, max: 100 },
      { name: 'invoice_due_days', label: 'Invoice due after (days)', type: 'number', min: 0, max: 180 },
      { name: 'require_payment_before_confirmation', label: 'Require payment before confirming a place', type: 'boolean', help: 'Client-sponsored places are exempt.' },
    ],
  },
  {
    key: 'print', title: 'Print Header Footer', status: 'active', writeRoles: ['super_admin', 'training_admin', 'finance_officer'],
    description: 'Header and footer text on invoices, receipts and reports.',
    schema: z.object({ header_text: text(300), footer_text: text(500), show_logo: z.boolean() }),
    defaults: { header_text: '', footer_text: '', show_logo: true },
    fields: [
      { name: 'show_logo', label: 'Show the logo', type: 'boolean' }, { name: 'header_text', label: 'Header text', type: 'text' },
      { name: 'footer_text', label: 'Footer text', type: 'textarea' },
    ],
  },
  {
    key: 'modules', title: 'Modules', status: 'active', writeRoles: SUPER,
    description: 'Switch optional features on or off.',
    schema: z.object({ qr_attendance: z.boolean(), learning_materials: z.boolean(), waiting_list: z.boolean() }),
    defaults: { qr_attendance: true, learning_materials: true, waiting_list: true },
    fields: [
      { name: 'qr_attendance', label: 'QR code attendance', type: 'boolean' },
      { name: 'learning_materials', label: 'Learning materials and progress', type: 'boolean' },
      { name: 'waiting_list', label: 'Waiting list when a programme is full', type: 'boolean' },
    ],
  },
  {
    key: 'file_types', title: 'File Types', status: 'active', writeRoles: SUPER,
    description: 'What people may upload. Files are checked by content, not just by name.',
    schema: z.object({ allowed: z.array(z.enum(['pdf', 'png', 'jpg', 'docx', 'xlsx', 'pptx', 'csv', 'txt'])).min(1), max_mb: z.number().min(1).max(100) }),
    defaults: { allowed: ['pdf', 'png', 'jpg', 'docx', 'xlsx', 'pptx', 'csv', 'txt'], max_mb: 25 },
    fields: [
      { name: 'allowed', label: 'Allowed file types', type: 'tags', help: 'pdf, png, jpg, docx, xlsx, pptx, csv, txt' },
      { name: 'max_mb', label: 'Largest file (MB)', type: 'number', min: 1, max: 100 },
    ],
  },
  {
    key: 'backup', title: 'Backup Restore', status: 'active', writeRoles: SUPER,
    description: 'Backups run on the database host. Record each restore drill here so the recovery plan is proven, not assumed.',
    schema: z.object({ last_restore_test_at: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]), last_restore_test_notes: text(1000), target_rpo_hours: z.number().min(0).max(168), target_rto_hours: z.number().min(0).max(168) }),
    defaults: { last_restore_test_at: '', last_restore_test_notes: '', target_rpo_hours: 24, target_rto_hours: 4 },
    fields: [
      { name: 'target_rpo_hours', label: 'Target RPO (hours)', type: 'number', min: 0, max: 168, help: 'Most data you can afford to lose' },
      { name: 'target_rto_hours', label: 'Target RTO (hours)', type: 'number', min: 0, max: 168, help: 'Longest acceptable outage' },
      { name: 'last_restore_test_at', label: 'Last restore drill (YYYY-MM-DD)', type: 'text' },
      { name: 'last_restore_test_notes', label: 'Drill notes', type: 'textarea' },
    ],
  },
  {
    key: 'languages', title: 'Languages', status: 'planned', writeRoles: SUPER,
    description: 'Planned. The platform is English only for now.',
    schema: z.object({ default: z.literal('en') }), defaults: { default: 'en' }, fields: [],
  },
  {
    key: 'captcha', title: 'Captcha Setting', status: 'planned', writeRoles: SUPER,
    description: 'Planned. Sign-in is protected by rate limiting in the meantime.',
    schema: z.object({ enabled: z.literal(false) }), defaults: { enabled: false }, fields: [],
  },
];

export const PAGE_BY_KEY = new Map(SETTINGS_PAGES.map((p) => [p.key, p]));
