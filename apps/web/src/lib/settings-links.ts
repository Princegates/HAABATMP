/** Where each entry of the System setting menu lives. */
export const settingsHref = (key: string) =>
  key === 'users' ? '/settings/users' : key === 'roles' ? '/settings/roles' : key === 'integrations' ? '/settings/integrations' : key === 'certificate_templates' ? '/settings/certificate-templates' : `/settings/${key}`;
