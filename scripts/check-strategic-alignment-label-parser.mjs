import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unterminated function ${name}`);
}

const context = {
  isHiddenRoadmapMetricLine: () => false,
};
vm.createContext(context);
vm.runInContext(extractFunction('normalizeEscapedRecommendationText'), context);
vm.runInContext(extractFunction('extractStrategicAlignmentLabels'), context);

const santaClaraReason = '**Pillar 1: Academic Excellence and Instructional Coherence | Pillar 4: Systems, Communication, and Accountability** – The fabrication lab at Cabrillo Middle School directly exemplifies instructional coherence through innovative, hands-on learning design.';
const labels = context.extractStrategicAlignmentLabels(santaClaraReason);
const expected = [
  'Pillar 1 Academic Excellence and Instructional Coherence',
  'Pillar 4 Systems, Communication, and Accountability',
];

if (JSON.stringify(labels) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected Santa Clara labels: ${JSON.stringify(labels)}`);
}
if (labels.some((label) => label.includes('fabrication lab'))) {
  throw new Error('Explanation leaked into Strategic Alignment focus areas');
}

const legacy = context.extractStrategicAlignmentLabels('Legacy Focus Area – supporting explanation');
if (JSON.stringify(legacy) !== JSON.stringify(['Legacy Focus Area'])) {
  throw new Error(`Legacy fallback failed: ${JSON.stringify(legacy)}`);
}

console.log('PASS strategic alignment label parser');
