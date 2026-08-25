import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectSocialMediaType, readBoundedResponseBody, socialMediaReferer } from '../src/lib/social-media-proxy.mjs';

const bytes = (...values) => new Uint8Array(values);
assert.equal(detectSocialMediaType(bytes(0xff,0xd8,0xff,0x00)), 'image/jpeg');
assert.equal(detectSocialMediaType(bytes(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)), 'image/png');
assert.equal(detectSocialMediaType(new TextEncoder().encode('GIF89a')), 'image/gif');
assert.equal(detectSocialMediaType(new TextEncoder().encode('RIFF0000WEBP')), 'image/webp');
assert.equal(detectSocialMediaType(bytes(0,0,0,24,0x66,0x74,0x79,0x70,0x61,0x76,0x69,0x66)), 'image/avif');
assert.equal(detectSocialMediaType(bytes(0,0,0,24,0x66,0x74,0x79,0x70,0x6d,0x70,0x34,0x32)), 'video/mp4');
assert.equal(detectSocialMediaType(new TextEncoder().encode('<html>blocked</html>')), '');
assert.equal(socialMediaReferer('https://scontent.xx.fbcdn.net/a.jpg'), 'https://www.facebook.com/');
assert.equal(socialMediaReferer('https://scontent.cdninstagram.com/a.jpg'), 'https://www.instagram.com/');

const jpegResponse = new Response(bytes(0xff,0xd8,0xff,0x00), { headers: { 'content-type': 'application/octet-stream' } });
assert.deepEqual([...await readBoundedResponseBody(jpegResponse, 10)], [0xff,0xd8,0xff,0x00]);
await assert.rejects(() => readBoundedResponseBody(new Response(bytes(1,2,3,4), { headers: { 'content-length':'4' } }), 3), /social_media_too_large/);

const route = await readFile(new URL('../src/app/api/social-media/route.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.match(route, /safeSocialMediaUrl\(upstream\.url\)/);
assert.match(route, /detectSocialMediaType\(buffered\)/);
assert.match(route, /readBoundedResponseBody\(upstream\)/);
assert.match(route, /\[408, 425, 429, 500, 502, 503, 504\]/);
assert.match(route, /status: 415/);
assert.match(route, /status: 502/);
assert.doesNotMatch(route, /return new Response\(upstream\.body[\s\S]*contentType\.startsWith/);
assert.match(dashboard, /function renderedSocialMediaUrl\(value\)[\s\S]*return safeUrl \|\| '';/);
assert.doesNotMatch(dashboard, /\/api\/social-media\?url=/);
assert.match(dashboard, /renderedMediaUrl = renderedSocialMediaUrl\(mediaUrl\)/);
console.log('Social media proxy resilience checks passed.');
