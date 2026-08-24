import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findDemoSocialPost } from '@/lib/demo-social-data.mjs';

export const metadata = {
  title: 'Fictional Social Post | Canary Data Demo',
  robots: { index: false, follow: false },
};

function label(value) {
  return String(value || '').replace(/\b\w/g, (character) => character.toUpperCase());
}

export default async function DemoSocialPostPage({ params }) {
  const { postId } = await params;
  const post = findDemoSocialPost(postId);
  if (!post) notFound();

  const publicInteractions = Number(post.reaction_count || 0) + Number(post.comment_count || 0) + Number(post.share_count || 0);
  const displayDate = new Date(post.published_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });

  return (
    <main className="demo-social-post-page">
      <article className="demo-social-post-shell">
        <div className="demo-social-post-notice">
          <strong>Fictional demo post</strong>
          <span>This preview uses synthetic people, organizations, dates, and performance data. It is not connected to a live social account.</span>
        </div>
        <header>
          <div>
            <span className={`social-platform-label ${post.platform}`}>{label(post.platform)}</span>
            <h1>{post.author_name}</h1>
            <p>{displayDate} · Public</p>
          </div>
          <Link href="/demo">Back to Canary Data demo</Link>
        </header>
        {post.media_url && (
          <div className="demo-social-post-media">
            {/* eslint-disable-next-line @next/next/no-img-element -- local, reviewed demo-only fixture. */}
            <img src={post.media_url} alt="Fictional social post illustration" />
          </div>
        )}
        <p className="demo-social-post-copy">{post.body}</p>
        <dl>
          <div><dt>Reactions</dt><dd>{Number(post.reaction_count || 0).toLocaleString('en-US')}</dd></div>
          <div><dt>Comments</dt><dd>{Number(post.comment_count || 0).toLocaleString('en-US')}</dd></div>
          <div><dt>Shares</dt><dd>{Number(post.share_count || 0).toLocaleString('en-US')}</dd></div>
          <div><dt>Public interactions</dt><dd>{publicInteractions.toLocaleString('en-US')}</dd></div>
        </dl>
      </article>
    </main>
  );
}
