"""forecast_all() and redistribution.recommend_all() dispatch their per-item
work (one Holt's-smoothing fit per facility/medicine; one LP solve per
resource) across the shared process pool in services/worker_pool.py instead
of computing serially in-process. These tests confirm the parallel path
produces the same results as the single-item, cache-checking functions it's
meant to warm — the thing most worth locking down given how much more moving
parts a process pool has than a plain loop."""
import pytest

from app.services import forecasting, redistribution, store, worker_pool


@pytest.fixture(autouse=True)
def _shutdown_pool_after():
    """Every test gets a fresh pool state; nothing here should leak workers
    into the next test file. mp_context="spawn" workers persist across the
    tests inside this file (that reuse is the whole point), just not beyond it."""
    yield
    worker_pool.shutdown_pool()


def test_forecast_all_matches_forecast_medicine_for_every_item():
    forecasting.clear_forecast_cache()
    parallel_results = forecasting.forecast_all()
    assert len(parallel_results) > 0

    # forecast_medicine is now a cache hit for everything forecast_all just
    # computed — this both confirms forecast_all populated the per-item cache
    # (not just its own "all_None" entry) and gives a value to compare against.
    for r in parallel_results:
        single = forecasting.forecast_medicine(r["phc_id"], r["medicine"])
        assert single == r


def test_forecast_all_result_is_deterministic_across_cold_runs():
    forecasting.clear_forecast_cache()
    first = {(r["phc_id"], r["medicine"]): r for r in forecasting.forecast_all()}
    forecasting.clear_forecast_cache()
    worker_pool.shutdown_pool()  # force a fresh pool too, not just a fresh cache
    second = {(r["phc_id"], r["medicine"]): r for r in forecasting.forecast_all()}
    assert first == second


def test_forecast_all_state_filter_matches_unfiltered_subset():
    forecasting.clear_forecast_cache()
    national = forecasting.forecast_all()
    some_state = next(s for s in store.states() if s)
    forecasting.clear_forecast_cache()
    scoped = forecasting.forecast_all(some_state)
    expected = [r for r in national if r["state"] == some_state]
    assert {(r["phc_id"], r["medicine"]) for r in scoped} == {(r["phc_id"], r["medicine"]) for r in expected}


def test_recommend_all_pre_cap_recs_match_recommend_for_medicine_per_resource():
    # recommend_all runs each resource's LP in a worker process via a plain
    # snapshot (see redistribution._solve_medicine's docstring); this checks
    # that snapshot round-trip against the single-process, cache-reading path
    # for a resource small enough to still solve deficits/surplus with no
    # cross-medicine donor cap in play (so the two are directly comparable
    # without reimplementing recommend_all's post-processing here).
    forecasting.clear_forecast_cache()
    forecasts = forecasting.forecast_all()
    resource = min(
        store.resource_stock_keys(),
        key=lambda rk: len([f for f in forecasts if f["medicine"] == rk]),
    )

    facilities = redistribution._facility_snapshot()
    stock_meta = redistribution._stock_meta_snapshot(resource)
    tier = store.resource_type(resource).tier if store.resource_type(resource) else 3
    resource_forecasts = [f for f in forecasts if f["medicine"] == resource]

    via_worker_snapshot = redistribution._solve_medicine(resource, resource_forecasts, facilities, stock_meta, tier)
    via_single_process = redistribution.recommend_for_medicine(resource, forecasts)

    def key(r): return (r["from_phc_id"], r["to_phc_id"], r["quantity"])
    assert sorted(via_worker_snapshot, key=key) == sorted(via_single_process, key=key)


def test_recommend_all_is_deterministic_across_cold_pool_runs():
    forecasting.clear_forecast_cache()
    forecasts = forecasting.forecast_all()
    first = redistribution.recommend_all(forecasts=forecasts)
    worker_pool.shutdown_pool()
    second = redistribution.recommend_all(forecasts=forecasts)
    def key(r): return (r["from_phc_id"], r["to_phc_id"], r["medicine"])
    assert sorted(first, key=key) == sorted(second, key=key)


def test_warm_pool_is_idempotent_and_shutdown_allows_reuse():
    worker_pool.warm_pool()
    pool1 = worker_pool.get_pool()
    worker_pool.warm_pool()  # calling again must not raise or duplicate workers
    assert worker_pool.get_pool() is pool1

    worker_pool.shutdown_pool()
    # A call after shutdown transparently rebuilds the pool rather than failing.
    forecasting.clear_forecast_cache()
    assert forecasting.forecast_all()


def test_pool_uses_spawn_not_fork():
    # fork()ing a multi-threaded process (uvicorn's event loop + its own
    # thread pool for sync routes — exactly what submits to this pool) is a
    # documented source of intermittent deadlocks; regressing to the default
    # "fork" context would reintroduce that hazard silently.
    pool = worker_pool.get_pool()
    assert pool._mp_context is not None
    assert pool._mp_context.get_start_method() == "spawn"
