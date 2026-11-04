# DUR-1 report (development evidence; owner table first)

- Q1 good enough in the worst case? [D-5, D-11]: PARTIAL
- Q2 adapts and heals as it does real work? [D-1 (primary), D-6, D-10]: FALSIFIED; detection FAIL; unknown NOT SHOWN
- Q3 performance tested as it changes? [reported]: curves per arm (see below)
- Q4 durable state >= a human's? [D-4]: NOT RUN
- Q5 versus a per-tick agent; beat Opus at a fraction of the cost? [D-3 (primary), D-2, D-7]: SUPPORTED; cost PASS
- Q6 runs expose flaws in a hand-crafted workflow? [D-8]: NOT SHOWN
- Q7 every failure figured out? [§14.3]: LEDGER INCOMPLETE (0/36 records analyst-reviewed): no result text

## Rules
- K0: pass
- D1: FALSIFIED (p 0.5000)
- D3: SUPPORTED (p 0.0000)
- D2: PASS
- D4: NOT RUN
- D5: PARTIAL
- D5noComplaints: PARTIAL
- D6: FAIL
- D6noComplaints: FAIL
- D6noM2: FAIL
- D6noM2noComplaints: FAIL
- m6: N
- D7: NOT RUN
- D8: NOT SHOWN
- D9: descriptive
- D10: NOT SHOWN
- D11: NO VALUE SHOWN

Cells: 6 heal-requiring; durable 2/6; certified-durable 0/6
Root-cause ledger: 36 records (INCOMPLETE: 0/36 analyst-reviewed)