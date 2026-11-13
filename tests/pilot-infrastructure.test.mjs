import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('free SQL has exhaustion pause, included storage and no paid fallback (static only)', () => {
  const source = read('infra/main.bicep');
  assert.match(source, /useFreeLimit:\s*true/);
  assert.match(source, /freeLimitExhaustionBehavior:\s*'AutoPause'/);
  assert.match(source, /maxSizeBytes:\s*34359738368/);
  assert.match(source, /requestedBackupStorageRedundancy:\s*'Local'/);
  assert.doesNotMatch(source, /autoPauseDelay:\s*60|BillOverUsage/);
});

test('SQL server and database stages are separate so exclusion can be verified first (static only)', () => {
  const source = read('infra/main.bicep');
  assert.match(source, /param serverStageAuthorized bool = true/);
  assert.match(source, /param databaseStageAuthorized bool = true/);
  assert.match(source, /resource sqlServer [^\n]+ = if \(serverStageAuthorized\)/);
  assert.match(source, /resource database [^\n]+ = if \(serverStageAuthorized && databaseStageAuthorized\)/);
  assert.match(source, /resource defenderOptOut [^\n]+ = if \(serverStageAuthorized && enableSqlDefenderOptOut\)/);
  assert.doesNotMatch(source, /Microsoft\.Security\/pricings/);
});

test('foundation identity metadata remains available before application deployment (static only)', () => {
  const source = read('infra/main.bicep');
  assert.match(source, /output dabPrincipalObjectId string = runtimeIdentity\.properties\.principalId/);
  assert.match(source, /output dabClientId string = runtimeIdentity\.properties\.clientId/);
  assert.match(source, /output dabInternalUrl string = \([^)]*deployApplications[^)]*serverStageAuthorized[^)]*databaseStageAuthorized[^)]*\) \?/);
});

test('pilot default denies SQL creation and broad firewall access (static only)', () => {
  const wrapper = read('infra/pilot-subscription.bicep');
  assert.match(wrapper, /param serverStageAuthorized bool = false/);
  assert.match(wrapper, /param databaseStageAuthorized bool = false/);
  assert.match(wrapper, /param deployApplications bool = false/);
  assert.match(wrapper, /param enableSqlDefenderOptOut bool = false/);
  assert.match(wrapper, /param allowAzureServices bool = false/);
  assert.match(wrapper, /param runtimeIpAllowlist array = \[\]/);
});

test('private registry is Basic with optional narrowly scoped read-only access (static only)', () => {
  const source = read('infra/pilot.bicep');
  assert.match(source, /name:\s*'Basic'/);
  assert.match(source, /adminUserEnabled:\s*false/);
  assert.match(source, /param createPullToken bool = false/);
  const actions = [...source.matchAll(/'repositories\/([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(actions, [
    'gulnara/web/content/read',
    'gulnara/web/metadata/read',
    'gulnara/dab/content/read',
    'gulnara/dab/metadata/read',
  ]);
  assert.doesNotMatch(source, /roleAssignments|output \w*(?:password|secret)/i);
});

test('web and DAB retain distinct immutable-image inputs (static only)', () => {
  const source = read('infra/main.bicep');
  assert.match(source, /param webImage string/);
  assert.match(source, /param dabImage string/);
  assert.match(source, /image:\s*webImage/);
  assert.match(source, /image:\s*dabImage/);
  assert.doesNotMatch(source, /param containerImage/);
});

test('planning artifacts cannot enter the Docker image context', () => {
  assert.match(read('.dockerignore'), /^\.copilot-azure\s*$/m);
});
