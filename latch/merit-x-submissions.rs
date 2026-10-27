// merit-x: post lookups by numeric id only (the policy that is live).
//
// GET /2/tweets/<numeric id> goes through, with or without a query string
// (REX validators and Merit's judge both send ?tweet.fields=…). Everything
// else is denied: any other method, a non-numeric segment such as
// /2/tweets/search, the bare /2/tweets?ids= lookup, and /2/users/…
//
// This is the body of the custom_code filter (language: rust). The editor
// wraps it in `pub fn on_request(ctx: &RequestContext) -> PolicyResult`.
// The stronger version that also asks Merit whether the post is a
// submission is merit-x-submissions-outcall.rs: it needs an outcall helper
// this account's template doesn't have yet.

if !ctx.method.eq_ignore_ascii_case("GET") {
    return PolicyResult::deny("merit-x is read-only");
}
let full: &str = &ctx.path;
let path = full.split('?').next().unwrap_or("");
match path.strip_prefix("/2/tweets/") {
    Some(id) if !id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit()) => PolicyResult::allow(),
    _ => PolicyResult::deny("merit-x allows GET /2/tweets/<numeric id> only"),
}
