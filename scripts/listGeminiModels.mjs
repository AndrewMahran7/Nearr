const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('missing_gemini_key');
const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
if (!response.ok) throw new Error(`models_http_${response.status}`);
const payload = await response.json();
console.log((payload.models ?? [])
  .map((model) => model.name)
  .filter((name) => /gemini-(2\.5-flash|3\.[0-9]+-flash)/.test(name))
  .sort()
  .join('\n'));
