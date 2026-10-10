import type { IconName } from '@/components/icons';
import type { Role } from './auth';

export interface NavItem { label: string; href: string; icon?: IconName; roles?: Role[]; /** a role holding this permission can use the page, so the Super Administrator may add it to that role's menu */ perm?: string }
export interface NavGroup { label: string; icon: IconName; href?: string; roles: Role[]; perm?: string; items?: NavItem[] }

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
    { label: 'Registrations', href: '/enrolments', perm: 'enrollments:read' }, { label: 'Learning materials', href: '/learning' }, { label: 'Browse programmes', href: '/programmes', perm: 'programmes:read' },
  ] },
  { label: 'Trainees', perm: 'users:read', icon: 'users', roles: [...READERS, 'org_admin'], items: [
    { label: 'All trainees', href: '/trainees', perm: 'users:read' }, { label: 'Bulk import', href: '/trainees?import=1', roles: [...STAFF, 'org_admin'], perm: 'users:write' }, { label: 'Import from Excel', href: '/register-trainees', roles: STAFF }, { label: 'Registration requests', href: '/registrations', roles: STAFF },
  ] },
  { label: 'Register trainees', perm: 'trainees:register', icon: 'users', roles: ['instructor'], href: '/register-trainees' },
  { label: 'Clients', perm: 'orgs:read', icon: 'building', roles: [...READERS, 'finance_officer', 'org_admin'], href: '/clients' },
  { label: 'Instructors', perm: 'users:read', icon: 'users', roles: READERS, href: '/instructors' },
  { label: 'Courses', perm: 'courses:read', icon: 'book', roles: [...READERS, 'instructor'], items: [
    { label: 'Catalogue', href: '/courses', perm: 'courses:read' }, { label: 'Categories', href: '/courses/categories', roles: [...STAFF, 'auditor'], perm: 'courses:read' },
  ] },
  { label: 'Programmes', perm: 'programmes:read', icon: 'calendar', roles: ['super_admin', 'training_admin', 'auditor', 'instructor', 'org_admin', 'finance_officer'], items: [
    { label: 'Programmes', href: '/programmes', perm: 'programmes:read' }, { label: 'Calendar', href: '/calendar', roles: [...READERS, 'instructor', 'org_admin'], perm: 'programmes:read' }, { label: 'Classrooms', href: '/classrooms', roles: [...STAFF, 'auditor'], perm: 'programmes:read' },
  ] },
  { label: 'Calendar', icon: 'calendar', roles: ['trainee'], href: '/calendar' },
  { label: 'Enrolments', perm: 'enrollments:read', icon: 'list', roles: [...READERS, 'org_admin', 'instructor', 'finance_officer'], href: '/enrolments' },
  { label: 'Attendance', perm: 'attendance:read', icon: 'attendance', roles: [...STAFF, 'instructor'], href: '/attendance' },
  { label: 'Check in', icon: 'qr', roles: ['trainee'], href: '/checkin' },
  { label: 'Assessments', perm: 'assessments:read', icon: 'file', roles: [...STAFF, 'instructor', 'auditor'], items: [
    { label: 'Assessments', href: '/assessments', perm: 'assessments:read' }, { label: 'Question bank', href: '/questions', roles: [...STAFF, 'instructor'], perm: 'questions:write' }, { label: 'Marking queue', href: '/marking', roles: [...STAFF, 'instructor'], perm: 'attempts:mark' },
  ] },
  { label: 'Assessments', perm: 'assessments:read', icon: 'file', roles: ['trainee'], href: '/exams' },
  { label: 'Results', perm: 'results:read', icon: 'chart', roles: ['super_admin', 'training_admin', 'auditor', 'instructor', 'org_admin', 'trainee'], href: '/results' },
  { label: 'Certificates', perm: 'certificates:read', icon: 'award', roles: ['super_admin', 'training_admin', 'auditor', 'org_admin', 'trainee'], items: [
    { label: 'Certificates', href: '/certificates', perm: 'certificates:read' }, { label: 'Templates', href: '/settings/certificate-templates', roles: STAFF },
  ] },
  { label: 'Finance', perm: 'invoices:read', icon: 'card', roles: ['super_admin', 'training_admin', 'auditor', 'finance_officer', 'org_admin', 'trainee'], items: [
    { label: 'Invoices', href: '/invoices', perm: 'invoices:read' }, { label: 'Outstanding', href: '/reports?report=outstanding', roles: ['super_admin', 'training_admin', 'auditor', 'finance_officer', 'org_admin'], perm: 'invoices:read' },
  ] },
  { label: 'Compliance', perm: 'compliance:read', icon: 'shield', roles: [...READERS, 'org_admin'], href: '/compliance' },
  { label: 'Documents', perm: 'documents:read', icon: 'folder', roles: ALL, href: '/documents' },
  { label: 'Reports', perm: 'reports:read', icon: 'reports', roles: ['super_admin', 'training_admin', 'auditor', 'instructor', 'org_admin', 'finance_officer'], href: '/reports' },
  { label: 'Audit log', perm: 'audit:read', icon: 'eye', roles: ['super_admin', 'auditor'], href: '/audit' },
  { label: 'System setting', perm: 'settings:read', icon: 'settings', roles: ['super_admin', 'training_admin', 'auditor', 'finance_officer'], href: '/settings' },
];

