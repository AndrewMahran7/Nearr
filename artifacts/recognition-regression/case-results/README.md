# Case result artifacts

The live/deterministic reporters write one bounded JSON file per failed scorable case here.

Each file contains normalized top-three candidates, version/evidence metadata, frame hashes when available, API/cost/latency counters, strict recall classification, and separate autosave safety classification. Raw private transcripts and chain-of-thought are never stored.
