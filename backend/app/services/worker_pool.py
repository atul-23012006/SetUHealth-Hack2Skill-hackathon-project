"""One shared process pool for CPU-bound work that's naturally split into many
independent pieces: the redistribution LP per resource (see redistribution.py)
and the Holt's-smoothing fit per facility/medicine (see forecasting.py). Both
are otherwise GIL-bound in a single process — a thread pool overlaps the I/O
(subprocess wait, pandas/numpy calls that release the GIL) but not the pure
Python cost of building each problem, which is where most of the wall-clock
time actually goes; see redistribution.py's module docstring for the numbers
that led to this.

A single pool is shared (not one per caller) because workers are stateless
and interchangeable — whichever caller submits a task gets it run on whatever
worker is free, and CPU cores don't need to be reserved per subsystem.
"""
import multiprocessing
import os
from collections.abc import Callable
from concurrent.futures import Future, ProcessPoolExecutor

# Capped at 8: a handful more workers than most deployment targets have cores
# is fine (they just queue), but hundreds would not be — this is a ceiling,
# not a target. More workers than CPU cores oversubscribes the CPU-bound half
# of the work for no benefit (measured no improvement past core count on a
# 4-core box).
POOL_WORKERS = min(os.cpu_count() or 4, 8)

_POOL: ProcessPoolExecutor | None = None


def get_pool() -> ProcessPoolExecutor:
    global _POOL
    if _POOL is None:
        # mp_context="spawn", not the Linux default "fork": forking a
        # multi-threaded process (uvicorn's event loop + its own thread pool
        # for sync routes, exactly what submits to this pool) is a known
        # source of intermittent deadlocks in the child — Python itself warns
        # about it. spawn starts a fresh interpreter per worker instead,
        # slightly slower to launch but without that hazard.
        _POOL = ProcessPoolExecutor(
            max_workers=POOL_WORKERS,
            mp_context=multiprocessing.get_context("spawn"),
        )
    return _POOL


def _noop() -> None:
    """Submitted once per worker at startup purely to force it to actually
    spawn — a ProcessPoolExecutor doesn't start workers at construction, only
    lazily on first submit, so just building the pool warms nothing."""
    return None


def warm_pool() -> None:
    """Force every worker to spawn now — including finishing each worker's
    import of this module's callers (redistribution.py, forecasting.py),
    which reloads the generated dataset once per worker — before the first
    real request arrives, not during it. Called from app.main's lifespan
    startup, off the event loop thread since it blocks for the full warmup."""
    pool = get_pool()
    futures = [pool.submit(_noop) for _ in range(POOL_WORKERS)]
    for fut in futures:
        fut.result()


def shutdown_pool() -> None:
    """Called from app.main's lifespan shutdown so worker processes exit with
    the server, not left running past a graceful stop/reload."""
    global _POOL
    if _POOL is not None:
        _POOL.shutdown(wait=False, cancel_futures=True)
        _POOL = None


def map_unordered[T](fn: Callable[..., T], arg_tuples: list[tuple]) -> list[Future]:
    """Submit one task per argument tuple and return the Futures in submission
    order (not necessarily completion order) — callers that need the results
    in a particular order zip them back against their own inputs, since the
    pool doesn't know or care what those are."""
    pool = get_pool()
    return [pool.submit(fn, *args) for args in arg_tuples]
