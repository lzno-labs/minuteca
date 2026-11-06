/** The mail boundary. Implementations: console (default, prints the message) and Resend. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mail {
  send(message: MailMessage): Promise<void>;
}

/** Local default: prints the message, so a self-hosted install works without an email provider. */
export function consoleMail(log: (s: string) => void = console.log): Mail {
  return {
    async send({ to, subject, text }) {
      log(`\n[mail] to: ${to}\n[mail] subject: ${subject}\n${text}\n`);
    },
  };
}

/** Resend (https://resend.com). The API key is a secret of the deployment, never a file. */
export function resendMail(apiKey: string, from: string, fetcher: typeof fetch = fetch): Mail {
  return {
    async send({ to, subject, text }) {
      const r = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!r.ok) throw new Error(`mail: resend answered ${r.status}`);
    },
  };
}
