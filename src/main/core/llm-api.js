// 通用 OpenAI 兼容 LLM 直连客户端：承担文本类调用（提示词润色等）。
// 不绑定具体厂商：Base URL + API Key + GET /models 拉取模型列表，
// 火山方舟 / DeepSeek / Kimi / GLM / Qwen / MiniMax / MiMo / 第三方中转均可接入。
// API Key 从 CredentialStore 读取，只存在于主进程内存中。
const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

class LlmApi {
  constructor({ credentials, baseUrl, fetchImpl } = {}) {
    this.credentials = credentials;
    this.fixedBaseUrl = baseUrl || null;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  // 优先级：显式注入 > 用户设置 > 默认。每次请求动态读取，设置页改完即生效。
  get baseUrl() {
    return this.fixedBaseUrl
      || (this.credentials.getBaseUrl && this.credentials.getBaseUrl())
      || DEFAULT_BASE_URL;
  }

  isConfigured() {
    return !!(this.credentials && this.credentials.getApiKey());
  }

  async _request(pathname, { method = 'GET', body } = {}, { timeoutMs = 60000 } = {}) {
    const key = this.credentials.getApiKey();
    if (!key) {
      const err = new Error('未配置 API Key，请先到设置页填写');
      err.code = 'API_KEY_MISSING';
      throw err;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await this.fetch(`${this.baseUrl}${pathname}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = (data.error && data.error.message) || `HTTP ${resp.status}`;
        const err = new Error(msg);
        err.status = resp.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async chat({ prompt, system, model } = {}) {
    const used = model || await this.ensureModel();
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    const data = await this._request('/chat/completions', {
      method: 'POST',
      body: { model: used, messages },
    }, { timeoutMs: 120000 });
    const text = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    return { text, model: data.model || used };
  }

  // 确定要用的模型：用户默认 > 端点模型列表第一个
  async ensureModel() {
    const configured = this.credentials.getDefaultTextModel();
    if (configured) return configured;
    const models = await this.listModels();
    if (!models.length) throw new Error('未选择模型，且端点未返回可用模型列表');
    return models[0];
  }

  // 用一次最小调用验证连通性，返回耗时与模型名
  async testConnection(model) {
    const started = Date.now();
    const used = model || await this.ensureModel();
    await this._request('/chat/completions', {
      method: 'POST',
      body: {
        model: used,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      },
    });
    return { ok: true, model: used, baseUrl: this.baseUrl, latencyMs: Date.now() - started };
  }

  async listModels() {
    const data = await this._request('/models');
    return (data.data || []).map((m) => m.id).filter(Boolean);
  }
}

module.exports = { LlmApi, DEFAULT_BASE_URL };
