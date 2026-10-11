const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// A lightweight, stateless math captcha — no external service (reCAPTCHA
// etc.) or session store needed. The challenge (a, b) and the ANSWER'S HASH
// (never the raw answer) are signed into a short-lived JWT the client hands
// back with their typed answer. JWTs are signed, not encrypted, so the raw
// answer must never go in the payload — anyone can base64-decode a JWT body
// without the secret and would see it in plaintext otherwise.
const hashAnswer = (answer) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(answer)).digest('hex');

const generateCaptcha = () => {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const captchaToken = jwt.sign({ h: hashAnswer(a + b) }, process.env.JWT_SECRET, { expiresIn: '10m' });
  return { captchaToken, question: `What is ${a} + ${b}?` };
};

const verifyCaptcha = (captchaToken, answer) => {
  try {
    const { h } = jwt.verify(captchaToken, process.env.JWT_SECRET);
    return h === hashAnswer(answer);
  } catch {
    return false; // expired or tampered token
  }
};

module.exports = { generateCaptcha, verifyCaptcha };
