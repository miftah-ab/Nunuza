import { pickPending } from "./apply-migrations.mjs";
import assert from "node:assert/strict";

const files = ["0001_initial_schema.sql", "20261114_bad.sql", "20261115054000_scheduled_post_notifications.sql", "20261120100000_new_thing.sql", "20261119100000_older_new.sql", "README.md"];
const pending = pickPending(files, ["scheduled_post_notifications"]);
assert.deepEqual(pending.map((m) => m.name), ["older_new", "new_thing"]);
assert.deepEqual(pickPending(files, ["scheduled_post_notifications", "older_new", "new_thing"]), []);
console.log("apply-migrations tests passed");
