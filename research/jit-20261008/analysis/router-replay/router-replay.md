### records

| policy | decision | pass /24 | cost $ |
|---|---|---|---|
| fixed: Haiku agent | — | 15.00 | 2.46 |
| fixed: Sonnet agent | — | 13.00 | 7.05 |
| fixed: Opus agent | — | 24.00 | 13.54 |
| fixed: JIT H/H (19 tasks, scaled) | — | 13.33 | 4.09 |
| fixed: JIT S/H | — | 22.00 | 8.99 |
| fixed: JIT O/H | — | 18.00 | 7.53 |
| fixed: static C0 (build cost excluded) | — | 16.00 | 1.21 |
| v0 H s=0 | interpret every task | 15.00 | 2.46 |
| v0 H s=0.5 | interpret every task | 15.00 | 2.46 |
| v0 H s=1 | interpret every task | 15.00 | 2.46 |
| v0 S s=0 | compile at task 2 | 20.88 | 9.23 |
| v0 S s=0.5 | interpret every task | 13.00 | 7.05 |
| v0 S s=1 | interpret every task | 13.00 | 7.05 |
| v0 O s=0 | compile at task 2 | 18.50 | 8.20 |
| v0 O s=0.5 | compile at task 4 | 19.00 | 8.88 |
| v0 O s=1 | compile at task 5 | 19.25 | 9.21 |

| V | best fixed (all) | best agent-every-time | best fixed JIT | best v0 | clairvoyant one-switch bound | v1 (λ, prior, feedback) | v1 net value | regret vs best fixed | vs best agent | vs best JIT | vs best v0 | P(v1 > best of agent & JIT) | v1 buys a compile |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=0.25, inherit, oracle | -0.96 | 1.35 | -0.00 | -1.80 | -0.00 | 0.423 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=0.25, inherit, none | -0.96 | 1.35 | -0.00 | -1.80 | -0.00 | 0.419 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=0.25, uniform, oracle | -0.95 | 1.34 | -0.01 | -1.80 | -0.01 | 0.428 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=0.25, uniform, none | -0.96 | 1.35 | -0.00 | -1.80 | -0.00 | 0.426 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=0.5, inherit, oracle | -0.96 | 1.35 | -0.00 | -1.80 | -0.00 | 0.425 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=0.5, inherit, none | -0.95 | 1.34 | -0.01 | -1.81 | -0.01 | 0.439 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=0.5, uniform, oracle | -0.96 | 1.35 | 0.00 | -1.80 | 0.00 | 0.419 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=0.5, uniform, none | -0.96 | 1.35 | 0.00 | -1.80 | 0.00 | 0.417 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=1, inherit, oracle | -0.96 | 1.35 | 0.00 | -1.80 | 0.00 | 0.413 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=1, inherit, none | -0.96 | 1.35 | -0.00 | -1.80 | -0.00 | 0.428 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=1, uniform, oracle | -0.96 | 1.35 | -0.00 | -1.80 | -0.00 | 0.419 | 0 |
| 0.1 | static C0 (build cost excluded) 0.39 | Haiku agent -0.96 | JIT H/H (19 tasks, scaled) -2.76 | v0 H s=0 -0.96 | -0.96 | λ=1, uniform, none | -0.96 | 1.35 | 0.00 | -1.80 | 0.00 | 0.408 | 0 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=0.25, inherit, oracle | 10.64 | 4.15 | 1.90 | 2.37 | 1.90 | 0.219 | 0.219 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=0.25, inherit, none | 12.60 | 2.19 | -0.06 | 0.41 | -0.06 | 0.433 | 0 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=0.25, uniform, oracle | 10.55 | 4.24 | 1.99 | 2.46 | 1.99 | 0.214 | 0.214 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=0.25, uniform, none | 12.56 | 2.23 | -0.02 | 0.45 | -0.02 | 0.423 | 0 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=0.5, inherit, oracle | 10.64 | 4.15 | 1.90 | 2.37 | 1.90 | 0.225 | 0.187 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=0.5, inherit, none | 12.55 | 2.24 | -0.01 | 0.46 | -0.01 | 0.427 | 0 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=0.5, uniform, oracle | 10.73 | 4.05 | 1.80 | 2.27 | 1.80 | 0.22 | 0.124 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=0.5, uniform, none | 12.53 | 2.26 | 0.01 | 0.48 | 0.01 | 0.421 | 0 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=1, inherit, oracle | 10.59 | 4.20 | 1.95 | 2.42 | 1.95 | 0.229 | 0.217 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=1, inherit, none | 12.57 | 2.22 | -0.03 | 0.44 | -0.03 | 0.426 | 0 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=1, uniform, oracle | 10.96 | 3.83 | 1.58 | 2.05 | 1.58 | 0.234 | 0.05 |
| 1 | static C0 (build cost excluded) 14.79 | Haiku agent 12.54 | JIT S/H 13.01 | v0 H s=0 12.54 | 13.01 | λ=1, uniform, none | 12.53 | 2.26 | 0.01 | 0.48 | 0.01 | 0.413 | 0 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=0.25, inherit, oracle | 183.80 | 42.66 | 42.66 | 27.21 | 15.72 | 0 | 0.971 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=0.25, inherit, none | 147.81 | 78.66 | 78.66 | 63.20 | 51.71 | 0 | 0 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=0.25, uniform, oracle | 196.82 | 29.64 | 29.64 | 14.19 | 2.69 | 0.004 | 0.02 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=0.25, uniform, none | 147.55 | 78.91 | 78.91 | 63.46 | 51.97 | 0 | 0 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=0.5, inherit, oracle | 184.59 | 41.87 | 41.87 | 26.42 | 14.93 | 0.001 | 0.944 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=0.5, inherit, none | 147.87 | 78.59 | 78.59 | 63.14 | 51.65 | 0.001 | 0 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=0.5, uniform, oracle | 196.74 | 29.72 | 29.72 | 14.27 | 2.78 | 0.004 | 0.008 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=0.5, uniform, none | 148.15 | 78.31 | 78.31 | 62.86 | 51.37 | 0 | 0 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=1, inherit, oracle | 185.54 | 40.92 | 40.92 | 25.47 | 13.98 | 0.001 | 0.977 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=1, inherit, none | 147.22 | 79.24 | 79.24 | 63.79 | 52.30 | 0 | 0 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=1, uniform, oracle | 196.72 | 29.74 | 29.74 | 14.29 | 2.80 | 0.004 | 0.003 |
| 10 | Opus agent 226.46 | Opus agent 226.46 | JIT S/H 211.01 | v0 S s=0 199.52 | 228.62 | λ=1, uniform, none | 147.85 | 78.61 | 78.61 | 63.16 | 51.67 | 0.001 | 0 |

