import { Connection, Client } from "@temporalio/client";
import { readFileSync } from "fs";

export class TemporalConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TemporalConnectionError";
  }
}

export class TemporalClient {
  private connection!: Connection;
  public client!: Client;
  readonly address: string;
  readonly namespace: string;

  constructor() {
    this.address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
    this.namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  }

  async connect(): Promise<void> {
    const opts = this.buildConnectionOptions();
    try {
      this.connection = await Connection.connect(opts);
      this.client = new Client({
        connection: this.connection,
        namespace: this.namespace,
      });
    } catch (err) {
      throw new TemporalConnectionError(
        `Failed to connect to Temporal at ${this.address}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  async validateConnection(): Promise<void> {
    try {
      await this.connection.workflowService.getSystemInfo({});
    } catch (err) {
      throw new TemporalConnectionError(
        `Temporal connection validation failed (namespace="${this.namespace}", address="${this.address}"): ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  private buildConnectionOptions(): Parameters<typeof Connection.connect>[0] {
    const apiKey = process.env.TEMPORAL_API_KEY;
    const certPath = process.env.TEMPORAL_TLS_CERT_PATH;
    const keyPath = process.env.TEMPORAL_TLS_KEY_PATH;

    if (apiKey) {
      return { address: this.address, apiKey, tls: true };
    }

    if (certPath && keyPath) {
      let crt: Buffer;
      let key: Buffer;
      try {
        crt = readFileSync(certPath);
        key = readFileSync(keyPath);
      } catch (err) {
        throw new TemporalConnectionError(
          `Cannot read TLS certificates — check TEMPORAL_TLS_CERT_PATH="${certPath}" and TEMPORAL_TLS_KEY_PATH="${keyPath}": ${err instanceof Error ? err.message : String(err)}`,
          err
        );
      }
      return { address: this.address, tls: { clientCertPair: { crt, key } } };
    }

    return { address: this.address };
  }
}
