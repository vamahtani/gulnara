import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './config.ts';

export function prepareDatabase(sql, password) {
  const engine = sql('master', ['-Q', "SET NOCOUNT ON; SELECT CONVERT(int,SERVERPROPERTY('EngineEdition'));"]);
  if (engine.trim() !== '5') throw new Error('Expected Azure SQL Database EngineEdition 5.');
  sql('master', ['-Q', "IF NOT EXISTS(SELECT 1 FROM sys.databases WHERE name=N'appdb') CREATE DATABASE appdb COLLATE SQL_Latin1_General_CP1_CI_AS;"]);
  const collation = sql('appdb', ['-Q', "SET NOCOUNT ON; SELECT CONVERT(nvarchar(128),DATABASEPROPERTYEX(DB_NAME(),'Collation'));"]);
  if (collation !== 'SQL_Latin1_General_CP1_CI_AS') throw new Error('Existing database collation differs from the pinned baseline. Review a migration; do not reset data.');
  applyMigrations(sql);
  if (!/^Aa1![a-f0-9]{48}$/.test(password || '')) throw new Error('Invalid APP_SQL_PASSWORD; restore the original .env for this database.');
  sql('master', [], `IF NOT EXISTS(SELECT 1 FROM sys.sql_logins WHERE name=N'app_api') CREATE LOGIN app_api WITH PASSWORD='${password}';\nGO\n`);
  sql('appdb', ['-i', '/schema/permissions.sql']);
}

export function applyMigrations(sql, pathForMigration = file => `/schema/migrations/${file}`, maximumVersion = Infinity) {
  if (maximumVersion !== Infinity && (!Number.isInteger(maximumVersion) || maximumVersion < 1)) throw new Error('Invalid migration phase boundary.');
  const versionRows = sql('appdb', ['-Q', "SET NOCOUNT ON; IF OBJECT_ID('dbo.SchemaVersions') IS NOT NULL SELECT CONCAT(Version,':',Checksum) FROM dbo.SchemaVersions ORDER BY Version;"]);
  const versions = versionRows ? versionRows.split(/\r?\n/).map(row => {
    const match = row.match(/^(\d+):([a-f0-9]{64})$/);
    if (!match) throw new Error('Invalid migration history. Inspect the database without resetting it.');
    return { Version: Number(match[1]), Checksum: match[2] };
  }) : [];
  const files = readdirSync(resolve(root, 'packages/data/migrations')).filter(file => file.endsWith('.sql')).sort();
  if (files.some((file, index) => !/^\d{3}-.+\.sql$/.test(file) || Number(file.slice(0, 3)) !== index + 1)) {
    throw new Error('Migrations must have unique, consecutive NNN-name.sql versions starting at 001.');
  }
  if (versions.some(version => !files.some(file => Number(file.slice(0, 3)) === version.Version))) throw new Error('Database contains unknown migrations.');
  if (versions.some((version, index) => version.Version !== index + 1)) throw new Error('Database migration history is not consecutive. Inspect without resetting data.');
  for (const file of files) {
    const version = Number(file.slice(0, 3));
    const checksum = createHash('sha256').update(readFileSync(resolve(root, 'packages/data/migrations', file), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
    const applied = versions.find(item => item.Version === version);
    if (applied && applied.Checksum !== checksum) throw new Error(`Applied migration ${file} changed. Add a forward migration.`);
    if (!applied && version <= maximumVersion) {
      sql('appdb', ['-v', `MigrationHash=${checksum}`, '-i', pathForMigration(file)]);
      const recorded = sql('appdb', ['-Q', `SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.SchemaVersions WHERE Version=${version} AND Checksum='${checksum}';`]);
      if (recorded !== '1') throw new Error(`Migration ${file} did not commit its version/checksum.`);
    }
  }
}
