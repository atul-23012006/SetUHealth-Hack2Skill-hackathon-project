"""Token authentication: login, signed sessions, route protection, and the ways
a caller might try to get around them."""
import logging
import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import auth, db

client = TestClient(app)
PASSWORD = "correct-horse-battery"
SECRET = "test-secret-that-is-long-enough-for-hs256-tests"


@pytest.fixture
def token_mode(monkeypatch, temp_db):
    monkeypatch.setattr(auth.settings, "auth_mode", "token")
    monkeypatch.setattr(auth.settings, "jwt_secret", SECRET)
    monkeypatch.setattr(auth.settings, "demo_user_password", PASSWORD)
    monkeypatch.setattr(auth.settings, "token_ttl_hours", 8)
    return temp_db


def login(user_id="national_admin", password=PASSWORD):
    return client.post("/api/auth/login", json={"user_id": user_id, "password": password})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_token(token_mode):
    return login().json()["access_token"]


# ---------------------------------------------------------------- passwords

def test_password_hashes_are_salted_and_verify():
    a, b = auth.hash_password("pw"), auth.hash_password("pw")
    assert a != b and a.startswith("scrypt$")
    assert auth.verify_password("pw", a) and not auth.verify_password("other", a)
    assert not auth.verify_password("pw", "not-a-hash") and not auth.verify_password("pw", "md5$1$2$3$4$5")


# ---------------------------------------------------------------- login

def test_login_returns_a_signed_short_lived_token(token_mode):
    r = login()
    assert r.status_code == 200
    body = r.json()
    claims = jwt.decode(body["access_token"], SECRET, algorithms=["HS256"], issuer="setuhealth")
    assert claims["sub"] == "national_admin" and claims["exp"] - claims["iat"] == 8 * 3600
    assert body["user"]["role"] == "national_admin" and "password_hash" not in body["user"]
    assert body["expires_in"] == 8 * 3600


def test_wrong_password_and_unknown_user_get_the_same_generic_error(token_mode):
    bad_pw = login(password="nope")
    no_user = login(user_id="ghost", password="nope")
    assert bad_pw.status_code == no_user.status_code == 401
    assert bad_pw.json() == no_user.json() == {"detail": "Invalid user id or password"}


def test_failed_and_successful_logins_are_audited_without_the_password(token_mode):
    login(password="wrong-guess-123")
    login()
    events = db.list_events(limit=20)
    assert any(e["kind"] == "login_failed" for e in events) and any(e["kind"] == "login" for e in events)
    assert "wrong-guess-123" not in str(events)


