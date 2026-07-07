import Image from 'next/image';
import { redirect, notFound } from 'next/navigation';
import { getAuthenticatedBillingContext } from '@/lib/billing';
import { BILLING_DOCUMENT_COPY, buildBillingDocumentContext, formatDate } from '@/lib/billing-documents';
import PrintButton from './PrintButton';

export const metadata = {
  title: 'Canary Data Billing Document',
  description: 'Canary Data quote, purchase order, and receipt documents.',
};

function PaymentTerms({ documentType, doc }) {
  if (documentType === 'receipt') {
    return (
      <>
        <strong>Payment status:</strong> {doc.paymentStatus === 'paid' ? 'Paid' : 'Not paid yet'}<br />
        <strong>Paid date:</strong> {formatDate(doc.paidAt)}<br />
        <strong>PO number:</strong> {doc.poNumber || 'Not provided'}
      </>
    );
  }

  return (
    <>
      <strong>Payment terms:</strong> Net 30 from purchase order/invoice issue date.<br />
      <strong>Access policy:</strong> If payment is not received and cleared within 30 days, account access pauses until payment clears.<br />
      <strong>Renewal:</strong> Annual access renews yearly. If the account is not renewed annually, platform access ends at the renewal date.
    </>
  );
}

export default async function BillingDocumentPage({ params }) {
  const { documentType } = await params;
  if (!BILLING_DOCUMENT_COPY[documentType]) notFound();

  const context = await getAuthenticatedBillingContext();
  if (!context.user) redirect(`/login?redirect_to=/billing/${documentType}`);

  const copy = BILLING_DOCUMENT_COPY[documentType];
  const doc = buildBillingDocumentContext(context);
  const documentNumber = documentType === 'quote'
    ? doc.quoteNumber
    : documentType === 'receipt'
      ? doc.receiptNumber
      : doc.invoiceNumber;
  const isReceipt = documentType === 'receipt';
  const isPaid = doc.paymentStatus === 'paid';

  return (
    <main style={{ minHeight: '100vh', background: '#f3f4f6', padding: '28px 16px', color: '#111827' }}>
      <style>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .document-sheet { box-shadow: none !important; margin: 0 !important; width: 100% !important; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: '920px', margin: '0 auto 16px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <a href="/dashboard" style={{ color: '#334155', textDecoration: 'none', fontSize: '0.9rem' }}>← Back to dashboard</a>
        <PrintButton />
      </div>

      <section className="document-sheet" style={{ maxWidth: '920px', margin: '0 auto', background: '#fff', boxShadow: '0 18px 50px rgba(15,23,42,0.14)', borderRadius: '16px', overflow: 'hidden' }}>
        <div style={{ background: '#0b1120', color: '#fff', padding: '32px', display: 'flex', justifyContent: 'space-between', gap: '24px', alignItems: 'flex-start' }}>
          <div>
            <Image src="/canary-logo.svg" alt="Canary Data" width={210} height={58} style={{ height: '46px', width: 'auto', marginBottom: '18px' }} />
            <div style={{ color: '#cbd5e1', fontSize: '0.92rem', lineHeight: 1.6 }}>
              Media intelligence and daily monitoring for school districts.
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#f5c518', textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: '0.78rem', fontWeight: 800 }}>{copy.label}</div>
            <h1 style={{ margin: '8px 0 10px', fontSize: '1.9rem' }}>{copy.title}</h1>
            <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>Document #: {documentNumber}</div>
          </div>
        </div>

        <div style={{ padding: '34px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '28px', marginBottom: '28px' }}>
            <div>
              <h2 style={{ fontSize: '1rem', margin: '0 0 10px', color: '#111827' }}>Bill to</h2>
              <div style={{ lineHeight: 1.65, color: '#374151' }}>
                <strong style={{ color: '#111827' }}>{doc.organizationName}</strong><br />
                {doc.billingContactName && <>{doc.billingContactName}<br /></>}
                {doc.billingEmail}<br />
                {doc.districtId && <>Account ID: {doc.districtId}<br /></>}
                {documentType !== 'quote' && <>PO Number: <strong>{doc.poNumber || 'Pending / to be provided by district'}</strong></>}
              </div>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px', background: '#f9fafb', lineHeight: 1.8, color: '#374151' }}>
              <strong>Issued:</strong> {formatDate(doc.issuedAt)}<br />
              {!isReceipt && <><strong>Due:</strong> {formatDate(doc.dueAt)}<br /></>}
              <strong>Terms:</strong> {doc.netTerms}<br />
              <strong>Status:</strong> {isReceipt ? (isPaid ? 'Paid' : 'Not paid') : copy.statusLabel}
            </div>
          </div>

          <p style={{ color: '#4b5563', lineHeight: 1.7, marginBottom: '24px' }}>{copy.intro}</p>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '26px' }}>
            <thead>
              <tr style={{ background: '#111827', color: '#fff' }}>
                <th style={{ textAlign: 'left', padding: '13px 14px', borderTopLeftRadius: '10px' }}>Description</th>
                <th style={{ textAlign: 'center', padding: '13px 14px' }}>Term</th>
                <th style={{ textAlign: 'right', padding: '13px 14px', borderTopRightRadius: '10px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '16px 14px', borderBottom: '1px solid #e5e7eb', color: '#374151' }}>
                  <strong style={{ color: '#111827' }}>Canary Data Annual Access</strong><br />
                  Daily media monitoring, dashboard access, AI-assisted summaries, strategic recommendations, and PDF exports after approved trial/onboarding review.
                </td>
                <td style={{ padding: '16px 14px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', color: '#374151' }}>Annual</td>
                <td style={{ padding: '16px 14px', borderBottom: '1px solid #e5e7eb', textAlign: 'right', color: '#111827', fontWeight: 800 }}>{doc.amountLabel}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="2" style={{ padding: '18px 14px', textAlign: 'right', fontWeight: 800 }}>Total</td>
                <td style={{ padding: '18px 14px', textAlign: 'right', fontWeight: 900, fontSize: '1.2rem' }}>{doc.amountLabel}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '24px' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px', color: '#374151', lineHeight: 1.7 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '1rem', color: '#111827' }}>Trial / access</h3>
              Trial start: {formatDate(doc.trialStartsAt)}<br />
              Trial end: {formatDate(doc.trialEndsAt)}<br />
              No long-term commitment before annual approval/payment.
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px', color: '#374151', lineHeight: 1.7 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '1rem', color: '#111827' }}>Terms</h3>
              <PaymentTerms documentType={documentType} doc={doc} />
            </div>
          </div>

          <div style={{ background: '#fffbeb', border: '1px solid #facc15', borderRadius: '12px', padding: '18px', color: '#713f12', lineHeight: 1.65, fontSize: '0.92rem' }}>
            <strong>School finance note:</strong> Purchase order/invoice payment terms are Net 30. If payment is not received and cleared within 30 days, Canary Data access may pause until the payment clears. Check payments are recorded as paid only once cleared.
          </div>
        </div>
      </section>
    </main>
  );
}
