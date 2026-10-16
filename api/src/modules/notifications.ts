import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import nodemailer from 'nodemailer';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { JOBS, type AppointmentJob, type JobName } from '../lib/queue.ts';
import { requireUser } from './auth.ts';
import { appointmentDetails, type AppointmentDetail } from './appointments.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  kind: string;
  appointmentId?: number;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Sends through SMTP when SMTP_URL is configured. Independently of that, it can
 * store every mail in sent_emails so the public demo has a visible "mailbox".
 */
export function createMailer(db: Db, options: { smtpUrl: string | null; from: string; demoOutbox: boolean }): Mailer {
  const transport = options.smtpUrl ? nodemailer.createTransport(options.smtpUrl) : null;
  return {
    async send(mail) {
      if (transport) await transport.sendMail({ from: options.from, to: mail.to, subject: mail.subject, text: mail.text });
      if (options.demoOutbox) {
        await db
          .insertInto('sent_emails')
          .values({ to_email: mail.to, subject: mail.subject, body: mail.text, kind: mail.kind, appointment_id: mail.appointmentId ?? null })
          .execute();
      }
      if (!transport && !options.demoOutbox) console.log(`[mail] to=${mail.to} subject=${mail.subject}`);
    },
  };
}

const formatWhen = (a: AppointmentDetail) =>
  DateTime.fromJSDate(a.start, { zone: a.timezone }).setLocale('tr').toFormat("d MMMM yyyy cccc, HH:mm");

const formatPrice = (cents: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(cents / 100);

function summary(a: AppointmentDetail) {
  return [
    `İşletme : ${a.businessName}`,
    `Hizmet  : ${a.serviceName} (${formatPrice(a.priceCents)})`,
    `Çalışan : ${a.staffName}`,
    `Zaman   : ${formatWhen(a)}`,
  ].join('\n');
}

/** What each background job does. Every handler is safe to run twice (jobs can be retried). */
export function createJobHandlers(ctx: AppContext): Record<JobName, (data: AppointmentJob) => Promise<void>> {
  const { db, mailer } = ctx;
  const load = (id: number) => appointmentDetails(db).where('a.id', '=', id).executeTakeFirst();
  const ownerEmail = async (ownerId: number) =>
    (await db.selectFrom('users').select('email').where('id', '=', ownerId).executeTakeFirstOrThrow()).email;
  const myAppointmentsUrl = `${ctx.appUrl}/randevularim`;

  return {
    async [JOBS.confirmation]({ appointmentId }) {
      const a = await load(appointmentId);
      if (!a) return;
      await mailer.send({
        to: a.customerEmail,
        subject: `Randevunuz onaylandı: ${a.businessName}`,
        text: `Merhaba ${a.customerName},\n\nRandevunuz oluşturuldu.\n\n${summary(a)}\n\nRandevularınızı görmek veya iptal etmek için: ${myAppointmentsUrl}\n`,
        kind: 'confirmation',
        appointmentId,
      });
      await mailer.send({
        to: await ownerEmail(a.ownerId),
        subject: `Yeni randevu: ${a.customerName}, ${formatWhen(a)}`,
        text: `Yeni bir randevu alındı.\n\nMüşteri : ${a.customerName}\n${summary(a)}\n`,
        kind: 'owner-new',
        appointmentId,
      });
    },

    async [JOBS.reminder]({ appointmentId }) {
      const a = await load(appointmentId);
      // The appointment may have been cancelled after the reminder was scheduled.
      if (!a || a.status !== 'booked' || a.start <= ctx.now()) return;
      const already = await db.selectFrom('appointments').select('reminder_sent_at').where('id', '=', appointmentId).executeTakeFirstOrThrow();
      if (already.reminder_sent_at) return;
      await mailer.send({
        to: a.customerEmail,
        subject: `Hatırlatma: yarın ${a.businessName} randevunuz var`,
        text: `Merhaba ${a.customerName},\n\nRandevunuzu hatırlatmak isteriz.\n\n${summary(a)}\n\nGelemeyecekseniz lütfen iptal edin: ${myAppointmentsUrl}\n`,
        kind: 'reminder',
        appointmentId,
      });
      await db.updateTable('appointments').set({ reminder_sent_at: ctx.now() }).where('id', '=', appointmentId).execute();
    },

    async [JOBS.cancellation]({ appointmentId }) {
      const a = await load(appointmentId);
      if (!a || a.status !== 'cancelled') return;
      await mailer.send({
        to: a.customerEmail,
        subject: `Randevunuz iptal edildi: ${a.businessName}`,
        text: `Merhaba ${a.customerName},\n\nAşağıdaki randevu iptal edildi.\n\n${summary(a)}\n\nYeni randevu almak için: ${ctx.appUrl}/isletme/${a.businessSlug}\n`,
        kind: 'cancellation',
        appointmentId,
      });
      await mailer.send({
        to: await ownerEmail(a.ownerId),
        subject: `Randevu iptal edildi: ${a.customerName}, ${formatWhen(a)}`,
        text: `Bir randevu iptal edildi.\n\nMüşteri : ${a.customerName}\n${summary(a)}\n`,
        kind: 'owner-cancelled',
        appointmentId,
      });
    },
  };
}

export function registerNotifications(app: FastifyInstance, ctx: AppContext) {
  // Demo mailbox: the e-mails the system sent to the signed-in user.
  app.get('/api/me/emails', async (request) => {
    const user = requireUser(request);
    const emails = await ctx.db
      .selectFrom('sent_emails')
      .select(['id', 'subject', 'body', 'kind', 'created_at as createdAt'])
      .where('to_email', '=', user.email)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
    return { emails };
  });
}
