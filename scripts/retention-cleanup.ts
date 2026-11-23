import prisma from "../app/db.server.js";
import { runRetentionCleanup } from "../app/lib/retention.server.ts";

runRetentionCleanup(prisma)
  .then((result) => {
    console.log("retention cleanup:", JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    console.error("retention cleanup failed:", err);
    process.exit(1);
  });
