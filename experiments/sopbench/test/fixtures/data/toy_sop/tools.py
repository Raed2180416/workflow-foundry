# Test fixture for experiments/sopbench (not SOP-Bench code): the same shape as an upstream tools.py.
import os
import pandas as pd


class ToySopManager:
    DATASET_CSV_FILE = "test_set_with_outputs.csv"

    def __init__(self):
        self.dataset_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), self.DATASET_CSV_FILE)
        print(f"Dataset file path: {self.dataset_file_path}")

    def get_item(self, item_id):
        df = pd.read_csv(self.dataset_file_path)
        m = df[df["item_id"] == item_id]
        if m.empty:
            raise ValueError(f"No item found with ID: {item_id}")
        r = m.iloc[0]
        return {"item_id": item_id, "qty": int(r["qty"]), "price": float(r["price"])}

    def count_np(self, item_id):
        df = pd.read_csv(self.dataset_file_path)
        return df[df["item_id"] == item_id]["qty"].iloc[0]

    def stub_tool(self, item_id):
        pass

    def process_tool_call(self, tool_name, tool_input):
        return {"get_item": self.get_item, "count_np": self.count_np, "stub_tool": self.stub_tool}[tool_name](**tool_input)
