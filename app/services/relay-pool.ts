import { RelayPool } from "applesauce-relay";

const pool = new RelayPool({
  eventTimeout: 60_000,
});

// todo: add logging

export default pool;
