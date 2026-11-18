"""Unit tests for TokenBucket QoS Traffic Shaper and Congestion Control."""

import asyncio
from app.services.scheduler import TokenBucket


async def test_token_bucket_normal_consumption():
    tb = TokenBucket(rate=10.0, capacity=10.0)
    # When bucket is full, consuming 1 token succeeds immediately with 0 delay
    res = await tb.consume(tokens=1.0, priority=40)
    assert res["allowed"] is True
    assert res["congested"] is False
    assert res["delay_ms"] == 0.0
    assert res["bypassed"] is False
    assert tb.tokens < 10.0
    print("test_token_bucket_normal_consumption: OK")


async def test_token_bucket_high_priority_bypasses_bucket():
    tb = TokenBucket(rate=1.0, capacity=1.0)
    tb.tokens = 0.0  # Empty the bucket
    tb.set_simulated_congestion(True)  # Force congested state

    # High-priority alert (priority=100) MUST bypass with zero delay
    res = await tb.consume(tokens=1.0, priority=100)
    assert res["allowed"] is True
    assert res["bypassed"] is True
    assert res["delay_ms"] == 0.0

    # High-priority message (priority=80) MUST also bypass
    res2 = await tb.consume(tokens=1.0, priority=80)
    assert res2["allowed"] is True
    assert res2["bypassed"] is True
    assert res2["delay_ms"] == 0.0
    print("test_token_bucket_high_priority_bypasses_bucket: OK")


async def test_token_bucket_throttling_when_congested():
    tb = TokenBucket(rate=5.0, capacity=5.0)
    tb.set_simulated_congestion(True)

    # Bulk sync (priority=40) under congestion experiences throttle delay
    res = await tb.consume(tokens=1.0, priority=40)
    assert res["allowed"] is True
    assert res["congested"] is True
    assert res["delay_ms"] >= 200.0  # At least 250ms backoff
    assert res["bypassed"] is False
    print("test_token_bucket_throttling_when_congested: OK")


async def test_token_bucket_refills_over_time():
    tb = TokenBucket(rate=10.0, capacity=10.0)
    tb.tokens = 0.0
    await asyncio.sleep(0.15)
    tb._refill()
    # At 10 tokens/sec, 0.15s should refill at least 1.0 token
    assert tb.tokens >= 1.0
    print("test_token_bucket_refills_over_time: OK")


async def main():
    await test_token_bucket_normal_consumption()
    await test_token_bucket_high_priority_bypasses_bucket()
    await test_token_bucket_throttling_when_congested()
    await test_token_bucket_refills_over_time()
    print("=== ALL 4 CONGESTION TESTS PASSED SUCCESSFULLY! ===")


if __name__ == "__main__":
    asyncio.run(main())
