import Image from 'next/image';
import { redirect, notFound } from 'next/navigation';
import { getAuthenticatedBillingContext } from '@/lib/billing';
import {
  BILLING_DOCUMENT_COPY,
  buildBillingDocumentContext,
  formatCityStateZip,
  formatDate,
} from '@/lib/billing-documents';
import PrintButton from './PrintButton';

export const metadata = {
  title: 'Canary Data Billing Document',
  description: 'Canary Data estimate, invoice, and receipt documents.',
};

function resolveDocumentNumber(documentType, doc) {
  if (documentType === 'receipt') return doc.receiptNumber;
  if (documentType === 'invoice' || documentType === 'purchase-order') return doc.invoiceNumber;
  return doc.estimateNumber;
}

function resolveDocumentNumberLabel(documentType) {
  if (documentType === 'receipt') return 'Receipt #';
  if (documentType === 'invoice' || documentType === 'purchase-order') return 'Invoice #';
  return 'Price Quote #';
}

function PaymentTerms({ documentType, doc }) {
  if (documentType === 'receipt') {
    return (
      <>
        <strong>Payment status:</strong> {doc.paymentStatus === 'paid' ? 'Paid' : 'Not paid yet'}<br />
        <strong>Paid date:</strong> {formatDate(doc.paidAt)}<br />
        <strong>Annual access through:</strong> {formatDate(doc.paidThrough)}<br />
        <strong>PO #:</strong> {doc.poNumber || 'Not provided'}
      </>
    );
  }

  if (documentType === 'invoice' || documentType === 'purchase-order') {
    return (
      <>
        <strong>Payment terms:</strong> Net 30 from invoice issue date.<br />
        <strong>Payment methods:</strong> Card, check, or ACH/manual reconciliation.<br />
        <strong>Access policy:</strong> To keep access uninterrupted, complete card payment or enter the district PO number and route payment by check/ACH before the trial ends. Account access may pause if payment is not received and cleared by the due date.
      </>
    );
  }

  return (
    <>
      <strong>Payment terms:</strong> Net 30 from document issue date.<br />
      <strong>Trial policy:</strong> The 30-day trial begins when the account is activated. Generating this price quote does not extend the trial period.<br />
      <strong>Renewal:</strong> Annual access does not automatically renew unless a renewal agreement is completed.
    </>
  );
}

function FinanceNote({ documentType, doc }) {
  if (documentType === 'receipt') {
    return (
      <div style={{ background: '#ecfdf5', border: '1px solid #22c55e55', borderRadius: '12px', padding: '18px', color: '#166534', lineHeight: 1.65, fontSize: '0.92rem' }}>
        <strong>Thank you for your payment.</strong> Your Canary Data annual access is active through {formatDate(doc.paidThrough)}. Find the story before it finds you.
      </div>
    );
  }

  return (
    <div style={{ background: '#fffbeb', border: '1px solid #facc15', borderRadius: '12px', padding: '18px', color: '#713f12', lineHeight: 1.65, fontSize: '0.92rem' }}>
      <strong>School finance note:</strong> Your 30-day free trial begins when your account is activated. Price quotes and invoices may be used for district approval and payment processing, but generating a document does not extend the trial period. To maintain uninterrupted access, pay by card or enter the district PO number and route check/ACH payment before the trial ends. Invoice/payment terms are Net 30 from the invoice issue date.
    </div>
  );
}

