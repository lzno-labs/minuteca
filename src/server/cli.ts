// Access list from the command line, for self-hosted installs:
//   npm run access -- add ana@example.org [admin]
//   npm run access -- remove ana@example.org
//   npm run access -- list
import { migrate, openSqlite } from "./storage/sqlite.ts";
import { Store } from "./storage/store.ts";

const [cmd, email, role] = process.argv.slice(2);
const db = openSqlite(process.env.MINUTECA_DB || "./data/minuteca.sqlite");
await migrate(db);
const store = new Store(db);
if (cmd === "add" && email) {
  const u = await store.saveUser(email.trim().toLowerCase(), role === "admin" ? "admin" : "member", "cli", Date.now());
  console.log(`${u.email}: ${u.role}`);
} else if (cmd === "remove" && email) {
  const u = await store.userByEmail(email.trim().toLowerCase());
  if (u) await store.removeUser(u.id);
  console.log(u ? `${u.email}: removed` : `${email}: not on the list`);
} else if (cmd === "list") {
  for (const u of await store.listUsers()) console.log(`${u.email}\t${u.role}`);
} else {
  console.log("usage: npm run access -- add <email> [admin] | remove <email> | list");
  process.exitCode = 1;
}
db.close();
