import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { composeArguments, localApi, localConfiguration, readEnvironment, root } from './config.ts';
import { listenForStop, requestLocalStop } from './runtime-control.mjs';
import { prepareDatabase } from './sql-database.mjs';

process.chdir(root);
const command = process.argv[2];
const api = localApi();
const secret = () => `Aa1!${randomBytes(24).toString('hex')}`;
let env;
function compose(args, options = {}) {
  const result = spawnSync('docker', [...composeArguments(env, api), ...args], {
    cwd: root, env, encoding: 'utf8', ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    let detail = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
    for (const name of ['MSSQL_SA_PASSWORD', 'APP_SQL_PASSWORD', 'SQL_CONNECTION_STRING']) {
      if (env[name]) detail = detail.replaceAll(env[name], '[redacted]');
    }
    throw new Error(`docker compose ${args[0]} failed. ${detail || "Inspect this project's container logs (do not publish secrets)."}`);
  }
  return options.stdio === 'inherit' ? '' : result.stdout.trim();
}
function sql(database, args, input) {
  return compose(['exec', '-T', 'sql', '/opt/mssql-tools18/bin/sqlcmd',
    '-S', 'localhost', '-U', 'sa', '-C', '-b', '-l', '5', '-t', '60', '-d', database, '-h', '-1', '-W', ...args], { input });
}
async function healthy(url, stopRequested) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (stopRequested()) throw new Error('Startup interrupted by a stop request.');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch (error) {
      if (attempt === 39) throw new Error(`Service readiness failed at ${url}: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error(`Service never became healthy at ${url}. Inspect this project's logs.`);
}

if (command === 'init') {
  if (!existsSync('.env')) throw new Error('Copy .env.example to .env and configure identity first.');
  const current = readFileSync('.env', 'utf8');
  if (current.includes('COMPOSE_PROJECT_NAME=')) {
    if (!['MSSQL_SA_PASSWORD', 'APP_SQL_PASSWORD', ...(api === 'dab' ? ['SQL_CONNECTION_STRING'] : [])]
      .every(name => current.includes(`${name}=`))) {
      throw new Error('Incomplete existing local secrets. Restore .env for this persisted database; do not generate replacements.');
    }
    console.log('Existing project identity and secrets preserved.');
  } else {
    const name = `sqlapps-${randomBytes(6).toString('hex')}`;
    writeFileSync('.env', `${current}\nCOMPOSE_PROJECT_NAME=${name}\nMSSQL_SA_PASSWORD=${secret()}\nAPP_SQL_PASSWORD=${secret()}\n`, { mode: 0o600 });
    if (api === 'dab') {
      const settings = readEnvironment();
      writeFileSync('.env', `SQL_CONNECTION_STRING="Server=sql,1433;Database=appdb;User ID=app_api;Password=${settings.APP_SQL_PASSWORD};Encrypt=True;TrustServerCertificate=True;"\n`, { flag: 'a', mode: 0o600 });
    }
    console.log('Generated project-owned local credentials. No containers started.');
  }
} else if (command === 'sql-start' || command === 'sql-stop') {
  env = { ...readEnvironment(), COMPOSE_FILE: 'compose.sql.yml', SQL_PORT: '' };
  if (!/^sqlapps-[a-f0-9]{12}$/.test(env.COMPOSE_PROJECT_NAME || '')) throw new Error('Run local:init; an isolated Compose project is required.');
  if (command === 'sql-stop') {
    compose(['stop', 'sql'], { stdio: 'inherit' });
  } else {
    if (env.ACCEPT_EULA !== 'Y') throw new Error('Review the SQL terms and explicitly set ACCEPT_EULA=Y before startup.');
    if (!env.MSSQL_SA_PASSWORD || !/^Aa1![a-f0-9]{48}$/.test(env.APP_SQL_PASSWORD || '')) {
      throw new Error('Run local:init for a fresh app or restore the original .env for an existing database.');
    }
    compose(['config', '--quiet']);
    compose(['up', '-d', '--wait', '--wait-timeout', '180', 'sql'], { stdio: 'inherit' });
    prepareDatabase(sql, env.APP_SQL_PASSWORD);
    console.log('Isolated Azure SQL appdb ready with migrations and restricted runtime grants. No API/web started; identity acceptance remains unverified. Stop with local:sql:stop; the volume is retained.');
  }
} else if (command === 'start' || command === 'stop') {
  env = readEnvironment();
  if (!/^sqlapps-[a-f0-9]{12}$/.test(env.COMPOSE_PROJECT_NAME || '')) throw new Error('Run local:init; an isolated Compose project is required.');
  if (command === 'stop') {
    if (!await requestLocalStop(env)) compose(['stop'], { stdio: 'inherit' });
  } else {
    const config = localConfiguration(env, api);
    for (const file of ['packages/frontend/dist/index.html', 'dist/scripts/config.js',
      api === 'functions' ? 'packages/functions/dist/index.js' : 'dist/packages/server/server.js']) {
      if (!existsSync(file)) throw new Error(`Missing ${file}. Run npm run build before Start or acceptance.`);
    }
    const functions = api === 'functions' ? await import('./functions-local.mjs') : undefined;
    if (functions) {
      functions.checkFunctionsTools(functions.functionsEnvironment(env));
    }
    compose(['config', '--quiet']);
    await import('./check-config.mjs');
    let web;
    let runtime;
    let closeControl;
    const abort = new AbortController();
    let stopped;
    const stopRequest = new Promise(resolve => { stopped = resolve; });
    let stopping = false;
    let stopRequested = false;
    const requestStop = () => {
      stopRequested = true;
      abort.abort();
      stopped();
      if (web?.connected) web.send('stop');
    };
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      const failures = [];
      try {
        if (runtime) await runtime.stop();
        if (web && web.exitCode === null && web.signalCode === null) {
          const exited = once(web, 'exit');
          if (!stopRequested && web.connected) web.send('stop');
          await exited;
        }
      } catch (error) { failures.push(error); }
      try { compose(['stop'], { stdio: 'inherit' }); }
      catch (error) { failures.push(error); }
      await closeControl?.(failures.length === 0);
      if (failures.length) throw new AggregateError(failures, 'Local shutdown failed; inspect the owned services.');
    };
    process.on('SIGINT', requestStop);
    process.on('SIGTERM', requestStop);
    process.on('message', message => { if (message === 'stop') requestStop(); });
    closeControl = await listenForStop(env, requestStop);
    try {
      if (stopRequested) throw new Error('Startup interrupted by a stop request.');
      compose(['up', '-d', '--wait', '--wait-timeout', '180', 'sql'], { stdio: 'inherit' });
      prepareDatabase(sql, env.APP_SQL_PASSWORD);
      if (functions) {
        runtime = await functions.startFunctions(env, {
          signal: abort.signal, onRuntime: value => { runtime = value; },
        });
        console.log('SQL, Functions and Static Web Apps ready. Stop preserves the database volume.');
        process.send?.('ready');
        const exit = await Promise.race([runtime.exited, stopRequest]);
        if (!stopRequested) throw new Error(`${exit.tool} exited unexpectedly.`);
      } else {
        compose(['up', '-d', 'dab'], { stdio: 'inherit' });
        await healthy(`${config.dab}/`, () => stopRequested);
        if (stopRequested) throw new Error('Startup interrupted by a stop request.');
        web = fork(resolve(root, 'dist/packages/server/server.js'), [], { env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
        await Promise.race([
          once(web, 'message'),
          once(web, 'exit').then(() => { throw new Error('Packaged web server exited before readiness.'); }),
        ]);
        await healthy(`${config.publicConfig.redirectUri}health`, () => stopRequested);
        console.log('SQL, DAB, and packaged web app ready. Stop preserves the database volume.');
        process.send?.('ready');
        await once(web, 'exit');
        if (!stopRequested) throw new Error('Web process exited unexpectedly.');
      }
    } catch (error) {
      if (!stopRequested) throw error;
      console.log('Local stop requested.');
    } finally {
      await shutdown();
      process.disconnect?.();
    }
  }
} else {
  throw new Error('Usage: node scripts/local.mjs init|start|stop|sql-start|sql-stop');
}
