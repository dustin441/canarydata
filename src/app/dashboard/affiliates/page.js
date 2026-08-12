import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDistricts, getSocialAffiliateClaims, getSocialSources } from '@/lib/data';
import AffiliateAccountsClient from './AffiliateAccountsClient';
export default async function AffiliateAccountsPage({searchParams}){
 const params=await searchParams;const session=await createClient();const{data:{user:sessionUser}}=await session.auth.getUser();
 if(!sessionUser?.id)redirect('/login?redirect_to=/dashboard/affiliates');
 const admin=createAdminClient();const{data:{user}}=await admin.auth.admin.getUserById(sessionUser.id);if(user?.app_metadata?.role!=='admin')redirect('/dashboard');
 const districts=await getDistricts();const requested=typeof params?.districtId==='string'?params.districtId:null;const districtId=requested&&districts.some(d=>d.id===requested)?requested:null;const district=districts.find(d=>d.id===districtId);
 const [accounts,claims]=districtId?await Promise.all([getSocialSources(districtId),getSocialAffiliateClaims(districtId)]):[[],[]];
 return <AffiliateAccountsClient districtId={districtId} districtName={district?.name||'Selected district'} districts={districts} accounts={accounts} claims={claims}/>;
}
