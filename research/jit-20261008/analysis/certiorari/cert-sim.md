| queue | policy | e | budget | pass /24 | prevented vs A | rulings | fixed per ruling | harm per ruling | precedent apps | precedent fixes | precedent harm | precision (all / side-only) | P(harm ≥ 1) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | A  baseline (no human; stream.mjs:547) | 0 | 0 | 15.00 | 0.00 | 0.00 | — | — | 0 | 0 | 0 | — / — | 0 |
| Q1 | B  case-only, FIFO | 0 | 1 | 15.00 | 0.00 | 1.00 | 0 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | B  case-only, FIFO | 0 | 2 | 15.00 | 0.00 | 2.00 | 0 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | B  case-only, FIFO | 0 | 4 | 16.00 | 1.00 | 4.00 | 0.25 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | B  case-only, FIFO | 0.1 | 1 | 14.95 | -0.05 | 1.00 | 0 | 0.054 | 0 | 0 | 0 | — / — | 0.054 |
| Q1 | B  case-only, FIFO | 0.1 | 2 | 14.84 | -0.16 | 2.00 | 0 | 0.081 | 0 | 0 | 0 | — / — | 0.156 |
| Q1 | B  case-only, FIFO | 0.1 | 4 | 15.64 | 0.65 | 4.00 | 0.225 | 0.063 | 0 | 0 | 0 | — / — | 0.234 |
| Q1 | B  case-only, FIFO | 0.2 | 1 | 14.88 | -0.12 | 1.00 | 0 | 0.117 | 0 | 0 | 0 | — / — | 0.117 |
| Q1 | B  case-only, FIFO | 0.2 | 2 | 14.68 | -0.32 | 2.00 | 0 | 0.16 | 0 | 0 | 0 | — / — | 0.296 |
| Q1 | B  case-only, FIFO | 0.2 | 4 | 15.28 | 0.28 | 4.00 | 0.198 | 0.128 | 0 | 0 | 0 | — / — | 0.429 |
| Q1 | C  case-only, cert priority | 0 | 1 | 15.26 | 0.26 | 1.00 | 0.263 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | C  case-only, cert priority | 0 | 2 | 15.50 | 0.50 | 2.00 | 0.25 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | C  case-only, cert priority | 0 | 4 | 16.44 | 1.44 | 4.00 | 0.359 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | C  case-only, cert priority | 0.1 | 1 | 15.14 | 0.14 | 1.00 | 0.22 | 0.078 | 0 | 0 | 0 | — / — | 0.078 |
| Q1 | C  case-only, cert priority | 0.1 | 2 | 15.30 | 0.30 | 2.00 | 0.228 | 0.076 | 0 | 0 | 0 | — / — | 0.147 |
| Q1 | C  case-only, cert priority | 0.1 | 4 | 16.05 | 1.05 | 4.00 | 0.324 | 0.06 | 0 | 0 | 0 | — / — | 0.224 |
| Q1 | C  case-only, cert priority | 0.2 | 1 | 15.06 | 0.06 | 1.00 | 0.203 | 0.147 | 0 | 0 | 0 | — / — | 0.147 |
| Q1 | C  case-only, cert priority | 0.2 | 2 | 15.09 | 0.09 | 2.00 | 0.198 | 0.156 | 0 | 0 | 0 | — / — | 0.289 |
| Q1 | C  case-only, cert priority | 0.2 | 4 | 15.68 | 0.68 | 4.00 | 0.289 | 0.119 | 0 | 0 | 0 | — / — | 0.411 |
| Q1 | D1 cert + precedent M1 (same split) | 0 | 1 | 15.00 | 0.00 | 1.00 | 0.497 | 0.497 | 3 | 0.251 | 0.497 | 0.667 / 0.667 | 0.497 |
| Q1 | D1 cert + precedent M1 (same split) | 0 | 2 | 15.79 | 0.79 | 2.00 | 0.641 | 0.248 | 3 | 0.25 | 0.496 | 0.667 / 0.667 | 0.496 |
| Q1 | D1 cert + precedent M1 (same split) | 0 | 4 | 16.00 | 1.00 | 2.42 | 0.62 | 0.207 | 3 | 0.248 | 0.503 | 0.667 / 0.667 | 0.503 |
| Q1 | D1 cert + precedent M1 (same split) | 0.1 | 1 | 14.79 | -0.21 | 1.00 | 0.469 | 0.682 | 3 | 0.241 | 0.611 | 0.627 / 0.627 | 0.54 |
| Q1 | D1 cert + precedent M1 (same split) | 0.1 | 2 | 15.49 | 0.49 | 2.00 | 0.588 | 0.344 | 3 | 0.239 | 0.613 | 0.627 / 0.627 | 0.542 |
| Q1 | D1 cert + precedent M1 (same split) | 0.1 | 4 | 15.67 | 0.67 | 2.42 | 0.562 | 0.285 | 3 | 0.236 | 0.614 | 0.624 / 0.624 | 0.539 |
| Q1 | D1 cert + precedent M1 (same split) | 0.2 | 1 | 14.54 | -0.46 | 1.00 | 0.427 | 0.891 | 3 | 0.229 | 0.738 | 0.58 / 0.58 | 0.582 |
| Q1 | D1 cert + precedent M1 (same split) | 0.2 | 2 | 15.18 | 0.18 | 2.00 | 0.521 | 0.429 | 3 | 0.217 | 0.712 | 0.586 / 0.586 | 0.565 |
| Q1 | D1 cert + precedent M1 (same split) | 0.2 | 4 | 15.33 | 0.33 | 2.43 | 0.5 | 0.363 | 3 | 0.217 | 0.726 | 0.581 / 0.581 | 0.571 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0 | 1 | 15.00 | 0.00 | 1.00 | 0.496 | 0.496 | 3 | 0.247 | 0.496 | 0.667 / 0.667 | 0.496 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0 | 2 | 15.79 | 0.79 | 2.00 | 0.647 | 0.251 | 3 | 0.246 | 0.501 | 0.667 / 0.667 | 0.501 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0 | 4 | 16.00 | 1.00 | 2.42 | 0.621 | 0.208 | 3 | 0.255 | 0.502 | 0.667 / 0.667 | 0.502 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 1 | 14.76 | -0.24 | 1.00 | 0.461 | 0.701 | 3 | 0.241 | 0.621 | 0.623 / 0.623 | 0.541 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 2 | 15.48 | 0.48 | 2.00 | 0.585 | 0.345 | 3 | 0.231 | 0.614 | 0.625 / 0.625 | 0.54 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 4 | 15.67 | 0.67 | 2.43 | 0.56 | 0.284 | 3 | 0.237 | 0.615 | 0.624 / 0.624 | 0.539 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 1 | 14.55 | -0.45 | 1.00 | 0.416 | 0.869 | 3 | 0.224 | 0.716 | 0.582 / 0.582 | 0.567 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 2 | 15.16 | 0.16 | 2.00 | 0.524 | 0.443 | 3 | 0.221 | 0.728 | 0.58 / 0.58 | 0.574 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 4 | 15.34 | 0.34 | 2.43 | 0.505 | 0.363 | 3 | 0.219 | 0.728 | 0.58 / 0.58 | 0.572 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0 | 1 | 15.50 | 0.50 | 1.00 | 0.994 | 0.497 | 12 | 0.744 | 0.497 | 0.708 / 0.708 | 0.497 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0 | 2 | 15.50 | 0.49 | 1.00 | 0.991 | 0.496 | 12 | 0.748 | 0.496 | 0.708 / 0.708 | 0.496 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0 | 4 | 15.51 | 0.51 | 1.00 | 1.015 | 0.507 | 12 | 0.764 | 0.507 | 0.709 / 0.709 | 0.507 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 1 | 14.99 | -0.01 | 1.00 | 0.923 | 0.935 | 11.684 | 0.704 | 0.857 | 0.679 / 0.679 | 0.541 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 2 | 15.08 | 0.08 | 1.07 | 0.923 | 0.848 | 11.722 | 0.699 | 0.835 | 0.681 / 0.681 | 0.536 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 4 | 15.08 | 0.08 | 1.08 | 0.931 | 0.858 | 11.724 | 0.712 | 0.849 | 0.681 / 0.681 | 0.542 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 1 | 14.54 | -0.46 | 1.00 | 0.848 | 1.309 | 11.41 | 0.653 | 1.163 | 0.652 / 0.652 | 0.572 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 2 | 14.62 | -0.38 | 1.16 | 0.849 | 1.177 | 11.47 | 0.658 | 1.205 | 0.65 / 0.65 | 0.578 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 4 | 14.62 | -0.39 | 1.16 | 0.849 | 1.182 | 11.468 | 0.656 | 1.213 | 0.65 / 0.65 | 0.579 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0 | 1 | 15.00 | 0.00 | 1.00 | 0 | 0 | 1.744 | 0 | 0 | 0.667 / 0.667 | 0 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0 | 2 | 15.57 | 0.57 | 2.00 | 0.283 | 0 | 3 | 0 | 0 | 0.667 / 0.667 | 0 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0 | 4 | 16.00 | 1.00 | 2.43 | 0.411 | 0 | 3 | 0 | 0 | 0.667 / 0.667 | 0 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.1 | 1 | 14.91 | -0.09 | 1.00 | 0.029 | 0.117 | 1.717 | 0.029 | 0.058 | 0.65 / 0.65 | 0.059 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.1 | 2 | 15.37 | 0.37 | 2.00 | 0.28 | 0.096 | 3 | 0.045 | 0.098 | 0.649 / 0.649 | 0.094 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.1 | 4 | 15.74 | 0.74 | 2.43 | 0.391 | 0.085 | 3 | 0.05 | 0.105 | 0.648 / 0.648 | 0.102 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.2 | 1 | 14.82 | -0.18 | 1.00 | 0.055 | 0.239 | 1.711 | 0.055 | 0.123 | 0.627 / 0.627 | 0.117 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.2 | 2 | 15.13 | 0.13 | 2.00 | 0.274 | 0.207 | 3 | 0.1 | 0.209 | 0.63 / 0.63 | 0.205 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.2 | 4 | 15.49 | 0.49 | 2.43 | 0.368 | 0.165 | 3 | 0.099 | 0.201 | 0.632 / 0.632 | 0.2 |
| Q2 | A  baseline (no human; stream.mjs:547) | 0 | 0 | 15.00 | 0.00 | 0.00 | — | — | 0 | 0 | 0 | — / — | 0 |
| Q2 | B  case-only, FIFO | 0 | 1 | 15.00 | 0.00 | 1.00 | 0 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | B  case-only, FIFO | 0 | 2 | 15.00 | 0.00 | 2.00 | 0 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | B  case-only, FIFO | 0 | 4 | 16.00 | 1.00 | 4.00 | 0.25 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | B  case-only, FIFO | 0.1 | 1 | 14.94 | -0.06 | 1.00 | 0 | 0.059 | 0 | 0 | 0 | — / — | 0.059 |
| Q2 | B  case-only, FIFO | 0.1 | 2 | 14.84 | -0.16 | 2.00 | 0 | 0.08 | 0 | 0 | 0 | — / — | 0.154 |
| Q2 | B  case-only, FIFO | 0.1 | 4 | 15.64 | 0.64 | 4.00 | 0.225 | 0.065 | 0 | 0 | 0 | — / — | 0.239 |
| Q2 | B  case-only, FIFO | 0.2 | 1 | 14.88 | -0.12 | 1.00 | 0 | 0.115 | 0 | 0 | 0 | — / — | 0.115 |
| Q2 | B  case-only, FIFO | 0.2 | 2 | 14.69 | -0.31 | 2.00 | 0 | 0.156 | 0 | 0 | 0 | — / — | 0.291 |
| Q2 | B  case-only, FIFO | 0.2 | 4 | 15.29 | 0.29 | 4.00 | 0.2 | 0.128 | 0 | 0 | 0 | — / — | 0.428 |
| Q2 | C  case-only, cert priority | 0 | 1 | 15.63 | 0.63 | 1.00 | 0.631 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | C  case-only, cert priority | 0 | 2 | 16.25 | 1.25 | 2.00 | 0.625 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | C  case-only, cert priority | 0 | 4 | 17.51 | 2.51 | 4.00 | 0.626 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | C  case-only, cert priority | 0.1 | 1 | 15.54 | 0.54 | 1.00 | 0.577 | 0.037 | 0 | 0 | 0 | — / — | 0.037 |
| Q2 | C  case-only, cert priority | 0.1 | 2 | 16.06 | 1.06 | 2.00 | 0.568 | 0.036 | 0 | 0 | 0 | — / — | 0.071 |
| Q2 | C  case-only, cert priority | 0.1 | 4 | 17.09 | 2.09 | 4.00 | 0.56 | 0.037 | 0 | 0 | 0 | — / — | 0.141 |
| Q2 | C  case-only, cert priority | 0.2 | 1 | 15.41 | 0.41 | 1.00 | 0.491 | 0.08 | 0 | 0 | 0 | — / — | 0.08 |
| Q2 | C  case-only, cert priority | 0.2 | 2 | 15.86 | 0.86 | 2.00 | 0.504 | 0.075 | 0 | 0 | 0 | — / — | 0.15 |
| Q2 | C  case-only, cert priority | 0.2 | 4 | 16.70 | 1.70 | 4.00 | 0.5 | 0.075 | 0 | 0 | 0 | — / — | 0.283 |
| Q2 | D1 cert + precedent M1 (same split) | 0 | 1 | 17.00 | 2.00 | 1.00 | 2.259 | 0.26 | 3 | 1.63 | 0.26 | 0.833 / 0.667 | 0.26 |
| Q2 | D1 cert + precedent M1 (same split) | 0 | 2 | 19.00 | 4.00 | 2.00 | 2.251 | 0.251 | 6 | 3.252 | 0.501 | 0.833 / 0.667 | 0.501 |
| Q2 | D1 cert + precedent M1 (same split) | 0 | 4 | 20.00 | 5.00 | 3.43 | 1.601 | 0.143 | 6 | 3.247 | 0.49 | 0.833 / 0.667 | 0.49 |
| Q2 | D1 cert + precedent M1 (same split) | 0.1 | 1 | 16.64 | 1.64 | 1.00 | 1.987 | 0.349 | 3 | 1.435 | 0.311 | 0.754 / 0.562 | 0.273 |
| Q2 | D1 cert + precedent M1 (same split) | 0.1 | 2 | 18.38 | 3.38 | 2.00 | 2.035 | 0.345 | 6 | 2.944 | 0.613 | 0.763 / 0.568 | 0.54 |
| Q2 | D1 cert + precedent M1 (same split) | 0.1 | 4 | 19.23 | 4.22 | 3.43 | 1.433 | 0.202 | 6 | 2.903 | 0.612 | 0.756 / 0.56 | 0.533 |
| Q2 | D1 cert + precedent M1 (same split) | 0.2 | 1 | 16.37 | 1.37 | 1.00 | 1.802 | 0.436 | 3 | 1.305 | 0.363 | 0.689 / 0.485 | 0.291 |
| Q2 | D1 cert + precedent M1 (same split) | 0.2 | 2 | 17.77 | 2.77 | 2.00 | 1.819 | 0.433 | 6 | 2.633 | 0.721 | 0.694 / 0.49 | 0.577 |
| Q2 | D1 cert + precedent M1 (same split) | 0.2 | 4 | 18.55 | 3.55 | 3.43 | 1.294 | 0.257 | 6 | 2.638 | 0.722 | 0.693 / 0.487 | 0.578 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0 | 1 | 16.99 | 1.99 | 1.00 | 2.234 | 0.244 | 3 | 1.613 | 0.244 | 0.832 / 0.667 | 0.244 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0 | 2 | 19.00 | 4.00 | 2.00 | 2.25 | 0.25 | 6 | 3.254 | 0.5 | 0.833 / 0.667 | 0.5 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0 | 4 | 20.00 | 5.00 | 3.44 | 1.601 | 0.145 | 6 | 3.252 | 0.5 | 0.833 / 0.667 | 0.5 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 1 | 16.70 | 1.70 | 1.00 | 2.033 | 0.332 | 3 | 1.472 | 0.297 | 0.765 / 0.573 | 0.264 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 2 | 18.39 | 3.39 | 2.00 | 2.036 | 0.342 | 6 | 2.946 | 0.611 | 0.764 / 0.57 | 0.541 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 4 | 19.31 | 4.31 | 3.43 | 1.454 | 0.199 | 6 | 2.959 | 0.61 | 0.766 / 0.573 | 0.536 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 1 | 16.38 | 1.38 | 1.00 | 1.814 | 0.433 | 3 | 1.314 | 0.358 | 0.691 / 0.483 | 0.282 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 2 | 17.75 | 2.75 | 2.00 | 1.807 | 0.432 | 6 | 2.618 | 0.717 | 0.692 / 0.488 | 0.575 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 4 | 18.57 | 3.57 | 3.43 | 1.294 | 0.253 | 6 | 2.641 | 0.72 | 0.695 / 0.49 | 0.575 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0 | 1 | 17.25 | 2.25 | 1.00 | 2.499 | 0.251 | 7.509 | 1.872 | 0.251 | 0.767 / 0.708 | 0.251 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0 | 2 | 19.50 | 4.50 | 2.00 | 2.5 | 0.25 | 15 | 3.753 | 0.5 | 0.767 / 0.708 | 0.5 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0 | 4 | 19.50 | 4.50 | 2.00 | 2.504 | 0.252 | 15 | 3.753 | 0.504 | 0.767 / 0.709 | 0.504 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 1 | 16.81 | 1.81 | 1.00 | 2.256 | 0.447 | 7.907 | 1.697 | 0.412 | 0.738 / 0.684 | 0.273 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 2 | 18.72 | 3.72 | 2.00 | 2.3 | 0.44 | 14.559 | 3.449 | 0.805 | 0.741 / 0.679 | 0.507 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 4 | 18.99 | 3.99 | 2.13 | 2.278 | 0.401 | 14.699 | 3.562 | 0.785 | 0.745 / 0.682 | 0.509 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 1 | 16.30 | 1.30 | 1.00 | 1.982 | 0.686 | 8.268 | 1.493 | 0.61 | 0.705 / 0.656 | 0.288 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 2 | 18.00 | 3.00 | 2.00 | 2.105 | 0.606 | 14.162 | 3.15 | 1.074 | 0.717 / 0.654 | 0.52 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 4 | 18.45 | 3.45 | 2.26 | 2.046 | 0.519 | 14.451 | 3.351 | 1.043 | 0.723 / 0.658 | 0.516 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0 | 1 | 15.00 | 0.00 | 1.00 | 0 | 0 | 1.706 | 0 | 0 | 0.667 / 0.667 | 0 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0 | 2 | 17.27 | 2.27 | 2.00 | 1.135 | 0 | 4.702 | 1.702 | 0 | 0.787 / 0.667 | 0 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0 | 4 | 20.00 | 5.00 | 3.44 | 1.455 | 0 | 6 | 3 | 0 | 0.833 / 0.667 | 0 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.1 | 1 | 14.92 | -0.08 | 1.00 | 0.029 | 0.108 | 1.709 | 0.029 | 0.053 | 0.652 / 0.652 | 0.055 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.1 | 2 | 16.90 | 1.90 | 2.00 | 1.051 | 0.102 | 4.714 | 1.589 | 0.102 | 0.74 / 0.614 | 0.102 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.1 | 4 | 19.36 | 4.36 | 3.42 | 1.33 | 0.057 | 6 | 2.753 | 0.097 | 0.776 / 0.592 | 0.099 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.2 | 1 | 14.83 | -0.17 | 1.00 | 0.059 | 0.225 | 1.717 | 0.059 | 0.11 | 0.637 / 0.637 | 0.115 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.2 | 2 | 16.48 | 1.48 | 2.00 | 0.936 | 0.199 | 4.68 | 1.429 | 0.2 | 0.69 / 0.567 | 0.198 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.2 | 4 | 18.70 | 3.70 | 3.43 | 1.194 | 0.114 | 6 | 2.493 | 0.193 | 0.717 / 0.529 | 0.196 |

