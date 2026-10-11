const nodemailer = require('nodemailer');

// Shared SMTP transporter — reads the EMAIL_* vars already documented in
// backend/.env.example (Gmail SMTP + app password). Used by
// quotationController.emailQuotation to send a quotation PDF straight to a
// client's inbox; built lazily so a server without email configured doesn't
// crash on boot, just refuses send attempts via isMailConfigured().
let transporter = null;

function isMailConfigured() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: Number(process.env.EMAIL_PORT) === 465,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
}

async function sendMail({ to, cc, subject, text, html, attachments }) {
  const fromName = process.env.EMAIL_FROM_NAME || 'Meril One';
  return getTransporter().sendMail({
    from: `"${fromName}" <${process.env.EMAIL_USER}>`,
    to, cc, subject, text, html, attachments,
  });
}

module.exports = { sendMail, isMailConfigured };
