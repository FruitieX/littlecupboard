"""Apply reviewed source references and privately cached photos to existing recipes.

Usage: attach-sources.py API_ORIGIN < session-token
Requires the optional sourceUrl recipe field. Ingredients and instructions are
never changed. Re-running after success performs no uploads or mutations.
"""
import json
import sys
import urllib.request
import uuid
from pathlib import Path

USER_AGENT = 'LittleCupboard/1.0'


def fetch(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={'User-Agent': USER_AGENT}), timeout=60
    ).read()


def run(origin, token):
    def api(path, body=None, content_type='application/json'):
        req = urllib.request.Request(origin.rstrip('/') + '/api/' + path, data=body,
            headers={'Cookie': 'forkbasket_session=' + token,
                     'x-littlecupboard-request': '1', 'Content-Type': content_type})
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response)

    state = api('state')['state']
    manifest = json.loads(Path(__file__).with_name('sources.json').read_text())
    changes = []
    for entry in manifest:
        matches = [r for r in state['recipeBook'] if
                   r['id'] == entry.get('recipeId') or r['name'] == entry.get('recipeName')]
        if len(matches) != 1:
            raise ValueError('Expected exactly one matching recipe: ' + entry['sourceUrl'])
        recipe = matches[0]
        if recipe.get('sourceUrl') == entry['sourceUrl']:
            continue
        changes.append(dict(collection='recipeBook', key=recipe['id'], field='sourceUrl',
                            before=recipe.get('sourceUrl'), after=entry['sourceUrl']))
        if entry.get('additionalReference') and entry['additionalReference'] not in recipe['subtitle']:
            changes.append(dict(collection='recipeBook', key=recipe['id'], field='subtitle',
                before=recipe['subtitle'], after=recipe['subtitle'] +
                '\n\nOptional later: [Homemade fish fingers](' + entry['additionalReference'] + ').'))
        if not entry.get('imageUrl'):
            continue
        data = fetch(entry['imageUrl'])
        boundary = 'LittleCupboard' + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="recipe.jpg"\r\n'
                'Content-Type: image/jpeg\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
        image = api('images', body, 'multipart/form-data; boundary=' + boundary)['url']
        changes.append(dict(collection='recipeBook', key=recipe['id'], field='image',
                            before=recipe['image'], after=image))
    if not changes:
        print('All source references already applied; no changes needed.')
        return
    request = dict(id=str(uuid.uuid4()), operation=dict(
        type='patch', label='Add recipe source references and cache matching source photos', changes=changes))
    payload = json.dumps(request).encode()
    result = api('operations', payload)
    retry = api('operations', payload)
    assert retry['revision'] == result['revision']
    for change in changes:
        recipe = next(r for r in result['state']['recipeBook'] if r['id'] == change['key'])
        assert recipe[change['field']] == change['after']
        if change['field'] == 'image':
            req = urllib.request.Request(origin.rstrip('/') + recipe['image'],
                                         headers={'Cookie': 'forkbasket_session=' + token})
            with urllib.request.urlopen(req) as response:
                assert response.headers['Content-Type'].startswith('image/')
                assert response.read()
    print('Source references and private photos verified; retry is idempotent.')


if __name__ == '__main__':
    run(sys.argv[1], sys.stdin.read().strip())
