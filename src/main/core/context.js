const { ArkcliBridge } = require('./arkcli-bridge');
const { LlmApi } = require('./llm-api');
const { CredentialStore } = require('./credential-store');
const { ModuleRegistry } = require('./module-registry');
const { TaskQueue } = require('./task-queue');
const { WorkflowEngine } = require('./workflow-engine');
const { AssetStore } = require('./asset-store');
const { ProjectStore } = require('./project-store');
const { EnvInstaller } = require('./env-installer');
const { Updater } = require('./updater');

// 组装主进程全部核心服务，是模块 handler 拿到的 ctx 的来源
function createContext({ modulesDir, dataDir }) {
  const arkcli = new ArkcliBridge();
  const credentials = new CredentialStore({ dataDir });
  const llmApi = new LlmApi({ credentials });
  const registry = new ModuleRegistry(modulesDir);
  const taskQueue = new TaskQueue({ arkcli });
  const assets = new AssetStore({ dataDir });
  const projects = new ProjectStore({ dataDir });
  const engine = new WorkflowEngine({ registry, arkcli, taskQueue, assets, projects, llmApi });
  const installer = new EnvInstaller({ dataDir, arkcli });
  const updater = new Updater({ dataDir, currentVersion: require('../../../package.json').version });

  registry.loadAll();

  return { arkcli, llmApi, credentials, registry, taskQueue, assets, projects, engine, installer, updater };
}

module.exports = { createContext };
