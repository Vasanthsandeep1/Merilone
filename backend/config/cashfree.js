require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fetch, ProxyAgent, FormData } = require('undici');

// Cashfree Verification Suite — sandbox vs production is decided by which
// key type is configured (test keys start with cfsk_ma_test_), same
// pattern as switching Razorpay test/live rather than a separate env flag.
const IS_TEST_KEY = (process.env.CASHFREE_SECRET_KEY || '').includes('_test_');
const BASE_URL = IS_TEST_KEY ? 'https://sandbox.cashfree.com/verification' : 'https://api.cashfree.com/verification';

// Cashfree requires IP whitelisting even in sandbox, and this box's own IP
// isn't static — so these calls (only these; nothing else in the app)
// route through a fixed-IP forward proxy instead. See .env's
// CASHFREE_PROXY_URL comment for where that proxy lives.
const proxyAgent = process.env.CASHFREE_PROXY_URL ? new ProxyAgent(process.env.CASHFREE_PROXY_URL) : null;

// This account's 2FA method is "Public Key", not plain IP whitelist — every
// request additionally needs an X-Cf-Signature header: RSA/OAEP-SHA1
// encrypt "clientId.unixTimestamp" with the public key Cashfree generated
// for this account (downloaded once from their dashboard), base64-encode
// the result. Cashfree holds the matching private key on their end — we
// never generate or see it. Valid 5 minutes, so it's cheap to recompute
// per request rather than cache.
// Optional: without the key file (local setups) the server still starts; verification calls then fail with a clear error.
const PEM_FILE = path.join(__dirname, 'cashfree_public_key.pem');
const publicKeyPem = fs.existsSync(PEM_FILE) ? fs.readFileSync(PEM_FILE, 'utf8') : null;
const buildSignature = () => {
  const payload = `${process.env.CASHFREE_APP_ID}.${Math.floor(Date.now() / 1000)}`;
  const encrypted = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
    Buffer.from(payload)
  );
  return encrypted.toString('base64');
};

// Thin fetch wrapper — every Verification Suite call needs the same auth
// headers, so callers just pass a path/method/body and get parsed JSON
// (or throw with Cashfree's own error payload attached).
const cashfreeRequest = async (method, path, { query, body } = {}) => {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });

  const res = await fetch(url, {
    method,
    headers: {
      'x-client-id': process.env.CASHFREE_APP_ID,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY,
      'x-cf-signature': buildSignature(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Cashfree request failed (${res.status})`);
    err.cashfree = data;
    err.status = res.status;
    throw err;
  }
  return data;
};

// Smart OCR (POST /bharat-ocr) is the one Verification Suite call that
// takes a file, not JSON — multipart/form-data with the image/PDF plus
// verification_id/document_type/do_verification fields. Everything else
// (proxy, signature, error handling) matches cashfreeRequest above.
const cashfreeUploadRequest = async (urlPath, { verificationId, documentType, doVerification, fileBuffer, fileName, mimeType }) => {
  const form = new FormData();
  form.set('verification_id', verificationId);
  form.set('document_type', documentType);
  if (doVerification !== undefined) form.set('do_verification', String(doVerification));
  form.set('file', new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' }), fileName || 'document');

  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method: 'POST',
    headers: {
      'x-client-id': process.env.CASHFREE_APP_ID,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY,
      'x-cf-signature': buildSignature(),
      'x-api-version': '2024-12-01',
    },
    body: form,
    ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Cashfree request failed (${res.status})`);
    err.cashfree = data;
    err.status = res.status;
    throw err;
  }
  return data;
};

module.exports = { cashfreeRequest, cashfreeUploadRequest };
