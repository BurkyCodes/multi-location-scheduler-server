import nodemailer from "nodemailer";

let transporter = null;

const readEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
};

const toBool = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
};

const getSmtpConfig = () => {
  const host = readEnv("SMTP_HOST", "MAIL_HOST") || "smtp.gmail.com";
  const port = Number(readEnv("SMTP_PORT", "MAIL_PORT") || 465);
  const secure = toBool(readEnv("SMTP_SECURE", "MAIL_SECURE"), port === 465);
  const user = readEnv("SMTP_USER", "SMTP_EMAIL", "MAIL_USER", "EMAIL_USER");
  const pass = readEnv("SMTP", "SMTP_PASS", "MAIL_PASS");
  const from = readEnv("SMTP_FROM", "MAIL_FROM", "EMAIL_FROM") || user;

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
  };
};

const getTransporter = () => {
  if (transporter) return transporter;
  const config = getSmtpConfig();
  if (!config.user || !config.pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  return transporter;
};

const buildHtml = ({ title, message, link }) => {
  const safeTitle = title || "Notification";
  const safeMessage = message || "";
  const cta = link
    ? `<p style="margin-top:16px"><a href="${link}" style="color:#d97706;text-decoration:none;font-weight:600">Open in ShiftSync</a></p>`
    : "";

  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
    <h2 style="margin:0 0 8px 0">${safeTitle}</h2>
    <p style="margin:0">${safeMessage}</p>
    ${cta}
  </div>`;
};

export const sendNotificationEmail = async ({
  to,
  title,
  message,
  link,
  data = {},
} = {}) => {
  const recipient = String(to || "").trim();
  if (!recipient) {
    return { status: "skipped", reason: "No recipient email" };
  }

  const config = getSmtpConfig();
  const activeTransporter = getTransporter();
  if (!activeTransporter || !config.from) {
    return {
      status: "skipped",
      reason: "SMTP not fully configured (require SMTP and SMTP_USER)",
    };
  }

  const info = await activeTransporter.sendMail({
    from: config.from,
    to: recipient,
    subject: title || "Notification",
    text: `${message || ""}${link ? `\n\n${link}` : ""}`.trim(),
    html: buildHtml({ title, message, link }),
    headers: data?.idempotency_key
      ? { "X-Idempotency-Key": String(data.idempotency_key) }
      : undefined,
  });

  return {
    status: "sent",
    message_id: info?.messageId || null,
    accepted: info?.accepted?.length || 0,
    rejected: info?.rejected?.length || 0,
  };
};
