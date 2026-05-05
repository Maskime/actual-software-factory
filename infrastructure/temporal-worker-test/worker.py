import asyncio
import logging
import os
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker

logging.basicConfig(level=logging.INFO)


@workflow.defn
class HealthCheckWorkflow:
    @workflow.run
    async def run(self) -> str:
        return await workflow.execute_activity(
            health_check_activity,
            schedule_to_close_timeout=timedelta(seconds=10),
        )


@activity.defn
async def health_check_activity() -> str:
    return "healthy"


@workflow.defn
class PingWorkflow:
    """Round-trip test workflow: waits for a 'ping' signal then returns 'pong'."""

    def __init__(self) -> None:
        self._signaled = False

    @workflow.signal
    async def ping(self) -> None:
        self._signaled = True

    @workflow.run
    async def run(self) -> str:
        await workflow.wait_condition(lambda: self._signaled, timeout=timedelta(seconds=60))
        return "pong"


async def main() -> None:
    address = os.getenv("TEMPORAL_ADDRESS", "temporal:7233")
    namespace = os.getenv("TEMPORAL_NAMESPACE", "factory-test")
    while True:
        try:
            client = await Client.connect(address, namespace=namespace)
            worker = Worker(
                client,
                task_queue="factory-test-queue",
                workflows=[HealthCheckWorkflow, PingWorkflow],
                activities=[health_check_activity],
            )
            logging.info("Worker connected — polling factory-test-queue in namespace '%s'", namespace)
            await worker.run()
        except Exception as exc:
            logging.warning(
                "Worker not ready (namespace '%s' may not exist yet — run setup-temporal.sh): %s — retrying in 5s",
                namespace,
                exc,
            )
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
