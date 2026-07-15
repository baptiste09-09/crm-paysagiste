import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

function imapConfig() {
  return {
    host: process.env.MAIL_IMAP_HOST,
    port: Number(process.env.MAIL_IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
    logger: false,
  };
}

export function mailConfigured() {
  return !!(process.env.MAIL_IMAP_HOST && process.env.MAIL_USER && process.env.MAIL_PASSWORD);
}

// Liste les N derniers emails de la boîte de réception (en-têtes seulement, rapide).
export async function fetchInbox(limit = 20) {
  const client = new ImapFlow(imapConfig());
  await client.connect();
  const messages = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = client.mailbox.exists || 0;
      if (total === 0) return [];
      const start = Math.max(1, total - limit + 1);
      for await (const msg of client.fetch(`${start}:*`, { envelope: true, uid: true, internalDate: true })) {
        messages.push({
          uid: msg.uid,
          from: msg.envelope?.from?.[0]?.address || "",
          fromName: msg.envelope?.from?.[0]?.name || "",
          subject: msg.envelope?.subject || "(sans objet)",
          date: msg.internalDate,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return messages.reverse(); // le plus récent en premier
}

// Récupère le contenu complet (texte) d'un email précis, par son UID IMAP.
export async function fetchMessage(uid) {
  const client = new ImapFlow(imapConfig());
  await client.connect();
  let result = null;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const { content } = await client.download(String(uid), undefined, { uid: true });
      const parsed = await simpleParser(content);
      result = {
        uid: Number(uid),
        from: parsed.from?.text || "",
        subject: parsed.subject || "(sans objet)",
        date: parsed.date,
        text: parsed.text || "",
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return result;
}

export async function sendMail({ to, subject, text }) {
  const port = Number(process.env.MAIL_SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_SMTP_HOST,
    port,
    secure: port === 465, // 465 = SSL/TLS direct, 587 = STARTTLS
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
  });
  return transporter.sendMail({ from: process.env.MAIL_USER, to, subject, text });
}
