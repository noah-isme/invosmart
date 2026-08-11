import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Button,
  Hr,
  Preview,
} from '@react-email/components';

export interface InvoiceEmailProps {
  invoiceNumber: string;
  clientName: string;
  issuerName: string;
  items: Array<{ description: string; quantity: number; price: number; amount: number }>;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  dueAt?: Date | null;
  notes?: string | null;
  viewUrl: string;
}

const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100);
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
};

export const InvoiceEmail = ({
  invoiceNumber,
  clientName,
  issuerName,
  items,
  subtotal,
  tax,
  total,
  currency,
  dueAt,
  notes,
  viewUrl,
}: InvoiceEmailProps) => {
  const previewText = `Invoice ${invoiceNumber} from ${issuerName}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logoText}>InvoSmart</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Invoice {invoiceNumber}</Heading>
            <Text style={paragraph}>Hello {clientName},</Text>
            <Text style={paragraph}>
              You have a new invoice from <strong>{issuerName}</strong>.
            </Text>

            {dueAt && (
              <Text style={paragraph}>
                Please note that this invoice is due by <strong>{formatDate(new Date(dueAt))}</strong>.
              </Text>
            )}

            <Section style={tableContainer}>
              <table style={table} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr>
                    <th style={{ ...tableHeader, textAlign: 'left' }}>Description</th>
                    <th style={{ ...tableHeader, textAlign: 'center' }}>Qty</th>
                    <th style={{ ...tableHeader, textAlign: 'right' }}>Price</th>
                    <th style={{ ...tableHeader, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={index}>
                      <td style={{ ...tableCell, textAlign: 'left' }}>{item.description}</td>
                      <td style={{ ...tableCell, textAlign: 'center' }}>{item.quantity}</td>
                      <td style={{ ...tableCell, textAlign: 'right' }}>{formatCurrency(item.price, currency)}</td>
                      <td style={{ ...tableCell, textAlign: 'right' }}>{formatCurrency(item.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Hr style={hr} />
              <table style={{ width: '100%', margin: '16px 0' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '70%', textAlign: 'right', padding: '4px 8px' }}>Subtotal:</td>
                    <td style={{ width: '30%', textAlign: 'right', padding: '4px 8px' }}>{formatCurrency(subtotal, currency)}</td>
                  </tr>
                  {tax > 0 && (
                    <tr>
                      <td style={{ width: '70%', textAlign: 'right', padding: '4px 8px' }}>Tax:</td>
                      <td style={{ width: '30%', textAlign: 'right', padding: '4px 8px' }}>{formatCurrency(tax, currency)}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ width: '70%', textAlign: 'right', padding: '8px 8px', fontWeight: 'bold' }}>Total:</td>
                    <td style={{ width: '30%', textAlign: 'right', padding: '8px 8px', fontWeight: 'bold' }}>{formatCurrency(total, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {notes && (
              <Section style={notesSection}>
                <Text style={notesLabel}>Notes:</Text>
                <Text style={notesText}>{notes}</Text>
              </Section>
            )}

            <Section style={buttonContainer}>
              <Button style={button} href={viewUrl}>
                View Invoice
              </Button>
            </Section>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              Sent by {issuerName} via InvoSmart
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: '#f9fafb',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '600px',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
};

const header = {
  padding: '0 48px',
  marginTop: '24px',
};

const logoText = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#6366F1',
  margin: '0',
};

const content = {
  padding: '0 48px',
};

const heading = {
  fontSize: '24px',
  letterSpacing: '-0.5px',
  lineHeight: '1.3',
  fontWeight: '400',
  color: '#484848',
  padding: '17px 0 0',
};

const paragraph = {
  margin: '0 0 15px',
  fontSize: '15px',
  lineHeight: '1.4',
  color: '#3c4149',
};

const tableContainer = {
  margin: '24px 0',
  borderRadius: '4px',
  border: '1px solid #e5e7eb',
  padding: '16px',
};

const table = {
  width: '100%',
  borderCollapse: 'collapse' as const,
};

const tableHeader = {
  padding: '8px',
  borderBottom: '1px solid #e5e7eb',
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#6b7280',
};

const tableCell = {
  padding: '8px',
  borderBottom: '1px solid #e5e7eb',
  fontSize: '14px',
  color: '#374151',
};

const hr = {
  borderColor: '#e5e7eb',
  margin: '16px 0',
};

const notesSection = {
  backgroundColor: '#f3f4f6',
  padding: '16px',
  borderRadius: '4px',
  marginBottom: '24px',
};

const notesLabel = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#374151',
  margin: '0 0 4px 0',
};

const notesText = {
  fontSize: '14px',
  color: '#4b5563',
  margin: '0',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  backgroundColor: '#6366F1',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '15px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  width: '100%',
  padding: '12px 20px',
  fontWeight: 'bold',
};

const footer = {
  padding: '0 48px',
};

const footerText = {
  fontSize: '12px',
  color: '#9ca3af',
  textAlign: 'center' as const,
};

export default InvoiceEmail;
