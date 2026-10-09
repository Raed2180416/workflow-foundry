# Tier-down e2e: judge `rules` ["claude-opus-5-5"] -> ["claude-sonnet-5-5"]

- arm: `jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5` (records, split dev); version `v1-haiku55` sha 3d8d9cc29cd9
- variant sha a2a1a87b65c1; scope: one judge; sites: line 293
- original: archived run reused where it ran this sha, otherwise fresh; live spend $0.1931 of cap $0.75
- dev split, K=1 per task: development evidence only; a gap of one or two tasks is noise.

| idx | task | original | variant | exact | partial | judge $ orig | judge $ var | total $ orig | total $ var | oracle orig | oracle var |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | records:dev:d3:s204 | ok* | ok | yes | 1.000 | $0.0342 | $0.0219 | $0.0380 | $0.0243 | PASS 1.000 | PASS 1.000 |
| 4 | records:dev:d3:s205 | ok* | ok | yes | 1.000 | $0.0341 | $0.0153 | $0.0389 | $0.0187 | fail 0.924 | fail 0.924 |
| 5 | records:dev:d3:s206 | ok* | ok | no | 0.974 | $0.0346 | $0.0148 | $0.0395 | $0.0553 | PASS 1.000 | fail 0.948 |
| 6 | records:dev:d3:s207 | ok* | ok | no | 0.908 | $0.0337 | $0.0151 | $0.0379 | $0.0179 | PASS 1.000 | fail 0.902 |
| 7 | records:dev:d3:s208 | ok* | ok | no | 0.848 | $0.0341 | $0.0180 | $0.0377 | $0.0205 | PASS 1.000 | fail 0.776 |
| 8 | records:dev:d3:s209 | ok* | ok | no | 0.974 | $0.0339 | $0.0151 | $0.0391 | $0.0187 | PASS 1.000 | fail 0.964 |
| 9 | records:dev:d3:s210 | ok* | ok | no | 0.997 | $0.0335 | $0.0152 | $0.0385 | $0.0185 | PASS 0.998 | PASS 1.000 |
| 10 | records:dev:d3:s211 | ok* | ok | yes | 1.000 | $0.0339 | $0.0154 | $0.0393 | $0.0192 | PASS 1.000 | PASS 1.000 |

`*` = archived original run reused.

| metric | original | variant |
|---|---|---|
| statuses | {"ok":8} | {"ok":8} |
| oracle pass | 7/8 | 3/8 |
| oracle mean score | 0.990307 | 0.939222 |
| judge $ (total / mean) | $0.2721 / $0.0340 | $0.1308 / $0.0163 |
| run $ (total / mean) | $0.3090 / $0.0386 | $0.1931 / $0.0241 |
| judge tiers used | {"claude-opus-5-5":8} | {"claude-sonnet-5-5":8} |

Answer agreement: exact 3/8 where both ran ok (3 ignoring array order), 3/8 of all compared; mean partial 0.962557. Transitions {"ok->ok":8}. Oracle flips: pass->fail 4, fail->pass 0; mean score delta -0.051084; judge $ delta $-0.1413; run $ delta $-0.1159.
