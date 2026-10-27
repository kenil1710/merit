// merit-x: X post reads only for posts Merit is working on (the OUTCALL version).
//
// NOT INSTALLED yet: it needs outcall support in Rust custom_code. Ready for
// when that is available.
// The policy that is live is merit-x-submissions.rs.
//
// GET /2/tweets/:id and GET /2/tweets?ids=… go through only when Merit
// confirms every id is a pending or recent submission (or a read Merit has
// just announced). The question is a governed outcall through the
// merit-check latch, which holds the only key Merit's endpoint accepts.
// Anything but an exact "MERIT-OK <ids>" denies: fail closed. Other paths
// pass to the rest of the pipeline (the endpoint filter still decides them).
//
// Paste below this line into the custom_code editor (language: rust), then
// replace PASTE_MERIT_CHECK_TOKEN with the merit-check latch's lat_ token.

const CHECK_URL: &str = "https://onlatch.com/proxy/api/latch/tweet-check/";
const CHECK_TOKEN: &str = "lat_PASTE_MERIT_CHECK_TOKEN";
const MAX_IDS: usize = 10;

if !ctx.method.eq_ignore_ascii_case("GET") {
    return PolicyResult::deny("merit-x is read-only");
}
let full: &str = &ctx.path;
let (path, query) = match full.split_once('?') {
    Some((p, q)) => (p, q),
    None => (full, ""),
};
if path != "/2/tweets" && !path.starts_with("/2/tweets/") {
    return PolicyResult::allow();
}

let is_id = |s: &str| !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit());
let mut ids: Vec<String> = Vec::new();
if let Some(id) = path.strip_prefix("/2/tweets/") {
    if !is_id(id) {
        return PolicyResult::deny("merit-x allows post lookups by id only");
    }
    ids.push(id.to_string());
} else {
    // GET /2/tweets?ids=1,2,3 (the comma may arrive as %2C).
    let list = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("ids="))
        .unwrap_or("")
        .replace("%2C", ",")
        .replace("%2c", ",");
    for id in list.split(',') {
        if !is_id(id) {
            return PolicyResult::deny("ids= must list numeric post ids (the policy could not read them)");
        }
        ids.push(id.to_string());
    }
}
if ids.is_empty() || ids.len() > MAX_IDS {
    return PolicyResult::deny("between 1 and 10 post ids per read");
}

let joined = ids.join(",");
let headers = vec![
    ("Authorization".to_string(), format!("Bearer {}", CHECK_TOKEN)),
    latch_eval_depth_header(&ctx),
];
match http_get(&format!("{}{}", CHECK_URL, joined), &headers) {
    Ok(r) if r.status == 200 && String::from_utf8_lossy(&r.body).trim() == format!("MERIT-OK {}", joined) => {
        PolicyResult::allow()
    }
    Ok(r) => PolicyResult::deny(format!("not a Merit submission (check answered {})", r.status)),
    Err(_) => PolicyResult::deny("Merit's submission check is unreachable (fail closed)"),
}
