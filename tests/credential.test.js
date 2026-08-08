const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { CredentialStore } = require('../src/main/core/credential-store');
const { LlmApi } = require('../src/main/core/llm-api');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avs-cred-'));
  const store = new CredentialStore({ dataDir: dir });

  // 非 Electron 环境退化为 base64 标记存储，接口行为一致
  store.setApiKey('sk-test-1234567890abcd');
  assert.strictEqual(store.getApiKey(), 'sk-test-1234567890abcd');
  assert.strictEqual(store.maskedKey(), 'sk-t****abcd');

  store.setDefaultTextModel('doubao-x');
  assert.strictEqual(store.getDefaultTextModel(), 'doubao-x');

  // 落盘内容不含明文 key
  const raw = fs.readFileSync(path.join(dir, 'secure-config.json'), 'utf8');
  assert(!raw.includes('sk-test-1234567890abcd'), '密钥不得明文落盘');

  // Base URL 设置
  store.setBaseUrl('https://example.com/v1/');
  assert.strictEqual(store.getBaseUrl(), 'https://example.com/v1/');

  // LlmApi：缺 Key 时报 API_KEY_MISSING（必须先 await，避免与后续写 Key 竞争）
  const noKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avs-cred2-'));
  const emptyStore = new CredentialStore({ dataDir: noKeyDir });
  const apiNoKey = new LlmApi({ credentials: emptyStore });
  assert.strictEqual(apiNoKey.isConfigured(), false);
  await assert.rejects(apiNoKey.chat({ prompt: 'hi' }), /API Key/);

  // 配置后走 fetch mock
  const mockFetch = async (url, opts) => {
    assert.strictEqual(opts.headers.Authorization, 'Bearer sk-test-1234567890abcd');
    assert(url.startsWith('https://example.com/v1'), '应使用设置的 Base URL');
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '润色后的提示词' } }], model: 'doubao-x' }),
    };
  };
  const api = new LlmApi({ credentials: store, fetchImpl: mockFetch });
  const r = await api.chat({ prompt: '猫', system: 'sys' });
  assert.strictEqual(r.text, '润色后的提示词');

  // ensureModel：未设默认模型时回退到端点 /models 第一个
  const store2 = new CredentialStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'avs-cred3-')) });
  store2.setApiKey('sk-test-1234567890abcd');
  const api2 = new LlmApi({
    credentials: store2,
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => url.endsWith('/models')
        ? { data: [{ id: 'kimi-k2' }, { id: 'kimi-k1' }] }
        : { choices: [{ message: { content: 'ok' } }] },
    }),
  });
  const r2 = await api2.chat({ prompt: 'hi' });
  assert.strictEqual(r2.text, 'ok');

  store.clearApiKey();
  assert.strictEqual(store.getApiKey(), null);

  console.log('credential.test.js 通过：加密存储 / 掩码 / Base URL / 模型回退 / LlmApi 直连正常');
})().catch((e) => { console.error(e); process.exit(1); });