export default async function BillingDocumentPage({ params }) {
  const { documentType } = await params;
  if (!BILLING_DOCUMENT_COPY[documentType]) notFound();

  const context = await getAuthenticatedBillingContext();
  if (!context.user) redirect(`/login?redirect_to=/billing/${documentType}`);

  const copy = BILLING_DOCUMENT_COPY[documentType];
  const doc = buildBillingDocumentContext(context);
  const documentNumber = resolveDocumentNumber(documentType, doc);
  const documentNumberLabel = resolveDocumentNumberLabel(documentType);
  const isReceipt = documentType === 'receipt';
  const isPaid = doc.paymentStatus === 'paid';
  const requiresPo = documentType === 'invoice' || documentType === 'purchase-order';

  if (isReceipt && !isPaid) {
    return (
      <main style={{ minHeight: '100vh', background: '#f3f4f6', padding: '28px 16px', color: '#111827' }}>
        <section style={{ maxWidth: '720px', margin: '60px auto', background: '#fff', boxShadow: '0 18px 50px rgba(15,23,42,0.14)', borderRadius: '16px', padding: '34px' }}>
          <Image src="/canary-logo.svg" alt="Canary Data" width={210} height={58} style={{ height: '46px', width: 'auto', marginBottom: '22px' }} />
          <h1 style={{ margin: '0 0 12px', fontSize: '1.65rem' }}>Receipt not available yet</h1>
          <p style={{ color: '#4b5563', lineHeight: 1.7, marginBottom: '22px' }}>
            Receipts are only generated after payment is confirmed. You can still download the Price Quote from Account Settings.
          </p>
          <a href="/dashboard" style={{ background: '#f5c518', color: '#111827', padding: '10px 14px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem' }}>Back to dashboard</a>
        </section>
      </main>
    );
  }

  if (requiresPo && !doc.poNumber) {
    return (
      <main style={{ minHeight: '100vh', background: '#f3f4f6', padding: '28px 16px', color: '#111827' }}>
        <section style={{ maxWidth: '720px', margin: '60px auto', background: '#fff', boxShadow: '0 18px 50px rgba(15,23,42,0.14)', borderRadius: '16px', padding: '34px' }}>
          <Image src="/canary-logo.svg" alt="Canary Data" width={210} height={58} style={{ height: '46px', width: 'auto', marginBottom: '22px' }} />
          <h1 style={{ margin: '0 0 12px', fontSize: '1.65rem' }}>Invoice needs a PO number</h1>
          <p style={{ color: '#4b5563', lineHeight: 1.7, marginBottom: '22px' }}>
            Enter and save the district purchase order number in Account Settings before generating an invoice for check/ACH payment processing.
          </p>
          <a href="/dashboard" style={{ background: '#f5c518', color: '#111827', padding: '10px 14px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem' }}>Back to dashboard</a>
        </section>
      </main>
    );
  }

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
              Strategic communications intelligence for school districts.
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#f5c518', textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: '0.78rem', fontWeight: 800 }}>{copy.label}</div>
            <h1 style={{ margin: '8px 0 10px', fontSize: '1.9rem' }}>{copy.title}</h1>
            <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>{documentNumberLabel}: {documentNumber}</div>
            {doc.poNumber && <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>PO #: {doc.poNumber}</div>}
          </div>
        </div>

        <div style={{ padding: '34px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '28px', marginBottom: '28px' }}>
            <div>
              <h2 style={{ fontSize: '1rem', margin: '0 0 10px', color: '#111827' }}>Bill to</h2>
              <div style={{ lineHeight: 1.65, color: '#374151' }}>
                <strong style={{ color: '#111827' }}>District / Organization: {doc.organizationName}</strong><br />
                {doc.billingContactName && <>Billing contact: {doc.billingContactName}<br /></>}
                {doc.billingPhone && <>Billing phone: {doc.billingPhone}<br /></>}
                {doc.billingAddressLine1 ? <>{doc.billingAddressLine1}<br /></> : <span style={{ color: '#9ca3af' }}>District billing address pending<br /></span>}
                {doc.billingAddressLine2 && <>{doc.billingAddressLine2}<br /></>}
                {formatCityStateZip(doc.billingCity, doc.billingState, doc.billingZip) && <>{formatCityStateZip(doc.billingCity, doc.billingState, doc.billingZip)}<br /></>}
                {doc.billingEmail}<br />
                {doc.districtId && <>Account ID: {doc.districtId}<br /></>}
              </div>
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px', background: '#f9fafb', color: '#374151' }}>
              <div style={{ lineHeight: 1.8 }}>
                <strong>Issued:</strong> {formatDate(doc.issuedAt)}<br />
                {!isReceipt && <><strong>Due:</strong> {formatDate(doc.dueAt)}<br /></>}
                <strong>Terms:</strong> {doc.netTerms}<br />
                <strong>Status:</strong> {isReceipt ? (isPaid ? 'Paid' : 'Not paid') : copy.statusLabel}
              </div>
              <div style={{ marginTop: '18px' }}>
                <h2 style={{ fontSize: '1rem', margin: '0 0 10px', color: '#111827' }}>Vendor</h2>
                <div style={{ lineHeight: 1.65, color: '#374151' }}>
                  <strong style={{ color: '#111827' }}>{doc.vendorName}</strong><br />
                  {doc.vendorAddressLine1}<br />
                  {doc.vendorAddressLine2 && <>{doc.vendorAddressLine2}<br /></>}
                  {doc.vendorEmail}<br />
                  <span style={{ color: '#6b7280' }}>W-9 available separately for vendor setup.</span>
                </div>
              </div>
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
                  Annual Canary Data platform access, including daily media monitoring, dashboard access, reporting, AI-assisted summaries, strategic recommendations, and exports.
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
              <h3 style={{ margin: '0 0 8px', fontSize: '1rem', color: '#111827' }}>{isReceipt ? 'Annual access' : 'Trial / access'}</h3>
              {isReceipt ? (
                <>Annual access through: {formatDate(doc.paidThrough)}<br />Paid date: {formatDate(doc.paidAt)}</>
              ) : (
                <>Trial start: {formatDate(doc.trialStartsAt)}<br />Trial end: {formatDate(doc.trialEndsAt)}<br />No long-term commitment before annual approval/payment.</>
              )}
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px', color: '#374151', lineHeight: 1.7 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '1rem', color: '#111827' }}>Terms</h3>
              <PaymentTerms documentType={documentType} doc={doc} />
            </div>
          </div>

          <FinanceNote documentType={documentType} doc={doc} />
        </div>
      </section>
    </main>
  );
}
