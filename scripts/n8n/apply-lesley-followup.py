#!/usr/bin/env python3
"""Dry-run or apply the reviewed validator and recommendation guardrails to live n8n."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent
MARKER = 'CONTEXTUAL DISCLOSURE AND SENSITIVE-INCIDENT COMMUNICATIONS GUARDRAILS:'

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()[:16]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workflow-id', default=os.getenv('CANARY_N8N_NEWS_WORKFLOW_ID', 'dVIf6KnZklHYzQvi'))
    parser.add_argument('--expected-version', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()

    base = (os.getenv('N8N_BASE_URL') or os.getenv('N8N_API_URL') or '').rstrip('/')
    api_key = os.getenv('N8N_API_KEY', '')
    if not base or not api_key:
        raise RuntimeError('N8N_BASE_URL/N8N_API_URL and N8N_API_KEY are required')
    headers = {'X-N8N-API-KEY': api_key, 'Content-Type': 'application/json'}
    url = f'{base}/api/v1/workflows/{args.workflow_id}'

    response = requests.get(url, headers=headers, timeout=120)
    response.raise_for_status()
    workflow = response.json()
    if workflow.get('versionId') != args.expected_version:
        raise RuntimeError(
            f"Workflow version changed: expected {args.expected_version}, found {workflow.get('versionId')}"
        )

    validator = (ROOT / 'canary-live-validate-shadow-candidate.js').read_text()
    guardrails = (ROOT / 'canary-ai-sensitive-incident-guardrails.txt').read_text().strip()
    validator_node = next(node for node in workflow['nodes'] if node.get('name') == 'Validate Shadow Candidate')
    ai_node = next(node for node in workflow['nodes'] if node.get('name') == 'AI Analysis1')
    old_validator = validator_node['parameters']['jsCode']
    old_prompt = ai_node['parameters']['options']['system']
    if MARKER in old_prompt:
        raise RuntimeError('Guardrail marker already exists; refusing duplicate insertion')
    new_prompt = old_prompt.rstrip() + '\n\n' + guardrails + '\n'
    validator_node['parameters']['jsCode'] = validator
    ai_node['parameters']['options']['system'] = new_prompt

    result = {
        'workflow_id': args.workflow_id,
        'active_before': workflow.get('active'),
        'version_before': workflow.get('versionId'),
        'validator_before_sha': digest(old_validator),
        'validator_after_sha': digest(validator),
        'prompt_before_sha': digest(old_prompt),
        'prompt_after_sha': digest(new_prompt),
        'guardrail_words': len(guardrails.split()),
        'settings_requiring_ui': sorted(set((workflow.get('settings') or {})) & {'binaryMode'}),
        'apply': args.apply,
    }
    if not args.apply:
        print(json.dumps(result, indent=2))
        return
    if result['settings_requiring_ui']:
        raise RuntimeError(
            'Public n8n PUT cannot round-trip these live settings; apply through the authenticated n8n UI: '
            + ', '.join(result['settings_requiring_ui'])
        )

    expected_settings = workflow.get('settings') or {}
    payload = {
        'name': workflow['name'],
        'nodes': workflow['nodes'],
        'connections': workflow['connections'],
        'settings': expected_settings,
    }
    updated = requests.put(url, headers=headers, json=payload, timeout=180)
    if not updated.ok:
        raise RuntimeError(updated.text[:3000])
    activated = requests.post(f'{url}/activate', headers=headers, timeout=120)
    if not activated.ok:
        raise RuntimeError(activated.text[:3000])

    readback_response = requests.get(url, headers=headers, timeout=120)
    readback_response.raise_for_status()
    readback = readback_response.json()
    actual_validator = next(node for node in readback['nodes'] if node.get('name') == 'Validate Shadow Candidate')['parameters']['jsCode']
    actual_prompt = next(node for node in readback['nodes'] if node.get('name') == 'AI Analysis1')['parameters']['options']['system']
    if actual_validator != validator:
        raise RuntimeError('Validator readback mismatch')
    if actual_prompt != new_prompt:
        raise RuntimeError('Prompt readback mismatch')
    if readback.get('settings') != expected_settings:
        raise RuntimeError('Workflow settings readback mismatch')
    if not readback.get('active'):
        raise RuntimeError('Workflow is not active after update')
    result.update({
        'active_after': readback.get('active'),
        'version_after': readback.get('versionId'),
        'updated_at': readback.get('updatedAt'),
        'validator_readback_sha': digest(actual_validator),
        'prompt_readback_sha': digest(actual_prompt),
    })
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
