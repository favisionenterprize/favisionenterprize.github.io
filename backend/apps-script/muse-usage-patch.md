# Muse usage patch (Code.gs `museAsk_`)

This change makes the Muse AI backend tell the phone app what each AI call used:
the model, the provider, the tokens (in / out / thinking / total) and how long the
call took. Only the `museAsk_` function changes. Nothing else in Code.gs is touched.

Muse works with or without this patch. Until it is deployed, Muse simply shows no
usage line under replies (calls and errors are still counted in Muse's Usage view).

## How to apply (Apps Script editor)

1. Open the Apps Script project (script.google.com → the F.A Vision backend) → **Code.gs**.
2. Press **Ctrl+F** and search for `function museAsk_(data) {`.
3. Select from that line down to its closing `}` (the line just before the
   `// ===... SEEK (admin → Seek)` comment) and delete it.
4. Paste the **new function** below in its place.
5. **Save** (Ctrl+S).
6. **Deploy → Manage deployments** → the active web-app deployment → **✏️ Edit**
   → Version: **New version** → **Deploy**. Same deployment, same URL: nothing else changes.
7. Open Muse on the phone and ask something. A grey line such as
   `gemini-flash-lite-latest · in 412 · out 230 · total 642 tokens · 1.2 s` shows under the reply.

## New function

```javascript
function museAsk_(data) {
  if (!sessionValid_(data.session)) return json_({ ok: false, error: 'signed_out' });
  const cache = CacheService.getScriptCache();
  const slot = 'muse_' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHH');
  const n = Number(cache.get(slot) || 0);
  if (n >= 120) return json_({ ok: false, error: 'busy' });
  cache.put(slot, String(n + 1), 3600);
  const props = authProps_();
  const mode = MUSE_MODES[data.mode] ? data.mode : 'assistant';
  const system = MUSE_MODES[mode] + '\n\nBusiness facts: ' + BUSINESS.name + ', ' + BUSINESS.address + '. Phones ' + BUSINESS.phones +
    '. WhatsApp 057 264 6176. Website ' + BUSINESS.website + '.' + (data.context ? '\n\nContext from the app:\n' + String(data.context).slice(0, 6000) : '');
  const msgs = (Array.isArray(data.messages) ? data.messages : []).slice(-16)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: String(m.text || '').slice(0, 8000) }))
    .filter((m) => m.text);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json_({ ok: false, error: 'empty' });
  try {
    const gem = props.getProperty('GEMINI_API_KEY');
    const claude = props.getProperty('ANTHROPIC_API_KEY');
    let text = '', usedModel = '', provider = '', usage = null;
    const t0 = Date.now();
    if (gem) {
      const model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
      const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': gem },
        payload: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
          generationConfig: { maxOutputTokens: 4096, temperature: mode === 'code' ? 0.3 : 0.8 },
        }),
      });
      const out = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() >= 300) return json_({ ok: false, error: 'ai: ' + ((out.error && out.error.message) || res.getResponseCode()) });
      text = ((((out.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
      const u = out.usageMetadata || {};
      provider = 'gemini'; usedModel = out.modelVersion || model;
      usage = { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, thinking: u.thoughtsTokenCount || 0, total: u.totalTokenCount || 0 };
    } else if (claude) {
      const model = props.getProperty('CLAUDE_MODEL') || 'claude-haiku-4-5-20251001';
      const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-api-key': claude, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({
          model, max_tokens: 4096, system,
          messages: msgs.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      const out = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() >= 300) return json_({ ok: false, error: 'ai: ' + ((out.error && out.error.message) || res.getResponseCode()) });
      text = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      const u = out.usage || {};
      provider = 'claude'; usedModel = out.model || model;
      usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, thinking: 0, total: (u.input_tokens || 0) + (u.output_tokens || 0) };
    } else {
      return json_({ ok: false, error: 'no_ai_key' });
    }
    return json_({ ok: true, text: text || '(no answer)', mode, model: usedModel, provider, usage, ms: Date.now() - t0 });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}
```

## What it returns

`{ ok: true, text, mode, model, provider: "gemini" | "claude", usage: { input, output, thinking, total }, ms }`

- Gemini: `usageMetadata.promptTokenCount` → input, `candidatesTokenCount` → output,
  `thoughtsTokenCount` → thinking, `totalTokenCount` → total; model = `modelVersion`
  (else the `GEMINI_MODEL` Script property).
- Claude: `usage.input_tokens` → input, `usage.output_tokens` → output, total = in + out,
  thinking = 0; model = the response's `model` (else `CLAUDE_MODEL`).
- `ms` = milliseconds the AI call took (just before the fetch until the reply is read).

## Revert

Paste the old function back the same way (steps 2–6):

```javascript
function museAsk_(data) {
  if (!sessionValid_(data.session)) return json_({ ok: false, error: 'signed_out' });
  const cache = CacheService.getScriptCache();
  const slot = 'muse_' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHH');
  const n = Number(cache.get(slot) || 0);
  if (n >= 120) return json_({ ok: false, error: 'busy' });
  cache.put(slot, String(n + 1), 3600);
  const props = authProps_();
  const mode = MUSE_MODES[data.mode] ? data.mode : 'assistant';
  const system = MUSE_MODES[mode] + '\n\nBusiness facts: ' + BUSINESS.name + ', ' + BUSINESS.address + '. Phones ' + BUSINESS.phones +
    '. WhatsApp 057 264 6176. Website ' + BUSINESS.website + '.' + (data.context ? '\n\nContext from the app:\n' + String(data.context).slice(0, 6000) : '');
  const msgs = (Array.isArray(data.messages) ? data.messages : []).slice(-16)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: String(m.text || '').slice(0, 8000) }))
    .filter((m) => m.text);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json_({ ok: false, error: 'empty' });
  try {
    const gem = props.getProperty('GEMINI_API_KEY');
    const claude = props.getProperty('ANTHROPIC_API_KEY');
    let text = '';
    if (gem) {
      const model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
      const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': gem },
        payload: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
          generationConfig: { maxOutputTokens: 4096, temperature: mode === 'code' ? 0.3 : 0.8 },
        }),
      });
      const out = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() >= 300) return json_({ ok: false, error: 'ai: ' + ((out.error && out.error.message) || res.getResponseCode()) });
      text = ((((out.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
    } else if (claude) {
      const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-api-key': claude, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({
          model: props.getProperty('CLAUDE_MODEL') || 'claude-haiku-4-5-20251001', max_tokens: 4096, system,
          messages: msgs.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      const out = JSON.parse(res.getContentText() || '{}');
      if (res.getResponseCode() >= 300) return json_({ ok: false, error: 'ai: ' + ((out.error && out.error.message) || res.getResponseCode()) });
      text = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    } else {
      return json_({ ok: false, error: 'no_ai_key' });
    }
    return json_({ ok: true, text: text || '(no answer)', mode });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}
```
