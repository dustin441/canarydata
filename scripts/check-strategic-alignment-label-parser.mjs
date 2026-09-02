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
vm.runInContext(extractFunction('normalizeStrategicAlignmentDisplayText'), context);
vm.runInContext(extractFunction('formatStrategicAlignmentLabel'), context);
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

const alabasterReason = '**Maintain a variety of adaptable learning experiences that meet the needs of all students to equip them with the skills to be college and career ready** – The AI robot initiative supports adaptable instruction. **Lead the way in recruiting, hiring, growing, and retaining qualified personnel who continually improve practices in order to meet all student needs** – Staff are implementing an emerging instructional tool.';
const alabasterLabels = context.extractStrategicAlignmentLabels(alabasterReason);
const expectedAlabasterLabels = [
  'Maintain a variety of adaptable learning experiences that meet the needs of all students to equip them with the skills to be college and career ready',
  'Lead the way in recruiting, hiring, growing, and retaining qualified personnel who continually improve practices in order to meet all student needs',
];
if (JSON.stringify(alabasterLabels) !== JSON.stringify(expectedAlabasterLabels)) {
  throw new Error(`Long official Alabaster priorities were dropped: ${JSON.stringify(alabasterLabels)}`);
}

const legacy = context.extractStrategicAlignmentLabels('Legacy Focus Area – supporting explanation');
if (JSON.stringify(legacy) !== JSON.stringify(['Legacy Focus Area'])) {
  throw new Error(`Legacy fallback failed: ${JSON.stringify(legacy)}`);
}

const singleInline = '**Safe and Supportive Schools:** The district documented a new safety practice.';
if (context.normalizeStrategicAlignmentDisplayText(singleInline) !== '**Safe and Supportive Schools**\nThe district documented a new safety practice.') {
  throw new Error('Single inline Strategic Alignment did not receive heading/body hierarchy.');
}

const multiInline = '**Academic Excellence** – The literacy initiative advances instruction.\n\n**Community Trust:** The district published measurable progress.';
if (context.normalizeStrategicAlignmentDisplayText(multiInline) !== '**Academic Excellence**\nThe literacy initiative advances instruction.\n\n**Community Trust**\nThe district published measurable progress.') {
  throw new Error('Multiple Strategic Alignments did not preserve consistent heading/body hierarchy.');
}

if (context.normalizeStrategicAlignmentDisplayText('N/A') !== 'N/A') {
  throw new Error('N/A Strategic Alignment changed unexpectedly.');
}

console.log('PASS strategic alignment label parser and display hierarchy');
