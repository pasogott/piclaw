import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const web = join(import.meta.dir, '../../web');
const source = (path: string) => readFileSync(join(web, path), 'utf8');

test('General no longer owns authentication, API tokens or recovery saves', () => {
  for (const path of ['src/components/settings/general.ts', 'static/visual/frontend/src/panels/settings/GeneralSection.tsx']) {
    const text = source(path);
    for (const field of ['automaticRecovery', 'instanceTotp', 'widgetToken', 'totpSetup']) expect(text).not.toContain(field);
    expect(text).toContain('composeUploadLimitMb');
    expect(text).toContain('workspaceUploadLimitMb');
  }
});

test('Authentication retains TOTP display and passkeys without unsupported TOTP mutation', () => {
  for (const path of ['src/components/settings/authentication.ts', 'static/visual/frontend/src/panels/settings/AuthenticationSection.tsx']) {
    const text = source(path);
    expect(text).toContain('instanceTotp');
    expect(text).toContain('PasskeySettings');
    expect(text).not.toContain('enableTotp');
    expect(text).not.toContain('disableTotp');
    expect(text).not.toContain('widgetToken');
  }
});

test('new API access pane uses the existing token rotation endpoint in both skins', () => {
  for (const path of ['src/components/settings/api-access.ts', 'static/visual/frontend/src/panels/settings/ApiAccessSection.tsx']) {
    const text = source(path);
    expect(text).toContain('/agent/settings/widget-token/regenerate');
    expect(text).toContain('GET /api/state');
    expect(text).toContain('GET /api/state/events');
    expect(text).not.toContain('instanceTotp');
  }
});

test('Authentication and Sessions names and IDs remain unchanged and API access is registered', () => {
  const classic = source('src/components/settings-dialog.ts');
  expect(classic).toContain("id: 'authentication', label: 'Authentication'");
  expect(classic).toContain("id: 'sessions', label: 'Sessions'");
  expect(classic).toContain("case 'api-access'");
  const visual = 'static/visual/frontend/src/panels/';
  expect(source(visual + 'SettingsPanel.tsx')).toContain('import "./settings/ApiAccessSection"');
  expect(source(visual + 'SettingsPanel.tsx')).toContain('key={activePane.id}');
  for (const name of ['Authentication', 'Sessions']) {
    expect(source(visual + `settings/${name}Section.tsx`)).toContain(`label: "${name}"`);
  }
});
