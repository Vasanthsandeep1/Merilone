'use strict';

// Shared local-Ollama wrapper — used by both productMatcher.js (Suggested
// Products matching) and docPrepController.js (annexure discovery/drafting).
// Points at whatever model the user has pulled locally (see
// productMatcher.js's history: the original's cloud-hosted 'gemma4:31b-cloud'
// isn't realistic here, so this defaults to a small local model instead).

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL_NAME = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';

function parseJsonResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try { return JSON.parse(raw.trim()); } catch (_) {}
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch (_) {} }
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch (_) {} }
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch (_) {} }
  return null;
}

async function ollamaChat(systemPrompt, userContent, { json = true, numPredict = 8192, temperature = 0.1, model = MODEL_NAME, history = [], images = [] } = {}) {
  const userMsg = { role: 'user', content: userContent };
  if (images.length) userMsg.images = images; // base64 strings, no data: prefix — only honoured by a vision-capable model
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      userMsg,
    ],
    stream: false,
    keep_alive: -1,
    options: { temperature, num_predict: numPredict },
  };
  if (json) body.format = 'json';

  // Bumped from 180s/3 attempts: under real-world memory pressure on a
  // small local dev machine (this runs against a tiny CPU-bound model —
  // see productMatcher.js's narrowFilesByText comment for the file-size
  // half of this same problem), a legitimate, otherwise-fine request can
  // take longer than 180s purely from OS-level swapping, and 3 retries at
  // that length just meant three consecutive near-3-minute waits before
  // giving up. Fewer, longer attempts fail (or succeed) in a similar total
  // worst-case time but don't kill a request that was still making progress.
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });
      if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      return data.message?.content || '';
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function isOllamaAvailable() {
  try {
    const resp = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return false;
    const data = await resp.json();
    return Array.isArray(data.models) && data.models.some((m) => m.name === MODEL_NAME || m.model === MODEL_NAME);
  } catch (_) {
    return false;
  }
}

module.exports = { ollamaChat, parseJsonResponse, isOllamaAvailable, MODEL_NAME };
