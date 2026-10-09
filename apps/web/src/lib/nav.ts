import type { IconName } from '@/components/icons';
import type { Role } from './auth';

export interface NavItem { label: string; href: string; icon?: IconName; roles?: Role[] }
export interface NavGroup { label: string; icon: IconName; href?: string; roles: Role[]; items?: NavItem[] }

const STAFF: Role[] = ['super_admin', 'training_admin'];
const READERS: Role[] = [...STAFF, 'auditor'];
const ALL: Role[] = ['super_admin', 'training_admin', 'instructor', 'trainee', 'org_admin', 'finance_officer', 'auditor'];

export interface Tab { label: string; href: string; icon: IconName }
/** The four things each role does most, shown in the bottom bar on phones. "More" opens the full menu. */
export const TABS: Record<Role, Tab[]> = {
  trainee: [{ label: 'Home', href: '/', icon: 'dashboard' }, { label: 'Training', href: '/enrolments', icon: 'book' }, { label: 'Check in', href: '/checkin', icon: 'qr' }, { label: 'Results', href: '/results', icon: 'chart' }],
  super_admin: [{ label: 'Home', href: '/', icon: 'dashboard' }, { label: 'Trainees', href: '/trainees', icon: 'users' }, { label: 'Programmes', href: '/programmes', icon: 'calendar' }, { label: 'Attendance', href: '/attendance', icon: 'attendance' }],
  training_admin: [{ label: 'Home', href: '/', icon: 'dashboard' }, { label: 'Trainees', href: '/trainees', icon: 'users' }, { label: 'Programmes', href: '/programmes', icon: 'calendar' }, { label: 'Attendance', href: '/attendance', icon: 'attendance' }],
  instructor: [{ label: 'Home', href: '/', icon: 'dashboard' }, { label: 'Programmes', href: '/programmes', icon: 'calendar' }, { label: 'Attendance', href: '/attendance', icon: 'attendance' }, { label: 'Marking', href: '/marking', icon: 'file' }],
  org_admin: [{ label: 'Home', href: '/', icon: 'dashboard' }, { label: 'Trainees', href: '/trainees', icon: 'users' }, { label: 'Enrolments', href: '/enrolments', icon: 'list' }, { label: 'Results', href: '/results', icon: 'chart' }],
  finance_officer: [{ label: 'Home', href: '/', icon: 'dashboard' }, { label: 'Invoices', href: '/invoices', icon: 'card' }, { label: 'Clients', href: '/clients', icon: 'building' }, { label: 'Enrolments', href: '/enrolments', icon: 'list' }],
  auditor: [{ label: 'Home', href: '/', icon: 'dashboard' }, { label: 'Audit', href: '/audit', icon: 'shield' }, { label: 'Compliance', href: '/compliance', icon: 'attendance' }, { label: 'Reports', href: '/reports', icon: 'reports' }],
};

/** Same pattern as the reference: one group per module, sub-pages inside. Items a role cannot use are never rendered. */
export const NAV: NavGroup[] = [
  { label: 'Dashboard', icon: 'dashboard', href: '/', roles: ALL },
  { label: 'My training', icon: 'book', roles: ['trainee'], items: [
    { label: 'Registrations', href: '/enrolments' }, { label: 'Learning materials', href: '/learning' }, { label: 'Browse programmes', href: '/programmes' },
  ] },
  { label: 'Trainees', icon: 'users', roles: [...READERS, 'org_admin'], items: [
    { label: 'All trainees', href: '/trainees' }, { label: 'Bulk import', href: '/trainees?import=1', roles: [...STAFF, 'org_admin'] }, { label: 'Registration requests', href: '/registrations', roles: STAFF },
  ] },
  { label: 'Clients', icon: 'building', roles: [...READERS, 'finance_officer', 'org_admin'], href: '/clients' },
  { label: 'Instructors', icon: 'users', roles: READERS, href: '/instructors' },
  { label: 'Courses', icon: 'book', roles: [...READERS, 'instructor'], items: [
    { label: 'Catalogue', href: '/courses' }, { label: 'Categories', href: '/courses/categories', roles: [...STAFF, 'auditor'] },
  ] },
  { label: 'Programmes', icon: 'calendar', roles: ['super_admin', 'training_admin', 'auditor', 'instructor', 'org_admin', 'finance_officer'], items: [
    { label: 'Programmes', href: '/programmes' }, { label: 'Calendar', href: '/calendar', roles: [...READERS, 'instructor', 'org_admin'] }, { label: 'Classrooms', href: '/classrooms', roles: [...STAFF, 'auditor'] },
  ] },
  { label: 'Calendar', icon: 'calendar', roles: ['trainee'], href: '/calendar' },
  { label: 'Enrolments', icon: 'list', roles: [...READERS, 'org_admin', 'instructor', 'finance_officer'], href: '/enrolments' },
  { label: 'Attendance', icon: 'attendance', roles: [...STAFF, 'instructor'], href: '/attendance' },
  { label: 'Check in', icon: 'qr', roles: ['trainee'], href: '/checkin' },
  { label: 'Assessments', icon: 'file', roles: [...STAFF, 'instructor', 'auditor'], items: [
    { label: 'Assessments', href: '/assessments' }, { label: 'Question bank', href: '/questions', roles: [...STAFF, 'instructor'] }, { label: 'Marking queue', href: '/marking', roles: [...STAFF, 'instructor'] },
  ] },
  { label: 'Assessments', icon: 'file', roles: ['trainee'], href: '/exams' },
  { label: 'Results', icon: 'chart', roles: ['super_admin', 'training_admin', 'auditor', 'instructor', 'org_admin', 'trainee'], href: '/results' },
  { label: 'Certificates', icon: 'award', roles: ['super_admin', 'training_admin', 'auditor', 'org_admin', 'trainee'], items: [
    { label: 'Certificates', href: '/certificates' }, { label: 'Templates', href: '/settings/certificate-templates', roles: STAFF },
  ] },
  { label: 'Finance', icon: 'card', roles: ['super_admin', 'training_admin', 'auditor', 'finance_officer', 'org_admin', 'trainee'], items: [
    { label: 'Invoices', href: '/invoices' }, { label: 'Outstanding', href: '/reports?report=outstanding', roles: ['super_admin', 'training_admin', 'auditor', 'finance_officer', 'org_admin'] },
  ] },
  { label: 'Compliance', icon: 'shield', roles: [...READERS, 'org_admin'], href: '/compliance' },
  { label: 'Documents', icon: 'folder', roles: ALL, href: '/documents' },
  { label: 'Reports', icon: 'reports', roles: ['super_admin', 'training_admin', 'auditor', 'instructor', 'org_admin', 'finance_officer'], href: '/reports' },
  { label: 'Audit log', icon: 'eye', roles: ['super_admin', 'auditor'], href: '/audit' },
  { label: 'System setting', icon: 'settings', roles: ['super_admin', 'training_admin', 'auditor', 'finance_officer'], href: '/settings' },
];

export function navFor(role: Role) {
  return NAV.filter((g) => g.roles.includes(role)).map((g) => ({ ...g, items: g.items?.filter((i) => !i.roles || i.roles.includes(role)) }));
}
