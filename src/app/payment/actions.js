'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createCanaryCheckoutSession } from '@/lib/stripe';
import { getAuthenticatedBillingContext } from '@/lib/billing';

export async function startCanaryCheckout() {
  const { user, districtId, districtName, email, onboardingRequest } = await getAuthenticatedBillingContext();
  if (!user) redirect('/login?redirect_to=/payment');

  const organizationName = districtName || onboardingRequest?.organization_name || '';
  if (!organizationName) {
    throw new Error('This login is not tied to a district/account yet. Contact Canary before submitting payment.');
  }
  if (!email || !email.includes('@')) {
    throw new Error('Your login does not have a valid billing email. Contact Canary before submitting payment.');
  }

  const headerStore = await headers();
  const origin = headerStore.get('origin') || `https://${headerStore.get('host') || 'www.canarydata.media'}`;
  const session = await createCanaryCheckoutSession({
    organizationName,
    contactEmail: email,
    requestId: onboardingRequest?.id || '',
    districtId: districtId || '',
    userId: user.id || '',
    origin,
  });

  if (!session?.url) throw new Error('Stripe did not return a checkout URL.');
  redirect(session.url);
}
