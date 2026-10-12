import type { FieldDef } from '@/components/form';
import { label } from './format';

/** Course fees stay in the system but are not shown for now: client organisations carry the cost of their trainees. */
export const SHOW_COURSE_FEE = false;

export function courseFields(categories: { value: string; label: string }[]): FieldDef[] {
  return [
    { name: 'code', label: 'Course code', required: true, help: 'Letters, digits and dashes, for example SMS-001' }, { name: 'title', label: 'Title', required: true },
    { name: 'category_id', label: 'Category', type: 'select', required: true, options: categories, help: 'The category code appears in certificate numbers' },
    { name: 'delivery_method', label: 'Delivery', type: 'select', required: true, options: ['classroom', 'online', 'blended', 'practical'].map((v) => ({ value: v, label: label(v) })) },
    { name: 'duration_hours', label: 'Duration (hours)', type: 'number', required: true, min: 0, step: 0.5 }, { name: 'capacity', label: 'Default capacity', type: 'number', required: true, min: 1 },
    // The course fee is kept in the system but not shown while client organisations carry the cost of their trainees. Set SHOW_COURSE_FEE to true to bring it back.
    ...(SHOW_COURSE_FEE ? [{ name: 'fee', label: 'Fee (GHS)', type: 'number', required: true, min: 0, step: 0.01 } as FieldDef] : []), { name: 'pass_mark', label: 'Pass mark (%)', type: 'number', required: true, min: 0, max: 100 },
    { name: 'min_attendance_pct', label: 'Minimum attendance (%)', type: 'number', required: true, min: 0, max: 100 }, { name: 'validity_months', label: 'Certificate valid for (months)', type: 'number', min: 1, help: 'Leave empty if it never expires' },
    // Recognition fields (approving_body, approval_reference, approval_expiry) are hidden for now; the API and database still hold them.
    { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active (can be scheduled)' }, { value: 'archived', label: 'Archived' }] },
    { name: 'description', label: 'Description', type: 'textarea', full: true }, { name: 'objectives', label: 'Objectives', type: 'textarea', full: true }, { name: 'target_audience', label: 'Target audience', full: true },
  ];
}

