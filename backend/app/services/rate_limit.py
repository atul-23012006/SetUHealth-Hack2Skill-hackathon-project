"""Shared rate limiter (slowapi). One instance so every router — the public
transparency endpoints and, via ``default_limits``, the officer-console
routers too — is covered by the same abuse protection, not just whichever
router happens to import its own ``Limiter``.

``default_limits`` matters most in demo auth mode (services/auth.py):
``require_console_access`` is a no-op there, so without a default limit the
console routers would have neither authentication nor rate limiting.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