def test_login_is_rate_limited_per_ip(token_mode):
    codes = [login(password="nope").status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_login_is_refused_in_demo_mode():
    assert client.post("/api/auth/login", json={"user_id": "national_admin", "password": "x"}).status_code == 400


def test_disabled_account_cannot_log_in_or_use_an_existing_token(token_mode, admin_token):
    token_mode.user_set_active("national_admin", False)
    assert login().status_code == 401
    assert client.get("/api/alerts", headers=bearer(admin_token)).status_code == 401   # cut off immediately


# ---------------------------------------------------------------- seeding

def test_seeding_is_idempotent_and_uses_the_configured_password(token_mode):
    auth.ensure_seeded()
    n = db.user_count()
    assert n == len(auth.USERS)
    auth.ensure_seeded()
    assert db.user_count() == n
    assert auth.verify_password(PASSWORD, db.user_get("phc_operator_001")["password_hash"])


def test_without_a_configured_password_a_random_one_is_generated_and_logged_once(monkeypatch, temp_db, caplog):
    monkeypatch.setattr(auth.settings, "auth_mode", "token")
    monkeypatch.setattr(auth.settings, "demo_user_password", "")
    with caplog.at_level(logging.WARNING, logger="app.services.auth"):
        auth.ensure_seeded()
    line = next(r.getMessage() for r in caplog.records if "generated password" in r.getMessage())
    generated = line.split("accounts: ")[1].split(" ")[0]
    assert len(generated) >= 12 and generated != "setu-demo"
    assert auth.authenticate("national_admin", generated)["user_id"] == "national_admin"


# ---------------------------------------------------------------- route protection

def test_console_routes_require_a_session_in_token_mode(token_mode):
    for path in ("/api/alerts", "/api/phcs", "/api/forecast", "/api/redistribution", "/api/transfers",
                 "/api/audit", "/api/federated/national", "/api/notifications", "/api/auth/users"):
        r = client.get(path)
        assert r.status_code == 401, path
        assert r.headers["www-authenticate"] == "Bearer"


def test_console_routes_work_with_a_valid_token(admin_token):
    for path in ("/api/alerts", "/api/phcs", "/api/notifications", "/api/auth/users"):
        assert client.get(path, headers=bearer(admin_token)).status_code == 200, path


def test_open_routes_stay_open_in_token_mode(token_mode):
    for path in ("/api/health", "/api/auth/config", "/api/public/national", "/api/live/benchmarks/catalog"):
        assert client.get(path).status_code == 200, path
    assert client.get("/api/auth/config").json() == {"mode": "token"}


def test_demo_mode_is_unchanged_and_needs_no_token():
    assert client.get("/api/alerts").status_code == 200
    assert client.get("/api/auth/config").json() == {"mode": "demo"}


# ---------------------------------------------------------------- attacks

def test_the_demo_header_cannot_be_used_to_impersonate_in_token_mode(token_mode):
    spoof = {"X-User-Id": "national_admin"}
    assert client.get("/api/alerts", headers=spoof).status_code == 401
    r = client.post("/api/transfers", json={"from_phc_id": "PHC-0001", "to_phc_id": "PHC-0002", "medicine": "Paracetamol 500mg", "quantity": 1}, headers=spoof)
    assert r.status_code == 401


def test_tampered_forged_and_expired_tokens_are_rejected(token_mode, admin_token):
    header, payload, sig = admin_token.split(".")
    assert client.get("/api/alerts", headers=bearer(f"{header}.{payload}.{sig[:-3]}abc")).status_code == 401       # tampered signature
    forged = jwt.encode({"sub": "national_admin", "iat": int(time.time()), "exp": int(time.time()) + 3600, "iss": "setuhealth"}, "some-other-secret-value-1234567890abcdef", algorithm="HS256")
    assert client.get("/api/alerts", headers=bearer(forged)).status_code == 401                                       # wrong key
    expired = jwt.encode({"sub": "national_admin", "iat": 1, "exp": 2, "iss": "setuhealth"}, SECRET, algorithm="HS256")
    assert client.get("/api/alerts", headers=bearer(expired)).status_code == 401
    wrong_issuer = jwt.encode({"sub": "national_admin", "exp": int(time.time()) + 3600, "iss": "someone-else"}, SECRET, algorithm="HS256")
    assert client.get("/api/alerts", headers=bearer(wrong_issuer)).status_code == 401
    none_alg = jwt.encode({"sub": "national_admin", "exp": int(time.time()) + 3600, "iss": "setuhealth"}, None, algorithm="none")
    assert client.get("/api/alerts", headers=bearer(none_alg)).status_code == 401                                    # alg=none downgrade
    assert client.get("/api/alerts", headers={"Authorization": "Bearer "}).status_code == 401
    assert client.get("/api/alerts", headers={"Authorization": "Basic abc"}).status_code == 401


def test_a_token_for_a_user_that_does_not_exist_is_rejected(token_mode):
    ghost = jwt.encode({"sub": "ghost", "iat": int(time.time()), "exp": int(time.time()) + 3600, "iss": "setuhealth"}, SECRET, algorithm="HS256")
    assert client.get("/api/alerts", headers=bearer(ghost)).status_code == 401


# ---------------------------------------------------------------- authorization still applies

def test_roles_are_enforced_through_token_sessions(token_mode):
    operator = login("phc_operator_001").json()["access_token"]                    # may only move stock out of PHC-0001
    out_of_scope = client.post("/api/transfers", headers=bearer(operator),
                               json={"from_phc_id": "PHC-0002", "to_phc_id": "PHC-0001", "medicine": "Paracetamol 500mg", "quantity": 1})
    assert out_of_scope.status_code == 403

    admin = login("national_admin").json()["access_token"]
    allowed = client.post("/api/transfers", headers=bearer(admin),
                          json={"from_phc_id": "PHC-0002", "to_phc_id": "PHC-0001", "medicine": "Paracetamol 500mg", "quantity": 10**9})
    assert allowed.status_code == 400 and "Donor has only" in allowed.json()["detail"]   # passed authorization, then failed validation (no stock moved)


def test_me_returns_the_token_user(admin_token):
    me = client.get("/api/auth/me", headers=bearer(admin_token)).json()["user"]
    assert me["user_id"] == "national_admin" and "password_hash" not in me


# ---------------------------------------------------------------- admin CLI

def test_cli_sets_a_password_and_can_disable_an_account(token_mode, monkeypatch, capsys):
    from app.scripts import manage_users

    monkeypatch.setattr(manage_users.getpass, "getpass", lambda prompt="": "a-much-better-password")
    assert manage_users.main(["set-password", "phc_operator_001"]) == 0
    assert login("phc_operator_001", "a-much-better-password").status_code == 200
    assert login("phc_operator_001", PASSWORD).status_code == 401           # the old password no longer works
    assert login("national_admin", PASSWORD).status_code == 200            # other accounts untouched

    assert manage_users.main(["deactivate", "phc_operator_001"]) == 0
    assert login("phc_operator_001", "a-much-better-password").status_code == 401
    assert manage_users.main(["activate", "phc_operator_001"]) == 0
    assert login("phc_operator_001", "a-much-better-password").status_code == 200


def test_cli_refuses_short_or_mismatched_passwords_and_unknown_users(token_mode, monkeypatch):
    from app.scripts import manage_users

    monkeypatch.setattr(manage_users.getpass, "getpass", lambda prompt="": "short")
    with pytest.raises(SystemExit, match="at least 10"):
        manage_users.main(["set-password", "national_admin"])
    answers = iter(["long-enough-password", "different-password!"])
    monkeypatch.setattr(manage_users.getpass, "getpass", lambda prompt="": next(answers))
    with pytest.raises(SystemExit, match="did not match"):
        manage_users.main(["set-password", "national_admin"])
    with pytest.raises(SystemExit, match="No such user"):
        manage_users.main(["deactivate", "ghost"])
    assert login("national_admin", PASSWORD).status_code == 200            # nothing was changed