/** The Super Administrator's menu choices for one role. */
export interface MenuChoice { hide: string[]; show: string[] }
export const groupKey = (g: { label: string }) => `g:${g.label}`;

/**
 * The menu one person sees: the built-in menu for their role, minus what the Super Administrator hid, plus what they added.
 * Adding only works for pages the role is permitted to use (it holds the permission), so this never opens anything up:
 * what a role may do is fixed on the server.
 */
export function visibleNav(role: Role, menu: MenuChoice | undefined, permissions: string[]) {
  const hide = new Set(menu?.hide ?? []);
  const show = new Set(menu?.show ?? []);
  const has = (perm?: string) => !!perm && permissions.includes(perm);
  const out: (NavGroup & { items?: NavItem[] })[] = [];
  for (const g of NAV) {
    const gKey = groupKey(g);
    const gDefault = g.roles.includes(role);
    const gOn = gDefault ? !hide.has(gKey) && (g.href ? !hide.has(g.href) : true) : (has(g.perm) || !!g.items?.some((i) => has(i.perm))) && show.has(gKey);
    if (!gOn) continue;
    if (!g.items) { out.push(g); continue; }
    const items = g.items.filter((i) => {
      const iDefault = gDefault && (!i.roles || i.roles.includes(role));
      return iDefault ? !hide.has(i.href) : has(i.perm) && (show.has(i.href) || !gDefault) && !hide.has(i.href);
    });
    if (items.length) out.push({ ...g, items });
  }
  return out;
}

/** True when the Super Administrator has hidden this page from the role, so the screen says so instead of showing it. */
export function isHiddenPath(menu: MenuChoice | undefined, path: string) {
  if (!menu?.hide.length || path === '/' || path.startsWith('/profile')) return false;
  const hidden = new Set<string>();
  for (const k of menu.hide) {
    if (k.startsWith('g:')) {
      for (const g of NAV) if (groupKey(g) === k) { if (g.href) hidden.add(g.href); g.items?.forEach((i) => hidden.add(i.href)); }
    } else hidden.add(k);
  }
  for (const k of hidden) {
    if (k.includes('?') || k === '/') continue; // a query-only variant of a page (such as Bulk import) hides the menu entry, not the whole page
    if (path === k || path.startsWith(`${k}/`)) return true;
  }
  return false;
}

export function navFor(role: Role) {
  return NAV.filter((g) => g.roles.includes(role)).map((g) => ({ ...g, items: g.items?.filter((i) => !i.roles || i.roles.includes(role)) }));
}
