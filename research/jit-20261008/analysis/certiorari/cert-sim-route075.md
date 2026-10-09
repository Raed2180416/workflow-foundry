| queue | policy | e | budget | pass /24 | prevented vs A | rulings | fixed per ruling | harm per ruling | precedent apps | precedent fixes | precedent harm | precision (all / side-only) | P(harm ≥ 1) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | A  baseline (no human; stream.mjs:547) | 0 | 0 | 15.00 | 0.00 | 0.00 | — | — | 0 | 0 | 0 | — / — | 0 |
| Q1 | B  case-only, FIFO | 0 | 1 | 15.00 | 0.00 | 1.00 | 0 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | B  case-only, FIFO | 0 | 2 | 15.00 | 0.00 | 2.00 | 0 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | B  case-only, FIFO | 0 | 4 | 16.00 | 1.00 | 4.00 | 0.25 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | B  case-only, FIFO | 0.1 | 1 | 14.94 | -0.06 | 1.00 | 0 | 0.064 | 0 | 0 | 0 | — / — | 0.064 |
| Q1 | B  case-only, FIFO | 0.1 | 2 | 14.83 | -0.17 | 2.00 | 0 | 0.087 | 0 | 0 | 0 | — / — | 0.167 |
| Q1 | B  case-only, FIFO | 0.1 | 4 | 15.63 | 0.63 | 4.00 | 0.225 | 0.066 | 0 | 0 | 0 | — / — | 0.243 |
| Q1 | B  case-only, FIFO | 0.2 | 1 | 14.86 | -0.14 | 1.00 | 0 | 0.139 | 0 | 0 | 0 | — / — | 0.139 |
| Q1 | B  case-only, FIFO | 0.2 | 2 | 14.66 | -0.34 | 2.00 | 0 | 0.17 | 0 | 0 | 0 | — / — | 0.313 |
| Q1 | B  case-only, FIFO | 0.2 | 4 | 15.26 | 0.26 | 4.00 | 0.198 | 0.133 | 0 | 0 | 0 | — / — | 0.444 |
| Q1 | C  case-only, cert priority | 0 | 1 | 15.26 | 0.26 | 1.00 | 0.263 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | C  case-only, cert priority | 0 | 2 | 15.50 | 0.50 | 2.00 | 0.25 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | C  case-only, cert priority | 0 | 4 | 16.27 | 1.27 | 4.00 | 0.317 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q1 | C  case-only, cert priority | 0.1 | 1 | 15.14 | 0.14 | 1.00 | 0.22 | 0.078 | 0 | 0 | 0 | — / — | 0.078 |
| Q1 | C  case-only, cert priority | 0.1 | 2 | 15.30 | 0.30 | 2.00 | 0.228 | 0.076 | 0 | 0 | 0 | — / — | 0.147 |
| Q1 | C  case-only, cert priority | 0.1 | 4 | 15.90 | 0.90 | 4.00 | 0.287 | 0.061 | 0 | 0 | 0 | — / — | 0.227 |
| Q1 | C  case-only, cert priority | 0.2 | 1 | 15.06 | 0.06 | 1.00 | 0.203 | 0.147 | 0 | 0 | 0 | — / — | 0.147 |
| Q1 | C  case-only, cert priority | 0.2 | 2 | 15.09 | 0.09 | 2.00 | 0.198 | 0.156 | 0 | 0 | 0 | — / — | 0.289 |
| Q1 | C  case-only, cert priority | 0.2 | 4 | 15.54 | 0.54 | 4.00 | 0.256 | 0.121 | 0 | 0 | 0 | — / — | 0.416 |
| Q1 | D1 cert + precedent M1 (same split) | 0 | 1 | 15.00 | 0.00 | 1.00 | 0.497 | 0.497 | 3 | 0.251 | 0.497 | 0.667 / 0.667 | 0.497 |
| Q1 | D1 cert + precedent M1 (same split) | 0 | 2 | 15.59 | 0.59 | 2.00 | 0.542 | 0.248 | 3 | 0.25 | 0.496 | 0.667 / 0.667 | 0.496 |
| Q1 | D1 cert + precedent M1 (same split) | 0 | 4 | 15.76 | 0.76 | 2.42 | 0.52 | 0.207 | 3 | 0.248 | 0.503 | 0.667 / 0.667 | 0.503 |
| Q1 | D1 cert + precedent M1 (same split) | 0.1 | 1 | 14.79 | -0.21 | 1.00 | 0.469 | 0.682 | 3 | 0.241 | 0.611 | 0.627 / 0.627 | 0.54 |
| Q1 | D1 cert + precedent M1 (same split) | 0.1 | 2 | 15.30 | 0.30 | 2.00 | 0.499 | 0.347 | 3 | 0.239 | 0.613 | 0.627 / 0.627 | 0.544 |
| Q1 | D1 cert + precedent M1 (same split) | 0.1 | 4 | 15.44 | 0.43 | 2.42 | 0.468 | 0.289 | 3 | 0.236 | 0.614 | 0.624 / 0.624 | 0.544 |
| Q1 | D1 cert + precedent M1 (same split) | 0.2 | 1 | 14.54 | -0.46 | 1.00 | 0.427 | 0.891 | 3 | 0.229 | 0.738 | 0.58 / 0.58 | 0.582 |
| Q1 | D1 cert + precedent M1 (same split) | 0.2 | 2 | 15.02 | 0.02 | 2.00 | 0.442 | 0.434 | 3 | 0.217 | 0.712 | 0.586 / 0.586 | 0.57 |
| Q1 | D1 cert + precedent M1 (same split) | 0.2 | 4 | 15.11 | 0.11 | 2.43 | 0.417 | 0.372 | 3 | 0.217 | 0.726 | 0.581 / 0.581 | 0.582 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0 | 1 | 15.00 | 0.00 | 1.00 | 0.496 | 0.496 | 3 | 0.247 | 0.496 | 0.667 / 0.667 | 0.496 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0 | 2 | 15.59 | 0.59 | 2.00 | 0.546 | 0.251 | 3 | 0.246 | 0.501 | 0.667 / 0.667 | 0.501 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0 | 4 | 15.75 | 0.75 | 2.42 | 0.517 | 0.208 | 3 | 0.255 | 0.502 | 0.667 / 0.667 | 0.502 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 1 | 14.76 | -0.24 | 1.00 | 0.461 | 0.701 | 3 | 0.241 | 0.621 | 0.623 / 0.623 | 0.541 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 2 | 15.30 | 0.30 | 2.00 | 0.498 | 0.348 | 3 | 0.231 | 0.614 | 0.625 / 0.625 | 0.542 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 4 | 15.44 | 0.44 | 2.43 | 0.47 | 0.289 | 3 | 0.237 | 0.615 | 0.624 / 0.624 | 0.544 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 1 | 14.55 | -0.45 | 1.00 | 0.416 | 0.869 | 3 | 0.224 | 0.716 | 0.582 / 0.582 | 0.567 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 2 | 14.99 | -0.01 | 2.00 | 0.444 | 0.449 | 3 | 0.221 | 0.728 | 0.58 / 0.58 | 0.579 |
| Q1 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 4 | 15.12 | 0.12 | 2.43 | 0.42 | 0.372 | 3 | 0.219 | 0.728 | 0.58 / 0.58 | 0.581 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0 | 1 | 15.50 | 0.50 | 1.00 | 0.994 | 0.497 | 12 | 0.744 | 0.497 | 0.708 / 0.708 | 0.497 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0 | 2 | 15.50 | 0.49 | 1.00 | 0.991 | 0.496 | 12 | 0.748 | 0.496 | 0.708 / 0.708 | 0.496 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0 | 4 | 15.51 | 0.51 | 1.00 | 1.015 | 0.507 | 12 | 0.764 | 0.507 | 0.709 / 0.709 | 0.507 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 1 | 14.99 | -0.01 | 1.00 | 0.923 | 0.935 | 11.684 | 0.704 | 0.857 | 0.679 / 0.679 | 0.541 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 2 | 15.06 | 0.06 | 1.07 | 0.907 | 0.848 | 11.722 | 0.699 | 0.835 | 0.681 / 0.681 | 0.536 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 4 | 15.06 | 0.06 | 1.08 | 0.917 | 0.858 | 11.724 | 0.712 | 0.849 | 0.681 / 0.681 | 0.542 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 1 | 14.54 | -0.46 | 1.00 | 0.848 | 1.309 | 11.41 | 0.653 | 1.163 | 0.652 / 0.652 | 0.572 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 2 | 14.59 | -0.41 | 1.16 | 0.822 | 1.177 | 11.47 | 0.658 | 1.205 | 0.65 / 0.65 | 0.578 |
| Q1 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 4 | 14.58 | -0.42 | 1.16 | 0.821 | 1.182 | 11.468 | 0.656 | 1.213 | 0.65 / 0.65 | 0.579 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0 | 1 | 15.00 | 0.00 | 1.00 | 0 | 0 | 1.744 | 0 | 0 | 0.667 / 0.667 | 0 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0 | 2 | 15.43 | 0.43 | 2.00 | 0.213 | 0 | 3 | 0 | 0 | 0.667 / 0.667 | 0 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0 | 4 | 15.74 | 0.74 | 2.43 | 0.304 | 0 | 3 | 0 | 0 | 0.667 / 0.667 | 0 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.1 | 1 | 14.90 | -0.10 | 1.00 | 0.029 | 0.128 | 1.717 | 0.029 | 0.058 | 0.65 / 0.65 | 0.07 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.1 | 2 | 15.23 | 0.23 | 2.00 | 0.217 | 0.101 | 3 | 0.045 | 0.098 | 0.649 / 0.649 | 0.103 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.1 | 4 | 15.51 | 0.51 | 2.43 | 0.299 | 0.09 | 3 | 0.05 | 0.105 | 0.648 / 0.648 | 0.113 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.2 | 1 | 14.79 | -0.20 | 1.00 | 0.055 | 0.261 | 1.711 | 0.055 | 0.123 | 0.627 / 0.627 | 0.138 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.2 | 2 | 15.00 | 0.00 | 2.00 | 0.217 | 0.217 | 3 | 0.1 | 0.209 | 0.63 / 0.63 | 0.22 |
| Q1 | Do FIFO online + precedent M1, later tasks only | 0.2 | 4 | 15.28 | 0.28 | 2.43 | 0.287 | 0.174 | 3 | 0.099 | 0.201 | 0.632 / 0.632 | 0.217 |
| Q2 | A  baseline (no human; stream.mjs:547) | 0 | 0 | 15.00 | 0.00 | 0.00 | — | — | 0 | 0 | 0 | — / — | 0 |
| Q2 | B  case-only, FIFO | 0 | 1 | 15.00 | 0.00 | 1.00 | 0 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | B  case-only, FIFO | 0 | 2 | 15.00 | 0.00 | 2.00 | 0 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | B  case-only, FIFO | 0 | 4 | 16.00 | 1.00 | 4.00 | 0.25 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | B  case-only, FIFO | 0.1 | 1 | 14.93 | -0.07 | 1.00 | 0 | 0.07 | 0 | 0 | 0 | — / — | 0.07 |
| Q2 | B  case-only, FIFO | 0.1 | 2 | 14.83 | -0.17 | 2.00 | 0 | 0.085 | 0 | 0 | 0 | — / — | 0.161 |
| Q2 | B  case-only, FIFO | 0.1 | 4 | 15.63 | 0.63 | 4.00 | 0.225 | 0.068 | 0 | 0 | 0 | — / — | 0.249 |
| Q2 | B  case-only, FIFO | 0.2 | 1 | 14.86 | -0.14 | 1.00 | 0 | 0.138 | 0 | 0 | 0 | — / — | 0.138 |
| Q2 | B  case-only, FIFO | 0.2 | 2 | 14.67 | -0.33 | 2.00 | 0 | 0.167 | 0 | 0 | 0 | — / — | 0.308 |
| Q2 | B  case-only, FIFO | 0.2 | 4 | 15.27 | 0.27 | 4.00 | 0.2 | 0.133 | 0 | 0 | 0 | — / — | 0.441 |
| Q2 | C  case-only, cert priority | 0 | 1 | 15.51 | 0.51 | 1.00 | 0.505 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | C  case-only, cert priority | 0 | 2 | 16.00 | 1.00 | 2.00 | 0.5 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | C  case-only, cert priority | 0 | 4 | 17.01 | 2.01 | 4.00 | 0.503 | 0 | 0 | 0 | 0 | — / — | 0 |
| Q2 | C  case-only, cert priority | 0.1 | 1 | 15.42 | 0.42 | 1.00 | 0.459 | 0.037 | 0 | 0 | 0 | — / — | 0.037 |
| Q2 | C  case-only, cert priority | 0.1 | 2 | 15.83 | 0.83 | 2.00 | 0.452 | 0.036 | 0 | 0 | 0 | — / — | 0.071 |
| Q2 | C  case-only, cert priority | 0.1 | 4 | 16.65 | 1.65 | 4.00 | 0.45 | 0.037 | 0 | 0 | 0 | — / — | 0.141 |
| Q2 | C  case-only, cert priority | 0.2 | 1 | 15.31 | 0.31 | 1.00 | 0.392 | 0.08 | 0 | 0 | 0 | — / — | 0.08 |
| Q2 | C  case-only, cert priority | 0.2 | 2 | 15.66 | 0.66 | 2.00 | 0.404 | 0.075 | 0 | 0 | 0 | — / — | 0.15 |
| Q2 | C  case-only, cert priority | 0.2 | 4 | 16.30 | 1.30 | 4.00 | 0.4 | 0.075 | 0 | 0 | 0 | — / — | 0.283 |
| Q2 | D1 cert + precedent M1 (same split) | 0 | 1 | 16.50 | 1.50 | 1.00 | 1.759 | 0.26 | 3 | 1.253 | 0.26 | 0.708 / 0.667 | 0.26 |
| Q2 | D1 cert + precedent M1 (same split) | 0 | 2 | 18.02 | 3.02 | 2.00 | 1.759 | 0.251 | 6 | 2.512 | 0.501 | 0.71 / 0.667 | 0.501 |
| Q2 | D1 cert + precedent M1 (same split) | 0 | 4 | 18.73 | 3.73 | 3.43 | 1.233 | 0.143 | 6 | 2.494 | 0.49 | 0.708 / 0.667 | 0.49 |
| Q2 | D1 cert + precedent M1 (same split) | 0.1 | 1 | 16.21 | 1.21 | 1.00 | 1.556 | 0.349 | 3 | 1.111 | 0.311 | 0.646 / 0.562 | 0.273 |
| Q2 | D1 cert + precedent M1 (same split) | 0.1 | 2 | 17.48 | 2.48 | 2.00 | 1.586 | 0.345 | 6 | 2.276 | 0.613 | 0.652 / 0.568 | 0.54 |
| Q2 | D1 cert + precedent M1 (same split) | 0.1 | 4 | 18.10 | 3.10 | 3.43 | 1.109 | 0.205 | 6 | 2.238 | 0.612 | 0.645 / 0.56 | 0.538 |
| Q2 | D1 cert + precedent M1 (same split) | 0.2 | 1 | 15.97 | 0.97 | 1.00 | 1.404 | 0.436 | 3 | 1.008 | 0.363 | 0.59 / 0.485 | 0.291 |
| Q2 | D1 cert + precedent M1 (same split) | 0.2 | 2 | 16.98 | 1.98 | 2.00 | 1.42 | 0.433 | 6 | 2.037 | 0.721 | 0.595 / 0.49 | 0.577 |
| Q2 | D1 cert + precedent M1 (same split) | 0.2 | 4 | 17.52 | 2.52 | 3.43 | 0.998 | 0.263 | 6 | 2.03 | 0.722 | 0.592 / 0.487 | 0.587 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0 | 1 | 16.49 | 1.49 | 1.00 | 1.735 | 0.244 | 3 | 1.237 | 0.244 | 0.707 / 0.667 | 0.244 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0 | 2 | 18.00 | 3.00 | 2.00 | 1.751 | 0.25 | 6 | 2.511 | 0.5 | 0.71 / 0.667 | 0.5 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0 | 4 | 18.77 | 3.77 | 3.44 | 1.242 | 0.145 | 6 | 2.511 | 0.5 | 0.71 / 0.667 | 0.5 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 1 | 16.25 | 1.25 | 1.00 | 1.586 | 0.332 | 3 | 1.133 | 0.297 | 0.653 / 0.573 | 0.264 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 2 | 17.48 | 2.48 | 2.00 | 1.584 | 0.342 | 6 | 2.266 | 0.611 | 0.651 / 0.57 | 0.541 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.1 | 4 | 18.17 | 3.17 | 3.43 | 1.126 | 0.202 | 6 | 2.282 | 0.61 | 0.654 / 0.573 | 0.54 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 1 | 15.98 | 0.98 | 1.00 | 1.409 | 0.433 | 3 | 1.015 | 0.358 | 0.591 / 0.483 | 0.282 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 2 | 16.95 | 1.95 | 2.00 | 1.406 | 0.432 | 6 | 2.013 | 0.717 | 0.591 / 0.488 | 0.575 |
| Q2 | D3 cert + precedent M3 (same split, same segment) | 0.2 | 4 | 17.55 | 2.54 | 3.43 | 1.002 | 0.26 | 6 | 2.035 | 0.72 | 0.594 / 0.49 | 0.585 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0 | 1 | 16.74 | 1.74 | 1.00 | 1.992 | 0.251 | 7.509 | 1.494 | 0.251 | 0.716 / 0.708 | 0.251 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0 | 2 | 18.49 | 3.49 | 2.00 | 1.997 | 0.25 | 15 | 2.996 | 0.5 | 0.716 / 0.708 | 0.5 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0 | 4 | 18.51 | 3.51 | 2.00 | 2.006 | 0.252 | 15 | 3.009 | 0.504 | 0.717 / 0.709 | 0.504 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 1 | 16.36 | 1.36 | 1.00 | 1.804 | 0.447 | 7.907 | 1.36 | 0.412 | 0.695 / 0.684 | 0.273 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 2 | 17.78 | 2.78 | 2.00 | 1.832 | 0.44 | 14.559 | 2.748 | 0.805 | 0.692 / 0.679 | 0.507 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.1 | 4 | 17.99 | 2.99 | 2.13 | 1.808 | 0.401 | 14.699 | 2.832 | 0.785 | 0.695 / 0.682 | 0.509 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 1 | 15.91 | 0.91 | 1.00 | 1.594 | 0.686 | 8.268 | 1.204 | 0.61 | 0.67 / 0.656 | 0.288 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 2 | 17.14 | 2.14 | 2.00 | 1.676 | 0.606 | 14.162 | 2.515 | 1.074 | 0.672 / 0.654 | 0.52 |
| Q2 | D2 cert + precedent M2 (same winner; broad) | 0.2 | 4 | 17.49 | 2.49 | 2.26 | 1.622 | 0.519 | 14.451 | 2.661 | 1.043 | 0.675 / 0.658 | 0.516 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0 | 1 | 15.00 | 0.00 | 1.00 | 0 | 0 | 1.706 | 0 | 0 | 0.667 / 0.667 | 0 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0 | 2 | 16.71 | 1.71 | 2.00 | 0.856 | 0 | 4.702 | 1.283 | 0 | 0.698 / 0.667 | 0 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0 | 4 | 18.75 | 3.75 | 3.44 | 1.09 | 0 | 6 | 2.239 | 0 | 0.707 / 0.667 | 0 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.1 | 1 | 14.91 | -0.09 | 1.00 | 0.029 | 0.121 | 1.709 | 0.029 | 0.053 | 0.652 / 0.652 | 0.068 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.1 | 2 | 16.37 | 1.37 | 2.00 | 0.793 | 0.107 | 4.714 | 1.203 | 0.102 | 0.658 / 0.614 | 0.111 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.1 | 4 | 18.23 | 3.23 | 3.42 | 1.003 | 0.061 | 6 | 2.087 | 0.097 | 0.665 / 0.592 | 0.109 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.2 | 1 | 14.81 | -0.19 | 1.00 | 0.059 | 0.248 | 1.717 | 0.059 | 0.11 | 0.637 / 0.637 | 0.138 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.2 | 2 | 16.02 | 1.02 | 2.00 | 0.718 | 0.209 | 4.68 | 1.107 | 0.2 | 0.621 / 0.567 | 0.215 |
| Q2 | Do FIFO online + precedent M1, later tasks only | 0.2 | 4 | 17.69 | 2.69 | 3.43 | 0.905 | 0.12 | 6 | 1.901 | 0.193 | 0.618 / 0.529 | 0.214 |

