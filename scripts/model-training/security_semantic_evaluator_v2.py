"""Score frozen V1 generations as V2 semantic evidence without changing raw evidence."""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ONTOLOGY = json.loads((REPO_ROOT / 'packages/desktop/src/process/services/security/security-ontology-v1.json').read_text(encoding='utf-8'))
REASON_RISK = ONTOLOGY['reasonCodeRiskType']
SEMANTIC_FIELDS = ('riskType', 'reasonCode', 'requiresBackendValidation', 'redactions')

def canonical(value):
    return sorted(value) if isinstance(value, list) else value

def semantic_projection(value):
    if not isinstance(value, dict):
        return None
    return {field: value.get(field) for field in SEMANTIC_FIELDS}

def schema_valid(value):
    projected = semantic_projection(value)
    if projected is None:
        return False
    return (
        projected['riskType'] in ONTOLOGY['riskTypes']
        and projected['reasonCode'] in ONTOLOGY['reasonCodes']
        and REASON_RISK.get(projected['reasonCode']) == projected['riskType']
        and projected['requiresBackendValidation'] is True
        and isinstance(projected['redactions'], list)
        and all(item in ONTOLOGY['redactions']['allowedValues'] for item in projected['redactions'])
        and len(projected['redactions']) == len(set(projected['redactions']))
    )

def evaluate(rows):
    totals = Counter()
    matrices = {field: defaultdict(Counter) for field in SEMANTIC_FIELDS}
    groups = defaultdict(lambda: defaultdict(Counter))
    for row in rows:
        expected = semantic_projection(row.get('expected', {}))
        predicted = semantic_projection(row.get('predicted', {}))
        valid = schema_valid(row.get('predicted', {}))
        totals['rows'] += 1
        totals['schemaValid'] += int(valid)
        full = True
        for field in SEMANTIC_FIELDS:
            match = canonical(expected.get(field)) == canonical(predicted.get(field)) if expected and predicted else False
            totals[field + 'Exact'] += int(match)
            matrices[field][str(expected.get(field) if expected else None)][str(predicted.get(field) if predicted else None)] += 1
            full = full and match
        totals['semanticFullExact'] += int(full)
        for dimension in ('language', 'scenarioFamily', 'reasonCode'):
            key = str(row.get(dimension, 'unknown'))
            groups[dimension][key]['rows'] += 1
            groups[dimension][key]['schemaValid'] += int(valid)
            groups[dimension][key]['semanticFullExact'] += int(full)
    rows_count = totals['rows'] or 1
    metrics = {key: value / rows_count for key, value in totals.items() if key not in {'rows', 'schemaValid'}}
    metrics['schemaValid'] = totals['schemaValid'] / rows_count
    return {
        'schemaVersion': 'tomny.security-semantic-evaluator.v2',
        'status': 'IMPLEMENTED',
        'sourceGenerationContract': 'tomny.security.output.v1 compatibility projection',
        'redactionsSemantics': 'UNORDERED_CANONICAL',
        'fields': list(SEMANTIC_FIELDS),
        'totals': dict(totals),
        'metrics': metrics,
        'confusionMatrices': {field: {key: dict(value) for key, value in matrix.items()} for field, matrix in matrices.items()},
        'groupMetrics': {dimension: {key: dict(group) for key, group in values.items()} for dimension, values in groups.items()},
    }

if __name__ == '__main__':
    obj = json.loads(sys.stdin.read())
    rows = obj.get('rows', []) if isinstance(obj, dict) else obj
    print(json.dumps(evaluate(rows), indent=2))