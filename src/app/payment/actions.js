'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createCanaryCheckoutSession } from '@/lib/stripe';

function clean(value) {
  return String(value || '').trim();
}

export async function startCanaryCheckout(formData) {
  const organizationName = clean(formData.get('organization_name'));
  const contactEmail = clean(formData.get('contact_email')).toLowerCase();
  const requestId = clean(formData.get('request_id'));

  if (!organizationName) throw new Error('District or organization name is required.');
  if (!contactEmail || !contactEmail.includes('@')) throw new Error('A valid email is required.');

  const headerStore = await headers();
  const origin = headerStore.get('origin') || `https://${headerStore.get('host') || 'www.canarydata.media'}`;
  const session = await createCanaryCheckoutSession({ organizationName, contactEmail, requestId, origin });

  if (!session?.url) throw new Error('Stripe did not return a checkout URL.');
  redirect(session.url);
}