| queue | e | policy (budget 2) | gain over B | harm | dossier rule (gain ≥ 2, harm ≤ 1) |
|---|---|---|---|---|---|
| Q1 | 0 | D1 cert + precedent M1 (same split) | 0.786 | 0.496 | fail |
| Q1 | 0 | D3 cert + precedent M3 (same split, same segment) | 0.792 | 0.501 | fail |
| Q1 | 0 | D2 cert + precedent M2 (same winner; broad) | 0.496 | 0.496 | fail |
| Q1 | 0 | Do FIFO online + precedent M1, later tasks only | 0.567 | 0 | fail |
| Q1 | 0.1 | D1 cert + precedent M1 (same split) | 0.65 | 0.688 | fail |
| Q1 | 0.1 | D3 cert + precedent M3 (same split, same segment) | 0.643 | 0.69 | fail |
| Q1 | 0.1 | D2 cert + precedent M2 (same winner; broad) | 0.243 | 0.911 | fail |
| Q1 | 0.1 | Do FIFO online + precedent M1, later tasks only | 0.529 | 0.192 | fail |
| Q1 | 0.2 | D1 cert + precedent M1 (same split) | 0.501 | 0.858 | fail |
| Q1 | 0.2 | D3 cert + precedent M3 (same split, same segment) | 0.482 | 0.885 | fail |
| Q1 | 0.2 | D2 cert + precedent M2 (same winner; broad) | -0.06 | 1.361 | fail |
| Q1 | 0.2 | Do FIFO online + precedent M1, later tasks only | 0.453 | 0.414 | fail |
| Q2 | 0 | D1 cert + precedent M1 (same split) | 4 | 0.501 | pass |
| Q2 | 0 | D3 cert + precedent M3 (same split, same segment) | 4 | 0.5 | pass |
| Q2 | 0 | D2 cert + precedent M2 (same winner; broad) | 4.5 | 0.5 | pass |
| Q2 | 0 | Do FIFO online + precedent M1, later tasks only | 2.269 | 0 | pass |
| Q2 | 0.1 | D1 cert + precedent M1 (same split) | 3.539 | 0.69 | pass |
| Q2 | 0.1 | D3 cert + precedent M3 (same split, same segment) | 3.548 | 0.685 | pass |
| Q2 | 0.1 | D2 cert + precedent M2 (same winner; broad) | 3.881 | 0.879 | pass |
| Q2 | 0.1 | Do FIFO online + precedent M1, later tasks only | 2.057 | 0.204 | pass |
| Q2 | 0.2 | D1 cert + precedent M1 (same split) | 3.085 | 0.865 | pass |
| Q2 | 0.2 | D3 cert + precedent M3 (same split, same segment) | 3.063 | 0.865 | pass |
| Q2 | 0.2 | D2 cert + precedent M2 (same winner; broad) | 3.311 | 1.212 | fail |
| Q2 | 0.2 | Do FIFO online + precedent M1, later tasks only | 1.788 | 0.398 | fail |

