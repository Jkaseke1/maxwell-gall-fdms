const https = require('node:https');
const http = require('node:http');

let nodemailer;
try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }

function postWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }, response => {
      response.resume();
      response.on('end', () => response.statusCode >= 200 && response.statusCode < 300
        ? resolve() : reject(new Error(`Alert webhook returned HTTP ${response.statusCode}`)));
    });
    request.on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('Alert webhook timed out')));
    request.end(JSON.stringify(payload));
  });
}

/**
 * Sends operational failures to the configured mailbox without ever putting
 * credentials in source or browser code. Alerts are rate-limited by message so
 * a temporary ZIMRA outage does not flood the mailbox.
 */
class AlertNotifier {
  constructor({ logger = () => {} } = {}) {
    this.logger = logger;
    this.lastSent = new Map();
    this.cooldownMs = Number(process.env.FDMS_ALERT_COOLDOWN_MS || 15 * 60 * 1000);
  }

  configured() {
    return Boolean(process.env.FDMS_ALERT_TO && (
      (nodemailer && process.env.FDMS_SMTP_HOST && process.env.FDMS_SMTP_USER && process.env.FDMS_SMTP_PASS) ||
      process.env.FDMS_ALERT_WEBHOOK_URL
    ));
  }

  async error({ source, message, context = {} }) {
    const subject = `[Maxwell Glass FDMS] ${source}`;
    const key = `${source}:${message}`;
    const now = Date.now();
    if (now - (this.lastSent.get(key) || 0) < this.cooldownMs) return { skipped: 'rate_limited' };
    if (!this.configured()) {
      this.logger('alert.not_configured', { source });
      return { skipped: 'not_configured' };
    }
    this.lastSent.set(key, now);
    const payload = {
      company: 'MAXWELL GLASS', deviceId: 38293, serial: 'TEST-2000945150-B670',
      source, message, context, occurredAt: new Date().toISOString()
    };
    if (process.env.FDMS_ALERT_WEBHOOK_URL) await postWebhook(process.env.FDMS_ALERT_WEBHOOK_URL, payload);
    if (nodemailer && process.env.FDMS_SMTP_HOST && process.env.FDMS_SMTP_USER && process.env.FDMS_SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.FDMS_SMTP_HOST,
        port: Number(process.env.FDMS_SMTP_PORT || 587),
        secure: String(process.env.FDMS_SMTP_SECURE).toLowerCase() === 'true',
        auth: { user: process.env.FDMS_SMTP_USER, pass: process.env.FDMS_SMTP_PASS }
      });
      await transporter.sendMail({
        from: process.env.FDMS_ALERT_FROM || process.env.FDMS_SMTP_USER,
        to: process.env.FDMS_ALERT_TO,
        subject,
        text: JSON.stringify(payload, null, 2)
      });
    }
    this.logger('alert.sent', { source, to: process.env.FDMS_ALERT_TO });
    return { sent: true };
  }
}

module.exports = { AlertNotifier };
