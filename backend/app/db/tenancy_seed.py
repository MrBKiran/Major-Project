"""
Seed organisations, users and memberships.

Builds a tenancy that actually exercises isolation rather than one org per
kind: two competing dealer groups in the same city, and two OEMs whose parcs
overlap in that network. If the scope layer is wrong, these rows make it show
up as a visible leak rather than a theoretical one.

Demo passwords are intentionally obvious and printed on stdout. They are for a
local demo database only — nothing here should ever ship to a deployment.

Run:  cd backend && python -m app.db.tenancy_seed
"""

from __future__ import annotations

import hashlib

from sqlalchemy import text

from app.auth.principal import hash_password


from app.db.models import (
    FleetRoster,
    Membership,
    OrgBrand,
    Organization,
    User,
)
from app.db.session import SessionLocal, init_db


def user_id_for(email: str) -> str:
    """Stable, collision-free id for a seeded user.

    Derived from the FULL address, not the local part: two dealer groups both
    having an `advisor@` mailbox is completely normal, and keying on the local
    part alone silently merged them into one account — the two advisors ended
    up sharing an identity, which in a tenancy system means sharing a scope.
    The short digest keeps ids unique; the prefix keeps them readable in logs.
    """
    local = email.split("@")[0].replace(".", "")[:10]
    digest = hashlib.sha1(email.lower().encode()).hexdigest()[:6]
    return f"USR-{local}-{digest}"

DEMO_PASSWORD = "autosaarthi"

ORGS = [
    ("ORG-PLATFORM", "AutoSaarthi Platform", "platform", []),
    ("ORG-MAHINDRA", "Mahindra & Mahindra", "oem", ["Mahindra"]),
    ("ORG-HERO", "Hero MotoCorp", "oem", ["Hero"]),
    # Two dealer groups, both servicing Mahindra, in overlapping geography.
    ("ORG-WESTERN", "Western Auto Service Group", "service_network", ["Mahindra", "Hero"]),
    ("ORG-SOUTHERN", "Southern Motors Service", "service_network", ["Mahindra"]),
    ("ORG-RAMAN", "Raman Logistics", "fleet_operator", []),
    ("ORG-CUSTOMERS", "Individual Owners", "customer", []),
]

# Which dealer group runs which centres. Western takes the west/north, Southern
# the south — so a Southern user must never see the Pune hero vehicle.
CENTRE_ORGS = {
    "ORG-WESTERN": ["SC-PUN-01", "SC-PUN-02", "SC-MUM-01", "SC-DEL-01",
                     "SC-JAI-01", "SC-MRT-01", "SC-RJK-01"],
    "ORG-SOUTHERN": ["SC-BLR-01", "SC-BLR-02", "SC-CHN-01", "SC-HYD-01"],
}

USERS = [
    # email, name, org, role
    ("admin@autosaarthi.io", "Platform Admin", "ORG-PLATFORM", "platform_admin"),
    ("soc@autosaarthi.io", "Security Analyst", "ORG-PLATFORM", "security_analyst"),
    ("quality@mahindra.example", "Anjali Rao", "ORG-MAHINDRA", "oem_quality_engineer"),
    ("qmanager@mahindra.example", "Rajeev Menon", "ORG-MAHINDRA", "oem_quality_manager"),
    ("analyst@hero.example", "Hero Analyst", "ORG-HERO", "oem_analyst"),
    ("advisor@westernauto.example", "Suresh Kulkarni", "ORG-WESTERN", "service_advisor"),
    ("manager@westernauto.example", "Meera Joshi", "ORG-WESTERN", "centre_manager"),
    ("tech@westernauto.example", "Imran Shaikh", "ORG-WESTERN", "service_technician"),
    ("advisor@southernmotors.example", "Divya Nair", "ORG-SOUTHERN", "service_advisor"),
    ("ops@ramanlogistics.example", "Karthik Raman", "ORG-RAMAN", "fleet_manager"),
    # Same person, a second legitimate membership: manages the company fleet
    # AND separately owns a personal vehicle. The only multi-membership
    # account in the seed — exists so the org/role switcher (POST
    # /api/auth/switch) and the login-time disambiguation path have something
    # real to exercise instead of only unit-testing the code path in isolation.
    ("ops@ramanlogistics.example", "Karthik Raman", "ORG-CUSTOMERS", "vehicle_owner"),
    ("ramesh.pawar@example.in", "Ramesh Pawar", "ORG-CUSTOMERS", "vehicle_owner"),
    ("aditi.nair@example.in", "Aditi Nair", "ORG-CUSTOMERS", "vehicle_owner"),
]

# Raman Logistics' roster, from vehicles.yaml's fleet_vins.
FLEET_VINS = ["TN09ZZ1010", "TN09ZZ1011", "TN09ZZ1012", "TN09ZZ1013"]


def seed_tenancy(reset: bool = False) -> None:
    init_db()
    with SessionLocal() as session:
        if reset:
            # customers.user_id and service_centers.org_id reference rows we are
            # about to delete, so detach them first rather than relying on a
            # cascade the schema deliberately does not have.
            session.execute(text("UPDATE customers SET user_id = NULL"))
            session.execute(text("UPDATE service_centers SET org_id = NULL"))
            for table in ("memberships", "fleet_roster", "org_brands", "users", "organizations"):
                session.execute(text(f"DELETE FROM {table}"))
            session.flush()

        for org_id, name, kind, brands in ORGS:
            session.merge(Organization(id=org_id, name=name, kind=kind))
            for brand in brands:
                session.merge(OrgBrand(org_id=org_id, oem=brand))
        session.flush()

        for org_id, centres in CENTRE_ORGS.items():
            session.execute(
                text("UPDATE service_centers SET org_id = :o WHERE id = ANY(:ids)"),
                {"o": org_id, "ids": centres},
            )

        for vin in FLEET_VINS:
            session.merge(FleetRoster(org_id="ORG-RAMAN", vin=vin))

        pw = hash_password(DEMO_PASSWORD)
        for email, full_name, org_id, role in USERS:
            uid = user_id_for(email)
            session.merge(User(id=uid, email=email.lower(), password_hash=pw,
                                full_name=full_name, is_active=True))
            session.merge(Membership(user_id=uid, org_id=org_id, role=role))
        session.flush()

        # Link owner records to their logins so `owned` scope resolves.
        session.execute(text(
            "UPDATE customers SET user_id = :u WHERE lower(email) = :e"
        ), [{"u": user_id_for(e), "e": e.lower()}
             for e, _n, _o, r in USERS if r == "vehicle_owner"])

        session.commit()

    print(f"[tenancy] {len(ORGS)} organisations, {len(USERS)} users seeded")
    print(f"[tenancy] demo password for every account: {DEMO_PASSWORD!r} (local only)")


if __name__ == "__main__":
    import sys
    seed_tenancy(reset="--reset" in sys.argv)
