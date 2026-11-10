"""Attach reviewed Commons photos through private uploads and undoable API patches.

Usage: attach-photos.py API_ORIGIN < session-token
Credentials are read from stdin, never printed or persisted. Existing recipe
content and photos are preserved. Run after family-meals.py has been applied.
"""
import json
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

USER_AGENT = 'LittleCupboard/1.0'


def fetch(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={'User-Agent': USER_AGENT}), timeout=60
    ).read()


def metadata(title):
    query = urllib.parse.urlencode(dict(
        action='query', format='json', prop='imageinfo',
        iiprop='url|extmetadata', iiurlwidth=800, titles='File:' + title,
    ))
    pages = json.loads(fetch('https://commons.wikimedia.org/w/api.php?' + query))['query']['pages']
    return next(iter(pages.values()))['imageinfo'][0]



def run(origin, token):
    def api(path, body=None, content_type='application/json'):
        req = urllib.request.Request(origin.rstrip('/') + '/api/' + path, data=body,
            headers={'Cookie': 'forkbasket_session=' + token,
                     'x-littlecupboard-request': '1', 'Content-Type': content_type})
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response)

    state = api('state')['state']
    manifest = json.loads(Path(__file__).with_name('photos.json').read_text())
    changes = []
    for entry in manifest:
        recipe = next(r for r in state['recipeBook'] if r['id'] == entry['recipeId'])
        if recipe['image']:
            continue  # Never replace a family's chosen photo.
        info = metadata(entry['file'])
        if info['extmetadata']['LicenseShortName']['value'] != entry['license']:
            raise ValueError('Image license changed; review the manifest before importing.')
        data = fetch(info.get('thumburl', info['url']))
        boundary = 'LittleCupboard' + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="recipe.jpg"\r\n'
                'Content-Type: image/jpeg\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
        image = api('images', body, 'multipart/form-data; boundary=' + boundary)['url']
        changes.append(dict(collection='recipeBook', key=recipe['id'], field='image',
                            before=recipe['image'], after=image))
    if not changes:
        print('No missing photos; no changes needed.')
        return
    request = dict(id=str(uuid.uuid4()), operation=dict(
        type='patch', label='Attach missing recipe photos', changes=changes))
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
    print(f'Attached and verified {len(changes)} private photos; retry is idempotent.')


if __name__ == '__main__':
    run(sys.argv[1], sys.stdin.read().strip())
