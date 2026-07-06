import { Resend } from "resend";

let resend = null;

function getResend() {
  if (resend) return resend;
  resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM = "WebNotas JILIU <no-responder@sofialapromesa.orko.com.co>";

export async function sendPasswordResetEmail(toEmail, resetLink) {
  const client = getResend();

  const { error } = await client.emails.send({
    from: FROM,
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

  if (error) {
    throw new Error(error.message || "Error enviando el correo con Resend");
  }
}
