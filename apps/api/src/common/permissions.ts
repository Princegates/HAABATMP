export const ROLES = [
  'super_admin',
  'training_admin',
  'instructor',
  'trainee',
  'org_admin',
  'finance_officer',
  'auditor',
] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'users:read' | 'users:write'
  | 'orgs:read' | 'orgs:write'
  | 'courses:read' | 'courses:write'
  | 'programmes:read' | 'programmes:write'
  | 'enrollments:read' | 'enrollments:write'
  | 'attendance:read' | 'attendance:write'
  | 'questions:write' | 'assessments:read' | 'assessments:write' | 'attempts:mark'
  | 'results:read' | 'results:finalise' | 'results:override'
  | 'certificates:read' | 'certificates:issue' | 'certificates:revoke'
  | 'invoices:read' | 'invoices:write' | 'payments:write'
  | 'documents:read' | 'documents:write' | 'documents:delete'
  | 'compliance:read' | 'compliance:write'
  | 'reports:read' | 'audit:read'
  | 'settings:read' | 'settings:write'
  | 'integrations:manage';

const ALL: Permission[] = [
  'users:read', 'users:write', 'orgs:read', 'orgs:write', 'courses:read', 'courses:write',
  'programmes:read', 'programmes:write', 'enrollments:read', 'enrollments:write',
  'attendance:read', 'attendance:write', 'questions:write', 'assessments:read', 'assessments:write',
  'attempts:mark', 'results:read', 'results:finalise', 'results:override',
  'certificates:read', 'certificates:issue', 'certificates:revoke',
  'invoices:read', 'invoices:write', 'payments:write',
  'documents:read', 'documents:write', 'documents:delete',
  'compliance:read', 'compliance:write', 'reports:read', 'audit:read',
  'settings:read', 'settings:write', 'integrations:manage',
];

// Segregation of duties is deliberate:
//  - finance cannot touch training records, and training staff cannot record payments
//  - auditors are read-only everywhere
//  - instructors can mark but not finalise results
//  - only super_admin changes settings or reads the full audit trail alongside auditors
export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set(ALL),
  training_admin: new Set<Permission>([
    'users:read', 'users:write', 'orgs:read', 'orgs:write', 'courses:read', 'courses:write',
    'programmes:read', 'programmes:write', 'enrollments:read', 'enrollments:write',
    'attendance:read', 'attendance:write', 'questions:write', 'assessments:read', 'assessments:write',
    'attempts:mark', 'results:read', 'results:finalise', 'results:override',
    'certificates:read', 'certificates:issue', 'certificates:revoke',
    'invoices:read', 'documents:read', 'documents:write', 'documents:delete',
    'compliance:read', 'compliance:write', 'reports:read', 'settings:read',
  ]),
  instructor: new Set<Permission>([
    'courses:read', 'programmes:read', 'enrollments:read', 'attendance:read', 'attendance:write',
    'questions:write', 'assessments:read', 'assessments:write', 'attempts:mark', 'results:read',
    'documents:read', 'documents:write', 'reports:read',
  ]),
  trainee: new Set<Permission>([
    'courses:read', 'programmes:read', 'enrollments:read', 'assessments:read', 'results:read',
    'certificates:read', 'invoices:read', 'documents:read', 'documents:write',
  ]),
  org_admin: new Set<Permission>([
    'users:read', 'users:write', 'orgs:read', 'courses:read', 'programmes:read',
    'enrollments:read', 'enrollments:write', 'results:read', 'certificates:read', 'invoices:read',
    'documents:read', 'documents:write', 'compliance:read', 'reports:read',
  ]),
  finance_officer: new Set<Permission>([
    'orgs:read', 'courses:read', 'programmes:read', 'enrollments:read',
    'invoices:read', 'invoices:write', 'payments:write', 'documents:read', 'documents:write', 'reports:read',
  ]),
  auditor: new Set<Permission>([
    'users:read', 'orgs:read', 'courses:read', 'programmes:read', 'enrollments:read',
    'attendance:read', 'assessments:read', 'results:read', 'certificates:read', 'invoices:read',
    'documents:read', 'compliance:read', 'reports:read', 'audit:read', 'settings:read',
  ]),
};

// Which roles a given role may create. Privileged roles are only created by a super admin.
export const CAN_CREATE_ROLES: Record<Role, readonly Role[]> = {
  super_admin: ROLES,
  training_admin: ['trainee', 'instructor', 'org_admin'],
  org_admin: ['trainee'],
  instructor: [],
  trainee: [],
  finance_officer: [],
  auditor: [],
};

export const STAFF_ROLES: readonly Role[] = ['super_admin', 'training_admin'];
