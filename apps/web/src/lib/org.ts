import type { FieldDef } from '@/components/form';
import { label } from './format';

export const ORG_TYPES = ['airline', 'airport', 'ground_handler', 'cargo_operator', 'security_organization', 'other'].map((v) => ({ value: v, label: label(v) }));
export const orgFields: FieldDef[] = [
  { name: 'name', label: 'Organisation name', required: true, full: true }, { name: 'type', label: 'Type', type: 'select', required: true, options: ORG_TYPES }, { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  { name: 'contact_name', label: 'Contact person' }, { name: 'contact_email', label: 'Contact email', type: 'email' }, { name: 'contact_phone', label: 'Contact phone' },
  { name: 'billing_email', label: 'Billing email', type: 'email' }, { name: 'address', label: 'Address', type: 'textarea', full: true }, { name: 'billing_address', label: 'Billing address', type: 'textarea', full: true },
];