| queue | e | policy (budget 2) | gain over B | harm | dossier rule (gain ≥ 2, harm ≤ 1) |
|---|---|---|---|---|---|
| Q1 | 0 | D1 cert + precedent M1 (same split) | 0.589 | 0.496 | fail |
| Q1 | 0 | D3 cert + precedent M3 (same split, same segment) | 0.592 | 0.501 | fail |
| Q1 | 0 | D2 cert + precedent M2 (same winner; broad) | 0.496 | 0.496 | fail |
| Q1 | 0 | Do FIFO online + precedent M1, later tasks only | 0.426 | 0 | fail |
| Q1 | 0.1 | D1 cert + precedent M1 (same split) | 0.479 | 0.693 | fail |
| Q1 | 0.1 | D3 cert + precedent M3 (same split, same segment) | 0.474 | 0.696 | fail |
| Q1 | 0.1 | D2 cert + precedent M2 (same winner; broad) | 0.238 | 0.911 | fail |
| Q1 | 0.1 | Do FIFO online + precedent M1, later tasks only | 0.406 | 0.202 | fail |
| Q1 | 0.2 | D1 cert + precedent M1 (same split) | 0.356 | 0.868 | fail |
| Q1 | 0.2 | D3 cert + precedent M3 (same split, same segment) | 0.331 | 0.898 | fail |
| Q1 | 0.2 | D2 cert + precedent M2 (same winner; broad) | -0.071 | 1.361 | fail |
| Q1 | 0.2 | Do FIFO online + precedent M1, later tasks only | 0.34 | 0.433 | fail |
| Q2 | 0 | D1 cert + precedent M1 (same split) | 3.016 | 0.501 | pass |
| Q2 | 0 | D3 cert + precedent M3 (same split, same segment) | 3.002 | 0.5 | pass |
| Q2 | 0 | D2 cert + precedent M2 (same winner; broad) | 3.493 | 0.5 | pass |
| Q2 | 0 | Do FIFO online + precedent M1, later tasks only | 1.712 | 0 | fail |
| Q2 | 0.1 | D1 cert + precedent M1 (same split) | 2.65 | 0.69 | pass |
| Q2 | 0.1 | D3 cert + precedent M3 (same split, same segment) | 2.653 | 0.685 | pass |
| Q2 | 0.1 | D2 cert + precedent M2 (same winner; broad) | 2.952 | 0.879 | pass |
| Q2 | 0.1 | Do FIFO online + precedent M1, later tasks only | 1.54 | 0.215 | fail |
| Q2 | 0.2 | D1 cert + precedent M1 (same split) | 2.308 | 0.865 | pass |
| Q2 | 0.2 | D3 cert + precedent M3 (same split, same segment) | 2.281 | 0.865 | pass |
| Q2 | 0.2 | D2 cert + precedent M2 (same winner; broad) | 2.474 | 1.212 | fail |
| Q2 | 0.2 | Do FIFO online + precedent M1, later tasks only | 1.35 | 0.419 | fail |

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
