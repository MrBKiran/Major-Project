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

# Every way of signing in that a role's `login_methods` may name.
LOGIN_METHODS = ("password", "google", "phone_otp")


@dataclass(frozen=True)
class RoleSpec:
    name: str
    display_name: str
    org_kinds: tuple[str, ...]
    grants: frozenset[str]
    # The restrictive defaults: a role that says nothing gets passwords only, and
    # needs a second factor once MFA is enforced.
    login_methods: frozenset[str] = frozenset({"password"})
    mfa_required: bool = True

    def allows(self, permission: str) -> bool:
        return WILDCARD in self.grants or permission in self.grants


class AccessPolicy:
    def __init__(self, doc: dict | None = None) -> None:
        """Load the policy from YAML, or from `doc` (used by tests to build one)."""
        self._doc: dict = {}
        self.roles: dict[str, RoleSpec] = {}
        self._build(doc if doc is not None else self._read())

    @staticmethod
    def _read() -> dict:
        return yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8"))

    def reload(self) -> None:
        self._build(self._read())

    def _build(self, doc: dict) -> None:
        roles: dict[str, RoleSpec] = {}
        for name, spec in doc.get("roles", {}).items():
            methods = spec.get("login_methods", ["password"])
            unknown = sorted(set(methods) - set(LOGIN_METHODS))
            if unknown:
                # Fail at load. A typo would otherwise silently mean "this role
                # cannot sign in that way" and only be noticed by the person locked out.
                raise ValueError(
                    f"role {name!r} lists unknown login method(s) {unknown}; "
                    f"valid methods are {list(LOGIN_METHODS)}")
            roles[name] = RoleSpec(
                name=name,
                display_name=spec.get("display_name", name),
                org_kinds=tuple(spec.get("org_kinds", [])),
                grants=frozenset(spec.get("grants", [])),
                login_methods=frozenset(methods),
                mfa_required=bool(spec.get("mfa_required", True)),
            )
        self._doc, self.roles = doc, roles

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

    def role_allows_method(self, role: str, method: str) -> bool:
        """May a session in `role` be established by this sign-in method?"""
        spec = self.roles.get(role)
        return bool(spec and method in spec.login_methods)

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
                "login_methods": sorted(r.login_methods),
                "mfa_required": r.mfa_required,
                "permissions": {p: r.allows(p) for p in perms},
            }
            for r in self.roles.values()
        ]


@lru_cache(maxsize=1)
def get_policy() -> AccessPolicy:
    return AccessPolicy()
