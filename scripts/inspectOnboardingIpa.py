"""Read the downloaded Development IPA; emit only non-secret qualification data."""
import hashlib, json, plistlib, re, sys, zipfile
from pathlib import Path

ipa = Path(sys.argv[1])
expected_build = sys.argv[2] if len(sys.argv) > 2 else '72'
output_path = Path(sys.argv[3]) if len(sys.argv) > 3 else Path('artifacts/global-release/onboarding-integration/ipa-verification.json')
with zipfile.ZipFile(ipa) as z:
    names = z.namelist()
    host = next(n[:-len('Info.plist')] for n in names if re.fullmatch(r'Payload/[^/]+\.app/Info.plist', n))
    extension = next(n[:-len('Info.plist')] for n in names if n.startswith(host + 'PlugIns/') and n.endswith('.appex/Info.plist'))
    def inspect(prefix):
        info = plistlib.loads(z.read(prefix + 'Info.plist'))
        raw = z.read(prefix + 'embedded.mobileprovision')
        profile = plistlib.loads(raw[raw.index(b'<?xml'):raw.index(b'</plist>') + 8])
        executable = z.read(prefix + info['CFBundleExecutable'])
        locales = sorted(set(n[len(prefix):].split('/')[0][:-6] for n in names if n.startswith(prefix) and re.match(r'[^/]+\.lproj/', n[len(prefix):])))
        ent = profile['Entitlements']
        return {
            'bundleIdentifier': info['CFBundleIdentifier'], 'build': info['CFBundleVersion'],
            'version': info['CFBundleShortVersionString'], 'locales': locales,
            'signatureResourcesPresent': prefix + '_CodeSignature/CodeResources' in names,
            'datePickerSymbolsPresent': b'RNDateTimePicker' in executable,
            'provisioning': {'applicationIdentifier': ent['application-identifier'],
                'team': ent['com.apple.developer.team-identifier'],
                'appGroups': ent.get('com.apple.security.application-groups', []),
                'registeredDeviceCount': len(profile.get('ProvisionedDevices', [])),
                'expires': profile['ExpirationDate'].isoformat()},
            'iconFiles': info.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {}).get('CFBundleIconFiles', []),
            'assetsCatalogPresent': prefix + 'Assets.car' in names,
        }
    result = {'ipaSha256': hashlib.file_digest(ipa.open('rb'), 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hashlib.sha256(ipa.read_bytes()).hexdigest(),
        'host': inspect(host), 'shareExtension': inspect(extension),
        'signatureVerificationLimit': 'CodeResources and embedded profiles inspected. No macOS codesign verification or physical installation was performed on this Windows host.'}
    result['embeddedConfiguration'] = {}
    for target, prefix in [('host', host), ('shareExtension', extension)]:
        config = json.loads(z.read(prefix + 'EXConstants.bundle/app.config'))
        extra = config.get('extra', {})
        result['embeddedConfiguration'][target] = {k:v for k,v in extra.items() if k in ['appEnv', 'backendEnv', 'supabaseUrl', 'eas']}
        assert extra['appEnv'] == extra['backendEnv'] == 'development'
        assert extra['supabaseUrl'] == 'https://qnfxnmvxpjzfydgudtvs.supabase.co'
    result['hostEmbeddedJavaScript'] = host + 'main.jsbundle' in names
    result['extensionEmbeddedJavaScript'] = extension + 'main.jsbundle' in names
    for n in names:
        if n.startswith(host) and n.endswith('/Expo.plist'):
            p = plistlib.loads(z.read(n))
            result['expo'] = {k:v for k,v in p.items() if k in ['EXUpdatesRuntimeVersion', 'EXUpdatesURL', 'EXUpdatesEnabled', 'EXUpdatesRequestHeaders']}
        if n == host + 'app.manifest':
            manifest = json.loads(z.read(n))
            config = manifest.get('extra', {}).get('expoClient', manifest)
            extra = config.get('extra', {})
            result['embeddedConfiguration'] = {k:v for k,v in extra.items() if k in ['appEnv', 'backendEnv', 'supabaseUrl', 'eas']}
    print(json.dumps(result, indent=2))
    assert result['host']['bundleIdentifier'] == 'com.nearr.ios'
    assert result['shareExtension']['bundleIdentifier'] == 'com.nearr.ios.ShareExtension'
    assert result['host']['build'] == result['shareExtension']['build'] == expected_build
    assert result['host']['version'] == result['shareExtension']['version'] == '1.7.0'
    assert result['host']['datePickerSymbolsPresent']
    assert result['host']['signatureResourcesPresent'] and result['shareExtension']['signatureResourcesPresent']
    required = {'en-US','es-MX','es-ES','pt-BR','fr','de','it','ja','ko','zh-Hans'}
    assert required.issubset(result['host']['locales']) and required.issubset(result['shareExtension']['locales'])
    assert result['expo']['EXUpdatesRuntimeVersion'] == '1.7-onboarding-date-v1'
    assert result['expo']['EXUpdatesRequestHeaders']['expo-channel-name'] == 'development'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + '\n')
