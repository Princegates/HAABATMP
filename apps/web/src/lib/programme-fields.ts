import type { FieldDef } from '@/components/form';
import { label } from './format';
type Opts = { value: string; label: string }[];

export function programmeFields(o: { courses: Opts; rooms: Opts; instructors: Opts; orgs: Opts; creating: boolean }): FieldDef[] {
  return [
    ...(o.creating ? [{ name: 'course_id', label: 'Course', type: 'select' as const, required: true, options: o.courses, full: true }] : []),
    { name: 'title', label: 'Title', help: 'Optional. Filled in from the course if left empty.', full: true },
    { name: 'start_date', label: 'Starts', type: 'date', required: true }, { name: 'end_date', label: 'Ends', type: 'date', required: true },
    { name: 'registration_deadline', label: 'Registration closes', type: 'date' }, { name: 'capacity', label: 'Places', type: 'number', min: 1, help: 'From the course if left empty' },
    { name: 'lead_instructor_id', label: 'Lead instructor', type: 'select', options: o.instructors }, { name: 'classroom_id', label: 'Classroom', type: 'select', options: o.rooms },
    { name: 'location', label: 'Location', help: 'For example the venue or "Online"' }, { name: 'fee', label: 'Fee per place (GHS)', type: 'number', min: 0, step: 0.01, help: 'From the course if left empty' },
    { name: 'delivery_method', label: 'Delivery', type: 'select', options: ['classroom', 'online', 'blended', 'practical'].map((v) => ({ value: v, label: label(v) })) },
    { name: 'organization_id', label: 'Reserved for one client', type: 'select', options: o.orgs, help: 'Leave empty to open it to everyone. A reserved programme is only visible to that client.' },
  ];
}
