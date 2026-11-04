declare module "pg" {
  export type QueryResultRow = Record<string, unknown>;

  export interface QueryResult<Row extends QueryResultRow = QueryResultRow> {
    rows: Row[];
    rowCount: number | null;
  }

  export interface PoolClient {
    query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
    release(): void;
  }

  export class Pool {
    constructor(config?: { connectionString?: string; max?: number; idleTimeoutMillis?: number; connectionTimeoutMillis?: number });
    connect(): Promise<PoolClient>;
    query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  }
}
