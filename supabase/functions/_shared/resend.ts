// Helper compartido para enviar correos vía Resend — usado por
// send-upgrade-request y send-expiry-warning. No es una función
// desplegable por sí sola (prefijo _), solo se importa.

export interface SendEmailParams {
  to: string[];
  subject: string;
  html: string;
}

// Devuelve true si Resend aceptó el envío. No lanza excepción si falla
// — solo loguea el detalle, así el caller decide si eso debe bloquear
// la respuesta al usuario o no.
export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey || params.to.length === 0) {
    if (!resendKey) console.error('RESEND_API_KEY no configurado — no se envió correo');
    return false;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM') ?? 'onboarding@resend.dev',
      ...params,
    }),
  });

  if (!resp.ok) {
    console.error('Resend error:', resp.status, await resp.text());
    return false;
  }
  return true;
}
