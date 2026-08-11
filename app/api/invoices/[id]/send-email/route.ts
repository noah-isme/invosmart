import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/lib/db';
import { resend } from '@/lib/email/resend';
import { InvoiceEmail } from '@/emails/InvoiceEmail';
import { render } from '@react-email/render';
import { auditLogger } from '@/lib/audit/auditLogger';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rateLimitResponse = await rateLimit(
      `send-email-${session.user.id}`,
      5,
      60
    );
    
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const { to } = body;

    const invoice = await db.invoice.findUnique({
      where: { id },
      include: { user: true, client_rel: true },
    });

    if (!invoice || invoice.userId !== session.user.id) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const recipientEmail = to || invoice.client_rel?.email;
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Recipient email is required' },
        { status: 400 }
      );
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const viewUrl = `${baseUrl}/share/${invoice.id}`; // Assuming this is a public view URL

    let parsedItems: Array<{ description: string; quantity: number; price: number; amount: number }> = [];
    if (invoice.items) {
      if (typeof invoice.items === 'string') {
        try {
          parsedItems = JSON.parse(invoice.items) as Array<{ description: string; quantity: number; price: number; amount: number }>;
        } catch {
           parsedItems = [];
        }
      } else if (Array.isArray(invoice.items)) {
        parsedItems = invoice.items as Array<{ description: string; quantity: number; price: number; amount: number }>;
      }
    }

    const html = await render(
      InvoiceEmail({
        invoiceNumber: invoice.number,
        clientName: invoice.client_rel?.name || invoice.client,
        issuerName: invoice.user.name || 'Your Company',
        items: parsedItems,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
        currency: invoice.currency,
        dueAt: invoice.dueAt,
        notes: invoice.notes,
        viewUrl,
      })
    );

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `Invoice #${invoice.number} from ${invoice.user.name || 'Your Company'}`,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json(
        { error: 'Failed to send email' },
        { status: 500 }
      );
    }

    const emailLogEntry = {
      to: recipientEmail,
      sentAt: new Date().toISOString(),
      messageId: data?.id,
    };

    let newEmailLog: Array<{ to: string; sentAt: string; messageId?: string }> = [];
    if (invoice.emailLog) {
      if (Array.isArray(invoice.emailLog)) {
        newEmailLog = [...(invoice.emailLog as Array<{ to: string; sentAt: string; messageId?: string }>), emailLogEntry];
      } else {
        newEmailLog = [emailLogEntry];
      }
    } else {
      newEmailLog = [emailLogEntry];
    }

    await db.invoice.update({
      where: { id },
      data: {
        emailedAt: new Date(),
        emailLog: newEmailLog,
      },
    });

    await auditLogger.log({
      action: 'email_sent',
      entity: 'invoice',
      entityId: invoice.id,
      userId: session.user.id,
      details: { to: recipientEmail, messageId: data?.id },
    });

    return NextResponse.json({ success: true, messageId: data?.id });
  } catch (error) {
    console.error('Error sending email:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
