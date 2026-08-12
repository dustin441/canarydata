'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewSocialDiscoveryCandidate } from '@/app/actions';

const label=(value)=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
const date=(value)=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)):'Unknown date';

export default function SocialDiscoveryReviewClient({districtId,candidates=[],available=false}){
 const router=useRouter();const[pending,startTransition]=useTransition();const[error,setError]=useState('');
 function review(candidate,action){
  const verb=action==='approve'?'approve this candidate for the client Social feed':'reject this candidate';
  const note=window.prompt(`Why do you want to ${verb}?`);
  if(!note?.trim())return;
  setError('');startTransition(async()=>{try{
   await reviewSocialDiscoveryCandidate({districtId,candidateId:candidate.id,action,expectedVersion:candidate.review_version,reviewerNote:note,idempotencyKey:crypto.randomUUID()});router.refresh();
  }catch(err){setError(err?.message||'Unable to review candidate.');}});
 }
 return <section className="affiliate-admin-panel social-discovery-review-panel">
  <div><span>Human approval gate</span><h2>Pending public Social discoveries</h2><p>Provider discoveries remain server-only until a Canary administrator approves an exact candidate. Rejection keeps it out of client reporting.</p></div>
  {!available?<p className="social-affiliate-message">Candidate staging is not active in production yet. The provider workflows remain paused.</p>:
   !candidates.length?<p>No pending candidates for this district.</p>:<div className="social-discovery-candidate-list">{candidates.map((candidate)=>{const item=candidate.candidate_payload||{};return <article key={candidate.id}>
    <header><div><strong>{String(item.headline||item.body||'Public Social candidate').slice(0,180)}</strong><span>{item.author_name||item.author_handle||'Public author'} · {label(candidate.platform)} · {date(item.published_at)}</span></div><small>Pending · version {candidate.review_version}</small></header>
    <p>{String(item.body||'').slice(0,500)}</p><div className="social-discovery-evidence"><span>{label(candidate.relationship_type)}</span><span>Provider: {label(candidate.provider)}</span><span>Last seen: {date(candidate.last_seen_at)}</span></div>
    <div className="social-discovery-actions"><a href={candidate.canonical_url} target="_blank" rel="noreferrer">Open source</a><button disabled={pending} onClick={()=>review(candidate,'reject')}>Reject</button><button className="btn btn-primary" disabled={pending} onClick={()=>review(candidate,'approve')}>Approve for client feed</button></div>
   </article>})}</div>}
  {error&&<p className="social-affiliate-message error" role="alert">{error}</p>}
 </section>;
}
