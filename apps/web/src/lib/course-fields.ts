import type { FieldDef } from '@/components/form';
import { label } from './format';

export function courseFields(categories: { value: string; label: string }[]): FieldDef[] {
  return [
    { name: 'code', label: 'Course code', required: true, help: 'Letters, digits and dashes, for example SMS-001' }, { name: 'title', label: 'Title', required: true },
    { name: 'category_id', label: 'Category', type: 'select', required: true, options: categories, help: 'The category code appears in certificate numbers' },
    { name: 'delivery_method', label: 'Delivery', type: 'select', required: true, options: ['classroom', 'online', 'blended', 'practical'].map((v) => ({ value: v, label: label(v) })) },
    { name: 'duration_hours', label: 'Duration (hours)', type: 'number', required: true, min: 0, step: 0.5 }, { name: 'capacity', label: 'Default capacity', type: 'number', required: true, min: 1 },
    { name: 'fee', label: 'Fee (GHS)', type: 'number', required: true, min: 0, step: 0.01 }, { name: 'pass_mark', label: 'Pass mark (%)', type: 'number', required: true, min: 0, max: 100 },
    { name: 'min_attendance_pct', label: 'Minimum attendance (%)', type: 'number', required: true, min: 0, max: 100 }, { name: 'validity_months', label: 'Certificate valid for (months)', type: 'number', min: 1, help: 'Leave empty if it never expires' },
    { name: 'approving_body', label: 'Approved or recognised by', help: 'For example the regulator or standard the course is aligned to' }, { name: 'approval_reference', label: 'Approval reference' },
    { name: 'approval_expiry', label: 'Approval expires', type: 'date' }, { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active (can be scheduled)' }, { value: 'archived', label: 'Archived' }] },
    { name: 'description', label: 'Description', type: 'textarea', full: true }, { name: 'objectives', label: 'Objectives', type: 'textarea', full: true }, { name: 'target_audience', label: 'Target audience', full: true },
  ];
}

