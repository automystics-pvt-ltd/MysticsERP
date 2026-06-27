import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

export class EmailNotConfiguredError extends Error {
  status = 503;
  constructor() {
    super(
      "Email is not configured on this server. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM, then try again.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

let cached: Transporter | null = null;

function readConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !portRaw || !user || !pass || !from) return null;
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port, user, pass, from, secure: port === 465 };
}

function getTransport(): Transporter {
  if (cached) return cached;
  const cfg = readConfig();
  if (!cfg) throw new EmailNotConfiguredError();
  cached = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  return cached;
}

export function isEmailConfigured(): boolean {
  return readConfig() !== null;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
  replyTo?: string;
}

export interface ShippingConfirmationInput {
  to: string;
  customerName: string;
  orderNumber: string;
  courierName?: string | null;
  awbNumber?: string | null;
  trackingUrl?: string | null;
  items: Array<{ itemName: string; sku: string; quantity: number }>;
}

export async function sendShippingConfirmationEmail(
  input: ShippingConfirmationInput,
): Promise<{ messageId: string } | null> {
  const cfg = readConfig();
  if (!cfg) return null; // SMTP not configured — skip silently

  const trackingLine = input.trackingUrl
    ? `Track your shipment: ${input.trackingUrl}`
    : input.awbNumber
      ? `Tracking / AWB: ${input.awbNumber}`
      : null;

  const itemsList = input.items
    .map((i) => `  • ${i.itemName} (${i.sku}) × ${i.quantity}`)
    .join("\n");

  const text = [
    `Hi ${input.customerName},`,
    ``,
    `Your order ${input.orderNumber} has been dispatched.`,
    ``,
    `Items shipped:`,
    itemsList,
    ``,
    input.courierName ? `Courier: ${input.courierName}` : null,
    input.awbNumber ? `AWB / Tracking No.: ${input.awbNumber}` : null,
    trackingLine,
    ``,
    `Thank you for your order!`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const courierHtml = input.courierName
    ? `<p style="margin:0 0 4px"><strong>Courier:</strong> ${input.courierName}</p>`
    : "";
  const awbHtml = input.awbNumber
    ? `<p style="margin:0 0 4px"><strong>AWB / Tracking No.:</strong> ${input.awbNumber}</p>`
    : "";
  const trackHtml = input.trackingUrl
    ? `<p style="margin:0 0 4px"><a href="${input.trackingUrl}" style="color:#4f46e5">Track your shipment →</a></p>`
    : "";

  const itemRows = input.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6">${i.itemName}<br/><small style="color:#6b7280">${i.sku}</small></td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right">×${i.quantity}</td></tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 8px">Your order has shipped 🚚</h2>
<p style="color:#6b7280;margin:0 0 20px">Order <strong>${input.orderNumber}</strong></p>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">${itemRows}</table>
${courierHtml}${awbHtml}${trackHtml}
<p style="margin:24px 0 0;color:#6b7280;font-size:13px">Thank you for your order, ${input.customerName}!</p>
</body></html>`;

  return sendEmail({
    to: input.to,
    subject: `Your order ${input.orderNumber} has been dispatched`,
    text,
    html,
  });
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<{ messageId: string }> {
  const cfg = readConfig();
  if (!cfg) throw new EmailNotConfiguredError();
  const transport = getTransport();
  try {
    const info = await transport.sendMail({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      attachments: input.attachments,
    });
    return { messageId: info.messageId ?? "" };
  } catch (err) {
    logger.error({ err }, "sendEmail failed");
    throw err;
  }
}