| task | kind | groups (pass) | baseline delivers pass | partitions consistent with the data |
|---|---|---|---|---|
| d3:s201 | unanimous | haikuV1+opusV1+opusV2+sonnetV1:P | yes | 1 |
| d3:s202 | unanimous | haikuV1+opusV1+opusV2+sonnetV1:P | yes | 1 |
| d3:s203 | majority | haikuV1+opusV1+sonnetV1:P opusV2:P | yes | 7 |
| d3:s204 | majority | opusV1:F opusV2+sonnetV1:P | yes | 1 |
| d3:s205 | split | haikuV1:F sonnetV1:F opusV2:P | yes | 1 |
| d3:s206 | split | haikuV1:F sonnetV1:P opusV2:P | yes | 1 |
| d3:s207 | majority | haikuV1:F opusV1+opusV2+sonnetV1:P | yes | 1 |
| d3:s208 | split | haikuV1:F sonnetV1:P opusV2:F | no | 1 |
| d3:s209 | unanimous | haikuV1+opusV2+sonnetV1:P | yes | 1 |
| d3:s210 | split | haikuV1:F sonnetV1:P opusV2:P | yes | 1 |
| d3:s211 | unanimous | opusV2+sonnetV1:P | yes | 1 |
| d3:s212 | majority | opusV1+opusV2:F sonnetV1:P | no | 1 |
| d3:s213 | majority | opusV1+opusV2:P sonnetV1:P | yes | 1 |
| d3:s214 | unanimous | opusV1+opusV2+sonnetV1:F | no | 1 |
| d3:s215 | unanimous | haikuV1+opusV1+opusV2+sonnetV1:P | yes | 1 |
| d3:s216 | majority | haikuV1:F opusV2+sonnetV1:P | yes | 1 |
| d4:s217 | single | opusV2:F | no | 1 |
| d4:s218 | single | opusV2:F | no | 1 |
| d4:s219 | majority | haikuV1:F opusV2+sonnetV1:P | yes | 1 |
| d4:s220 | single | opusV2:F | no | 1 |
| d4:s221 | unanimous | haikuV1+opusV2+sonnetV1:P | yes | 1 |
| d4:s222 | single | opusV2:F | no | 1 |
| d4:s223 | majority | haikuV1+sonnetV1:F opusV2:F | no | 1 |
| d4:s224 | split | sonnetV1:F opusV2:F | no | 1 |
