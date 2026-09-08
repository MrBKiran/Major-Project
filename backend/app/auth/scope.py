"""
Row-level scoping.

The single place that answers "which VINs may this principal see". Every query
that returns vehicle-linked data goes through `vin_predicate()` — endpoints do
not write their own filters, because an endpoint that forgets one is a
cross-tenant data leak and there is no way to notice by reading the endpoint.

Each resolver returns a SQL fragment plus bind params rather than a VIN list:
a dealer group with 40k vehicles must not have its whole roster pulled into
Python to filter one query.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text

from app.auth.principal import Principal
from app.db.session import engine


@dataclass(frozen=True)
class ScopeFilter:
    """A WHERE fragment over a query exposing a `vin` column."""

    sql: str
    params: dict

    @property
    def is_unrestricted(self) -> bool:
        return self.sql == "TRUE"

    def apply(self, base_sql: str, alias: str = "v") -> str:
        return base_sql.replace("/*SCOPE*/", self.sql.replace("{alias}", alias))


# Resolvers keyed by the org_kind's `scope` value in access_policy.yaml.
# Adding an org kind means adding a resolver here; a missing one denies rather
# than defaulting open.

def _scope_all(_p: Principal) -> ScopeFilter:
    return ScopeFilter("TRUE", {})


def _scope_brand(p: Principal) -> ScopeFilter:
    if not p.brands:
        return ScopeFilter("FALSE", {})
    return ScopeFilter("{alias}.oem = ANY(:scope_brands)", {"scope_brands": p.brands})


def _scope_centres(p: Principal) -> ScopeFilter:
    """Vehicles connected to this dealer group's centres.

    Either booked at one of them, or holding one as the owner's preferred
    centre — the second clause matters because a vehicle the network is about
    to be asked to service has no appointment row yet.
    """
    if not p.center_ids:
        return ScopeFilter("FALSE", {})
    sql = (
        "({alias}.vin IN (SELECT a.vin FROM appointments a "
        "               WHERE a.center_id = ANY(:scope_centres))"
        " OR {alias}.owner_id IN (SELECT c.id FROM customers c "
        "               WHERE c.pref_center_id = ANY(:scope_centres)))"
    )
    return ScopeFilter(sql, {"scope_centres": p.center_ids})


def _scope_fleet(p: Principal) -> ScopeFilter:
    if not p.fleet_vins:
        return ScopeFilter("FALSE", {})
    return ScopeFilter("{alias}.vin = ANY(:scope_vins)", {"scope_vins": p.fleet_vins})


def _scope_owned(p: Principal) -> ScopeFilter:
    if not p.customer_ids:
        return ScopeFilter("FALSE", {})
    return ScopeFilter("{alias}.owner_id = ANY(:scope_customers)",
                        {"scope_customers": p.customer_ids})


_RESOLVERS = {
    "all": _scope_all,
    "brand": _scope_brand,
    "centres": _scope_centres,
    "fleet": _scope_fleet,
    "owned": _scope_owned,
}


def vin_predicate(principal: Principal) -> ScopeFilter:
    resolver = _RESOLVERS.get(principal.scope_kind)
    if resolver is None:
        # Unknown scope kind denies. Failing closed is the only safe default
        # for an authorisation layer.
        return ScopeFilter("FALSE", {})
    return resolver(principal)


def can_access_vin(principal: Principal, vin: str) -> bool:
    """Single-VIN check, for detail routes and for agent runs."""
    scope = vin_predicate(principal)
    if scope.is_unrestricted:
        return True
    sql = text(
        "SELECT 1 FROM vehicles v WHERE v.vin = :vin AND "
        + scope.sql.replace("{alias}", "v")
        + " LIMIT 1"
    )
    with engine.connect() as conn:
        return conn.execute(sql, {"vin": vin, **scope.params}).first() is not None


def hydrate(principal: Principal) -> Principal:
    """Fill in the org's concrete scope members.

    Done once per request at authentication time rather than per query — these
    are small, stable sets and re-reading them per call would put three extra
    round trips on every endpoint.
    """
    kind = principal.scope_kind
    with engine.connect() as conn:
        if kind == "brand":
            principal.brands = [
                r[0] for r in conn.execute(
                    text("SELECT oem FROM org_brands WHERE org_id = :o"),
                    {"o": principal.org_id}).all()
            ]
        elif kind == "centres":
            principal.center_ids = [
                r[0] for r in conn.execute(
                    text("SELECT id FROM service_centers WHERE org_id = :o"),
                    {"o": principal.org_id}).all()
            ]
        elif kind == "fleet":
            principal.fleet_vins = [
                r[0] for r in conn.execute(
                    text("SELECT vin FROM fleet_roster WHERE org_id = :o"),
                    {"o": principal.org_id}).all()
            ]
        elif kind == "owned":
            principal.customer_ids = [
                r[0] for r in conn.execute(
                    text("SELECT id FROM customers WHERE user_id = :u"),
                    {"u": principal.user_id}).all()
            ]
    return principal
