"""Idempotent household import of the reviewed family candidates.

Run after the recipe-options app version is installed. Supply API origin as the
first argument and an authenticated session token on stdin. An optional second
argument is the family's sauce-source image (uploaded privately, never bundled).
All records use a single validated, undoable /api/operations transaction.
"""
import copy
import json
from pathlib import Path
import sys
import unicodedata
import urllib.request
import uuid

ROOT = Path(__file__).parent


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c)).strip()


def prepare(state, catalog):
    batch = json.loads((ROOT / 'batch2.json').read_text())
    products = copy.deepcopy(catalog + state['customProducts'])
    changes = []
    mapping = {}
    for proposed in batch['products']:
        wanted = {normalized(proposed['name']), *(normalized(a) for a in proposed.get('aliases', []))}
        matches = [p for p in products if p['id'] == proposed['id'] or normalized(p['name']) in wanted]
        if len(matches) > 1:
            raise ValueError('Ambiguous catalog match: ' + proposed['name'])
        if matches:
            mapping[proposed['id']] = matches[0]['id']
        else:
            products.append(proposed)
            mapping[proposed['id']] = proposed['id']
            changes.append(dict(collection='customProducts', key=proposed['id'], field=None, before=None, after=proposed))
    known = {p['id'] for p in products}

    def resolve(value):
        if isinstance(value, list):
            for child in value:
                resolve(child)
        elif isinstance(value, dict):
            if 'productId' in value:
                pid = value['productId']
                if pid.startswith('@'):
                    matches = [p for p in products if normalized(p['name']) == normalized(pid[1:]) or any(normalized(a) == normalized(pid[1:]) for a in p.get('aliases', []))]
                    if len(matches) != 1:
                        raise ValueError('Ingredient needs review: ' + pid)
                    pid = matches[0]['id']
                value['productId'] = mapping.get(pid, pid)
                if value['productId'] not in known:
                    raise ValueError('Unknown ingredient: ' + pid)
            for child in value.values():
                if isinstance(child, (dict, list)):
                    resolve(child)
    existing = {r['id']: r for r in state['recipeBook']}
    additions = []
    for entry in batch['recipes']:
        if entry['recipe']['id'] not in existing:
            entry = copy.deepcopy(entry)
            resolve(entry['recipe'])
            additions.append(entry)
    updates = []
    for rid, fields in {
        'family-meals-wraps': dict(variantGroup='tortillat', variantLabel='Broileri'),
        'family-meals-salmon-pasta': dict(variantGroup='kermainen-pasta', variantLabel='Lohi'),
        'family-meals-macaroni': dict(makesLeftovers=True),
        'family-meals-chicken-tray': dict(variantGroup='uunipelti', variantLabel='Broileri'),
    }.items():
        if rid in existing:
            old = existing[rid]
            new = copy.deepcopy(old)
            for key, value in fields.items():
                if key not in new:
                    new[key] = value
            if old != new:
                updates.append((old, new))
    rid = 'family-meals-fish-fingers'
    if rid not in existing:
        raise ValueError('The existing fish sticks recipe is required.')
    old = existing[rid]
    if not any(g['id'] == 'sauce' for g in old.get('optionGroups', [])):
        new = copy.deepcopy(old)
        sauce = copy.deepcopy(batch['fishStickSauce'])
        resolve(sauce)
        new['optionGroups'] = [*new.get('optionGroups', []), sauce]
        updates.append((old, new))
    return changes, additions, updates


def run(origin, token, sauce_source=None):
    origin = origin.rstrip('/')
    def api(path, payload=None, mime='application/json'):
        req = urllib.request.Request(origin + '/api/' + path, data=payload,
            headers={'Cookie': 'forkbasket_session=' + token, 'x-littlecupboard-request': '1', 'Content-Type': mime})
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()) from None

    def upload(data, source=False):
        boundary = 'LittleCupboard' + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="recipe.png"\r\n'
                'Content-Type: application/octet-stream\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
        return api('images' + ('?source=true' if source else ''), body, 'multipart/form-data; boundary=' + boundary)['url']

    before = api('state')['state']
    catalog = json.loads((ROOT.parents[1] / 'backend' / 'seed.json').read_text())['catalog']
    changes, additions, updates = prepare(before, catalog)
    if not changes and not additions and not updates:
        print('Already imported: no uploads or mutations.')
        return before
    for entry in additions:
        asset = ROOT / entry['imageAsset']
        data = asset.read_bytes() if asset.exists() else asset.with_suffix('.png').read_bytes()
        entry['recipe']['image'] = upload(data)
        req = urllib.request.Request(origin + entry['recipe']['image'], headers={'Cookie': 'forkbasket_session=' + token})
        with urllib.request.urlopen(req, timeout=30) as response:
            if not response.headers['Content-Type'].startswith('image/'):
                raise ValueError('An uploaded image did not load.')
            # Retain the app's encoded image for reproducible future imports.
            asset.parent.mkdir(exist_ok=True)
            encoded = response.read()
            if not asset.exists():
                asset.write_bytes(encoded)
        recipe = entry['recipe']
        changes.append(dict(collection='recipeBook', key=recipe['id'], field=None, before=None, after=recipe))
    for old, new in updates:
        if old['id'] == 'family-meals-fish-fingers' and sauce_source and len(new.get('sourceImages', [])) < 4:
            new['sourceImages'] = [*new.get('sourceImages', []), dict(url=upload(sauce_source, True), name='Grillimestarin kastikkeet.png')]
        changes.append(dict(collection='recipeBook', key=old['id'], field=None, before=old, after=new))
    payload = json.dumps(dict(id=str(uuid.uuid4()), operation=dict(type='patch', label='Add family meal candidates and optional fish sticks sauce', changes=changes))).encode()
    result = api('operations', payload)
    assert api('operations', payload)['revision'] == result['revision']
    after = result['state']
    for key in before:
        if key not in ['customProducts', 'recipeBook']:
            assert before[key] == after[key], key
    assert len(after['recipeBook']) == len(before['recipeBook']) + len(additions)
    previous = {r['id']: r for r in before['recipeBook']}
    changed = {new['id'] for _, new in updates}
    for recipe in after['recipeBook']:
        if recipe['id'] in previous:
            old = previous[recipe['id']]
            if recipe['id'] not in changed:
                assert recipe == old
            else:
                for key in ['ingredients', 'steps', 'servings', 'image', 'name', 'sourceUrl']:
                    assert recipe.get(key) == old.get(key), key
    assert not any(prepare(after, catalog))
    print(f'Inserted {len(additions)} recipes, updated {len(updates)} existing recipes; images and references attached; prior recipes, preferences and meal plans preserved. Retry and repeat import are idempotent.')
    return after


if __name__ == '__main__':
    run(sys.argv[1], sys.stdin.read().strip(), Path(sys.argv[2]).read_bytes() if len(sys.argv) > 2 else None)
