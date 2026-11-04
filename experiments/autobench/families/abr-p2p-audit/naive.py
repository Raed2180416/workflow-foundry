"""Naive control (<= 40 lines): approve on PO + receipt + exact supplier; pay approved invoices at each run. No SoD,
no duplicates, no tolerance edition, no quantity accounting."""
from abr.lib.factory.store import store_for

SS = "sheet-ap"


def num(s):
    try:
        return float(str(s).replace("$", "").replace("USD", "").replace(",", "").strip())
    except ValueError:
        return 0.0


def handle(p, ctx):
    st, d = store_for(ctx), p.get("data") or {}
    if p.get("event") == "new_row" and d.get("worksheet") == "Invoices":
        inv = d["row"]
        po = next((x for x in st.rows(SS, "Purchase Orders") if x["PO ID"] == inv["PO ID"]), None)
        gr = [g for g in st.rows(SS, "Goods Receipts") if g["PO ID"] == inv["PO ID"]]
        ok = po and gr and po["Supplier ID"] == inv["Supplier ID"] and num(inv["Unit Price"]) <= num(po["Unit Price"]) * 1.02
        cells = {"Status": "Approved" if ok else "Hold", "Decided At": p["at"]}
        if not ok:
            cells["Hold Reason"] = "PRICE"
            st.post("ap-holds", f"HOLD {inv['Invoice ID']} PRICE")
        st.set_cells(SS, "Invoices", "Invoice ID", inv["Invoice ID"], cells)
    elif p.get("event") == "payment_run":
        due = [x for x in st.rows(SS, "Invoices") if x["Status"] == "Approved"]
        for x in due:
            st.append(SS, "Payment Runs", [p["at"][:10], x["Invoice ID"], f"{num(x['Amount']):.2f}"])
            st.set_cells(SS, "Invoices", "Invoice ID", x["Invoice ID"], {"Status": "Paid", "Paid At": p["at"]})
        if due:
            st.post("ap-payments", f"PAYMENT RUN {p['at'][:10]} count={len(due)} total={sum(num(x['Amount']) for x in due):.2f}")
    st.flush()
