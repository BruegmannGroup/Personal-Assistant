// SendGrid email service for dormant thread alerts

interface DormantThread {
  thread_id: string;
  organizations: string | null;
  last_encounter_date: string | null;
  days_since: number | null;
}

export async function sendDormantAlert(
  sendgridKey: string,
  fromEmail: string,
  toEmail: string,
  threads: DormantThread[],
  workerUrl: string,
  cronToken: string
): Promise<void> {
  if (!threads.length) return;

  const threadList = threads
    .map((t) => {
      const org = t.organizations || "Unknown organization";
      const last = t.last_encounter_date || "unknown date";
      const days = t.days_since !== null ? `${t.days_since} days ago` : "";
      return `<li><strong>${t.thread_id}</strong> — ${org} · last encounter ${last} ${days ? `(${days})` : ""}</li>`;
    })
    .join("\n");

  const dismissLinks = threads
    .map(
      (t) =>
        `<li><a href="${workerUrl}/cron/dismiss?thread_id=${encodeURIComponent(t.thread_id)}&token=${cronToken}">Dismiss reminder for ${t.thread_id}</a></li>`
    )
    .join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 12px;">Dormant Thread Alert</h2>
      <p>Hi Christopher,</p>
      <p>The following threads have <strong>no follow-up date set</strong> and are marked as dormant or inactive. They may need attention:</p>
      <ul style="line-height: 1.8;">
        ${threadList}
      </ul>
      <p style="margin-top: 24px; padding: 16px; background: #f5f5f5; border-radius: 6px;">
        <strong>Dismiss a reminder:</strong> Click a link below to stop receiving alerts for that thread.
      </p>
      <ul style="line-height: 1.8;">
        ${dismissLinks}
      </ul>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
      <p style="color: #666; font-size: 12px;">
        This is an automated alert from your Executive Memory Agent.<br />
        To change alert settings, reply to this email or adjust in the dashboard.
      </p>
    </div>
  `;

  const text = `Dormant Thread Alert\n\n` +
    `The following threads have no follow-up date set and need attention:\n\n` +
    threads.map((t) => `• ${t.thread_id} — ${t.organizations || "Unknown"} — last: ${t.last_encounter_date || "unknown"}`).join("\n") +
    `\n\nDismiss links:\n` +
    threads.map((t) => `• ${t.thread_id}: ${workerUrl}/cron/dismiss?thread_id=${encodeURIComponent(t.thread_id)}&token=${cronToken}`).join("\n");

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail, name: "Executive Memory Agent" },
      subject: `${threads.length} dormant thread${threads.length === 1 ? "" : "s"} need attention`,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SendGrid API error: ${response.status} ${errorText}`);
  }
}
