# Retrieval decision — remain off

The complete development baseline retrieves the full accepted set among retained
candidates in 26/78 exact-positive cases; top-one complete-set recall is 24/78.
Macro place recall at N is 43.77%. Candidate absence is a major limitation, but a
new embedding model cannot recover an absent place from a gallery without that place.

The earlier [bounded local retrieval experiment](../recognition-optimization-2026-10-08/RETRIEVAL_EXPERIMENT.md)
used the cached EigenPlaces checkpoint and a small licensed Commons reference set.
It achieved 2/4 top-one and 4/4 top-three recall on other-source locality queries,
covering only two groups. Same-video controls are not independent place-recognition
evidence. These results precede the current sealed benchmark and are not rescored as
new gold-dataset results.

The accompanying geometry check incorrectly supported three of 22 different-locality
pairs. It remains disabled. No nearest-neighbor identity authorization, permanent
Google imagery index, additional model download or cloud GPU was introduced.

Current investigation prioritizes a measured schema failure that discards named
candidates before retrieval. A larger retrieval experiment would require a bounded
licensed gallery with independent views and useful exact-place coverage, followed
by verification. The prior tiny locality gallery does not justify deploying retrieval
or claiming unseen-place benefit. Jev remains optional and off.
