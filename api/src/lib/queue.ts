import type { PgBoss } from 'pg-boss';

// Background jobs. Route handlers only *enqueue* work; a worker runs it later,
// so a slow mail server never slows down booking an appointment.

export const JOBS = {
  confirmation: 'appointment-confirmation',
  reminder: 'appointment-reminder',
  cancellation: 'appointment-cancellation',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface AppointmentJob {
  appointmentId: number;
}

export interface JobQueue {
  send(name: JobName, data: AppointmentJob, options?: { startAfter?: Date }): Promise<void>;
}

/** Production queue: jobs are stored in PostgreSQL by pg-boss and survive restarts. */
export function pgBossQueue(boss: PgBoss): JobQueue {
  return {
    async send(name, data, options) {
      await boss.send(name, data, {
        startAfter: options?.startAfter,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
      });
    },
  };
}

/** Test queue: just remembers what was enqueued. */
export class MemoryQueue implements JobQueue {
  jobs: { name: JobName; data: AppointmentJob; startAfter?: Date }[] = [];

  async send(name: JobName, data: AppointmentJob, options?: { startAfter?: Date }) {
    this.jobs.push({ name, data, startAfter: options?.startAfter });
  }
}
