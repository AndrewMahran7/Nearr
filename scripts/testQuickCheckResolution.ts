import {
  claimInitialQuickCheckSearch,
  normalizeQuickCheckQuery,
  quickCheckSearchKey,
  resetInitialQuickCheckSearchesForTests,
  selectedQuickCheckCandidate,
} from '../lib/quickCheckResolution';

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  if (!condition) failures += 1;
}

resetInitialQuickCheckSearchesForTests();
const key = quickCheckSearchKey('job-1', 'manual', '  Cascade  del Mulino ');
check('query is normalized in request key', key.endsWith(':cascade del mulino'));
check('prefilled query claims initial search on mount', claimInitialQuickCheckSearch(key));
check('rerender does not search again', !claimInitialQuickCheckSearch(key));
check('screen refocus does not search again', !claimInitialQuickCheckSearch(key));
check(
  'changed query allows another search',
  claimInitialQuickCheckSearch(quickCheckSearchKey('job-1', 'manual', 'Cascade del Mulino Saturnia')),
);
check(
  'logical places have independent request keys',
  claimInitialQuickCheckSearch(quickCheckSearchKey('job-1', 'm2', 'Hotel Eden')),
);
check('normalizer collapses case and whitespace', normalizeQuickCheckQuery(' A  B ') === 'a b');

const strong = {
  googlePlaceId: 'gp-1',
  name: 'Cascate del Mulino',
  latitude: 42.65,
  longitude: 11.51,
};
check('one strong result becomes selected', selectedQuickCheckCandidate('Cascate del Mulino', [strong]) === strong);
check(
  'multiple results remain unselected',
  selectedQuickCheckCandidate('Cascate del Mulino', [strong, { ...strong, googlePlaceId: 'gp-2' }]) === null,
);
check(
  'missing coordinates cannot auto-select',
  selectedQuickCheckCandidate('Cascate del Mulino', [{ ...strong, latitude: null }]) === null,
);
check(
  'incompatible single result remains unselected',
  selectedQuickCheckCandidate('Cascate del Mulino', [{ ...strong, name: 'Hotel Eden' }]) === null,
);
check('no result preserves manual recovery', selectedQuickCheckCandidate('Cascate del Mulino', []) === null);

if (failures > 0) process.exit(1);
console.log('\nAll Quick check resolution tests passed.');
