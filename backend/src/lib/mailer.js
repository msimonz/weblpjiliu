import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    // Si la red no puede conectar a Gmail, fallar rápido en vez de colgar el request indefinidamente.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  return transporter;
}

export async function sendPasswordResetEmail(toEmail, resetLink) {
  const transport = getTransporter();

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: "Restablecer tu contraseña — WebNotas JILIU",
    text: `Recibimos una solicitud para restablecer tu contraseña.\n\nHacé clic en este link (válido por 30 minutos):\n${resetLink}\n\nSi no pediste este cambio, ignorá este correo.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Restablecer tu contraseña</h2>
        <p>Recibimos una solicitud para restablecer tu contraseña en WebNotas JILIU.</p>
        <p>
          <a href="${resetLink}" style="display:inline-block;background:#16A34A;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Restablecer contraseña
          </a>
        </p>
        <p>Este link es válido por 30 minutos. Si no pediste este cambio, podés ignorar este correo.</p>
      </div>
    `,
  });
}
