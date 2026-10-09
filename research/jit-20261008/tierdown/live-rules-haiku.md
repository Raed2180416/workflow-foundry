# Tier-down e2e: judge `rules` ["claude-opus-5-5"] -> ["claude-haiku-5-5"]

- arm: `jit-dev-records-1/jit-claude-sonnet-5-5--claude-haiku-5-5` (records, split dev); version `v1-haiku55` sha 3d8d9cc29cd9
- variant sha d3bfaca85c20; scope: one judge; sites: line 293
- original: archived run reused where it ran this sha, otherwise fresh; live spend $0.0491 of cap $0.75
- dev split, K=1 per task: development evidence only; a gap of one or two tasks is noise.

| idx | task | original | variant | exact | partial | judge $ orig | judge $ var | total $ orig | total $ var | oracle orig | oracle var |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | records:dev:d3:s204 | cap reached during the run: excluded | | | | | | | | | |
| 4 | records:dev:d3:s205 | ok* | ok | yes | 1.000 | $0.0341 | $0.0014 | $0.0389 | $0.0061 | fail 0.924 | fail 0.924 |
| 5 | records:dev:d3:s206 | ok* | ok | yes | 1.000 | $0.0346 | $0.0014 | $0.0395 | $0.0066 | PASS 1.000 | PASS 1.000 |
| 6 | records:dev:d3:s207 | ok* | ok | yes | 1.000 | $0.0337 | $0.0014 | $0.0379 | $0.0054 | PASS 1.000 | PASS 1.000 |
| 7 | records:dev:d3:s208 | ok* | ok | no | 0.848 | $0.0341 | $0.0014 | $0.0377 | $0.0054 | PASS 1.000 | fail 0.776 |
| 8 | records:dev:d3:s209 | ok* | ok | yes | 1.000 | $0.0339 | $0.0014 | $0.0391 | $0.0063 | PASS 1.000 | PASS 1.000 |
| 9 | records:dev:d3:s210 | ok* | ok | no | 0.997 | $0.0335 | $0.0016 | $0.0385 | $0.0067 | PASS 0.998 | PASS 1.000 |
| 10 | records:dev:d3:s211 | ok* | ok | yes | 1.000 | $0.0339 | $0.0014 | $0.0393 | $0.0067 | PASS 1.000 | PASS 1.000 |

`*` = archived original run reused.

| metric | original | variant |
|---|---|---|
| statuses | {"ok":7} | {"ok":7} |
| oracle pass | 6/7 | 5/7 |
| oracle mean score | 0.988922 | 0.957104 |
| judge $ (total / mean) | $0.2379 / $0.0340 | $0.0100 / $0.0014 |
| run $ (total / mean) | $0.2710 / $0.0387 | $0.0432 / $0.0062 |
| judge tiers used | {"claude-opus-5-5":7} | {"claude-haiku-5-5":7} |

Answer agreement: exact 5/7 where both ran ok (5 ignoring array order), 5/7 of all compared; mean partial 0.977851. Transitions {"ok->ok":7}. Oracle flips: pass->fail 1, fail->pass 0; mean score delta -0.031818; judge $ delta $-0.2278; run $ delta $-0.2278.