### kinetics

| policy | decision | pass /24 | cost $ |
|---|---|---|---|
| fixed: Haiku agent | — | 17.00 | 2.10 |
| fixed: Sonnet agent | — | 17.00 | 7.40 |
| fixed: JIT H/H (12 tasks) | — | 16.00 | 14.55 |
| fixed: JIT S/H (8 tasks) | — | 12.00 | 18.89 |
| fixed: JIT O/H (17 tasks) | — | 21.18 | 20.40 |
| v0 H s=0 | interpret every task | 17.00 | 2.10 |
| v0 H s=0.5 | interpret every task | 17.00 | 2.10 |
| v0 H s=1 | interpret every task | 17.00 | 2.10 |
| v0 S s=0 | compile at task 2 | 12.42 | 19.09 |
| v0 S s=0.5 | interpret every task | 17.00 | 7.40 |
| v0 S s=1 | interpret every task | 17.00 | 7.40 |

| V | best fixed (all) | best agent-every-time | best fixed JIT | best v0 | clairvoyant one-switch bound | v1 (λ, prior, feedback) | v1 net value | regret vs best fixed | vs best agent | vs best JIT | vs best v0 | P(v1 > best of agent & JIT) | v1 buys a compile |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=0.25, inherit, oracle | -0.41 | 0.01 | 0.01 | -12.54 | 0.01 | 0.596 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=0.25, inherit, none | -0.40 | 0.00 | 0.00 | -12.55 | 0.00 | 0.597 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=0.25, uniform, oracle | -0.40 | -0.00 | -0.00 | -12.55 | -0.00 | 0.609 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=0.25, uniform, none | -0.40 | -0.00 | -0.00 | -12.55 | -0.00 | 0.604 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=0.5, inherit, oracle | -0.40 | -0.00 | -0.00 | -12.55 | -0.00 | 0.602 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=0.5, inherit, none | -0.40 | 0.00 | 0.00 | -12.55 | 0.00 | 0.59 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=0.5, uniform, oracle | -0.40 | 0.00 | 0.00 | -12.55 | 0.00 | 0.598 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=0.5, uniform, none | -0.40 | 0.00 | 0.00 | -12.55 | 0.00 | 0.598 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=1, inherit, oracle | -0.40 | -0.00 | -0.00 | -12.55 | -0.00 | 0.604 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=1, inherit, none | -0.40 | 0.00 | 0.00 | -12.55 | 0.00 | 0.606 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=1, uniform, oracle | -0.41 | 0.01 | 0.01 | -12.54 | 0.01 | 0.592 | 0 |
| 0.1 | Haiku agent -0.40 | Haiku agent -0.40 | JIT H/H (12 tasks) -12.95 | v0 H s=0 -0.40 | -0.40 | λ=1, uniform, none | -0.40 | -0.01 | -0.01 | -12.55 | -0.01 | 0.608 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=0.25, inherit, oracle | 13.77 | 1.13 | 1.13 | -12.32 | 1.13 | 0.335 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=0.25, inherit, none | 14.92 | -0.02 | -0.02 | -13.47 | -0.02 | 0.418 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=0.25, uniform, oracle | 13.76 | 1.14 | 1.14 | -12.31 | 1.14 | 0.339 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=0.25, uniform, none | 14.88 | 0.02 | 0.02 | -13.43 | 0.02 | 0.424 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=0.5, inherit, oracle | 13.71 | 1.19 | 1.19 | -12.27 | 1.19 | 0.336 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=0.5, inherit, none | 14.89 | 0.01 | 0.01 | -13.45 | 0.01 | 0.415 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=0.5, uniform, oracle | 13.71 | 1.19 | 1.19 | -12.26 | 1.19 | 0.328 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=0.5, uniform, none | 14.93 | -0.03 | -0.03 | -13.48 | -0.03 | 0.43 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=1, inherit, oracle | 13.74 | 1.16 | 1.16 | -12.29 | 1.16 | 0.335 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=1, inherit, none | 14.91 | -0.01 | -0.01 | -13.46 | -0.01 | 0.416 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=1, uniform, oracle | 13.75 | 1.15 | 1.15 | -12.30 | 1.15 | 0.326 | 0 |
| 1 | Haiku agent 14.90 | Haiku agent 14.90 | JIT H/H (12 tasks) 1.45 | v0 H s=0 14.90 | 14.90 | λ=1, uniform, none | 14.96 | -0.06 | -0.06 | -13.51 | -0.06 | 0.439 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=0.25, inherit, oracle | 165.98 | 25.39 | 1.92 | 25.39 | 1.92 | 0.135 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=0.25, inherit, none | 168.24 | 23.13 | -0.34 | 23.13 | -0.34 | 0.135 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=0.25, uniform, oracle | 165.04 | 26.33 | 2.86 | 26.33 | 2.86 | 0.127 | 0.023 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=0.25, uniform, none | 167.70 | 23.67 | 0.20 | 23.67 | 0.20 | 0.125 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=0.5, inherit, oracle | 165.19 | 26.18 | 2.71 | 26.18 | 2.71 | 0.136 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=0.5, inherit, none | 168.03 | 23.34 | -0.13 | 23.34 | -0.13 | 0.137 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=0.5, uniform, oracle | 165.25 | 26.12 | 2.65 | 26.12 | 2.65 | 0.132 | 0.011 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=0.5, uniform, none | 167.31 | 24.05 | 0.59 | 24.05 | 0.59 | 0.126 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=1, inherit, oracle | 165.26 | 26.11 | 2.64 | 26.11 | 2.64 | 0.122 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=1, inherit, none | 167.38 | 23.99 | 0.52 | 23.99 | 0.52 | 0.125 | 0 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=1, uniform, oracle | 165.19 | 26.17 | 2.71 | 26.17 | 2.71 | 0.128 | 0.003 |
| 10 | JIT O/H (17 tasks) 191.37 | Haiku agent 167.90 | JIT O/H (17 tasks) 191.37 | v0 H s=0 167.90 | 167.90 | λ=1, uniform, none | 167.98 | 23.39 | -0.08 | 23.39 | -0.08 | 0.127 | 0 |

