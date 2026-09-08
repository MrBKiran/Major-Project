"""
Principal access policy — loads config/access_policy.yaml and answers
"may this principal do X?".

Deliberately mirrors the shape of app/ueba/policy.py so the two read the same
way, but they answer different questions and are never substituted for one
another. See the header of access_policy.yaml.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
POLICY_PATH = ROOT / "config" / "access_policy.yaml"

WILDCARD = "*"


@dataclass(frozen=True)
class RoleSpec:
    name: str
    display_name: str
    org_kinds: tuple[str, ...]
    grants: frozenset[str]

    def allows(self, permission: str) -> bool:
        return WILDCARD in self.grants or permission in self.grants


class AccessPolicy:
    def __init__(self) -> None:
        self._doc: dict = {}
        self.roles: dict[str, RoleSpec] = {}
        self.reload()

    def reload(self) -> None:
        self._doc = yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8"))
        self.roles = {
            name: RoleSpec(
                name=name,
                display_name=spec.get("display_name", name),
                org_kinds=tuple(spec.get("org_kinds", [])),
                grants=frozenset(spec.get("grants", [])),
            )
            for name, spec in self._doc.get("roles", {}).items()
        }

    # ── queries ────────────────────────────────────────────────────────────

    @property
    def permissions(self) -> list[str]:
        return list(self._doc.get("permissions", []))

    def scope_kind(self, org_kind: str) -> str:
        """Which scope resolver applies to an org of this kind."""
        return (self._doc.get("org_kinds", {}).get(org_kind) or {}).get("scope", "none")

    def role(self, name: str) -> RoleSpec | None:
        return self.roles.get(name)

    def role_valid_for(self, role: str, org_kind: str) -> bool:
        spec = self.roles.get(role)
        return bool(spec and org_kind in spec.org_kinds)

    def redacted_fields(self, missing_permission: str) -> tuple[list[str], str]:
        rule = (self._doc.get("redaction") or {}).get(missing_permission) or {}
        return list(rule.get("redact_fields", [])), rule.get("replacement", "[redacted]")

    @property
    def delegation(self) -> dict:
        return self._doc.get("agent_delegation") or {}

    def matrix(self) -> list[dict]:
        """Role x permission grid — renders as the admin console's RBAC panel."""
        perms = self.permissions
        return [
            {
                "role": r.name,
                "display_name": r.display_name,
                "org_kinds": list(r.org_kinds),
                "permissions": {p: r.allows(p) for p in perms},
            }
            for r in self.roles.values()
        ]


@lru_cache(maxsize=1)
def get_policy() -> AccessPolicy:
    return AccessPolicy()
