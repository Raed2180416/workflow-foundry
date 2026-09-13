"""Original Foundry JSON semantics for the qualified Python export profile."""
from __future__ import annotations

import copy
import json
import math
import re
from typing import Any

from jsonschema import Draft7Validator


class FoundryError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


def data(value: Any, max_bytes: int = 2 * 1024 * 1024) -> Any:
    count = 0

    def walk(item: Any, depth: int) -> None:
        nonlocal count
        count += 1
        if count > 200_000 or depth > 40:
            raise FoundryError("DATA_LIMIT", "Data is too complex")
        if item is None or type(item) is bool:
            return
        if type(item) is str:
            if any(0xD800 <= ord(character) <= 0xDFFF for character in item):
                raise FoundryError("DATA_STRING", "Unpaired Unicode surrogate")
            return
        if type(item) in (int, float):
            if not math.isfinite(item) or (int(item) == item and abs(item) > 2**53 - 1):
                raise FoundryError("DATA_NUMBER", "Unsupported numeric value")
            return
        if type(item) is list:
            for child in item:
                walk(child, depth + 1)
            return
        if type(item) is not dict:
            raise FoundryError("DATA_TYPE", "Only JSON data is permitted")
        for key, child in item.items():
            if type(key) is not str or key in ("__proto__", "prototype", "constructor"):
                raise FoundryError("DATA_KEY", "Forbidden object key")
            walk(key, depth + 1)
            walk(child, depth + 1)

    walk(value, 0)
    # ensure_ascii=False matches JS byte accounting for normal Unicode. Escaped
    # lone surrogates are counted as six bytes, as in JSON.stringify.
    encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if len(encoded.encode("utf-8", errors="backslashreplace")) > max_bytes:
        raise FoundryError("DATA_LIMIT", "Data exceeds the byte limit")
    return value


def equal(left: Any, right: Any) -> bool:
    if type(left) in (int, float) and type(right) in (int, float):
        return left == right
    if type(left) is not type(right):
        return False
    if type(left) is list:
        return len(left) == len(right) and all(equal(a, b) for a, b in zip(left, right))
    if type(left) is dict:
        return left.keys() == right.keys() and all(equal(left[k], right[k]) for k in left)
    return left == right


def resolve(template: Any, context: dict[str, Any]) -> Any:
    if type(template) is list:
        return [resolve(item, context) for item in template]
    if type(template) is dict:
        if "$ref" in template:
            reference = template["$ref"]
            if not isinstance(reference, str) or not re.fullmatch(r"(input|nodes)(\.[A-Za-z0-9_-]+)*", reference) or any(k not in ("$ref", "default") for k in template):
                raise FoundryError("INVALID_REFERENCE", "Invalid reference")
            current: Any = context
            for part in reference.split("."):
                if part in ("__proto__", "prototype", "constructor"):
                    raise FoundryError("INVALID_REFERENCE", "Forbidden reference")
                if type(current) is dict and part in current:
                    current = current[part]
                elif type(current) is list and part == "length":
                    current = len(current)
                elif type(current) is list and re.fullmatch(r"0|[1-9][0-9]*", part) and int(part) < len(current):
                    current = current[int(part)]
                elif "default" in template:
                    return copy.deepcopy(template["default"])
                else:
                    raise FoundryError("MISSING_REFERENCE", reference)
            return copy.deepcopy(current)
        return {key: resolve(value, context) for key, value in template.items()}
    return template


def condition(test: dict[str, Any], context: dict[str, Any]) -> bool:
    op = test["op"]
    if op == "all":
        return all(condition(c, context) for c in test["conditions"])
    if op == "any":
        return any(condition(c, context) for c in test["conditions"])
    if op == "not":
        return not condition(test["condition"], context)
    if op == "exists":
        try:
            resolve(test["value"], context)
            return True
        except FoundryError as error:
            if error.code == "MISSING_REFERENCE":
                return False
            raise
    left, right = resolve(test["left"], context), resolve(test["right"], context)
    if op == "eq":
        return equal(left, right)
    if op == "ne":
        return not equal(left, right)
    if op in ("gt", "gte", "lt", "lte"):
        if type(left) not in (int, float) or type(right) not in (int, float):
            raise FoundryError("INVALID_CONDITION", "Numeric comparison requires numbers")
        return {"gt": left > right, "gte": left >= right, "lt": left < right, "lte": left <= right}[op]
    if op == "in":
        if type(right) is not list:
            raise FoundryError("INVALID_CONDITION", "in requires an array")
        return any(equal(left, value) for value in right)
    if op == "contains":
        if type(left) is list:
            return any(equal(right, value) for value in left)
        if type(left) is str and type(right) is str:
            return right in left
    raise FoundryError("INVALID_CONDITION", "Unsupported condition")


def schema_subset(schema: Any, depth: int = 0) -> None:
    if depth > 25:
        raise FoundryError("SCHEMA_LIMIT", "Schema is too deep")
    if type(schema) is bool:
        return
    allowed = {"type", "properties", "required", "additionalProperties", "items",
               "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties",
               "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
               "enum", "const", "allOf", "anyOf", "oneOf", "not", "title", "description", "default", "examples", "$comment"}
    if type(schema) is not dict or any(key not in allowed for key in schema):
        raise FoundryError("UNSUPPORTED_SCHEMA", "Schema is outside the portable subset")
    for child in schema.get("properties", {}).values():
        schema_subset(child, depth + 1)
    for key in ("items", "additionalProperties", "not"):
        if key in schema:
            schema_subset(schema[key], depth + 1)
    for key in ("allOf", "anyOf", "oneOf"):
        for child in schema.get(key, []):
            schema_subset(child, depth + 1)


def validate(schema: dict[str, Any], value: Any) -> None:
    data(value)
    Draft7Validator.check_schema(schema)
    schema_subset(schema)
    if not Draft7Validator(schema).is_valid(value):
        raise FoundryError("SCHEMA_MISMATCH", "Value does not satisfy its schema")
