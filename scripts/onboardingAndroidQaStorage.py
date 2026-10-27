"""Inspect/reset ONLY the synthetic local eligibility answer on the QA emulator.

Never runs against a physical device or a database with a persisted auth session.
Does not print arbitrary storage values. Backups stay in ignored local scratch.
"""
import json, sqlite3, subprocess, sys, time
from pathlib import Path
adb = str(Path.home() / 'AppData/Local/Android/Sdk/platform-tools/adb.exe')
prefix = [adb, '-s', 'emulator-5554']
def run(*args):
    return subprocess.check_output(prefix + list(args))
action = sys.argv[1]
assert action in ('inspect', 'reset-synthetic')
run('shell', 'am', 'force-stop', 'com.nearr.app')
directory = Path('.tmp/onboarding-integration')
directory.mkdir(parents=True, exist_ok=True)
backup = directory / ('qa-storage-' + str(time.time_ns()) + '.sqlite')
backup.write_bytes(run('exec-out', 'run-as', 'com.nearr.app', 'cat', 'databases/RKStorage'))
db = sqlite3.connect(backup)
rows = dict(db.execute('SELECT key,value FROM catalystLocalStorage'))
assert not any('auth-token' in key and value and value != 'null' for key, value in rows.items()), 'A persisted session requires manual QA instead of this reset'
assert not rows.get('nearr.globalEligibility.owner.v1'), 'An owned declaration must never be reset here'
raw = rows.get('nearr.globalEligibility.v1')
answer = json.loads(raw) if raw else None
print(json.dumps({'answer': answer, 'locale': rows.get('nearr.locale.v1'), 'persistedAuthSession': False}))
if action == 'reset-synthetic':
    assert answer in ({'ageBand': '18_plus', 'countryCode': 'US'}, {'ageBand': 'under_13', 'countryCode': 'US'}), 'Only answers deliberately created during this QA may be removed'
    working = directory / 'qa-storage-reset.sqlite'
    out = sqlite3.connect(working)
    db.backup(out)
    out.execute('DELETE FROM catalystLocalStorage WHERE key=?', ('nearr.globalEligibility.v1',))
    out.commit()
    assert dict(out.execute('SELECT key,value FROM catalystLocalStorage')) == {k:v for k,v in rows.items() if k != 'nearr.globalEligibility.v1'}
    out.close()
    run('push', str(working), '/data/local/tmp/nearr-onboarding-qa-storage.sqlite')
    run('shell', 'run-as', 'com.nearr.app', 'cp', '/data/local/tmp/nearr-onboarding-qa-storage.sqlite', 'databases/RKStorage')
    print('Removed only the synthetic, unowned local eligibility answer; other storage preserved. Local backup retained.')
db.close()
