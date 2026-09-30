import nodemailer from 'nodemailer'

export function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // An unreachable or silent SMTP host must not hang the request that is
    // waiting on sendMail(). Without these nodemailer waits on the OS socket
    // timeout, which is minutes.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  })
}

export const MAIL_FROM = process.env.SMTP_FROM ?? 'RGB Admin <no-reply@rgb-admin.com>'
