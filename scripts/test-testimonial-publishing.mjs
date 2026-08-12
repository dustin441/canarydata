import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [home, demo] = await Promise.all([
  readFile(new URL('../src/app/page.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8'),
]);

const approved = [
  {
    name: 'Dr. Avis Williams',
    role: 'Founder and CEO, Joyful Collaborative, LLC',
    quote: 'Canary Data gives district leaders an objective, data driven way to see how communication is actually supporting board priorities and strategic goals.',
  },
  {
    name: 'Kenon A. Brown, Ph.D.',
    role: 'Professor and Director of Research and Creative Enterprises, The University of Alabama',
    quote: 'Canary Data doesn’t just tell you what you want to hear. It gives you advice that will guide you to the right decisions.',
  },
  {
    name: 'Terry Roller',
    role: 'Former Superintendent & Assistant State Superintendent (Alabama)',
    quote: 'Canary Data is incredibly powerful. It gives school leaders an easy, effective way to see how well they’re communicating what matters most, how their dollars are following those priorities—and to show their board how that work aligns with the district’s goals.',
  },
];

for (const testimonial of approved) {
  for (const [surface, source] of [['homepage', home], ['demo', demo]]) {
    assert.equal(source.split(testimonial.name).length - 1, 1, `${testimonial.name} must appear exactly once on the ${surface}`);
    assert.ok(source.includes(testimonial.role), `${testimonial.name} must use the approved attribution on the ${surface}`);
    assert.ok(source.includes(testimonial.quote), `${testimonial.name} must use the approved verbatim excerpt on the ${surface}`);
  }
}

for (const existingName of ['Nicole Wheeler', 'Cindy Warner', 'Merrick Wilson']) {
  assert.ok(home.includes(existingName), `${existingName} must remain on the homepage`);
  assert.ok(demo.includes(existingName), `${existingName} must remain on the demo`);
}
assert.ok(home.includes('Shayla Canaday, PhD'), 'Shayla Canaday must remain on the homepage');
assert.match(home, /testimonials\.map\(\(testimonial\) =>/, 'homepage must render its testimonial collection');
assert.match(demo, /DEMO_TESTIMONIALS\.map\(\(testimonial\) =>/, 'demo must render its testimonial collection');

console.log('Approved testimonial publishing checks passed.');