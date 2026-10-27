// merit-x: X post reads only for posts Merit is working on (JavaScript version of merit-x-submissions-outcall.rs).
// Use it only if the custom_code editor offers no Rust option for merit-x. fetchToken: the merit-check latch's lat_
// token. fetch() takes relative paths only and goes through merit-check, which injects Merit's key.
if (String(ctx.method).toUpperCase() !== "GET") return { allow: false, reason: "merit-x is read-only" };
const [path, query = ""] = String(ctx.path).split("?");
if (path !== "/2/tweets" && !path.startsWith("/2/tweets/")) return { allow: true };
const isId = (s) => /^\d{1,20}$/.test(s);
let ids;
if (path.startsWith("/2/tweets/")) {
  const id = path.slice("/2/tweets/".length);
  if (!isId(id)) return { allow: false, reason: "merit-x allows post lookups by id only" };
  ids = [id];
} else {
  const pair = query.split("&").find((kv) => kv.startsWith("ids="));
  ids = (pair ? decodeURIComponent(pair.slice(4)) : "").split(",");
  if (!ids.every(isId)) return { allow: false, reason: "ids= must list numeric post ids (the policy could not read them)" };
}
if (ids.length < 1 || ids.length > 10) return { allow: false, reason: "between 1 and 10 post ids per read" };
const joined = ids.join(",");
try {
  const resp = await fetch("/api/latch/tweet-check/" + joined);
  const text = (await resp.text()).trim();
  if (resp.status === 200 && text === "MERIT-OK " + joined) return { allow: true };
  return { allow: false, reason: "not a Merit submission (check answered " + resp.status + ")" };
} catch (e) {
  return { allow: false, reason: "Merit's submission check is unreachable (fail closed)" };
}
