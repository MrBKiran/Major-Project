"""Test doubles for the things the auth code talks to outside the process."""

from __future__ import annotations

from dataclasses import dataclass, field


class FakeGoogle:
    """Stands in for Google's token verification.

    Maps a credential string to the claims Google would have vouched for; any other
    credential is one Google would have rejected. Injected through FastAPI's
    dependency overrides, which is only possible because the suite drives the app
    in-process.
    """

    def __init__(self) -> None:
        self.accounts: dict[str, object] = {}
        self.unavailable = False
        self.calls: list[str] = []

    def add(self, credential: str, *, sub: str, email: str, email_verified: bool = True,
            name: str = "Test Person"):
        from app.auth.google import GoogleClaims

        self.accounts[credential] = GoogleClaims(
            sub=sub, email=email, email_verified=email_verified, name=name)
        return credential

    def verify(self, credential: str):
        from app.auth.google import GoogleUnavailable, GoogleVerificationError

        self.calls.append(credential)
        if self.unavailable:
            raise GoogleUnavailable("google could not be reached")
        try:
            return self.accounts[credential]
        except KeyError:
            raise GoogleVerificationError("not a token Google issued") from None


@dataclass
class SentSms:
    to: str
    body: str


@dataclass
class FakeSmsSender:
    """Records what would have been texted, and can be told to fail."""

    sent: list[SentSms] = field(default_factory=list)
    fail: bool = False

    def send(self, to: str, body: str) -> None:
        if self.fail:
            raise RuntimeError("provider is down")
        self.sent.append(SentSms(to=to, body=body))

    def codes_for(self, to: str) -> list[str]:
        """The 6-digit codes texted to `to`, oldest first."""
        import re

        return [m.group(0) for s in self.sent if s.to == to
                for m in [re.search(r"\b\d{6}\b", s.body)] if m]
