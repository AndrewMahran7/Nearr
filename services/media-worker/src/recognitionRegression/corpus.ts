import { RECOGNITION_CATEGORIES, type RecognitionCategory, type RegressionCorpusCase } from './types.js';

const CATEGORY_ALIASES: Record<string, RecognitionCategory> = {
  food: 'FOOD_RESTAURANT',
  restaurant: 'FOOD_RESTAURANT',
  restaurants: 'FOOD_RESTAURANT',
  'food-restaurant': 'FOOD_RESTAURANT',
  cliff: 'CLIFF_JUMPING',
  cliffs: 'CLIFF_JUMPING',
  'cliff-jumping': 'CLIFF_JUMPING',
  hiking: 'HIKING_TRAIL',
  trail: 'HIKING_TRAIL',
  trails: 'HIKING_TRAIL',
  landmark: 'LANDMARK',
  landmarks: 'LANDMARK',
  travel: 'TRAVEL_DESTINATION',
  destination: 'TRAVEL_DESTINATION',
};

export function parseCategory(value: string): RecognitionCategory {
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  const direct = RECOGNITION_CATEGORIES.find((item) => item.toLowerCase().replace(/_/g, '-') === normalized);
  const category = direct ?? CATEGORY_ALIASES[normalized];
  if (!category) throw new Error(`unknown_recognition_category:${value}`);
  return category;
}

export function validateCorpus(cases: RegressionCorpusCase[]): void {
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.caseId)) throw new Error(`duplicate_case_id:${item.caseId}`);
    ids.add(item.caseId);
    if (!RECOGNITION_CATEGORIES.includes(item.category)) throw new Error(`invalid_category:${item.caseId}`);
    if (!/^https:\/\//.test(item.sourceUrl)) throw new Error(`invalid_source_url:${item.caseId}`);
  }
  const missing = RECOGNITION_CATEGORIES.filter((category) => !cases.some((item) => item.category === category));
  if (missing.length) throw new Error(`missing_required_categories:${missing.join(',')}`);
}

export function selectCorpus(cases: RegressionCorpusCase[], category: RecognitionCategory | null): RegressionCorpusCase[] {
  validateCorpus(cases);
  return category ? cases.filter((item) => item.category === category) : [...cases];
}
