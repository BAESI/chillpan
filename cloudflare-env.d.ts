declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AWS_BOARD_ORIGIN?: string;
  }
}
