#!/usr/bin/env node
(async () => {
  const cli = await import("../lib/cli.js");
  await cli.run();
})().catch((err) => {
  console.error(err);
});
